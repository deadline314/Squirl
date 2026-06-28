/**
 * YouTube 擷取器（content script 內執行）。
 * v1 範圍：URL + metadata（標題/頻道/時長/章節/縮圖）+ 字幕（可選）。
 * 影片本體下載＝v2（見 VideoDownloader）。
 *
 * 容錯：player response 解析失敗 → 退回頁面可見 metadata；無字幕 → warning。
 */
import {
  type CaptureOptions,
  type CaptureResult,
  type ContentNode,
  type ContentSource,
  type YouTubeMeta,
  nowIso,
} from '../ContentSource';
import { downloadPreferredCaptions, extractPlayerResponse } from './captions';
import { createLogger } from '@/shared/logger';

const log = createLogger('youtube');

export class YouTubeExtractor implements ContentSource {
  readonly kind = 'youtube' as const;

  matches(url: string): boolean {
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, '');
      if (h === 'youtu.be') return true;
      if (h === 'youtube.com' || h === 'm.youtube.com') return u.pathname.startsWith('/watch') || u.pathname.startsWith('/shorts/');
      return false;
    } catch {
      return false;
    }
  }

  async capture(opts: CaptureOptions): Promise<CaptureResult> {
    const warnings: string[] = [];
    const url = location.href;
    const videoId = parseVideoId(url);

    const pr = extractPlayerResponse();
    if (!pr) warnings.push('無法解析影片資訊，已改存網址與頁面基本資料。');

    const details = pr?.videoDetails;
    const title = (details?.title || cleanTitle(document.title) || url).trim();
    const channel = details?.author || channelFromDom() || undefined;
    const durationSec = details?.lengthSeconds ? Number(details.lengthSeconds) : undefined;
    const thumbnail = details?.thumbnail?.thumbnails?.slice(-1)[0]?.url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined);
    const description = details?.shortDescription || '';
    const chapters = parseChapters(description);

    const youtube: YouTubeMeta = {
      videoId: videoId || '',
      channel,
      durationSec,
      thumbnail,
      chapters: chapters.length ? chapters : undefined,
      captions: [],
    };

    if (opts.saveSubtitles) {
      try {
        const caps = await downloadPreferredCaptions(pr, opts.preferredLangs);
        youtube.captions = caps;
        if (!caps.length || caps.every((c) => !c.text)) warnings.push('這部影片沒有可用字幕。');
      } catch (e) {
        log.warn('caption download failed', e);
        warnings.push('字幕下載失敗，已改存網址與基本資料。');
      }
    }

    const tree = buildTree(title, channel, description, chapters);

    return {
      kind: 'youtube',
      url,
      title,
      capturedAt: nowIso(),
      lang: youtube.captions[0]?.lang,
      byline: channel,
      excerpt: description.slice(0, 280) || undefined,
      tree,
      youtube,
      warnings: warnings.length ? warnings : undefined,
    };
  }
}

function buildTree(title: string, channel: string | undefined, description: string, chapters: { title: string; startSec: number }[]): ContentNode[] {
  const tree: ContentNode[] = [{ type: 'heading', level: 1, text: title }];
  if (channel) tree.push({ type: 'paragraph', text: `頻道：${channel}` });
  if (chapters.length) {
    tree.push({ type: 'heading', level: 2, text: '章節' });
    tree.push({
      type: 'list',
      ordered: true,
      children: chapters.map((c) => ({ type: 'listitem', text: `${formatTime(c.startSec)} ${c.title}` })),
    });
  }
  if (description.trim()) {
    tree.push({ type: 'heading', level: 2, text: '說明' });
    for (const para of description.split(/\n{2,}/)) {
      const t = para.trim();
      if (t) tree.push({ type: 'paragraph', text: t });
    }
  }
  return tree;
}

function parseVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

function channelFromDom(): string | null {
  const el = document.querySelector('ytd-channel-name a, #channel-name a, #owner #channel-name');
  return el?.textContent?.trim() || null;
}

/** 從描述解析「mm:ss 標題」形式的章節 */
function parseChapters(description: string): { title: string; startSec: number }[] {
  const out: { title: string; startSec: number }[] = [];
  const re = /(?:^|\n)\s*(?:\(?\d{0,2}:?)?(\d{1,2}):(\d{2})\)?\s+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const title = (m[3] || '').trim();
    if (title) out.push({ title, startSec: min * 60 + sec });
    if (out.length > 200) break; // 容錯上限
  }
  return out;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  return h ? `${h}:${mm}:${sss}` : `${m}:${sss}`;
}

function cleanTitle(t: string): string {
  return (t ?? '').replace(/ - YouTube$/, '').replace(/\s+/g, ' ').trim();
}
