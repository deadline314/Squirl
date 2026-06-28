<script lang="ts">
  import { onMount } from 'svelte';
  import { sendToBackground } from '@/messaging/bus';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '@/shared/settings';
  import type { LinkedFolder } from '@/messaging/protocol';

  let s = $state<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  let loaded = $state(false);
  let saveNote = $state('');

  let driveStatus = $state<{ configured: boolean; connected: boolean; email: string | null; hasCustomId: boolean; customTail: string | null } | null>(null);
  let clientIdInput = $state('');
  let aiHealth = $state('');
  let folders = $state<LinkedFolder[]>([]);
  let newFolderName = $state('');
  let langsInput = $state('');

  onMount(async () => {
    s = await loadSettings();
    langsInput = s.youtube.preferredLangs.join(', ');
    loaded = true;
    await refreshDrive();
  });

  async function persist() {
    s.youtube.preferredLangs = langsInput.split(',').map((x) => x.trim()).filter(Boolean);
    await saveSettings($state.snapshot(s));
    saveNote = '已儲存 ✓';
    setTimeout(() => (saveNote = ''), 1400);
  }
  async function refreshDrive() { try { driveStatus = await sendToBackground('drive/status', undefined); } catch { /* ignore */ } }
  async function saveClientId() { await sendToBackground('drive/setClientId', { clientId: clientIdInput.trim() || null }); clientIdInput = ''; await refreshDrive(); }
  async function connectDrive() { try { await sendToBackground('drive/connect', undefined); } catch (e) { alert('連線失敗：' + e); } await refreshDrive(); }
  async function checkHealth() {
    aiHealth = '檢查中…';
    try { const r = await sendToBackground('aidesktop/health', { baseUrl: s.aiDesktop.baseUrl }); aiHealth = r.ok ? '✓ 連線正常' : '✗ ' + r.detail; }
    catch (e) { aiHealth = '✗ ' + e; }
  }
  async function loadFolders() { try { const r = await sendToBackground('aidesktop/folders', { baseUrl: s.aiDesktop.baseUrl }); folders = r.folders; } catch (e) { alert('取得資料夾失敗：' + e); } }
  async function createFolder() {
    if (!newFolderName.trim()) return;
    try { const f = await sendToBackground('aidesktop/createFolder', { baseUrl: s.aiDesktop.baseUrl, name: newFolderName.trim() }); folders = [...folders, f]; selectFolder(f); newFolderName = ''; }
    catch (e) { alert('建立失敗：' + e); }
  }
  function selectFolder(f: LinkedFolder) { s.aiDesktop.folderId = f.folder_id; s.aiDesktop.folderName = f.folder_name; s.aiDesktop.kbName = f.kb_name; }
  function onFolderChange(e: Event) { const f = folders.find((x) => x.folder_id === (e.target as HTMLSelectElement).value); if (f) { selectFolder(f); void persist(); } }

  const driveLabel = $derived(!driveStatus ? '—' : driveStatus.connected ? '已連線' : driveStatus.configured ? '已設定，未連線' : '未設定');
</script>

