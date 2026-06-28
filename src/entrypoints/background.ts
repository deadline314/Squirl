/**
 * Background service worker：
 * - 建立／路由右鍵選單與快捷鍵
 * - 宿主 ClipOrchestrator（擷取→匯出→儲存→通知）
 * - 處理 popup / options 的請求（Drive、AI Desktop 連線）
 * - 廣播進度給 popup、顯示系統通知
 *
 * 容錯：所有 handler 例外都被 bus 序列化回報；選單/通知失敗一律 swallow。
 */
import { defineBackground } from '#imports';
import { broadcastToPopup, registerHandlers } from '@/messaging/bus';
import { createT } from '@/shared/i18n';
import { createLogger, installGlobalErrorLogging } from '@/shared/logger';
import { loadSettings } from '@/shared/settings';
import type { CaptureScope } from '@/core/capture/ContentSource';
import type { ClipRequest, ClipSnapshot, LinkedFolder } from '@/messaging/protocol';
import { ClipOrchestrator, type ClipNotification } from '@/core/orchestrator/ClipOrchestrator';
import { probeYouTube } from '@/core/capture/youtube/captureYouTube';
import { getHistoryEntry, loadHistory } from '@/core/orchestrator/ClipJob';
import { DriveAuth, DRIVE_CLIENT_ID_SECRET } from '@/core/auth/DriveAuth';
import { clearSecret, loadSecret, saveSecret } from '@/shared/secrets';
import {
  createLinkedFolder,
  ensureHostPermission,
  fetchLinkedFolders,
  normalizeBaseUrl,
  probeHealth,
} from '@/core/aidesktop/AiDesktopClient';

const log = createLogger('bg');

const MENU = {
  default: 'squirl-clip-default',
  parent: 'squirl-clip-as',
  md: 'squirl-fmt-md',
  txt: 'squirl-fmt-txt',
  pdf: 'squirl-fmt-pdf',
  subtitle: 'squirl-fmt-subtitle',
} as const;

export default defineBackground(() => {
  installGlobalErrorLogging('bg');

  const orchestrator = new ClipOrchestrator({
    emit: (s: ClipSnapshot) => broadcastToPopup('clip/update', s),
    notify: showNotification,
  });

  // ---- 選單建立 ----
  chrome.runtime.onInstalled.addListener(() => void rebuildMenus());
  chrome.runtime.onStartup.addListener(() => void rebuildMenus());

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const scope: CaptureScope = info.selectionText ? 'selection' : 'page';
    const req: ClipRequest = { tabId: tab.id, scope };
    switch (info.menuItemId) {
      case MENU.default:
        break;
      case MENU.md:
        req.format = 'md';
        break;
      case MENU.txt:
        req.format = 'txt';
        break;
      case MENU.pdf:
        req.format = 'pdf';
        break;
      case MENU.subtitle:
        req.format = 'subtitle';
        break;
      default:
        return;
    }
    void orchestrator.run(req);
  });

  // ---- 快捷鍵 ----
  chrome.commands?.onCommand.addListener((command) => {
    if (command !== 'clip-page') return;
    void clipActiveTab(orchestrator);
  });

  // ---- 通知按鈕（在 Drive 開啟） ----
  chrome.notifications?.onButtonClicked.addListener((notifId) => {
    const link = pendingLinks.get(notifId);
    if (link) {
      void chrome.tabs.create({ url: link });
      pendingLinks.delete(notifId);
    }
  });

  // ---- 訊息處理 ----
  registerHandlers('background', {
    'clip/run': async (req) => ({ id: await orchestrator.run(req) }),
    'clip/retry': async ({ id }) => {
      const entry = await getHistoryEntry(id);
      if (!entry) return { id };
      return { id: await orchestrator.run(entry.request) };
    },
    'history/list': async () => (await loadHistory()).map((e) => e.snapshot),
    'yt/probe': async ({ tabId }) => probeYouTube(tabId),

    'drive/connect': async () => {
      const auth = new DriveAuth();
      await auth.getToken(true);
      return { email: await auth.getEmail() };
    },
    'drive/status': async () => {
      const auth = new DriveAuth();
      const mode = await auth.mode();
      const customId = await loadSecret(DRIVE_CLIENT_ID_SECRET);
      let connected = false;
      try {
        await auth.getToken(false);
        connected = true;
      } catch {
        connected = false;
      }
      return {
        configured: mode !== 'none',
        connected,
        email: await auth.getEmail(),
        hasCustomId: !!customId,
        customTail: customId ? customId.slice(0, 6) + '…' : null,
      };
    },
    'drive/setClientId': async ({ clientId }) => {
      if (clientId && clientId.trim()) await saveSecret(DRIVE_CLIENT_ID_SECRET, clientId.trim());
      else await clearSecret(DRIVE_CLIENT_ID_SECRET);
    },

    'aidesktop/health': async ({ baseUrl }) => {
      const url = normalizeBaseUrl(baseUrl);
      if (!url) return { ok: false, detail: '網址格式無效' };
      const perm = await ensureHostPermission(url);
      if (!perm.ok) return { ok: false, detail: `權限未授予（${perm.reason}）` };
      const probe = await probeHealth(url);
      return probe.ok ? { ok: true, detail: url } : { ok: false, detail: `${probe.kind}: ${probe.detail}` };
    },
    'aidesktop/folders': async ({ baseUrl }) => {
      const url = normalizeBaseUrl(baseUrl);
      if (!url) throw new Error('網址格式無效');
      await ensureHostPermission(url);
      const token = await new DriveAuth().getToken(true);
      const res = await fetchLinkedFolders(url, token);
      return res as { email: string; folders: LinkedFolder[] };
    },
    'aidesktop/createFolder': async ({ baseUrl, name }) => {
      const url = normalizeBaseUrl(baseUrl);
      if (!url) throw new Error('網址格式無效');
      await ensureHostPermission(url);
      const token = await new DriveAuth().getToken(true);
      return createLinkedFolder(url, token, name);
    },
  });

  log.info('background ready');
});

