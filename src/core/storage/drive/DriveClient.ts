/**
 * Google Drive 直傳 client（在 background SW 執行）。
 *
 * 容錯設計：
 * - resumable upload：分段 8MB，網路錯誤/5xx 指數退避（max 5），
 *   每次失敗先向 session 查詢「已收到多少 byte」，從斷點續傳，絕不重頭
 * - 401 → invalidate token 重取一次
 * - 分段 PUT 走 session capability URL，不需重複帶 Authorization
 * - 記憶體：File.slice() 串流自磁碟，不會整檔載入
 */
import { AppError } from '@/shared/errors';
import { createLogger } from '@/shared/logger';
import { DriveAuth } from '@/core/auth/DriveAuth';

const log = createLogger('drive');

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** 256KB 的倍數（resumable 規格要求） */
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DriveUploadResult {
  id: string;
  webViewLink: string | null;
}

export class DriveClient {
  #auth = new DriveAuth();

  /** 取得目前 access token（供 AI Desktop X-Gdrive-Token 重用）。 */
  getAccessToken(): Promise<string> {
    return this.#auth.getToken(false);
  }

  /** 帶 token 的 fetch；401 自動刷新重試一次 */
  async #authedFetch(url: string, init?: RequestInit, retryOn401 = true): Promise<Response> {
    const token = await this.#auth.getToken(false);
    const res = await fetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retryOn401) {
      log.warn('401 — refreshing token');
      await this.#auth.invalidate(token);
      return this.#authedFetch(url, init, false);
    }
    return res;
  }

  /** 依路徑逐層 find-or-create 資料夾，回傳最深層 folderId */
  async ensureFolderPath(segments: string[]): Promise<string> {
    let parent = 'root';
    for (const seg of segments.map((s) => s.trim()).filter(Boolean)) {
      parent = await this.#ensureFolder(seg, parent);
    }
    return parent;
  }

  async #ensureFolder(name: string, parentId: string): Promise<string> {
    const safe = name.replace(/\\/g, '').replace(/'/g, "\\'");
    const q = encodeURIComponent(
      `name='${safe}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    const found = await this.#authedFetch(`${API}/files?q=${q}&fields=files(id)&pageSize=1`);
    if (found.ok) {
      const data = (await found.json()) as { files?: { id: string }[] };
      const id = data.files?.[0]?.id;
      if (id) return id;
    }
    const created = await this.#authedFetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    });
    if (!created.ok) {
      throw new AppError('DRIVE_UPLOAD_FAILED', `create folder "${name}": HTTP ${created.status}`);
    }
    return ((await created.json()) as { id: string }).id;
  }

  /** 大檔 resumable 上傳（斷點續傳 + 指數退避） */
  async uploadResumable(opts: {
    file: Blob;
    name: string;
    parentId: string;
    mimeType: string;
    onProgress?: (fraction: number) => void;
  }): Promise<DriveUploadResult> {
    const { file, name, parentId, mimeType, onProgress } = opts;

    const init = await this.#authedFetch(
      `${UPLOAD}/files?uploadType=resumable&fields=id,webViewLink`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify({ name, parents: [parentId] }),
      },
    );
    if (!init.ok) throw new AppError('DRIVE_UPLOAD_FAILED', `init session: HTTP ${init.status}`);
    const session = init.headers.get('Location');
    if (!session) throw new AppError('DRIVE_UPLOAD_FAILED', 'no resumable session URL');

    let offset = 0;
    let retries = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_BYTES, file.size);
      let res: Response | null = null;
      try {
        res = await fetch(session, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` },
          body: file.slice(offset, end),
        });
      } catch {
        res = null; // 網路錯誤 → 走退避 + 斷點查詢
      }

      if (res?.status === 308) {
        offset = this.#nextOffset(res, end);
        retries = 0;
        onProgress?.(offset / file.size);
      } else if (res?.ok) {
        onProgress?.(1);
        const data = (await res.json()) as { id: string; webViewLink?: string };
        log.info('upload complete:', name);
        return { id: data.id, webViewLink: data.webViewLink ?? null };
      } else if (res && [400, 401, 403, 404].includes(res.status)) {
        throw new AppError('DRIVE_UPLOAD_FAILED', `HTTP ${res.status}`);
      } else {
        if (++retries > MAX_RETRIES) {
          throw new AppError('DRIVE_UPLOAD_FAILED', `max retries (${MAX_RETRIES}) exceeded`);
        }
        const backoff = Math.min(30_000, 1000 * 2 ** retries);
        log.warn(`chunk failed — backoff ${backoff}ms then resume (attempt ${retries})`);
        await sleep(backoff);
        offset = await this.#queryOffset(session, file.size, offset);
      }
    }
    throw new AppError('DRIVE_UPLOAD_FAILED', 'upload loop ended unexpectedly');
  }

  /** 從 308 回應的 Range header 取得下一個 offset */
  #nextOffset(res: Response, fallback: number): number {
    const range = res.headers.get('Range'); // e.g. "bytes=0-8388607"
    const m = range?.match(/-(\d+)$/);
    return m?.[1] ? Number(m[1]) + 1 : fallback;
  }

  /** 向 session 查詢已接收的 byte 數（斷點續傳的關鍵） */
  async #queryOffset(session: string, total: number, fallback: number): Promise<number> {
    try {
      const res = await fetch(session, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${total}` },
      });
      if (res.status === 308) return this.#nextOffset(res, fallback);
      if (res.ok) return total;
    } catch {
      /* 查詢也失敗：用 fallback，下一輪重試 */
    }
    return fallback;
  }

  /** 小型 JSON（sidecar）multipart 一次上傳 */
  async uploadSmallJson(name: string, json: string, parentId: string): Promise<void> {
    const boundary = `wre-${Date.now()}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, parents: [parentId] })}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await this.#authedFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) log.warn(`sidecar upload failed: HTTP ${res.status}（不影響影片）`);
  }
}
