/**
 * @deprecated v0.1 暫時移除。
 *
 * 原本用 chrome.debugger + Page.printToPDF 產生 PDF。但 Chrome 不允許 'debugger'
 * 作為 optional permission（會被忽略並出現警告："Permission 'debugger' cannot be
 * listed as optional"），因此這條路徑需要把 debugger 放進固定 permissions，
 * 會帶來安裝警告與偵錯提示列。先移除，待之後再依需求評估是否加回。
 */
export {};
