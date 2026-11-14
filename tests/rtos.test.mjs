import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, utilisation, STATE } from '../js/sim/rtos.js';
import { SCENARIOS, describeEvent } from '../js/widgets/rtos-scheduler.js';
import * as race from '../js/widgets/race-condition.js';

const run = (ticks) => ({ op: 'run', ticks });
const lane = (res) => res.timeline.map((t) => (t.isr ? '!' : t.run ? t.run[0] : '.')).join('');

test('preemption: a higher-priority release takes the CPU immediately and the lower task resumes afterwards', () => {
  const res = simulate({ duration: 8, tasks: [
    { name: 'Low', priority: 1, script: [run(5)] },
    { name: 'High', priority: 3, start: 2, script: [run(2)] },
  ] });
  assert.equal(lane(res), 'LLHHLLL.');
  assert.equal(res.timeline[2].states.Low.state, STATE.READY);
  assert.equal(res.timeline[0].states.High.state, STATE.BLOCKED);
  assert.equal(res.timeline[5].states.High.state, STATE.SUSPENDED);
  assert.equal(res.stats.tasks.High.wcrt, 2);
  assert.equal(res.stats.tasks.Low.wcrt, 7);
  assert.equal(res.stats.switches, 3); // L→H, H→L, L→idle
  assert.equal(res.stats.tasks.Low.util, 5 / 8);
});

test('round-robin: equal priorities rotate every slice; without slicing the first runs to completion', () => {
  const tasks = ['A', 'B', 'C'].map((name) => ({ name, priority: 2, script: [run(4)] }));
  const rr = simulate({ duration: 13, tasks });
  assert.equal(lane(rr), 'ABCABCABCABC.');
  assert.deepEqual(['A', 'B', 'C'].map((n) => rr.stats.tasks[n].finishedAt), [10, 11, 12]);
  assert.equal(lane(simulate({ duration: 13, timeSlice: false, tasks })), 'AAAABBBBCCCC.');
  assert.equal(lane(simulate({ duration: 13, sliceTicks: 2, tasks })), 'AABBCCAABBCC.');
});

test('cooperative: a task that never yields starves a higher-priority task; preemptive does not', () => {
  const tasks = [
    { name: 'Hog', priority: 1, loop: true, script: [run(100)] },
    { name: 'Urgent', priority: 5, start: 2, period: 5, script: [run(1)] },
  ];
  const coop = simulate({ duration: 20, policy: 'cooperative', tasks });
  assert.equal(coop.stats.tasks.Urgent.run, 0);
  assert.ok(coop.stats.tasks.Urgent.misses >= 1);
  assert.equal(coop.timeline[10].states.Urgent.state, STATE.READY);
  const pre = simulate({ duration: 20, tasks });
  assert.equal(pre.stats.tasks.Urgent.misses, 0);
  assert.equal(pre.stats.tasks.Urgent.run, 4);
});

test('cooperative: the switch happens at taskYIELD and goes to the highest-priority Ready task', () => {
  const res = simulate({ duration: 12, policy: 'cooperative', tasks: [
    { name: 'Work', priority: 1, loop: true, script: [run(4), { op: 'yield' }] },
    { name: 'Ui', priority: 3, start: 1, script: [run(1)] },
  ] });
  assert.equal(lane(res), 'WWWWUWWWWWWW');
});

test('taskYIELD does not let a lower-priority task run; vTaskDelay does', () => {
  const mk = (tail) => ({ duration: 12, tasks: [
    { name: 'Poll', priority: 2, loop: true, script: [run(1), tail] },
    { name: 'Bg', priority: 1, script: [run(3)] },
  ] });
  assert.equal(simulate(mk({ op: 'yield' })).stats.tasks.Bg.run, 0);
  const d = simulate(mk({ op: 'delay', ticks: 2 }));
  assert.equal(lane(d), 'PBBPB.P..P..');
});

const inversion = (inheritance, medium = 6) => simulate({ duration: 40, inheritance, mutexes: ['m'], tasks: [
  { name: 'H', priority: 3, start: 2, script: [run(1), { op: 'take', mutex: 'm' }, run(2), { op: 'give', mutex: 'm' }] },
  { name: 'M', priority: 2, start: 3, script: [run(medium)] },
  { name: 'L', priority: 1, script: [run(1), { op: 'take', mutex: 'm' }, run(4), { op: 'give', mutex: 'm' }, run(1)] },
] });

test('priority inversion: without inheritance H waits for the rest of the critical section plus all of M', () => {
  const res = inversion(false);
  assert.equal(lane(res).slice(0, 16), 'LLHMMMMMMLLLHHL.');
  assert.equal(res.stats.tasks.H.maxBlock, 9); // 3 ticks of critical section left + 6 of M
  assert.equal(res.stats.tasks.H.finishedAt, 14);
  assert.equal(inversion(false, 12).stats.tasks.H.maxBlock, 15); // grows with M: unbounded
  assert.deepEqual(res.timeline[4].states.H.on, { kind: 'mutex', name: 'm', owner: 'L' });
});

