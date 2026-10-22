const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

const $ = (id) => document.getElementById(id);

// Modifiers in the canonical order the app stores them in.
const MODIFIERS = [['Ctrl', 'Ctrl'], ['Alt', 'Alt'], ['Shift', 'Shift'], ['Super', 'Win']];
const KEY_LABELS = {
  PrintScreen: 'Print Screen', ScrollLock: 'Scroll Lock', PageUp: 'Page Up', PageDown: 'Page Down',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
};
const DEFAULTS = { image_format: 'png', jpeg_quality: 90, theme: 'system', start_minimized: true, hide_toolbox_while_capturing: true, show_magnifier: true, show_crosshairs: true, save_to_file: true, copy_to_clipboard: true, save_dir: null };
const CHECKS = ['start_minimized', 'hide_toolbox_while_capturing', 'show_magnifier', 'show_crosshairs', 'save_to_file', 'copy_to_clipboard'];

let settings = null;
let hotkeys = null;
let autostart = false;
let tab = 'general';
// Unsaved combos per action: { accelerator, error }. Modifiers ticked before
// a key is chosen wait here, as do rejected combos with their error.
let drafts = {};

const keyLabel = (k) => KEY_LABELS[k] || k.replace(/^Numpad/, 'Num ');
const prettyAccel = (a) => a.split('+').map((p) => (p === 'Super' ? 'Win' : keyLabel(p))).join(' + ');

function split(accelerator) {
  const parts = accelerator ? accelerator.split('+') : [];
  const key = parts.length && !MODIFIERS.some(([m]) => m === parts[parts.length - 1]) ? parts.pop() : null;
  return { mods: new Set(parts), key };
}

// Sends only the changed fields; the app merges them into its current
// settings, so overlapping saves cannot undo each other.
let saveSeq = 0;
async function save(patch) {
  Object.assign(settings, patch);
  const seq = ++saveSeq;
  try {
    const saved = await invoke('update_settings', { patch });
    // A reply to an older save must not hide a newer one still in flight.
    if (seq === saveSeq) settings = saved;
  } catch (e) {
    alert(String(e));
  }
  renderGeneral();
}

async function renderGeneral() {
  for (const id of CHECKS) $(id).checked = !!settings[id];
  $('autostart').checked = autostart;
  $('start_minimized').disabled = !autostart;
  $('start_minimized').parentElement.classList.toggle('disabled', !autostart);
  $('image_format').value = settings.image_format;
  $('jpeg_row').hidden = settings.image_format !== 'jpeg';
  $('jpeg_quality').value = settings.jpeg_quality;
  $('jpeg_quality_value').textContent = settings.jpeg_quality;
  $('theme').value = settings.theme;
  $('default_dir').hidden = !settings.save_dir;
  $('save_dir').value = await invoke('get_capture_folder').catch(() => settings.save_dir || '');
  $('save_dir').title = $('save_dir').value;
}

function renderHotkeys() {
  const groups = $('hotkey_groups');
  groups.replaceChildren();
  for (const row of hotkeys.rows) {
    const draft = drafts[row.action];
    const { mods, key } = split(draft ? draft.accelerator : row.accelerator);
    const error = draft ? draft.error : row.error;

    const fs = document.createElement('fieldset');
    fs.className = error ? 'bad' : '';
    const legend = document.createElement('legend');
    legend.textContent = row.label;
    const combo = document.createElement('div');
    combo.className = 'combo';

    const boxes = MODIFIERS.map(([mod, label]) => {
      const l = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = mods.has(mod);
      box.dataset.mod = mod;
      l.append(box, label);
      combo.append(l);
      return box;
    });

    const select = document.createElement('select');
    const keys = key && !hotkeys.keys.includes(key) ? [key, ...hotkeys.keys] : hotkeys.keys;
    select.append(new Option('None', ''));
    for (const k of keys) select.append(new Option(keyLabel(k), k));
    select.value = key || '';
    fs.title = `Default: ${row.default ? prettyAccel(row.default) : 'none'}`;
    combo.append(select);

    const chosen = () => boxes.filter((b) => b.checked).map((b) => b.dataset.mod);
    for (const b of boxes) {
      b.addEventListener('change', () => {
        // No key yet: keep the modifiers on screen until one is picked.
        if (!select.value) drafts[row.action] = { accelerator: chosen().join('+'), error: null };
        else assign(row.action, [...chosen(), select.value].join('+'));
      });
    }
    // Picking None clears the hotkey.
    select.addEventListener('change', () => assign(row.action, select.value ? [...chosen(), select.value].join('+') : null));
    fs.append(legend, combo);

    if (error) {
      const msg = document.createElement('div');
      msg.className = 'error';
      msg.textContent = error;
      fs.append(msg);
    }
    groups.append(fs);
  }
  $('warning').hidden = !hotkeys.print_screen_taken_by_windows;
}

async function assign(action, accelerator) {
  try {
    hotkeys = await invoke('set_hotkey', { action, accelerator });
    delete drafts[action];
  } catch (e) {
    drafts[action] = { accelerator: accelerator || '', error: `Not saved: ${e}` };
  }
  renderHotkeys();
}

function showTab(name) {
  tab = name;
  for (const b of document.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[role="tabpanel"]')) p.hidden = p.id !== `tab-${name}`;
  $('restore').title = name === 'hotkeys' ? 'Restore the default hotkeys' : 'Restore the default General and Capture options';
}

for (const b of document.querySelectorAll('[role="tab"]')) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const id of CHECKS) $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
$('image_format').addEventListener('change', (e) => save({ image_format: e.target.value }));
$('theme').addEventListener('change', (e) => save({ theme: e.target.value }));
$('jpeg_quality').addEventListener('input', (e) => { $('jpeg_quality_value').textContent = e.target.value; });
$('jpeg_quality').addEventListener('change', (e) => save({ jpeg_quality: Number(e.target.value) }));
$('autostart').addEventListener('change', async (e) => {
  $('autostart_error').hidden = true;
  try {
    autostart = await invoke('set_autostart', { enabled: e.target.checked });
  } catch (err) {
    $('autostart_error').textContent = String(err);
    $('autostart_error').hidden = false;
  }
  renderGeneral();
});
$('browse').addEventListener('click', async () => {
  const dir = await invoke('pick_save_folder').catch((e) => { alert(String(e)); return null; });
  if (dir) save({ save_dir: dir });
});
$('default_dir').addEventListener('click', () => save({ save_dir: null }));
$('open_dir').addEventListener('click', () => invoke('open_capture_folder').catch((e) => alert(String(e))));
$('open_keyboard_settings').addEventListener('click', () => invoke('open_windows_keyboard_settings'));
$('restore').addEventListener('click', async () => {
  if (tab === 'hotkeys') {
    drafts = {};
    hotkeys = await invoke('reset_hotkeys');
    renderHotkeys();
  } else {
    save(DEFAULTS);
  }
});
$('close').addEventListener('click', () => getCurrentWindow().close());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') getCurrentWindow().close(); });

listen('settings-changed', ({ payload }) => { settings = payload; renderGeneral(); });
listen('hotkeys-changed', async () => { hotkeys = await invoke('get_hotkeys'); renderHotkeys(); });

(async () => {
  [settings, hotkeys, autostart] = await Promise.all([
    invoke('get_settings'),
    invoke('get_hotkeys'),
    invoke('get_autostart').catch(() => false),
  ]);
  renderGeneral();
  renderHotkeys();
})();
