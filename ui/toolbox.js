const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const fields = ['save_to_file', 'copy_to_clipboard', 'capture_cursor', 'preview_in_editor', 'delay_secs'];
const modeButtons = [...document.querySelectorAll('.mode')];
let settings = null;

function render() {
  for (const name of fields) {
    const el = $(name);
    if (el.type === 'checkbox') el.checked = !!settings[name];
    else el.value = String(settings[name]);
  }
  for (const b of modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === settings.capture_mode));
}

async function save() {
  for (const name of fields) {
    const el = $(name);
    if (el.type === 'checkbox') settings[name] = el.checked;
    else settings[name] = Number(el.value);
  }
  try {
    settings = await invoke('update_settings', { settings });
    render();
  } catch (e) {
    setStatus(String(e), true);
  }
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.title = text;
  el.classList.toggle('error', isError);
}

async function refreshHotkeyLabel() {
  const status = await invoke('get_hotkeys');
  const row = status.rows.find((r) => r.action === 'capture');
  $('capture_hotkey').textContent = row && row.accelerator && !row.error ? row.accelerator : '';
}

for (const name of fields) $(name).addEventListener('change', save);
for (const b of modeButtons) {
  b.addEventListener('click', () => {
    settings.capture_mode = b.dataset.mode;
    render();
    save();
  });
}

$('capture').addEventListener('click', () => {
  setStatus(settings.delay_secs > 0 ? `Capturing in ${settings.delay_secs} s...` : 'Capturing...');
  invoke('start_capture', { mode: null });
});
$('hotkeys').addEventListener('click', () => invoke('open_hotkey_settings'));
$('open_folder').addEventListener('click', () => invoke('open_capture_folder').catch((e) => setStatus(String(e), true)));

listen('capture-done', ({ payload: r }) => {
  if (!r.ok) return setStatus(r.message || 'Capture failed', true);
  const parts = [`${r.width} × ${r.height}`];
  if (r.path) parts.push(`saved to ${r.path}`);
  if (r.copied) parts.push('copied to clipboard');
  if (!r.path && !r.copied) parts.push('turn on Save to File or Copy to Clipboard to keep it');
  setStatus(parts.join(', ') + (r.message ? ` (${r.message})` : ''), !!r.message);
});
listen('capture-cancelled', () => setStatus('Capture cancelled'));
listen('hotkeys-changed', refreshHotkeyLabel);

(async () => {
  window.__TAURI__.app.getVersion().then((v) => { $('version').textContent = v; }).catch(() => {});
  settings = await invoke('get_settings');
  render();
  refreshHotkeyLabel();
})();
