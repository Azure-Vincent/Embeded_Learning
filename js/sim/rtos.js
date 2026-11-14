// Deterministic, tick-granular model of a single-core fixed-priority RTOS scheduler (FreeRTOS-like semantics).
// Pure logic: no DOM, no timers, no randomness. Used by js/widgets/rtos-scheduler.js and tests/rtos.test.mjs.
//
// Model and simplifications:
//  - Time advances in whole ticks. In each tick exactly one of: an ISR, one task, or the idle task executes.
//  - API calls (take/give/send/receive/delay/yield) take zero time and happen at tick boundaries.
//  - Context switches cost nothing. One core only.
//  - Blocking calls wait for ever (portMAX_DELAY); there are no timeouts.
//  - A released mutex is handed straight to the highest-priority waiter.
//  - ISRs are served first-come first-served and are not nested.
//
// cfg = {
//   duration: 40, policy: 'preemptive' | 'cooperative', timeSlice: true, sliceTicks: 1, inheritance: false,
//   mutexes: ['m'], semaphores: [{ name, initial: 0, max: 1 }], queues: [{ name, length: 1 }],
//   tasks: [{ name, priority, start: 0, period?, deadline?, loop?, script: [op, ...] }],
//   interrupts: [{ name, at, period?, duration: 1, give?: 'sem', send?: 'queue' }],
// }
// op = { op: 'run', ticks } | { op: 'delay', ticks } | { op: 'yield' } | { op: 'suspend' }
//    | { op: 'take' | 'give', mutex } | { op: 'semTake' | 'semGive', sem } | { op: 'send' | 'recv', queue }
// A task with `period` runs its script once per release and then waits for the next release (vTaskDelayUntil);
// its relative deadline defaults to the period. A task with `loop` restarts its script immediately.
// Otherwise the script runs once (optional `deadline` is relative to `start`) and the task is then Suspended.

export const STATE = { RUNNING: 'Running', READY: 'Ready', BLOCKED: 'Blocked', SUSPENDED: 'Suspended' };

