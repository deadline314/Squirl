/**
 * 一般網頁擷取器（在 content script 內執行，讀 live DOM）。
 * 輸出階層式 ContentTree（heading/段落/list/表格/code/quote/image）。
 *
 * 容錯：
 * - 主內容偵測失敗 → 退 body
 * - 選取範圍解析失敗 → 退整頁，warning 提示
 * - settle 逾時 → 用當下 DOM，warning 提示
 */
import {
  type CaptureOptions,
  type CaptureResult,
  type ContentNode,
  type ContentSource,
  nowIso,
} from './ContentSource';
import { findMainContainer } from './dom/readability';
import { blockify, sectionize } from './dom/blockify';
import { settle } from './dom/settle';
import { createLogger } from '@/shared/logger';

const log = createLogger('webpage');

export class WebpageExtractor implements ContentSource {
  readonly kind = 'webpage' as const;

  matches(): boolean {
    return true; // 後備來源：任何非特化頁面
  }

  async capture(opts: CaptureOptions): Promise<CaptureResult> {
    const warnings: string[] = [];
    const url = location.href;
    const title = cleanTitle(document.title) || url;

    // 1. 選取範圍優先
    if (opts.scope === 'selection') {
      const node = captureSelection();
      if (node) {
        return base(url, title, [node], warnings);
      }
      warnings.push('未取得有效選取範圍，已改擷取整頁。');
    }

    // 2. 等動態內容穩定（逾時保底）
    const container = findMainContainer(document);
    try {
      await settle(container, {
        quietMs: opts.settleQuietMs,
        maxMs: opts.settleMaxMs,
        scrollToLoad: opts.scrollToLoad,
      });
    } catch (e) {
      log.warn('settle failed (continuing with current DOM)', e);
      warnings.push('動態內容可能未完整載入。');
    }

    // 3. 區塊化 + 階層重建
    const main = findMainContainer(document); // settle 後重抓（DOM 可能已變）
    const flat = blockify(main, url);
    if (!flat.length) {
      warnings.push('主內容偵測為空，已擷取整頁文字。');
      const fallback = blockify(document.body, url);
      return base(url, title, sectionize(fallback), warnings, byline(), excerpt(document.body));
    }
    const tree = sectionize(flat);
    return base(url, title, tree, warnings, byline(), excerpt(main));
  }
}

function base(
  url: string,
  title: string,
  tree: ContentNode[],
  warnings: string[],
  byline?: string,
  excerpt?: string,
): CaptureResult {
  return {
    kind: 'webpage',
    url,
    title,
    capturedAt: nowIso(),
    lang: document.documentElement.lang || undefined,
    byline,
    excerpt,
    tree,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** 擷取使用者選取範圍 → 單一 section 節點 */
function captureSelection(): ContentNode | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  try {
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    const holder = document.createElement('div');
    holder.appendChild(frag);
    const flat = blockify(holder, location.href);
    if (flat.length) return { type: 'section', level: 0, children: flat };
    // 純文字選取（無區塊結構）
    const text = sel.toString().trim();
    return text ? { type: 'paragraph', text } : null;
  } catch {
    return null;
  }
}

function byline(): string | undefined {
  const meta =
    document.querySelector('meta[name="author"]')?.getAttribute('content') ||
    document.querySelector('meta[property="article:author"]')?.getAttribute('content') ||
    document.querySelector('[rel="author"]')?.textContent;
  return meta?.trim() || undefined;
}

function excerpt(el: HTMLElement): string | undefined {
  const meta =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ||
    document.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (meta?.trim()) return meta.trim();
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 280) : undefined;
}

function cleanTitle(t: string): string {
  return (t ?? '').replace(/\s+/g, ' ').trim();
}
