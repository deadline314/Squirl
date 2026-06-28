/**
 * 背景端 YouTube 擷取。
 *
 * 取資料策略（穩定優先）：
 *  - 用「極小的單行注入函式」在頁面 MAIN world 取回 player response 字串（序列化超穩，
 *    不會像大函式那樣被打包器弄壞——這是先前「讀不到影片資訊」的根因）。
 *  - 解析在 background（playerResponse.ts，純函式）。
 *  - 字幕（含自動生成 ASR）用另一個極小注入函式在頁面同源 fetch timedtext。
 *
 * 容錯：注入失敗 / 取不到 player response → throw YT_PARSE_FAILED，由 orchestrator
 * 退回 content-script 擷取（只存網址＋可見資訊）。
 */
import { AppError } from '@/shared/errors';
import { createLogger } from '@/shared/logger';
import { type CaptureResult, type CaptionTrack, type ContentNode, type VideoVariantInfo, nowIso } from '../ContentSource';
import { type ParsedYt, parseJson3, parsePlayerResponse } from './playerResponse';

const log = createLogger('yt-capture');

export interface YtCaptureOptions {
  saveSubtitles: boolean;
  preferredLangs: string[];
}

export interface YtProbe {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  captionLangs: { lang: string; name: string; auto: boolean }[];
  variants: { itag: number; label: string; ext: string; sizeBytes?: number }[];
}

// ---- 極小注入函式（自包含、單一職責，序列化穩定）----

/**
 * 在頁面 MAIN world 取回 player response 的 JSON 字串。
 *
 * 來源優先序：
 *  1. movie_player.getPlayerResponse()（當前影片）或 window.ytInitialPlayerResponse —— 取 videoDetails/streamingData。
 *  2. 若上述都沒有字幕軌（YouTube 對某些影片就是不把 captions 放進頁面的 player response，
 *     即使有「自動產生」字幕），就改用 InnerTube /youtubei/v1/player API 重新要一份——
 *     這正是 yt-dlp 取得自動字幕的方式。同源、在 MAIN world 可直接 POST。
 *
 * async：因為要 fetch InnerTube。完全自包含（只用頁面全域），可安全序列化注入。
 */