test('priority inheritance: the wait is bounded by the critical section, whatever M does', () => {
  const res = inversion(true);
  assert.equal(lane(res).slice(0, 16), 'LLHLLLHHMMMMMML.');
  assert.equal(res.stats.tasks.H.maxBlock, 3);
  assert.equal(res.stats.tasks.H.finishedAt, 8);
  assert.equal(inversion(true, 12).stats.tasks.H.maxBlock, 3);
  assert.equal(res.timeline[4].states.L.eff, 3);
  assert.equal(res.timeline[4].states.L.base, 1);
  assert.equal(res.timeline[14].states.L.eff, 1);
  const types = res.events.filter((e) => e.task === 'L').map((e) => e.type);
  assert.ok(types.includes('inherit') && types.includes('disinherit'));
});

test('deadlock: opposite lock order is detected as a cycle; the same order is not', () => {
  const mk = (bOrder) => simulate({ duration: 14, mutexes: ['M1', 'M2'], tasks: [
    { name: 'A', priority: 2, start: 1, script: [{ op: 'take', mutex: 'M1' }, run(2), { op: 'take', mutex: 'M2' }, run(1), { op: 'give', mutex: 'M2' }, { op: 'give', mutex: 'M1' }] },
    { name: 'B', priority: 1, script: [{ op: 'take', mutex: bOrder[0] }, run(2), { op: 'take', mutex: bOrder[1] }, run(1), { op: 'give', mutex: bOrder[1] }, { op: 'give', mutex: bOrder[0] }] },
  ] });
  const bad = mk(['M2', 'M1']);
  assert.equal(bad.deadlock.t, 4);
  assert.deepEqual([...bad.deadlock.tasks].sort(), ['A', 'B']);
  assert.equal(lane(bad), 'BAAB..........');
  assert.equal(bad.stats.tasks.A.finalState, STATE.BLOCKED);
  const good = mk(['M1', 'M2']);
  assert.equal(good.deadlock, null);
  assert.ok(good.stats.tasks.A.finishedAt != null && good.stats.tasks.B.finishedAt != null);
});

test('deferred interrupt: the ISR preempts everything and the handler latency depends on its priority', () => {
  const mk = (prio, policy) => simulate({ duration: 20, policy, semaphores: ['sem'],
    interrupts: [{ name: 'IRQ', at: 4, duration: 1, give: 'sem' }],
    tasks: [
      { name: 'Handler', priority: prio, loop: true, script: [{ op: 'semTake', sem: 'sem' }, run(2)] },
      { name: 'Worker', priority: 2, script: [run(8)] },
    ] });
  const hi = mk(3);
  assert.equal(lane(hi).slice(0, 12), 'WWWW!HHWWWW.');
  assert.deepEqual(hi.isrWakes.map((w) => [w.at, w.exit, w.ranAt, w.latency]), [[4, 5, 5, 1]]);
  assert.equal(hi.timeline[4].states.Worker.interrupted, true);
  assert.equal(hi.stats.isr, 1);
  const lo = mk(1); // Worker runs first, so Handler only reaches xSemaphoreTake after it; the give is latched
  assert.equal(lane(lo).slice(0, 12), 'WWWW!WWWWHH.');
  assert.equal(lo.stats.tasks.Handler.firstRun, 9);
  const coop = mk(3, 'cooperative'); // Handler is woken but must wait for Worker to finish
  assert.equal(coop.isrWakes[0].latency, 5);
});

test('binary semaphore latches one event: a second give from the ISR before it is taken is lost', () => {
  const res = simulate({ duration: 20, semaphores: ['sem'], interrupts: [{ name: 'IRQ', at: 2, period: 4, give: 'sem' }],
    tasks: [{ name: 'Busy', priority: 2, loop: true, script: [run(50)] }, { name: 'Handler', priority: 1, loop: true, script: [{ op: 'semTake', sem: 'sem' }, run(1)] }] });
  assert.equal(res.events.filter((e) => e.type === 'isr-give').length, 5);
  assert.equal(res.events.filter((e) => e.type === 'lost').length, 4);
});

test('queues block the receiver when empty and the sender when full', () => {
  const res = simulate({ duration: 12, queues: [{ name: 'q', length: 1 }], tasks: [
    { name: 'Consumer', priority: 2, loop: true, script: [{ op: 'recv', queue: 'q' }, run(2)] },
    { name: 'Producer', priority: 1, script: [run(1), { op: 'send', queue: 'q' }, { op: 'send', queue: 'q' }, { op: 'send', queue: 'q' }, run(1)] },
  ] });
  // Producer's first send wakes Consumer (preempts); later sends fill the queue and then block.
  assert.equal(lane(res), 'PCCCCCCP....');
  const types = res.events.map((e) => e.type);
  assert.ok(types.includes('recv-block') && types.includes('send-block'));
  assert.equal(res.stats.tasks.Consumer.run, 6);
});

