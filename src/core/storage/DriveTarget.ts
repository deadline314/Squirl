/**
 * Drive 儲存目的地：包裝 DriveClient（resumable 上傳 + 斷點續傳）。
 * - AI Desktop 模式：直接用後端給的 folderId（連動資料夾）
 * - 一般模式：依 folderPath find-or-create
 *
 * 容錯由 DriveClient 提供（指數退避、401 刷新、斷點續傳）；此層只負責路由與資料夾解析。
 */
import { DriveClient } from './drive/DriveClient';
import { type PutContext, type StorageTarget, type StoredRef } from './StorageTarget';
import type { ExportArtifact } from '../export/Exporter';

export class DriveTarget implements StorageTarget {
  readonly id = 'drive' as const;
  #client = new DriveClient();

  async put(artifact: ExportArtifact, ctx: PutContext, onProgress?: (f: number) => void): Promise<StoredRef> {
    const folderId = await this.#resolveFolder(ctx);
    const res = await this.#client.uploadResumable({
      file: artifact.blob,
      name: artifact.fileName,
      parentId: folderId,
      mimeType: artifact.mimeType || 'application/octet-stream',
      onProgress,
    });
    return { id: res.id, folderId, webViewLink: res.webViewLink };
  }

  /** 取得目前 Drive 帳號 email（顯示用；拿不到回 null） */
  async getToken(): Promise<string> {
    // 供 orchestrator 取得 token 傳給 AI Desktop（X-Gdrive-Token）
    return this.#client.getAccessToken();
  }

  async #resolveFolder(ctx: PutContext): Promise<string> {
    if (ctx.folderId) return ctx.folderId;
    if (ctx.folderPath && ctx.folderPath.length) return this.#client.ensureFolderPath(ctx.folderPath);
    return 'root';
  }
}
