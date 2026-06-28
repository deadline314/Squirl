/**
 * 統一錯誤碼與錯誤型別。
 * 所有跨 context 傳遞的錯誤都序列化為 { code, message }，
 * UI 依 code 顯示使用者可讀訊息。
 */

export type ErrCode =
  // 通用
  | 'INVALID_STATE'
  | 'TIMEOUT'
  | 'NO_RESPONSE'
  | 'NO_HANDLER'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN'
  // 擷取
  | 'RESTRICTED_PAGE' // chrome://、商店等不可注入頁
  | 'INJECT_FAILED' // content script 注入失敗
  | 'CAPTURE_FAILED' // 擷取過程錯誤
  | 'EMPTY_CONTENT' // 抓不到任何內容
  | 'YT_NO_CAPTIONS' // YouTube 無字幕（非致命，多為 warning）
  | 'YT_PARSE_FAILED' // YouTube player response 解析失敗
  // 匯出
  | 'EXPORT_FAILED'
  | 'PDF_FAILED'
  // 儲存
  | 'DOWNLOAD_FAILED'
  | 'DRIVE_NOT_CONFIGURED'
  | 'DRIVE_AUTH_FAILED'
  | 'DRIVE_UPLOAD_FAILED'
  // AI Desktop
  | 'AIDESKTOP_UNREACHABLE'
  | 'AIDESKTOP_INGEST_FAILED';

export class AppError extends Error {
  constructor(
    public readonly code: ErrCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface SerializedError {
  code: ErrCode;
  message: string;
}

/** 任意 thrown 值 → 可序列化錯誤（容錯：永不再 throw） */
export function serializeError(e: unknown): SerializedError {
  if (e instanceof AppError) return { code: e.code, message: e.message };
  if (e instanceof Error) return { code: 'UNKNOWN', message: `${e.name}: ${e.message}` };
  return { code: 'UNKNOWN', message: String(e) };
}

/** code → 使用者可讀訊息（zh-TW；UI 可再做 i18n 對應） */
export const ERROR_MESSAGES: Record<ErrCode, string> = {
  INVALID_STATE: '狀態異常，請重試。',
  TIMEOUT: '操作逾時，請重試。',
  NO_RESPONSE: '沒有收到回應。',
  NO_HANDLER: '找不到處理器。',
  NOT_IMPLEMENTED: '此功能即將推出。',
  UNKNOWN: '發生未知錯誤。',
  RESTRICTED_PAGE: '此頁面不支援剪存（瀏覽器限制頁）。',
  INJECT_FAILED: '無法在此頁面執行擷取。',
  CAPTURE_FAILED: '擷取內容時發生錯誤。',
  EMPTY_CONTENT: '這個頁面沒有可擷取的內容。',
  YT_NO_CAPTIONS: '這部影片沒有可用字幕。',
  YT_PARSE_FAILED: '無法解析 YouTube 影片資訊，已改存網址與基本資料。',
  EXPORT_FAILED: '產生檔案時發生錯誤。',
  PDF_FAILED: '產生 PDF 失敗，已嘗試其他格式。',
  DOWNLOAD_FAILED: '下載到本機失敗。',
  DRIVE_NOT_CONFIGURED: '尚未設定 Google Drive 連線。',
  DRIVE_AUTH_FAILED: 'Google Drive 授權失敗。',
  DRIVE_UPLOAD_FAILED: '上傳到 Google Drive 失敗，已保留本機檔案。',
  AIDESKTOP_UNREACHABLE: '連不上 AI Desktop（檔案已存到 Drive，稍後會自動補處理）。',
  AIDESKTOP_INGEST_FAILED: 'AI Desktop 排程失敗（檔案已存到 Drive，稍後會自動補處理）。',
};

export function messageFor(code: ErrCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN;
}
