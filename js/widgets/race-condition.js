// Race condition stepper: the learner is the scheduler and chooses which context executes its next micro-step.
import { h, clear } from '../core/dom.js';

export const SCENARIOS = {
  counter: { title: 'Lost update: counter++' },
  'check-then-act': { title: 'Check-then-act on a flag' },
};
export const VARIANTS = { tasks: 'Two tasks', isr: 'Main loop and interrupt' };
export const FIXES = {
  none: 'No protection',
  mutex: 'Mutex around the sequence',
  'irq-off': 'Disable interrupts around the sequence',
  atomic: 'Atomic operation',
};
/** Fixes that make sense for a variant. An ISR cannot block, so it cannot take a mutex. */
export const fixesFor = (variant) => (variant === 'isr' ? ['none', 'irq-off', 'atomic'] : ['none', 'mutex', 'atomic']);

const STEP = {
  LOAD: { code: 'tmp = counter;', asm: 'LOAD  r0 ← [counter]' },
  ADD: { code: 'tmp = tmp + 1;', asm: 'ADD   r0 ← r0 + 1' },
  STORE: { code: 'counter = tmp;', asm: 'STORE [counter] ← r0' },
  ATOMIC_ADD: { code: 'atomic_fetch_add(&counter, 1);', asm: 'one indivisible read-modify-write' },
  CHECK: { code: 'if (!busy) {', asm: 'LOAD  r0 ← [busy]; branch if set' },
  SET: { code: '    busy = true;', asm: 'STORE [busy] ← 1' },
  USE: { code: '    use_radio(); }', asm: 'call use_radio' },
  TAS: { code: 'if (!atomic_flag_test_and_set(&busy)) {', asm: 'one indivisible read-and-set' },
  LOCK: { code: 'xSemaphoreTake(lock, portMAX_DELAY);', asm: 'take mutex (may block)' },
  UNLOCK: { code: 'xSemaphoreGive(lock);', asm: 'give mutex' },
  IRQ_OFF: { code: 'taskENTER_CRITICAL();', asm: 'mask interrupts' },
  IRQ_ON: { code: 'taskEXIT_CRITICAL();', asm: 'unmask interrupts' },
};

/** Step ids one context executes. `actor` is 0 or 1; in the isr variant 0 is the main loop and 1 the ISR. */
export function program(scenario, variant, fix, actor) {
  const isIsr = variant === 'isr' && actor === 1;
  const body = scenario === 'counter' ? ['LOAD', 'ADD', 'STORE'] : ['CHECK', 'SET', 'USE'];
  if (fix === 'atomic') return scenario === 'counter' ? ['ATOMIC_ADD'] : ['TAS', 'USE'];
  if (fix === 'mutex' && variant === 'tasks') return scenario === 'counter' ? ['LOCK', ...body, 'UNLOCK'] : ['LOCK', 'CHECK', 'SET', 'UNLOCK', 'USE'];
  if (fix === 'irq-off' && variant === 'isr' && !isIsr) return scenario === 'counter' ? ['IRQ_OFF', ...body, 'IRQ_ON'] : ['IRQ_OFF', 'CHECK', 'SET', 'IRQ_ON', 'USE'];
  return body;
}

export function makeRace(scenario = 'counter', variant = 'tasks', fix = 'none') {
  if (!SCENARIOS[scenario]) scenario = 'counter';
  if (!VARIANTS[variant]) variant = 'tasks';
  if (!fixesFor(variant).includes(fix)) fix = 'none';
  const names = variant === 'isr' ? ['main loop', 'ISR'] : ['Task A', 'Task B'];
  return {
    scenario, variant, fix,
    shared: { counter: 0, busy: 0, claims: 0 }, lock: null, irqOff: false,
    actors: names.map((name, i) => ({ name, steps: program(scenario, variant, fix, i), pc: 0, reg: null })),
    history: [],
  };
}
const done = (a) => a.pc >= a.steps.length;
export const finished = (st) => st.actors.every(done);

