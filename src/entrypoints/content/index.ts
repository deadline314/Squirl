/**
 * Content script：在目標分頁內執行「一般網頁」擷取（讀 live DOM，支援 JS 動態內容）。
 * 薄殼——只註冊訊息處理器；真正的擷取邏輯在 core/capture。
 *
 * 重要：
 * - 不在此安裝 window 全域錯誤監聽器。content script 與宿主頁面共用同一個 window，
 *   全域 error 監聽會把「宿主頁面自己的錯誤」（例如 claude.ai 的 ResizeObserver 警告）
 *   也吞進來並誤標成擴充功能的錯誤。本擴充自己的錯誤已由 bus handler 的 try/catch
 *   與 WXT 的啟動包裝負責記錄，不需要也不應該攔截整頁的錯誤。
 * - YouTube 由 background 的 MAIN-world 注入處理（更可靠）；content script 只做網頁，
 *   萬一 background 失敗退到這裡，YouTube 會以「一般網頁」方式擷取（網址＋可見文字）。
 */
import { defineContentScript } from '#imports';
import { registerHandlers } from '@/messaging/bus';
import { SourceRouter } from '@/core/capture/SourceRouter';
import type { CaptureOptions } from '@/core/capture/ContentSource';
import { loadSettings } from '@/shared/settings';
import { AppError } from '@/shared/errors';
import { createLogger } from '@/shared/logger';

const log = createLogger('content');

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const router = new SourceRouter();

    registerHandlers('content', {
      'content/ping': () => 'pong' as const,
      'content/capture': async ({ scope }) => {
        const s = await loadSettings();
        const opts: CaptureOptions = {
          scope,
          settleQuietMs: s.capture.settleQuietMs,
          settleMaxMs: s.capture.settleMaxMs,
          scrollToLoad: s.capture.scrollToLoad,
          preferredLangs: s.youtube.preferredLangs,
          saveSubtitles: s.youtube.saveSubtitles,
        };
        const source = router.resolve(location.href);
        const result = await source.capture(opts);
        if (!result.tree.length && !(result.youtube && result.youtube.videoId)) {
          throw new AppError('EMPTY_CONTENT', 'no extractable content');
        }
        return result;
      },
    });

    log.debug('content handlers ready');
  },
});
