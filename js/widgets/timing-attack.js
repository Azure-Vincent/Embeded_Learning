import { h, s, clear } from '../core/dom.js';
import { compareTime } from '../sim/attacks.js';

// A PIN comparison that returns at the first wrong digit takes longer the more leading digits are right.
// The learner measures that, then switches to a constant-time comparison and sees the signal vanish.
export default function mount(el, props = {}, ctx = {}) {
  const secret = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10));
  let defence = props.defence || 'none', known = [], noise = 6, samples = 20, total = 0;
  const done = { recovered: false, flat: false };
  const chart = s('svg', { class: 'w-svg', viewBox: '0 0 420 170', role: 'img', 'aria-label': 'Mean response time per candidate digit' });
  const msg = h('div', { class: 'w-msg' }), pinView = h('div', { class: 'w-mono', style: { fontSize: '1.3rem', letterSpacing: '.3em' } }), stat = h('p', { class: 'w-note' });
  const defSel = h('select', { 'aria-label': 'Comparison', onchange: () => { defence = defSel.value; known = []; msg.textContent = ''; msg.className = 'w-msg'; draw([]); } },
    [['none', 'Early-exit comparison'], ['constant-time', 'Constant-time comparison']].map(([v, t]) => h('option', { value: v, selected: v === defence }, t)));
  const noiseIn = h('input', { type: 'range', min: 0, max: 30, value: noise, oninput: () => { noise = +noiseIn.value; } });
  const sampIn = h('input', { type: 'range', min: 1, max: 200, value: samples, oninput: () => { samples = +sampIn.value; sampOut.textContent = samples; } });
  const sampOut = h('output', {}, samples);

  function measure() {
    if (known.length >= 6) return;
    const rows = [];
    for (let d = 0; d < 10; d++) {
      const guess = known.concat(d, new Array(5 - known.length).fill(0));
      const ts = [];
      for (let i = 0; i < samples; i++) ts.push(compareTime(secret, guess, { constantTime: defence === 'constant-time', noise }).time);
      total += samples;
      const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
      const sd = Math.sqrt(ts.reduce((a, b) => a + (b - mean) ** 2, 0) / ts.length);
      rows.push({ d, mean, se: sd / Math.sqrt(ts.length) });
    }
    draw(rows);
    if (defence === 'constant-time') {
      const spread = Math.max(...rows.map((r) => r.mean)) - Math.min(...rows.map((r) => r.mean));
      msg.className = 'w-msg ok';
      msg.textContent = `Every candidate takes the same time apart from noise (spread ${spread.toFixed(1)} units). There is nothing to pick. Add more samples and the bars only get flatter.`;
      if (samples >= 50) done.flat = true;
    } else {
      msg.className = 'w-msg';
      msg.textContent = 'Which digit took measurably longer? Click its bar to accept it as the next digit. If the error bars overlap, take more samples.';
    }
    finish();
  }
  function pick(d) {
    if (defence !== 'none' || known.length >= 6) return;
    known.push(d);
    const right = known.every((x, i) => x === secret[i]);
    if (!right) { msg.className = 'w-msg bad'; msg.textContent = 'That digit was noise, not signal. Removed. Average more samples before choosing.'; known.pop(); }
    else if (known.length === 6) { msg.className = 'w-msg bad'; msg.textContent = `PIN recovered in ${total} measurements instead of up to 1,000,000 guesses. Now switch to the constant-time comparison and measure again.`; done.recovered = true; }
    else { msg.className = 'w-msg warn'; msg.textContent = `Digit ${known.length} found. Measure the next position.`; }
    draw([]); finish();
  }
  function draw(rows) {
    clear(chart);
    pinView.textContent = known.join('') + '·'.repeat(6 - known.length);
    stat.textContent = `Measurements used: ${total}`;
    if (!rows.length) { chart.append(s('text', { x: 210, y: 85, 'text-anchor': 'middle', 'font-size': 12 }, 'Press “Measure this position”')); return; }
    const lo = Math.min(...rows.map((r) => r.mean - r.se * 2)) - 2, hi = Math.max(...rows.map((r) => r.mean + r.se * 2)) + 2;
    const y = (v) => 140 - ((v - lo) / (hi - lo)) * 120;
    rows.forEach((r, i) => {
      const x = 20 + i * 40;
      const g = s('g', { tabindex: 0, role: 'button', 'aria-label': `digit ${r.d}, mean ${r.mean.toFixed(1)}`, style: 'cursor:pointer', onclick: () => pick(r.d), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && pick(r.d) },
        s('rect', { x, y: y(r.mean), width: 26, height: 140 - y(r.mean), fill: 'var(--sig1)' }),
        s('line', { x1: x + 13, x2: x + 13, y1: y(r.mean + 2 * r.se), y2: y(r.mean - 2 * r.se), stroke: 'var(--ink)', 'stroke-width': 1.5 }),
        s('text', { x: x + 13, y: 158, 'text-anchor': 'middle', 'font-size': 12 }, r.d));
      chart.append(g);
    });
  }
  function finish() { if (done.recovered && done.flat) ctx.complete?.(); }
  el.append(
    h('div', { class: 'w-task' }, h('p', {}, 'A simulated lock checks a 6-digit PIN and you can time its answer. Recover the PIN one digit at a time. Then change the firmware to a constant-time comparison, take at least 50 samples per digit, and confirm the timing no longer tells you anything.')),
    h('div', { class: 'w-grid' },
      h('div', { class: 'w-controls' }, h('div', { class: 'w-field' }, h('label', {}, 'Firmware'), defSel, h('span')), h('div', { class: 'w-field' }, h('label', {}, 'Measurement noise'), noiseIn, h('span')), h('div', { class: 'w-field' }, h('label', {}, 'Samples per digit'), sampIn, sampOut),
        h('button', { type: 'button', class: 'btn small', onclick: measure }, 'Measure this position'), pinView, stat),
      h('div', {}, chart)),
    msg,
    h('pre', { class: 'code' }, '/* leaks: returns at the first mismatch */         /* constant time: always scans everything */\nfor (i = 0; i < n; i++)                             uint8_t diff = 0;\n    if (a[i] != b[i]) return false;                 for (i = 0; i < n; i++) diff |= a[i] ^ b[i];\nreturn true;                                        return diff == 0;'),
    h('p', { class: 'w-note' }, 'Model: time = base + cost × matching leading digits + random noise; real measurements are noisier and need many more samples. Defences that belong together: constant-time comparison, a retry limit with lockout, and comparing MACs rather than secrets. Verify by inspecting the compiled assembly for data-dependent branches and by a statistical timing test on the real device (fixed input versus random input).'));
  draw([]);
}
