# Squirl — TODO（分階段里程碑）

> 設計依據見 `ARCHITECTURE.md`。原則：**先讓人用（無腦一鍵）→ 被嫌 → 再加東西**（Daniel 節奏）。
> 每一步都遵守：高擴充、高穩定、高容錯、好錯誤捕捉、低記憶體、做好抽象、不破壞原有功能。
>
> 狀態圖例：`[ ]` 待辦　`[~]` 進行中　`[x]` 完成　`⚠` 風險/需注意　`★` MVP 必要

---

## M0 — 地基（共用層）
- [x] ★ 專案骨架：`package.json` / `wxt.config.ts` / `tsconfig` / `svelte.config` / `drive.config.ts`
- [x] ★ manifest：權限、context menu、popup、options（最小權限原則）
- [x] ★ `shared/logger.ts`、`shared/errors.ts`（擴充 clipper 錯誤碼）、`shared/secrets.ts`（沿用 Capyture）
- [x] ★ `shared/settings.ts`：schema 版本化 + 預設值合併 + 讀取永不 throw
- [x] ★ `messaging/protocol.ts` + `messaging/bus.ts`（帶 timeout 的型別安全收發）
- [x] ★ 沿用 `core/auth/DriveAuth.ts`、`ChromeIdentityAuth.ts`、`core/storage/drive/DriveClient.ts`
- [x] `shared/i18n.ts`（zh-TW / en）、`_locales`

## M1 — 最小可用：右鍵 → 一般網頁 → Markdown → 本機 ★
- [x] ★ `core/capture/ContentSource.ts`：型別與介面（CaptureResult / ContentNode）
- [x] ★ `core/capture/dom/readability.ts`：主內容偵測（含 body 後備）
- [x] ★ `core/capture/dom/blockify.ts`：DOM → 結構化區塊（heading/段落/list/**table**/code/quote/image）
- [x] ★ `core/capture/dom/settle.ts`：MutationObserver 等動態內容穩定 + 逾時保底
- [x] ★ `core/capture/WebpageExtractor.ts`：組裝 → 階層式 ContentTree
- [x] ★ `core/export/Exporter.ts` + `MarkdownExporter.ts`（表格保留、階層縮排）
- [x] ★ `core/storage/StorageTarget.ts` + `LocalDownloadTarget.ts`
- [x] ★ `entrypoints/content/index.ts`：SourceRouter + 擷取，回傳 background
- [x] ★ `entrypoints/background.ts`：context menu 註冊 + `ClipOrchestrator` 串流程 + 通知
- [x] ★ `core/orchestrator/ClipOrchestrator.ts` + `ClipJob.ts`（狀態機 + 單一 job 鎖）
- [ ] 手動測試：一般文章站、含表格頁、SPA 動態頁、受限頁（chrome://）皆正確/正確降級

## M2 — Drive 直傳 + AI Desktop ingest（KB）+ sidecar ★
- [x] ★ `core/storage/DriveTarget.ts`：包裝 DriveClient（ensureFolderPath + uploadResumable）
- [x] ★ `core/export/sidecar.ts`：產生 `squirl/clip-meta@1`
- [x] ★ `core/aidesktop/AiDesktopClient.ts`：health / linkedFolders / createFolder / **notifyIngest**
- [x] ★ orchestrator 串入：Drive 主檔 → 並行 sidecar → notifyIngest（best-effort）
- [x] ★ 容錯：Drive 失敗退本機、ingest 失敗只記 log、token 401 靜默刷新
- [ ] ⚠ 與後端對齊 `source_type=web_clip`、回應 schema（M2 驗收前需後端 health 可達）