const pendingLinks = new Map<string, string>();

async function rebuildMenus(): Promise<void> {
  try {
    const s = await loadSettings();
    const t = createT(s.ui.language);
    await new Promise<void>((r) => chrome.contextMenus.removeAll(() => r()));
    const contexts: chrome.contextMenus.CreateProperties['contexts'] = ['page', 'selection', 'link', 'image', 'video'];
    chrome.contextMenus.create({ id: MENU.default, title: t('menu.clipToDrive'), contexts });
    chrome.contextMenus.create({ id: MENU.parent, title: t('menu.clipAs'), contexts });
    chrome.contextMenus.create({ id: MENU.md, parentId: MENU.parent, title: t('menu.md'), contexts });
    chrome.contextMenus.create({ id: MENU.txt, parentId: MENU.parent, title: t('menu.txt'), contexts });
    chrome.contextMenus.create({ id: MENU.pdf, parentId: MENU.parent, title: t('menu.pdf'), contexts });
    chrome.contextMenus.create({ id: MENU.subtitle, parentId: MENU.parent, title: t('menu.subtitle'), contexts });
  } catch (e) {
    log.warn('rebuildMenus failed', e);
  }
}

async function clipActiveTab(orchestrator: ClipOrchestrator): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await orchestrator.run({ tabId: tab.id, scope: 'page' });
  } catch (e) {
    log.warn('clipActiveTab failed', e);
  }
}

function showNotification(n: ClipNotification): void {
  try {
    const iconUrl = chrome.runtime.getURL('icon/128.png');
    const titleMap: Record<ClipNotification['kind'], string> = {
      saving: 'Squirl 剪存中…',
      saved: '已剪存',
      failed: '剪存失敗',
      duplicate: '已存在',
    };
    const opts: chrome.notifications.NotificationCreateOptions = {
      type: 'basic',
      iconUrl,
      title: `${titleMap[n.kind]}：${truncate(n.title, 40)}`,
      message: n.message,
    };
    if (n.webViewLink) opts.buttons = [{ title: '在 Drive 開啟' }];
    chrome.notifications.create(`squirl-${Date.now()}`, opts, (id) => {
      void chrome.runtime.lastError;
      if (id && n.webViewLink) pendingLinks.set(id, n.webViewLink);
    });
  } catch (e) {
    log.warn('notification failed', e);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
