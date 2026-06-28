/**
 * 單次剪存的進度模型 + 歷史持久化（chrome.storage.local 環狀紀錄）。
 * 歷史供 popup 顯示「最近剪存」與「失敗重試」。
 */
import type { SerializedError } from '@/shared/errors';
import type { ClipPhase, ClipRequest, ClipSnapshot } from '@/messaging/protocol';
import { createLogger } from '@/shared/logger';

const log = createLogger('cliphistory');
const HISTORY_KEY = 'clip-history';
const MAX_HISTORY = 50;

export interface HistoryEntry {
  snapshot: ClipSnapshot;
  /** 重試所需的原始請求（tab 可能已關，屆時回報錯誤） */
  request: ClipRequest;
}

export function newSnapshot(id: string, url: string, title: string): ClipSnapshot {
  return {
    id,
    url,
    title,
    phase: 'queued',
    detail: '',
    progress: 0,
    webViewLink: null,
    duplicate: false,
    error: null,
    at: Date.now(),
  };
}

export function patchSnapshot(
  s: ClipSnapshot,
  patch: Partial<Pick<ClipSnapshot, 'phase' | 'detail' | 'progress' | 'webViewLink' | 'duplicate' | 'title' | 'url'>> & {
    error?: SerializedError | null;
  },
): ClipSnapshot {
  return { ...s, ...patch, at: Date.now() };
}

export function isTerminal(phase: ClipPhase): boolean {
  return phase === 'done' || phase === 'error';
}

/** 讀歷史（永不 throw） */
export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const res = await chrome.storage.local.get(HISTORY_KEY);
    const arr = res[HISTORY_KEY];
    return Array.isArray(arr) ? (arr as HistoryEntry[]) : [];
  } catch (e) {
    log.warn('loadHistory failed', e);
    return [];
  }
}

/** upsert 一筆歷史（依 snapshot.id），維持環狀上限（永不 throw） */
export async function upsertHistory(entry: HistoryEntry): Promise<void> {
  try {
    const list = await loadHistory();
    const idx = list.findIndex((e) => e.snapshot.id === entry.snapshot.id);
    if (idx >= 0) list[idx] = entry;
    else list.unshift(entry);
    const trimmed = list.slice(0, MAX_HISTORY);
    await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
  } catch (e) {
    log.warn('upsertHistory failed', e);
  }
}

export async function getHistoryEntry(id: string): Promise<HistoryEntry | undefined> {
  return (await loadHistory()).find((e) => e.snapshot.id === id);
}
