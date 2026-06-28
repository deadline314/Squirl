/**
 * DOM → 結構化區塊（ContentNode 扁平序列）。
 * 遞迴走訪主文容器，把語意元素映射成節點；之後由 sectionize() 依 heading 階層組成樹。
 *
 * 容錯：未知元素遞迴其子節點；單一節點解析失敗只略過該節點，不中斷整體。
 * 記憶體：只輸出輕量節點，不保留 DOM 參照。
 */
import type { ContentNode } from '../ContentSource';
import { SKIP_TAGS } from './readability';

const BLOCK_LIMIT = 20_000; // 容錯：極端頁面的節點上限

export function blockify(root: HTMLElement, baseUrl: string): ContentNode[] {
  const out: ContentNode[] = [];
  walk(root, out, baseUrl);
  return out.slice(0, BLOCK_LIMIT);
}

function walk(el: Element, out: ContentNode[], baseUrl: string): void {
  for (const child of Array.from(el.children)) {
    if (out.length >= BLOCK_LIMIT) return;
    try {
      handle(child, out, baseUrl);
    } catch {
      /* 單節點失敗略過 */
    }
  }
}

function handle(el: Element, out: ContentNode[], baseUrl: string): void {
  const tag = el.tagName;
  if (SKIP_TAGS.has(tag)) return;
  if (el instanceof HTMLElement && el.hidden) return;

  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const text = clean(el.textContent);
      if (text) out.push({ type: 'heading', level: Number(tag[1]), text });
      return;
    }
    case 'P': {
      const text = clean(el.textContent);
      if (text) out.push({ type: 'paragraph', text });
      return;
    }
    case 'UL':
    case 'OL': {
      const node = listToNode(el, baseUrl);
      if (node.children && node.children.length) out.push(node);
      return;
    }
    case 'TABLE': {
      const node = tableToNode(el);
      if (node) out.push(node);
      return;
    }
    case 'PRE': {
      const code = el.querySelector('code') ?? el;
      const text = (code.textContent ?? '').replace(/\s+$/, '');
      if (text.trim()) out.push({ type: 'code', text, lang: detectLang(code) });
      return;
    }
    case 'BLOCKQUOTE': {
      const text = clean(el.textContent);
      if (text) out.push({ type: 'quote', text });
      return;
    }
    case 'FIGURE': {
      const img = el.querySelector('img');
      const cap = el.querySelector('figcaption');
      if (img) out.push(imageNode(img, baseUrl, clean(cap?.textContent)));
      else walk(el, out, baseUrl);
      return;
    }
    case 'IMG': {
      out.push(imageNode(el as HTMLImageElement, baseUrl));
      return;
    }
    case 'HR': {
      out.push({ type: 'divider' });
      return;
    }
    default: {
      // 容器型元素：遞迴；純文字葉節點：當段落
      if (el.children.length > 0) {
        walk(el, out, baseUrl);
      } else {
        const text = clean(el.textContent);
        if (text) out.push({ type: 'paragraph', text });
      }
    }
  }
}

function listToNode(el: Element, baseUrl: string): ContentNode {
  const ordered = el.tagName === 'OL';
  const children: ContentNode[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue;
    const nested: ContentNode[] = [];
    // 巢狀清單
    for (const sub of Array.from(li.children)) {
      if (sub.tagName === 'UL' || sub.tagName === 'OL') {
        const n = listToNode(sub, baseUrl);
        if (n.children?.length) nested.push(n);
      }
    }
    const text = clean(directText(li));
    const item: ContentNode = { type: 'listitem', text };
    if (nested.length) item.children = nested;
    if (text || nested.length) children.push(item);
  }
  return { type: 'list', ordered, children };
}

function tableToNode(el: Element): ContentNode | null {
  const rows: string[][] = [];
  const trs = el.querySelectorAll('tr');
  for (const tr of Array.from(trs)) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => {
      const span = Number((c as HTMLTableCellElement).colSpan || 1);
      const text = clean(c.textContent);
      // 合併儲存格以重複值展開，維持欄位對齊
      return span > 1 ? Array(span).fill(text) : [text];
    });
    const flat = cells.flat();
    if (flat.length) rows.push(flat);
  }
  if (!rows.length) return null;
  return { type: 'table', rows };
}

function imageNode(img: HTMLImageElement, baseUrl: string, caption?: string): ContentNode {
  const raw = img.getAttribute('src') || img.getAttribute('data-src') || '';
  return { type: 'image', src: absolutize(raw, baseUrl), alt: caption || clean(img.alt) || '' };
}

/** 只取元素「直接」的文字（排除巢狀 list 的文字），給 listitem 用 */
function directText(li: Element): string {
  let s = '';
  for (const n of Array.from(li.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? '';
    else if (n instanceof Element && n.tagName !== 'UL' && n.tagName !== 'OL') s += n.textContent ?? '';
  }
  return s;
}

function detectLang(code: Element): string | undefined {
  const cls = (code.getAttribute('class') || '').match(/language-([\w-]+)/);
  return cls?.[1];
}

function absolutize(src: string, baseUrl: string): string {
  if (!src) return '';
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 依 heading 階層把扁平區塊組成巢狀 section 樹，
 * 讓 Markdown / 純文字能正確縮排呈現大綱。
 */
export function sectionize(flat: ContentNode[]): ContentNode[] {
  const root: ContentNode = { type: 'section', level: 0, children: [] };
  const stack: ContentNode[] = [root];

  const top = () => stack[stack.length - 1]!;

  for (const node of flat) {
    if (node.type === 'heading' && node.level) {
      // 退到比目前 heading 淺的 section
      while (stack.length > 1 && (top().level ?? 0) >= node.level) stack.pop();
      const section: ContentNode = { type: 'section', level: node.level, text: node.text, children: [] };
      top().children!.push(section);
      stack.push(section);
    } else {
      top().children!.push(node);
    }
  }
  return root.children!;
}
