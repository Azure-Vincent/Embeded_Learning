// RTOS scheduler: a Gantt timeline of a small task set run by js/sim/rtos.js, with a prediction question and a
// task per scenario that the simulator checks.
import { h, s, clear } from '../core/dom.js';
import { simulate } from '../sim/rtos.js';

const int = (id, group, label, value, min = 1, max = 9) => ({ id, group, label, type: 'int', value, min, max });
const bool = (id, group, label, value) => ({ id, group, label, type: 'bool', value });
const sel = (id, group, label, value, options) => ({ id, group, label, type: 'select', value, options });
const same = (p, d, ids) => ids.every((id) => p[id] === d[id]);
const run = (ticks) => ({ op: 'run', ticks });
const totalMisses = (res) => Object.values(res.stats.tasks).reduce((n, t) => n + t.misses, 0);
const firstMiss = (res) => res.events.find((e) => e.type === 'miss');

function inversionCfg(p) {
  return {
    duration: p._duration ?? 20, inheritance: p.lock === 'mutex', mutexes: ['lock'],
    tasks: [
      { name: 'High', priority: p.pH, start: 2, deadline: p._deadline, script: [run(1), { op: 'take', mutex: 'lock' }, run(2), { op: 'give', mutex: 'lock' }] },
      { name: 'Medium', priority: p.pM, start: 3, script: [run(p.mrun)] },
      { name: 'Low', priority: p.pL, start: 0, script: [run(1), { op: 'take', mutex: 'lock' }, run(p.crit), { op: 'give', mutex: 'lock' }, run(1)] },
    ],
  };
}
const inversionParams = (lock) => [
  sel('lock', 'Kernel', 'lock type', lock, [['binary', 'binary semaphore (no inheritance)'], ['mutex', 'mutex (priority inheritance)']]),
  int('pH', 'High', 'priority', 3), int('pM', 'Medium', 'priority', 2), int('mrun', 'Medium', 'run ticks', 6, 1, 10),
  int('pL', 'Low', 'priority', 1), int('crit', 'Low', 'critical section ticks', 4, 1, 8),
];
const INVERSION_CODE = `SemaphoreHandle_t lock = xSemaphoreCreateMutex();   // has priority inheritance
// xSemaphoreCreateBinary() has none: do not use it to guard data

void low_task(void *arg) {
    prepare();                                   // 1 tick
    xSemaphoreTake(lock, portMAX_DELAY);
    update_shared_state();                       // the critical section
    xSemaphoreGive(lock);
    finish();                                    // 1 tick
    vTaskSuspend(NULL);
}`;

function deadlockCfg(p) {
  const order = (o) => (o === '12' ? ['M1', 'M2'] : ['M2', 'M1']);
  const body = (o) => { const [a, b] = order(o); return [{ op: 'take', mutex: a }, run(2), { op: 'take', mutex: b }, run(1), { op: 'give', mutex: b }, { op: 'give', mutex: a }]; };
  return {
    duration: 14, inheritance: true, mutexes: ['M1', 'M2'],
    tasks: [
      { name: 'A', priority: p.pA, start: p.startA, script: body(p.orderA) },
      { name: 'B', priority: p.pB, start: 0, script: body(p.orderB) },
    ],
  };
}