{#if loaded}
<main>
  <header>
    <div class="brand"><span class="logo">🐿️</span><div><h1>Squirl</h1><p>右鍵剪存網頁 / YouTube 到 Drive 與 AI Desktop 知識庫</p></div></div>
  </header>

  <section class="card">
    <h2>匯出</h2>
    <label>預設格式
      <select bind:value={s.export.defaultFormat} onchange={persist}><option value="md">Markdown</option><option value="txt">純文字</option></select>
    </label>
    <p class="hint">PDF 暫時移除（會讓 service worker 無法註冊，且不支援中文）；之後會以 SW 安全的方式重新加入。中文請用 Markdown 或純文字。</p>
    <label class="cb"><input type="checkbox" bind:checked={s.export.includeImages} onchange={persist} /> 包含圖片參照</label>
    <label class="cb"><input type="checkbox" bind:checked={s.export.writeSidecar} onchange={persist} /> 輸出 .meta.json（供 AI Desktop 索引）</label>
  </section>

  <section class="card">
    <h2>YouTube</h2>
    <label class="cb"><input type="checkbox" bind:checked={s.youtube.saveSubtitles} onchange={persist} /> 預設嘗試儲存字幕</label>
    <div class="grid">
      <label>偏好語言（逗號分隔）<input bind:value={langsInput} placeholder="zh-Hant, en" onblur={persist} /></label>
      <label>字幕格式 <select bind:value={s.youtube.subtitleFormat} onchange={persist}><option value="srt">SRT</option><option value="vtt">VTT</option></select></label>
    </div>
    <label class="cb"><input type="checkbox" bind:checked={s.youtube.captionsIntoSidecar} onchange={persist} /> 字幕純文字併入 sidecar</label>
    <p class="hint">影片下載：可在 popup 勾選並選畫質；目前支援 progressive（360p/720p，落本機 Downloads/Squirl/videos）。更高畫質需音視訊合併，下一版支援。</p>
  </section>

  <details class="card">
    <summary><b>Google Drive</b><span class="badge">{driveLabel}</span></summary>
    <div class="body">
      <label class="cb"><input type="checkbox" bind:checked={s.drive.authEnabled} onchange={persist} /> 啟用 Drive 連線</label>
      {#if s.drive.authEnabled}
        <label class="cb"><input type="checkbox" bind:checked={s.drive.uploadToDrive} onchange={persist} /> 剪存後直傳 Drive</label>
        <label>歸檔子資料夾 <input bind:value={s.drive.subfolder} onblur={persist} /></label>
        <div class="status-line">{driveLabel}{#if driveStatus?.email} · {driveStatus.email}{/if}{#if driveStatus?.hasCustomId} · ID {driveStatus.customTail}{/if}</div>
        <div class="row"><input placeholder="自備 OAuth Client ID（加密存本機）" bind:value={clientIdInput} /><button onclick={saveClientId}>儲存 ID</button><button onclick={connectDrive}>連線帳號</button></div>
        <p class="hint">使用 drive.file 最小權限，僅能存取本擴充建立的檔案。設定步驟見 SETUP-DRIVE.md。</p>
      {/if}
    </div>
  </details>

  <details class="card">
    <summary><b>AI Desktop（知識庫 + 行事曆）</b><span class="badge">{s.aiDesktop.enabled ? (s.aiDesktop.folderName || '已啟用') : '關閉'}</span></summary>
    <div class="body">
      <label class="cb"><input type="checkbox" bind:checked={s.aiDesktop.enabled} onchange={persist} /> 啟用 AI Desktop 串接</label>
      {#if s.aiDesktop.enabled}
        <label>後端網址 <input bind:value={s.aiDesktop.baseUrl} placeholder="https://xxx.a.run.app" onblur={persist} /></label>
        <div class="row"><button onclick={checkHealth}>測試連線</button><button onclick={loadFolders}>載入資料夾</button><span class="status-line">{aiHealth}</span></div>
        {#if folders.length}
          <label>歸檔資料夾
            <select onchange={onFolderChange}>
              <option value="">— 請選擇 —</option>
              {#each folders as f (f.folder_id)}<option value={f.folder_id} selected={f.folder_id === s.aiDesktop.folderId}>{f.folder_name}（{f.kb_name}）</option>{/each}
            </select>
          </label>
        {/if}
        <div class="row"><input placeholder="＋ 新增資料夾名稱" bind:value={newFolderName} /><button onclick={createFolder}>建立</button></div>
        {#if s.aiDesktop.folderName}<div class="status-line">目前：{s.aiDesktop.folderName} → KB「{s.aiDesktop.kbName}」</div>{/if}
        <label class="cb"><input type="checkbox" bind:checked={s.aiDesktop.calendarMark} onchange={persist} /> 在行事曆標記剪存時間點</label>
        {#if s.aiDesktop.calendarMark}<label>標記事件長度（分鐘）<input type="number" min="1" max="60" bind:value={s.aiDesktop.calendarDurationMin} onblur={persist} /></label>{/if}
      {/if}
    </div>
  </details>

  <details class="card">
    <summary><b>擷取行為（進階）</b></summary>
    <div class="body">
      <div class="grid">
        <label>動態內容靜置（毫秒）<input type="number" min="100" max="5000" bind:value={s.capture.settleQuietMs} onblur={persist} /></label>
        <label>最長等待（毫秒）<input type="number" min="500" max="15000" bind:value={s.capture.settleMaxMs} onblur={persist} /></label>
      </div>
      <label class="cb"><input type="checkbox" bind:checked={s.capture.scrollToLoad} onchange={persist} /> 擷取前捲動觸發 lazy-load</label>
    </div>
  </details>

  <footer class:show={!!saveNote}>{saveNote}</footer>
</main>
{/if}

<style>
  :global(:root) {
    --bg: #faf8f5; --card: #ffffff; --ink: #1f2328; --muted: #6b7280; --line: #ece6df;
    --brand: #7a4f2e; --brand-ink: #f5deb3; --accent: #b9803f; --ok: #2e7d32;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #1b1714; --card: #241f1b; --ink: #efe9e2; --muted: #a99e92; --line: #342d27;
      --brand: #caa06a; --brand-ink: #20160d; --accent: #d9a866; --ok: #7bc47f;
    }
  }
  :global(body) { margin: 0; background: var(--bg); font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; color: var(--ink); }
  main { max-width: 660px; margin: 0 auto; padding: 26px 20px 70px; }
  header { margin-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo { font-size: 30px; }
  h1 { font-size: 19px; margin: 0; } header p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
  h2 { font-size: 14px; margin: 0 0 12px; color: var(--accent); }

  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  details.card > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
  details.card > summary::-webkit-details-marker { display: none; }
  details.card > summary::before { content: '▸'; color: var(--accent); margin-right: 8px; font-size: 11px; }
  details.card[open] > summary::before { content: '▾'; }
  details.card > summary b { flex: 1; }
  .badge { font-size: 11px; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 20px; padding: 2px 9px; }
  .body { margin-top: 14px; }

  label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; margin-bottom: 11px; }
  label.cb { flex-direction: row; align-items: center; gap: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  input, select { padding: 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--ink); font-size: 13px; }
  input[type="checkbox"] { padding: 0; width: 15px; height: 15px; accent-color: var(--brand); }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 11px; flex-wrap: wrap; }
  .row input { flex: 1; min-width: 150px; }
  button { padding: 8px 13px; border: 1px solid var(--brand); background: var(--brand); color: var(--brand-ink); border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 600; }
  button:hover { filter: brightness(1.07); }
  .hint { font-size: 11px; color: var(--muted); margin: 6px 0 0; line-height: 1.5; }
  .status-line { font-size: 12px; color: var(--muted); }
  footer { position: fixed; bottom: 16px; right: 20px; color: var(--ok); font-weight: 700; background: var(--card); border: 1px solid var(--line); padding: 8px 14px; border-radius: 8px; opacity: 0; transition: opacity .2s; }
  footer.show { opacity: 1; }
</style>
