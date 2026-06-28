/**
 * YouTube player response 的「純解析」工具（在 background 執行，不碰 DOM、不 fetch）。
 *
 * 設計理由：先前用 executeScript 注入「一個含多個巢狀函式的大函式」去頁面解析，
 * 打包器序列化時容易壞掉，導致「讀不到影片資訊」。改成：
 *   1) 用「極小的單行注入函式」只把 player response 字串抓回 background（序列化超穩）；
 *   2) 解析全部在 background 做（這個檔案，純函式、好測）；
 *   3) 字幕同樣用極小注入函式在頁面 MAIN world 同源 fetch。
 *
 * 字幕涵蓋「人工」與「自動生成(ASR)」兩種；ASR 也照常下載，只是標記 auto。
 */

export interface YtCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface YtCaption {
  lang: string;
  name: string;
  auto: boolean; // 自動生成(ASR)
  text?: string;
  cues?: YtCue[];
}

export interface YtProgressive {
  itag: number;
  qualityLabel: string;
  ext: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  url: string;
}

export interface ParsedYt {
  ok: boolean;
  error?: string;
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnail: string;
  description: string;
  chapters: { title: string; startSec: number }[];
  progressive: YtProgressive[];
  /** 全部可用字幕軌（給 popup 顯示） */
  allCaptions: { lang: string; name: string; auto: boolean }[];
  /** 依偏好挑出、要下載的字幕軌（含 baseUrl） */
  picked: { lang: string; name: string; auto: boolean; baseUrl: string }[];
}

export interface ParseOpts {
  saveSubtitles: boolean;
  preferredLangs: string[];
  uiLang: string;
}

const EMPTY: Omit<ParsedYt, 'ok' | 'error'> = {
  videoId: '', title: '', channel: '', durationSec: 0, thumbnail: '', description: '',
  chapters: [], progressive: [], allCaptions: [], picked: [],
};

export function parsePlayerResponse(pr: any, opts: ParseOpts): ParsedYt {
  if (!pr || typeof pr !== 'object') return { ok: false, error: 'no-player-response', ...EMPTY };

  const vd = pr.videoDetails ?? {};
  const videoId: string = vd.videoId ?? '';
  const title: string = String(vd.title ?? '').trim();
  const channel: string = vd.author ?? '';
  const durationSec = Number(vd.lengthSeconds ?? 0) || 0;
  const description: string = vd.shortDescription ?? '';
  const thumbs = vd.thumbnail?.thumbnails;
  const thumbnail: string =
    (Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1].url : '') ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');

  const progressive = parseProgressive(pr.streamingData?.formats);
  const tracks = parseCaptionTracks(pr.captions?.playerCaptionsTracklistRenderer?.captionTracks);

  const picked = opts.saveSubtitles ? pickTracks(tracks, opts.preferredLangs, opts.uiLang) : [];

  return {
    ok: true,
    videoId,
    title,
    channel,
    durationSec,
    thumbnail,
    description,
    chapters: parseChapters(description),
    progressive,
    allCaptions: tracks.map((t) => ({ lang: t.lang, name: t.name, auto: t.auto })),
    picked,
  };
}

interface Track {
  lang: string;
  name: string;
  auto: boolean;
  baseUrl: string;
}

function parseCaptionTracks(raw: any): Track[] {
  if (!Array.isArray(raw)) return [];
  const out: Track[] = [];
  for (const t of raw) {
    if (!t?.baseUrl || !t?.languageCode) continue;
    out.push({
      lang: String(t.languageCode),
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || String(t.languageCode),
      auto: t.kind === 'asr',
      baseUrl: String(t.baseUrl),
    });
  }
  // 人工字幕排在自動生成之前（同語言時優先挑人工版）
  out.sort((a, b) => Number(a.auto) - Number(b.auto));
  return out;
}

function pickTracks(tracks: Track[], preferred: string[], uiLang: string): Track[] {
  if (!tracks.length) return [];
  const order = [...preferred, (uiLang || 'en').split('-')[0] ?? 'en'];
  const picked: Track[] = [];
  const seen = new Set<string>();
  for (const pref of order) {
    if (!pref) continue;
    const hit = tracks.find((t) => t.lang.toLowerCase().startsWith(pref.toLowerCase()) && !seen.has(t.baseUrl));
    if (hit) {
      picked.push(hit);
      seen.add(hit.baseUrl);
    }
  }
  // 都沒命中 → 取第一軌（多為原片語言或唯一的自動字幕），確保至少有一份
  if (!picked.length && tracks[0]) picked.push(tracks[0]);
  return picked;
}

function parseProgressive(raw: any): YtProgressive[] {
  if (!Array.isArray(raw)) return [];
  const out: YtProgressive[] = [];
  for (const f of raw) {
    if (!f?.url) continue; // 受簽章保護無直連 url 者略過（progressive 多半有）
    const mime = String(f.mimeType ?? '');
    out.push({
      itag: Number(f.itag ?? 0),
      qualityLabel: String(f.qualityLabel ?? f.quality ?? `${f.height ?? ''}p`),
      ext: mime.indexOf('webm') !== -1 ? 'webm' : 'mp4',
      width: f.width,
      height: f.height,
      sizeBytes: f.contentLength
        ? Number(f.contentLength)
        : f.bitrate && f.approxDurationMs
          ? Math.round((Number(f.bitrate) / 8) * (Number(f.approxDurationMs) / 1000))
          : undefined,
      url: String(f.url),
    });
  }
  out.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return out;
}

function parseChapters(desc: string): { title: string; startSec: number }[] {
  const out: { title: string; startSec: number }[] = [];
  const re = /(?:^|\n)\s*\(?(\d{1,2}):(\d{2})(?::(\d{2}))?\)?\s+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc)) !== null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = m[3] ? Number(m[3]) : null;
    const startSec = c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
    const t = (m[4] || '').trim();
    if (t) out.push({ title: t, startSec });
    if (out.length > 300) break;
  }
  return out;
}

/** 解析 timedtext json3 文字 → cues */
export function parseJson3(text: string): YtCue[] {
  if (!text) return [];
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const events = data?.events;
  if (!Array.isArray(events)) return [];
  const cues: YtCue[] = [];
  for (const ev of events) {
    if (!ev?.segs) continue;
    const t = ev.segs
      .map((s: any) => s.utf8 ?? '')
      .join('')
      .replace(/\s+\n/g, '\n')
      .trim();
    if (!t) continue;
    const startSec = (ev.tStartMs ?? 0) / 1000;
    cues.push({ startSec, endSec: startSec + (ev.dDurationMs ?? 0) / 1000, text: t });
  }
  return cues;
}
