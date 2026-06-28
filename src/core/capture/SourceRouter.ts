/**
 * 依 URL 選擇擷取器（內容來源的註冊中心，content script 用）。
 *
 * 設計：YouTube 已改由 background 的 MAIN-world 注入處理（更可靠、且不會把舊的
 * captions 解析程式打包進每個頁面）。因此這裡預設「無特化來源」，只用 WebpageExtractor。
 * 若未來要在 content world 新增來源，register 一個 ContentSource 即可——抽象不變。
 */
import type { ContentSource } from './ContentSource';
import { WebpageExtractor } from './WebpageExtractor';

export class SourceRouter {
  #specialized: ContentSource[];
  #fallback: ContentSource;

  constructor(specialized: ContentSource[] = [], fallback: ContentSource = new WebpageExtractor()) {
    this.#specialized = specialized;
    this.#fallback = fallback;
  }

  /** 註冊新的特化來源（擴充用） */
  register(source: ContentSource): void {
    this.#specialized.unshift(source);
  }

  resolve(url: string): ContentSource {
    for (const s of this.#specialized) {
      try {
        if (s.matches(url)) return s;
      } catch {
        /* matches 不該 throw，保險略過 */
      }
    }
    return this.#fallback;
  }
}
