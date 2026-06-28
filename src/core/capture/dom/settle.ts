/**
 * 等待動態內容穩定。
 * 用 MutationObserver 觀察容器；連續 quietMs 無變動視為穩定。
 * 最長 maxMs 保底——逾時就用當下狀態（容錯：絕不無限等待）。
 *
 * 記憶體：observer 一定 disconnect、計時器一定清除（finally 集中清理）。
 */
export interface SettleOptions {
  quietMs: number;
  maxMs: number;
  /** 是否捲動觸發 lazy-load（進階） */
  scrollToLoad: boolean;
}

export async function settle(target: Node, opts: SettleOptions): Promise<void> {
  const { quietMs, maxMs, scrollToLoad } = opts;
  if (scrollToLoad) await autoScroll(maxMs);

  return new Promise<void>((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      if (hardTimer) clearTimeout(hardTimer);
      observer?.disconnect();
      resolve();
    };

    const armQuiet = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };

    try {
      observer = new MutationObserver(armQuiet);
      observer.observe(target, { childList: true, subtree: true, characterData: true });
    } catch {
      // 觀察失敗（極罕見）：直接視為穩定
      resolve();
      return;
    }

    hardTimer = setTimeout(finish, maxMs);
    armQuiet(); // 若一開始就沒有變動，quietMs 後即完成
  });
}

/** 緩慢捲到底以觸發 lazy-load，再捲回頂端。受 maxMs 限制。 */
async function autoScroll(maxMs: number): Promise<void> {
  const start = Date.now();
  const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
  const origin = window.scrollY;
  try {
    while (Date.now() - start < maxMs) {
      const before = window.scrollY;
      window.scrollBy(0, step);
      await delay(120);
      // 到底或無法再捲：結束
      if (window.scrollY === before) break;
    }
  } catch {
    /* 忽略 */
  } finally {
    try {
      window.scrollTo(0, origin);
    } catch {
      /* 忽略 */
    }
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