## M3 — YouTube（URL + 字幕 + metadata）★
- [x] ★ `core/capture/youtube/YouTubeExtractor.ts`：videoId/標題/頻道/時長/章節/縮圖
- [x] ★ `core/capture/youtube/captions.ts`：列字幕軌 + 下載（player response → timedtext）
- [x] ★ `core/export/SubtitleExporter.ts`：→ `.srt` / `.vtt`
- [x] ★ SourceRouter 接 YouTube；右鍵在 YouTube 頁顯示「字幕」選項
- [x] ★ 字幕純文字併入 sidecar 供 KB 索引
- [x] ★ 容錯：無字幕/改版 → 退只存 URL + metadata（warning）
- [x] ⚠ `core/capture/youtube/VideoDownloader.ts`：**介面 + NotImplemented stub**（v1 不實作下載，僅預留）
- [ ] 手動測試：有字幕/無字幕/多語字幕/直播/會員片 的降級行為

## M4 — 多格式與順手強化
- [x] `core/export/TextExporter.ts`（純文字，縮排表達階層）
- [x] `core/export/PdfExporter.ts`：策略 A（`Page.printToPDF` via debugger）+ 策略 B（pdf-lib）後備
- [x] 右鍵「剪存為…」次選單（MD/Text/PDF/字幕）
- [x] 選取片段剪存（`info.selectionText` + range 擷取，跨容器退整頁）
- [x] popup 補 tag / project（輕量、可空，不打斷）
- [x] ★ 行事曆標記：ingest 帶 `calendar.mark/duration_min/kind=clip_marker`；設定頁可關
- [ ] 自動去重：後端回 `duplicate` 的 UI 呈現

## M5 — 設定頁與打磨
- [x] `entrypoints/options`：匯出格式預設、Drive 連線、AI Desktop 連線（網址+資料夾+行事曆開關）、YouTube 偏好語言、PDF 策略
- [x] `entrypoints/popup`：快速剪存、最近紀錄、失敗重試
- [ ] 快捷鍵 `chrome.commands`（Alt+Shift+S 一鍵剪存）
- [ ] 剪存歷史與重試中心（storage.local 環狀紀錄）
- [ ] 隱私白/黑名單（敏感網域不出現在選單）
- [ ] 批次剪存目前視窗所有分頁（進階）
- [ ] README / SETUP-DRIVE / SETUP-AIDESKTOP 文件

## M6 — 後期：YouTube 影片下載 ⚠（v1 不做，僅設計預留）
- [ ] ⚠ `VideoDownloader` 真實作：解析 player response 取 DASH adaptiveFormats
- [ ] ⚠ 畫質/檔案大小選單（讀 `VideoVariantInfo[]`，含 sizeBytes 估算）
- [ ] ⚠ 音視訊合併：`ffmpeg.wasm` **lazy-load**（僅下載影片時載入，平時零記憶體）
- [ ] ⚠ 大檔直接串流落 Drive resumable，不整檔進記憶體
- [ ] ⚠ ToS / 合規確認；可能限定有授權內容或公司用途
- [ ] 進度顯示、可取消、斷點續傳

---

## 跨里程碑：品質關卡（每個 PR 都要過）
- [ ] `npm run compile`（svelte-check / tsc）無錯
- [ ] `wxt build` 成功，載入 `.output/chrome-mv3` 可跑
- [ ] 容錯路徑手測：斷網、token 過期、受限頁、後端不可達 → 皆優雅降級且**檔案不丟**
- [ ] 記憶體：大頁面 / 長字幕剪存後記憶體回穩（無洩漏）
- [ ] 不破壞原有功能：新增來源/格式/目的地只透過註冊，不改核心流程

## 已知風險與待確認（呼應 ARCHITECTURE §15）
- [ ] 後端是否支援 `source_type=web_clip` 與 `calendar.kind=clip_marker`（欄位向後相容，但需後端讀取）
- [ ] 行事曆是否獨立曆／顏色，方便 filter
- [ ] KB 去重鍵定義
- [ ] PDF 策略 A 需 `debugger` 權限，attach 時分頁有提示列——是否可接受，或預設用策略 B
