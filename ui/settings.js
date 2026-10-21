const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const $ = (id) => document.getElementById(id);
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

let status = null;
let recording = null; // { action, button }
let localErrors = {}; // action -> message from a rejected recording

function modifiers(e) {
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
}

function render() {
  const body = $('rows');
  body.replaceChildren();
  for (const row of status.rows) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = row.label;

    const keyCell = document.createElement('td');
    const button = document.createElement('button');
    const error = localErrors[row.action] || row.error;
    button.className = 'key' + (row.accelerator ? '' : ' empty') + (error ? ' bad' : '');
    button.textContent = row.accelerator ? row.accelerator.replace('Super', 'Win') : 'None';
    button.title = row.default ? `Default: ${row.default}` : 'No default';
    button.addEventListener('click', () => startRecording(row.action, button));
    keyCell.append(button);
    if (error) {
      const msg = document.createElement('div');
      msg.className = 'error';
      msg.textContent = error;
      keyCell.append(msg);
    }

    const actions = document.createElement('td');
    actions.className = 'actions';
    if (row.accelerator) {
      const clear = document.createElement('button');
      clear.className = 'clear';
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => assign(row.action, null));
      actions.append(clear);
    }
    tr.append(name, keyCell, actions);
    body.append(tr);
  }
  $('warning').hidden = !status.print_screen_taken_by_windows;
}

async function startRecording(action, button) {
  if (recording) await stopRecording();
  recording = { action, button };
  button.classList.add('recording');
  button.textContent = 'Press keys...';
  // Stop global hotkeys so pressing them here does not start a capture.
  await invoke('pause_hotkeys', { paused: true });
}

async function stopRecording(resume = true) {
  if (!recording) return;
  recording = null;
  if (resume) await invoke('pause_hotkeys', { paused: false });
  render();
}

async function assign(action, accelerator) {
  try {
    status = await invoke('set_hotkey', { action, accelerator });
    delete localErrors[action];
  } catch (e) {
    localErrors[action] = String(e);
    await invoke('pause_hotkeys', { paused: false });
  }
  render();
}

function onKey(e) {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape' && modifiers(e).length === 0) {
    if (e.type === 'keydown') stopRecording();
    return;
  }
  if (MODIFIER_CODES.has(e.code)) {
    if (e.type === 'keydown') recording.button.textContent = modifiers(e).join('+') + '+...';
    return;
  }
  // Windows only reports Print Screen on key up, so accept that one there.
  if (e.type === 'keyup' && e.code !== 'PrintScreen') return;
  if (e.type === 'keydown' && e.code === 'PrintScreen') return;
  const accelerator = [...modifiers(e), e.code].join('+');
  const { action } = recording;
  recording = null;
  assign(action, accelerator);
}

window.addEventListener('keydown', onKey, true);
window.addEventListener('keyup', onKey, true);
window.addEventListener('blur', () => stopRecording());

$('reset').addEventListener('click', async () => {
  localErrors = {};
  status = await invoke('reset_hotkeys');
  render();
});
$('close').addEventListener('click', () => getCurrentWindow().close());
$('open_keyboard_settings').addEventListener('click', () => invoke('open_windows_keyboard_settings'));

(async () => {
  status = await invoke('get_hotkeys');
  render();
})();
