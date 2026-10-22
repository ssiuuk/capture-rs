// The Rust side sends `countdown-tick` with the seconds left; the page
// starts from the `secs` query parameter in case the first tick is missed.
const total = Math.max(1, Number(new URLSearchParams(location.search).get('secs')) || 1);
const number = document.getElementById('number');
const progress = document.getElementById('progress');
const circumference = 2 * Math.PI * 78;
progress.style.strokeDasharray = circumference;

function show(left) {
  number.textContent = left;
  number.classList.remove('tick');
  void number.offsetWidth; // restart the animation
  number.classList.add('tick');
  // The ring empties over the following second.
  progress.style.strokeDashoffset = circumference * (1 - (left - 1) / total);
}

progress.style.strokeDashoffset = 0;
show(total);
window.__TAURI__.event.listen('countdown-tick', ({ payload }) => show(payload));