async function injectGetPlayerResponse(): Promise<string | null> {
  try {
    const el = document.getElementById('movie_player') as unknown as { getPlayerResponse?: () => unknown };
    const live: any = el && typeof el.getPlayerResponse === 'function' ? el.getPlayerResponse() : null;
    const init: any = (window as any).ytInitialPlayerResponse ?? null;
    let pr: any = live && (live.videoDetails || live.streamingData) ? live : (init ?? live);
    if (!pr) return null;

    const hasTracks = (p: any) => (p?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0) > 0;

    if (!hasTracks(pr)) {
      const videoId: string = pr?.videoDetails?.videoId || new URLSearchParams(location.search).get('v') || '';
      const cfg: any = (window as any).ytcfg;
      const apiKey: string = cfg?.get?.('INNERTUBE_API_KEY') ?? cfg?.data_?.INNERTUBE_API_KEY ?? '';
      const context = cfg?.get?.('INNERTUBE_CONTEXT') ?? cfg?.data_?.INNERTUBE_CONTEXT;
      if (videoId && apiKey && context) {
        try {
          const res = await fetch(`/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true }),
          });
          if (res.ok) {
            const data: any = await res.json();
            if (data?.captions) pr = { ...pr, captions: data.captions };
            if (!pr.videoDetails && data?.videoDetails) pr = { ...pr, videoDetails: data.videoDetails };
            if (!pr.streamingData && data?.streamingData) pr = { ...pr, streamingData: data.streamingData };
          }
        } catch {
          /* InnerTube 失敗：保留頁面那份 */
        }
      }
    }
    return JSON.stringify(pr);
  } catch {
    return null;
  }
}

/** 在頁面 MAIN world 同源 fetch 字幕（json3），回傳與輸入等長的文字陣列 */
async function injectFetchCaptions(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    try {
      // 強制 json3（移除既有 fmt，避免拿到 XML/srv3 解析不出）
      const url = u.replace(/&fmt=[^&]*/g, '') + '&fmt=json3';
      const res = await fetch(url);
      out.push(res.ok ? await res.text() : '');
    } catch {
      out.push('');
    }
  }
  return out;
}

async function getPlayerResponse(tabId: number): Promise<unknown> {
  let results: chrome.scripting.InjectionResult<string | null>[];
  try {
    results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: injectGetPlayerResponse });
  } catch (e) {
    throw new AppError('YT_PARSE_FAILED', e instanceof Error ? e.message : String(e));
  }
  const str = results?.[0]?.result;
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function fetchCaptionTexts(tabId: number, urls: string[]): Promise<string[]> {
  if (!urls.length) return [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: injectFetchCaptions,
      args: [urls],
    });
    return results?.[0]?.result ?? urls.map(() => '');
  } catch (e) {
    log.warn('caption fetch injection failed', e);
    return urls.map(() => '');
  }
}

// ---- 對外 API ----

export async function captureYouTube(tabId: number, url: string, opts: YtCaptureOptions): Promise<CaptureResult> {
  const pr = await getPlayerResponse(tabId);
  const parsed = parsePlayerResponse(pr, { saveSubtitles: opts.saveSubtitles, preferredLangs: opts.preferredLangs, uiLang: navigator.language || 'en' });
  if (!parsed.ok) throw new AppError('YT_PARSE_FAILED', parsed.error ?? 'player response unavailable');

  const warnings: string[] = [];
  const captions: CaptionTrack[] = [];
  if (opts.saveSubtitles) {
    const texts = await fetchCaptionTexts(tabId, parsed.picked.map((p) => p.baseUrl));
    parsed.picked.forEach((p, i) => {
      const cues = parseJson3(texts[i] ?? '');
      const track: CaptionTrack = { lang: p.lang, name: p.name, auto: p.auto };
      if (cues.length) {
        track.cues = cues;
        track.text = cues.map((c) => c.text).join('\n');
      }
      captions.push(track);
    });
    if (!captions.length || captions.every((c) => !c.text)) {
      warnings.push(
        parsed.allCaptions.length
          ? '字幕被 YouTube 限制無法下載（此片字幕已上鎖；多數影片可正常取得，必要時可改用音訊轉錄）。'
          : '這部影片沒有字幕。',
      );
    }
  }

  const video: VideoVariantInfo[] = parsed.progressive.map((p) => ({
    itag: p.itag,
    label: p.qualityLabel,
    container: p.ext,
    ext: p.ext,
    width: p.width,
    height: p.height,
    sizeBytes: p.sizeBytes,
    hasAudio: true,
    hasVideo: true,
    url: p.url,
  }));

  return {
    kind: 'youtube',
    url: url || (parsed.videoId ? `https://www.youtube.com/watch?v=${parsed.videoId}` : ''),
    title: parsed.title || url,
    capturedAt: nowIso(),
    lang: captions[0]?.lang,
    byline: parsed.channel || undefined,
    excerpt: parsed.description.slice(0, 280) || undefined,
    tree: buildTree(parsed),
    youtube: {
      videoId: parsed.videoId,
      channel: parsed.channel || undefined,
      durationSec: parsed.durationSec || undefined,
      thumbnail: parsed.thumbnail || undefined,
      chapters: parsed.chapters.length ? parsed.chapters : undefined,
      captions,
      video: video.length ? video : undefined,
    },
    warnings: warnings.length ? warnings : undefined,
  };
}

export async function probeYouTube(tabId: number): Promise<YtProbe> {
  const pr = await getPlayerResponse(tabId);
  const parsed = parsePlayerResponse(pr, { saveSubtitles: false, preferredLangs: [], uiLang: navigator.language || 'en' });
  if (!parsed.ok) throw new AppError('YT_PARSE_FAILED', parsed.error ?? 'player response unavailable');
  return {
    videoId: parsed.videoId,
    title: parsed.title,
    channel: parsed.channel,
    durationSec: parsed.durationSec,
    captionLangs: parsed.allCaptions,
    variants: parsed.progressive.map((p) => ({ itag: p.itag, label: p.qualityLabel, ext: p.ext, sizeBytes: p.sizeBytes })),
  };
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return true;
    return h === 'youtube.com' && (u.pathname.startsWith('/watch') || u.pathname.startsWith('/shorts/'));
  } catch {
    return false;
  }
}

function buildTree(p: ParsedYt): ContentNode[] {
  const tree: ContentNode[] = [{ type: 'heading', level: 1, text: p.title }];
  if (p.channel) tree.push({ type: 'paragraph', text: `頻道：${p.channel}` });
  if (p.chapters.length) {
    tree.push({ type: 'heading', level: 2, text: '章節' });
    tree.push({ type: 'list', ordered: true, children: p.chapters.map((c) => ({ type: 'listitem', text: `${fmtTime(c.startSec)} ${c.title}` })) });
  }
  if (p.description.trim()) {
    tree.push({ type: 'heading', level: 2, text: '說明' });
    for (const para of p.description.split(/\n{2,}/)) {
      const t = para.trim();
      if (t) tree.push({ type: 'paragraph', text: t });
    }
  }
  return tree;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
