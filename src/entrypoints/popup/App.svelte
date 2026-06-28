<script lang="ts">
  import { onMount } from 'svelte';
  import { sendToBackground } from '@/messaging/bus';
  import { loadSettings, type AppSettings, type ExportFormat } from '@/shared/settings';
  import { messageFor } from '@/shared/errors';
  import type { ClipSnapshot, Envelope } from '@/messaging/protocol';
  import type { YtProbe } from '@/core/capture/youtube/captureYouTube';

  type PageType = 'youtube' | 'webpage' | 'restricted' | 'unknown';

  let settings = $state<AppSettings | null>(null);
  let tabId = $state<number | null>(null);
  let pageType = $state<PageType>('unknown');
  let pageTitle = $state('');

  let format = $state<ExportFormat>('md');
  let saveSubtitles = $state(true);
  let saveVideo = $state(false);
  let selectedItag = $state<number | null>(null);
  let probe = $state<YtProbe | null>(null);
  let probing = $state(false);

  let advanced = $state(false);
  let tags = $state('');
  let project = $state('');

  let current = $state<ClipSnapshot | null>(null);
  let history = $state<ClipSnapshot[]>([]);
  let busy = $state(false);
  let showHistory = $state(false);

  const PHASE: Record<string, string> = {
    queued: '排隊中', capturing: '擷取內容', exporting: '產生檔案', storing: '上傳中',
    notifying: '通知 AI Desktop', video: '下載影片', done: '完成', error: '失敗',
  };
  let probeFailed = $state(false);

  const driveOn = $derived(!!settings && settings.drive.authEnabled && (settings.drive.uploadToDrive || settings.aiDesktop.enabled));

  onMount(async () => {
    settings = await loadSettings();
    format = settings.export.defaultFormat === 'pdf' ? 'md' : settings.export.defaultFormat;
    saveSubtitles = settings.youtube.saveSubtitles;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id ?? null;
      pageTitle = tab?.title ?? '';
      pageType = classify(tab?.url ?? '');
    } catch { pageType = 'unknown'; }

    if (pageType === 'youtube' && tabId != null) void runProbe();
    await refreshHistory();

    chrome.runtime.onMessage.addListener((raw: unknown) => {
      const env = raw as Envelope;
      if (env?.__squirl && env.target === 'popup' && env.type === 'clip/update') {
        const s = env.payload as ClipSnapshot;
        current = s;
        if (s.phase === 'done' || s.phase === 'error') { busy = false; void refreshHistory(); }
      }
      return false;
    });
  });

  function classify(url: string): PageType {
    if (!url || /^(chrome|edge|about|chrome-extension|view-source):/.test(url)) return 'restricted';
    try {
      const h = new URL(url).hostname.replace(/^www\.|^m\./, '');
      if (h === 'youtu.be' || (h === 'youtube.com' && /\/(watch|shorts)/.test(new URL(url).pathname))) return 'youtube';
    } catch { return 'unknown'; }
    return 'webpage';
  }

  async function runProbe() {
    if (tabId == null) return;
    probing = true; probeFailed = false;
    try {
      probe = await sendToBackground('yt/probe', { tabId });
      if (probe.title) pageTitle = probe.title;
      selectedItag = probe.variants[0]?.itag ?? null;
    } catch { probe = null; probeFailed = true; }
    finally { probing = false; }
  }

  async function clip(fmtOverride: ExportFormat | 'subtitle' | undefined = undefined) {
    if (tabId == null) return;
    busy = true;
    current = { id: 'pending', url: '', title: pageTitle, phase: 'queued', detail: '開始…', progress: 0, webViewLink: null, duplicate: false, error: null, at: Date.now() };
    const video = pageType === 'youtube' && saveVideo && selectedItag != null
      ? { itag: selectedItag, label: probe?.variants.find((v) => v.itag === selectedItag)?.label ?? '' }
      : null;
    try {
      await sendToBackground('clip/run', {
        tabId,
        scope: 'page',
        format: fmtOverride ?? format,
        subtitles: pageType === 'youtube' ? saveSubtitles : undefined,
        video,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        project: project.trim() || null,
      });
    } catch (e) {
      busy = false;
      current = { id: 'x', url: '', title: '', phase: 'error', detail: '', progress: 0, webViewLink: null, duplicate: false, error: { code: 'UNKNOWN', message: String(e) }, at: Date.now() };
    }
  }

  async function refreshHistory() {
    try { history = (await sendToBackground('history/list', undefined)).slice(0, 6); } catch { /* ignore */ }
  }
  async function retry(id: string) { busy = true; try { await sendToBackground('clip/retry', { id }); } catch { busy = false; } }
  function openOptions() { chrome.runtime.openOptionsPage(); }
  function fmtBytes(n: number | undefined = undefined): string {
    if (!n) return '';
    return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB';
  }

  const FORMATS: ExportFormat[] = ['md', 'txt'];
  const TYPE_LABEL: Record<PageType, string> = { youtube: 'YouTube 影片', webpage: '網頁', restricted: '此頁不支援', unknown: '網頁' };
  const TYPE_ICON: Record<PageType, string> = { youtube: '▶', webpage: '🗎', restricted: '🚫', unknown: '🗎' };