export function simulate(cfg) {
  const duration = Math.max(1, Math.floor(cfg.duration ?? 40));
  const cooperative = cfg.policy === 'cooperative';
  const timeSlice = cfg.timeSlice !== false;
  const sliceTicks = Math.max(1, Math.floor(cfg.sliceTicks || 1));
  const inheritance = !!cfg.inheritance;

  const events = [];
  const ev = (t, type, task, extra) => { const e = { t, type, task: task ? task.name ?? task : null, ...extra }; events.push(e); return e; };
  let ctr = 0;

  const named = (x) => (typeof x === 'string' ? { name: x } : x);
  const mutexes = new Map((cfg.mutexes || []).map(named).map((m) => [m.name, { name: m.name, owner: null, waiters: [] }]));
  const sems = new Map((cfg.semaphores || []).map(named).map((x) => [x.name, { name: x.name, count: x.initial || 0, max: x.max || 1, waiters: [] }]));
  const queues = new Map((cfg.queues || []).map(named).map((q) => [q.name, { name: q.name, length: q.length || 1, count: 0, recv: [], send: [] }]));
  const need = (map, name, kind) => { const o = map.get(name); if (!o) throw new Error(`unknown ${kind} "${name}"`); return o; };

  const tasks = (cfg.tasks || []).map((c) => {
    const start = Math.max(0, Math.floor(c.start || 0));
    return {
      name: c.name, base: c.priority, eff: c.priority, script: c.script || [], loop: !!c.loop,
      period: c.period > 0 ? Math.floor(c.period) : 0, relDeadline: c.deadline ?? (c.period > 0 ? Math.floor(c.period) : null), start,
      state: 'blocked', on: { kind: 'start', until: start }, pc: 0, rem: null, seq: 0, slice: 0, held: [], job: null,
      blockedSince: 0, wake: null, jobIndex: 0,
      st: { run: 0, jobs: 0, misses: 0, wcrt: 0, maxBlock: 0, firstRun: null, finishedAt: null, responses: [], unfinished: false },
    };
  });
  const result = { duration, timeline: [], events, deadlock: null, isrWakes: [], errors: [] };
  let current = null; // task that ran most recently and has not blocked or yielded since

  const makeReady = (task) => { task.state = 'ready'; task.on = null; task.seq = ++ctr; };
  const block = (task, on, time) => { task.state = 'blocked'; task.on = on; task.blockedSince = time; task.rem = null; if (current === task) current = null; };
  const topWaiter = (list) => {
    let best = -1;
    for (let i = 0; i < list.length; i++) if (best < 0 || list[i].eff > list[best].eff) best = i;
    return best < 0 ? null : list.splice(best, 1)[0];
  };
  const newJob = (task, release, time) => {
    task.job = { release, deadline: task.relDeadline != null ? release + task.relDeadline : null, missed: false, index: task.jobIndex++ };
    ev(time, 'release', task, { job: task.job.index, release, deadline: task.job.deadline, periodic: !!task.period });
  };
  const miss = (task, time) => {
    task.job.missed = true; task.st.misses++;
    ev(task.job.deadline, 'miss', task, { job: task.job.index, release: task.job.release, deadline: task.job.deadline, seenAt: time });
  };
  const finishJob = (task, time) => {
    if (!task.job) return;
    const response = time - task.job.release;
    task.st.responses.push(response); task.st.wcrt = Math.max(task.st.wcrt, response); task.st.jobs++;
    if (task.job.deadline != null && time > task.job.deadline && !task.job.missed) miss(task, time);
    ev(time, 'job-done', task, { job: task.job.index, response, late: task.job.missed });
    task.job = null;
  };
  const recomputeEff = (task, time) => {
    let p = task.base;
    if (inheritance) for (const m of task.held) for (const w of m.waiters) p = Math.max(p, w.eff);
    if (p !== task.eff) { const from = task.eff; task.eff = p; ev(time, p < from ? 'disinherit' : 'inherit', task, { from, to: p }); }
  };
  const findCycle = (task) => {
    const chain = [task]; let t = task;
    while (t.state === 'blocked' && t.on?.kind === 'mutex') {
      const owner = mutexes.get(t.on.name).owner;
      if (!owner) return null;
      if (owner === task) return chain;
      if (chain.includes(owner)) return null; // a cycle that does not include this task was reported earlier
      chain.push(owner); t = owner;
    }
    return null;
  };

  // --- kernel objects -------------------------------------------------------------------------------------------
  function mutexTake(task, m, time) {
    if (!m.owner) { m.owner = task; task.held.push(m); ev(time, 'take', task, { mutex: m.name }); return true; }
    if (m.owner === task) { ev(time, 'error', task, { text: `${task.name} takes ${m.name} which it already holds (a non-recursive mutex would deadlock on itself)` }); result.errors.push(events[events.length - 1]); }
    block(task, { kind: 'mutex', name: m.name }, time); m.waiters.push(task);
    ev(time, 'take-block', task, { mutex: m.name, owner: m.owner.name });
    if (inheritance) {
      let o = m.owner; const seen = new Set();
      while (o && !seen.has(o) && o.eff < task.eff) {
        seen.add(o); const from = o.eff; o.eff = task.eff; ev(time, 'inherit', o, { from, to: o.eff, because: task.name, mutex: m.name });
        o = o.state === 'blocked' && o.on?.kind === 'mutex' ? mutexes.get(o.on.name).owner : null;
      }
    }
    const cycle = findCycle(task);
    if (cycle) {
      const d = { t: time, tasks: cycle.map((x) => x.name), mutexes: cycle.map((x) => x.on.name) };
      if (!result.deadlock) result.deadlock = d;
      ev(time, 'deadlock', null, { tasks: d.tasks, mutexes: d.mutexes });
    }
    return false;
  }
  function mutexGive(task, m, time) {
    if (m.owner !== task) { const e = ev(time, 'error', task, { text: `${task.name} gives ${m.name} without holding it` }); result.errors.push(e); return; }
    task.held.splice(task.held.indexOf(m), 1);
    ev(time, 'give', task, { mutex: m.name });
    const w = topWaiter(m.waiters);
    m.owner = w;
    if (w) {
      const waited = time - w.blockedSince; w.st.maxBlock = Math.max(w.st.maxBlock, waited);
      w.held.push(m); makeReady(w); w.pc++;
      ev(time, 'take', w, { mutex: m.name, handed: true, waited });
      recomputeEff(w, time);
    }
    recomputeEff(task, time);
  }
  function wakeFrom(list, time, type, extra, isr) {
    const w = topWaiter(list);
    if (!w) return null;
    makeReady(w); w.pc++;
    ev(time, type, w, { ...extra, woken: true, waited: time - w.blockedSince });
    if (isr) { const rec = { isr: isr.name, at: isr.at, exit: time, task: w.name, ranAt: null, latency: null }; result.isrWakes.push(rec); w.wake = rec; }
    return w;
  }
  function semGive(sem, time, by, isr) {
    ev(time, isr ? 'isr-give' : 'semGive', by, { sem: sem.name, isr: isr?.name });
    if (wakeFrom(sem.waiters, time, 'semTake', { sem: sem.name }, isr)) return;
    if (sem.count < sem.max) sem.count++;
    else ev(time, 'lost', by, { sem: sem.name, isr: isr?.name });
  }
  function queueSend(q, time, task, isr) {
    if (q.recv.length) { ev(time, isr ? 'isr-send' : 'send', task, { queue: q.name, isr: isr?.name }); wakeFrom(q.recv, time, 'recv', { queue: q.name }, isr); return true; }
    if (q.count < q.length) { q.count++; ev(time, isr ? 'isr-send' : 'send', task, { queue: q.name, isr: isr?.name, depth: q.count }); return true; }
    if (isr) { ev(time, 'drop', null, { queue: q.name, isr: isr.name }); return true; }
    block(task, { kind: 'queueSend', name: q.name }, time); q.send.push(task);
    ev(time, 'send-block', task, { queue: q.name });
    return false;
  }
  function queueRecv(q, time, task) {
    if (q.count > 0) {
      q.count--; ev(time, 'recv', task, { queue: q.name, depth: q.count });
      const s = topWaiter(q.send);
      if (s) { q.count++; makeReady(s); s.pc++; ev(time, 'send', s, { queue: q.name, woken: true, depth: q.count }); }
      return true;
    }
    block(task, { kind: 'queueRecv', name: q.name }, time); q.recv.push(task);
    ev(time, 'recv-block', task, { queue: q.name });
    return false;
  }

  // Execute the task's zero-time operations until it reaches a `run` with ticks left, or stops being Ready.
  // Returns true if anything happened (so the scheduler must look again at who should run).
  function advance(task, time) {
    let did = false, guard = 0;
    while (task.state === 'ready') {
      if (++guard > 500) {
        const e = ev(time, 'error', task, { text: `${task.name} loops without ever consuming time or blocking` }); result.errors.push(e);
        task.state = 'suspended'; task.on = null; if (current === task) current = null; return true;
      }
      if (task.pc >= task.script.length) {
        did = true; finishJob(task, time); task.pc = 0; task.rem = null;
        if (task.period) {
          const next = task.lastRelease + task.period;
          if (next <= time) { task.lastRelease = next; newJob(task, next, time); continue; }
          block(task, { kind: 'period', until: next }, time); break;
        }
        if (task.loop && task.script.length) continue;
        task.state = 'suspended'; task.on = null; task.st.finishedAt = time; if (current === task) current = null;
        ev(time, 'finish', task, {});
        break;
      }
      const op = task.script[task.pc];
      if (op.op === 'run') {
        if (task.rem == null) task.rem = Math.max(0, Math.floor(op.ticks));
        if (task.rem > 0) break;
        task.rem = null; task.pc++; did = true; continue;
      }
      did = true;
      switch (op.op) {
        case 'delay': {
          const n = Math.max(0, Math.floor(op.ticks));
          task.pc++;
          if (n > 0) { ev(time, 'delay', task, { ticks: n }); block(task, { kind: 'delay', until: time + n }, time); }
          break;
        }
        case 'yield': task.pc++; task.seq = ++ctr; if (current === task) current = null; ev(time, 'yield', task, {}); return true;
        case 'suspend': task.pc++; task.state = 'suspended'; task.on = null; if (current === task) current = null; ev(time, 'suspend', task, {}); break;
        case 'take': if (mutexTake(task, need(mutexes, op.mutex, 'mutex'), time)) task.pc++; break;
        case 'give': mutexGive(task, need(mutexes, op.mutex, 'mutex'), time); task.pc++; break;
        case 'semTake': {
          const sem = need(sems, op.sem, 'semaphore');
          if (sem.count > 0) { sem.count--; task.pc++; ev(time, 'semTake', task, { sem: sem.name }); }
          else { block(task, { kind: 'sem', name: sem.name }, time); sem.waiters.push(task); ev(time, 'semTake-block', task, { sem: sem.name }); }
          break;
        }
        case 'semGive': semGive(need(sems, op.sem, 'semaphore'), time, task, null); task.pc++; break;
        case 'send': if (queueSend(need(queues, op.queue, 'queue'), time, task, null)) task.pc++; break;
        case 'recv': if (queueRecv(need(queues, op.queue, 'queue'), time, task)) task.pc++; break;
        default: throw new Error(`unknown op "${op.op}" in task ${task.name}`);
      }
    }
    return did;
  }

  function pick() {
    if (cooperative && current && current.state === 'ready') return current;
    let best = null;
    for (const t of tasks) if (t.state === 'ready' && (!best || t.eff > best.eff || (t.eff === best.eff && t.seq < best.seq))) best = t;
    return best;
  }
  const describeOn = (on) => {
    if (!on) return null;
    if (on.kind === 'mutex') return { kind: 'mutex', name: on.name, owner: mutexes.get(on.name).owner?.name ?? null };
    return { ...on };
  };
  const snapshot = (running, interrupted) => {
    const states = {};
    for (const t of tasks) {
      const state = t === running || t === interrupted ? STATE.RUNNING : t.state === 'ready' ? STATE.READY : t.state === 'blocked' ? STATE.BLOCKED : STATE.SUSPENDED;
      states[t.name] = { state, on: describeOn(t.on), eff: t.eff, base: t.base, holds: t.held.map((m) => m.name), interrupted: t === interrupted || undefined };
    }
    return states;
  };

  // --- main loop ------------------------------------------------------------------------------------------------
  const irqs = (cfg.interrupts || []).map((i) => ({ name: i.name || 'IRQ', at: Math.max(0, Math.floor(i.at || 0)), period: i.period > 0 ? Math.floor(i.period) : 0, duration: Math.max(1, Math.floor(i.duration || 1)), give: i.give, send: i.send }));
  const pendingIsr = [];
  const st = { idle: 0, isr: 0, switches: 0 };
  let lastRunner; // name of last non-ISR runner, null for idle, undefined before the first tick
  let lastTask = null;

  const timeEvents = (t) => {
    for (const task of tasks) {
      if (task.state !== 'blocked' || task.on.until == null || task.on.until > t) continue;
      const kind = task.on.kind;
      makeReady(task);
      if (kind === 'delay') ev(t, 'wake', task, {});
      else if (kind === 'start') { ev(t, 'create', task, { priority: task.base }); task.lastRelease = task.start; if (task.period || !task.loop) newJob(task, task.start, t); }
      else { task.lastRelease += task.period; newJob(task, task.lastRelease, t); }
    }
  };
  const deadlineWatch = (t) => { for (const task of tasks) if (task.job && !task.job.missed && task.job.deadline != null && t >= task.job.deadline) miss(task, t); };

  for (let t = 0; t < duration; t++) {
    deadlineWatch(t);
    timeEvents(t);
    for (const i of irqs) if (t >= i.at && (i.period ? (t - i.at) % i.period === 0 : t === i.at)) pendingIsr.push({ ...i, at: t, rem: i.duration, started: false });

    if (pendingIsr.length) {
      const i = pendingIsr[0];
      const interrupted = lastTask && lastTask.state === 'ready' && lastTask === current ? lastTask : null;
      if (!i.started) { i.started = true; ev(t, 'isr-enter', null, { isr: i.name, interrupted: interrupted?.name ?? null }); }
      result.timeline.push({ run: null, isr: i.name, states: snapshot(null, interrupted) });
      st.isr++; i.rem--;
      if (i.rem === 0) {
        pendingIsr.shift();
        if (i.give) semGive(need(sems, i.give, 'semaphore'), t + 1, null, i);
        if (i.send) queueSend(need(queues, i.send, 'queue'), t + 1, null, i);
        ev(t + 1, 'isr-exit', null, { isr: i.name });
      }
      continue;
    }

    let chosen = null, guard = 0;
    for (;;) {
      chosen = pick();
      if (!chosen || !advance(chosen, t)) break;
      if (++guard > 2000) { chosen = null; break; }
    }
    const runner = chosen ? chosen.name : null;
    if (lastRunner !== undefined && runner !== lastRunner) { st.switches++; ev(t, 'switch', null, { from: lastRunner, to: runner }); }
    lastRunner = runner;
    result.timeline.push({ run: runner, isr: null, states: snapshot(chosen, null) });
    if (!chosen) { st.idle++; lastTask = null; current = null; continue; }

    if (chosen !== lastTask) chosen.slice = 0;
    lastTask = chosen; current = chosen;
    chosen.rem--; chosen.st.run++;
    if (chosen.st.firstRun == null) chosen.st.firstRun = t;
    if (chosen.wake) { if (chosen.wake.ranAt == null) { chosen.wake.ranAt = t; chosen.wake.latency = t - chosen.wake.at; } chosen.wake = null; }
    chosen.slice++;
    if (!cooperative && timeSlice && chosen.slice >= sliceTicks) { chosen.seq = ++ctr; chosen.slice = 0; }
    if (chosen.rem === 0) advance(chosen, t + 1);
  }
  deadlineWatch(duration);

  const taskStats = {};
  for (const t of tasks) {
    t.st.unfinished = !!t.job;
    t.st.util = t.st.run / duration;
    t.st.priority = t.base;
    t.st.finalState = t.state === 'ready' ? (t === current ? STATE.RUNNING : STATE.READY) : t.state === 'blocked' ? STATE.BLOCKED : STATE.SUSPENDED;
    taskStats[t.name] = t.st;
  }
  result.stats = { tasks: taskStats, idle: st.idle, isr: st.isr, switches: st.switches, idleUtil: st.idle / duration, isrUtil: st.isr / duration };
  result.taskNames = tasks.map((t) => t.name);
  return result;
}

/** Total CPU demand of the periodic tasks, sum(C/T). Above 1 no scheduler can meet every deadline. */
export function utilisation(taskList) {
  return taskList.reduce((u, t) => u + (t.period > 0 ? t.script.reduce((c, op) => c + (op.op === 'run' ? op.ticks : 0), 0) / t.period : 0), 0);
}