test('periodic tasks: deadlines, response times and utilisation', () => {
  const tasks = [
    { name: 'Fast', priority: 1, period: 5, script: [run(1)] },
    { name: 'Slow', priority: 2, period: 20, script: [run(6)] },
  ];
  const res = simulate({ duration: 20, tasks });
  assert.equal(res.stats.tasks.Fast.misses, 1);
  assert.deepEqual(res.events.filter((e) => e.type === 'miss').map((e) => [e.task, e.deadline]), [['Fast', 5]]);
  assert.equal(res.stats.tasks.Fast.wcrt, 7);
  assert.ok(Math.abs(utilisation(tasks) - 0.5) < 1e-9);
  const total = Object.values(res.stats.tasks).reduce((n, t) => n + t.run, 0) + res.stats.idle + res.stats.isr;
  assert.equal(total, 20);
});

test('determinism and error reporting', () => {
  const cfg = SCENARIOS['isr-defer'].build(Object.fromEntries(SCENARIOS['isr-defer'].params.map((p) => [p.id, p.value])));
  assert.deepEqual(simulate(cfg), simulate(cfg));
  const spin = simulate({ duration: 5, tasks: [{ name: 'Spin', priority: 1, loop: true, script: [{ op: 'yield' }] }] });
  assert.equal(spin.errors.length, 1);
  assert.throws(() => simulate({ tasks: [{ name: 'X', priority: 1, script: [{ op: 'take', mutex: 'nope' }] }] }), /unknown mutex/);
});

// ---- scenarios of the rtos-scheduler widget ----
const defaults = (sc) => Object.fromEntries(sc.params.map((p) => [p.id, p.value]));
const check = (id, change = {}) => { const sc = SCENARIOS[id], d = defaults(sc), p = { ...d, ...change }; const res = simulate(sc.build(p)); return { ...sc.check(p, res, d), res }; };

test('every scenario is well formed, unsolved by default, and every event has a description', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['preemptive', 'cooperative', 'round-robin', 'priority-inversion', 'priority-inheritance', 'deadlock', 'isr-defer', 'starvation']);
  for (const [id, sc] of Object.entries(SCENARIOS)) {
    assert.ok(sc.title && sc.framing && sc.task && sc.code, id);
    assert.ok(sc.predict.answer >= 0 && sc.predict.answer < sc.predict.options.length, id);
    const r = check(id);
    assert.equal(r.ok, false, `${id} must not be solved by default`);
    assert.ok(r.msg.length > 20, id);
    assert.equal(r.res.errors.length, 0, id);
    for (const e of r.res.events) { const d = describeEvent(e); if (d) assert.ok(typeof d.text === 'string' && !/undefined|null/.test(d.text), `${id}: ${e.type}: ${d.text}`); }
    for (const p of sc.params) if (p.type === 'int') assert.ok(p.value >= p.min && p.value <= p.max, `${id}.${p.id}`);
  }
});

test('the facts quoted in the prediction answers match the simulator', () => {
  assert.equal(check('preemptive').res.stats.tasks.Sensor.firstRun, 9);
  assert.equal(check('cooperative').res.timeline.findIndex((t, i) => i > 0 && t.run === 'UI'), 9);
  assert.deepEqual(['A', 'B', 'C'].map((n) => check('round-robin').res.stats.tasks[n].finishedAt), [10, 11, 12]);
  assert.equal(check('priority-inversion').res.timeline[3].run, 'Medium');
  assert.equal(check('priority-inheritance').res.timeline[3].states.Low.eff, 3);
  const dl = check('deadlock').res;
  assert.equal(dl.deadlock.t, 4);
  assert.ok(dl.timeline.slice(4).every((t) => t.run === null));
  assert.equal(check('isr-defer').res.stats.tasks.Handler.run, 0);
  assert.equal(check('starvation').res.stats.tasks.Background.run, 0);
});

