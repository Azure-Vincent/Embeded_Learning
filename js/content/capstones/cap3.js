// Capstone 3: RTOS-based application with measured timing.
const lab = {
  id: 'cap-3',
  title: 'Capstone 3: an RTOS application with measured timing',
  kind: 'Capstone', minutes: 540,
  summary: 'Build a multitasking application with queues, synchronisation and interrupts, then measure its jitter, stack headroom and deadline adherence.',
  skills: ['cap-method', 'cap-rtos-measure'],
  requires: ['rtos'],
  objectives: [
    'Decompose an application into tasks with stated periods, deadlines and priorities.',
    'Pass data between ISRs and tasks with queues and notifications, and protect shared resources with the right primitive.',
    'Instrument the system to measure period jitter, response time and deadline misses.',
    'Size task stacks from measured high-water marks.',
    'Create a timing fault on purpose, observe it, and fix it by design.',
  ],
  hardware: [
    'An ESP32 development board you own',
    'A button and an LED; one periodic data source (a sensor from capstone 1, or a hardware timer if you have none)',
    'Logic analyser or oscilloscope for independent timing measurement (recommended; the firmware can self-measure without one)',
  ],
  software: [
    'ESP-IDF with its FreeRTOS port',
    'A serial terminal and a way to save logs',
    'A spreadsheet or script to turn logged timestamps into min/mean/max and a histogram',
  ],
  background: [
    `A real-time requirement is a statement about time that can be violated: "the control loop runs every 10 ms, and each run finishes within 2 ms of its release." Whether your system meets it is an experimental question. This capstone is graded on measurements.

The brief: **an application with at least four tasks and one interrupt source, where at least one task has a hard period and deadline that you state, measure and defend.** A data logger with a fast sampling task, a slow reporting task, a user-interface task and a low-priority housekeeping task is the classic shape.`,
    `### Three numbers you will report

- **Jitter**: the variation in when a periodic task actually starts, relative to when it should. Report minimum, maximum and distribution, never only the mean.
- **Deadline adherence**: activations that finished before their deadline, out of all activations. One miss in a million is a different system from zero.
- **Stack high-water mark**: the smallest amount of stack a task has ever had free. FreeRTOS reports it through \`uxTaskGetStackHighWaterMark\`; check the unit (words or bytes) in the documentation for your port.`,
    { t: 'callout', kind: 'hw', md: 'ESP-IDF runs FreeRTOS on two cores on the original ESP32 and the S3, and on one core on the C3 and C6. On a two-core chip, two tasks can truly run at once, so a "critical section by priority" argument that holds on one core is wrong. State which chip you used and whether you pinned tasks to a core.' },
    { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'preemptive' }, caption: 'Simulation: enter your task set (periods, run times, priorities) and see whether it is schedulable before you build it.' },
  ],
  diagram: [
    { t: 'ascii', text: String.raw`
  timer/GPIO ISR --notify--> [sample_task  prio high, period T1, deadline D1]
                                   | queue (samples)
                                   v
                             [process_task prio mid]  --mutex--> shared log buffer
                                   | queue (results)                ^
                                   v                                |
  button ISR --queue-->      [ui_task      prio mid-low] -----------'
                             [house_task   prio low: stats, stack marks, watchdog]`, caption: 'Reference architecture. Yours needs the same information: each task, its trigger, its priority, and every queue and lock.' },
    { t: 'ascii', text: String.raw`
Task table (fill in, then compare against measurements)

Task      Trigger      Period   Deadline  Priority  Worst run time  Blocks on
--------  -----------  -------  --------  --------  --------------  ----------
sample    timer        ?        ?         ?         measured: ?     notify
process   queue        -        ?         ?         measured: ?     queue, mutex
ui        queue        -        ?         ?         measured: ?     queue
house     delay        ?        -         ?         measured: ?     delay`, caption: 'The "worst run time" column starts as an estimate and ends as a measurement.' },
  ],
  steps: [
    { title: 'Milestone 0: timing requirements', md: `State each timing requirement as period, deadline and tolerated jitter, and say where the numbers come from (the physics of what you sample, human perception for the UI). State the acceptable miss rate. Check the tick rate configured in your project: a task cannot be released more precisely than one tick using tick-based delays, so decide whether your fastest task needs a hardware timer instead.` },
    { title: 'Milestone 1: skeleton with a periodic task', md: `Create the tasks as empty loops that block correctly. Make the periodic task use an absolute-time delay so that its period does not drift with its own run time.`,
      code: String.raw`static void sample_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));  /* next release = previous release + 10 ms */
        int64_t t = esp_timer_get_time();           /* microseconds since boot */
        record_release(t);                          /* your instrumentation, see milestone 2 */
        do_sample();
        record_finish(esp_timer_get_time());
    }
}`, lang: 'c', status: 'reviewed' },
    { title: 'Milestone 2: instrumentation before features', md: `Build the measuring equipment first. For each timed task record release time and finish time into a preallocated buffer or running min/max/histogram bins; never print from the timed path, because printing is slow and changes what you measure. Have the housekeeping task report the statistics. If you have a logic analyser, also toggle a GPIO at release and finish so you have a measurement the firmware cannot fool.` },
    { title: 'Milestone 3: ISR to task', md: `Add the interrupt source and hand off to a task with a queue or a direct task notification. Measure the latency from the interrupt to the task running. Keep the ISR to the hand-off only.`,
      blocks: [{ t: 'widget', name: 'rtos-scheduler', props: { scenario: 'isr-defer' }, caption: 'Simulation of deferred interrupt handling and what it costs in latency.' }] },
    { title: 'Milestone 4: shared resources', md: `Introduce the shared resource (log buffer, bus, display) and protect it. Choose the primitive deliberately: a mutex for ownership of a resource, a queue to move data, a critical section only for a few instructions. Measure the longest time any task holds the lock.`,
      blocks: [{ t: 'widget', name: 'race-condition', props: { scenario: 'counter' }, caption: 'What you are preventing: interleave the steps by hand until an update is lost.' }] },
    { title: 'Milestone 5: load it and measure', md: `Run for at least 30 minutes under the heaviest load you can create (buttons, maximum data rate, logging on). Collect jitter, response-time and deadline statistics and the high-water mark of every stack. Fill in the measured columns of the task table.` },
    { title: 'Milestone 6: break it on purpose, then fix it', md: `Create a real timing fault and document it with measurements before and after the fix. Suggested: let a low-priority task hold a lock the high-priority task needs while a medium-priority task runs for a long time, using a binary semaphore instead of a mutex. Then fix it by design, not by luck.`,
      blocks: [{ t: 'widget', name: 'rtos-scheduler', props: { scenario: 'priority-inversion' }, caption: 'Simulation of the fault. Compare with the `priority-inheritance` scenario.' }] },
    { title: 'Milestone 7: size the stacks and write up', md: `Set each stack from its measured high-water mark plus a margin you justify, re-run the soak test, and report the final numbers against the requirements.` },
  ],
  walkthrough: [
    `Decisions to justify:

- **Priorities.** Assigned by deadline (shortest deadline highest) or by "importance"? Show what the measurement says.
- **Queue lengths.** What happens when the consumer is slower than the producer: block, drop the oldest, drop the newest? Each is right for some data. Count the drops.
- **Queue or notification for the ISR hand-off?** A notification is lighter but carries little data and has one receiver.
- **Mutex or binary semaphore?** FreeRTOS mutexes implement priority inheritance; binary semaphores do not. Which do you need for a lock, and which for signalling?
- **Timeouts on every blocking call.** A wait of \`portMAX_DELAY\` on a lock turns a bug elsewhere into a silent hang. What should each task do when a wait times out?`,
    { t: 'callout', kind: 'mistake', md: 'Measuring with `printf` inside the timed loop, or reporting only the average. The average of a task that is on time 999 times and 40 ms late once looks perfect. Report the maximum and the count over the deadline.' },
    { t: 'callout', kind: 'decision', md: 'Using `vTaskDelayUntil` for the periodic task and not `vTaskDelay`: a relative delay adds the task\'s own run time to every period, so the period drifts with load. The absolute form releases the task on a fixed grid.' },
  ],
  testing: [
    `| Test | Procedure | You should see |
|---|---|---|
| Period accuracy | Log 10 000 releases of the periodic task | Mean period equal to the requirement; min and max within your stated jitter |
| Deadline adherence | Count finishes later than the deadline over 30 minutes under load | A miss count at or below the rate you stated — and the number, even if it is zero |
| Interrupt latency | Timestamp in the ISR and at task entry | Maximum below your requirement |
| Stack headroom | Read every task's high-water mark after the soak | Margin you can justify on every task; no task close to zero |
| Overload | Produce data faster than it can be consumed | The documented overflow policy, counted; high-priority timing unaffected |
| Induced inversion | Milestone 6 before the fix | Deadline misses that appear in your own statistics |
| After the fix | Same test | Misses gone, with the lock-hold time measured |
| Independent check | Logic analyser on the toggled GPIO | Agreement with the firmware's own numbers |

Present jitter as a histogram. A test with no numbers attached does not count as run.`,
  ],
  troubleshooting: [
    { symptom: 'Period is right on average but jitter is a whole tick', cause: 'Tick-based delays cannot release a task more finely than the tick period.', fix: 'Drive the task from a hardware timer or `esp_timer` callback via a notification, or state a requirement the tick can meet.' },
    { symptom: 'Timing is fine until logging is enabled', cause: 'Console output blocks or takes a lock shared with the timed task.', fix: 'Log from a low-priority task through a queue; never print in the timed path.' },
    { symptom: 'System freezes with no crash message', cause: 'Deadlock: two tasks taking two locks in opposite order, or a wait with no timeout on something that never arrives.', fix: 'Fix a single lock order, add timeouts, and have the housekeeping task report which tasks have stopped checking in.' },
    { symptom: 'Task watchdog message naming the idle task', cause: 'A task at higher priority never blocks, so idle never runs.', fix: 'Find the loop that polls without blocking and make it wait on a queue, notification or delay.' },
    { symptom: 'Random crashes that move when you add a variable', cause: 'A stack overflow corrupting a neighbour.', fix: 'Enable the stack-overflow check in the FreeRTOS configuration and read high-water marks; large local arrays and deep `printf` calls are the usual cause.' },
  ],
  challenge: `Add a second hard-deadline task whose period is not a multiple of the first, show by calculation whether the task set should be schedulable, and then show by measurement whether it is. If the two disagree, find out why.`,
  quiz: [
    { q: 'A periodic task uses `vTaskDelay(pdMS_TO_TICKS(10))` at the end of a loop whose body takes 2–3 ms. What period will you measure?', kind: 'code', choices: [
      { t: 'About 12–13 ms, varying with the body\'s run time', ok: true, why: 'Correct: a relative delay starts counting when the body finishes, so run time is added to every period.' },
      { t: 'Exactly 10 ms', why: 'That is what an absolute delay (`vTaskDelayUntil`) gives; a relative delay cannot compensate for the work done before it.' },
      { t: 'About 7–8 ms', why: 'The delay is not shortened by the body; nothing subtracts the run time for you.' },
    ] },
    { q: 'Mean response time is 1.1 ms against a 2 ms deadline. Is the requirement met?', kind: 'concept', choices: [
      { t: 'Unknown: the deadline is about the worst case, so you need the maximum and the count of misses', ok: true, why: 'Correct: a mean hides rare long responses, and those are exactly the failures a deadline exists to rule out.' },
      { t: 'Yes, with almost 50% margin', why: 'Margin on the mean says nothing about the tail of the distribution.' },
      { t: 'No, the mean must be below half the deadline', why: 'There is no such rule; the test is whether any activation exceeds the deadline.' },
    ] },
    { q: 'High-priority task H waits for a lock held by low-priority L while medium-priority M runs for 50 ms. What is this, and what fixes it?', kind: 'arch', choices: [
      { t: 'Priority inversion; use a mutex with priority inheritance so L runs at H\'s priority until it releases the lock', ok: true, why: 'Correct: inheritance stops M from pre-empting the lock holder, bounding H\'s wait to L\'s critical section.' },
      { t: 'Deadlock; add a timeout', why: 'Nothing is waiting in a cycle here — L will finish eventually; the problem is that M delays it.' },
      { t: 'Starvation; lower H\'s priority', why: 'Lowering H makes its response worse and does nothing about M running ahead of the lock holder.' },
    ] },
    { q: 'A task\'s stack high-water mark reads close to zero after a soak test. What does that tell you?', kind: 'concept', choices: [
      { t: 'At some moment the task nearly exhausted its stack; a slightly deeper call path will overflow it', ok: true, why: 'Correct: the mark is the minimum free space ever seen, so near zero means almost no margin.' },
      { t: 'The task uses almost no stack and can be shrunk', why: 'That is the opposite reading; the mark reports free space remaining at the worst moment, not space used.' },
      { t: 'The task has leaked heap memory', why: 'The high-water mark concerns the task stack; heap use is reported separately.' },
    ] },
    { q: 'On a dual-core ESP32, why is "the other task has lower priority, so it cannot run while I do" not a valid critical section?', kind: 'arch', choices: [
      { t: 'The lower-priority task can run at the same time on the other core', ok: true, why: 'Correct: with two cores, priority only orders tasks competing for the same core, so real mutual exclusion is required.' },
      { t: 'Priorities are ignored on the ESP32', why: 'Priorities are honoured; the issue is true parallelism, not the scheduler ignoring them.' },
      { t: 'Interrupts change task priorities', why: 'Interrupts pre-empt tasks but do not alter their priorities; the hazard here is the second core.' },
    ] },
  ],
  requirements: {
    functional: [
      'FR-1: at least four tasks and one interrupt source, each with a documented trigger, priority and blocking point.',
      'FR-2: at least one task has a stated period, deadline, jitter tolerance and acceptable miss rate.',
      'FR-3: ISRs perform hand-off only; all inter-task data moves through queues or notifications.',
      'FR-4: every shared resource is protected, and every blocking call has a timeout with defined behaviour.',
      'FR-5: the firmware reports, on request, jitter statistics, deadline misses, queue overflow counts and every stack high-water mark.',
      'FR-6: under overload, low-priority work degrades in a documented way and the hard-deadline task still meets its requirement.',
      'FR-7: the system runs 30 minutes under load with no reset or watchdog event.',
    ],
  },
  rubric: [
    { criterion: 'Timing requirements', points: 10, evidence: 'Period, deadline, jitter and miss-rate figures with their justification.' },
    { criterion: 'Architecture', points: 15, evidence: 'Task diagram and table; every queue, lock and ISR hand-off shown.' },
    { criterion: 'Instrumentation', points: 15, evidence: 'Source for the measurement code; explanation of why it does not disturb what it measures.' },
    { criterion: 'Measured results', points: 25, evidence: 'Jitter histogram, min/max, miss count, interrupt latency and stack marks from a 30-minute loaded run.' },
    { criterion: 'Induced fault and fix', points: 20, evidence: 'Before/after measurements of the timing fault and an explanation of the mechanism.' },
    { criterion: 'Synchronisation correctness', points: 15, evidence: 'Justification of each primitive; timeouts on blocking calls; dual-core reasoning if applicable.' },
  ],
};

export default { skills: [], lessons: [], labs: [lab], glossary: [], troubleshooting: [], refs: [] };
