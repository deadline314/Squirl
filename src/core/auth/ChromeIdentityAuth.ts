/**
 * Chrome 身分驗證 adapter（chrome.identity）。
 * 跨瀏覽器擴充點：Firefox 之後補一個 launchWebAuthFlow 實作即可。
 */
import { AppError } from '@/shared/errors';

export class ChromeIdentityAuth {
  /** manifest 是否已填入有效的 OAuth client ID */
  isConfigured(): boolean {
    const manifest = chrome.runtime.getManifest() as { oauth2?: { client_id?: string } };
    const id = manifest.oauth2?.client_id ?? '';
    return id.length > 0 && !id.startsWith('REPLACE');
  }

  /**
   * 取得 access token。interactive=true 時可能跳出 Google 同意畫面。
   * Chrome 自行處理 token 快取與刷新。
   */
  getToken(interactive: boolean): Promise<string> {
    if (!this.isConfigured()) {
      return Promise.reject(new AppError('DRIVE_NOT_CONFIGURED', 'oauth2.client_id not set'));
    }
    return new Promise((resolve, reject) => {
      try {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          const err = chrome.runtime.lastError;
          if (err || !token) {
            reject(new AppError('DRIVE_AUTH_FAILED', err?.message ?? 'no token returned'));
          } else {
            resolve(token as string);
          }
        });
      } catch (e) {
        reject(new AppError('DRIVE_AUTH_FAILED', e instanceof Error ? e.message : String(e)));
      }
    });
  }

  /** token 失效（401）時清除快取，下次 getToken 會拿到新的 */
  invalidate(token: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  /** 已登入帳號的 email（需要 identity.email 權限；拿不到回 null，不影響功能） */
  getEmail(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        chrome.identity.getProfileUserInfo(
          { accountStatus: 'ANY' } as chrome.identity.ProfileDetails,
          (info) => resolve(info?.email || null),
        );
      } catch {
        resolve(null);
      }
    });
  }
}