/** Can context i execute its next step now? Returns { ok, why }. */
export function enabled(st, i) {
  const a = st.actors[i], o = st.actors[1 - i];
  if (done(a)) return { ok: false, why: `${a.name} has finished.` };
  if (st.variant === 'isr') {
    if (i === 0 && o.pc > 0 && !done(o)) return { ok: false, why: 'The ISR has the CPU. An interrupt handler runs to completion; the main loop cannot resume in the middle of it.' };
    if (i === 1 && st.irqOff) return { ok: false, why: 'Interrupts are masked. The request stays pending and the ISR will run as soon as the main loop unmasks them, after its sequence is complete.' };
  }
  if (a.steps[a.pc] === 'LOCK' && st.lock != null && st.lock !== i) return { ok: false, why: `${a.name} is Blocked: the mutex is held by ${o.name}. The scheduler cannot run a Blocked task, so it cannot get inside the sequence until ${o.name} gives the mutex.` };
  return { ok: true, why: '' };
}

/** Execute context i's next step. Returns a new state; the input is not modified. Throws if not enabled. */
export function step(st, i) {
  const en = enabled(st, i);
  if (!en.ok) throw new Error(en.why);
  const n = { ...st, shared: { ...st.shared }, actors: st.actors.map((a) => ({ ...a })), history: st.history.slice() };
  const a = n.actors[i], id = a.steps[a.pc], sh = n.shared;
  let note = '';
  switch (id) {
    case 'LOAD': a.reg = sh.counter; note = `reads counter = ${a.reg}`; break;
    case 'ADD': a.reg += 1; note = `its private copy is now ${a.reg}`; break;
    case 'STORE': note = `writes ${a.reg} over counter = ${sh.counter}`; sh.counter = a.reg; break;
    case 'ATOMIC_ADD': sh.counter += 1; note = `counter becomes ${sh.counter} in one step`; break;
    case 'CHECK': a.reg = sh.busy; note = a.reg ? 'sees busy = true and skips the block' : 'sees busy = false and decides to go ahead'; break;
    case 'TAS': a.reg = sh.busy; sh.busy = 1; note = a.reg ? 'busy was already true: skips the block' : 'busy was false and is now true, in one step'; break;
    case 'SET': if (a.reg === 0) { sh.busy = 1; note = 'sets busy = true'; } else note = 'skipped'; break;
    case 'USE': if (a.reg === 0) { sh.claims += 1; note = sh.claims > 1 ? 'uses the radio although the other context claimed it too' : 'uses the radio'; } else note = 'skipped'; break;
    case 'LOCK': n.lock = i; note = 'takes the mutex'; break;
    case 'UNLOCK': n.lock = null; note = 'gives the mutex'; break;
    case 'IRQ_OFF': n.irqOff = true; note = 'masks interrupts'; break;
    case 'IRQ_ON': n.irqOff = false; note = 'unmasks interrupts'; break;
    default: throw new Error('unknown step ' + id);
  }
  a.pc++;
  n.history.push({ actor: i, id, note });
  return n;
}

/** Verdict on a finished run. */
export function outcome(st) {
  if (st.scenario === 'counter') {
    const bug = st.shared.counter !== 2;
    return { bug, text: bug ? `Two increments ran, but counter is ${st.shared.counter}. One update was lost: the second STORE wrote a value computed from a stale read.` : 'counter is 2: both increments counted.' };
  }
  const bug = st.shared.claims > 1;
  return { bug, text: bug ? 'Both contexts found busy = false and both used the radio. The check and the act were separated by the other context\'s check.' : `${st.shared.claims} context used the radio; the other saw busy = true and backed off.` };
}

/** Enumerate every schedule the model allows. Returns { total, buggy, example } (example: actor indices of one buggy schedule). */
export function explore(scenario, variant, fix) {
  let total = 0, buggy = 0, example = null;
  (function walk(st, path) {
    if (finished(st)) { total++; if (outcome(st).bug) { buggy++; example ??= path; } return; }
    for (const i of [0, 1]) if (enabled(st, i).ok) walk(step(st, i), [...path, i]);
  })(makeRace(scenario, variant, fix), []);
  return { total, buggy, example };
}

const FIX_NOTE = {
  mutex: 'A mutex makes the other task Block at its own xSemaphoreTake() until the holder is finished. Use it between tasks. Never in an ISR: an interrupt handler has nothing to block on.',
  'irq-off': 'With interrupts masked the ISR cannot start, so the sequence cannot be split. The interrupt is delayed, not lost, but every masked microsecond adds to interrupt latency: keep it to a few instructions. On a multi-core chip masking interrupts on one core does not stop the other core; ESP-IDF critical sections take a spinlock for that reason.',
  atomic: 'An atomic operation has no middle for a switch to land in. C11 <stdatomic.h> provides these; whether a given type is lock-free on your core is something to check (ATOMIC_INT_LOCK_FREE), because a small core may implement it by briefly masking interrupts.',
  none: '',
};

