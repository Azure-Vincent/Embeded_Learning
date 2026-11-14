// Resistor colour code: bands <-> value, nearest preferred values, and a quiz that explains each wrong reading.
import { h, s, clear } from '../core/dom.js';
import { COLOURS, MULTIPLIER, TOLERANCE, bandsToValue, valueToBands, nearestE, fmtR, parseR, eSeriesValues, prng } from '../sim/electronics.js';
import { tabs, readout, equation, messages, note, task } from '../sim/electronics-draw.js';

export const CHALLENGES = { quiz: { title: 'Read and write five resistor colour codes in a row' } };
const DIGITS = COLOURS.slice(0, 10), MULTS = Object.keys(MULTIPLIER), TOLS = Object.keys(TOLERANCE);
const cap = (c) => c[0].toUpperCase() + c.slice(1);
const fmtMult = (m) => m >= 1e6 ? '×' + m / 1e6 + 'M' : m >= 1e3 ? '×' + m / 1e3 + 'k' : '×' + m;

/** Explain a wrong reading of a resistor whose true value is `truth` ohms. Pure, so it is unit-tested. */
export function diagnoseReading(truth, answer) {
  if (!(answer > 0)) return 'That is not a resistance. Write it like 4.7k, 4k7, 220 or 1M.';
  const ratio = answer / truth, dec = Math.log10(ratio);
  if (Math.abs(ratio - 1) < 1e-6) return '';
  if (Math.abs(dec - Math.round(dec)) < 1e-6) {
    const n = Math.round(dec);
    return `Right digits, wrong multiplier: your value is ${n > 0 ? 10 ** n + '× too large' : 10 ** -n + '× too small'}. The multiplier band is the number of zeros to append (gold = ÷10, silver = ÷100).`;
  }
  const digits = (x) => String(Math.round(x / 10 ** (Math.floor(Math.log10(x)) - 2))).replace(/0+$/, '');
  const a = digits(answer), t = digits(truth);
  if (a.length === t.length && a.split('').reverse().join('') === t) return 'Those are the right digits in reverse order: you read the resistor from the tolerance end. The tolerance band (gold, silver, or the one set apart) goes on the right.';
  return `Not this one. Read the digit bands left to right, then multiply. (You entered ${fmtR(answer)}.)`;
}

/** A quiz question from a seeded generator. kind 'read' = bands shown, 'write' = value shown. */
export function makeQuestion(rnd, nBands) {
  const pool = eSeriesValues(nBands === 5 ? 'E24' : 'E12', nBands === 5 ? 1 : 0, 6);
  const ohms = pool[Math.floor(rnd() * (pool.length - 1))];
  const tol = nBands === 5 ? (rnd() < 0.7 ? 'brown' : 'red') : (rnd() < 0.8 ? 'gold' : 'silver');
  return { kind: rnd() < 0.5 ? 'read' : 'write', ohms, bands: valueToBands(ohms, nBands, tol), nBands };
}

function drawResistor(bands, sel = -1, onpick) {
  const n = bands.length, xs = n === 5 ? [92, 116, 140, 164, 214] : [98, 126, 154, 210];
  return s('svg', { class: 'w-svg el-svg', viewBox: '0 0 320 96', role: 'img', 'aria-label': 'Resistor with bands: ' + bands.map((b) => b || 'unset').join(', ') },
    s('path', { d: 'M8 42H70M250 42H312', class: 'rc-lead' }),
    s('path', { d: 'M70 26q0 -8 10 -8h14q6 0 10 4h112q4 -4 10 -4h14q10 0 10 8v32q0 8 -10 8h-14q-6 0 -10 -4h-112q-4 4 -10 4h-14q-10 0 -10 -8Z', class: 'rc-body' }),
    bands.map((c, i) => s('rect', { x: xs[i], y: i === 0 || i === n - 1 ? 18.6 : 22.6, width: 13, height: i === 0 || i === n - 1 ? 46.8 : 38.8, class: 'rc-band' + (i === sel ? ' sel' : ''), style: c ? `fill:var(--rc-${c})` : 'fill:none;stroke-dasharray:3 2', onclick: onpick ? () => onpick(i) : null })),
    bands.map((c, i) => s('text', { x: xs[i] + 6.5, y: 84, 'text-anchor': 'middle', class: 'el-t sub' }, c ? c.slice(0, 3) : '?')));
}
function swatches(label, colours, current, onpick, hint) {
  return h('div', { class: 'resistor-code-row' }, h('span', {}, label),
    h('div', { class: 'resistor-code-sw', role: 'group', 'aria-label': label }, colours.map((c) =>
      h('button', { type: 'button', 'aria-pressed': c === current ? 'true' : 'false', title: hint ? hint(c) : c, onclick: () => onpick(c) }, h('i', { style: { background: `var(--rc-${c})` } }), cap(c), hint ? h('span', { class: 'w-mono' }, ' ' + hint(c)) : null))));
}