</script>

<main>
  <header>
    <div class="brand"><span class="logo">🐿️</span><span class="name">Squirl</span></div>
    <button class="icon-btn" onclick={openOptions} title="設定" aria-label="設定">⚙</button>
  </header>

  <div class="page-chip {pageType}">
    <span class="ic">{TYPE_ICON[pageType]}</span>
    <span class="meta"><b>{TYPE_LABEL[pageType]}</b><small title={pageTitle}>{pageTitle || '—'}</small></span>
  </div>

  {#if pageType === 'restricted'}
    <p class="hint warn">瀏覽器系統頁無法剪存，請切換到一般網頁或 YouTube。</p>
  {:else}
    <button class="primary" onclick={() => clip()} disabled={busy || tabId == null}>
      {busy ? `${current ? (PHASE[current.phase] ?? '處理中') : '處理中'}…` : driveOn ? '剪存到 Drive' : '剪存到本機'}
    </button>

    <div class="field">
      <span class="label">格式</span>
      <div class="seg">
        {#each FORMATS as f (f)}
          <button class:active={format === f} onclick={() => (format = f)} disabled={busy}>
            {f === 'md' ? 'Markdown' : f === 'txt' ? 'Text' : 'PDF'}
          </button>
        {/each}
      </div>
    </div>

    {#if pageType === 'youtube'}
      <div class="yt">
        {#if probing}
          <div class="yt-status"><span class="spinner sm"></span> 讀取影片資訊（字幕語言、可下載畫質）…</div>
        {:else if probeFailed}
          <div class="yt-status warn">讀不到影片資訊（請確認停在影片頁）<button class="mini" onclick={runProbe}>重試</button></div>
        {/if}

        <label class="toggle"><input type="checkbox" bind:checked={saveSubtitles} disabled={busy} /> 下載字幕
          {#if probe}<small>{probe.captionLangs.length ? probe.captionLangs.map((c) => c.lang).slice(0, 4).join(', ') : '此片無字幕'}</small>{/if}
        </label>

        <label class="toggle"><input type="checkbox" bind:checked={saveVideo} disabled={busy || !(probe && probe.variants.length)} /> 也下載影片
          {#if probe && !probe.variants.length}<small>無可直接下載的畫質</small>{/if}
        </label>
        {#if saveVideo && probe && probe.variants.length}
          <select class="quality" bind:value={selectedItag} disabled={busy}>
            {#each probe.variants as v (v.itag)}
              <option value={v.itag}>{v.label} · {v.ext.toUpperCase()}{v.sizeBytes ? ` · ${fmtBytes(v.sizeBytes)}` : ''}</option>
            {/each}
          </select>
          <small class="hint">影片會下載到本機 Downloads/Squirl/videos（會顯示下載進度）。更高畫質需音視訊合併，下一版支援。</small>
        {/if}

        <button class="ghost-wide" onclick={() => clip('subtitle')} disabled={busy || !(probe && probe.captionLangs.length)}>只存字幕檔</button>
      </div>
    {/if}

    <button class="disclosure" onclick={() => (advanced = !advanced)}>{advanced ? '▾' : '▸'} 進階（標籤 / 專案）</button>
    {#if advanced}
      <div class="adv">
        <input placeholder="標籤（逗號分隔）" bind:value={tags} disabled={busy} />
        <input placeholder="專案" bind:value={project} disabled={busy} />
      </div>
    {/if}
  {/if}

  {#if current}
    <div class="status {current.phase}">
      <div class="status-row">
        {#if current.phase === 'error'}
          <span class="dot error"></span>
          <span class="msg">{current.error ? messageFor(current.error.code) : (current.detail || '失敗')}</span>
        {:else if current.phase === 'done'}
          <span class="dot done"></span>
          <span class="msg">{current.detail || (current.duplicate ? '已存在（略過）' : '已剪存')}</span>
          {#if current.webViewLink}<a href={current.webViewLink} target="_blank" rel="noreferrer">在 Drive 開啟 ↗</a>{/if}
        {:else}
          <span class="spinner"></span>
          <span class="msg"><b>{PHASE[current.phase] ?? current.phase}</b>{current.detail ? ` · ${current.detail}` : '…'}</span>
        {/if}
      </div>
      {#if (current.phase === 'storing' || current.phase === 'video') && current.progress > 0}
        <div class="bar"><i style="width:{Math.round(current.progress * 100)}%"></i></div>
      {/if}
    </div>
  {/if}

  {#if history.length}
    <button class="disclosure" onclick={() => (showHistory = !showHistory)}>{showHistory ? '▾' : '▸'} 最近剪存（{history.length}）</button>
    {#if showHistory}
      <section class="history">
        {#each history as h (h.id)}
          <div class="h-item">
            <span class="dot {h.phase}"></span>
            <span class="h-name" title={h.title}>{h.title || h.url || '(未命名)'}</span>
            {#if h.phase === 'error'}<button class="mini" onclick={() => retry(h.id)}>重試</button>
            {:else if h.webViewLink}<a class="mini" href={h.webViewLink} target="_blank" rel="noreferrer">開啟</a>{/if}
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</main>

<style>
  :global(:root) {
    --bg: #faf8f5; --card: #ffffff; --ink: #1f2328; --muted: #6b7280; --line: #ece6df;
    --brand: #7a4f2e; --brand-ink: #f5deb3; --accent: #b9803f; --ok: #2e7d32; --err: #c62828;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #1b1714; --card: #241f1b; --ink: #efe9e2; --muted: #a99e92; --line: #342d27;
      --brand: #caa06a; --brand-ink: #20160d; --accent: #d9a866; --ok: #7bc47f; --err: #ef9a9a;
    }
  }
  :global(body) { margin: 0; font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; background: var(--bg); }
  main { width: 320px; padding: 14px; box-sizing: border-box; color: var(--ink); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 7px; }
  .logo { font-size: 18px; } .name { font-weight: 700; letter-spacing: .2px; }
  .icon-btn { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; padding: 4px; border-radius: 6px; }
  .icon-btn:hover { background: var(--line); }

  .page-chip { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; margin-bottom: 12px; }
  .page-chip .ic { width: 26px; height: 26px; border-radius: 7px; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; font-size: 13px; flex: none; }
  .page-chip.restricted .ic { background: var(--err); color: #fff; }
  .page-chip .meta { display: flex; flex-direction: column; overflow: hidden; }
  .page-chip b { font-size: 12px; } .page-chip small { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 230px; }

  .primary { width: 100%; padding: 11px; border: none; border-radius: 10px; background: var(--brand); color: var(--brand-ink); font-weight: 700; font-size: 14px; cursor: pointer; transition: filter .15s; }
  .primary:hover:not(:disabled) { filter: brightness(1.07); }
  .primary:disabled { opacity: .55; cursor: default; }

  .field { margin-top: 12px; }
  .label { font-size: 11px; color: var(--muted); display: block; margin-bottom: 5px; }
  .seg { display: flex; background: var(--card); border: 1px solid var(--line); border-radius: 9px; padding: 3px; gap: 3px; }
  .seg button { flex: 1; border: none; background: none; color: var(--ink); padding: 6px 0; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .seg button.active { background: var(--brand); color: var(--brand-ink); font-weight: 600; }

  .yt { margin-top: 12px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 11px; display: flex; flex-direction: column; gap: 9px; }
  .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  .toggle small { color: var(--muted); font-size: 11px; margin-left: auto; }
  .quality { padding: 7px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--ink); font-size: 12px; }
  .ghost-wide { padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font-size: 12px; cursor: pointer; }
  .ghost-wide:disabled { opacity: .5; cursor: default; }

  .disclosure { width: 100%; text-align: left; background: none; border: none; color: var(--accent); font-size: 12px; cursor: pointer; padding: 10px 2px 4px; }
  .adv { display: flex; flex-direction: column; gap: 7px; margin-top: 4px; }
  .adv input { padding: 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--ink); font-size: 13px; }

  .status { margin-top: 12px; padding: 9px 11px; border-radius: 9px; font-size: 12px; background: var(--card); border: 1px solid var(--line); }
  .status-row { display: flex; align-items: center; gap: 7px; }
  .status .msg { flex: 1; line-height: 1.4; word-break: break-word; }
  .status .msg b { font-weight: 700; }
  .status.done { border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
  .status.error { border-color: color-mix(in srgb, var(--err) 45%, var(--line)); }
  .status a { color: var(--accent); text-decoration: none; white-space: nowrap; }

  .yt-status { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); }
  .yt-status.warn { color: var(--err); }
  .spinner.sm { width: 11px; height: 11px; }
  .bar { width: 100%; height: 4px; background: var(--line); border-radius: 4px; overflow: hidden; margin-top: 4px; }
  .bar i { display: block; height: 100%; background: var(--brand); transition: width .2s; }

  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.done { background: var(--ok); } .dot.error { background: var(--err); }
  .spinner { width: 12px; height: 12px; border: 2px solid var(--line); border-top-color: var(--brand); border-radius: 50%; animation: spin .7s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .history { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
  .h-item { display: flex; align-items: center; gap: 7px; padding: 4px 2px; font-size: 12px; }
  .h-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini { font-size: 11px; color: var(--accent); background: none; border: none; cursor: pointer; text-decoration: none; }

  .hint { font-size: 11px; color: var(--muted); margin: 2px 0 0; }
  .hint.warn { color: var(--err); }
</style>
