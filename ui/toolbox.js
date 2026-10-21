const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const fields = ['capture_mode', 'save_to_file', 'copy_to_clipboard', 'capture_cursor', 'preview_in_editor', 'delay_secs'];
let settings = null;

function render() {
  for (const name of fields) {
    const el = $(name);
    if (el.type === 'checkbox') el.checked = !!settings[name];
    else el.value = String(settings[name]);
  }
}

async function save() {
  for (const name of fields) {
    const el = $(name);
    if (el.type === 'checkbox') settings[name] = el.checked;
    else if (name === 'delay_secs') settings[name] = Number(el.value);
    else settings[name] = el.value;
  }
  try {
    settings = await invoke('update_settings', { settings });
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

$('capture').addEventListener('click', () => {
  setStatus(settings.delay_secs > 0 ? `Capturing in ${settings.delay_secs} s...` : '');
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
  settings = await invoke('get_settings');
  render();
  refreshHotkeyLabel();
})();
