// Clock → prescaler → counter → compare/overflow, with a 1 ms tick challenge, and a watchdog timeline with diagnosis tasks.
import { h, s, clear, fmtSI } from '../core/dom.js';

export const COUNTER_MAX = 65535;   // the model's counter and divider are 16 bits wide

/** Timer arithmetic. The counter counts 0..reload inclusive, so one period is (reload + 1) counter ticks. */
export function timerCalc({ clkHz, div, reload }) {
  const tickHz = clkHz / div;
  const periodS = (reload + 1) / tickHz;
  return { tickHz, periodS, overflowHz: 1 / periodS };
}

/** Check a 1 ms tick configuration. Returns { ok, text }. */
export function checkTick({ clkHz, div, reload }, targetS = 1e-3) {
  if (!Number.isInteger(div) || !Number.isInteger(reload)) return { ok: false, text: 'Divider and reload are register values: whole numbers only.' };
  if (div < 1 || div > COUNTER_MAX + 1) return { ok: false, text: `The divider must be between 1 and ${COUNTER_MAX + 1}.` };
  if (reload < 0 || reload > COUNTER_MAX) return { ok: false, text: `Reload ${reload} does not fit a 16-bit register (maximum ${COUNTER_MAX}). On hardware the upper bits would be dropped and the period would be wrong. Use the divider to slow the counter clock first.` };
  const { periodS, tickHz } = timerCalc({ clkHz, div, reload });
  const want = targetS * tickHz; // counter ticks per period
  if (Math.abs(periodS - targetS) < 1e-12) return { ok: true, text: `${fmtSI(clkHz, 'Hz')} ÷ ${div} = ${fmtSI(tickHz, 'Hz')} counter clock; ${reload + 1} counts × ${fmtSI(1 / tickHz, 's')} = 1 ms exactly.` };
  if (Number.isInteger(want) && reload === want) return { ok: false, text: `Off by one. The counter counts 0, 1, … ${reload}: that is ${reload + 1} ticks, so the period is ${fmtSI(periodS, 's', 6)}. A clock built on this tick loses ${(Math.abs(periodS - targetS) / targetS * 86400).toFixed(1)} s per day. Reload must be one less than the number of ticks.` };
  if (!Number.isInteger(want)) return { ok: false, text: `With divider ${div} the counter clock is ${fmtSI(tickHz, 'Hz', 6)}, and 1 ms is ${want.toFixed(3)} ticks of it — not a whole number, so no reload value gives exactly 1 ms. Choose a divider that divides the clock to a round rate.` };
  return { ok: false, text: `That gives a period of ${fmtSI(periodS, 's', 6)} (${fmtSI(1 / periodS, 'Hz', 6)}), not 1 ms. With divider ${div} you need ${want} counter ticks per period.` };
}

/**
 * Watchdog simulation. feeds: times (ms) at which firmware feeds it. Returns { resetAt, reason } with reason
 * 'timeout' (no feed within timeoutMs), 'early' (windowed watchdog fed before windowMs had passed) or null.
 */
export function simulateWatchdog({ timeoutMs, windowMs = 0, feeds, endMs }) {
  let last = 0;
  for (const t of [...feeds].sort((a, b) => a - b)) {
    if (t === 0) continue; // the watchdog starts counting at t = 0
    if (t - last > timeoutMs) return { resetAt: last + timeoutMs, reason: 'timeout' };
    if (windowMs && t - last < windowMs) return { resetAt: t, reason: 'early' };
    last = t;
  }
  if (endMs - last > timeoutMs) return { resetAt: last + timeoutMs, reason: 'timeout' };
  return { resetAt: null, reason: null };
}

