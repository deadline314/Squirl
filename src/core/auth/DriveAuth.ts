/**
 * Drive OAuth 統一入口，自動選擇驗證路徑：
 * - manifest 模式：發佈者內建 oauth2.client_id → chrome.identity.getAuthToken
 * - custom 模式：使用者自貼的 client ID（加密存本機）→ launchWebAuthFlow
 *   （getAuthToken 只認 manifest 的 ID，執行期 ID 必須走 WebAuthFlow）
 *
 * custom 模式 token 快取在 chrome.storage.session（瀏覽器關閉即清除），
 * 過期前 60 秒視為失效；先嘗試靜默刷新，需要時才跳互動授權。
 */
import { AppError } from '@/shared/errors';
import { createLogger } from '@/shared/logger';
import { loadSecret } from '@/shared/secrets';
import { DRIVE_SCOPES } from '../../../drive.config';
import { ChromeIdentityAuth } from './ChromeIdentityAuth';

const log = createLogger('drive-auth');

const TOKEN_CACHE_KEY = 'drive-webauth-token';
export const DRIVE_CLIENT_ID_SECRET = 'driveClientId';

interface CachedToken {
  token: string;
  expiresAt: number;
}

export type DriveAuthMode = 'manifest' | 'custom' | 'none';

export class DriveAuth {
  #manifest = new ChromeIdentityAuth();

  async mode(): Promise<DriveAuthMode> {
    if (this.#manifest.isConfigured()) return 'manifest';
    if (await loadSecret(DRIVE_CLIENT_ID_SECRET)) return 'custom';
    return 'none';
  }

  async getToken(interactive: boolean): Promise<string> {
    const mode = await this.mode();
    if (mode === 'manifest') return this.#manifest.getToken(interactive);
    if (mode === 'none') throw new AppError('DRIVE_NOT_CONFIGURED', 'no client id available');
    return this.#webToken(interactive);
  }

  /** token 失效（401）時呼叫：清除快取讓下次重取 */
  async invalidate(token: string): Promise<void> {
    await chrome.storage.session.remove(TOKEN_CACHE_KEY).catch(() => {});
    if (this.#manifest.isConfigured()) await this.#manifest.invalidate(token);
  }

  /** 顯示用 email：custom 模式拿不到授權帳號，回 null（UI 顯示通用文案） */
  async getEmail(): Promise<string | null> {
    return (await this.mode()) === 'manifest' ? this.#manifest.getEmail() : null;
  }

  async #webToken(interactive: boolean): Promise<string> {
    const cached = await this.#readCache();
    if (cached) return cached;
    const clientId = await loadSecret(DRIVE_CLIENT_ID_SECRET);
    if (!clientId) throw new AppError('DRIVE_NOT_CONFIGURED', 'client id missing');
    try {
      return await this.#flow(clientId, false); // 先靜默
    } catch (silent) {
      if (!interactive) {
        throw silent instanceof AppError ? silent : new AppError('DRIVE_AUTH_FAILED', String(silent));
      }
      return this.#flow(clientId, true);
    }
  }

  async #readCache(): Promise<string | null> {
    try {
      const res = await chrome.storage.session.get(TOKEN_CACHE_KEY);
      const cached = res[TOKEN_CACHE_KEY] as CachedToken | undefined;
      if (cached?.token && cached.expiresAt > Date.now()) return cached.token;
    } catch {
      /* session storage 不可用：直接走 flow */
    }
    return null;
  }

  #flow(clientId: string, interactive: boolean): Promise<string> {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: DRIVE_SCOPES.join(' '),
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Promise((resolve, reject) => {
      try {
        chrome.identity.launchWebAuthFlow({ url, interactive }, (redirect) => {
          const err = chrome.runtime.lastError;
          if (err || !redirect) {
            reject(new AppError('DRIVE_AUTH_FAILED', err?.message ?? 'auth flow cancelled'));
            return;
          }
          // token 在 fragment：#access_token=...&expires_in=...
          const frag = new URLSearchParams(redirect.split('#')[1] ?? '');
          const token = frag.get('access_token');
          const expiresIn = Number(frag.get('expires_in') ?? 3600);
          if (!token) {
            reject(new AppError('DRIVE_AUTH_FAILED', frag.get('error') ?? 'no access_token in redirect'));
            return;
          }
          const cached: CachedToken = { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
          void chrome.storage.session.set({ [TOKEN_CACHE_KEY]: cached }).catch(() => {});
          log.info('web auth token acquired');
          resolve(token);
        });
      } catch (e) {
        reject(new AppError('DRIVE_AUTH_FAILED', e instanceof Error ? e.message : String(e)));
      }
    });
  }
}