export const SCENARIOS = {
  preemptive: {
    title: 'Fixed-priority preemption',
    framing: 'Three periodic tasks share one CPU. The scheduler always runs the highest-priority task that is Ready, and takes the CPU away from a lower one the moment a higher one becomes Ready. Here the priorities were assigned by "importance": the logger got the highest.',
    params: [
      int('pS', 'Sensor', 'priority', 1), int('tS', 'Sensor', 'period', 5, 2, 20), int('cS', 'Sensor', 'run ticks', 1, 1, 10),
      int('pC', 'Control', 'priority', 2), int('tC', 'Control', 'period', 10, 2, 20), int('cC', 'Control', 'run ticks', 3, 1, 10),
      int('pL', 'Logger', 'priority', 3), int('tL', 'Logger', 'period', 20, 2, 40), int('cL', 'Logger', 'run ticks', 6, 1, 20),
    ],
    build: (p) => ({
      duration: 40,
      tasks: [
        { name: 'Sensor', priority: p.pS, period: p.tS, script: [run(p.cS)] },
        { name: 'Control', priority: p.pC, period: p.tC, script: [run(p.cC)] },
        { name: 'Logger', priority: p.pL, period: p.tL, script: [run(p.cL)] },
      ],
    }),
    predict: {
      q: 'All three tasks are released at tick 0. Sensor (priority 1) needs 1 tick and must finish within 5. In which tick does Sensor first get the CPU?',
      options: ['Tick 0: it has the shortest deadline', 'Tick 5: at its next release', 'Tick 9: after Logger (6 ticks) and Control (3 ticks)', 'Never'],
      answer: 2,
      why: 'A fixed-priority scheduler knows nothing about deadlines. Logger (priority 3) runs ticks 0 to 5, Control (priority 2) ticks 6 to 8, and only then is Sensor the highest-priority Ready task. Its deadline at tick 5 has already gone.',
    },
    task: 'Make every task meet its deadline (deadline = period) for the whole 40 ticks by changing priorities only. The periods and run times are the work that has to be done.',
    check(p, res, d) {
      if (!same(p, d, ['tS', 'tC', 'tL', 'cS', 'cC', 'cL'])) return { ok: false, msg: 'You changed a period or a run time. That changes the job, not the schedule: put them back and solve it with priorities.' };
      const m = firstMiss(res);
      if (m) return { ok: false, msg: `${m.task} missed the deadline at tick ${m.deadline}: something with a higher priority and a long run time held the CPU through its whole period. Which task can least afford to wait?` };
      return { ok: true, msg: 'No deadline missed. Giving the shortest period the highest priority is rate-monotonic assignment; for deadlines equal to periods no other fixed assignment succeeds where it fails. The demand here is 1/5 + 3/10 + 6/20 = 80 % of the CPU either way: priorities changed who waits, not how much work there is.' };
    },
    code: `xTaskCreate(sensor_task, "Sensor", STACK, NULL, 3, NULL);   // 5th argument: priority

void sensor_task(void *arg) {
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        read_sensor();                    // Running for 1 tick
        vTaskDelayUntil(&last, 5);        // Blocked until the next 5-tick release
    }
}`,
  },

  cooperative: {
    title: 'Cooperative scheduling',
    framing: 'With preemption switched off (configUSE_PREEMPTION 0) the kernel changes task only when the running task blocks or calls taskYIELD(). Priority still decides who goes next, but not when. Compute does a long calculation in chunks and yields between them.',
    params: [
      sel('policy', 'Kernel', 'scheduler', 'cooperative', [['cooperative', 'cooperative'], ['preemptive', 'preemptive']]),
      int('pU', 'UI', 'priority', 3), int('tU', 'UI', 'period', 6, 2, 20), int('cU', 'UI', 'run ticks', 1, 1, 5),
      int('pK', 'Compute', 'priority', 1), int('chunk', 'Compute', 'ticks between taskYIELD()', 8, 1, 12),
    ],
    build: (p) => ({
      duration: 36, policy: p.policy,
      tasks: [
        { name: 'UI', priority: p.pU, period: p.tU, script: [run(p.cU)] },
        { name: 'Compute', priority: p.pK, loop: true, script: [run(p.chunk), { op: 'yield' }] },
      ],
    }),
    predict: {
      q: 'UI (priority 3) becomes Ready again at tick 6. Compute (priority 1) started an 8-tick chunk at tick 1. In which tick does UI run?',
      options: ['Tick 6: the higher priority preempts', 'Tick 9: when Compute reaches taskYIELD()', 'Tick 7: at the next tick interrupt'],
      answer: 1,
      why: 'Nothing can take the CPU from Compute. UI sits in the Ready state from tick 6 until Compute yields at the end of its chunk (ticks 1 to 8), then runs at tick 9 because it is the highest-priority Ready task.',
    },
    task: 'UI must finish within 6 ticks of every release. Keep the scheduler cooperative and leave the priorities and UI\'s period and run time alone.',
    check(p, res, d) {
      if (p.policy !== 'cooperative') return { ok: false, msg: 'Preemption does fix it, and that is why most RTOS projects use it. The task here is to make the cooperative version work.' };
      if (!same(p, d, ['pU', 'pK', 'tU', 'cU'])) return { ok: false, msg: 'Leave the priorities and UI\'s period and run time as they were; the thing to change is how long Compute keeps the CPU.' };
      const m = firstMiss(res);
      if (m) return { ok: false, msg: `UI missed the deadline at tick ${m.deadline}. In a cooperative system a task can wait as long as the longest stretch any other task runs without yielding: ${p.chunk} ticks here, plus its own run time.` };
      return { ok: true, msg: `UI now waits at most ${p.chunk} ticks. The worst-case response of every task in a cooperative system is set by the longest non-yielding stretch anywhere in the firmware, which is why one slow function in one task can break the timing of all the others.` };
    },
    code: `void compute_task(void *arg) {
    for (;;) {
        crunch_one_chunk();      // nothing can interrupt this except an ISR
        taskYIELD();             // let a Ready task of equal or higher priority run
    }
}`,
  },

  'round-robin': {
    title: 'Round-robin time slicing',
    framing: 'Three tasks have the same priority and never block. With time slicing on (configUSE_TIME_SLICING 1, the default) the tick interrupt moves the running task to the back of the Ready list for its priority, so equal-priority tasks take turns.',
    params: [
      bool('slice', 'Kernel', 'time slicing', true), int('sliceTicks', 'Kernel', 'slice length (ticks)', 1, 1, 6),
      int('pA', 'A', 'priority', 2), int('cA', 'A', 'run ticks', 4, 1, 8),
      int('pB', 'B', 'priority', 2), int('cB', 'B', 'run ticks', 4, 1, 8),
      int('pC', 'C', 'priority', 2), int('cC', 'C', 'run ticks', 4, 1, 8),
    ],
    build: (p) => ({
      duration: 14, timeSlice: p.slice, sliceTicks: p.sliceTicks,
      tasks: [
        { name: 'A', priority: p.pA, deadline: 6, script: [run(p.cA)] },
        { name: 'B', priority: p.pB, script: [run(p.cB)] },
        { name: 'C', priority: p.pC, script: [run(p.cC)] },
      ],
    }),
    predict: {
      q: 'A, B and C have equal priority, each needs 4 ticks of CPU, and the slice is 1 tick. A runs first. When does A finish?',
      options: ['After 4 ticks', 'After 10 ticks', 'After 12 ticks'],
      answer: 1,
      why: 'A runs in ticks 0, 3, 6 and 9, so it finishes at the end of tick 9: 10 ticks after it started. Sharing is fair, but every task finishes late compared with running alone. B finishes after 11 and C after 12.',
    },
    task: 'A now has to finish by tick 6. Make that happen without reducing any task\'s run time, and with B and C still finishing inside the 14-tick window.',
    check(p, res, d) {
      if (!same(p, d, ['cA', 'cB', 'cC'])) return { ok: false, msg: 'Keep every task at 4 ticks of work. The question is who gets the CPU first, not how much each needs.' };
      const t = res.stats.tasks;
      if (t.A.finishedAt == null || t.A.finishedAt > 6) return { ok: false, msg: `A finished at tick ${t.A.finishedAt ?? '(not at all)'}. While it shares the CPU equally with two others it gets one tick in three. What would give A the CPU without taking turns?` };
      if (t.B.finishedAt == null || t.C.finishedAt == null) return { ok: false, msg: 'A makes its deadline, but B or C never finished inside the window. Do not starve them.' };
      const how = p.pA > Math.max(p.pB, p.pC) ? 'Raising A above the others means it never shares: it runs to completion first.' : 'With no slicing (or a slice as long as the job) the task that starts first keeps the CPU until it blocks or ends. That works here only because A happened to be first in the Ready list; a priority is the dependable way to say "A is urgent".';
      return { ok: true, msg: `A finished at tick ${t.A.finishedAt}. ${how}` };
    },
    code: `// FreeRTOSConfig.h
#define configUSE_PREEMPTION     1
#define configUSE_TIME_SLICING   1    // equal-priority Ready tasks rotate on every tick

xTaskCreate(task_a, "A", STACK, NULL, 2, NULL);
xTaskCreate(task_b, "B", STACK, NULL, 2, NULL);
xTaskCreate(task_c, "C", STACK, NULL, 2, NULL);`,
  },

  'priority-inversion': {
    title: 'Priority inversion',
    framing: 'Low and High share a data structure guarded by a lock. Medium does not use the lock at all. Low takes the lock at tick 1; High is released at tick 2 and needs it at tick 3; Medium is released at tick 3.',
    params: inversionParams('binary'),
    build: (p) => inversionCfg({ ...p, _deadline: 8 }),
    predict: {
      q: 'At tick 3 High (priority 3) blocks on the lock held by Low (priority 1), and Medium (priority 2) becomes Ready. Who runs in tick 3?',
      options: ['Low: it must finish so that High can continue', 'Medium: it is the highest-priority Ready task', 'High: it has the highest priority'],
      answer: 1,
      why: 'High is Blocked, so it is not a candidate. Of the Ready tasks, Medium outranks Low. Low cannot release the lock until Medium has finished, so High, the most urgent task, waits for Medium, a task it shares nothing with. That is priority inversion.',
    },
    task: 'High is released at tick 2 and must finish by tick 10. Do not change any priority. Your fix has to keep working if Medium\'s work grows.',
    check(p, res, d) {
      if (!same(p, d, ['pH', 'pM', 'pL'])) return { ok: false, msg: 'Leave the priorities alone: they are right. High really is the most urgent task; the problem is what the lock does to it.' };
      const hi = res.stats.tasks.High;
      if (hi.misses || hi.finishedAt == null) return { ok: false, msg: `High finished at tick ${hi.finishedAt ?? '(never)'} after waiting ${hi.maxBlock} ticks for the lock. That wait is the rest of Low's critical section plus everything Medium did in between.` };
      const stress = simulate(inversionCfg({ ...p, mrun: p.mrun * 3, _deadline: 8, _duration: 60 }));
      if (stress.stats.tasks.High.misses) return { ok: false, msg: `High meets the deadline in this run, but only because Medium is short. With Medium at ${p.mrun * 3} ticks High finishes at tick ${stress.stats.tasks.High.finishedAt}. The wait is still unbounded: it depends on a task that never touches the lock.` };
      const how = p.lock === 'mutex'
        ? `With a mutex, Low inherits High's priority while High waits, so Medium cannot get in. High waited ${hi.maxBlock} ticks: the rest of Low's critical section and nothing more.`
        : 'Low is now out of its critical section before High asks for the lock, so in this schedule High never blocks. That depends on the release times, though. If High could arrive while Low is inside, you need the mutex as well.';
      return { ok: true, msg: `High finished at tick ${hi.finishedAt}. ${how}` };
    },
    code: INVERSION_CODE,
  },

  'priority-inheritance': {
    title: 'Priority inheritance and its limit',
    framing: 'The same three tasks, now with a FreeRTOS mutex. While a higher-priority task waits for a mutex, the holder temporarily runs at the waiter\'s priority. Watch the priority column in the state table.',
    params: inversionParams('mutex'),
    build: (p) => inversionCfg({ ...p, _deadline: 5 }),
    predict: {
      q: 'High (priority 3) blocks on the mutex at tick 3. Low (base priority 1) holds it. At what priority does Low run while High waits?',
      options: ['1: priorities are fixed', '2: just enough to match Medium', '3: it inherits High\'s priority'],
      answer: 2,
      why: 'The holder is raised to the priority of the highest-priority task waiting for the mutex, here 3, so Medium (2) cannot preempt it. When Low gives the mutex it drops back to 1 and High runs at once.',
    },
    task: 'Inheritance is on, yet High (released at tick 2) must now finish by tick 7 and does not. Keep the mutex, the priorities and High\'s own work; make High meet the deadline.',
    check(p, res, d) {
      if (!same(p, d, ['pH', 'pM', 'pL'])) return { ok: false, msg: 'Leave the priorities alone.' };
      if (p.lock !== 'mutex') return { ok: false, msg: 'Keep the mutex. Without inheritance High waits for Medium as well.' };
      const hi = res.stats.tasks.High;
      if (hi.misses || hi.finishedAt == null) return { ok: false, msg: `High finished at tick ${hi.finishedAt ?? '(never)'}. It waited ${hi.maxBlock} ticks for the mutex: exactly what was left of Low's critical section. Inheritance stops Medium from adding to that wait; it does not shorten the critical section.` };
      return { ok: true, msg: `High finished at tick ${hi.finishedAt}, having waited ${hi.maxBlock} ticks. With inheritance the worst-case blocking of a task is the longest critical section of any lower-priority task it shares a mutex with. Keep critical sections short: copy the data out, release, then process.` };
    },
    code: INVERSION_CODE,
  },

  deadlock: {
    title: 'Deadlock',
    framing: 'Two tasks each need both mutexes at the same time (say, a bus and a buffer). A takes M1 then M2. B takes M2 then M1. B starts first; A is released at tick 1.',
    params: [
      int('pA', 'A', 'priority', 2), int('startA', 'A', 'released at tick', 1, 0, 6),
      sel('orderA', 'A', 'takes', '12', [['12', 'M1 then M2'], ['21', 'M2 then M1']]),
      int('pB', 'B', 'priority', 1),
      sel('orderB', 'B', 'takes', '21', [['12', 'M1 then M2'], ['21', 'M2 then M1']]),
    ],
    build: deadlockCfg,
    predict: {
      q: 'A holds M1 and is Blocked on M2. B holds M2 and, at tick 4, asks for M1. What happens next?',
      options: ['The kernel takes M2 away from B because A has the higher priority', 'Both stay Blocked for ever; only the idle task runs', 'Priority inheritance raises B, B finishes, then A continues'],
      answer: 1,
      why: 'Each task waits for a mutex that only the other can release. Neither will ever run again, so neither mutex is ever given. The kernel does not detect or break this; inheritance only changes priorities, and no priority helps a task that is Blocked.',
    },
    task: 'Change the order in which the tasks take the mutexes so that a deadlock is impossible whatever the timing. Both tasks must still hold both mutexes together.',
    check(p, res) {
      if (res.deadlock) return { ok: false, msg: `Deadlock at tick ${res.deadlock.t}: ${res.deadlock.tasks.join(' and ')} each hold one mutex and wait for the other. On hardware this looks like a device that stops responding with no fault and no reset (unless a watchdog is fed by one of these tasks).` };
      for (let startA = 0; startA <= 6; startA++) for (const [pA, pB] of [[2, 1], [1, 2], [2, 2]]) {
        const r = simulate(deadlockCfg({ ...p, startA, pA, pB }));
        if (r.deadlock) return { ok: false, msg: `No deadlock in this run, but only because of the timing. Release A at tick ${startA} with priorities A=${pA}, B=${pB} and it locks up at tick ${r.deadlock.t}. The tasks still take the mutexes in opposite orders.` };
      }
      const t = res.stats.tasks;
      if (t.A.finishedAt == null || t.B.finishedAt == null) return { ok: false, msg: 'No deadlock, but one of the tasks did not finish inside the window.' };
      return { ok: true, msg: 'Both tasks finish, and the simulator found no deadlock for any release time or priority assignment it tried. When every task takes locks in one agreed global order, a cycle of waiting cannot form. Write the order down next to the mutex declarations.' };
    },
    code: `// Lock order for this firmware: M1 (bus) before M2 (buffer). Always.
xSemaphoreTake(m1, portMAX_DELAY);
xSemaphoreTake(m2, portMAX_DELAY);
transfer();
xSemaphoreGive(m2);                  // release in reverse order
xSemaphoreGive(m1);`,
  },

  'isr-defer': {
    title: 'Deferred interrupt handling',
    framing: 'A UART receive interrupt fires every 8 ticks. The ISR does the minimum (1 tick here: read the byte, give a semaphore) and a Handler task does the real work. Worker is a busy task that never blocks.',
    params: [
      int('pH', 'Handler', 'priority', 1), int('cH', 'Handler', 'run ticks', 2, 1, 5),
      int('pW', 'Worker', 'priority', 2),
      int('irqT', 'Interrupt', 'period', 8, 4, 16), int('irqC', 'Interrupt', 'ISR ticks', 1, 1, 3),
    ],
    build: (p) => ({
      duration: 32, semaphores: [{ name: 'rxSem', max: 1 }],
      interrupts: [{ name: 'UART RX', at: 4, period: p.irqT, duration: p.irqC, give: 'rxSem' }],
      tasks: [
        { name: 'Handler', priority: p.pH, loop: true, script: [{ op: 'semTake', sem: 'rxSem' }, run(p.cH)] },
        { name: 'Worker', priority: p.pW, loop: true, script: [run(50)] },
      ],
    }),
    predict: {
      q: 'The ISR gives the semaphore at the end of tick 4. Handler has priority 1; Worker has priority 2 and never blocks. When does Handler process the byte?',
      options: ['Tick 5: an interrupt always gets its handler run next', 'Not while Worker is Ready, which here is never', 'At the next tick interrupt'],
      answer: 1,
      why: 'The ISR itself preempts everything, but the Handler is an ordinary task. Giving the semaphore only makes the Handler eligible to run (or, if it has not yet reached its take, leaves the semaphore full for when it does); the scheduler still picks by priority, and Worker wins every time. Meanwhile a binary semaphore can remember only one event, so later interrupts are lost.',
    },
    task: 'Handler must start in the tick straight after every ISR, and no interrupt event may be lost.',
    check(p, res) {
      const lost = res.events.filter((e) => e.type === 'lost').length;
      const irqs = res.events.filter((e) => e.type === 'isr-exit' && e.t < res.duration).length;
      const good = res.isrWakes.filter((w) => w.ranAt === w.exit).length;
      if (lost) return { ok: false, msg: `${lost} interrupt event${lost > 1 ? 's were' : ' was'} lost: the semaphore was already full when the ISR gave it, because Handler had not taken the previous one. On a real UART those are dropped bytes.` };
      const slow = res.isrWakes.find((w) => w.ranAt !== w.exit);
      if (slow || good < irqs) return { ok: false, msg: slow ? `After the interrupt at tick ${slow.at} Handler did not run until ${slow.ranAt == null ? 'the end of the window' : 'tick ' + slow.ranAt}. Something else was Ready with an equal or higher priority.` : 'Handler was not waiting on the semaphore when an interrupt arrived, so its response was late.' };
      return { ok: true, msg: `Every interrupt was followed immediately by Handler: latency ${p.irqC} tick${p.irqC > 1 ? 's' : ''}, the length of the ISR. A deferred handler needs a priority above anything that can stay Ready for long, and the ISR must ask for a context switch on the way out (portYIELD_FROM_ISR), otherwise the Handler waits for the next tick.` };
    },
    code: `void IRAM_ATTR uart_isr(void *arg) {            // IRAM_ATTR is ESP-IDF specific
    BaseType_t woken = pdFALSE;
    stash_byte(read_rx_register());              // keep the ISR short
    xSemaphoreGiveFromISR(rx_sem, &woken);       // never the non-ISR API in here
    portYIELD_FROM_ISR(woken);                   // switch to Handler now if it outranks the interrupted task
}

void handler_task(void *arg) {
    for (;;) {
        xSemaphoreTake(rx_sem, portMAX_DELAY);   // Blocked, using no CPU
        parse_bytes();                           // the slow part, in task context
    }
}`,
  },

  starvation: {
    title: 'Starvation',
    framing: 'Poller checks a flag in a loop and calls taskYIELD() each time round "to be nice". Background has lower priority and should run for 2 ticks in every 10.',
    params: [
      int('pP', 'Poller', 'priority', 2), int('delay', 'Poller', 'vTaskDelay ticks per loop (0 = taskYIELD)', 0, 0, 9),
      int('pB', 'Background', 'priority', 1), int('tB', 'Background', 'period', 10, 4, 20), int('cB', 'Background', 'run ticks', 2, 1, 6),
    ],
    build: (p) => ({
      duration: 30,
      tasks: [
        { name: 'Poller', priority: p.pP, loop: true, script: [run(1), p.delay > 0 ? { op: 'delay', ticks: p.delay } : { op: 'yield' }] },
        { name: 'Background', priority: p.pB, period: p.tB, script: [run(p.cB)] },
      ],
    }),
    predict: {
      q: 'Poller (priority 2) calls taskYIELD() after every 1-tick poll. Does Background (priority 1) get any CPU time?',
      options: ['Yes, they alternate tick by tick', 'No: taskYIELD() only gives way to Ready tasks of equal or higher priority', 'Yes, but only one tick in every period'],
      answer: 1,
      why: 'After a yield the scheduler again picks the highest-priority Ready task, and that is still Poller. A lower-priority task runs only when everything above it is Blocked or Suspended. A task that never blocks starves everything below it, including the idle task.',
    },
    task: 'Let Background meet its deadline in every period. Leave the priorities alone, and Poller must keep polling.',
    check(p, res, d) {
      if (!same(p, d, ['pP', 'pB'])) return { ok: false, msg: 'Leave the priorities alone. Swapping them just moves the starvation to the other task unless something blocks.' };
      const b = res.stats.tasks.Background, po = res.stats.tasks.Poller;
      if (b.misses || b.jobs === 0) return { ok: false, msg: b.run === 0 ? 'Background never ran. Poller is always Ready, so nothing below it is ever chosen. What call takes Poller out of the Ready state for a while?' : `Background missed ${b.misses} deadline${b.misses > 1 ? 's' : ''}. Poller still takes too much of the CPU.` };
      if (po.run === 0) return { ok: false, msg: 'Poller no longer runs at all.' };
      return { ok: true, msg: `Poller now spends ${p.delay} of every ${p.delay + 1} ticks Blocked, which is when Background and the idle task run. Poller uses ${Math.round(po.util * 100)} % of the CPU instead of 100 %. Blocking on the event itself (a semaphore or queue) would be better still than polling with a delay.` };
    },
    code: `void poller_task(void *arg) {
    for (;;) {
        if (flag_is_set()) handle();
        vTaskDelay(pdMS_TO_TICKS(10));   // Blocked: lower-priority tasks can run
        // taskYIELD() here would keep this task Ready and starve them
    }
}`,
  },
};

