// Real-time systems, part C: mutexes and priority inversion, deadlock, real-time scheduling, inter-task design.
const C = String.raw;

const lessons = [
  // ───────────────────────────────────────────────────────────────── 9
  {
    id: 'rtos-mutex-inversion',
    title: 'Mutexes and priority inversion',
    minutes: 55,
    summary: 'Ownership, hold time and recursion; how a low-priority task can stall a high-priority one indefinitely; priority inheritance, its limits, and the Mars Pathfinder resets.',
    skills: ['rtos-sk-mutex', 'rtos-sk-inversion'],
    blocks: [
      `## The problem

Three tasks share nothing but one I2C bus. The **high**-priority task reads an IMU every 5 ms. The **low**-priority task reads a slow temperature sensor once a second. A **medium**-priority task compresses log data and never touches the bus. Every few minutes the IMU task misses its deadline by 80 ms. The bus is protected "properly", with a lock. The medium task has no lock at all — and it is the one causing the miss.`,

      `## What a mutex is

A [[Mutex]] (mutual exclusion lock) lets one task at a time into a region of code that uses a shared resource. Compared with a binary semaphore it has three properties that matter:

- **Ownership.** The kernel records which task holds it. Only that task should give it back. This is why a mutex cannot be used from an ISR: an ISR is not a task and cannot be an owner.
- **Priority inheritance.** If a higher-priority task blocks on a mutex, the kernel temporarily raises the holder's priority to match. Explained below.
- **Created available.** \`xSemaphoreCreateMutex()\` returns a mutex that can be taken at once; a binary semaphore starts empty.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'A mutex-protected bus transaction with a timeout.',
        code: C`static SemaphoreHandle_t s_i2c_mutex;       /* s_i2c_mutex = xSemaphoreCreateMutex(); */

esp_err_t imu_read(imu_sample_t *out)
{
    if (xSemaphoreTake(s_i2c_mutex, pdMS_TO_TICKS(20)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;             /* bus busy for too long: report it */
    }
    esp_err_t err = i2c_read_imu_registers(out);   /* the only code that runs locked */
    xSemaphoreGive(s_i2c_mutex);

    if (err == ESP_OK) {
        convert_units(out);                 /* private data: no lock needed */
    }
    return err;
}`,
        explain: [
          { lines: '5', md: 'If the mutex is free the kernel marks this task as holder and returns immediately. If not, the task moves to the Blocked state on the mutex\'s wait list — and the kernel compares its priority with the holder\'s (see inheritance).' },
          { lines: '5-7', md: 'A finite timeout turns a stuck bus or a deadlock into an error you can log and recover from, instead of a silent hang.' },
          { lines: '8-9', md: 'Every path between take and give must reach the give. Note there is no early `return` between them.' },
          { lines: '11-13', md: 'Work on private data happens after the give. The **hold time** — how long the mutex is held — is what every other user of the bus may have to wait.' },
        ] },
      `**Hold time is the design parameter.** The longest time any task holds a mutex is the longest any other task can be made to wait for it once. Do the minimum under the lock: copy data out, release, then process. Never log, delay, or wait for user input while holding a mutex.

**Recursive mutexes** (\`xSemaphoreCreateRecursiveMutex\`, \`xSemaphoreTakeRecursive\`/\`GiveRecursive\`) may be taken again by the task that already holds them; they are released when given the same number of times. An ordinary mutex taken twice by the same task blocks that task on itself forever. Recursive mutexes are sometimes a legitimate convenience when a locked public function calls another locked public function, but needing one often signals that the locking boundaries are unclear. A cleaner structure is public functions that lock and call private \`_unlocked\` helpers.`,
      { t: 'callout', kind: 'mistake', title: 'Using a mutex as a signal, or a semaphore as a lock',
        md: `Taking a mutex in one task and giving it in another (or an ISR) breaks ownership: the inheritance bookkeeping is attached to the wrong task and \`configASSERT\` builds stop in the kernel. Conversely, guarding a resource with a **binary semaphore** works functionally but has **no priority inheritance**, which reintroduces the problem below. Signal with semaphores or notifications; lock with mutexes.` },

      `## Priority inversion

Take three tasks on one core: H (high), M (medium), L (low). H and L share a lock. M shares nothing.

1. L takes the lock.
2. H becomes ready, preempts L, and tries to take the lock. It blocks. L resumes. So far this is **bounded** inversion: H waits for L's critical section, which you kept short.
3. M becomes ready. M is higher than L, so it preempts L. M does not need the lock, so nothing stops it.
4. L cannot run, so it cannot release the lock, so H cannot run. **H is now waiting for M** — a task of lower priority that it has no relationship with.

This is **unbounded [[Priority inversion]]**: H's delay is not limited by any critical section but by how long M (and any other medium-priority task) chooses to run. In the opening problem, the 80 ms is the log compressor.`,
      { t: 'ascii', caption: 'Unbounded priority inversion with a plain lock. H is ready from t=2 but runs at t=9.',
        text: `t:   0  1  2  3  4  5  6  7  8  9  10
H:   .  .  ▒  ▒  ▒  ▒  ▒  ▒  ▒  █  █     ▒ = blocked on the lock
M:   .  .  .  █  █  █  █  █  .  .  .     M preempts L at t=3
L:   █  █  █  .  .  .  .  .  █  .  .     L holds the lock from t=1 to t=9
        ^take ^H tries          ^L gives` },
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'priority-inversion' }, title: 'Watch the inversion',
        caption: 'Lengthen the medium task\'s run time. The high task\'s response time grows with it, although they share nothing.' },
      { t: 'predict',
        q: 'Same three tasks, but the lock is now a FreeRTOS mutex with priority inheritance. L holds it; H blocks on it at t = 2; M becomes ready at t = 3. Which task is running at t = 3?',
        choices: [
          { t: 'L, running at H\'s priority, so M cannot preempt it.', ok: true, why: 'When H blocked, the kernel raised L to H\'s priority. M is now lower than L and stays Ready until L gives the mutex and drops back.' },
          { t: 'M, because it is higher than L.', why: 'That compares M with L\'s base priority. While L holds a mutex that H is waiting for, its effective priority is H\'s.' },
          { t: 'H, because the kernel hands it the mutex at once.', why: 'The kernel cannot take the resource away from L mid-transaction; it can only make L finish as quickly as possible.' },
        ],
        reveal: 'With inheritance, H waits for at most L\'s remaining critical section. M runs only after H has finished. The inversion is bounded by the hold time again.' },
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'priority-inheritance' }, title: 'The same scenario with inheritance',
        caption: 'Compare the high task\'s response time with the previous run, and note when the low task\'s priority is raised and restored.' },

      `## Limits of priority inheritance

- **It bounds the wait; it does not remove it.** H still waits for the rest of L's critical section. Worst-case blocking for a task is (roughly) the longest critical section of any lower-priority task on each mutex it uses.
- **Only mutexes inherit.** Binary semaphores, queues and critical sections do not.
- **FreeRTOS's implementation is simplified.** When a task holds several mutexes, its priority is restored only when it has released all of them, and the kernel does not promise correct behaviour for complex chains. The kernel documentation says the mechanism assumes a task holds only one mutex at a time.
- **It does nothing if the holder is blocked** on something else (a delay, another mutex). Raising the priority of a sleeping task does not wake it. Never block while holding a mutex.
- **On two cores** a medium task may simply run on the other core, so inversion may not appear in the same form — but it still exists whenever all the contenders are tied to one core or the system is busy.

An alternative protocol, **[[Priority ceiling]]**, gives each mutex a ceiling equal to the highest priority of any task that uses it, and raises a task to the ceiling as soon as it takes the mutex. It bounds blocking to one critical section and prevents some deadlocks. FreeRTOS does not provide it directly; you can approximate it by making one high-priority task the only user of the resource — which is the design recommended in the last lesson of this section.`,
      { t: 'callout', kind: 'decision', title: 'Three ways out of the I2C problem',
        md: `1. **Mutex with inheritance and short hold time.** Simple; H's worst-case wait is one full transaction by L.
2. **One "bus owner" task.** Only that task touches I2C; others send it requests through a queue. No lock, no inversion; latency becomes queueing delay you can prioritise.
3. **Give the slow sensor its own bus.** Hardware removes the sharing entirely.

Option 1 is right when transactions are short. Option 2 scales better and makes timeouts and error recovery live in one place. What is never right: a binary semaphore as the lock.` },

      `## Mars Pathfinder, briefly

In July 1997, shortly after landing, the Mars Pathfinder lander began resetting itself, losing or delaying data each time. The account given by the JPL software lead, Glenn Reeves, is the standard reference. The lander ran VxWorks. A high-priority bus-management task and a low-priority meteorological data task both used a shared resource (the "information bus") protected by a mutex that had been created **without** priority inheritance. Occasionally the low task held the mutex when the bus task needed it, and a medium-priority communications task then ran for a long time, preempting the low one. A watchdog-style check noticed that the bus task had not completed in its cycle and reset the system.

The engineers reproduced the fault on an identical system on Earth using trace recording, and fixed the spacecraft by uploading a small change that turned priority inheritance **on** for that mutex. The lessons usually drawn: inversion is a real and rare-timing bug; the watchdog did its job by turning a hang into a recoverable reset; and leaving tracing facilities in the flight software made remote diagnosis possible.`,

      { t: 'exercise',
        prompt: 'Worst-case blocking. H (priority 3) needs 2 ms of CPU per activation and takes mutex B once. L (priority 1) holds mutex B for at most 4 ms. M (priority 2), which does not use B, runs for up to 30 ms at a time. No task is higher than H. With priority inheritance, what is H\'s worst-case response time in ms (from becoming ready to finishing)?',
        hints: [
          'With inheritance, can M run while H is waiting for the mutex?',
          'Response time = own execution + worst-case blocking by a lower-priority holder.',
        ],
        answer: { type: 'number', value: 6, tol: 0.1, unit: 'ms' },
        solution: 'With inheritance, L runs at H\'s priority while H waits, so M cannot intervene. Blocking is at most L\'s 4 ms hold time: **2 + 4 = 6 ms**. Without inheritance (e.g. a binary semaphore used as the lock) one burst of M adds 30 ms — 36 ms — and since M can become ready again and again, there is no real bound.' },

      { t: 'exercise',
        prompt: 'Find the three defects in this bus-sharing code. `bus_lock` guards an SPI bus shared by a priority-8 display task and a priority-2 SD-card logger; a priority-5 audio task also exists.',
        code: C`static SemaphoreHandle_t bus_lock;

void bus_init(void)
{
    bus_lock = xSemaphoreCreateBinary();
    xSemaphoreGive(bus_lock);
}

void logger_write_block(const uint8_t *data, size_t len)   /* priority 2 */
{
    xSemaphoreTake(bus_lock, portMAX_DELAY);
    sd_write(data, len);
    ESP_LOGI("sd", "wrote %u bytes", (unsigned)len);
    vTaskDelay(pdMS_TO_TICKS(5));          /* let the card settle */
    xSemaphoreGive(bus_lock);
}`,
        hints: [
          'What kind of object is the lock, and what does that kind lack?',
          'List everything that happens while the lock is held. Which of those need the bus?',
          'What happens to the display task if `sd_write` hangs?',
        ],
        solution: '1. **A binary semaphore is used as a lock.** No priority inheritance, so when the display task (8) waits for the bus, the audio task (5) can preempt the logger (2) and stall the display indefinitely. Use `xSemaphoreCreateMutex()`.\n2. **Hold time includes logging and a 5 ms delay.** While the logger sleeps, it still holds the bus; inheritance cannot speed up a blocked task. Give the mutex right after `sd_write`; if the card truly needs the bus idle for 5 ms, that is a property of the SD driver to handle deliberately (and to budget as hold time), not something to hide.\n3. **`portMAX_DELAY` everywhere.** A hung card blocks the display forever with no diagnostic. Use a finite timeout and handle failure.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'A team replaces a mutex with "raise my own priority to the maximum, do the work, restore it" (using `vTaskPrioritySet`) to avoid inversion. On a single core, what does this achieve, what does it cost compared with a mutex, and when is it actually reasonable? What changes on a dual-core ESP32?',
        hints: [
          'While at maximum priority, which tasks can preempt it?',
          'Which tasks are delayed — only those that want the resource, or all of them?',
          'On two cores, does being the highest-priority task stop a task on the other core?',
        ],
        solution: 'On one core it is a hand-made **priority ceiling at the maximum level**: nothing can preempt the task during the work, so no other task can touch the resource and no inversion occurs. The cost: **every** task is delayed for the duration, including urgent ones that never use the resource — like suspending the scheduler. A real ceiling would raise only to the highest priority among the resource\'s users. It is reasonable when the protected work is short and all the urgent tasks use the resource anyway.\n\nOn a dual-core ESP32 it provides **no exclusion at all**: a task on the other core runs concurrently regardless of priority. There you need a mutex, or a spinlock-based critical section for very short work.' },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel — resource management chapter (mutexes, priority inversion, inheritance)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'FreeRTOS-Kernel: include/semphr.h (mutex and recursive mutex API contracts)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/semphr.h' },
        { title: 'Sha, Rajkumar, Lehoczky: "Priority Inheritance Protocols: An Approach to Real-Time Synchronization", IEEE Transactions on Computers, 1990', url: 'https://ieeexplore.ieee.org/document/57058', note: 'The original analysis of inheritance and ceiling protocols. URL not load-tested here; search by title.' },
      ] },
    ],
    quiz: [
      { q: 'In the classic three-task inversion, which task\'s execution makes the high-priority task\'s delay *unbounded*?', kind: 'concept',
        choices: [
          { t: 'The medium-priority task that does not use the lock at all.', ok: true, why: 'It preempts the low-priority holder, which therefore cannot release the lock; its run time has nothing to do with any critical section.' },
          { t: 'The low-priority task holding the lock.', why: 'Its critical section is the bounded part of the wait. If it were allowed to run it would release promptly.' },
          { t: 'The high-priority task itself, by blocking.', why: 'Blocking on a held lock is correct behaviour. The fault is in what is allowed to run while it waits.' },
        ] },
      { q: 'What does priority inheritance do when a priority-9 task blocks on a mutex held by a priority-2 task?', kind: 'concept',
        choices: [
          { t: 'Temporarily runs the holder at priority 9 until it gives the mutex.', ok: true, why: 'The holder then cannot be preempted by tasks at priorities 3–8, so it finishes its critical section as soon as possible.' },
          { t: 'Transfers the mutex to the priority-9 task immediately.', why: 'The holder may be halfway through using the resource. Taking it away would corrupt whatever the mutex protects.' },
          { t: 'Lowers the waiting task to priority 2.', why: 'Lowering the waiter would make matters worse. The boost goes to the holder.' },
        ] },
      { q: 'Why can a mutex not be given from an ISR to "release" a resource when a transfer completes?', kind: 'arch',
        choices: [
          { t: 'A mutex is owned by the task that took it; inheritance state is attached to that owner, and an ISR is not a task.', ok: true, why: 'The correct pattern is for the ISR to signal completion and for the owning task to give the mutex.' },
          { t: 'ISRs cannot call any kernel function.', why: 'They can call the FromISR family. The restriction is specific to what a mutex means.' },
          { t: 'It would be too slow.', why: 'Speed is not the issue. The operation is semantically wrong and the kernel does not support it.' },
        ] },
      { q: 'A task holding a mutex calls `vTaskDelay(pdMS_TO_TICKS(100))`. A higher-priority task then blocks on the mutex. What does inheritance achieve?', kind: 'code',
        choices: [
          { t: 'Nothing useful: the holder is asleep, and a raised priority does not shorten a delay.', ok: true, why: 'The waiter is blocked for the remainder of the 100 ms. Inheritance only helps a holder that is Ready and being preempted.' },
          { t: 'The delay is cancelled so the holder can finish.', why: 'The kernel never cuts a delay short because of a mutex. The holder asked to sleep and it sleeps.' },
          { t: 'The higher-priority task skips the mutex.', why: 'Exclusion is never bypassed. The waiter stays blocked until the give or its timeout.' },
        ] },
      { q: 'On Mars Pathfinder, what was the fix uploaded to the spacecraft?', kind: 'concept',
        choices: [
          { t: 'Enabling priority inheritance on the mutex shared by the high- and low-priority tasks.', ok: true, why: 'With inheritance the low-priority holder could no longer be preempted by the medium-priority task while the high-priority task waited.' },
          { t: 'Disabling the watchdog that kept resetting the system.', why: 'The watchdog was the safety net that recovered the system each time. Removing it would have converted resets into a hang.' },
          { t: 'Raising the low-priority task\'s priority permanently.', why: 'A permanent change would distort the whole schedule. The fix was a boost that applies only while the mutex is contended.' },
        ] },
      { q: 'What is the practical meaning of a mutex\'s "hold time" for schedulability?', kind: 'concept',
        choices: [
          { t: 'It is the blocking a higher-priority user of that mutex may suffer, and must be added to its worst-case response time.', ok: true, why: 'Under inheritance, a task can be blocked for the longest critical section of a lower-priority task on a mutex it uses.' },
          { t: 'It is the time the mutex takes to create.', why: 'Creation happens once at start-up and plays no part in run-time response.' },
          { t: 'It only matters for the task holding the mutex.', why: 'The holder is the one task it does not delay. It matters to everyone else who wants the resource.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 10
  {
    id: 'rtos-deadlock',
    title: 'Deadlocks',
    minutes: 40,
    summary: 'Four conditions that must all hold for a deadlock, and how to break one of them by design: lock ordering, timeouts with back-off, and not nesting locks at all.',
    skills: ['rtos-sk-deadlock'],
    blocks: [
      `## The problem

A handheld device has two buttons. "Save" copies settings from RAM to flash: it locks the settings, then locks the flash. "Restore" copies them back: it locks the flash, then locks the settings. Each works perfectly. QA reports that pressing both at once freezes the device — about one time in twenty. No crash, no watchdog message from the idle task, the heartbeat LED keeps blinking. Two tasks are simply gone.`,

      `## What a deadlock is

A [[Deadlock]] is a set of tasks each waiting for something that only another task in the set can provide. None can proceed, so none ever releases what the others need. Unlike starvation, nobody in the set is running; unlike a crash, the rest of the system carries on.`,
      { t: 'ascii', caption: 'The two-lock deadlock. Each task holds one mutex and waits for the other.',
        text: `save_task                         restore_task
  take(settings)  ✔                 take(flash)     ✔
  ── preempted ──────────────────►
                                    take(settings)  ✖ blocks (held by save)
  ◄──────────────────────────────
  take(flash)     ✖ blocks (held by restore)

        save ──waits for──► flash ──held by──► restore
          ▲                                       │
          └──held by── settings ◄──waits for──────┘` },

      `## The four Coffman conditions

A deadlock is possible only if **all four** hold at once:

1. **Mutual exclusion** — a resource can be held by one task at a time.
2. **Hold and wait** — a task holds one resource while waiting for another.
3. **No preemption** — a resource cannot be taken away from its holder.
4. **Circular wait** — there is a cycle: T1 waits for T2 waits for … waits for T1.

Break any one and deadlock is impossible. In firmware, 1 and 3 are usually inherent in what a mutex is, so you attack **2** or **4**.`,
      { t: 'predict',
        q: 'Task A runs `take(X); take(Y); …; give(Y); give(X);`. Task B runs `take(Y); take(X); …; give(X); give(Y);`. A has higher priority than B, single core. Does the deadlock require A to be preempted at a particular point?',
        choices: [
          { t: 'It needs B to hold Y when A, already holding X, asks for Y — for example B takes Y, A preempts and takes X, then A blocks on Y, and B later blocks on X.', ok: true, why: 'A cycle forms when each holds the lock the other needs. B must get in between A\'s start and A\'s second take, which happens if A becomes ready while B is between its two takes.' },
          { t: 'No, it deadlocks every time both run.', why: 'If either task completes both takes before the other starts, there is no cycle. It depends on the interleaving, which is why it is intermittent.' },
          { t: 'It cannot deadlock, because the higher-priority task always wins.', why: 'Priority decides who runs, not who holds a lock. A high-priority task still blocks on a mutex held by a lower one.' },
        ],
        reveal: 'The window is "B holds Y but has not yet taken X". If A becomes ready inside that window, the cycle closes. One in twenty is plausible for two button presses; one in ten million is plausible for other code — and equally fatal.' },
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'deadlock' }, title: 'Step into the deadlock',
        caption: 'Adjust the release times until the two tasks each hold one lock. Then make both tasks take the locks in the same order and try to deadlock them again.' },

      `## Prevention by design

**Lock ordering (breaks circular wait).** Give every mutex in the system a rank and require that a task holding a lock may only take locks of *higher* rank. A cycle would need someone to take a lower-ranked lock while holding a higher one, which the rule forbids. Write the order down in one header comment. It is the most effective single rule, and it is checkable in code review.

**Do not nest (breaks hold and wait).** If no task ever holds two locks, no cycle can exist. Copy what you need out from under the first lock, release it, then take the second. Or put both resources behind one lock. Or give each resource an owner task and send it messages — a task blocked on its own queue holds nothing.

**Timeouts with back-off (recovery, not prevention).** Take the second lock with a finite timeout. On failure, **release the first lock**, wait a short, preferably randomised, time and retry. Releasing is the essential step: a timeout that leaves the first lock held changes a deadlock into repeated failure. Without randomisation two tasks can retry in step forever — a *livelock*, where both are busy and neither progresses.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'The save/restore pair made safe by a global lock order: settings before flash, always.',
        code: C`/* LOCK ORDER (lowest rank first): s_settings_mutex, then s_flash_mutex. */
static SemaphoreHandle_t s_settings_mutex;
static SemaphoreHandle_t s_flash_mutex;

static bool lock_both(TickType_t timeout)
{
    if (xSemaphoreTake(s_settings_mutex, timeout) != pdTRUE) {
        return false;
    }
    if (xSemaphoreTake(s_flash_mutex, timeout) != pdTRUE) {
        xSemaphoreGive(s_settings_mutex);      /* never keep one while failing on the other */
        return false;
    }
    return true;
}

static void unlock_both(void)
{
    xSemaphoreGive(s_flash_mutex);             /* release in reverse order */
    xSemaphoreGive(s_settings_mutex);
}

void save_settings(void)
{
    if (!lock_both(pdMS_TO_TICKS(200))) { report_busy(); return; }
    flash_write_settings();
    unlock_both();
}

void restore_settings(void)
{
    if (!lock_both(pdMS_TO_TICKS(200))) { report_busy(); return; }
    flash_read_settings();
    unlock_both();
}`,
        explain: [
          { lines: '1', md: 'The order is a property of the whole program, so it is documented once where the locks are declared.' },
          { lines: '5-15', md: 'Both operations acquire through one helper. There is now exactly one place where the order is encoded, and nobody can get it backwards.' },
          { lines: '10-13', md: 'On failure the helper returns holding nothing. The caller is never left in a "half-locked" state.' },
        ] },
      { t: 'callout', kind: 'mistake', title: 'Hidden nesting',
        md: `Most real deadlocks are not two visible \`take\` calls. They are a call made while holding a lock, into a module that takes its own lock: logging while holding the settings mutex (the logger locks the UART), or invoking a callback with a lock held (the callback calls back into you). Rule: **do not call out of your module while holding your module's lock.** The same applies to blocking on a queue while holding a mutex that the task which would service the queue needs.` },
      { t: 'callout', kind: 'decision', title: 'Which defence?',
        md: `Use **no nesting** wherever you can — it needs no global knowledge. Where two locks really must be held together, use a **documented global order** and acquire through a helper. Add **finite timeouts** everywhere as detection: a logged timeout tells you which lock and which task, and a task-level watchdog (last lesson) turns an undetected deadlock into a controlled restart. Do not rely on timeouts alone as the design.` },

      { t: 'exercise',
        prompt: 'Where does this deadlock? Give the exact interleaving, name which Coffman condition you will break, and show the change.',
        code: C`static SemaphoreHandle_t lcd_mutex, i2c_mutex;

void ui_task_draw_temp(void)             /* UI task, priority 4 */
{
    xSemaphoreTake(lcd_mutex, portMAX_DELAY);
    int t = sensor_read_temp();          /* takes and gives i2c_mutex inside */
    lcd_printf("T=%d", t);
    xSemaphoreGive(lcd_mutex);
}

void sensor_task_poll(void)              /* sensor task, priority 6 */
{
    xSemaphoreTake(i2c_mutex, portMAX_DELAY);
    int t = i2c_read_temp_raw();
    if (t > LIMIT) {
        lcd_show_warning();              /* takes and gives lcd_mutex inside */
    }
    xSemaphoreGive(i2c_mutex);
}`,
        hints: [
          'Write down, for each function, the order in which the two mutexes are acquired (including inside the called functions).',
          'Find a point where UI holds one and sensor holds the other.',
          'Can either function do its second operation after releasing its first lock?',
        ],
        solution: 'UI order: `lcd` then `i2c`. Sensor order: `i2c` then `lcd`. Interleaving: UI takes `lcd_mutex`; the sensor task (higher priority) preempts, takes `i2c_mutex`, reads over the limit, and blocks on `lcd_mutex`. UI resumes, calls `sensor_read_temp()`, and blocks on `i2c_mutex`. Cycle. It only happens when the temperature is over the limit at that moment — a fault that appears precisely when the warning matters.\n\nBreak **hold and wait** — neither function needs both at once:\n```c\nvoid ui_task_draw_temp(void)\n{\n    int t = sensor_read_temp();          /* i2c lock taken and released inside */\n    xSemaphoreTake(lcd_mutex, portMAX_DELAY);\n    lcd_printf("T=%d", t);\n    xSemaphoreGive(lcd_mutex);\n}\n\nvoid sensor_task_poll(void)\n{\n    xSemaphoreTake(i2c_mutex, portMAX_DELAY);\n    int t = i2c_read_temp_raw();\n    xSemaphoreGive(i2c_mutex);\n    if (t > LIMIT) lcd_show_warning();   /* lcd lock taken with nothing else held */\n}\n```\nNo task now holds two locks, so no cycle can form. (Finite timeouts should still replace `portMAX_DELAY`.)' },

      { t: 'exercise',
        prompt: 'A system has 4 mutexes, ranked 1–4. A code review finds these acquisition sequences in different tasks: (a) 1→3, (b) 2→4, (c) 3→4, (d) 4→2, (e) 1→2→3. Which sequence violates the ordering rule (answer with its letter), and which other sequence could it deadlock with?',
        hints: ['The rule: while holding rank r, only take ranks greater than r.', 'For the violator, find a sequence that takes the same two locks in the opposite order.'],
        answer: { type: 'text', accept: ['^\\s*\\(?d\\)?', '\\bd\\b'], nudge: 'Look for a sequence that goes from a higher rank to a lower one.' },
        solution: '**(d)** takes 2 while holding 4. It can deadlock with **(b)**, which takes 4 while holding 2: (b) holds 2 and wants 4, (d) holds 4 and wants 2. All the others only go upward and cannot form a cycle among themselves.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'Two tasks communicate with two queues of length 4: A sends requests to B on Q1 and B sends replies to A on Q2, both with `portMAX_DELAY`. There are no mutexes anywhere. Under a burst, the two tasks freeze. Explain how this is a deadlock in terms of the four conditions, and give two fixes.',
        hints: [
          'What is the "resource" each task is waiting for?',
          'What is A doing when Q1 is full? What is B doing when Q2 is full?',
        ],
        solution: 'The resources are **free slots** in the queues. A is blocked sending on a full Q1 (waiting for B to receive); B is blocked sending a reply on a full Q2 (waiting for A to receive). Each is waiting for the other to do something it cannot do while blocked: mutual exclusion (a slot holds one item), hold and wait (each holds its pending work while waiting), no preemption (queued items are not discarded), circular wait (A→B→A).\n\nFixes: (1) **A never blocks on send without also servicing replies** — e.g. A limits outstanding requests to Q2\'s capacity (a counting semaphore as "credits"), so B\'s reply always has room. (2) **Finite send timeouts with a defined overflow policy** (drop, coalesce or report), so one side always goes back to receiving. More generally: cyclic blocking message paths need flow control designed in, the same way cyclic lock graphs need an order.' },

      { t: 'refs', items: [
        { title: 'Coffman, Elphick, Shoshani: "System Deadlocks", ACM Computing Surveys, 1971', url: 'https://dl.acm.org/doi/10.1145/356586.356588', note: 'The source of the four necessary conditions. URL not load-tested here; search by title.' },
        { title: 'Mastering the FreeRTOS Real Time Kernel — resource management chapter (deadlock, recursive mutexes, gatekeeper tasks)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
      ] },
    ],
    quiz: [
      { q: 'Which change makes the save/restore deadlock impossible rather than merely less likely?', kind: 'arch',
        choices: [
          { t: 'Both operations take the two mutexes in the same fixed order.', ok: true, why: 'With one global order a cycle of waits cannot form, whatever the timing.' },
          { t: 'Raising the priority of the save task.', why: 'Priority changes who runs first but a high-priority task still blocks on a lock held by a lower one, so the cycle can still close.' },
          { t: 'Debouncing the buttons so presses are 50 ms apart.', why: 'That narrows the window in one usage pattern. Any other way of triggering both operations close together still deadlocks.' },
        ] },
      { q: 'A task takes mutex A, then tries mutex B with a 100 ms timeout. On timeout it logs an error and retries taking B, still holding A. What has been achieved?', kind: 'code',
        choices: [
          { t: 'Nothing: the deadlock persists because A is never released; it is now a logged deadlock.', ok: true, why: 'Recovery by timeout only works if the task backs off completely, releasing what it holds so the other task can finish.' },
          { t: 'The deadlock is resolved after the first timeout.', why: 'The other task is still waiting for A. Nothing about the cycle changed when the timeout expired.' },
          { t: 'The kernel breaks the deadlock by releasing B from the other task.', why: 'FreeRTOS never revokes a mutex. Only the holder can give it.' },
        ] },
      { q: 'Which is an example of *hidden* lock nesting?', kind: 'code',
        choices: [
          { t: 'Calling a logging function, which locks the UART, while holding your own module\'s mutex.', ok: true, why: 'Two locks are held at once, but only one `take` is visible in your code; the order is decided by whoever wrote the other module.' },
          { t: 'Taking the same mutex in two different functions that never call each other.', why: 'If each function gives the mutex before returning, only one lock is ever held at a time.' },
          { t: 'Using two mutexes in two unrelated tasks, one each.', why: 'A cycle needs some task to hold one lock while waiting for another. Here no task ever holds two.' },
        ] },
      { q: 'The heartbeat LED still blinks but two tasks have stopped responding and CPU load is low. Which is most consistent with a deadlock rather than starvation?', kind: 'concept',
        choices: [
          { t: 'Both stuck tasks are in the Blocked state, each on a mutex the other holds.', ok: true, why: 'Deadlocked tasks are not runnable and use no CPU. A task list showing them Blocked on each other\'s locks is the signature.' },
          { t: 'One task is Running continuously at high priority.', why: 'That is the picture of starvation or a busy loop: something is consuming the CPU and the others are Ready but not chosen.' },
          { t: 'The idle task never runs.', why: 'In a deadlock the stuck tasks consume nothing, so idle gets more time, not less.' },
        ] },
      { q: 'Why does "one owner task per resource, others send it messages" eliminate lock-order deadlocks?', kind: 'arch',
        choices: [
          { t: 'No task ever holds a resource while waiting for another, so hold-and-wait cannot occur.', ok: true, why: 'Requesters hold nothing while they wait for a reply, and the owner works through requests one at a time.' },
          { t: 'Queues are faster than mutexes.', why: 'Speed is not the reason, and a queue hand-off usually costs more than an uncontended mutex.' },
          { t: 'Owner tasks run at the highest priority.', why: 'The owner can be at any priority. The property comes from the absence of nested holding, not from priority.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 11
  {
    id: 'rtos-realtime',
    title: 'Timing constraints and real-time scheduling',
    minutes: 60,
    summary: 'Deadlines, latency and jitter; the periodic task model; rate-monotonic priorities and the Liu–Layland bound; response-time analysis; measuring with a GPIO and a logic analyser; sizing stacks.',
    skills: ['rtos-sk-rma', 'rtos-sk-measure', 'rtos-sk-periodic'],
    blocks: [
      `## The problem

"It works on my desk" is a statement about the runs you watched. A drone's attitude loop that meets its 2 ms deadline 99.99 % of the time fails once every 20 seconds of flight. To claim a system is real-time you need an **argument** that the deadline is met in the worst case, and a **measurement** that checks the argument's assumptions. This lesson gives you both.`,

      `## Vocabulary

"Real-time" does not mean fast. It means **correctness depends on when**, not only on what.

| Class | A missed deadline means | Example |
|---|---|---|
| **Hard** | system failure | airbag firing, motor commutation, a bus protocol's response window |
| **Firm** | the result is worthless but nothing breaks; occasional misses tolerated | a video frame, a sensor sample that is simply skipped |
| **Soft** | value degrades with lateness | UI response, logging |

Three measures that people confuse:

- **[[Latency]]** — the delay from an event to the response to it.
- **[[Jitter]]** — the *variation* in that delay (or in a period) from one occurrence to the next. A control loop often tolerates a constant 300 µs latency better than a latency that wanders between 50 and 300 µs.
- **Throughput** — work completed per second. Optimising throughput (batching, long critical sections, big buffers) often makes latency and jitter worse.

**[[WCET]]** (worst-case execution time) is the longest a piece of code can take to run *uninterrupted* on the target. **Response time** is how long it takes from release to completion, including time spent preempted or blocked. Deadlines are about response time; WCET is an input to computing it.`,

      `## The periodic task model

Describe each task *i* by three numbers:

- **T** — period (or minimum time between activations for event-driven tasks),
- **C** — worst-case execution time per activation,
- **D** — relative deadline (often D = T: "finish before the next activation").

Its **utilisation** is U = C/T, the fraction of one CPU it needs. Total utilisation is the sum. If the total exceeds 1 (per core), no scheduler can help.`,

      `## Rate-monotonic priorities and the Liu–Layland bound

**Rate-monotonic (RM) assignment:** the shorter the period, the higher the priority. Liu and Layland proved in 1973 that for independent periodic tasks with D = T on one processor, RM is the *optimal* fixed-priority assignment: if any fixed assignment meets all deadlines, RM does.

They also gave a sufficient test. *n* tasks under RM always meet their deadlines if

**U = Σ Cᵢ/Tᵢ ≤ n(2^(1/n) − 1)**

| n | 1 | 2 | 3 | 4 | 5 | → ∞ |
|---|---|---|---|---|---|---|
| bound | 1.000 | 0.828 | 0.780 | 0.757 | 0.743 | ln 2 ≈ 0.693 |

**Worked check.** Three tasks: sampling (C = 2 ms, T = 10 ms), control (C = 5 ms, T = 25 ms), telemetry (C = 10 ms, T = 50 ms). U = 0.2 + 0.2 + 0.2 = 0.60. The bound for n = 3 is 3 × (2^(1/3) − 1) = 3 × 0.2599 = 0.780. Since 0.60 ≤ 0.780, all deadlines are guaranteed under RM priorities (sampling highest, telemetry lowest).

The test is **sufficient, not necessary**. Below the bound: guaranteed. Above 1: impossible. In between: *unknown* — many task sets up to U = 1 are schedulable (always, when the periods are harmonic, each a multiple of the next shorter), and you need the exact test below.`,

      `## Response-time analysis

The intuition: a task's response time is its own execution, plus any blocking by lower-priority tasks holding a lock it needs, plus the execution of every higher-priority activation that arrives while it is trying to finish.

**Rᵢ = Cᵢ + Bᵢ + Σ over higher-priority j of ⌈Rᵢ / Tⱼ⌉ × Cⱼ**

R appears on both sides, so iterate: start with R = Cᵢ + Bᵢ, plug in, repeat until it stops changing (meets the deadline if R ≤ Dᵢ) or exceeds the deadline (fails).

**Worked example.** RM priorities, no blocking: τ1 (C = 1, T = 4), τ2 (C = 2, T = 6), τ3 (C = 3, T = 10). U = 0.25 + 0.333 + 0.30 = 0.883, above the 0.780 bound — the simple test is inconclusive.

- R₁ = 1. ✔ (≤ 4)
- R₂: start 2 → 2 + ⌈2/4⌉×1 = 3 → 2 + ⌈3/4⌉×1 = 3. R₂ = 3. ✔ (≤ 6)
- R₃: start 3 → 3 + ⌈3/4⌉×1 + ⌈3/6⌉×2 = 6 → 3 + 2×1 + 1×2 = 7 → 3 + 2 + 2×2 = 9 → 3 + 3 + 4 = 10 → 3 + ⌈10/4⌉×1 + ⌈10/6⌉×2 = 3 + 3 + 4 = 10. R₃ = 10. ✔ (≤ 10, with nothing to spare)

So the set is schedulable although it fails the utilisation bound — and it has zero margin: add 1 ms of blocking from a mutex and τ3 misses.

Other policies you will see named: **deadline-monotonic** (priority by shortest deadline; the optimal fixed assignment when D < T) and **EDF**, earliest deadline first (dynamic priorities; can use up to 100 % of one CPU, but behaves less predictably in overload and is not what FreeRTOS provides).`,
      { t: 'callout', kind: 'warn', title: 'What the model leaves out',
        md: `The analysis assumes independent tasks, known C, one core, and zero-cost switching. Real systems add: ISR time (treat each ISR as a highest-priority "task"), critical-section and mutex blocking (the B term), context-switch overhead, tick granularity, and caches. On ESP32 the Wi-Fi and Bluetooth stacks run their own high-priority tasks and interrupts that you did not write. Treat analysis as the design argument and measurement as its check. Neither replaces the other.` },
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'preemptive' }, title: 'Try the worked example',
        caption: 'Enter periods 4, 6, 10 and run times 1, 2, 3. First assign priorities "by importance" with the longest-period task highest and find the missed deadline; then assign rate-monotonically and check that the lowest-priority task finishes exactly at t = 10.' },
      { t: 'predict',
        q: 'Two tasks: A (C = 2, T = 5) and B (C = 4, T = 10), both released at t = 0, deadlines equal to periods. U = 0.8. If you give **B** the higher priority ("it does more work, so it is more important"), what happens?',
        choices: [
          { t: 'A misses its first deadline: it cannot start until t = 4 and finishes at t = 6, after its deadline at t = 5.', ok: true, why: 'B runs 0–4 unpreempted. A then needs 2 ticks but only 1 remains before t = 5.' },
          { t: 'Both meet their deadlines, since utilisation is below 100 %.', why: 'Utilisation below 1 only says there is enough total CPU time. Whether each deadline is met depends on the order in which that time is given out.' },
          { t: 'B misses its deadline because A preempts it.', why: 'With B at the higher priority, A cannot preempt it at all.' },
        ],
        reveal: 'With rate-monotonic priorities (A higher): A runs 0–2, B 2–5, A 5–7, B 7–8 (done at 8 ≤ 10). Everything meets its deadline with the same code and the same CPU. Priority assignment alone made the difference.' },

      `## Measuring: a GPIO and a logic analyser

A \`printf\` timestamp disturbs what it measures: formatting takes tens of microseconds and the UART may block. A GPIO write takes well under a microsecond and a logic analyser records it without affecting the firmware.

- **Execution time:** set a pin high at the start of the task body, low at the end. Pulse width = execution time *plus* any preemption during it.
- **Period and jitter:** measure rising edge to rising edge. Jitter is the spread: record max − min over thousands of cycles, not the average.
- **Latency:** put the stimulus (the button or a signal-generator edge) on one channel and the response pin on another; measure the gap.
- **Preemption:** give each task and ISR its own pin; the stacked traces are a Gantt chart of the real schedule.

Sample at least ten times faster than the smallest interval you care about, and run the measurement **under worst-case load** (radio on, flash writes happening, all buttons mashed). Use the analyser's statistics or export the edges and compute the histogram.`,
      { t: 'code', lang: 'c', status: 'hw', caption: 'Instrumenting a periodic task. Only meaningful with a logic analyser on GPIO 25; nothing here has measured it for you.',
        code: C`#define DBG_SAMPLE_GPIO 25

static void sample_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        gpio_set_level(DBG_SAMPLE_GPIO, 1);    /* rising edge: activation actually started */
        take_sample();
        gpio_set_level(DBG_SAMPLE_GPIO, 0);    /* falling edge: activation finished        */
        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));
    }
}`,
        explain: [
          { lines: '7', md: 'One register write. Rising-edge-to-rising-edge on the analyser is the real period; its spread is the task\'s release jitter.' },
          { lines: '9', md: 'High time is the response time of this activation. If it is sometimes much longer than usual, something preempted or blocked the task — add a pin to the suspect and look for the overlap.' },
        ] },

      `## Stack sizing per task

A deadline argument is void if a task overflows its stack. For each task:

1. **Estimate:** deepest call chain (sum of frames) + largest local buffers + saved context + anything library calls need (formatted printing is the usual surprise).
2. **Over-allocate** at first, generously.
3. **Measure** with \`uxTaskGetStackHighWaterMark()\` after exercising the worst paths — error handlers, the longest log line, the deepest recursion.
4. **Set** the size to peak usage plus a margin (25–50 % is common practice), and keep overflow checking enabled in development builds.

On ESP-IDF the high-water mark is reported in bytes; on upstream FreeRTOS, in words.`,
      { t: 'callout', kind: 'mistake', title: 'Reading the high-water mark too early',
        md: `The high-water mark only reflects paths that have **already run**. Checked after ten seconds of idle operation it says nothing about the error path that formats a 200-character message, or the once-a-day flash compaction. Drive every worst-case path first, then read it. And remember it measures the past: a stack that was 80 % used with one firmware version may overflow after a library update.` },
      { t: 'callout', kind: 'decision', title: 'How much margin on the CPU?',
        md: `Aim well below the theoretical limit. Below the Liu–Layland bound (about 70 %) the timing argument is trivial and survives small changes. Designs that pass only by exact response-time analysis with no slack (like the worked example) are correct on paper and fragile in practice: one new interrupt source breaks them. If you need the last 20 % of the CPU, make the periods harmonic or buy a faster part.` },

      { t: 'exercise',
        prompt: 'Utilisation check. Four periodic tasks under rate-monotonic priorities: (C = 1 ms, T = 5 ms), (C = 2 ms, T = 20 ms), (C = 6 ms, T = 40 ms), (C = 20 ms, T = 100 ms). Compute the total utilisation as a decimal.',
        hints: ['U = C/T for each, then add.', '0.2 + 0.1 + 0.15 + 0.2'],
        answer: { type: 'number', value: 0.65, tol: 0.005 },
        solution: 'U = 0.20 + 0.10 + 0.15 + 0.20 = **0.65**. The bound for n = 4 is 4 × (2^(1/4) − 1) = 0.757. Since 0.65 ≤ 0.757, the set is guaranteed schedulable under RM. (The periods 5, 20, 40, 100 are not fully harmonic — 100 is not a multiple of 40 — so you could not have relied on the harmonic shortcut.)' },

      { t: 'exercise',
        prompt: 'Response-time analysis with blocking. Take the worked example (τ1: C=1, T=4; τ2: C=2, T=6; τ3: C=3, T=10). Now τ2 shares a mutex with τ3, and τ3 can hold it for up to 1 time unit. What is τ2\'s worst-case response time, and does it still meet its deadline of 6?',
        hints: [
          'Blocking B₂ = longest critical section of a lower-priority task on a mutex τ2 uses = 1.',
          'Start the iteration at C₂ + B₂ = 3, then add interference from τ1: ⌈R/4⌉ × 1.',
          'Iterate until the value repeats.',
        ],
        answer: { type: 'number', value: 4, tol: 0 },
        solution: 'R₂ = C₂ + B₂ + ⌈R₂/4⌉×1. Start 3 → 2 + 1 + ⌈3/4⌉ = 4 → 2 + 1 + ⌈4/4⌉ = 4. **R₂ = 4 ≤ 6**: met. Note that τ1 can also be delayed if it ever uses that mutex, and that τ3 already had zero slack — any blocking term for τ3, or any ISR time not in the model, breaks it.' },

      { t: 'exercise',
        prompt: 'A task was created on ESP-IDF with a 4096-byte stack. After a full worst-case test run, `uxTaskGetStackHighWaterMark()` for it returns 312. How many bytes did the task use at its peak?',
        hints: ['The high-water mark is the minimum amount that was ever *free*.', 'On ESP-IDF it is in bytes.'],
        answer: { type: 'number', value: 3784, tol: 0, unit: 'bytes' },
        solution: '4096 − 312 = **3784 bytes** used at peak — 92 % of the stack. That is too close: for a 25 % margin on the total, allocate at least 3784 / 0.75 ≈ 5045, so round up to 5120 or 6144 bytes, then re-measure.' },

      { t: 'widget', name: 'timer-lab', props: { mode: 'timer' }, title: 'Timer resolution and your measurement',
        caption: 'A periodic task\'s release time can be no finer than the timer behind it. Work out the tick period for a given prescaler and compare it with the jitter you intend to measure.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'You measure a 10 ms `vTaskDelayUntil` task on an ESP32 with a logic analyser over 10 000 periods: mean 10.000 ms, min 9.62 ms, max 10.41 ms, and three periods of about 20 ms. List the likely source of (a) the ±0.4 ms spread, (b) the 20 ms periods, and what you would measure next to confirm each.',
        hints: [
          'What runs at higher priority than your task, or with interrupts masked?',
          'What does `vTaskDelayUntil` do if the task was still running or blocked when its next release came?',
          'A second GPIO on a suspect makes the cause visible as an overlap.',
        ],
        solution: '**(a) Spread:** release jitter from things that delay the task after its tick: higher-priority tasks and ISRs (Wi-Fi/Bluetooth if enabled), critical sections elsewhere that mask the tick, and flash operations that suspend code execution. Note that one late release makes that period long and the next one short, which is why min and max are roughly symmetric about the mean. Confirm by toggling a pin in suspected tasks/ISRs and looking for overlap with the late edges, and by repeating with the radio off.\n\n**(b) ~20 ms periods:** a whole activation was skipped or merged: the task overran or was blocked (a mutex held by something slow, a blocking log call) past its next release, or was kept off the CPU for more than 10 ms. Confirm with the *high time* of the same pin (was the previous activation abnormally long?) and by checking `xTaskDelayUntil`\'s return value in firmware and counting overruns. Three in 10 000 is exactly the kind of rate that an average hides and a hard deadline cannot accept.' },

      { t: 'refs', items: [
        { title: 'C. L. Liu and J. W. Layland: "Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environment", Journal of the ACM, 1973', url: 'https://dl.acm.org/doi/10.1145/321738.321743', note: 'Rate-monotonic optimality and the n(2^(1/n) − 1) bound. URL not load-tested here; search by title.' },
        { title: 'Audsley, Burns, Richardson, Tindell, Wellings: "Applying New Scheduling Theory to Static Priority Pre-emptive Scheduling", Software Engineering Journal, 1993', url: 'https://ieeexplore.ieee.org/document/238595', note: 'Response-time analysis. URL not load-tested here; search by title.' },
        { title: 'FreeRTOS-Kernel: include/task.h (uxTaskGetStackHighWaterMark, xTaskDelayUntil)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/task.h' },
        { title: 'sigrok / PulseView (open-source logic analyser software)', url: 'https://github.com/sigrokproject/pulseview' },
      ] },
    ],
    quiz: [
      { q: 'Three tasks have total utilisation 0.85 under rate-monotonic priorities. The Liu–Layland bound for n = 3 is 0.780. What can you conclude?', kind: 'concept',
        choices: [
          { t: 'Nothing yet: the bound is only sufficient, so an exact response-time analysis is needed.', ok: true, why: 'Between the bound and 1.0 a task set may or may not be schedulable; the simple test cannot tell.' },
          { t: 'The tasks will miss deadlines.', why: 'Failing a sufficient test does not prove failure. Sets with harmonic periods, for instance, are schedulable up to full utilisation.' },
          { t: 'The tasks meet all deadlines because 0.85 < 1.', why: 'Below 1 means only that enough CPU exists in total. Fixed priorities may still serve it in an order that makes someone late.' },
        ] },
      { q: 'Under rate-monotonic assignment, which task gets the highest priority?', kind: 'concept',
        choices: [
          { t: 'The one with the shortest period.', ok: true, why: 'It has the least time to finish each activation, so it can least afford to be kept waiting.' },
          { t: 'The one with the longest execution time.', why: 'Long-running work at high priority delays everything else for longest. Execution time does not set priority under RM.' },
          { t: 'The one that is most important to the product.', why: 'Importance is not a timing property. An important task with a slack deadline loses nothing by waiting.' },
        ] },
      { q: 'A control loop has a constant 400 µs delay from sample to output on every cycle. Another has a delay that varies between 50 and 300 µs. Which statement is right?', kind: 'concept',
        choices: [
          { t: 'The first has higher latency but lower jitter; a controller can be tuned for a constant delay, so it is often the better behaved.', ok: true, why: 'A fixed delay is a known quantity in the loop model. A varying one acts as noise.' },
          { t: 'The second is strictly better because its worst case is smaller.', why: 'Its worst case is smaller, but the variation changes the effective sample timing from cycle to cycle, which the controller cannot compensate.' },
          { t: 'They are equivalent because both are under 1 ms.', why: 'Meeting a deadline is one requirement. Regularity is a separate one that many signal and control algorithms depend on.' },
        ] },
      { q: 'Why is a GPIO toggle preferred over a `printf` timestamp for measuring task timing?', kind: 'arch',
        choices: [
          { t: 'It costs well under a microsecond and never blocks, so it barely changes the timing being measured.', ok: true, why: 'Formatted output takes far longer, may take a lock, and can itself reorder the schedule.' },
          { t: 'GPIO pins have higher priority than the UART.', why: 'A pin has no priority. The point is how little processor time the instrumentation consumes.' },
          { t: 'Logic analysers cannot decode UART.', why: 'They decode UART perfectly well. The problem is the cost of producing the text inside the firmware.' },
        ] },
      { q: 'In the response-time equation, what does the term ⌈R/Tⱼ⌉ × Cⱼ represent?', kind: 'concept',
        choices: [
          { t: 'The CPU time taken by every activation of higher-priority task j that can arrive during the response window.', ok: true, why: 'In a window of length R, task j can be released up to ⌈R/Tⱼ⌉ times, each costing Cⱼ.' },
          { t: 'The time the task spends blocked on a mutex.', why: 'Blocking by lower-priority lock holders is the separate B term. This term is interference from above.' },
          { t: 'The context-switch overhead.', why: 'Switch overhead is not in the basic equation; it is usually folded into the C values.' },
        ] },
      { q: 'A task\'s stack high-water mark is read once, 5 s after boot, and shows 60 % free. Why is that weak evidence?', kind: 'arch',
        choices: [
          { t: 'It only covers code paths executed so far; rarely taken paths such as error handling may go deeper.', ok: true, why: 'The mark records the deepest use up to now, so the worst-case paths must be driven before it means anything.' },
          { t: 'The value is only updated once per hour.', why: 'It is computed on demand by scanning the stack for the untouched fill pattern.' },
          { t: 'It measures heap, not stack.', why: 'It is specifically the minimum free space of that task\'s stack.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 12
  {
    id: 'rtos-design',
    title: 'Designing inter-task communication',
    minutes: 50,
    summary: 'Data ownership, message passing versus shared memory, pipelines and back-pressure, drawing a task diagram, one owner per peripheral, and supervising tasks with a watchdog.',
    skills: ['rtos-sk-design', 'rtos-sk-ipc-choose'],
    blocks: [
      `## The problem

A firmware has grown to eleven tasks. Seven of them call \`uart_write\`, five touch the I2C bus, and a 40-field global "state" struct is read and written from everywhere, guarded by one mutex that is held for anything from 2 µs to 30 ms. Each new feature produces a new timing bug. Nobody can say what happens when the SD card stalls. Every individual piece of code is "correct".

The earlier lessons gave you mechanisms. This one is about arranging them so that most concurrency bugs cannot be written in the first place.`,

      `## Start from ownership

For every piece of mutable data and every peripheral, decide **which single task owns it**. The owner is the only code that reads or writes it. Everyone else asks the owner, by message.

- Data with one owner needs **no lock**. There is nothing to race on.
- A queue transfers **a copy** (or transfers ownership of a buffer). After sending, the sender has no claim on it.
- A peripheral with one owner cannot have interleaved transactions, and its error handling, retries and timeouts live in one place.

**Shared memory with locks** is still right for a small amount of state that many tasks read often and that changes rarely (configuration, a status snapshot) — keep it small, protect it with one short lock, and always copy out a consistent snapshot.

| | Message passing (queues) | Shared memory + lock |
|---|---|---|
| Coupling in time | decoupled: queue absorbs bursts | reader and writer contend directly |
| Failure modes | queue full, latency | races if a lock is forgotten, inversion, deadlock |
| Cost per interaction | copy + possible context switch | a few instructions if uncontended |
| Reviewability | interactions are visible as queue sends | any line may touch the shared data |`,
      { t: 'callout', kind: 'decision', title: '"One task owns each peripheral"',
        md: `Make it a project rule. The UART/log task owns the console; the bus task owns I2C; the storage task owns flash. Other tasks hold a queue handle, not a driver handle. This removes most mutexes from the design (and with them inversion and lock-order deadlock), serialises access naturally, and gives each peripheral a place to implement timeouts and recovery. The cost is one task's stack and a queue hop of latency. For a peripheral used by exactly one task anyway, the rule is already satisfied — do not add a task for its own sake.` },

      `## Pipelines and back-pressure

Most embedded data flows are pipelines: **ISR → acquisition task → processing task → output task**, joined by queues. Three questions settle a pipeline's behaviour:

1. **Rates.** Is the average consumption rate above the average production rate at every stage? If not, no queue length saves you.
2. **Bursts.** How deep must each queue be to absorb the worst burst? (Burst length × rate difference, as computed in the queues lesson.)
3. **What happens when a queue is full?** This is [[Back-pressure]], and it must be a decision, not an accident:

| Policy | How | Right when |
|---|---|---|
| **Block the producer** | send with a timeout | the producer can afford to wait (file reader, batch job) — never a sampling task or an ISR |
| **Drop newest** | send with timeout 0, count failures | old data is still valuable in order (a log) |
| **Drop oldest / overwrite** | length-1 queue with \`xQueueOverwrite\`, or pop-then-push | only the latest value matters (a setpoint, a display value) |
| **Coalesce** | merge into the pending item | events that add up (encoder counts, "dirty" flags) |

Whatever you choose, **count it**. A \`dropped\` counter that is visible in the status output turns an invisible data loss into a measurable one.`,
      { t: 'predict',
        q: 'A 100 Hz sampling task (priority 6) sends each sample with `xQueueSend(q, &s, portMAX_DELAY)`. The consumer (priority 3) writes to an SD card that occasionally stalls for 300 ms. The queue length is 8. What happens to the *sampling* during a stall?',
        choices: [
          { t: 'After 80 ms the queue is full; the sampler blocks in the send and stops sampling until the card recovers, leaving a gap of about 220 ms.', ok: true, why: 'A blocking send propagates the stall upstream. The sampler\'s period is now decided by the SD card.' },
          { t: 'Sampling continues at 100 Hz and the newest samples are discarded.', why: 'Discarding requires a send that does not wait. This one waits forever for space.' },
          { t: 'The kernel enlarges the queue.', why: 'Queue storage is fixed when the queue is created and never grows.' },
        ],
        reveal: 'Back-pressure travelled all the way to the task with the hard timing requirement. Either size the queue for the stall (300 ms × 100 Hz = 30 items plus margin), or send with timeout 0 and count drops — and decide which loss the product can tolerate.' },

      `## Drawing the task diagram

Before writing code, draw one page with:

- a box per **task**: name, priority, period or triggering event, stack size;
- an arrow per **queue / notification / semaphore**, labelled with item type, length and full-policy;
- each **ISR** and what it signals;
- each **peripheral**, attached to exactly one owner;
- any **shared state**, with the lock that guards it and its maximum hold time.

Then check it: Is every priority justified by a deadline? Does any task hold a lock while blocking? Is there a cycle of blocking sends? For each queue, what happens when it is full? Which task detects that another has died?`,
      { t: 'ascii', caption: 'A task diagram for a small data logger. Every peripheral has one owner; every arrow has a length and a full-policy.',
        text: `  [timer ISR]──notify──►┌───────────────┐  q_samples (32 × sample_t,      ┌───────────────┐
                        │ sample  P6    │   drop newest + count)          │ process  P4   │
   ADC ◄───────────────►│ 10 ms period  │────────────────────────────────►│ event-driven  │
                        └───────────────┘                                 └───────┬───────┘
                                                                                  │ q_records (8 × record_t,
  [button ISR]─notify─►┌───────────────┐   q_log (16 × log_msg_t,                 │  block 100 ms, then count)
                       │ ui      P3    │    drop newest + count)                  ▼
   LEDs ◄─────────────►│ event-driven  │──────────────┐                  ┌───────────────┐
                       └───────────────┘              └─────────────────►│ storage  P2   │──► SD card
                               ▲                                         │ owns SD + UART│──► UART console
                               │ cfg snapshot (mutex, hold < 10 µs)      └───────────────┘
                       ┌───────┴───────┐
                       │ supervisor P7 │── feeds hardware watchdog only if every task checked in
                       └───────────────┘` },

      `## Watchdog supervision of tasks

A hardware [[Watchdog]] resets the MCU if it is not fed in time. Feeding it from a timer ISR or the idle task proves only that interrupts or idle still run — a deadlocked application would be kept alive forever. Supervision should prove that **every important task is making progress**:

- each supervised task periodically reports in ("checks in") — only from its main loop, after doing real work;
- a supervisor checks that every task has reported within its own allowed interval, and only then feeds the hardware watchdog;
- if any task is late, the supervisor stops feeding (and, if possible, records which task) so the system resets into a known state.

ESP-IDF provides this as the **task watchdog (TWDT)**: a task subscribes with \`esp_task_wdt_add(NULL)\` and must call \`esp_task_wdt_reset()\` within the configured timeout; the idle tasks are subscribed by default.`,
      { t: 'widget', name: 'timer-lab', props: { mode: 'watchdog' }, title: 'Feed, miss, reset',
        caption: 'Choose a timeout and feed interval. Then imagine the feed coming from a task that has deadlocked: the timeline shows what the watchdog does about it.' },
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'A supervised task on ESP-IDF using the task watchdog.',
        code: C`#include "esp_task_wdt.h"

static void process_task(void *arg)
{
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));          /* supervise the calling task */
    sample_t s;
    for (;;) {
        if (xQueueReceive(s_samples, &s, pdMS_TO_TICKS(1000)) == pdTRUE) {
            process(&s);
        }
        esp_task_wdt_reset();                         /* "I completed a loop" */
    }
}`,
        explain: [
          { lines: '5', md: 'Registers this task with the task watchdog. From now on, if it does not check in within the timeout, the TWDT reports the task by name (and can be configured to panic and reset).' },
          { lines: '8', md: 'The receive has a finite timeout shorter than the watchdog period, so an idle but healthy task still loops and checks in. With `portMAX_DELAY` a healthy task with no input would be reported as dead.' },
          { lines: '11', md: 'Exactly one check-in, at the bottom of the loop. If the task deadlocks on a mutex inside `process()`, or spins forever, it never reaches this line.' },
        ] },
      { t: 'callout', kind: 'mistake', title: 'Feeding the watchdog to make the message go away',
        md: `Sprinkling \`esp_task_wdt_reset()\` (or a hardware watchdog feed) inside long loops, in a timer callback, or in an ISR silences the symptom and disables the protection. A watchdog feed should be reachable only when the supervised work has really completed a cycle. If a legitimate operation takes longer than the timeout, break it into steps that each make progress, or change the timeout for a stated reason.` },
      { t: 'callout', kind: 'security', title: 'Why this matters for secure firmware',
        md: `Concurrency design is also a security property. A check-then-act race between "verify" and "use" lets an attacker change data in between (a time-of-check-to-time-of-use flaw). A blocking send on an attacker-fed queue is a denial of service that can starve the task enforcing a timeout or a lockout. An unbounded queue or allocation driven by external input exhausts memory. In designs for competitions such as MITRE's eCTF, keep the security-relevant state owned by one task, make validation and use a single step on a private copy, and bound every queue, timeout and retry.` },

      { t: 'exercise',
        prompt: 'An acquisition ISR produces 2000 samples/s continuously. A processing task handles samples in batches and is fast on average, but once per second it is held off for up to 15 ms by a higher-priority radio task. Between those stalls it can process 5000 samples/s. What is the minimum queue length (in samples) so that nothing is dropped during a stall?',
        hints: ['During the stall the consumer processes nothing.', 'Items produced during the stall = rate × stall time.'],
        answer: { type: 'number', value: 30, tol: 0, unit: 'samples' },
        solution: 'During a 15 ms stall the ISR produces 2000 × 0.015 = **30 samples** while none are consumed. Afterwards the backlog drains at 5000 − 2000 = 3000/s, i.e. in 10 ms, long before the next stall. Use 48 or 64 for margin. A stream buffer or a queue of small blocks would be a better carrier than one queue item per sample at this rate.' },

      { t: 'exercise',
        prompt: 'Redesign the opening problem. Seven tasks call `uart_write` directly (guarded by a mutex that is sometimes held for 30 ms while a long line drains), and a control task at priority 8 occasionally logs. Describe the new structure, the message type, the full-queue policy, and what you have gained.',
        hints: [
          'Who should be the only code that touches the UART?',
          'Should a priority-8 control task ever wait for a UART?',
          'What goes in the queue: a pointer to the caller\'s buffer, or a copy?',
        ],
        solution: '**Structure:** one low-priority *log task* owns the UART. Other tasks call `log_post()`, which formats into a small fixed-size message (`typedef struct { uint8_t len; char text[63]; } log_msg_t;`) and sends it **by value** to a queue of, say, 16 messages with **timeout 0**. The log task blocks on the queue and writes each message to the UART at its own pace.\n\n**Full policy:** drop the newest and increment a `log_dropped` counter, which the log task reports when it catches up ("[12 messages lost]"). Logging must never be allowed to block the control task.\n\n**Gained:** the UART mutex is gone (no inversion, no deadlock through logging while holding other locks); lines can never interleave; the priority-8 task spends a bounded few microseconds copying a message instead of up to 30 ms waiting; and the slow drain happens at low priority in leftover CPU time. **Cost:** 16 × 64 bytes of queue storage plus one stack, and log output can lag or be lost under load — an explicit, counted trade.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'Review this design for a battery-powered sensor node and list every concern, most serious first: a 1 kHz sampling task (priority 3); a filter task (priority 5) fed by a queue of length 4 with `portMAX_DELAY` sends; a radio task (priority 7) that takes a "data" mutex, transmits for up to 50 ms, then gives it; the filter task writes results into the same "data" struct under that mutex; the hardware watchdog is fed from a 100 ms software timer callback.',
        hints: [
          'Check priorities against periods.',
          'Find every place where something with a deadline can be made to wait for something slow.',
          'What does the watchdog actually prove?',
        ],
        solution: '1. **The watchdog proves nothing about the application.** It is fed from a timer callback, which keeps running if all three tasks deadlock. Supervise the tasks and feed only when all have checked in.\n2. **The radio holds the data mutex for 50 ms of transmission.** The filter task blocks for up to 50 ms; with a queue of only 4 and a blocking send, the 1 kHz sampler stalls 4 ms later: up to ~46 samples are never taken. Fix: the radio takes a snapshot under the mutex (microseconds) and transmits from its private copy — or the filter sends results to the radio through a queue and the shared struct disappears.\n3. **Priorities are inverted relative to rates.** The 1 kHz sampler has the *lowest* priority of the three; any filter or radio CPU burst delays sampling and adds jitter. Sampling should be highest (or done in a timer ISR), with the radio\'s slow work lowest.\n4. **`portMAX_DELAY` on the sampler\'s send** lets downstream stalls stop the acquisition silently. Use timeout 0 and count drops, and size the queue for the worst stall you decide to tolerate.\n5. **1 kHz task period** needs a tick of at least 1 kHz or a hardware timer; with a 100 Hz tick it cannot be scheduled by `vTaskDelayUntil` at all.\n6. Battery: a 1 kHz tick and wake-up may dominate the power budget; consider timer/DMA-driven acquisition with batch hand-off.' },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel — queue management and resource management chapters (gatekeeper tasks)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'ESP-IDF: Watchdogs — documentation source (interrupt watchdog and task watchdog)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/system/wdts.rst' },
      ] },
    ],
    quiz: [
      { q: 'Why does giving a peripheral a single owner task remove the need for a mutex on it?', kind: 'arch',
        choices: [
          { t: 'Only one execution context ever touches it, and requests are serialised by the owner\'s queue.', ok: true, why: 'With no second accessor there is nothing to exclude; ordering comes from the queue.' },
          { t: 'Owner tasks run with interrupts disabled.', why: 'They run as normal tasks. Exclusivity comes from the structure, not from masking anything.' },
          { t: 'Queues contain a hidden mutex that protects the peripheral.', why: 'A queue protects its own storage. The peripheral is safe because only one task uses it.' },
        ] },
      { q: 'A display should always show the most recent temperature; stale values are useless. Which hand-off fits?', kind: 'arch',
        choices: [
          { t: 'A length-1 queue written with `xQueueOverwrite`.', ok: true, why: 'The newest value replaces any unread one, so the reader always gets the latest and the writer never blocks.' },
          { t: 'A long queue with a blocking send so nothing is lost.', why: 'Keeping every value makes the display lag further behind whenever it is slower than the producer.' },
          { t: 'A counting semaphore.', why: 'A semaphore carries a count, not a value. The display needs the data itself.' },
        ] },
      { q: 'A hardware watchdog is fed from the idle task hook. What failure does this *fail* to detect?', kind: 'concept',
        choices: [
          { t: 'Two application tasks deadlocked on each other\'s mutexes.', ok: true, why: 'Deadlocked tasks are blocked and use no CPU, so idle runs more than ever and keeps feeding.' },
          { t: 'A high-priority task stuck in an infinite loop.', why: 'That one is caught: a spinning task starves idle, so the feeds stop.' },
          { t: 'The CPU clock stopping.', why: 'If nothing executes, nothing feeds, and an independently clocked watchdog expires.' },
        ] },
      { q: 'In a pipeline ISR → queue → task, the queue is full when the ISR has a new item. What can the ISR do?', kind: 'code',
        choices: [
          { t: 'Fail the send immediately and apply a policy: count the drop, or overwrite/coalesce.', ok: true, why: 'An ISR cannot wait. `xQueueSendFromISR` returns an error on a full queue and the handler must decide what loss is acceptable.' },
          { t: 'Block until the task makes room.', why: 'Interrupt handlers cannot block; there is no task context to suspend.' },
          { t: 'Call `xQueueReset` to empty the queue.', why: 'That discards everything pending, including data the consumer was about to use, and is not a considered overflow policy.' },
        ] },
      { q: 'Which is a sign that shared memory with a lock is a reasonable choice instead of a queue?', kind: 'arch',
        choices: [
          { t: 'A small configuration struct, read by many tasks, changed rarely, copied out under a lock held for microseconds.', ok: true, why: 'Many readers of slowly changing state would be awkward to serve by messages, and a short snapshot lock has negligible blocking.' },
          { t: 'A stream of sensor samples from one producer to one consumer.', why: 'A one-way data stream is exactly what a queue or stream buffer models, with buffering for free.' },
          { t: 'Any data touched by an ISR.', why: 'An ISR cannot take a mutex at all. ISR hand-offs use FromISR queue or notification calls or a short critical section.' },
        ] },
      { q: 'A firmware accepts commands from a network into an unbounded linked list that a worker drains. What is the concern?', kind: 'security',
        choices: [
          { t: 'An external party can grow the list until memory is exhausted; every externally fed buffer needs a bound and a full-policy.', ok: true, why: 'Unbounded input-driven allocation is a denial-of-service path. A fixed-length queue with a defined overflow behaviour limits the damage.' },
          { t: 'Linked lists are slower than arrays.', why: 'Speed is secondary. The issue is that nothing limits how much memory an outside sender can make the device commit.' },
          { t: 'The worker should run at the highest priority to keep the list short.', why: 'Raising priority lets attacker-controlled work starve everything else, which makes the problem worse.' },
        ] },
    ],
  },
];

export default { lessons };