// Watchdog diagnosis tasks. tasks: [name, start, duration]; feeds: times in ms.
function loopTrace(iter, parts, { blockAt, blockMs, feedIf, extraFeed } = {}) {
  const tasks = [], feeds = []; let t = 0;
  for (let k = 0; k < iter; k++) {
    if (!feedIf || feedIf(k)) feeds.push(t);
    for (const [name, d] of parts) {
      const dur = k === blockAt && name === parts[1][0] ? blockMs : d;
      tasks.push([name, t, dur]); t += dur;
      if (extraFeed && name === extraFeed) feeds.push(t);
    }
  }
  return { tasks, feeds, endMs: t };
}
export const CHALLENGES = {
  blocking: {
    title: 'Reset during a sensor read',
    timeoutMs: 200, windowMs: 0,
    code: 'for (;;) {\n    wdt_feed();\n    read_sensor();     // I2C; waits for the device to answer\n    compute();\n    log_result();\n}',
    ...loopTrace(4, [['feed', 2], ['read_sensor', 12], ['compute', 20], ['log', 10]], { blockAt: 2, blockMs: 400 }),
    options: [
      ['short', 'The timeout is shorter than a normal pass through the loop.', 'A normal pass takes about 44 ms and the timeout is 200 ms. The first two passes fed the watchdog with plenty of margin.'],
      ['block', 'One call took longer than the timeout, so the feed at the top of the loop was never reached.', 'Yes. read_sensor() waited for a device that did not answer. The watchdog did its job: it turned a hang into a reset. The real fix is a timeout inside the I2C driver so the loop can report the fault and carry on; raising the watchdog timeout would only hide it.'],
      ['often', 'The watchdog was fed too often.', 'A plain (non-windowed) watchdog does not care how often it is fed, only that the gap between feeds stays below the timeout.'],
      ['isr', 'An interrupt handler disabled the watchdog.', 'Nothing in the trace shows that, and on most MCUs a running watchdog cannot be disabled by software at all — that is the point of it.'],
    ],
    answer: 'block',
  },
  conditional: {
    title: 'Reset when the line goes quiet',
    timeoutMs: 250, windowMs: 0,
    code: 'for (;;) {\n    if (uart_message_ready()) {\n        handle_message();\n        wdt_feed();        // "we are alive"\n    }\n    poll_buttons();\n}',
    ...loopTrace(22, [['poll', 20]], { feedIf: (k) => k < 9 && k % 3 === 0 }),
    options: [
      ['block', 'handle_message() blocked for longer than the timeout.', 'The trace shows the loop still turning every 20 ms right up to the reset. Nothing blocked.'],
      ['cond', 'The feed only happens when a message arrives; with no traffic for 250 ms a healthy loop is reset.', 'Yes. The feed is tied to an external event instead of to the loop making progress, so a quiet line looks like a hang. It also gives anyone who can stop the traffic a way to reset the device repeatedly. Feed from the place that proves the whole loop ran.'],
      ['short', 'The timeout is shorter than one pass through the loop.', 'One pass is 20 ms; the timeout is 250 ms.'],
      ['often', 'The watchdog was fed too often while messages were arriving.', 'This watchdog has no window, so frequent feeding is harmless.'],
    ],
    answer: 'cond',
  },
  window: {
    title: 'Reset although the loop is fast',
    timeoutMs: 200, windowMs: 50,
    code: '// window watchdog: feed no earlier than 50 ms and\n// no later than 200 ms after the previous feed\nfor (;;) {\n    wdt_feed();\n    sample_adc();      // 15 ms\n    update_output();   // 15 ms\n}',
    ...loopTrace(5, [['feed', 2], ['sample_adc', 13], ['update_output', 15]]),
    options: [
      ['block', 'A call blocked and the watchdog timed out.', 'The reset happens 30 ms after the previous feed, long before the 200 ms limit. Nothing timed out.'],
      ['early', 'The second feed came 30 ms after the first, inside the closed window, and a window watchdog treats an early feed as a fault.', 'Yes. A window watchdog also catches code that runs too fast or loops through the feed without doing its work. Here the loop is legitimately quick, so the feed must be rate-limited (for example, fed from a 100 ms tick) or the window reconfigured.'],
      ['short', 'The timeout of 200 ms is too short.', 'The loop takes 30 ms. It is far inside the upper limit.'],
      ['never', 'The watchdog was never fed.', 'It was fed at the start of each pass; the trace shows the feed markers.'],
    ],
    answer: 'early',
  },
};

const CLOCKS = [8, 16, 32, 48, 80, 100];

