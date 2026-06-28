# Google Drive 直傳設定

Drive 功能**預設關閉**，程式碼中不內建任何 client ID。Client ID 以 AES-GCM 加密後僅存本機，
介面只顯示前 6 碼。採 `drive.file` 最小權限（僅能存取本擴充自己建立的檔案）。

## 方式 A：使用者自備 Client ID（推薦，免改程式碼）

1. [Google Cloud Console](https://console.cloud.google.com/) → 建立專案 → 啟用 **Google Drive API**
2. OAuth 同意畫面（External、加入 `drive.file` scope、把自己加入 Test users）
3. 「憑證」→ 建立 OAuth 用戶端 ID → 類型選「**網頁應用程式**」
   - 已授權的重新導向 URI 填：`https://<你的擴充功能ID>.chromiumapp.org/`
     （擴充功能 ID 在 `chrome://extensions` 可見；設定變更生效可能要數分鐘）
4. 擴充功能 → ⚙ 設定 → Google Drive → 開啟「啟用 Drive 連線」→ 貼上 Client ID → 「儲存 ID」
5. 按「連線帳號」（走 `launchWebAuthFlow`）→ 勾「剪存後直傳 Drive」

## 方式 B：發佈者內建（商店版，選用）

把 Client ID 填入根目錄 `drive.config.ts`（類型選「Chrome 擴充功能」、填 extension ID），
`npm run build` 後重新載入。注意 client ID 會以明文出現在 manifest（`getAuthToken` 的限制）。

## 行為摘要

- 剪存 → （Drive 可用時）直傳 → 成功顯示「在 Drive 開啟」；失敗自動退本機下載，**不影響已擷取內容**。
- 上傳走 8MB 分段、斷網自動續傳、最多重試 5 次、token 過期靜默刷新。
- `.meta.json` sidecar 與字幕一併上傳（若啟用）。
