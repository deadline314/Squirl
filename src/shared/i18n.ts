/**
 * 極簡 i18n：以 key 取字串，找不到回 key 本身（容錯）。
 * 預設跟隨瀏覽器語言；可由設定覆寫。範圍小，零依賴。
 */
type Dict = Record<string, string>;

const zhTW: Dict = {
  'menu.clipToDrive': 'Squirl：剪存到雲端硬碟',
  'menu.clipAs': 'Squirl：剪存為…',
  'menu.md': 'Markdown (.md)',
  'menu.txt': '純文字 (.txt)',
  'menu.pdf': 'PDF (.pdf)',
  'menu.subtitle': '字幕',
  'menu.selection': '剪存選取範圍',
  'notify.savingTitle': 'Squirl 剪存中…',
  'notify.savedTitle': '已剪存',
  'notify.failedTitle': '剪存失敗',
  'notify.openInDrive': '在 Drive 開啟',
  'notify.duplicate': '這個網址已剪存過，已略過。',
};

const en: Dict = {
  'menu.clipToDrive': 'Squirl: Clip to Drive',
  'menu.clipAs': 'Squirl: Clip as…',
  'menu.md': 'Markdown (.md)',
  'menu.txt': 'Plain text (.txt)',
  'menu.pdf': 'PDF (.pdf)',
  'menu.subtitle': 'Subtitles',
  'menu.selection': 'Clip selection',
  'notify.savingTitle': 'Squirl is clipping…',
  'notify.savedTitle': 'Clipped',
  'notify.failedTitle': 'Clip failed',
  'notify.openInDrive': 'Open in Drive',
  'notify.duplicate': 'This URL was already clipped — skipped.',
};

const DICTS: Record<string, Dict> = { 'zh-TW': zhTW, zh: zhTW, en };

function resolveLang(pref?: string): string {
  const want = (pref && pref !== 'auto' ? pref : navigator.language) || 'en';
  if (DICTS[want]) return want;
  const base = want.split('-')[0] ?? 'en';
  return DICTS[base] ? base : 'en';
}

export function createT(pref?: string): (key: keyof typeof en) => string {
  const dict = DICTS[resolveLang(pref)] ?? en;
  return (key) => dict[key] ?? en[key] ?? String(key);
}