export default function mount(el, props = {}, ctx) {
  let mode = props.mode === 'watchdog' ? 'watchdog' : 'timer';
  let clkMHz = CLOCKS.includes(props.clockMHz) ? props.clockMHz : 32;
  let div = 1, reload = 65535, compare = 20000;
  let tickResult = null, wid = CHALLENGES[props.challenge] ? props.challenge : 'blocking', wAnswer = null, wTimeout = null;
  const root = h('div', { class: 'timer-lab' });
  el.append(root);

  function timerView() {
    const out = h('div', {});
    const num = (label, val, min, max, set) => {
      const inp = h('input', { type: 'number', min, max, step: 1, value: val, 'aria-label': label, oninput: () => { const v = Math.floor(+inp.value); if (Number.isFinite(v)) { set(v); tickResult = null; render(); } } });
      return h('label', { class: 'w-field' }, h('span', {}, label), inp, h('span', {}));
    };
    const sel = h('select', { 'aria-label': 'Timer clock', onchange: () => { clkMHz = +sel.value; tickResult = null; render(); } }, CLOCKS.map((c) => h('option', { value: c, selected: c === clkMHz }, c + ' MHz')));
    const controls = h('div', { class: 'w-controls' },
      h('label', { class: 'w-field' }, h('span', {}, 'Timer clock'), sel, h('span', {})),
      num('Divider (prescaler)', div, 1, 65536, (v) => { div = v; }),
      num('Reload value', reload, 0, 65535, (v) => { reload = v; }),
      num('Compare value', compare, 0, 65535, (v) => { compare = v; }));
    function render() {
      clear(out);
      const okRange = div >= 1 && div <= 65536 && reload >= 0 && reload <= 65535;
      const c = timerCalc({ clkHz: clkMHz * 1e6, div: Math.max(div, 1), reload: Math.max(reload, 0) });
      out.append(h('div', { class: 'timer-lab-chain w-mono', 'aria-hidden': 'true' },
        h('span', {}, fmtSI(clkMHz * 1e6, 'Hz')), '→', h('span', {}, '÷ ' + div), '→', h('span', {}, fmtSI(c.tickHz, 'Hz', 4)), '→', h('span', {}, `count 0…${reload}`), '→', h('span', {}, 'overflow every ' + fmtSI(c.periodS, 's', 4))));
      out.append(h('div', { class: 'w-readout' },
        h('div', {}, h('div', { class: 'k' }, 'Counter clock'), h('div', { class: 'v' }, fmtSI(c.tickHz, 'Hz', 5))),
        h('div', {}, h('div', { class: 'k' }, 'One count lasts'), h('div', { class: 'v' }, fmtSI(1 / c.tickHz, 's', 4))),
        h('div', {}, h('div', { class: 'k' }, 'Period'), h('div', { class: 'v' }, fmtSI(c.periodS, 's', 6))),
        h('div', {}, h('div', { class: 'k' }, 'Overflow rate'), h('div', { class: 'v' }, fmtSI(c.overflowHz, 'Hz', 6))),
        h('div', {}, h('div', { class: 'k' }, 'Output high for'), h('div', { class: 'v' }, compare > reload ? 'whole period' : (compare / (reload + 1) * 100).toFixed(1) + ' %'))));
      if (!okRange) out.append(h('p', { class: 'w-msg warn' }, 'Divider must be 1–65536 and reload 0–65535: both are 16-bit fields in this model.'));
      // sawtooth: three periods
      const W = 560, H = 150, x0 = 34, y0 = 124, yh = 100, pw = (W - x0 - 10) / 3;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-svg timer-lab-svg', role: 'img', 'aria-label': 'Counter value over three periods with compare level and output' });
      svg.append(s('line', { x1: x0, y1: y0, x2: W - 6, y2: y0, class: 'timer-lab-ax' }), s('line', { x1: x0, y1: y0, x2: x0, y2: y0 - yh - 6, class: 'timer-lab-ax' }));
      const cy = y0 - yh * Math.min(compare, reload + 1) / (reload + 1);
      let d = '', od = '';
      for (let k = 0; k < 3; k++) {
        const xa = x0 + k * pw, xb = xa + pw, xc = xa + pw * Math.min(compare, reload + 1) / (reload + 1);
        d += `M${xa},${y0} L${xb},${y0 - yh} L${xb},${y0} `;
        od += `M${xa},${H - 4} L${xa},${H - 16} L${xc},${H - 16} L${xc},${H - 4} L${xb},${H - 4} `;
        svg.append(s('text', { x: xb, y: y0 - yh - 8, 'text-anchor': 'middle', 'font-size': 10, class: 'timer-lab-ov' }, 'overflow'));
      }
      svg.append(s('path', { d, class: 'timer-lab-saw' }), s('line', { x1: x0, y1: cy, x2: W - 6, y2: cy, class: 'timer-lab-cmp' }), s('path', { d: od, class: 'timer-lab-out' }),
        s('text', { x: 2, y: y0 - yh + 4, 'font-size': 10 }, String(reload)), s('text', { x: 2, y: y0 + 3, 'font-size': 10 }, '0'),
        s('text', { x: x0 + 6, y: cy + 12, 'font-size': 10, class: 'timer-lab-cmpt' }, 'compare ' + compare),
        s('text', { x: 2, y: H - 6, 'font-size': 10 }, 'out'));
      out.append(svg);

      out.append(h('div', { class: 'w-task' },
        h('p', {}, h('strong', {}, 'Task. '), `The timer clock is ${clkMHz} MHz. Set the divider and the reload value so the counter overflows exactly every 1 ms. Both registers are 16 bits wide.`),
        h('button', { type: 'button', class: 'btn small', onclick: () => { tickResult = checkTick({ clkHz: clkMHz * 1e6, div, reload }); if (tickResult.ok) ctx?.complete?.(); render(); } }, 'Check my configuration')));
      if (tickResult) out.append(h('p', { class: 'w-msg ' + (tickResult.ok ? 'ok' : 'bad'), 'aria-live': 'polite' }, (tickResult.ok ? 'Correct. ' : '') + tickResult.text));
    }
    render();
    return h('div', {}, h('div', { class: 'w-grid' }, controls, out),
      h('p', { class: 'w-note' }, 'Model: an up-counter that counts 0…reload and then overflows, with a divider of 1–65536 in front. Real timers differ in detail: many store "divider − 1" in the prescaler register, some count down, and the timer clock is not always the CPU clock. Check the timer chapter of the reference manual for the part you use. The drawing is not to time scale.'));
  }

  function watchdogView() {
    const c = CHALLENGES[wid];
    const timeout = wTimeout ?? c.timeoutMs;
    const res = simulateWatchdog({ timeoutMs: timeout, windowMs: c.windowMs, feeds: c.feeds, endMs: c.endMs });
    const end = Math.max(c.endMs, (res.resetAt || 0) + 40);
    const W = 600, H = 190, x0 = 8, sx = (W - 16) / end;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-svg timer-lab-svg', role: 'img',
      'aria-label': res.resetAt == null ? 'Timeline: no watchdog reset' : `Timeline: watchdog reset at ${Math.round(res.resetAt)} milliseconds` });
    const cut = res.resetAt ?? Infinity;
    svg.append(s('text', { x: x0, y: 12, 'font-size': 10 }, 'firmware'));
    c.tasks.forEach(([name, t, dur], k) => {
      if (t >= cut) return;
      const w = (Math.min(t + dur, cut) - t) * sx;
      svg.append(s('rect', { x: x0 + t * sx, y: 18, width: Math.max(w - 1, 1), height: 22, class: 'timer-lab-task t' + (['feed', 'poll'].includes(name) ? 0 : (name.length % 3) + 1) }));
      if (w > 60) svg.append(s('text', { x: x0 + t * sx + 4, y: 33, 'font-size': 10 }, name + (dur > 100 ? ' … still waiting' : '')));
    });
    svg.append(s('text', { x: x0, y: 58, 'font-size': 10 }, 'feeds'));
    for (const t of c.feeds) if (t <= cut) svg.append(s('path', { d: `M${x0 + t * sx},62 l-4,10 l8,0 z`, class: 'timer-lab-feed' }));
    // watchdog counter
    const yb = 160, yh = 70;
    svg.append(s('text', { x: x0, y: 86, 'font-size': 10 }, `watchdog counter (resets the chip at ${timeout} ms` + (c.windowMs ? `; feeding before ${c.windowMs} ms is a fault)` : ')')));
    svg.append(s('line', { x1: x0, y1: yb - yh, x2: W - 8, y2: yb - yh, class: 'timer-lab-cmp' }));
    if (c.windowMs) svg.append(s('line', { x1: x0, y1: yb - yh * c.windowMs / timeout, x2: W - 8, y2: yb - yh * c.windowMs / timeout, class: 'timer-lab-win' }));
    let d = `M${x0},${yb}`, last = 0;
    for (const t of c.feeds.filter((f) => f > 0 && f <= cut)) { d += ` L${x0 + t * sx},${yb - yh * (t - last) / timeout} L${x0 + t * sx},${yb}`; last = t; if (t === cut) break; }
    if (res.resetAt != null && res.reason === 'timeout') d += ` L${x0 + res.resetAt * sx},${yb - yh}`;
    else if (res.resetAt == null) d += ` L${x0 + c.endMs * sx},${yb - yh * (c.endMs - last) / timeout}`;
    svg.append(s('path', { d, class: 'timer-lab-saw' }), s('line', { x1: x0, y1: yb, x2: W - 8, y2: yb, class: 'timer-lab-ax' }));
    if (res.resetAt != null) svg.append(s('line', { x1: x0 + res.resetAt * sx, y1: 14, x2: x0 + res.resetAt * sx, y2: yb + 4, class: 'timer-lab-reset' }),
      s('text', { x: Math.min(x0 + res.resetAt * sx + 4, W - 90), y: yb + 18, 'font-size': 11, class: 'timer-lab-resett' }, `RESET at ${Math.round(res.resetAt)} ms`));
    for (let t = 0; t <= end; t += 100) svg.append(s('text', { x: x0 + t * sx, y: H - 2, 'font-size': 9, class: 'timer-lab-tick' }, t + ' ms'));

    const fb = h('div', { 'aria-live': 'polite' });
    if (wAnswer) { const o = c.options.find((x) => x[0] === wAnswer); const ok = wAnswer === c.answer; fb.append(h('p', { class: 'w-msg ' + (ok ? 'ok' : 'bad') }, (ok ? 'Correct. ' : 'No. ') + o[2])); }
    const slider = c.windowMs ? null : h('label', { class: 'w-field' }, h('span', {}, 'Try another timeout'),
      h('input', { type: 'range', min: 50, max: 600, step: 10, value: timeout, 'aria-label': 'Watchdog timeout in milliseconds', oninput: (e) => { wTimeout = +e.target.value; draw(); root.querySelector('input[type=range]')?.focus(); } }), h('output', {}, timeout + ' ms'));
    return h('div', {},
      h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Case' }, Object.entries(CHALLENGES).map(([id, t]) =>
        h('button', { type: 'button', class: 'w-tab' + (id === wid ? ' on' : ''), 'aria-pressed': String(id === wid), onclick: () => { wid = id; wAnswer = null; wTimeout = null; draw(); } }, t.title))),
      h('pre', { class: 'w-mono timer-lab-code' }, c.code), h('div', { class: 'timer-lab-wd' }, svg), slider,
      res.resetAt == null ? h('p', { class: 'w-msg warn' }, `With a ${timeout} ms timeout this trace no longer resets — the fault is still there, the watchdog just no longer sees it within this window.`) : null,
      h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, 'Why did the watchdog reset? '), 'Read the code and the timeline, then choose.'),
        h('div', { class: 'timer-lab-opts' }, c.options.map(([id, text]) => h('button', { type: 'button', class: 'btn small ghost' + (wAnswer === id ? ' picked' : ''), onclick: () => { wAnswer = id; if (id === c.answer) ctx?.complete?.(); draw(); } }, text)))),
      fb,
      h('p', { class: 'w-note' }, 'Model: a watchdog that counts up from each feed and resets the chip at the timeout; the windowed case also faults on a feed that comes too early. Task durations are invented. Real watchdogs run from their own slow clock with a wide tolerance, so leave margin.'));
  }

  function draw() {
    clear(root);
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Mode' }, [['timer', 'Timer'], ['watchdog', 'Watchdog']].map(([id, t]) =>
      h('button', { type: 'button', class: 'w-tab' + (id === mode ? ' on' : ''), 'aria-pressed': String(id === mode), onclick: () => { mode = id; draw(); } }, t))));
    root.append(mode === 'timer' ? timerView() : watchdogView());
  }
  draw();
}