/** FreeRTOS call and a sentence for one simulator event, or null for events that are only drawn. */
export function describeEvent(e) {
  const T = e.task;
  switch (e.type) {
    case 'create': return { api: 'xTaskCreate()', text: `${T} created at priority ${e.priority}` };
    case 'release': return e.periodic && e.job > 0 ? { api: 'vTaskDelayUntil()', text: `${T} released (period ${e.job + 1}), deadline tick ${e.deadline}` } : null;
    case 'job-done': return { api: '', text: `${T} finished its job, response time ${e.response} tick${e.response === 1 ? '' : 's'}${e.late ? ' (late)' : ''}` };
    case 'delay': return { api: `vTaskDelay(${e.ticks})`, text: `${T} blocks for ${e.ticks} tick${e.ticks === 1 ? '' : 's'}` };
    case 'wake': return { api: '', text: `${T}: delay expired, Ready` };
    case 'yield': return { api: 'taskYIELD()', text: `${T} yields` };
    case 'suspend': case 'finish': return { api: 'vTaskSuspend(NULL)', text: `${T} has no more work` };
    case 'take': return { api: `xSemaphoreTake(${e.mutex})`, text: e.handed ? `${T} is given ${e.mutex} after waiting ${e.waited} tick${e.waited === 1 ? '' : 's'}, Ready` : `${T} takes ${e.mutex}` };
    case 'take-block': return { api: `xSemaphoreTake(${e.mutex})`, text: `${T} blocks: ${e.mutex} is held by ${e.owner}` };
    case 'give': return { api: `xSemaphoreGive(${e.mutex})`, text: `${T} releases ${e.mutex}` };
    case 'inherit': return { api: 'priority inheritance', text: `${T} raised from priority ${e.from} to ${e.to}${e.because ? ` while ${e.because} waits` : ''}` };
    case 'disinherit': return { api: 'priority inheritance', text: `${T} drops back from priority ${e.from} to ${e.to}` };
    case 'semTake': return { api: `xSemaphoreTake(${e.sem})`, text: e.woken ? `${T} unblocked by ${e.sem}, Ready` : `${T} takes ${e.sem}` };
    case 'semTake-block': return { api: `xSemaphoreTake(${e.sem})`, text: `${T} blocks until ${e.sem} is given` };
    case 'semGive': return { api: `xSemaphoreGive(${e.sem})`, text: `${T} gives ${e.sem}` };
    case 'send': return { api: `xQueueSend(${e.queue})`, text: e.woken ? `${T} unblocked: space in ${e.queue}` : `${T} sends to ${e.queue}` };
    case 'send-block': return { api: `xQueueSend(${e.queue})`, text: `${T} blocks: ${e.queue} is full` };
    case 'recv': return { api: `xQueueReceive(${e.queue})`, text: e.woken ? `${T} unblocked with an item from ${e.queue}, Ready` : `${T} receives from ${e.queue}` };
    case 'recv-block': return { api: `xQueueReceive(${e.queue})`, text: `${T} blocks: ${e.queue} is empty` };
    case 'isr-enter': return { api: 'interrupt', text: `${e.isr} fires${e.interrupted ? `, preempting ${e.interrupted}` : ''}` };
    case 'isr-give': return { api: `xSemaphoreGiveFromISR(${e.sem})`, text: `ISR gives ${e.sem}` };
    case 'isr-send': return { api: `xQueueSendFromISR(${e.queue})`, text: `ISR sends to ${e.queue}` };
    case 'isr-exit': return { api: 'portYIELD_FROM_ISR()', text: 'ISR returns; the scheduler picks the highest-priority Ready task' };
    case 'lost': return { api: '', text: `${e.sem} was already given and not yet taken: this event is lost`, bad: true };
    case 'drop': return { api: '', text: `${e.queue} is full: xQueueSendFromISR() fails and the item is dropped`, bad: true };
    case 'miss': return { api: '', text: `${T} missed its deadline (tick ${e.deadline})`, bad: true };
    case 'deadlock': return { api: '', text: `Deadlock: ${e.tasks.join(' and ')} wait for each other`, bad: true };
    case 'error': return { api: '', text: e.text, bad: true };
    default: return null;
  }
}

