/**
 * ⚠ v2 預留：YouTube 影片本體下載。
 *
 * v1 不實作下載——介面與型別先定義好，讓畫質/檔案大小選單與 orchestrator
 * 之後接上時，核心流程不需改動（開放封閉原則）。
 *
 * 為何延後（見 ARCHITECTURE §7.3）：
 * YouTube 走 DASH，畫面與聲音為分離串流，下載需解析 player response、
 * 處理簽章/節流，再用 ffmpeg.wasm 合併——記憶體與複雜度高且涉 ToS 風險。
 * v2 落地時：ffmpeg.wasm 採 lazy-import（僅下載時載入），大檔串流落 Drive resumable。
 */
import { AppError } from '@/shared/errors';
import type { VideoVariantInfo } from '../ContentSource';

export interface VideoDownloadRequest {
  videoId: string;
  /** 目標畫質（如 '1080p'）或 itag */
  quality?: string;
  itag?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface VideoDownloader {
  /** 列出可下載的畫質變體（含估算檔案大小） */
  listVariants(videoId: string): Promise<VideoVariantInfo[]>;
  /** 下載（並於需要時合併音視訊）成單一 Blob */
  download(req: VideoDownloadRequest): Promise<Blob>;
}

/** v1 佔位實作：呼叫即明確回報「尚未實作」，UI 對應顯示「即將推出」。 */
export class NotImplementedVideoDownloader implements VideoDownloader {
  async listVariants(): Promise<VideoVariantInfo[]> {
    return [];
  }
  async download(): Promise<Blob> {
    throw new AppError('NOT_IMPLEMENTED', 'YouTube video download is planned for v2.');
  }
}
