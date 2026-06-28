/**
 * @deprecated v0.1 暫時移除。
 *
 * 原本用 pdf-lib 在 background 產生 PDF，但 pdf-lib 體積龐大且在模組載入時做
 * pako-inflate + JSON.parse，會讓 Manifest V3 的 service worker 過大／評估失敗
 * （Service worker registration failed），導致整個擴充功能無法啟動。
 *
 * 同時 pdf-lib 內建字型不支援 CJK，對中文內容也無法正確輸出。
 *
 * 後續會以「service worker 安全」的方式重新加入 PDF：
 *  - 方案 A：chrome.debugger + Page.printToPDF（需把 debugger 放進 permissions，
 *    會有安裝警告與偵錯提示列；'debugger' 無法作為 optional permission）。
 *  - 方案 B：內嵌 CJK 子集字型 + pdf-lib，並改在 offscreen / 動態載入，避免 SW 變大。
 *
 * 目前 PDF 會自動退回 Markdown（見 ExporterRegistry.resolvePrimary）。
 */
export {};