test('intended fixes pass and tempting non-fixes are rejected with a reason', () => {
  assert.ok(check('preemptive', { pS: 3, pC: 2, pL: 1 }).ok);
  assert.ok(!check('preemptive', { cL: 1 }).ok);
  assert.ok(check('cooperative', { chunk: 4 }).ok);
  assert.ok(!check('cooperative', { policy: 'preemptive' }).ok);
  assert.ok(check('round-robin', { pA: 3 }).ok);
  assert.ok(check('round-robin', { slice: false }).ok);
  assert.ok(!check('round-robin', { cA: 2 }).ok);
  assert.ok(check('priority-inversion', { lock: 'mutex' }).ok);
  assert.ok(check('priority-inversion', { crit: 1 }).ok);
  const shortM = check('priority-inversion', { mrun: 2 }); // meets the deadline by luck only
  assert.equal(shortM.res.stats.tasks.High.misses, 0);
  assert.ok(!shortM.ok && /unbounded/.test(shortM.msg));
  assert.ok(!check('priority-inversion', { pM: 1, pL: 2 }).ok);
  assert.ok(check('priority-inheritance', { crit: 3 }).ok);
  assert.ok(!check('priority-inheritance', { crit: 3, lock: 'binary' }).ok);
  assert.ok(check('deadlock', { orderB: '12' }).ok);
  assert.ok(check('deadlock', { orderA: '21' }).ok);
  const lucky = check('deadlock', { startA: 4 }); // B is finished before A arrives
  assert.equal(lucky.res.deadlock, null);
  assert.ok(!lucky.ok && /timing/.test(lucky.msg));
  assert.ok(check('isr-defer', { pH: 3 }).ok);
  assert.ok(!check('isr-defer', { pH: 2 }).ok);
  assert.ok(check('starvation', { delay: 1 }).ok);
  assert.ok(!check('starvation', { pP: 1, pB: 2 }).ok);
});

// ---- race-condition ----
test('race: unprotected sequences have failing interleavings, but most orders pass', () => {
  for (const sc of Object.keys(race.SCENARIOS)) for (const v of Object.keys(race.VARIANTS)) {
    const r = race.explore(sc, v, 'none');
    assert.ok(r.buggy > 0 && r.buggy < r.total, `${sc}/${v}: ${r.buggy}/${r.total}`);
    let st = race.makeRace(sc, v, 'none');
    for (const i of r.example) st = race.step(st, i);
    assert.ok(race.finished(st) && race.outcome(st).bug);
  }
  assert.deepEqual(race.explore('counter', 'tasks', 'none'), { total: 20, buggy: 18, example: [0, 0, 1, 0, 1, 1] });
});

test('race: every offered fix removes all failing interleavings', () => {
  for (const sc of Object.keys(race.SCENARIOS)) for (const v of Object.keys(race.VARIANTS)) for (const f of race.fixesFor(v)) {
    if (f === 'none') continue;
    const r = race.explore(sc, v, f);
    assert.ok(r.total >= 1, `${sc}/${v}/${f}`);
    assert.equal(r.buggy, 0, `${sc}/${v}/${f}`);
  }
  assert.ok(!race.fixesFor('isr').includes('mutex'));
});

test('race: the classic lost update, and the scheduler refusing it under a mutex', () => {
  let st = race.makeRace('counter', 'tasks', 'none');
  for (const i of [0, 1, 0, 1, 0, 1]) st = race.step(st, i); // LOAD LOAD ADD ADD STORE STORE
  assert.equal(st.shared.counter, 1);
  assert.ok(race.outcome(st).bug);
  st = race.makeRace('counter', 'tasks', 'mutex');
  st = race.step(st, 0); st = race.step(st, 0); // A: LOCK, LOAD
  assert.equal(race.enabled(st, 1).ok, false);
  assert.match(race.enabled(st, 1).why, /Blocked/);
  assert.throws(() => race.step(st, 1));
  for (let k = 0; k < 3; k++) st = race.step(st, 0);
  for (let k = 0; k < 5; k++) st = race.step(st, 1);
  assert.equal(st.shared.counter, 2);
});

test('race: ISR runs to completion and is held off while interrupts are masked', () => {
  let st = race.makeRace('counter', 'isr', 'none');
  st = race.step(st, 0); st = race.step(st, 1); // main LOAD, interrupt fires
  assert.equal(race.enabled(st, 0).ok, false);
  st = race.step(st, 1); st = race.step(st, 1); st = race.step(st, 0); st = race.step(st, 0);
  assert.equal(st.shared.counter, 1);
  st = race.step(race.makeRace('counter', 'isr', 'irq-off'), 0);
  assert.equal(race.enabled(st, 1).ok, false);
  assert.match(race.enabled(st, 1).why, /pending/);
  assert.equal(race.makeRace('counter', 'isr', 'mutex').fix, 'none');
});

test('race: check-then-act lets both contexts in, test-and-set does not', () => {
  let st = race.makeRace('check-then-act', 'tasks', 'none');
  for (const i of [0, 1, 0, 0, 1, 1]) st = race.step(st, i);
  assert.equal(st.shared.claims, 2);
  st = race.makeRace('check-then-act', 'tasks', 'atomic');
  for (const i of [0, 1, 0, 1]) st = race.step(st, i);
  assert.equal(st.shared.claims, 1);
});
