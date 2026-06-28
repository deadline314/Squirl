/**
 * 本機下載目的地（chrome.downloads）。
 * 後備路徑：Drive 未設定/上傳失敗時保證「至少存到本機」。
 *
 * 重要：Manifest V3 的 service worker **沒有** `URL.createObjectURL`（它需要 document 環境），
 * 直接用 blob URL 會在背景丟錯、整個本機儲存失敗（先前「網頁也存不了」的根因）。
 * 因此改用 data: URL（base64）交給 downloads API——對 MD/Text/sidecar/字幕 這類文字檔
 * 完全足夠，且不依賴 document。大型二進位（影片）走的是直接 URL 下載，不經這裡。
 */
import { AppError } from '@/shared/errors';
import { createLogger } from '@/shared/logger';
import { type PutContext, type StorageTarget, type StoredRef } from './StorageTarget';
import type { ExportArtifact } from '../export/Exporter';

const log = createLogger('local');

export class LocalDownloadTarget implements StorageTarget {
  readonly id = 'local' as const;

  async put(artifact: ExportArtifact, ctx: PutContext): Promise<StoredRef> {
    const subdir = (ctx.folderPath ?? []).join('/');
    const path = subdir ? `${subdir}/${artifact.fileName}` : artifact.fileName;
    try {
      const url = await blobToDataUrl(artifact.blob);
      const id = await new Promise<number>((resolve, reject) => {
        chrome.downloads.download({ url, filename: sanitizePath(path), conflictAction: 'uniquify', saveAs: false }, (downloadId) => {
          const err = chrome.runtime.lastError;
          if (err || downloadId === undefined) reject(new AppError('DOWNLOAD_FAILED', err?.message ?? 'download failed'));
          else resolve(downloadId);
        });
      });
      return { id: String(id), folderId: subdir, webViewLink: null };
    } catch (e) {
      log.warn('local download failed', e);
      throw e instanceof AppError ? e : new AppError('DOWNLOAD_FAILED', e instanceof Error ? e.message : String(e));
    }
  }
}

/** Blob → data: URL（base64）。SW 安全，不需要 document / createObjectURL。 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000; // 分段避免 String.fromCharCode 參數過多
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${btoa(bin)}`;
}

function sanitizePath(path: string): string {
  return path
    .split('/')
    .map((seg) => seg.replace(/[<>:"\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('/');
}
