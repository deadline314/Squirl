/**
 * 內容來源抽象（擴充點）。
 * 新增「YouTube / 一般網頁 / 未來 Podcast / 線上 PDF」只需補一個實作並在 SourceRouter 註冊。
 * core 不依賴任何 UI 或瀏覽器擴充 API；DOM 存取只發生在 content script 執行的實作內。
 */

export type SourceKind = 'youtube' | 'webpage';

/** 擷取範圍：整頁主內容，或使用者反白的選取範圍 */
export type CaptureScope = 'page' | 'selection';

/** 階層式內容樹節點（忠實反映原文結構，而非攤平文字） */
export interface ContentNode {
  type:
    | 'heading'
    | 'paragraph'
    | 'list'
    | 'listitem'
    | 'table'
    | 'code'
    | 'quote'
    | 'image'
    | 'divider'
    | 'section';
  /** heading 階層 (1–6)；section 巢狀深度 */
  level?: number;
  text?: string;
  /** list 是否有序 */
  ordered?: boolean;
  /** code 語言（若可得） */
  lang?: string;
  /** table：第一列視為表頭 */
  rows?: string[][];
  /** image */
  src?: string;
  alt?: string;
  /** 巢狀（section / list / listitem） */
  children?: ContentNode[];
}

/** YouTube 字幕軌 */
export interface CaptionTrack {
  lang: string; // BCP-47，如 zh-Hant、en
  name: string; // 顯示名稱
  /** 是否自動產生（ASR） */
  auto: boolean;
  /** 已下載的純文字（連續，去時間碼）；下載失敗為 undefined */
  text?: string;
  /** 已下載的時間碼片段（給 srt/vtt 用） */
  cues?: CaptionCue[];
}

export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * 可下載的影片畫質變體。
 * v1 只填 progressive（已合併音視訊、可直接下載）；DASH 分離串流（需合併）留 v2。
 */
export interface VideoVariantInfo {
  itag: number;
  /** 顯示用畫質標籤，如 720p、360p */
  label: string;
  container: string; // mp4 / webm
  ext: string; // mp4 / webm
  width?: number;
  height?: number;
  sizeBytes?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  /** 直連下載網址（短效；僅存在於 background 記憶體，不寫入 sidecar） */
  url?: string;
}

export interface YouTubeMeta {
  videoId: string;
  channel?: string;
  durationSec?: number;
  thumbnail?: string;
  chapters?: { title: string; startSec: number }[];
  captions: CaptionTrack[];
  /** ⚠ v2 預留 */
  video?: VideoVariantInfo[];
}

export interface CaptureResult {
  kind: SourceKind;
  url: string;
  title: string;
  capturedAt: string; // ISO UTC
  lang?: string;
  byline?: string; // 作者／頻道
  excerpt?: string;
  /** 階層式內容（一般網頁主體；YouTube 則為描述/章節等可選） */
  tree: ContentNode[];
  youtube?: YouTubeMeta;
  /** 降級提示（不致命，提示使用者內容可能不完整） */
  warnings?: string[];
}

export interface CaptureOptions {
  scope: CaptureScope;
  /** 動態內容穩定判定：連續無變動毫秒 */
  settleQuietMs: number;
  /** 等待動態內容最長上限 */
  settleMaxMs: number;
  scrollToLoad: boolean;
  /** YouTube 字幕偏好語言 */
  preferredLangs: string[];
  saveSubtitles: boolean;
}

/** 內容來源擴充點 */
export interface ContentSource {
  readonly kind: SourceKind;
  matches(url: string): boolean;
  capture(opts: CaptureOptions): Promise<CaptureResult>;
}

export const nowIso = (): string => new Date().toISOString();