export default function mount(el, props = {}, ctx = {}) {
  const st = { mode: props.mode === 'quiz' ? 'quiz' : 'explore', n: 4, bands: ['yellow', 'violet', 'red', 'gold'], streak: 0, done: false, q: null, pick: [], seed: 1 + Math.floor(Math.random() * 1e6) };
  const rnd = prng(st.seed);
  const root = h('div', { class: 'resistor-code' });
  const modeTabs = tabs([['explore', 'Explore'], ['quiz', 'Quiz']], st.mode, (m) => { st.mode = m; if (m === 'quiz' && !st.q) nextQ(); render(); }, 'Mode');
  const bandTabs = tabs([[4, '4 bands'], [5, '5 bands']], st.n, (n) => {
    st.n = n; const v = bandsToValue(st.bands).ohms;
    st.bands = valueToBands(nearestE(v, n === 5 ? 'E24' : 'E12'), n) || (n === 5 ? ['yellow', 'violet', 'black', 'brown', 'brown'] : ['yellow', 'violet', 'red', 'gold']);
    st.q = null; if (st.mode === 'quiz') nextQ(); render();
  }, 'Number of bands');
  const body = h('div');
  clear(el).append(root); root.append(h('div', { class: 'row' }, modeTabs.el, bandTabs.el), body,
    note('nominal values only. Real parts sit anywhere inside the tolerance band, body colours vary by maker, and brown, red and orange are easy to confuse under warm light: measure with a multimeter before you trust a reading. Six-band parts (temperature coefficient) and SMD number codes are not covered.'));

  function nextQ() { st.q = makeQuestion(rnd, st.n); st.pick = Array(st.n).fill(null); st.pick[st.n - 1] = st.q.bands[st.n - 1]; st.answered = false; }

  function render() { clear(body); st.mode === 'explore' ? explore() : quiz(); }

  function explore() {
    const info = bandsToValue(st.bands), nd = st.n - 2;
    const ro = readout(), eq = equation(), msg = messages();
    const input = h('input', { type: 'text', 'aria-label': 'Resistance to convert to colour bands', placeholder: 'e.g. 4k7', value: '' });
    const go = () => {
      const v = parseR(input.value);
      if (!(v > 0)) return msg.set([['bad', 'Could not read that as a resistance. Try 220, 4.7k, 4k7 or 1M.']]);
      if (v < 0.1 || v > 99e9) return msg.set([['bad', 'Outside what the colour code can express.']]);
      const series = st.n === 5 ? 'E24' : 'E12', near = nearestE(v, series), exact = valueToBands(v, st.n, st.bands[st.n - 1]);
      st.bands = exact || valueToBands(near, st.n, st.bands[st.n - 1]);
      render();
      const m2 = body.querySelector('.el-msgs');
      m2.append(h('div', { class: 'w-msg ' + (exact && Math.abs(near - v) < v * 1e-6 ? 'ok' : 'warn') },
        exact && Math.abs(near - v) < v * 1e-6 ? `${fmtR(v)} is a standard ${series} value.`
          : `${fmtR(v)} is not an ${series} value. Nearest you can buy: ${fmtR(near)} (${((near - v) / v * 100).toFixed(1)} % off)` + (exact ? '; the bands shown are the exact value you typed.' : '; bands shown are for that part.')));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const pick = h('div', { class: 'resistor-code-pick' });
    for (let i = 0; i < nd; i++) pick.append(swatches(`Digit ${i + 1}`, DIGITS, st.bands[i], (c) => { st.bands[i] = c; render(); }, (c) => String(COLOURS.indexOf(c))));
    pick.append(swatches('Multiplier', MULTS, st.bands[nd], (c) => { st.bands[nd] = c; render(); }, (c) => fmtMult(MULTIPLIER[c])));
    pick.append(swatches('Tolerance', TOLS, st.bands[nd + 1], (c) => { st.bands[nd + 1] = c; render(); }, (c) => '±' + TOLERANCE[c] + '%'));
    const digs = st.bands.slice(0, nd).map((c) => COLOURS.indexOf(c)).join('');
    ro.set([['Value', fmtR(info.ohms)], ['Tolerance', '±' + info.tolerance + ' %'], ['Could measure', `${fmtR(info.min)} – ${fmtR(info.max)}`]]);
    eq.set([`${st.bands.slice(0, nd).map(cap).join(' ')} → digits ${digs};  ${cap(st.bands[nd])} → ${fmtMult(MULTIPLIER[st.bands[nd]])}`,
      `R = ${+digs} × ${MULTIPLIER[st.bands[nd]]} = ${fmtR(info.ohms)}  ±${info.tolerance} %`]);
    const m = [];
    if (st.bands[0] === 'black') m.push(['warn', 'A leading black band (0) is not used on real parts: you are probably reading it from the wrong end.']);
    const series = st.n === 5 ? 'E24' : 'E12', near = nearestE(info.ohms, series);
    if (Math.abs(near - info.ohms) > info.ohms * 1e-6) m.push(['', `${fmtR(info.ohms)} is not in the ${series} series, so you are unlikely to find it in a kit. Nearest: ${fmtR(near)}.`]);
    msg.set(m);
    body.append(h('div', { class: 'w-grid' },
      h('div', { class: 'el-col' }, drawResistor(st.bands), h('div', { class: 'resistor-code-big' }, `${fmtR(info.ohms)} ±${info.tolerance} %`), ro.el, eq.el,
        h('div', { class: 'row' }, h('label', {}, 'Value → bands '), input, h('button', { type: 'button', class: 'btn small', onclick: go }, 'Show bands')), msg.el),
      h('div', { class: 'el-col' }, pick)));
  }

  function quiz() {
    const q = st.q, nd = st.n - 2, msg = messages();
    const score = h('div', { class: 'resistor-code-score' }, `Streak ${st.streak} / 5` + (st.done || ctx.isDone?.() ? ' — completed' : ''));
    const next = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { nextQ(); render(); } }, 'Next resistor');
    const finish = (ok, text) => {
      st.streak = ok ? st.streak + 1 : 0; st.answered = ok;
      score.textContent = `Streak ${st.streak} / 5`;
      const list = [[ok ? 'ok' : 'bad', text]];
      if (ok && st.streak >= 5 && !st.done) { st.done = true; ctx.complete?.(); list.push(['ok', 'Five in a row. Challenge complete; keep going if you want more practice.']); }
      msg.set(list);
      if (ok) next.focus();
    };
    if (q.kind === 'read') {
      const input = h('input', { type: 'text', 'aria-label': 'Your reading of the resistor value', placeholder: 'e.g. 4k7' });
      const check = () => {
        if (st.answered) return;
        const a = parseR(input.value), d = diagnoseReading(q.ohms, a);
        if (!d) finish(true, `Correct: ${fmtR(q.ohms)} ±${TOLERANCE[q.bands[st.n - 1]]} %.`); else finish(false, d);
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
      body.append(task('read the value', `What is the nominal resistance of this ${st.n}-band resistor? Answer five in a row to complete the quiz.`),
        h('div', { class: 'w-grid' }, h('div', { class: 'el-col' }, drawResistor(q.bands), score),
          h('div', { class: 'el-col' }, h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check'), next), msg.el)));
    } else {
      const fig = h('div'), pick = h('div', { class: 'resistor-code-pick' });
      const redraw = () => {
        clear(fig).append(drawResistor(st.pick));
        clear(pick);
        for (let i = 0; i < nd; i++) pick.append(swatches(`Digit ${i + 1}`, DIGITS, st.pick[i], (c) => { st.pick[i] = c; redraw(); }));
        pick.append(swatches('Multiplier', MULTS, st.pick[nd], (c) => { st.pick[nd] = c; redraw(); }));
      };
      const check = () => {
        if (st.answered) return;
        if (st.pick.some((c) => !c)) return msg.set([['warn', 'Choose a colour for every band first.']]);
        const got = bandsToValue(st.pick).ohms, d = diagnoseReading(q.ohms, got);
        if (!d) finish(true, `Correct: ${st.pick.map(cap).join(', ')}.`);
        else finish(false, `Those bands read ${fmtR(got)}. ` + d.replace(/ \(You entered.*$/, ''));
      };
      redraw();
      body.append(task('choose the bands', `Pick the digit and multiplier bands for a ${fmtR(q.ohms)} resistor (${st.n} bands; the tolerance band is already ${q.bands[st.n - 1]}). Answer five in a row to complete the quiz.`),
        h('div', { class: 'w-grid' }, h('div', { class: 'el-col' }, fig, score, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check'), next), msg.el),
          h('div', { class: 'el-col' }, pick)));
    }
  }
  if (st.mode === 'quiz') nextQ();
  render();
}
