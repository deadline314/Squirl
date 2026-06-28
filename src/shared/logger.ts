/**
 * 分級 logger。production 預設只輸出 warn 以上，
 * 開發時 (import.meta.env.DEV) 全開。零依賴、零成本抽象。
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: Level = import.meta.env.DEV ? 'debug' : 'warn';

export function setLogLevel(level: Level): void {
  minLevel = level;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * 安裝全域錯誤攔截：任何未捕捉的例外 / Promise rejection 都會被記到 console，
 * 確保「沒有任何錯誤是靜默消失的」。冪等（重複呼叫不會重複註冊）。
 */
let globalInstalled = false;
export function installGlobalErrorLogging(scope: string): void {
  if (globalInstalled) return;
  globalInstalled = true;
  const log = createLogger(scope);
  try {
    self.addEventListener('error', (e: ErrorEvent) => {
      log.error('uncaught error:', e.message, e.error ?? '', e.filename ? `@${e.filename}:${e.lineno}` : '');
    });
    self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      log.error('unhandled rejection:', e.reason);
    });
  } catch (err) {
    // 某些 context 無 self/addEventListener：略過，不影響功能
    console.warn(`[${scope}] installGlobalErrorLogging skipped`, err);
  }
}

export function createLogger(scope: string): Logger {
  const emit =
    (level: Level, fn: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
      fn(`[${scope}]`, ...args);
    };
  return {
    debug: emit('debug', console.debug),
    info: emit('info', console.info),
    warn: emit('warn', console.warn),
    error: emit('error', console.error),
  };
}