let uid = 0;
export default function mount(el, props = {}, ctx = {}) {
  const id = `race${++uid}`;
  let scenario = SCENARIOS[props.scenario] ? props.scenario : 'counter';
  let variant = VARIANTS[props.variant] ? props.variant : 'tasks';
  let fix = 'none';
  let st, msg = null, refused = false, foundBug = false, verified = false, completed = false, sweep = null;
  const root = h('div', { class: 'race-condition' });
  clear(el).append(root);

  const reset = (keepMsg) => { st = makeRace(scenario, variant, fix); refused = false; if (!keepMsg) msg = null; sweep = null; };
  const setAll = (sc, v, f) => { scenario = sc; variant = v; fix = fixesFor(v).includes(f) ? f : 'none'; reset(); render(); };

  function act(i) {
    const en = enabled(st, i);
    if (!en.ok) { refused = true; msg = { cls: 'warn', text: 'Refused. ' + en.why }; render(i); return; }
    st = step(st, i); msg = null;
    if (finished(st)) {
      const o = outcome(st);
      if (fix === 'none') {
        if (o.bug) { foundBug = true; msg = { cls: 'ok', text: `You found it. ${o.text} Now choose a protection below and try to do the same thing again.` }; }
        else msg = { cls: 'bad', text: `${o.text} This order happens to work, which is why such bugs survive testing: most schedules are fine. Reset and switch context in the middle of a sequence.` };
      } else if (o.bug) msg = { cls: 'bad', text: o.text };
      else {
        const tried = fix === 'atomic' || refused;
        if (tried) verified = true;
        msg = { cls: 'ok', text: `${o.text} ${tried ? 'The protection held.' : 'Correct, but you did not try to break it. Reset and try to switch context in the middle of the protected sequence, or check every interleaving.'}` };
      }
    }
    if (foundBug && verified && !completed) { completed = true; ctx.complete?.(); }
    render(i);
  }

  function render(focusActor) {
    clear(root);
    const tabs = (label, map, cur, on, keys = Object.keys(map)) => h('div', { class: 'w-tabs', role: 'group', 'aria-label': label }, keys.map((k) =>
      h('button', { type: 'button', class: 'w-tab' + (k === cur ? ' on' : ''), 'aria-pressed': k === cur ? 'true' : 'false', onclick: () => on(k) }, map[k].title || map[k])));
    root.append(tabs('Scenario', SCENARIOS, scenario, (k) => setAll(k, variant, fix)), tabs('Contexts', VARIANTS, variant, (k) => setAll(scenario, k, fix)));

    const goal = scenario === 'counter'
      ? 'Each context runs counter++ once, so counter should end at 2. Find an order of steps that leaves it at 1.'
      : 'The flag is supposed to let only one context use the radio. Find an order of steps in which both use it.';
    const tick = (ok) => h('span', { class: ok ? 'ok' : 'muted' }, ok ? '✓ ' : '○ ');
    root.append(h('div', { class: 'w-task' },
      h('p', {}, tick(foundBug), h('strong', {}, '1. Break it. '), 'You are the scheduler. ', goal),
      h('p', {}, tick(verified), h('strong', {}, '2. Fix it and verify. '), 'Choose a protection, then try the same interleaving again. The step you need will be refused. Finish the run to confirm the result.')));

    root.append(h('div', { class: 'row' }, h('span', { class: 'tag' }, 'Protection'),
      tabs('Protection', FIXES, fix, (k) => { if (k !== 'none' && !foundBug) { msg = { cls: 'warn', text: 'Find the failing interleaving first. A fix you have not seen fail is a fix you cannot test.' }; render(); return; } setAll(scenario, variant, k); }, fixesFor(variant))));
    if (variant === 'isr') root.append(h('p', { class: 'w-note' }, 'The interrupt can fire between any two steps of the main loop. Once it starts, the ISR runs to completion. A mutex is not offered here: an ISR must never block.'));

    const sh = st.shared;
    const sharedBox = h('div', { class: 'race-condition-shared', 'aria-live': 'polite' },
      h('div', { class: 'tag' }, 'Shared memory'),
      scenario === 'counter' ? h('div', { class: 'race-condition-var' }, h('span', {}, 'counter'), h('b', {}, sh.counter)) : [
        h('div', { class: 'race-condition-var' }, h('span', {}, 'busy'), h('b', {}, sh.busy ? 'true' : 'false')),
        h('div', { class: 'race-condition-var' }, h('span', {}, 'contexts using the radio'), h('b', { class: sh.claims > 1 ? 'race-condition-bad' : '' }, sh.claims))],
      st.fix === 'mutex' ? h('div', { class: 'race-condition-var' }, h('span', {}, 'mutex'), h('b', {}, st.lock == null ? 'free' : `held by ${st.actors[st.lock].name}`)) : null,
      st.fix === 'irq-off' ? h('div', { class: 'race-condition-var' }, h('span', {}, 'interrupts'), h('b', {}, st.irqOff ? 'masked' : 'enabled')) : null);

    const col = (i) => {
      const a = st.actors[i], en = enabled(st, i), fin = a.pc >= a.steps.length;
      const btn = h('button', { type: 'button', class: 'btn small race-condition-step' + (en.ok ? '' : ' refused'), id: `${id}-b${i}`, disabled: fin, 'aria-disabled': !en.ok && !fin ? 'true' : null, onclick: () => act(i) },
        fin ? 'Finished' : variant === 'isr' && i === 1 && a.pc === 0 ? 'Fire the interrupt' : `Run next step of ${a.name}`);
      return h('div', { class: `race-condition-actor race-condition-a${i}` },
        h('div', { class: 'race-condition-head' }, h('strong', {}, a.name), h('span', { class: 'w-mono' }, scenario === 'counter' && fix !== 'atomic' ? `tmp (r0) = ${a.reg ?? '?'}` : a.reg == null ? '' : `saw busy = ${a.reg ? 'true' : 'false'}`)),
        h('ol', { class: 'race-condition-steps' }, a.steps.map((sid, k) => h('li', { class: k < a.pc ? 'done' : k === a.pc ? 'cur' : '', 'aria-current': k === a.pc ? 'step' : null },
          h('code', {}, STEP[sid].code), h('span', { class: 'race-condition-asm' }, STEP[sid].asm)))),
        btn);
    };
    root.append(h('div', { class: 'race-condition-stage' }, col(0), sharedBox, col(1)));

    root.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn small ghost', disabled: st.history.length === 0, onclick: () => { reset(); render(); } }, 'Reset'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => {
        if (fix === 'none' && !foundBug) { msg = { cls: 'warn', text: 'That would give the answer away. Find one failing order by hand first.' }; render(); return; }
        sweep = explore(scenario, variant, fix);
        if (fix !== 'none' && sweep.buggy === 0 && foundBug) { verified = true; if (!completed) { completed = true; ctx.complete?.(); } }
        render();
      } }, 'Check every interleaving')));
    if (sweep) root.append(h('div', { class: 'w-msg ' + (sweep.buggy ? 'bad' : 'ok'), role: 'status' },
      `The model allows ${sweep.total} different order${sweep.total === 1 ? '' : 's'} of these steps; ${sweep.buggy} give${sweep.buggy === 1 ? 's' : ''} the wrong result.`,
      sweep.buggy ? ' A test that runs the code once will usually pass. That does not make the code correct.' : ' Unlike a test run, this covers all of them, which is what "verified" has to mean for concurrency.'));
    if (msg) root.append(h('div', { class: 'w-msg ' + msg.cls, role: 'status' }, msg.text));

    root.append(h('div', { class: 'tag race-condition-htag' }, 'Order of execution so far'),
      h('ol', { class: 'race-condition-history' }, st.history.length ? st.history.map((e) => h('li', { class: `race-condition-a${e.actor}` }, h('strong', {}, st.actors[e.actor].name), ' ', h('code', {}, e.id), ' ', e.note)) : h('li', { class: 'muted' }, 'Nothing has run yet.')));
    if (fix !== 'none') root.append(h('p', { class: 'w-note' }, FIX_NOTE[fix]));
    root.append(h('p', { class: 'w-note' }, 'Model: one core, and a context switch or interrupt can land between any two of the steps shown. Real compilers may emit counter++ as one instruction or as several, depending on the core and optimisation level; code that is only correct for one of those is not correct. On two cores the same interleavings happen with no switch at all.'));
    if (focusActor != null) {
      const b = root.querySelector(`#${id}-b${focusActor}`);
      const other = root.querySelector(`#${id}-b${1 - focusActor}`);
      (b && !b.disabled ? b : other && !other.disabled ? other : null)?.focus();
    }
  }

  reset(); render();
}
