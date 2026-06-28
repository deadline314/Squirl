/**
 * YouTube 字幕擷取（在 content script 內執行；對 youtube.com 同源，timedtext 可直接 fetch）。
 *
 * 流程：
 * 1. 從頁面 script 解析 ytInitialPlayerResponse（content script 無法讀頁面 JS 變數，改解析內嵌 JSON）
 * 2. 取 captionTracks（含語言、是否 ASR、baseUrl）
 * 3. 依偏好語言挑軌，fetch `baseUrl&fmt=json3` 解析成 cues + text
 *
 * 容錯：任何一步失敗都回空陣列或 undefined，由上層降級為「只存 URL + metadata」。
 */
import type { CaptionCue, CaptionTrack } from '../ContentSource';
import { createLogger } from '@/shared/logger';

const log = createLogger('yt-captions');

interface RawTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' = 自動產生
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] };
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    shortDescription?: string;
    thumbnail?: { thumbnails?: { url: string }[] };
  };
}

/** 從頁面內嵌 script 解析 player response（容錯：多種樣式 + 失敗回 null） */
export function extractPlayerResponse(): PlayerResponse | null {
  // 1. 直接從 window（部分情況 content script 仍可見 wrappedJSObject；多半不可，故有後備）
  try {
    const w = window as unknown as { ytInitialPlayerResponse?: PlayerResponse };
    if (w.ytInitialPlayerResponse?.captions || w.ytInitialPlayerResponse?.videoDetails) {
      return w.ytInitialPlayerResponse;
    }
  } catch {
    /* fallthrough */
  }
  // 2. 掃 script 內嵌 JSON
  for (const s of Array.from(document.scripts)) {
    const txt = s.textContent;
    if (!txt || txt.indexOf('ytInitialPlayerResponse') === -1) continue;
    const json = sliceAssignedJson(txt, 'ytInitialPlayerResponse');
    if (json) {
      try {
        return JSON.parse(json) as PlayerResponse;
      } catch {
        /* 試下一個 */
      }
    }
  }
  return null;
}

/** 從 `var X = {...};` 取出平衡括號的 JSON 字串 */
function sliceAssignedJson(src: string, varName: string): string | null {
  const idx = src.indexOf(varName);
  if (idx === -1) return null;
  const braceStart = src.indexOf('{', idx);
  if (braceStart === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return null;
}

export function listCaptionTracks(pr: PlayerResponse | null): CaptionTrack[] {
  const raw = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return raw
    .filter((t) => t.baseUrl && t.languageCode)
    .map((t) => ({
      lang: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      auto: t.kind === 'asr',
      // baseUrl 暫存於 name 之外不放——下載時需要，故另存對照
    }));
}

/** 依偏好語言挑軌並下載成 cues + text。回傳已填好的 CaptionTrack（失敗則該軌 text 為空）。 */
export async function downloadPreferredCaptions(
  pr: PlayerResponse | null,
  preferredLangs: string[],
): Promise<CaptionTrack[]> {
  const raw = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!raw.length) return [];

  const wanted = pickTracks(raw, preferredLangs);
  const out: CaptionTrack[] = [];
  for (const t of wanted) {
    const track: CaptionTrack = {
      lang: t.languageCode,
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      auto: t.kind === 'asr',
    };
    try {
      const cues = await fetchCues(t.baseUrl);
      if (cues.length) {
        track.cues = cues;
        track.text = cues.map((c) => c.text).join('\n');
      }
    } catch (e) {
      log.warn(`caption download failed for ${t.languageCode}`, e);
    }
    out.push(track);
  }
  return out;
}

/** 偏好語言序：使用者偏好 → 介面語言 → 原片第一軌；避免重複 */
function pickTracks(raw: RawTrack[], preferred: string[]): RawTrack[] {
  const order = [...preferred, (navigator.language || 'en').split('-')[0] ?? 'en'];
  const picked: RawTrack[] = [];
  const seen = new Set<string>();
  for (const pref of order) {
    const hit = raw.find((t) => t.languageCode.toLowerCase().startsWith(pref.toLowerCase()));
    if (hit && !seen.has(hit.baseUrl)) {
      picked.push(hit);
      seen.add(hit.baseUrl);
    }
  }
  // 都沒命中 → 取第一軌（多為原片語言），確保至少有一份
  if (!picked.length && raw[0]) picked.push(raw[0]);
  return picked;
}

async function fetchCues(baseUrl: string): Promise<CaptionCue[]> {
  const url = baseUrl + (baseUrl.includes('fmt=') ? '' : '&fmt=json3');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { events?: Json3Event[] };
    return parseJson3(data.events ?? []);
  } finally {
    clearTimeout(timer);
  }
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

function parseJson3(events: Json3Event[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+\n/g, '\n')
      .trim();
    if (!text) continue;
    const startSec = (ev.tStartMs ?? 0) / 1000;
    const endSec = startSec + (ev.dDurationMs ?? 0) / 1000;
    cues.push({ startSec, endSec, text });
  }
  return cues;
}
