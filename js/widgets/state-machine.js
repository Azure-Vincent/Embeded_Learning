import { h, s, clear } from '../core/dom.js';
import { highlight } from '../core/highlight.js';

// Firmware state machines, stepped one event at a time. Each machine is a table of transitions
// { from, on, to, guard, act, label, note }; the first transition whose state, event and guard match is taken.
// The C shown beside the diagram is the same logic written as a switch on the state variable.

const hx = (b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0');

export const MACHINES = {
  debounce: {
    title: 'Button debounce',
    intro: 'A mechanical button bounces for a few milliseconds. This machine samples the pin on every timer tick and only reports a press or release after three equal samples in a row.',
    goal: 'Report exactly one press and one release, even though the contacts bounce on the way.',
    states: { RELEASED: [150, 110], MAYBE_PRESSED: [530, 110], PRESSED: [530, 280], MAYBE_RELEASED: [150, 280] },
    initial: 'RELEASED',
    vars: () => ({ count: 0, presses: 0, releases: 0, bounces: 0 }),
    events: [{ id: 'low', label: 'tick: pin reads 0 (pressed)' }, { id: 'high', label: 'tick: pin reads 1 (released)' }],
    presets: [{ label: 'Bouncy press', events: ['low', 'high', 'low', 'low', 'high', 'low', 'low', 'low'] }, { label: 'Bouncy release', events: ['high', 'low', 'high', 'high', 'high'] }],
    transitions: [
      { from: 'RELEASED', on: 'low', to: 'MAYBE_PRESSED', act: (v) => { v.count = 1; }, label: 'low / count = 1' },
      { from: 'RELEASED', on: 'high', to: 'RELEASED', label: 'high' },
      { from: 'MAYBE_PRESSED', on: 'low', guard: (v) => v.count + 1 >= 3, to: 'PRESSED', act: (v) => { v.count = 0; v.presses++; }, label: 'low, 3rd in a row / report press', note: 'three equal samples: the press is real' },
      { from: 'MAYBE_PRESSED', on: 'low', to: 'MAYBE_PRESSED', act: (v) => { v.count++; }, label: 'low / count++' },
      { from: 'MAYBE_PRESSED', on: 'high', to: 'RELEASED', act: (v) => { v.count = 0; v.bounces++; }, label: 'high / bounce, discard', note: 'the pin went back before three samples agreed: treated as a bounce' },
      { from: 'PRESSED', on: 'high', to: 'MAYBE_RELEASED', act: (v) => { v.count = 1; }, label: 'high / count = 1' },
      { from: 'PRESSED', on: 'low', to: 'PRESSED', label: 'low' },
      { from: 'MAYBE_RELEASED', on: 'high', guard: (v) => v.count + 1 >= 3, to: 'RELEASED', act: (v) => { v.count = 0; v.releases++; }, label: 'high, 3rd in a row / report release', note: 'three equal samples: the release is real' },
      { from: 'MAYBE_RELEASED', on: 'high', to: 'MAYBE_RELEASED', act: (v) => { v.count++; }, label: 'high / count++' },
      { from: 'MAYBE_RELEASED', on: 'low', to: 'PRESSED', act: (v) => { v.count = 0; v.bounces++; }, label: 'low / bounce, discard', note: 'still held: the high sample was a bounce' },
    ],
    done: (v) => v.presses === 1 && v.releases === 1 && v.bounces >= 1,
    doneText: 'One press and one release were reported although the pin bounced. Without the two MAYBE states each bounce would have counted as a separate press.',
    showVars: (v) => `count=${v.count} presses=${v.presses} releases=${v.releases} bounces rejected=${v.bounces}`,
    code: `typedef enum { RELEASED, MAYBE_PRESSED, PRESSED, MAYBE_RELEASED } state_t;
static state_t state = RELEASED;
static uint8_t count;

void debounce_tick(bool pin_low) {       /* called from a periodic timer */
    switch (state) {
    case RELEASED:
        if (pin_low) { count = 1; state = MAYBE_PRESSED; }
        break;
    case MAYBE_PRESSED:
        if (!pin_low)          { state = RELEASED; }           /* bounce */
        else if (++count >= 3) { state = PRESSED; on_press(); }
        break;
    case PRESSED:
        if (!pin_low) { count = 1; state = MAYBE_RELEASED; }
        break;
    case MAYBE_RELEASED:
        if (pin_low)           { state = PRESSED; }            /* bounce */
        else if (++count >= 3) { state = RELEASED; on_release(); }
        break;
    }
}`,
  },
  'uart-parser': {
    title: 'UART frame parser',
    intro: 'Bytes arrive one at a time, so the parser must remember where it is in the frame. Frame format: start byte 0x7E, length (1 to 4), that many payload bytes, then a checksum equal to the sum of the payload bytes modulo 256.',
    goal: 'Get one frame accepted and one frame rejected for a bad checksum. A valid frame is 7E 02 05 02 07.',
    states: { WAIT_START: [150, 110], READ_LEN: [530, 110], READ_PAYLOAD: [530, 280], READ_CHECKSUM: [150, 280] },
    initial: 'WAIT_START',
    vars: () => ({ len: 0, idx: 0, sum: 0, accepted: 0, rejected: 0, badLen: 0 }),
    events: [0x7E, 0x02, 0x05, 0x07, 0x00, 0xFF].map((b) => ({ id: b, label: `byte ${hx(b)}` })),
    freeByte: true,
    presets: [{ label: 'Valid frame', events: [0x7E, 0x02, 0x05, 0x02, 0x07] }, { label: 'Corrupted frame', events: [0x7E, 0x02, 0x05, 0x02, 0x08] }],
    transitions: [
      { from: 'WAIT_START', on: '*', guard: (v, b) => b === 0x7E, to: 'READ_LEN', label: '0x7E' },
      { from: 'WAIT_START', on: '*', to: 'WAIT_START', label: 'other / ignore', note: 'not a start byte: noise between frames is ignored' },
      { from: 'READ_LEN', on: '*', guard: (v, b) => b >= 1 && b <= 4, to: 'READ_PAYLOAD', act: (v, b) => { v.len = b; v.idx = 0; v.sum = 0; }, label: 'len 1..4 / idx = 0, sum = 0' },
      { from: 'READ_LEN', on: '*', to: 'WAIT_START', act: (v) => { v.badLen++; }, label: 'bad length / drop', note: 'the length is checked before it is used: a length of 0 or more than the buffer holds is rejected here, which is what stops a buffer overflow' },
      { from: 'READ_PAYLOAD', on: '*', guard: (v) => v.idx + 1 >= v.len, to: 'READ_CHECKSUM', act: (v, b) => { v.sum = (v.sum + b) & 0xFF; v.idx++; }, label: 'last payload byte' },
      { from: 'READ_PAYLOAD', on: '*', to: 'READ_PAYLOAD', act: (v, b) => { v.sum = (v.sum + b) & 0xFF; v.idx++; }, label: 'payload byte / store, sum += b' },
      { from: 'READ_CHECKSUM', on: '*', guard: (v, b) => b === v.sum, to: 'WAIT_START', act: (v) => { v.accepted++; }, label: 'checksum ok / handle frame', note: 'checksum matches: the frame is handed to the application' },
      { from: 'READ_CHECKSUM', on: '*', to: 'WAIT_START', act: (v) => { v.rejected++; }, label: 'checksum wrong / drop', note: 'checksum mismatch: the whole frame is discarded' },
    ],
    done: (v) => v.accepted >= 1 && v.rejected >= 1,
    doneText: 'One frame was accepted and one was dropped. Note that a 0x7E inside the payload is just data here: only the state decides what a byte means.',
    showVars: (v) => `len=${v.len} idx=${v.idx} sum=${hx(v.sum)} accepted=${v.accepted} bad checksum=${v.rejected} bad length=${v.badLen}`,
    code: `typedef enum { WAIT_START, READ_LEN, READ_PAYLOAD, READ_CHECKSUM } state_t;
static state_t state = WAIT_START;
static uint8_t buf[4], len, idx, sum;

void parser_feed(uint8_t b) {            /* called for every received byte */
    switch (state) {
    case WAIT_START:
        if (b == 0x7E) state = READ_LEN;
        break;
    case READ_LEN:
        if (b >= 1 && b <= sizeof buf) { len = b; idx = 0; sum = 0; state = READ_PAYLOAD; }
        else state = WAIT_START;         /* never trust a length field */
        break;
    case READ_PAYLOAD:
        buf[idx++] = b;
        sum += b;
        if (idx == len) state = READ_CHECKSUM;
        break;
    case READ_CHECKSUM:
        if (b == sum) handle_frame(buf, len);
        state = WAIT_START;
        break;
    }
}`,
  },
  'door-lock': {
    title: 'Door lock',
    intro: 'A keypad lock with the code 4 2. Three wrong codes in a row cause a lockout that only a timeout clears. Every state has to say what each event does, including the ones it ignores.',
    goal: 'Unlock the door once, and separately drive the lock into LOCKOUT.',
    states: { LOCKED: [150, 110], ENTERING: [530, 110], UNLOCKED: [530, 280], LOCKOUT: [150, 280] },
    initial: 'LOCKED',
    vars: () => ({ buf: '', fails: 0, unlocks: 0, lockouts: 0 }),
    events: [{ id: 'k4', label: 'key 4' }, { id: 'k2', label: 'key 2' }, { id: 'k7', label: 'key 7' }, { id: 'enter', label: 'key #' }, { id: 'timeout', label: 'timeout' }, { id: 'lock', label: 'lock button' }],
    presets: [{ label: 'Correct code', events: ['k4', 'k2', 'enter'] }, { label: 'Wrong code', events: ['k7', 'k7', 'enter'] }],
    transitions: [
      { from: 'LOCKED', on: ['k4', 'k2', 'k7'], to: 'ENTERING', act: (v, e) => { v.buf = e[1]; }, label: 'digit / start code' },
      { from: 'ENTERING', on: ['k4', 'k2', 'k7'], to: 'ENTERING', act: (v, e) => { if (v.buf.length < 4) v.buf += e[1]; }, label: 'digit / append (max 4)' },
      { from: 'ENTERING', on: 'enter', guard: (v) => v.buf === '42', to: 'UNLOCKED', act: (v) => { v.buf = ''; v.fails = 0; v.unlocks++; }, label: '# and code ok / open latch' },
      { from: 'ENTERING', on: 'enter', guard: (v) => v.fails + 1 >= 3, to: 'LOCKOUT', act: (v) => { v.buf = ''; v.fails++; v.lockouts++; }, label: '# and 3rd wrong code', note: 'third wrong code in a row: further guesses are refused' },
      { from: 'ENTERING', on: 'enter', to: 'LOCKED', act: (v) => { v.buf = ''; v.fails++; }, label: '# and wrong code / fails++' },
      { from: 'ENTERING', on: 'timeout', to: 'LOCKED', act: (v) => { v.buf = ''; }, label: 'timeout / clear code', note: 'a half-typed code does not stay in memory' },
      { from: 'UNLOCKED', on: ['lock', 'timeout'], to: 'LOCKED', label: 'lock button or timeout / close latch' },
      { from: 'LOCKOUT', on: 'timeout', to: 'LOCKED', act: (v) => { v.fails = 0; }, label: 'timeout / fails = 0' },
    ],
    done: (v) => v.unlocks >= 1 && v.lockouts >= 1,
    doneText: 'The door has been unlocked and the lock has been driven into lockout. In LOCKOUT the correct code is ignored too: the state, not the code, decides.',
    showVars: (v) => `code so far="${v.buf}" wrong attempts=${v.fails} unlocks=${v.unlocks} lockouts=${v.lockouts}`,
    code: `typedef enum { LOCKED, ENTERING, UNLOCKED, LOCKOUT } state_t;
static state_t state = LOCKED;
static char code[5];
static uint8_t n, fails;

void lock_event(event_t ev, char key) {
    switch (state) {
    case LOCKED:
        if (ev == EV_DIGIT) { n = 0; code[n++] = key; state = ENTERING; }
        break;
    case ENTERING:
        if (ev == EV_DIGIT)        { if (n < 4) code[n++] = key; }
        else if (ev == EV_TIMEOUT) { n = 0; state = LOCKED; }
        else if (ev == EV_ENTER) {
            if (code_matches(code, n)) { fails = 0; latch_open(); state = UNLOCKED; }
            else if (++fails >= 3)     { state = LOCKOUT; }
            else                       { state = LOCKED; }
            n = 0;
        }
        break;
    case UNLOCKED:
        if (ev == EV_LOCK || ev == EV_TIMEOUT) { latch_close(); state = LOCKED; }
        break;
    case LOCKOUT:
        if (ev == EV_TIMEOUT) { fails = 0; state = LOCKED; }
        break;                     /* every other event is ignored */
    }
}`,
  },
};

/** A fresh machine instance: { id, state, vars }. */
export function create(id) {
  const m = MACHINES[id] || MACHINES.debounce;
  return { id: MACHINES[id] ? id : 'debounce', state: m.initial, vars: m.vars() };
}
/**
 * Apply one event. Returns { state, vars, from, to, transition (index or -1), label, note, ignored }.
 * The input instance is not modified.
 */
export function step(inst, event) {
  const m = MACHINES[inst.id], vars = { ...inst.vars };
  const idx = m.transitions.findIndex((t) => t.from === inst.state && (t.on === '*' || t.on === event || (Array.isArray(t.on) && t.on.includes(event))) && (!t.guard || t.guard(vars, event)));
  if (idx < 0) return { id: inst.id, state: inst.state, vars, from: inst.state, to: inst.state, transition: -1, label: 'ignored', note: `${inst.state} has no transition for this event, so nothing changes`, ignored: true };
  const t = m.transitions[idx];
  if (t.act) t.act(vars, event);
  return { id: inst.id, state: t.to, vars, from: t.from, to: t.to, transition: idx, label: t.label, note: t.note || '', ignored: false };
}
/** Run a list of events from a fresh instance; returns the final instance. */
export function runEvents(id, events) { return events.reduce((inst, e) => step(inst, e), create(id)); }
/** 0-based [first, last] line range of `case STATE:` in a machine's C code. */
export function caseRange(code, state) {
  const lines = code.split('\n'), a = lines.findIndex((l) => new RegExp(`^\\s*case ${state}:`).test(l));
  if (a < 0) return null;
  let b = a + 1;
  while (b < lines.length && !/^\s*case \w+:/.test(lines[b]) && !/^ {4}\}/.test(lines[b])) b++;
  return [a, b - 1];
}
/** Distinct from->to edges with their combined labels, for drawing. */
export function edges(id) {
  const out = [];
  MACHINES[id].transitions.forEach((t, i) => {
    let e = out.find((x) => x.from === t.from && x.to === t.to);
    if (!e) { e = { from: t.from, to: t.to, labels: [], idx: [] }; out.push(e); }
    e.labels.push(t.label); e.idx.push(i);
  });
  return out;
}

