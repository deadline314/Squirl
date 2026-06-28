/**
 * @deprecated 已由 playerResponse.ts（純解析）+ captureYouTube.ts（極小注入函式）取代。
 * 先前在此放「含多個巢狀函式的大型注入函式」，打包序列化不穩，會導致「讀不到影片資訊」。
 * 保留檔案僅為相容；型別請改從 playerResponse.ts 匯入。
 */
export type { YtCue, YtCaption, YtProgressive, ParsedYt, ParseOpts } from './playerResponse';