const waitText = (on) => {
  if (!on) return '';
  switch (on.kind) {
    case 'mutex': return `mutex ${on.name} (held by ${on.owner})`;
    case 'sem': return `semaphore ${on.name}`;
    case 'queueSend': return `space in queue ${on.name}`;
    case 'queueRecv': return `an item in queue ${on.name}`;
    case 'delay': return `tick ${on.until} (vTaskDelay)`;
    case 'period': return `tick ${on.until} (vTaskDelayUntil)`;
    case 'start': return `tick ${on.until} (not created yet)`;
    default: return '';
  }
};

let uid = 0;
const LBL = 78, LANE = 22, GAP = 8, TOP = 22;

export default function mount(el, props = {}, ctx = {}) {
  const fixed = props.scenario && SCENARIOS[props.scenario] ? props.scenario : null;
  const id = `rtos${++uid}`;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let key, sc, params, defaults, cfg, res, cur, choice, committed, timer = null, solved;

  const root = h('div', { class: 'rtos-scheduler' });
  clear(el).append(root);

  function load(k) {
    key = k; sc = SCENARIOS[k];
    defaults = Object.fromEntries(sc.params.map((p) => [p.id, p.value]));
    params = { ...defaults }; choice = null; committed = false; solved = false;
    rebuild(); build();
  }
  function rebuild() { stop(); cfg = sc.build(params); res = simulate(cfg); cur = 0; }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function play() {
    if (timer) { stop(); update(); return; }
    if (cur >= res.duration) cur = 0;
    timer = setInterval(() => {
      if (!el.isConnected || !root.isConnected) return stop();
      cur++; if (cur >= res.duration) stop();
      update();
    }, 320);
    update();
  }

  // ---- static structure for a scenario ----
  let ganttBox, stateBox, logBox, statsBox, msgBox, predictBox, btns = {}, statusEl;
  function build() {
    clear(root);
    if (!fixed) {
      root.append(h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Scenario' }, Object.entries(SCENARIOS).map(([k, v]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': k === key ? 'true' : 'false', class: 'w-tab' + (k === key ? ' on' : ''), onclick: () => load(k) }, v.title))));
    }
    root.append(h('p', { class: 'rtos-scheduler-framing' }, sc.framing));
    predictBox = h('div', { class: 'w-task' });
    root.append(predictBox);

    btns.step = h('button', { type: 'button', class: 'btn small', onclick: () => { stop(); if (cur < res.duration) cur++; update(); } }, 'Step 1 tick');
    btns.play = h('button', { type: 'button', class: 'btn small ghost', onclick: play }, 'Play');
    btns.end = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { stop(); cur = res.duration; update(); } }, 'Run to end');
    btns.reset = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { stop(); cur = 0; update(); } }, 'Reset');
    statusEl = h('span', { class: 'w-mono rtos-scheduler-status', 'aria-live': 'polite' });
    root.append(h('div', { class: 'row' }, btns.step, reduced ? null : btns.play, btns.end, btns.reset, statusEl));

    ganttBox = h('div', { class: 'rtos-scheduler-gantt' });
    root.append(ganttBox, legend());

    stateBox = h('div', { class: 'table-wrap' });
    logBox = h('ol', { class: 'rtos-scheduler-log', tabindex: '0', 'aria-label': 'Events so far' });
    root.append(h('div', { class: 'w-grid rtos-scheduler-panels' },
      h('div', {}, h('div', { class: 'tag' }, 'Task states'), stateBox),
      h('div', {}, h('div', { class: 'tag' }, 'Events and the FreeRTOS calls behind them'), logBox)));

    root.append(h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, 'Your task. '), sc.task)));
    root.append(paramPanel());
    msgBox = h('div', {});
    statsBox = h('div', {});
    root.append(msgBox, statsBox);
    root.append(h('details', { class: 'rtos-scheduler-code' }, h('summary', {}, 'What this looks like in FreeRTOS code'), h('pre', { class: 'code' }, h('code', {}, sc.code))));
    root.append(h('p', { class: 'w-note' }, 'Model, not a kernel: time moves in whole ticks, API calls and context switches take no time, blocking calls wait for ever, and there is one core. Real ISRs last microseconds, not ticks; they are drawn a tick wide so that you can see them. ESP-IDF FreeRTOS is SMP on dual-core ESP32 chips: two tasks really do run at once there, so "the highest-priority Ready task runs" becomes "the two highest", and a lower-priority task can run alongside a higher one.'));
    update();
  }

  function legend() {
    const sw = (cls, label) => h('span', { class: 'rtos-scheduler-key' }, h('span', { class: 'rtos-scheduler-sw ' + cls, 'aria-hidden': 'true' }), label);
    const g = (glyph, label, cls = '') => h('span', { class: 'rtos-scheduler-key' }, h('span', { class: 'rtos-scheduler-glyph ' + cls, 'aria-hidden': 'true' }, glyph), label);
    return h('div', { class: 'rtos-scheduler-legend' },
      sw('run', 'Running'), sw('ready', 'Ready (wants the CPU)'), sw('blocked', 'Blocked on a mutex, semaphore or queue'), sw('timed', 'Blocked until a tick'),
      g('▼', 'take'), g('▽', 'take, must wait'), g('▲', 'give'), g('●', 'give / send'), g('○', 'unblocked'), g('↑', 'release'), g('✕', 'deadline missed', 'bad'), g('╎', 'context switch', 'cu'));
  }

  function paramPanel() {
    const groups = new Map();
    for (const p of sc.params) { if (!groups.has(p.group)) groups.set(p.group, []); groups.get(p.group).push(p); }
    const names = cfg.tasks.map((t) => t.name);
    const set = (pid, v) => { params[pid] = v; rebuild(); update(); };
    const field = (p) => {
      const fid = `${id}-${p.id}`;
      let input;
      if (p.type === 'int') {
        input = h('input', { id: fid, type: 'number', min: p.min, max: p.max, step: 1, value: params[p.id], onchange: (e) => {
          let v = Math.round(Number(e.target.value)); if (!Number.isFinite(v)) v = params[p.id];
          v = Math.min(p.max, Math.max(p.min, v)); e.target.value = v; set(p.id, v);
        } });
      } else if (p.type === 'bool') {
        input = h('input', { id: fid, type: 'checkbox', checked: params[p.id], onchange: (e) => set(p.id, e.target.checked) });
      } else {
        input = h('select', { id: fid, onchange: (e) => set(p.id, e.target.value) }, p.options.map(([v, l]) => h('option', { value: v, selected: v === params[p.id] }, l)));
      }
      return h('span', { class: 'rtos-scheduler-field' }, h('label', { for: fid }, p.label), input);
    };
    return h('div', { class: 'rtos-scheduler-params' },
      h('div', { class: 'tag' }, 'Settings (changing one resets the run)'),
      [...groups].map(([g, list]) => {
        const ci = names.indexOf(g);
        return h('fieldset', { class: 'rtos-scheduler-group' },
          h('legend', {}, ci >= 0 ? h('span', { class: `rtos-scheduler-dot rtos-scheduler-b${(ci % 5) + 1}`, 'aria-hidden': 'true' }) : null, g), list.map(field));
      }),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { params = { ...defaults }; rebuild(); const np = paramPanel(); root.querySelector('.rtos-scheduler-params').replaceWith(np); update(); } }, 'Restore original settings')));
  }

  // ---- per-update rendering ----
  function renderPredict() {
    clear(predictBox);
    const pr = sc.predict;
    predictBox.append(h('p', {}, h('strong', {}, 'Predict before you run. '), pr.q));
    const atDefaults = same(params, defaults, Object.keys(defaults));
    if (!committed) {
      const name = `${id}-pred`;
      const lock = h('button', { type: 'button', class: 'btn small', disabled: choice == null, onclick: () => { committed = true; update(); btns.step.focus(); } }, 'Lock in my prediction');
      predictBox.append(h('div', { class: 'rtos-scheduler-opts', role: 'radiogroup', 'aria-label': 'Your prediction' }, pr.options.map((o, i) =>
        h('label', { class: 'rtos-scheduler-opt' }, h('input', { type: 'radio', name, checked: choice === i, onchange: () => { choice = i; lock.disabled = false; } }), ' ', o))), lock);
      return;
    }
    predictBox.append(h('p', {}, 'You predicted: ', h('em', {}, pr.options[choice])));
    if (cur >= res.duration || !atDefaults) {
      const right = choice === pr.answer;
      predictBox.append(h('p', { class: right ? 'ok' : 'rtos-scheduler-wrong' }, right ? 'That is what happens. ' : `Not quite: "${pr.options[pr.answer]}". `), h('p', {}, pr.why));
    } else predictBox.append(h('p', { class: 'muted' }, 'Now run it and compare.'));
  }

  function renderGantt() {
    const D = res.duration, CW = D <= 20 ? 28 : D <= 32 ? 20 : 16;
    const lanes = [];
    if ((cfg.interrupts || []).length) lanes.push({ kind: 'isr', label: 'ISR' });
    cfg.tasks.forEach((t, i) => lanes.push({ kind: 'task', label: t.name, name: t.name, c: (i % 5) + 1, prio: t.priority }));
    lanes.push({ kind: 'idle', label: 'Idle' });
    const PAD = 8, W = PAD + D * CW + 12, H = TOP + lanes.length * (LANE + GAP) + 4;
    const X = (t) => PAD + t * CW, Y = (i) => TOP + i * (LANE + GAP);
    const svg = s('svg', { class: 'w-svg rtos-scheduler-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    const lab = s('svg', { class: 'w-svg rtos-scheduler-svg rtos-scheduler-labels', viewBox: `0 0 ${LBL} ${H}`, width: LBL, height: H, 'aria-hidden': 'true' });
    const defs = s('defs', {});
    for (let c = 1; c <= 5; c++) {
      defs.append(s('pattern', { id: `${id}-h${c}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 1.5, y1: 0, x2: 1.5, y2: 6, 'stroke-width': 2, class: `rtos-scheduler-s${c}` })));
      defs.append(s('pattern', { id: `${id}-x${c}`, width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, s('path', { d: 'M0 0L5 5M5 0L0 5', 'stroke-width': 1, class: `rtos-scheduler-s${c}` })));
    }
    svg.append(defs);
    // grid and axis
    for (let t = 0; t <= D; t++) {
      const major = t % 5 === 0;
      svg.append(s('line', { x1: X(t), y1: TOP - (major ? 6 : 3), x2: X(t), y2: H - 4, class: 'rtos-scheduler-grid' + (major ? ' major' : '') }));
      if (major) svg.append(s('text', { x: X(t), y: 10, 'text-anchor': 'middle', class: 'rtos-scheduler-axis' }, t));
    }
    lanes.forEach((ln, i) => {
      lab.append(s('text', { x: 6, y: Y(i) + LANE / 2 + 4, class: 'rtos-scheduler-lbl' }, ln.label));
      if (ln.kind === 'task') lab.append(s('text', { x: LBL - 6, y: Y(i) + LANE / 2 + 4, 'text-anchor': 'end', class: 'rtos-scheduler-prio' }, `p${ln.prio}`));
      // merge consecutive ticks in the same drawing state
      let segStart = 0, segKind = null;
      const kindAt = (t) => {
        const tl = res.timeline[t];
        if (ln.kind === 'isr') return tl.isr ? 'isr' : null;
        if (ln.kind === 'idle') return !tl.isr && tl.run == null ? 'idle' : null;
        if (tl.run === ln.name) return 'run';
        const st = tl.states[ln.name];
        if (st.state === 'Running' || st.state === 'Ready') return 'ready';
        if (st.state === 'Blocked') return st.on.kind === 'start' ? null : st.on.until != null ? 'timed' : 'blocked';
        return null;
      };
      const flush = (end) => {
        if (segKind == null) return;
        const x = X(segStart), w = (end - segStart) * CW, y = Y(i);
        if (segKind === 'run') svg.append(s('rect', { x: x + 0.5, y, width: w - 1, height: LANE, rx: 2, class: `rtos-scheduler-f${ln.c}` }));
        else if (segKind === 'ready') svg.append(s('rect', { x: x + 0.5, y: y + 3, width: w - 1, height: LANE - 6, fill: `url(#${id}-h${ln.c})`, class: `rtos-scheduler-o${ln.c}` }));
        else if (segKind === 'blocked') svg.append(s('rect', { x: x + 0.5, y: y + 3, width: w - 1, height: LANE - 6, fill: `url(#${id}-x${ln.c})`, class: `rtos-scheduler-o${ln.c} dashed` }));
        else if (segKind === 'timed') svg.append(s('line', { x1: x, y1: y + LANE / 2, x2: x + w, y2: y + LANE / 2, class: `rtos-scheduler-s${ln.c} timed` }));
        else if (segKind === 'isr') svg.append(s('rect', { x: x + 0.5, y, width: w - 1, height: LANE, rx: 2, class: 'rtos-scheduler-isr' }));
        else if (segKind === 'idle') svg.append(s('rect', { x: x + 0.5, y: y + 5, width: w - 1, height: LANE - 10, class: 'rtos-scheduler-idle' }));
      };
      for (let t = 0; t < cur; t++) {
        const k = kindAt(t);
        if (k !== segKind) { flush(t); segKind = k; segStart = t; }
      }
      flush(cur);
    });
    // markers
    const laneOf = (name) => lanes.findIndex((l) => l.name === name);
    const isrLane = lanes.findIndex((l) => l.kind === 'isr');
    const mark = (x, y, glyph, cls, title) => svg.append(s('text', { x, y, 'text-anchor': 'middle', class: 'rtos-scheduler-mk ' + cls }, glyph, s('title', {}, title)));
    for (const e of res.events) {
      if (e.t > cur) break;
      const d = describeEvent(e); const title = d ? `tick ${e.t}: ${d.api ? d.api + ' — ' : ''}${d.text}` : '';
      const li = e.task ? laneOf(e.task) : -1, x = X(e.t);
      switch (e.type) {
        case 'switch': if (e.t > 0) svg.append(s('line', { x1: x, y1: TOP - 8, x2: x, y2: TOP - 1, class: 'rtos-scheduler-sw-mark' }, s('title', {}, `tick ${e.t}: context switch ${e.from ?? 'idle'} → ${e.to ?? 'idle'}`))); break;
        case 'take': mark(x + 5, Y(li) + 9, '▼', '', title); break;
        case 'take-block': mark(x + 5, Y(li) + 9, '▽', 'bad', title); break;
        case 'give': mark(x - 5, Y(li) + LANE - 1, '▲', '', title); break;
        case 'semGive': case 'send': mark(x - 5, Y(li) + LANE - 2, '●', '', title); break;
        case 'semTake': case 'recv': if (e.woken) mark(x + 5, Y(li) + 9, '○', '', title); break;
        case 'isr-give': case 'isr-send': if (isrLane >= 0) mark(x - 5, Y(isrLane) + LANE - 2, '●', 'onfill', title); break;
        case 'release': if (e.periodic) mark(x + 1, Y(li) + LANE + 6, '↑', 'rel', `tick ${e.t}: ${e.task} released, deadline tick ${e.deadline}`); break;
        case 'miss': svg.append(s('line', { x1: x, y1: Y(li) - 3, x2: x, y2: Y(li) + LANE + 3, class: 'rtos-scheduler-miss' })); mark(x, Y(li) - 1, '✕', 'bad big', title); break;
        case 'deadlock': svg.append(s('line', { x1: x, y1: TOP, x2: x, y2: H - 4, class: 'rtos-scheduler-miss' }), s('text', { x: x + 4, y: H - 8, class: 'rtos-scheduler-mk bad' }, 'deadlock')); break;
        default:
      }
    }
    if (cur > 0 && cur < D) svg.append(s('line', { x1: X(cur), y1: 12, x2: X(cur), y2: H - 2, class: 'rtos-scheduler-cursor' }));
    const old = ganttBox.querySelector('.rtos-scheduler-scroll'), keep = old ? old.scrollLeft : 0;
    const sc2 = h('div', { class: 'rtos-scheduler-scroll', tabindex: '0', role: 'group', 'aria-label': 'Timeline, scrollable. The state table and event list below give the same information as text.' }, svg);
    clear(ganttBox).append(lab, sc2);
    const want = X(cur) - sc2.clientWidth + 40;
    sc2.scrollLeft = timer || want > keep ? Math.max(0, want) : keep;
  }

  function renderStates() {
    const tl = cur > 0 ? res.timeline[cur - 1] : null;
    const rows = cfg.tasks.map((t, i) => {
      const st = tl ? tl.states[t.name] : null;
      const state = !st ? '–' : st.interrupted ? 'Running (interrupted by ISR)' : st.state;
      const prio = st && st.eff !== st.base ? `${st.base} → ${st.eff} (inherited)` : String(t.priority);
      const wait = !st ? '' : st.state === 'Blocked' ? waitText(st.on) : '';
      const holds = st && st.holds.length ? `holds ${st.holds.join(', ')}` : '';
      return h('tr', {},
        h('th', { scope: 'row' }, h('span', { class: `rtos-scheduler-dot rtos-scheduler-b${(i % 5) + 1}`, 'aria-hidden': 'true' }), t.name),
        h('td', { class: 'w-mono' }, prio), h('td', { class: st ? 'rtos-scheduler-st-' + st.state.toLowerCase() : '' }, state), h('td', {}, [wait && `waiting for ${wait}`, st && st.state === 'Suspended' && 'no more work', holds].filter(Boolean).join('; ')));
    });
    clear(stateBox).append(h('table', { class: 'rtos-scheduler-table' },
      h('caption', {}, tl ? `During tick ${cur - 1}${tl.isr ? ` (ISR ${tl.isr} has the CPU)` : tl.run == null ? ' (idle task has the CPU)' : ''}` : 'Before the first tick'),
      h('thead', {}, h('tr', {}, ['Task', 'Priority', 'State', 'Detail'].map((c) => h('th', { scope: 'col' }, c)))), h('tbody', {}, rows)));
  }

  function renderLog() {
    clear(logBox);
    let n = 0;
    for (const e of res.events) {
      if (e.t > cur) break;
      const d = describeEvent(e); if (!d) continue;
      n++;
      logBox.append(h('li', { class: d.bad ? 'bad' : '' }, h('span', { class: 'rtos-scheduler-t' }, `t=${e.t}`), ' ', d.api ? h('code', {}, d.api) : null, d.api ? ' ' : '', d.text));
    }
    if (!n) logBox.append(h('li', { class: 'muted' }, 'Nothing yet. Step or run the schedule.'));
    logBox.scrollTop = logBox.scrollHeight;
  }

  function renderResult() {
    clear(msgBox); clear(statsBox);
    if (cur < res.duration) return;
    const r = sc.check(params, res, defaults);
    msgBox.append(h('div', { class: 'w-msg ' + (r.ok ? 'ok' : 'bad'), role: 'status' }, r.ok ? 'Solved. ' : 'Not solved yet. ', r.msg));
    if (r.ok && !solved) { solved = true; ctx.complete?.(); }
    const st = res.stats;
    const pct = (u) => `${Math.round(u * 100)} %`;
    statsBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 'rtos-scheduler-table' },
      h('caption', {}, `Whole run: ${res.duration} ticks, ${st.switches} context switches`),
      h('thead', {}, h('tr', {}, ['Task', 'CPU share', 'Jobs finished', 'Worst response', 'Deadlines missed'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {},
        cfg.tasks.map((t) => { const x = st.tasks[t.name]; return h('tr', {}, h('th', { scope: 'row' }, t.name), h('td', { class: 'w-mono' }, pct(x.util)), h('td', { class: 'w-mono' }, x.jobs + (x.unfinished ? ' (+1 unfinished)' : '')), h('td', { class: 'w-mono' }, x.jobs ? `${x.wcrt} ticks` : '–'), h('td', { class: 'w-mono' + (x.misses ? ' rtos-scheduler-wrong' : '') }, x.misses)); }),
        st.isr ? h('tr', {}, h('th', { scope: 'row' }, 'ISR'), h('td', { class: 'w-mono' }, pct(st.isrUtil)), h('td', {}, ''), h('td', {}, ''), h('td', {}, '')) : null,
        h('tr', {}, h('th', { scope: 'row' }, 'Idle'), h('td', { class: 'w-mono' }, pct(st.idleUtil)), h('td', {}, ''), h('td', {}, ''), h('td', {}, ''))))));
  }

  function update() {
    if (!committed) { stop(); cur = 0; }
    const locked = !committed, end = cur >= res.duration;
    btns.step.disabled = locked || end; btns.end.disabled = locked || end; btns.play.disabled = locked; btns.reset.disabled = locked || cur === 0;
    btns.play.textContent = timer ? 'Pause' : 'Play';
    statusEl.textContent = locked ? 'Make a prediction to unlock the controls' : `tick ${cur} of ${res.duration}`;
    renderPredict(); renderGantt(); renderStates(); renderLog(); renderResult();
  }

  load(fixed || 'preemptive');
}