const BW = 150, BH = 44;
function rim(cx, cy, tx, ty) { // point where the line from the box centre towards (tx,ty) leaves the box
  const dx = tx - cx, dy = ty - cy, k = Math.min(dx ? (BW / 2) / Math.abs(dx) : Infinity, dy ? (BH / 2) / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

export default function mount(el, props = {}, ctx = {}) {
  let id = MACHINES[props.machine] ? props.machine : 'debounce';
  let inst = create(id), log = [], last = null, solved = !!(ctx.isDone && ctx.isDone()), timer = null;
  const uid = 'sm' + Math.random().toString(36).slice(2, 8);
  clear(el);
  el.classList.add('state-machine');
  const body = h('div', {});
  const tabs = props.machine && MACHINES[props.machine] ? null : h('div', { class: 'w-tabs' }, Object.entries(MACHINES).map(([k, m]) => h('button', { type: 'button', class: 'w-tab', 'data-m': k, onclick: () => { id = k; reset(); } }, m.title)));
  el.append(tabs || '', body);

  function reset() { if (timer) clearTimeout(timer); timer = null; inst = create(id); log = []; last = null; render(); }
  function fire(ev, label) {
    const r = step(inst, ev);
    last = r; inst = { id, state: r.state, vars: r.vars };
    log.push({ n: log.length + 1, ev: label, from: r.from, to: r.to, label: r.label, note: r.note, ignored: r.ignored });
    const m = MACHINES[id];
    if (!solved && m.done(inst.vars)) { solved = true; if (ctx.complete) ctx.complete(); }
    render();
  }
  function play(events) {
    if (timer) clearTimeout(timer);
    const m = MACHINES[id], q = [...events];
    const next = () => {
      timer = null;
      if (!el.isConnected || !q.length) return;
      const e = q.shift(), def = m.events.find((x) => x.id === e);
      fire(e, def ? def.label : `byte ${hx(e)}`);
      if (q.length) timer = setTimeout(next, 450);
    };
    next();
  }
  function diagram(m) {
    const svg = s('svg', { class: 'w-svg state-machine-svg', viewBox: '0 0 680 390', role: 'img', 'aria-label': `State diagram of ${m.title}. Current state: ${inst.state}.` },
      s('defs', {},
        s('marker', { id: uid + 'a', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z', class: 'state-machine-head' })),
        s('marker', { id: uid + 'b', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z', class: 'state-machine-head on' }))));
    for (const e of edges(id)) {
      const on = last && !last.ignored && e.idx.includes(last.transition);
      const [ax, ay] = m.states[e.from], [bx, by] = m.states[e.to];
      let d, lx, ly;
      if (e.from === e.to) {
        const up = ay < 195, yy = up ? ay - BH / 2 : ay + BH / 2, k = up ? -1 : 1;
        d = `M${ax - 22} ${yy} C${ax - 50} ${yy + k * 50} ${ax + 50} ${yy + k * 50} ${ax + 22} ${yy}`; lx = ax; ly = yy + k * 46 + (up ? 0 : 8);
      } else {
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, bow = 34;
        const cx = (ax + bx) / 2 + nx * bow, cy = (ay + by) / 2 + ny * bow;
        const [sx, sy] = rim(ax, ay, cx, cy), [tx, ty] = rim(bx, by, cx, cy);
        d = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
        lx = 0.25 * sx + 0.5 * cx + 0.25 * tx + nx * 4; ly = 0.25 * sy + 0.5 * cy + 0.25 * ty + ny * 10 + 4;
      }
      svg.append(s('path', { d, class: 'state-machine-edge' + (on ? ' on' : ''), 'marker-end': `url(#${uid}${on ? 'b' : 'a'})` }));
      const short = e.labels.map((l) => l.split(' / ')[0]);
      const text = s('text', { x: lx, y: ly - (short.length - 1) * 6, 'text-anchor': 'middle', class: 'state-machine-elabel' + (on ? ' on' : '') });
      short.forEach((l, i) => text.append(s('tspan', { x: lx, dy: i ? 12 : 0 }, l)));
      svg.append(text);
    }
    for (const [name, [x, y]] of Object.entries(m.states)) {
      svg.append(s('rect', { x: x - BW / 2, y: y - BH / 2, width: BW, height: BH, rx: 22, class: 'state-machine-node' + (name === inst.state ? ' on' : '') }),
        s('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'state-machine-nlabel' + (name === inst.state ? ' on' : '') }, name));
      if (name === m.initial) svg.append(s('path', { d: `M${x - BW / 2 - 34} ${y} L${x - BW / 2 - 2} ${y}`, class: 'state-machine-edge', 'marker-end': `url(#${uid}a)` }), s('circle', { cx: x - BW / 2 - 38, cy: y, r: 4, class: 'state-machine-start' }));
    }
    return svg;
  }
  function render() {
    const m = MACHINES[id];
    if (tabs) for (const b of tabs.children) b.classList.toggle('on', b.dataset.m === id);
    clear(body);
    const range = caseRange(m.code, inst.state);
    const code = h('pre', { class: 'code state-machine-code', tabindex: '0', 'aria-label': `C implementation; the case for ${inst.state} is highlighted` },
      m.code.split('\n').map((line, i) => h('span', { class: 'state-machine-line' + (range && i >= range[0] && i <= range[1] ? ' on' : ''), html: (highlight(line, 'c') || ' ') + '\n' })));
    const byteIn = m.freeByte ? h('input', { type: 'text', class: 'mono', size: 6, placeholder: '0x41', 'aria-label': 'Any byte value' }) : null;
    const sendByte = () => { const n = Number(byteIn.value.trim()); if (Number.isInteger(n) && n >= 0 && n <= 255) fire(n, `byte ${hx(n)}`); else byteIn.focus(); };
    if (byteIn) byteIn.onkeydown = (e) => { if (e.key === 'Enter') sendByte(); };
    const logEl = h('ol', { class: 'state-machine-log', 'aria-label': 'Event log' }, log.length ? log.slice(-40).map((l) => h('li', { class: l.ignored ? 'ign' : '', value: l.n },
      h('span', { class: 'state-machine-ev' }, l.ev), ' ', l.ignored ? h('span', {}, `ignored in ${l.from}`) : h('span', {}, `${l.from} → ${l.to}`),
      l.note ? h('div', { class: 'state-machine-note' }, l.note) : null)) : h('li', { class: 'ign', value: 0 }, 'No events yet. Send one with the buttons above.'));
    body.append(
      h('p', { class: 'state-machine-intro' }, m.intro),
      h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, 'Task: '), m.goal, ' Before each event, predict the next state.')),
      h('div', { class: 'w-grid state-machine-grid' },
        h('div', {},
          diagram(m),
          h('div', { class: 'w-readout' }, h('div', {}, h('div', { class: 'k' }, 'state'), h('div', { class: 'v' }, inst.state)), h('div', {}, h('div', { class: 'k' }, 'variables'), h('div', { class: 'v state-machine-vars' }, m.showVars(inst.vars)))),
          h('div', { class: 'tag' }, 'Send an event'),
          h('div', { class: 'row' }, m.events.map((e) => h('button', { type: 'button', class: 'btn small', onclick: () => fire(e.id, e.label) }, e.label)),
            byteIn ? [byteIn, h('button', { type: 'button', class: 'btn small ghost', onclick: sendByte }, 'Send byte')] : null),
          h('div', { class: 'row' }, m.presets.map((p) => h('button', { type: 'button', class: 'btn small ghost', onclick: () => play(p.events) }, `Play: ${p.label}`)),
            h('button', { type: 'button', class: 'btn small ghost', onclick: reset }, 'Reset')),
          solved && m.done(inst.vars) ? h('div', { class: 'w-msg ok' }, m.doneText) : null,
          h('div', { class: 'tag' }, 'Event log'), logEl),
        h('div', {}, h('div', { class: 'tag' }, 'The same machine in C'), code,
          h('p', { class: 'w-note' }, 'The highlighted case is the only code that can run for the next event. Helper functions such as on_press() are left out.'))),
      h('p', { class: 'w-note' }, 'Model: events are applied one at a time and instantly. Real firmware also has to decide where events come from (a timer tick, a UART interrupt) and must not let an interrupt change the state in the middle of a transition.'));
    logEl.scrollTop = logEl.scrollHeight;
  }
  render();
}
