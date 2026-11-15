// Real-time systems, part A: bare-metal structures, scheduling models, FreeRTOS architecture, task scheduling.
const C = String.raw;

const lessons = [
  // ───────────────────────────────────────────────────────────────── 1
  {
    id: 'rtos-baremetal',
    title: 'Bare-metal structures: superloop, flags and time-triggered loops',
    minutes: 45,
    summary: 'What you can build with no operating system at all, how to reason about its timing, and the point where it stops being the right answer.',
    skills: ['rtos-sk-superloop'],
    blocks: [
      `## The problem

You are building a thermostat. It must read a temperature sensor every 100 ms, redraw a small display (the redraw takes about 40 ms because the display is on a slow bus), react to a button within 20 ms so that it feels instant, and answer a command on the serial port.

The first version is one loop that does each job in turn. It works on the bench. Then you add the display, and button presses start to go missing. Nothing in the button code changed. Why did adding a display break a button?

The answer is the central idea of this whole section: **in a system with one processor, every job's timing depends on every other job that can run instead of it.** An operating system does not remove that fact. It gives you tools to control it. Before reaching for those tools you need to know what the simplest structures can and cannot do, because very often the simplest structure is the correct engineering choice.`,

      `## The superloop

A [[Superloop]] is \`main()\` with an infinite loop that calls each job in a fixed order.`,
      { t: 'code', lang: 'c', status: 'pseudo', caption: 'A superloop. No interrupts, no OS.',
        code: C`int main(void)
{
    hardware_init();
    for (;;) {
        read_sensor();      /* 2 ms  */
        update_display();   /* 40 ms */
        poll_button();      /* 0.1 ms */
        service_uart();     /* 0.5 ms */
    }
}`,
        explain: [
          { lines: '4', md: 'The processor executes these four calls in this order, forever. The program counter never leaves this chain except to enter the functions.' },
          { lines: '6', md: 'While the processor is inside `update_display()` it is doing nothing else. The button pin is not being looked at for 40 ms.' },
          { lines: '7', md: '`poll_button()` reads the GPIO input register once. If the button was pressed and released while another function was running, this read sees nothing.' },
        ] },
      `The timing analysis of a superloop is one line. Each job is serviced once per loop pass, so the worst-case wait for any job is one full pass:

**worst-case latency of any job = the sum of the worst-case execution times of all the other jobs (plus its own).**

For the loop above that is 2 + 40 + 0.1 + 0.5 = 42.6 ms. The 20 ms button requirement fails, and a button press shorter than about 43 ms can be missed entirely. That is why adding the display broke the button.

What the superloop gives you in exchange is large:

- **No shared-data problems.** Only one thing runs at a time and nothing interrupts it, so no job ever sees another job's data half-updated.
- **One stack.** You size it once.
- **Fully deterministic order.** The same inputs produce the same execution path, which makes testing and certification far easier.
- **No kernel.** No RAM for task stacks and control blocks, no code you did not write.`,

      `## Foreground/background: interrupts plus flags

The usual first improvement is to let hardware interrupt the loop. The interrupt service routine ([[ISR]]) is the **foreground**; the loop is the **background**. The rule that keeps this manageable is: *the ISR does the minimum that must happen now, records that it happened, and returns.* The loop does the real work later.`,
      { t: 'code', lang: 'c', status: 'pseudo', caption: 'Foreground/background. The ISR records the event; the loop handles it.',
        code: C`static volatile bool button_event;   /* written by ISR, read by loop */

void button_isr(void)               /* runs when the pin sees a falling edge */
{
    clear_pin_interrupt();          /* acknowledge in the peripheral        */
    button_event = true;            /* remember it; do nothing slow here    */
}

int main(void)
{
    hardware_init();
    for (;;) {
        if (button_event) {
            button_event = false;
            handle_button();
        }
        read_sensor();
        update_display();
        service_uart();
    }
}`,
        explain: [
          { lines: '1', md: '`volatile` tells the compiler that this variable can change outside the visible flow of `main()`. Without it the compiler may read the flag once into a register and never look at RAM again, so the loop would never see the ISR\'s write.' },
          { lines: '5', md: 'The peripheral holds the interrupt request line active until its status bit is cleared. Forget this and the ISR re-enters the moment it returns, and the background loop never runs again.' },
          { lines: '13-15', md: 'The edge is now **latched** in RAM: a 1 ms press is no longer lost. But the *response* still waits for the loop to come round, so the response latency is still up to one loop pass.' },
        ] },
      `Notice exactly what improved and what did not. The event can no longer be **missed**, because the hardware catches the edge whatever the loop is doing. But the **latency** from press to \`handle_button()\` running is still bounded by the loop pass time. If the response itself is urgent (for example cutting power to a motor), the urgent part has to go into the ISR.

A single flag also only records *that* something happened, not *how many times*. Two presses during one long display update look like one. If the count matters, the ISR increments a counter or pushes into a ring buffer instead — and at that point the ISR and the loop are sharing multi-step data, which is where race conditions begin. A later lesson is devoted to that.`,

      { t: 'callout', kind: 'mistake', title: 'Doing the work in the ISR',
        md: `It is tempting to call \`update_display()\` or \`printf()\` straight from the ISR "because then it happens immediately". While an ISR runs, interrupts of the same or lower priority are held off. A 40 ms ISR adds 40 ms of latency to every other interrupt in the system, and library functions such as \`printf\` are usually not safe to enter from an interrupt while the main loop is in the middle of the same function. Keep ISRs short: acknowledge, capture, flag, return.` },

      `## Time-triggered cooperative loops

The third bare-metal structure removes the "as fast as the loop happens to go" behaviour. A hardware timer produces a regular [[Tick]] (say every 1 ms). A table lists each job with its period. On every tick the dispatcher runs the jobs that are due. Each job runs to completion and returns — that is what **cooperative** means here.`,
      { t: 'code', lang: 'c', status: 'pseudo', caption: 'A time-triggered cooperative dispatcher.',
        code: C`typedef struct {
    void   (*run)(void);
    uint32_t period_ms;
    uint32_t next_due;
} job_t;

static job_t jobs[] = {
    { poll_button,    10,  0 },
    { read_sensor,   100,  1 },   /* offset by 1 ms so jobs do not all land on one tick */
    { update_display, 250, 2 },
};

static volatile uint32_t now_ms;
void timer_isr(void) { clear_timer_flag(); now_ms++; }

int main(void)
{
    hardware_init();
    for (;;) {
        uint32_t t = now_ms;
        for (unsigned i = 0; i < sizeof jobs / sizeof jobs[0]; i++) {
            if ((int32_t)(t - jobs[i].next_due) >= 0) {
                jobs[i].next_due += jobs[i].period_ms;
                jobs[i].run();
            }
        }
        wait_for_interrupt();   /* sleep until the next tick: saves power */
    }
}`,
        explain: [
          { lines: '14', md: 'The only interrupt in the system. It increments a counter in RAM. On a 32-bit MCU a single aligned 32-bit read of `now_ms` is one load instruction, so the main loop cannot see it half-updated. On an 8- or 16-bit MCU it could — that is a torn read, covered later.' },
          { lines: '22', md: 'Subtracting first and then comparing as a signed number makes the test correct across the wraparound of the 32-bit counter (after about 49.7 days at 1 ms).' },
          { lines: '23', md: 'Adding the period to the *previous due time*, not to "now", keeps the average rate exact even when a job starts late. This is the same idea as `vTaskDelayUntil` in FreeRTOS.' },
          { lines: '27', md: 'On a Cortex-M this is the `WFI` instruction. The core stops clocking until an interrupt arrives. An RTOS idle task does the same thing.' },
        ] },
      `The timing rule for this structure: nothing is preempted, so a job that becomes due has to wait for whatever is already running **and** for every other due job the dispatcher reaches first. In the worst case that is the sum of the execution times of all the other jobs. So at the very least **every job must be shorter than the tightest deadline in the table**, and the jobs that can fall due together must fit inside it as a group. The 40 ms display update still blocks the 10 ms button poll. The cooperative fix is to split the long job into slices — draw one line of the display per call and keep a state variable to remember where you were. That works, but notice what it costs: the display code is now a state machine shaped by the needs of the *button*. Unrelated modules have become coupled through timing.`,

      { t: 'callout', kind: 'decision', title: 'When bare metal is the right answer',
        md: `Choose a superloop or time-triggered loop when **all** of these hold: a handful of jobs; every job is short or easily sliced; the deadlines are loose relative to the loop time or are met inside ISRs; RAM is small (each RTOS task needs its own stack); and you value being able to list every possible execution order. Many safety-critical and many security-critical firmwares are built this way on purpose.

Move to a preemptive RTOS when: a job must block waiting for something (a network stack, a file system, a slow bus) and slicing it by hand would turn it inside out; unrelated modules keep needing edits to meet each other's deadlines; or several deadlines differ by orders of magnitude. The RTOS does not make the system faster. It lets urgent work interrupt non-urgent work without the non-urgent code being written around it — and it charges you with concurrency bugs for the privilege.` },

      { t: 'predict',
        q: 'A superloop runs `A()` (1 ms), `B()` (8 ms), `C()` (1 ms) in that order. A UART receives a byte every 5 ms into a one-byte hardware register, and `C()` is the function that reads it. Nothing uses interrupts. What happens?',
        choices: [
          { t: 'All bytes are received; the loop is fast enough on average.', why: 'The average does not matter here. The receive register holds one byte, and a second byte arrives before the loop gets back to the function that empties it.' },
          { t: 'About every second byte is overwritten before it is read.', ok: true, why: 'One pass takes 10 ms, so `C()` reads the register every 10 ms while a new byte lands every 5 ms. The hardware overwrites the unread byte (and sets an overrun flag if it has one).' },
          { t: 'The UART waits for `C()` because the register is still full.', why: 'A plain UART has no flow control unless you wire and enable RTS/CTS. The sender keeps sending whether or not the receiver has read the last byte.' },
        ],
        reveal: 'Worst-case service interval is the whole loop pass, 10 ms. Anything that can arrive more often than that needs either a faster loop, hardware buffering (a FIFO or DMA), or an interrupt that moves each byte into a software buffer as it arrives.' },

      { t: 'widget', name: 'timer-lab', props: { mode: 'timer' }, title: 'Where the tick comes from',
        caption: 'Set the prescaler and compare value to get a 1 ms period from the input clock. This is the timer a time-triggered loop and an RTOS both build on.' },

      { t: 'exercise',
        prompt: 'A time-triggered cooperative system has three jobs with worst-case execution times: `poll_button` 0.2 ms (every 10 ms), `read_sensor` 3 ms (every 100 ms), `log_to_flash` 12 ms (every 1000 ms). Nothing is preempted. What is the worst-case delay, in ms, between `poll_button` becoming due and it starting to run? Assume the worst case is that both other jobs became due just before it and run first.',
        hints: [
          'Once a job has started, can the dispatcher stop it to run the button poll? What does that make the poll wait for?',
          'Is one long job the worst that can be in front of it, or can more than one be due at the same moment?',
          'Both other jobs run to completion first: add their two execution times.',
        ],
        answer: { type: 'number', value: 15, tol: 0.1, unit: 'ms' },
        solution: 'Worst case, `read_sensor` (3 ms) and `log_to_flash` (12 ms) both run before it: **15 ms**. That is longer than the button\'s 10 ms period, so once a second a poll runs a period and a half late and the next one follows almost at once (the dispatcher catches up because it adds the period to the previous due time). For 15 ms nobody looked at the pin: a press shorter than that can be missed, and any debounce logic that assumes samples 10 ms apart is fed two samples a fraction of a millisecond apart. Fixes without an RTOS: put the button on an interrupt, slice the flash write into pieces shorter than a few ms, or give the jobs offsets so the two long ones never land on the same tick (which reduces the worst case to 12 ms — still too long, so the slicing is needed anyway).' },

      { t: 'widget', name: 'c-lab', title: 'Bench-MCU: an ISR sets a flag, the loop consumes it',
        props: {
          title: 'Foreground/background on Bench-MCU',
          prompt: `Bench-MCU's TIMER0 counts down once per simulated tick and can raise \`IRQ_TIMER\`. Complete the program so that:

- \`timer_isr\` acknowledges the timer (write 1 to \`TIM_STATUS\`) and sets \`tick_flag\`. It must do nothing else.
- the main loop, each time it sees the flag, clears it, toggles GPIO pin 0 with \`GPIO_TOGGLE\`, and counts one tick.
- after **5** ticks it stops the timer and prints \`ticks=5\`.

The loop also counts how many times it went round (\`spins\`). The timer period is 50 simulated ticks, so a loop that is really paced by the timer goes round many times with nothing to do between two events. The last line of output reports whether that happened; a loop that toggles without waiting for the flag, or an ISR that never acknowledges the timer, finishes far too soon and prints \`paced=no\`.

The interrupt model here is preemption between statements, not cycle-accurate hardware.`,
          starter: C`#include <stdint.h>
#include <stdio.h>

volatile uint32_t tick_flag = 0;

void timer_isr(void) {
    /* TODO: acknowledge the timer, then record the event */
}

int main(void) {
    uint32_t ticks = 0;
    uint32_t spins = 0;               /* passes of the loop, busy or not */
    GPIO_DIR |= 1u << 0;              /* pin 0 is an output */
    irq_attach(IRQ_TIMER, timer_isr);
    TIM_LOAD = 50;                    /* one timer event every 50 simulated ticks */
    TIM_CTRL = 7;                     /* ENABLE | AUTO_RELOAD | IRQ_EN */
    irq_enable();

    while (ticks < 5) {
        spins++;
        /* TODO: if the flag is set, clear it, toggle pin 0, count a tick */
    }

    TIM_CTRL = 0;
    printf("ticks=%u\n", ticks);
    printf("paced=%s\n", spins > 30 ? "yes" : "no");
    return 0;
}
`,
          solution: C`#include <stdint.h>
#include <stdio.h>

volatile uint32_t tick_flag = 0;

void timer_isr(void) {
    TIM_STATUS = 1;                   /* write 1 to clear EXPIRED */
    tick_flag = 1;
}

int main(void) {
    uint32_t ticks = 0;
    uint32_t spins = 0;               /* passes of the loop, busy or not */
    GPIO_DIR |= 1u << 0;              /* pin 0 is an output */
    irq_attach(IRQ_TIMER, timer_isr);
    TIM_LOAD = 50;                    /* one timer event every 50 simulated ticks */
    TIM_CTRL = 7;                     /* ENABLE | AUTO_RELOAD | IRQ_EN */
    irq_enable();

    while (ticks < 5) {
        spins++;
        if (tick_flag) {
            tick_flag = 0;
            GPIO_TOGGLE = 1u << 0;
            ticks++;
        }
    }

    TIM_CTRL = 0;
    printf("ticks=%u\n", ticks);
    printf("paced=%s\n", spins > 30 ? "yes" : "no");
    return 0;
}
`,
          tests: [
            { name: 'five timer events counted, each paced by the timer, pin 0 toggled five times', stdout: 'ticks=5\npaced=yes\n', regs: { GPIO_OUT: 1 } },
          ],
          hints: [
            'Two questions. What keeps the timer interrupt pending after the handler has run? And how does the loop find out that the handler ran at all?',
            'The ISR needs exactly two statements: `TIM_STATUS` is write-1-to-clear, and the flag is an ordinary assignment. If `EXPIRED` is not cleared the interrupt stays pending, the ISR runs again as soon as it returns, and you get `paced=no`.',
            'In the loop: `if (tick_flag) { tick_flag = 0; GPIO_TOGGLE = 1u << 0; ticks++; }`. Five toggles from 0 leave the pin at 1.',
          ],
          explain: 'The ISR is two statements long and the loop decides when the work happens. Clearing the flag *before* doing the work matters: if another tick arrives during the work, the flag is set again and the next pass sees it. Clear it after the work and that tick would be erased.',
        } },

      `## A harder case: where does it break?

You inherit a bare-metal product: a time-triggered loop with a 1 ms tick and six jobs, all under 0.5 ms. Marketing wants a feature that fetches a configuration file over a serial modem. The modem library you are given has one call, \`modem_get_file()\`, which blocks until the transfer completes — typically 2 s, up to 30 s on a bad line.`,
      { t: 'exercise',
        prompt: 'List what goes wrong if you call `modem_get_file()` as a seventh job, and give two different ways to make the system work. Which one changes the least existing code?',
        hints: [
          'What is the rule for the longest job in a cooperative system?',
          'One way keeps bare metal and changes the modem code. The other keeps the modem code and changes the structure.',
        ],
        solution: `Called as a job, it holds the processor for up to 30 s. Every other job stops for that time: the button is dead, the sensor is not sampled, and if a hardware watchdog is fed from the loop, the device resets mid-transfer.

**Option 1 — stay bare-metal.** Rewrite the transfer as a non-blocking state machine that does a small step per call (send request → wait for bytes → store chunk → …), with received bytes buffered by a UART ISR. This needs the library's source or a non-blocking API, and it is real work to get right.

**Option 2 — add a preemptive kernel.** Run the modem call in its own low-priority task with its own stack. It can block for 30 s; the scheduler runs the other jobs whenever they are due. The existing six jobs move into one periodic high-priority task almost unchanged.

Option 2 changes the least existing code, and is the classic reason projects adopt an RTOS: a blocking library that cannot be sliced. The price is that the modem task and the old jobs can now interleave at any instruction, so every variable they share must be protected.` },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel (book source, FreeRTOS on GitHub)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book', note: 'The opening chapters compare super-loop designs with a multitasking kernel.' },
      ] },
    ],
    quiz: [
      { q: 'A superloop calls four functions with worst-case times 1 ms, 6 ms, 2 ms and 15 ms. No interrupts are used. What is the longest time any one input can go unexamined?', kind: 'concept',
        choices: [
          { t: 'About 24 ms', ok: true, why: 'Each function gets the processor once per pass, and a pass takes the sum of all four worst cases.' },
          { t: '15 ms, the longest single function', why: 'The longest function is the largest single contribution, but the others also run before the loop comes back to the same input.' },
          { t: '6 ms, the average', why: 'Timing guarantees are about the worst case. An average says nothing about the pass in which the slow path is taken.' },
        ] },
      { q: 'You move a button from polling to an interrupt that only sets a flag; the superloop checks the flag. Which statement is true?', kind: 'concept',
        choices: [
          { t: 'Short presses are no longer missed, but the response still waits up to one loop pass.', ok: true, why: 'The edge is latched by hardware and recorded in RAM immediately; the handler runs when the loop next reaches the flag test.' },
          { t: 'The response is now immediate, because the interrupt runs the button handling the moment the pin changes.', why: 'Only the ISR runs promptly. The code that actually responds is still in the loop and still waits its turn.' },
          { t: 'Nothing changes; a flag is just polling with extra steps.', why: 'There is a real difference: a pin level can come and go between two polls, while a latched flag stays set until the loop clears it.' },
        ] },
      { q: 'Why must `button_event` be declared `volatile` here?', code: C`static bool button_event;
void button_isr(void) { button_event = true; }
int main(void) {
    for (;;) {
        while (!button_event) { }
        button_event = false;
        handle_button();
    }
}`, kind: 'code',
        choices: [
          { t: 'Without it the compiler may load the flag once and loop forever on the cached value.', ok: true, why: 'Inside the inner loop nothing visible to the compiler writes the variable, so an optimiser is entitled to hoist the read. `volatile` forces a real memory read every time.' },
          { t: 'Without it the variable is private to `main()`, so the compiler discards the write made in the ISR.', why: '`volatile` places no restriction on who may write. It changes how the compiler treats reads and writes, not access rights.' },
          { t: 'It joins the test of the flag and the clear that follows into one atomic step, so no press is lost between them.', why: '`volatile` does not make any sequence of operations indivisible. An interrupt can still arrive between the test and the clear.' },
        ] },
      { q: 'In a time-triggered cooperative scheduler, why is the next due time computed as `next_due += period` rather than `next_due = now + period`?', kind: 'code',
        choices: [
          { t: 'So that a late start does not push every later activation back; the average rate stays exact.', ok: true, why: 'Anchoring to the previous due time means lateness is not accumulated, so the average rate stays exact. Anchoring to "now" adds each delay permanently.' },
          { t: 'Because `now` is written by the timer ISR and cannot be read safely from the main loop.', why: 'On a 32-bit MCU an aligned 32-bit read is a single load. The reason is about drift, not about access.' },
          { t: 'It makes the job run sooner than its period when the system is idle.', why: 'The job still runs once per period. What changes is whether errors accumulate from one activation to the next.' },
        ] },
      { q: 'Which requirement is the strongest sign that a bare-metal cooperative design should be replaced by a preemptive RTOS?', kind: 'arch',
        choices: [
          { t: 'A third-party stack that blocks for seconds inside one call must coexist with millisecond deadlines.', ok: true, why: 'A blocking call cannot be sliced without rewriting it, and while it blocks nothing else in a cooperative system runs. Giving it its own preemptible task is the direct fix.' },
          { t: 'The product must blink an LED at 1 Hz while sampling a sensor every 100 ms, so two things happen "at once".', why: 'Two short periodic jobs are exactly what a time-triggered loop handles well, with less RAM and fewer failure modes.' },
          { t: 'The code base has grown past a few thousand lines, split across a dozen modules by different authors.', why: 'Size alone does not create a timing problem. Many large firmwares are cooperative; what matters is whether jobs can be kept short.' },
          { t: 'The MCU has plenty of spare flash, so a kernel would cost nothing that is needed elsewhere.', why: 'Spare flash makes a kernel affordable, but affordability is not a reason. The reason has to come from the timing and blocking behaviour of the jobs.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 2
  {
    id: 'rtos-sched-models',
    title: 'Cooperative versus preemptive scheduling',
    minutes: 35,
    summary: 'Who decides when a task stops running — the task or the kernel — and what each answer costs.',
    skills: ['rtos-sk-sched-predict'],
    blocks: [
      `## The problem

Two engineers argue about the same product. One says: "With a cooperative scheduler I never need a mutex, so I never have a deadlock." The other says: "With a preemptive scheduler my motor-control task always runs within 50 µs of its timer, whatever the logging code is doing." Both are right. You have to pick one for a motor controller that also logs to an SD card whose writes sometimes take 200 ms. Which, and what will it cost you?`,

      `## Tasks and the scheduler

A [[Task]] is a function that normally never returns, with **its own stack**. Because it has its own stack, the processor can stop executing it in the middle of any function, run something else, and later carry on exactly where it left off — all the local variables and return addresses are still on that task's stack.

The [[Scheduler]] is the kernel code that decides which task gets the processor. The two families differ in one thing only: **when the scheduler is allowed to make that decision.**

| | Cooperative | Preemptive |
|---|---|---|
| A task stops running when… | it calls a yield or blocking function | that, **or** an interrupt makes a higher-priority task ready |
| Latency for an urgent task | up to the longest stretch any task runs without yielding | interrupt latency + context switch time |
| Shared data between tasks | safe between yield points | unsafe at every instruction unless protected |
| Typical bugs | one task hogs the CPU; everything stalls | races, deadlocks, priority inversion |
| Stack per task | yes | yes |

A cooperative RTOS differs from the bare-metal dispatcher of the previous lesson in one useful way: because each task has its own stack, it can yield from *inside* nested function calls and resume there. The long modem transfer can call \`yield()\` in its inner loop without being rewritten as a state machine.`,

      `## What preemption physically is

Preemption is not magic and it is not a second processor. It is this sequence:

1. An interrupt fires (the tick timer, or a peripheral).
2. The ISR — or a kernel call made from it — moves some task from "waiting" to "ready".
3. Before returning from the interrupt, the kernel compares that task's priority with the running one.
4. If it is higher, the kernel saves the running task's registers on its stack, loads the other task's registers from *its* stack, and returns from the interrupt **into the other task**.

The interrupted task has no idea this happened. It simply resumes later with every register as it was. That is why preemption can happen between any two machine instructions, and why a C statement such as \`count++\` (load, add, store) can be split in the middle.`,
      { t: 'ascii', caption: 'The same three tasks under each model. H is urgent and becomes ready at t=3. L is a long computation.',
        text: `Cooperative (L yields only at t=9)
t:  0 1 2 3 4 5 6 7 8 9 10 11
L:  # # # # # # # # # .  .  .
H:  . . . r r r r r r #  #  .      r = ready but waiting: 6 ticks of latency
                      ^ L finally yields

Preemptive (H has higher priority)
t:  0 1 2 3 4 5 6 7 8 9 10 11
L:  # # # . . # # # # #  #  .
H:  . . . # # . . . . .  .  .      runs the moment it is ready
          ^ interrupt makes H ready; kernel switches before returning` },

      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'cooperative' }, title: 'Cooperative: who is holding the processor?',
        caption: 'Change how many ticks Compute runs between yields and watch UI\'s start time move with it.' },
      { t: 'ascii', caption: 'What the simulator shows with its starting values: UI (priority 3) needs 1 tick every 6 and must finish within 6; Compute (priority 1) runs 8 ticks, yields, and repeats. One column is one tick.',
        text: `tick:     0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
runs:     U  C  C  C  C  C  C  C  C  U  C  C  C  C  C  C  C  C  U  U
UI due:   ^                 ^                 ^                 ^

release at  6: Compute is inside the chunk it started at tick 1; it yields after tick 8.
               UI runs in tick 9 and is done at 10: response 4 ticks. In time.
release at 12: Compute started a new chunk at tick 10 and yields after tick 17.
               UI runs in tick 18 and is done at 19: response 7 ticks. Deadline (18) missed.
release at 18: UI is already waiting when Compute yields, so it runs again in tick 19.` },
      `Read the trace for the rule, not the numbers: UI's priority decided that it ran **next** each time, but only Compute decided **when** "next" was. The response time changes from release to release (1, 4, 7, 2 ticks) because it depends on where in its chunk Compute happens to be. The worst case is one whole chunk plus UI's own tick.`,
      { t: 'predict',
        q: 'Under a **preemptive** fixed-priority scheduler: task H (priority 3) blocks waiting for a timer that expires at t = 4 ms. Task M (priority 2) becomes ready at t = 1 ms and needs 5 ms of CPU. Task L (priority 1) is running from t = 0 and needs 10 ms. Which task is running at t = 5 ms, and how much CPU has M received by then?',
        choices: [
          { t: 'H is running; M has had 3 ms.', ok: true, why: 'L runs 0–1. M preempts at 1 and runs 1–4. At 4 the timer readies H, which preempts M. At t = 5 H is running (unless it has already finished), and M has had 3 of its 5 ms.' },
          { t: 'M is running; it has had 4 ms because H must wait for M to finish.', why: 'In a preemptive scheduler a ready task never waits for a lower-priority one to finish. The switch happens in the interrupt that made the higher task ready.' },
          { t: 'L is running; tasks take turns.', why: 'Taking turns only applies between tasks of the same priority. Lower priorities run only when nothing above them is ready.' },
        ],
        reveal: 'The rule for fixed-priority preemptive scheduling is short: **at every instant, the highest-priority ready task is the one running.** To predict a schedule, list the instants at which a task becomes ready or blocks, and re-apply the rule at each one.' },
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'preemptive' }, title: 'Preemptive: apply the rule to a periodic task set',
        caption: 'A different task set from the question above: three periodic tasks, all released at tick 0. Before you run it, apply the same rule tick by tick. With the starting priorities Logger (6 ticks) runs ticks 0–5, Control ticks 6–8, and Sensor first runs in tick 9, four ticks after its deadline at tick 5.' },

      `## What it costs

**RAM.** Every task needs a stack big enough for its deepest call chain plus, on most ports, a saved copy of the CPU registers. Ten tasks of 2 KB each is 20 KB — most of the RAM of a small Cortex-M0+.

**Shared state.** In a cooperative system, code between two yield points is effectively one indivisible step. In a preemptive system, another task can run between any two instructions. Every variable touched by more than one task (or by a task and an ISR) now needs a deliberate protection strategy.

**Analysis.** A cooperative system's worst case is found by reading for the longest run between yields. A preemptive system needs a schedulability argument (a later lesson) and has failure modes that depend on rare interleavings and may not appear in testing.`,
      { t: 'callout', kind: 'mistake', title: '"Cooperative means I never need to think about concurrency"',
        md: `Two things break that belief. First, **interrupts still preempt everything**, so data shared between an ISR and a task has the same hazards as before. Second, "safe between yield points" only holds if you know where every yield point is. Call a library function that yields internally (a driver that waits for a bus, a logging call that blocks when its buffer is full) in the middle of updating a shared structure, and another task sees the half-updated structure. In cooperative code, *any function call you did not write is a possible yield point.*` },
      { t: 'callout', kind: 'decision', title: 'Motor control plus slow SD logging',
        md: `**Preemptive**, with the motor task at high priority and the logger at low priority. The 200 ms SD write is inside a library; slicing it cooperatively is not practical, and a 200 ms gap in a control loop is unacceptable. The cost you accept: the two tasks must exchange data through a queue or a protected buffer, never through bare shared variables. An alternative that keeps the kernel out of the control path entirely is to run the control law in a timer ISR and everything else in a superloop — a perfectly good design when there is exactly one urgent activity.` },

      { t: 'exercise',
        prompt: 'A cooperative system has three tasks. Each runs a loop body and then yields. Worst-case loop-body times are: UI 4 ms, comms 9 ms, control 1 ms. Tasks are run round-robin. What is the worst-case time in ms from the control task yielding to it running again?',
        hints: [
          'After control yields, which tasks get a turn before it runs again?',
          'Each of the others runs one full loop body in the worst case.',
        ],
        answer: { type: 'number', value: 13, tol: 0.1, unit: 'ms' },
        solution: 'UI (4 ms) and comms (9 ms) each take a turn: **13 ms**. The control task therefore cannot run more often than once every 14 ms in the worst case (13 ms waiting plus its own 1 ms). If the control law needs 5 ms periods, either comms must yield more often inside its body, or the system must be preemptive.' },

      { t: 'exercise',
        prompt: 'Read this FreeRTOS code, written for a **single-core** MCU with preemption enabled, a 1 kHz tick and `configUSE_TIME_SLICING` set to 0. Both tasks are created at priority 2. `fast_task` must toggle the pin every 1 ms. On the board the pin toggles once and then never again. Explain why, and name the smallest change that fixes it.',
        code: C`static void crunch_task(void *arg)
{
    for (;;) {
        compute_fft();             /* 30 ms of pure computation, no blocking calls */
    }
}

static void fast_task(void *arg)
{
    for (;;) {
        gpio_set_level(PIN, !gpio_get_level(PIN));
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}`,
        hints: [
          'When `fast_task`\'s delay expires, which state does it move to? Is being in that state enough to get the processor?',
          'Preemption happens only for a task of *higher* priority than the running one. What is the only other mechanism that could take the CPU from `crunch_task`, and is it available here?',
          'With time slicing off and equal priorities, `crunch_task` keeps the CPU until it blocks or yields. Does it ever?',
        ],
        answer: { type: 'text', accept: ['priorit'], nudge: 'Think about what the scheduler compares when fast_task becomes ready.' },
        solution: '`fast_task` toggles once and blocks for one tick; `crunch_task` runs. At the next tick `fast_task` becomes Ready — but Ready is not Running. It is not *higher* than the running task, so there is no preemption, and with time slicing off the kernel does not rotate equal priorities either. `crunch_task` never blocks and never yields, so `fast_task` waits for ever.\n\nSmallest fix: **give `fast_task` a higher priority than `crunch_task`.** A task that is short and urgent belongs above a task that is long and patient.\n\nTwo things to know before you trust what you see on a board. With time slicing **on** (the FreeRTOS default, and fixed on in ESP-IDF) the original code appears to work, because the tick that readies `fast_task` also rotates the equal-priority tasks. That is luck, not design: it lasts only until another task joins priority 2 and takes its turn in the rotation. And a 1 ms delay needs a tick of at least 1 kHz — at the 100 Hz ESP-IDF default, `pdMS_TO_TICKS(1)` is 0 ticks and the call does not block at all.' },

      `## A harder case

Your team ships a cooperative system that has worked for two years. A new hire adds a diagnostic that prints a 2 KB table over a 9600 baud UART using a blocking \`uart_write()\` that yields while waiting for the transmit buffer to drain. A week later, field units occasionally report a corrupted configuration record.`,
      { t: 'exercise',
        prompt: 'The configuration module updates a 3-field record like this: write field A, call `diag_print()`, write fields B and C. Explain the corruption, and give a rule the team could adopt to prevent this class of bug in cooperative code.',
        hints: [
          'How long does 2 KB take at 9600 baud, and what does the task do during that time?',
          'What other tasks might read the record while this one is waiting?',
        ],
        solution: 'At 9600 baud with 10 bits per byte, 2048 bytes take about 2.1 s. `uart_write()` yields while it waits, so for two seconds other tasks run while the record has a new A but old B and C. Any task that reads or saves the record in that window gets an inconsistent mix — and if the saver writes it to flash, the corruption becomes permanent.\n\nA workable rule: **no call that may yield between the first and last write of a shared structure.** Build the new record in a local variable, then copy it into the shared location in one step with no calls in between. Under a preemptive kernel the same rule becomes "protect the whole update with a mutex or critical section".' },
    ],
    quiz: [
      { q: 'What is the one thing that distinguishes a preemptive scheduler from a cooperative one?', kind: 'concept',
        choices: [
          { t: 'The kernel can switch tasks at an interrupt, without the running task asking.', ok: true, why: 'In both models tasks have their own stacks and priorities; only in the preemptive one can a task lose the CPU involuntarily.' },
          { t: 'A preemptive scheduler divides processor time equally among all tasks, whatever their priorities.', why: 'Equal sharing is time slicing between equal priorities, an optional extra. A preemptive scheduler can run one task almost all the time if it has the highest priority.' },
          { t: 'Cooperative schedulers do not need a stack per task.', why: 'A task that can pause inside nested calls needs its own stack in either model. A run-to-completion dispatcher avoids per-task stacks, but that is a different structure.' },
        ] },
      { q: 'Fixed-priority preemptive, single core. Task A (prio 5) is blocked on a queue. Task B (prio 3) is running. An ISR puts an item in the queue. When the ISR returns, what runs?', kind: 'concept',
        choices: [
          { t: 'Task A, provided the ISR requested a context switch on exit.', ok: true, why: 'The queue write makes A ready; A is higher than B, so the kernel switches as part of the interrupt return when the ISR asks for it.' },
          { t: 'Task B carries on until it blocks or yields, and only then does A run.', why: 'That would be cooperative behaviour. Under preemption a ready higher-priority task does not wait for the running one to block.' },
          { t: 'Whichever task has been waiting longest.', why: 'Waiting time is not part of the fixed-priority rule. Priority alone decides, and waiting time only orders tasks of equal priority.' },
        ] },
      { q: 'In a preemptive system, why can this lose counts when two tasks call it?', code: C`void record_event(void) { event_count++; }`, kind: 'code',
        choices: [
          { t: 'The increment is a load, an add and a store; a switch between them lets one task overwrite the other\'s result.', ok: true, why: 'Both tasks can load the same old value, and whichever stores second erases the first one\'s increment.' },
          { t: 'Each task gets its own copy of the function and of `event_count`, so the two counts are never added together.', why: 'Function code lives once in flash and is shared. Each task has its own stack, not its own copy of the code or of global variables.' },
          { t: '`event_count` is not `volatile`, so each task only ever updates a copy cached in a register.', why: 'A global is written back to RAM by the end of the function with or without `volatile`. And `volatile` only forces real reads and writes; it does not join them into one indivisible step, so the interleaving problem remains.' },
        ] },
      { q: 'A cooperative design is being considered for a product with strict certification requirements. Which property is its real advantage?', kind: 'arch',
        choices: [
          { t: 'Task switches happen only at known points, so the interleavings can be enumerated.', ok: true, why: 'Reviewers can enumerate yield points. Under preemption a switch may happen at any instruction, and the interleavings cannot be listed by hand.' },
          { t: 'It responds to urgent events faster than a preemptive design, because no time is lost to context switches.', why: 'It responds more slowly: an urgent task waits for whoever is running to yield.' },
          { t: 'It uses no RAM for task stacks, because only one task is ever active at a time.', why: 'Each cooperative task that can yield mid-function still needs a stack.' },
        ] },
      { q: 'Which change turns a responsive preemptive system into one that behaves cooperatively by accident?', kind: 'arch',
        choices: [
          { t: 'Giving every task the same priority and turning time slicing off.', ok: true, why: 'With equal priorities nothing is ever "higher", and without slicing the running task keeps the CPU until it blocks or yields.' },
          { t: 'Raising the tick rate from 100 Hz to 1 kHz, so that the kernel is busy in the tick interrupt.', why: 'A faster tick makes delays finer and slices shorter. It does not remove preemption.' },
          { t: 'Passing all data through queues instead of global variables, so tasks only switch at queue calls.', why: 'Queues change how data moves, not when the scheduler may switch.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 3
  {
    id: 'rtos-freertos-arch',
    title: 'FreeRTOS architecture: what the kernel is made of',
    minutes: 50,
    summary: 'Task control blocks, per-task stacks, ready lists, the tick, the idle task, the port layer, heap schemes, configuration — and how ESP-IDF\'s FreeRTOS differs.',
    skills: ['rtos-sk-config'],
    blocks: [
      `## The problem

You create a task with \`xTaskCreate(worker, "worker", 512, NULL, 5, NULL)\` on an ESP32, copied from a tutorial written for an STM32. It crashes with a stack overflow the first time it calls \`printf\`. On the STM32 the same line was fine. The source code is identical. What differs?

To answer that — and to debug almost any RTOS problem — you need a model of what the kernel actually keeps in memory. FreeRTOS is small enough that you can hold the whole model in your head.`,

      `## The kernel is a library plus three interrupts

FreeRTOS is not a separate program. It is a few C files (\`tasks.c\`, \`queue.c\`, \`list.c\`, optionally \`timers.c\`, \`event_groups.c\`, \`stream_buffer.c\`) compiled into your application, plus a small **port layer** for your CPU and compiler. There is no separate "kernel mode" memory on a typical MCU port: kernel data structures are ordinary RAM in the same address space as your code.

**Kernel objects** you will meet:

| Object | What it is in memory |
|---|---|
| Task | a task control block (TCB) and a stack |
| Queue | a control structure plus a storage area of \`length × item_size\` bytes |
| Semaphore, mutex | a queue with item size 0 (the "count" is the number of items) |
| Event group | one word of bits plus a list of waiting tasks |
| Software timer | a callback and a period, serviced by a kernel "timer daemon" task |
| Stream / message buffer | a byte ring buffer for one writer and one reader |`,

      `## The task control block and the stack

For each task the kernel allocates two blocks of RAM:

- the **[[Task control block]] (TCB)**: a struct holding the saved stack pointer, the priority, the task name, list links that place the task in exactly one state list, and bookkeeping (base priority for inheritance, notification value, optional stack-limit fields);
- the **stack**: an array used for the task's function calls and locals, and — while the task is not running — for the saved CPU registers.

The first field of the TCB is the saved top-of-stack pointer. That layout is deliberate: the port's assembly code can find a task's saved stack pointer by reading the word at the address held in the global \`pxCurrentTCB\`, without knowing anything else about the struct.`,
      { t: 'ascii', caption: 'What exists in RAM for two tasks. Only one task\'s registers are in the CPU at a time; everyone else\'s are parked on their own stacks.',
        text: `pxCurrentTCB ──────────────┐
                           ▼
 TCB "sample"          TCB "log"
 ┌──────────────┐      ┌──────────────┐
 │ pxTopOfStack ─┼─┐    │ pxTopOfStack ─┼─┐
 │ state list   │ │    │ state list   │ │
 │ priority 5   │ │    │ priority 2   │ │
 │ pxStack (base)│ │    │ pxStack (base)│ │
 │ name         │ │    │ name         │ │
 └──────────────┘ │    └──────────────┘ │
                  ▼                     ▼
 stack "sample"        stack "log"
 ┌──────────────┐ high ┌──────────────┐
 │ call frames  │      │ call frames  │
 │ locals       │      │ locals       │
 │ ............ │      │ saved regs   │ ◄ top of stack while not running
 │ (unused)     │      │ (unused)     │
 │ (unused)     │      │ (unused)     │ ◄ high-water mark = least free ever seen
 └──────────────┘ low  └──────────────┘` },
      { t: 'widget', name: 'stack-heap', props: {}, title: 'One stack, stepping through calls',
        caption: 'Step a program and watch frames grow downward. Now picture one of these per task: each must be big enough for that task\'s deepest call chain, and nothing stops a task that goes deeper from writing into whatever sits below its stack.' },

      `## Ready lists: how "pick the next task" is fast

The scheduler keeps **one list of ready tasks per priority level** (an array of \`configMAX_PRIORITIES\` lists), plus a delayed list ordered by wake-up time, a list per kernel object of tasks blocked on it, and a suspended list. A task is on exactly one state list at a time.

Choosing the next task is then: find the highest-numbered non-empty ready list, and take the next task in it. With equal-priority tasks, "next" walks round the list, which is where round-robin comes from. This is a constant-time operation; it does not depend on how many tasks exist. In FreeRTOS a **larger number is a higher task priority**; 0 is the lowest and belongs to the idle task.`,

      `## The tick

A hardware timer interrupts at \`configTICK_RATE_HZ\`. On each [[Tick]] the kernel:

1. increments the tick count;
2. moves every task whose delay or timeout has expired from the delayed list to its ready list;
3. if a task of higher priority than the running one became ready — or time slicing is on and another task of equal priority is ready — requests a context switch.

Consequences worth memorising: **all delays and timeouts are measured in whole ticks**; a delay of *n* ticks ends on the *n*-th tick interrupt from now, so it lasts between *n*−1 and *n* tick periods; and \`pdMS_TO_TICKS(ms)\` rounds *down*, so asking for 5 ms at a 100 Hz tick gives **0 ticks**.

The tick is not the only thing that causes scheduling. Any kernel call that readies a task (a queue send, a semaphore give, from a task or an ISR) triggers a scheduling decision immediately. The tick is only what makes *time* pass.`,

      `## The idle task

The kernel always needs something to run, so it creates an **[[Idle task]]** at priority 0 when the scheduler starts. It runs only when nothing else is ready. It is not just filler: when a task deletes itself, its stack and TCB are freed **by the idle task**; ports use it to enter low-power sleep; and on ESP-IDF the task watchdog monitors it by default, on the reasoning that if idle never runs, some task is hogging a core.`,
      { t: 'callout', kind: 'mistake', title: 'Starving the idle task',
        md: `A task that loops without ever blocking (\`while (!ready) { }\`, or a polling loop with no delay) at any priority above 0 means the idle task never runs. Memory from deleted tasks is never reclaimed, power saving never happens, and on ESP-IDF you get \`task_wdt: Task watchdog got triggered\` naming \`IDLE0\` or \`IDLE1\`. The fix is never "feed the watchdog from the loop". It is to make the task **block** on the thing it is waiting for.` },

      `## The port layer

Everything CPU-specific sits behind a small interface: how to build the initial stack frame for a new task so that "restoring" it starts the task function; how to start the first task; how to request a context switch (\`portYIELD\`); how to save and restore registers; how to enter and leave a critical section; and how to set up the tick timer. On Cortex-M the port uses the SVC, PendSV and SysTick exceptions. On RISC-V it uses the machine timer interrupt and \`ecall\`. On the Xtensa-based ESP32 it is different again. The lesson on context switching opens this box.`,

      `## Heap schemes

Kernel objects created with the ordinary \`…Create\` functions are allocated from the FreeRTOS heap through \`pvPortMalloc\`. The kernel ships five interchangeable implementations; you link one.

| Scheme | Behaviour | Use when |
|---|---|---|
| \`heap_1\` | allocate only, never free | everything is created at start-up and lives forever; fully deterministic |
| \`heap_2\` | free allowed, **no** merging of adjacent free blocks | legacy; fragments unless every block is the same size |
| \`heap_3\` | wraps the C library \`malloc\`/\`free\`, made safe by suspending the scheduler | you must share the toolchain's heap |
| \`heap_4\` | first fit **with** merging of adjacent free blocks | general purpose; the usual choice |
| \`heap_5\` | \`heap_4\` across several separate memory regions | RAM is not one contiguous block |

There are also \`…CreateStatic\` variants that take memory you provide, so a design can avoid the heap entirely — a common requirement in safety and security work, because a system that never allocates at run time cannot fail an allocation at run time.`,
      { t: 'callout', kind: 'note', title: 'ESP-IDF does not use heap_1…heap_5',
        md: `ESP-IDF routes FreeRTOS allocations to its own capability-based heap allocator (\`heap_caps_malloc\`), which manages several memory regions with different properties. The five schemes above are what you will meet on most other FreeRTOS ports, including typical Cortex-M projects.` },

      `## Configuration: FreeRTOSConfig.h

Upstream FreeRTOS is configured at compile time through macros in a header you own, \`FreeRTOSConfig.h\`. The ones that change behaviour most:

| Macro | Effect |
|---|---|
| \`configUSE_PREEMPTION\` | 1 = preemptive, 0 = cooperative |
| \`configUSE_TIME_SLICING\` | rotate equal-priority tasks on each tick |
| \`configTICK_RATE_HZ\` | tick frequency; the resolution of every delay and timeout |
| \`configMAX_PRIORITIES\` | number of ready lists; valid priorities are 0 … this−1 |
| \`configMINIMAL_STACK_SIZE\` | idle task stack size (in the port's stack units) |
| \`configTOTAL_HEAP_SIZE\` | size of the heap for \`heap_1/2/4\` |
| \`configCHECK_FOR_STACK_OVERFLOW\` | 1 or 2 enables run-time stack checks and a hook |
| \`configUSE_MUTEXES\`, \`configUSE_RECURSIVE_MUTEXES\`, \`configUSE_COUNTING_SEMAPHORES\` | compile those objects in |
| \`configMAX_SYSCALL_INTERRUPT_PRIORITY\` | highest interrupt priority allowed to call the kernel (Cortex-M and similar ports) |
| \`INCLUDE_xTaskDelayUntil\`, \`INCLUDE_uxTaskGetStackHighWaterMark\`, … | include optional API functions (older kernels spell the first one \`INCLUDE_vTaskDelayUntil\`) |

On ESP-IDF you do not edit this header. The same settings are exposed through \`idf.py menuconfig\` under *Component config → FreeRTOS* (for example \`CONFIG_FREERTOS_HZ\`) and end up in \`sdkconfig\`.`,

      `## ESP-IDF FreeRTOS: the differences that bite

The dual-core ESP32 and ESP32-S3 run Espressif's **symmetric multiprocessing (SMP)** adaptation of FreeRTOS. The single-core chips (ESP32-C3, ESP32-C6) run the same code base configured for one core. The differences you must know before porting code:

- **Stack sizes are in bytes.** In upstream FreeRTOS the stack depth argument of \`xTaskCreate\` is in *words* (4 bytes each on a 32-bit port). In ESP-IDF it is in **bytes**. \`512\` means 2048 bytes on a typical Cortex-M port and 512 bytes on an ESP32 — which is the crash in the opening problem.
- **Core affinity.** \`xTaskCreatePinnedToCore(fn, name, stack, arg, prio, &handle, core)\` pins a task to core 0 or 1, or pass \`tskNO_AFFINITY\` to let it run on either. Plain \`xTaskCreate\` creates an unpinned task.
- **Two tasks really run at once.** Each core runs the highest-priority ready task *that is allowed on that core*. A priority-3 task can therefore execute at the same instant as a priority-10 task. Code that relied on "the higher-priority task cannot be interrupted by the lower one" is wrong on two cores.
- **One idle task per core**, and each is watched by the task watchdog by default.
- **Critical sections take a spinlock.** Disabling interrupts on one core does not stop the other core, so \`taskENTER_CRITICAL(&lock)\` both disables interrupts on the calling core and takes a spinlock of type \`portMUX_TYPE\`.
- **Suspending the scheduler** (\`vTaskSuspendAll\`) only stops task switching on the calling core. It does not give mutual exclusion against a task on the other core.
- **\`app_main\` is itself a task**, created by the start-up code at a low priority. It may return; the scheduler is already running before it is called, so you never call \`vTaskStartScheduler\` yourself.

The default tick rate in ESP-IDF is 100 Hz, giving a 10 ms tick; check \`CONFIG_FREERTOS_HZ\` in your \`sdkconfig\` rather than assuming.`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Creating tasks on ESP-IDF. Every call was checked against the ESP-IDF v6.1 headers; the program was not compiled as a whole or run on a board here.',
        code: C`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"

static const char *TAG = "arch";

static void worker(void *arg)
{
    for (;;) {
        ESP_LOGI(TAG, "worker on core %d, free stack %u bytes",
                 xPortGetCoreID(),
                 (unsigned)uxTaskGetStackHighWaterMark(NULL));
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

void app_main(void)
{
    /* Unpinned: the scheduler may run it on either core. Stack is 4096 BYTES. */
    xTaskCreate(worker, "worker_any", 4096, NULL, 5, NULL);

    /* Pinned to core 1. */
    xTaskCreatePinnedToCore(worker, "worker_c1", 4096, NULL, 5, NULL, 1);
}`,
        explain: [
          { lines: '7-15', md: 'A task function takes one `void *` and must never return. If it has nothing more to do it must call `vTaskDelete(NULL)`; returning from a task function is an error the port traps.' },
          { lines: '12', md: '`uxTaskGetStackHighWaterMark(NULL)` reports the smallest amount of stack that has ever been free for the calling task. The kernel fills each stack with a known byte at creation and scans for how much of the pattern is still intact. On ESP-IDF the unit is bytes.' },
          { lines: '13', md: 'The task moves to the Blocked state and is put on the delayed list. It uses no CPU until the tick interrupt moves it back to a ready list.' },
          { lines: '20', md: 'Allocates a TCB and a 4096-byte stack from the heap, builds an initial register frame on that stack so that the first "restore" jumps into `worker`, and puts the TCB on the priority-5 ready list.' },
          { lines: '23', md: 'Same, but the TCB records that only core 1 may run it.' },
        ] },

      { t: 'predict',
        q: 'A tutorial for a 32-bit Cortex-M board creates a task with stack depth `256`. You paste the line into an ESP-IDF project unchanged. How much stack does the task get in each case?',
        choices: [
          { t: '1024 bytes on the Cortex-M board, 256 bytes on ESP-IDF.', ok: true, why: 'Upstream counts in words of 4 bytes; ESP-IDF counts in bytes. The ESP-IDF task has a quarter of the stack the author intended.' },
          { t: '256 bytes on both; the argument is always bytes.', why: 'Upstream FreeRTOS defines the argument as a number of stack words, and the word is 4 bytes on a 32-bit port.' },
          { t: '256 words (1024 bytes) on both; the API is the same.', why: 'The function signature is the same but ESP-IDF documents a different unit for this argument.' },
        ],
        reveal: 'Always convert when porting: multiply upstream word counts by 4 for ESP-IDF, and then measure with `uxTaskGetStackHighWaterMark` rather than trusting either number. Logging through `printf`-style functions alone can need well over a kilobyte.' },

      { t: 'exercise',
        prompt: 'An ESP-IDF application creates 6 tasks with stacks of 4096, 4096, 3072, 2048, 2048 and 8192 bytes. Ignoring TCBs and allocator overhead, how many bytes of heap do the task stacks consume?',
        hints: ['On ESP-IDF the stack argument is already in bytes.', 'Add them.'],
        answer: { type: 'number', value: 23552, tol: 0, unit: 'bytes' },
        solution: '4096 + 4096 + 3072 + 2048 + 2048 + 8192 = **23 552 bytes**. Each task also needs a TCB (a few hundred bytes on ESP-IDF; check `sizeof(StaticTask_t)` for your configuration), and the system tasks ESP-IDF creates for you (idle per core, timer daemon, main, and any Wi-Fi/Bluetooth tasks) have their own stacks. On a 32 KB Cortex-M0+ the same task set would not fit at all — which is one reason small MCUs often stay bare-metal.' },

      { t: 'exercise',
        prompt: 'With `CONFIG_FREERTOS_HZ=100`, what does `vTaskDelay(pdMS_TO_TICKS(15))` do, and what is the range of real time the task spends blocked?',
        hints: [
          'How long is one tick? How many whole ticks fit in 15 ms?',
          'A delay of n ticks ends at the n-th tick interrupt after the call. Where between two ticks might the call happen?',
        ],
        answer: { type: 'text', accept: ['\\b1\\s*tick', 'one tick', '0.*10\\s*ms', 'up to 10'], nudge: 'Work out pdMS_TO_TICKS(15) with a 10 ms tick first.' },
        solution: 'One tick is 10 ms. `pdMS_TO_TICKS(15)` is 15 × 100 / 1000 = 1.5, truncated to **1 tick**. A 1-tick delay ends at the next tick interrupt, which is somewhere between just over 0 ms and 10 ms away. So the "15 ms delay" blocks for **between roughly 0 and 10 ms**. If you need at least 15 ms, ask for enough ticks to cover it: 2 ticks block for between 10 and 20 ms, which is not enough; 3 ticks block for between 20 and 30 ms, always more than 15. The rule for "at least *t*" is ⌈t ÷ tick period⌉ + 1 ticks. For fine delays use a hardware timer.' },

      `## A harder case

A colleague's ESP32 firmware has a "config" struct that a priority-10 network task writes and a priority-3 display task reads. There is no lock. Their argument: "The display task can never run while the network task is running, because 10 > 3. And the network task writes the whole struct without blocking, so the display task can never see half of it." The firmware has been running on an ESP32-C3 for months. It is now being moved to an ESP32-S3.`,
      { t: 'exercise',
        prompt: 'Is the argument valid on the ESP32-C3? Is it valid on the ESP32-S3? What should be done?',
        hints: [
          'How many cores does each chip have? (The ESP32-C3 has one RISC-V core; the ESP32-S3 has two Xtensa cores.)',
          'On two cores, what does "highest priority ready task runs" become?',
          'Even on one core, is there a direction in which the argument fails? Which task can be interrupted mid-operation by the other?',
        ],
        solution: 'On the single-core C3 the argument half holds: the low-priority reader cannot run *during* the writer\'s uninterrupted write. But the reverse is not protected — the high-priority writer can preempt the reader halfway through *reading*, so the reader can end up with some old fields and some new ones. It "works" only if readers happen to copy quickly and the timing has been kind.\n\nOn the dual-core S3 the argument fails completely: the two tasks can be running at the same instant on different cores, regardless of priority.\n\nFix: do not use priority as a lock. Protect the struct with a mutex (or a short critical section with a spinlock if the copy is a few words), or have the network task send complete config snapshots through a queue so the display task owns its own copy.' },

      { t: 'refs', items: [
        { title: 'FreeRTOS-Kernel source (tasks.c, list.c, queue.c, portable/)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel' },
        { title: 'Mastering the FreeRTOS Real Time Kernel — heap management and task management chapters', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'ESP-IDF: FreeRTOS (IDF) — documentation source', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/system/freertos_idf.rst', note: 'Stack sizes in bytes, core affinity, SMP scheduling, critical sections with spinlocks.' },
      ] },
    ],
    quiz: [
      { q: 'Where are a task\'s CPU registers kept while a different task is running?', kind: 'arch',
        choices: [
          { t: 'On that task\'s own stack, with the TCB holding the pointer to them.', ok: true, why: 'The port pushes the register set onto the outgoing task\'s stack and stores the resulting stack pointer in the first field of its TCB.' },
          { t: 'In a shadow register bank inside the CPU, which holds one saved set per task.', why: 'A microcontroller core has one set of general-purpose registers. Everything not currently running has to be parked in RAM.' },
          { t: 'In one save area on the kernel\'s heap, which the scheduler copies in and out.', why: 'One shared area could hold only one task\'s context. Each task needs its own copy, and its own stack is where the port puts it.' },
        ] },
      { q: 'With `configTICK_RATE_HZ` at 100, a task calls `vTaskDelay(pdMS_TO_TICKS(4))`. What happens?', kind: 'code',
        choices: [
          { t: 'The argument is 0 ticks, so the task does not block for any time.', ok: true, why: '4 ms is less than one 10 ms tick and the macro truncates. A zero delay at most lets an equal-priority ready task run.' },
          { t: 'It blocks for exactly 4 ms, timed by the kernel from the moment of the call.', why: 'The kernel only measures time in whole ticks; it has no way to wake a task between tick interrupts.' },
          { t: 'It blocks for one 10 ms tick, because the conversion rounds up to the nearest tick.', why: 'The conversion rounds down rather than to the nearest value, so sub-tick requests become zero.' },
        ] },
      { q: 'Why does FreeRTOS keep one ready list per priority instead of one sorted list of all tasks?', kind: 'arch',
        choices: [
          { t: 'Picking the next task then takes a short, fixed time however many tasks exist.', ok: true, why: 'Bounded, predictable scheduler time is the point: the kernel\'s own work must not add unpredictable latency. Round-robin within a priority then comes free: it is just "next in the list".' },
          { t: 'So that two tasks of different priority can run at the same time, one from each list.', why: 'The number of tasks running at once is the number of cores. List layout does not change that.' },
          { t: 'Because tasks of different priority must have different stack sizes.', why: 'Stack size is chosen per task and is unrelated to priority or to how ready tasks are indexed.' },
        ] },
      { q: 'A design creates all tasks and queues at start-up and never deletes anything. Which upstream heap scheme fits, and why?', kind: 'arch',
        choices: [
          { t: '`heap_1`, because it only allocates and so cannot fragment.', ok: true, why: 'If nothing is ever freed, the ability to free is dead weight and a source of nondeterminism you do not need.' },
          { t: '`heap_2`, because never merging free blocks keeps allocation deterministic.', why: 'Not merging is a weakness that causes fragmentation when sizes vary. It is not a feature to seek out.' },
          { t: '`heap_5`, because it is the newest scheme and includes everything the others do.', why: 'It exists to span several separate RAM regions. Without that need it adds complexity for nothing.' },
        ] },
      { q: 'On a dual-core ESP32, task A (priority 8) is pinned to core 0 and task B (priority 2) is pinned to core 1. Both are ready. What runs?', kind: 'concept',
        choices: [
          { t: 'Both, simultaneously, one on each core.', ok: true, why: 'Each core runs the highest-priority ready task it is allowed to run. Priority no longer implies that the lower task is paused.' },
          { t: 'Only A; B is not chosen until A blocks, because 8 > 2.', why: 'That is the single-core rule. With a second core free and B allowed on it, B runs.' },
          { t: 'They alternate each tick.', why: 'Time slicing applies between equal priorities competing for the same core. These two are not competing.' },
        ] },
      { q: 'What is the idle task responsible for, besides using up spare time?', kind: 'concept',
        choices: [
          { t: 'Freeing the stack and TCB of tasks that have deleted themselves.', ok: true, why: 'A task cannot free the stack it is currently running on, so the kernel leaves that clean-up to idle. Many ports also use the idle task to enter low-power sleep.' },
          { t: 'Running the tick interrupt handler, which is why it must never be starved.', why: 'The tick is a hardware timer interrupt and runs regardless of which task is current.' },
          { t: 'Choosing which task runs next whenever the current one blocks or yields.', why: 'Scheduling decisions are made inside kernel calls and interrupts, not by a task.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 4
  {
    id: 'rtos-task-sched',
    title: 'Task states, priorities and periodic work',
    minutes: 50,
    summary: 'Running, Ready, Blocked, Suspended; time slicing and starvation; and why vTaskDelay drifts where vTaskDelayUntil does not.',
    skills: ['rtos-sk-sched-predict', 'rtos-sk-periodic'],
    blocks: [
      `## The problem

A data logger samples a sensor "every 100 ms" and timestamps each sample by counting: sample *n* is assumed to be at *n* × 100 ms. By the time the log's own timestamps say one hour has passed, the wall clock says 1 h 18 min. The task is the highest priority in the system and nothing preempts it. The loop is three lines. Where did the time go?`,

      `## Four states

Every FreeRTOS task is in exactly one of these states:

| State | Meaning | Leaves when |
|---|---|---|
| **Running** | its registers are in a CPU core right now | preempted, or it blocks, yields, suspends |
| **Ready** | could run, but something of equal or higher priority has the core | the scheduler picks it |
| **Blocked** | waiting for an event **or a time**: a delay, a queue, a semaphore, a notification — always with an optional timeout | the event happens or the timeout expires |
| **Suspended** | parked by \`vTaskSuspend()\` until \`vTaskResume()\`; also where a task waiting with \`portMAX_DELAY\` is kept | resumed explicitly, or the event arrives |`,
      { t: 'ascii', caption: 'Task state transitions.',
        text: `                 scheduler picks it
        ┌──────────────────────────────────┐
        │                                  ▼
   ┌─────────┐   preempted / yields   ┌─────────┐
   │  READY  │ ◄───────────────────── │ RUNNING │
   └─────────┘                        └─────────┘
     ▲     ▲                            │     │
     │     │  event arrives or          │     │ vTaskSuspend()
     │     │  timeout expires           │     ▼
     │   ┌─────────┐  blocking call     │  ┌───────────┐
     │   │ BLOCKED │ ◄──────────────────┘  │ SUSPENDED │
     │   └─────────┘                       └───────────┘
     │                 vTaskResume()             │
     └───────────────────────────────────────────┘` },
      `A well-designed task spends almost all its life **Blocked**. That is the point of an RTOS: a blocked task costs no CPU time at all — it is just a TCB sitting on a list — and it is woken by exactly the event it cares about. A task that polls instead (\`while (!flag) {}\`) stays Ready/Running forever and steals time from everything at or below its priority.`,

      `## Priorities, time slicing and yielding

The rule again: **the highest-priority Ready task runs.** What happens among tasks of *equal* priority depends on configuration:

- With **time slicing** on (the default), the scheduler rotates among Ready tasks of the highest ready priority at every tick. Each gets at most one tick period before the next has a turn.
- With time slicing off, an equal-priority task keeps running until it blocks, yields, or something higher preempts it.

\`taskYIELD()\` asks the scheduler to run another Ready task **of the same or higher priority** now. It never gives time to a lower-priority task: if nothing equal or higher is ready, the caller continues immediately. That is why yielding in a busy loop does not cure starvation of lower-priority tasks; only blocking does.`,
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'round-robin' }, title: 'Round-robin among equals',
        caption: 'Three tasks at one priority share the CPU a tick at a time. Raise one task\'s priority and see the sharing stop.' },

      `## Starvation

[[Starvation]] is when a Ready task never (or too rarely) gets the CPU because higher-priority work is always Ready. Fixed-priority scheduling makes no promise of fairness. If a priority-5 task never blocks, nothing at priorities 0–4 runs again, including idle.`,
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'starvation' }, title: 'Starvation',
        caption: 'Make the high-priority task block for part of each period and watch the starved task come back to life.' },
      { t: 'predict',
        q: 'Single core, preemption and time slicing on, 10 ms tick. Tasks A and B are both priority 2 and never block (each prints its letter in a tight loop). Task C is priority 1 and prints "c". What does the output look like over one second?',
        choices: [
          { t: 'Runs of A and B alternating about every 10 ms; no "c" at all.', ok: true, why: 'A and B share the highest ready priority, so the tick rotates between them. C is lower and neither A nor B ever blocks, so C is starved.' },
          { t: 'A, B and C in rotation, with C getting a smaller share of the ticks.', why: 'FreeRTOS priorities are strict, not weights. A lower priority gets nothing while a higher one is ready.' },
          { t: 'Only A, because it was created first.', why: 'With time slicing on, creation order does not let one equal-priority task monopolise the core.' },
        ],
        reveal: 'Strict priority means lower levels only get what the higher levels leave. On ESP-IDF this output would be followed after a few seconds by a task watchdog report, because the idle task on that core is being starved too.' },

      `## Periodic work: \`vTaskDelay\` versus \`vTaskDelayUntil\`

\`vTaskDelay(n)\` means "block for *n* ticks **from now**". \`vTaskDelayUntil(&last, n)\` means "block until *n* ticks after **the last time I was supposed to wake**", and it updates \`last\` for you.`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Two ways to write a "100 ms" task. Only the second has a 100 ms period. (`take_sample()` stands for your own code.)',
        code: C`/* Drifts: period = work time + 100 ms */
static void sample_task_drifting(void *arg)
{
    for (;;) {
        take_sample();                       /* takes 30 ms */
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

/* Fixed period: wakes at t0+100, t0+200, t0+300 ... */
static void sample_task_periodic(void *arg)
{
    TickType_t last_wake = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(100);

    for (;;) {
        take_sample();
        vTaskDelayUntil(&last_wake, period);
    }
}`,
        explain: [
          { lines: '5-6', md: 'The delay starts counting when `take_sample()` returns. Each loop therefore lasts 30 + 100 = 130 ms, and the error accumulates: after 1000 samples the task is 30 s late.' },
          { lines: '13', md: 'Records the tick count at which the first cycle starts. This variable is the task\'s time reference; the kernel advances it by exactly `period` on each call.' },
          { lines: '18', md: 'The kernel computes `last_wake + period` and blocks the task until the tick count reaches it. Time spent in `take_sample()`, or spent preempted, comes out of the sleep — the wake-up instants stay on a fixed grid.' },
        ] },
      `That is the opening problem: a loop of work-then-\`vTaskDelay\` has a period of *delay + work time + any time spent preempted*. With 30 ms of work, an hour of "100 ms" samples takes 1.3 hours.

**Tick by tick.** Scale it down so that it fits on a line: the work takes 1 tick and the intended period is 5 ticks.`,
      { t: 'ascii', caption: 'W = the task is working, . = Blocked. The first task slips one tick further behind the 5-tick grid on every cycle; the second is pulled back to the grid each time.',
        text: `tick:                  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20
grid (every 5):        |              |              |              |              |

work; vTaskDelay(5)    W  .  .  .  .  .  W  .  .  .  .  .  W  .  .  .  .  .  W  .  .
  starts at 0, 6, 12, 18 ...      period = 1 + 5 = 6 ticks      late by 0, 1, 2, 3 ...

work; vTaskDelayUntil  W  .  .  .  .  W  .  .  .  .  W  .  .  .  .  W  .  .  .  .  W
  starts at 0, 5, 10, 15, 20      period = 5 ticks              late by 0, 0, 0, 0 ...

How vTaskDelayUntil(&last, 5) does it:
  last = 0   work ends at tick 1   wake target = 0 + 5 = 5    sleeps 4 ticks, last = 5
  last = 5   work ends at tick 6   wake target = 5 + 5 = 10   sleeps 4 ticks, last = 10
  If the work once takes 3 ticks:  ends at 13, target still 15, sleeps only 2 ticks.` },
      `You can reproduce the first row in the **Starvation** simulator above: Poller does 1 tick of work and then calls \`vTaskDelay\`. Set its delay to 5 and read off where it runs — ticks 0, 6, 12, 18, 24 — not the 0, 5, 10, 15 you asked for. Background in the same simulator is a \`vTaskDelayUntil\` task: it is released at 0, 10, 20 whatever its run time is.

\`vTaskDelayUntil\` removes the **drift** (accumulating error). It does not remove **jitter** (variation of each individual wake-up), which still comes from tick granularity and from higher-priority tasks. And if one cycle overruns its period, the next wake time is already in the past, so the call returns immediately and the task runs back-to-back until it has caught up. Newer kernels provide \`xTaskDelayUntil\`, which returns whether the task actually had to sleep — a cheap overrun detector.`,
      { t: 'callout', kind: 'mistake', title: 'Initialising the wake time inside the loop',
        md: `Writing \`TickType_t last_wake = xTaskGetTickCount();\` **inside** the \`for\` loop resets the reference every cycle and turns \`vTaskDelayUntil\` back into \`vTaskDelay\`. It must be initialised once, before the loop, and then only the kernel updates it.` },
      { t: 'callout', kind: 'decision', title: 'Choosing priorities',
        md: `Priority should encode **urgency (how soon after becoming ready a task must finish), not importance.** The task that must respond within 1 ms goes above the task that must respond within 100 ms, even if the second is "the main feature". Give short-deadline, short-running tasks high priorities; give long computations low ones. Keep the number of distinct levels small and write down the reason for each. A later lesson shows that assigning priority by period (rate-monotonic) is provably the best fixed assignment for periodic tasks.` },

      { t: 'exercise',
        prompt: 'A task does 30 ms of work and then calls `vTaskDelay(pdMS_TO_TICKS(100))` in a loop, at the highest priority, with a 10 ms tick. The work begins exactly on a tick. How many seconds late is the start of the 1000th cycle after the first, compared with an ideal 100 ms period?',
        hints: [
          'What is the real period of one loop?',
          'The 1000th cycle after the first starts 1000 periods later. Compare 1000 × real period with 1000 × 100 ms.',
        ],
        answer: { type: 'number', value: 30, tol: 0.5, unit: 's' },
        solution: 'The work ends 30 ms after a tick boundary, on a tick boundary (3 ticks), then the task sleeps 10 ticks: period = 130 ms. 1000 cycles take 130 s instead of 100 s, so the cycle starts **30 s late**. With `vTaskDelayUntil` the error after 1000 cycles is zero, give or take one tick of jitter.' },

      { t: 'exercise',
        prompt: 'This ESP-IDF task was written to wait for a "data ready" flag set by another task. Within seconds of start-up the console shows `task_wdt: Task watchdog got triggered ... IDLE0 (CPU 0)`. Explain the cause and rewrite the wait correctly.',
        code: C`static volatile bool data_ready;

static void consumer_task(void *arg)      /* priority 5, pinned to core 0 */
{
    for (;;) {
        while (!data_ready) {
            taskYIELD();
        }
        data_ready = false;
        process_data();
    }
}`,
        hints: [
          'In which state is this task while it waits?',
          'What does `taskYIELD()` do if no task of equal or higher priority is ready?',
          'Which kernel object lets one task sleep until another one signals it?',
        ],
        answer: { type: 'text', accept: ['block', 'notif', 'semaphore', 'ulTaskNotifyTake', 'xSemaphoreTake'], nudge: 'Name the state the task should be in while waiting, or the API that puts it there.' },
        solution: 'The task never enters the Blocked state. `taskYIELD()` only hands over to tasks of priority ≥ 5; if there are none it returns at once, so the loop spins at full speed. Everything below priority 5 on core 0 is starved, including the idle task, and the task watchdog — which expects idle to run every few seconds — reports it.\n\nCorrect version: block on a kernel object. With a task notification:\n\n```c\nstatic void consumer_task(void *arg)\n{\n    for (;;) {\n        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);   /* Blocked: uses no CPU */\n        process_data();\n    }\n}\n/* producer: xTaskNotifyGive(consumer_handle); */\n```\nA `vTaskDelay(1)` inside the polling loop would also silence the watchdog, but it is still polling: it adds up to a tick of latency and wakes the CPU for nothing.' },

      { t: 'widget', name: 'timer-lab', props: { mode: 'watchdog' }, title: 'What a watchdog timeline looks like',
        caption: 'A watchdog must be fed before it expires. ESP-IDF\'s task watchdog applies the same idea to the idle tasks: no feed within the timeout means something has hogged the core.' },

      `## A harder case

A task must send a heartbeat packet every 500 ms. The send normally takes 20 ms but, when the radio is busy, occasionally takes 1.2 s. The task uses \`vTaskDelayUntil\` with a 500 ms period.`,
      { t: 'exercise',
        prompt: 'Describe what the task does in the two cycles following a 1.2 s send. Is that what you want for a heartbeat? Propose a change.',
        hints: [
          'After the long send, where is `last_wake + period` relative to the current tick count?',
          'What does `vTaskDelayUntil` do when the target time has already passed?',
        ],
        solution: 'The long send finishes 1.2 s after the cycle started. The next two wake targets (at +0.5 s and +1.0 s) are already in the past, so `vTaskDelayUntil` returns immediately twice and the task sends **two heartbeats back to back** before settling on the grid again at +1.5 s. For a heartbeat, a burst of catch-up packets is useless and loads a radio that was already busy.\n\nBetter: detect the overrun and re-anchor. With `xTaskDelayUntil` check the return value (`pdFALSE` means "did not sleep: we are late") and on overrun set `last_wake = xTaskGetTickCount()` so the schedule restarts from now. In general, decide for every periodic task what should happen on overrun — catch up, skip, or raise an error — instead of inheriting the default.' },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel — task management chapter (states, priorities, vTaskDelayUntil)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'FreeRTOS-Kernel: include/task.h (API comments for vTaskDelay, xTaskDelayUntil, taskYIELD)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/task.h' },
        { title: 'ESP-IDF: Watchdogs — documentation source', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/system/wdts.rst', note: 'Task watchdog and idle-task monitoring.' },
      ] },
    ],
    quiz: [
      { q: 'A task calls `xQueueReceive(q, &item, pdMS_TO_TICKS(200))` on an empty queue. Which state is it in, and what are the two ways it leaves?', kind: 'concept',
        choices: [
          { t: 'Blocked; it leaves when an item arrives or when 200 ms of ticks have passed.', ok: true, why: 'A blocking call with a timeout puts the task on both the queue\'s waiting list and the delayed list; whichever fires first readies it.' },
          { t: 'Ready; the kernel runs it briefly on each tick to check whether the queue has data yet.', why: 'A blocked task is not polled. The kernel readies it from inside the send call, or from the tick when the timeout expires.' },
          { t: 'Suspended; only `vTaskResume` can wake it.', why: 'Suspended is entered by an explicit suspend call (or an indefinite wait). A wait with a finite timeout is the Blocked state.' },
        ] },
      { q: 'Which loop gives a task a fixed 50 ms period regardless of how long `work()` takes (as long as it takes less than 50 ms)?', kind: 'code',
        choices: [
          { t: '`last = xTaskGetTickCount();` once, then `work(); vTaskDelayUntil(&last, pdMS_TO_TICKS(50));` in the loop.', ok: true, why: 'The wake time is computed from the previous wake time, so execution time is absorbed into the sleep.' },
          { t: '`work(); vTaskDelay(pdMS_TO_TICKS(50));` in the loop, at the highest priority so that nothing can preempt it.', why: 'Priority does not come into it. The delay starts after the work finishes, so the period is 50 ms plus the work time and it drifts even if nothing ever preempts the task.' },
          { t: '`work(); vTaskDelay(pdMS_TO_TICKS(50) - 1);` in the loop, where the 1 tick taken off is the measured time of `work()`.', why: 'A fixed correction only matches one particular execution time. Any variation, or any preemption, brings the drift back.' },
        ] },
      { q: 'Task H (priority 4) runs `for(;;){ poll_sensor(); taskYIELD(); }`. Task L (priority 2) is always ready. How much CPU does L get?', kind: 'concept',
        choices: [
          { t: 'None. Yield only hands over to tasks of equal or higher priority.', ok: true, why: 'H stays Ready throughout, and the scheduler always picks the highest-priority Ready task, which is H again.' },
          { t: 'About half, since H gives up the processor once in every iteration of its loop.', why: 'Yielding does not lower the caller\'s priority; if nothing at its level or above is ready, the caller simply continues.' },
          { t: 'One tick in every two, because of time slicing.', why: 'Time slicing rotates among tasks at the same priority. It never gives a slice to a lower one.' },
        ] },
      { q: 'With a 10 ms tick, a task calls `vTaskDelay(1)` at a random moment. How long is it blocked?', kind: 'concept',
        choices: [
          { t: 'Anywhere from almost 0 up to 10 ms.', ok: true, why: 'The delay ends at the next tick interrupt, and the call may happen at any point between two ticks.' },
          { t: 'Exactly 10 ms, measured from the call.', why: 'That would require the kernel to start a private timer at the moment of the call. It only counts tick interrupts.' },
          { t: 'Between 10 and 20 ms.', why: 'That is the range for a 2-tick delay. A 1-tick delay ends on the very next tick.' },
        ] },
      { q: 'Priorities should be assigned mainly according to:', kind: 'arch',
        choices: [
          { t: 'How short each task\'s deadline is.', ok: true, why: 'Priority exists to make sure work with little time to spare is not kept waiting by work that has plenty.' },
          { t: 'How important the feature is to the customer.', why: 'An important but slow-paced function (a UI redraw) can wait behind a trivial but urgent one (acknowledging a bus) with no harm; the reverse is not true.' },
          { t: 'How much CPU time the task needs.', why: 'CPU-hungry tasks usually belong at low priority so they soak up leftover time instead of blocking urgent work.' },
        ] },
      { q: 'After one overrun cycle of 130 ms in a 50 ms `vTaskDelayUntil` task, what happens next?', kind: 'code',
        choices: [
          { t: 'The next two calls return immediately and the task runs back-to-back until its schedule catches up.', ok: true, why: 'The stored wake time advances by one period per call; while it is still in the past the kernel does not block the task.' },
          { t: 'The task sleeps a full 50 ms from the end of the overrun, and its schedule shifts by 80 ms.', why: 'That would be the behaviour of a relative delay. The absolute version keeps its original time grid.' },
          { t: 'The kernel deletes the task for missing its deadline.', why: 'FreeRTOS does not police deadlines. Detecting and handling overrun is the application\'s job.' },
        ] },
    ],
  },
];

export default { lessons };
