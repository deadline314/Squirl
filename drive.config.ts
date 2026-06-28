/**
 * Google Drive OAuth 設定（與 Capyture 一致）。
 *
 * 安全設計：預設「不」在程式碼中內建任何 client ID——
 * 使用者在 設定 → Drive 連線（進階） 自行貼入，
 * ID 以 AES-GCM 加密後僅存於本機（chrome.storage.local），UI 不回顯完整值。
 *
 * 發佈者若要為商店版內建 client ID（走 chrome.identity.getAuthToken），
 * 可在建置前填入下方常數；注意 manifest 中的 oauth2.client_id 必然是明文，
 * 這是 Chrome 的限制，也是 OAuth 規範中 client ID 本就屬公開識別碼的原因。
 */
export const DRIVE_CLIENT_ID = 'REPLACE_ME.apps.googleusercontent.com';

/**
 * drive.file：最小權限——只能存取「本擴充功能自己建立」的檔案與資料夾。
 */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
