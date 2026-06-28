/**
 * 儲存目的地抽象（擴充點）。
 * 新增 Dropbox / S3 / 本機資料夾 = 補一個 StorageTarget 實作。
 */
import type { ExportArtifact } from '../export/Exporter';

export interface StoredRef {
  id: string;
  /** 所在資料夾（Drive folderId；本機為子資料夾名） */
  folderId: string;
  webViewLink: string | null;
}

export interface PutContext {
  /** 目標資料夾路徑（segments）或 Drive folderId */
  folderId?: string;
  folderPath?: string[];
}

export interface StorageTarget {
  readonly id: 'drive' | 'local';
  put(artifact: ExportArtifact, ctx: PutContext, onProgress?: (fraction: number) => void): Promise<StoredRef>;
}
