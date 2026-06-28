/**
 * 主內容偵測（輕量版 readability）。
 * 目標：從整頁挑出「主文容器」，去掉導覽/側欄/頁尾/廣告。
 *
 * 策略：優先用語意標籤（article / main / [role=main]）；
 * 否則以「文字密度評分」挑出得分最高的區塊。
 * 容錯：偵測結果過短或為空 → 退回 document.body（寧可多抓不要全空）。
 */
const NEGATIVE = /(^|[\s_-])(nav|footer|header|sidebar|aside|menu|comment|promo|advert|ad|banner|share|social|related|breadcrumb|cookie|popup|modal|subscribe|newsletter)([\s_-]|$)/i;
const POSITIVE = /(^|[\s_-])(article|content|post|entry|main|story|body|text|markdown|prose|doc)([\s_-]|$)/i;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SVG']);

const MIN_MAIN_TEXT = 200; // 主文偵測下限；不足則退 body

export function findMainContainer(doc: Document): HTMLElement {
  // 1. 語意標籤優先
  const semantic =
    doc.querySelector('article') ??
    doc.querySelector('main') ??
    doc.querySelector('[role="main"]');
  if (semantic instanceof HTMLElement && textLen(semantic) >= MIN_MAIN_TEXT) return semantic;

  // 2. 文字密度評分
  let best: HTMLElement | null = null;
  let bestScore = 0;
  const candidates = doc.querySelectorAll<HTMLElement>('article, section, div, main');
  let scanned = 0;
  for (const el of candidates) {
    if (scanned++ > 3000) break; // 容錯：超大頁面設掃描上限
    const score = scoreElement(el);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best && textLen(best) >= MIN_MAIN_TEXT) return best;

  // 3. 後備：整個 body
  return doc.body;
}

function scoreElement(el: HTMLElement): number {
  if (SKIP_TAGS.has(el.tagName)) return 0;
  const id = el.id || '';
  const cls = el.className && typeof el.className === 'string' ? el.className : '';
  const hint = `${id} ${cls}`;
  if (NEGATIVE.test(hint)) return 0;

  const text = (el.textContent ?? '').trim();
  const len = text.length;
  if (len < MIN_MAIN_TEXT) return 0;

  // 段落數越多越像主文；連結密度越高越像導覽（扣分）
  const paragraphs = el.querySelectorAll('p').length;
  const links = el.querySelectorAll('a').length;
  const linkText = Array.from(el.querySelectorAll('a')).reduce((n, a) => n + (a.textContent?.length ?? 0), 0);
  const linkDensity = len > 0 ? linkText / len : 1;

  let score = len * (1 - Math.min(linkDensity, 0.95)) + paragraphs * 30 - links * 2;
  if (POSITIVE.test(hint)) score *= 1.25;
  return score;
}

function textLen(el: HTMLElement): number {
  return (el.textContent ?? '').trim().length;
}

export { SKIP_TAGS };
