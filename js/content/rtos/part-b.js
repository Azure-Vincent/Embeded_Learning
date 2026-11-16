// Real-time systems, part B: context switching, interrupts, queues and semaphores, races and critical sections.
const C = String.raw;

const lessons = [
  // ───────────────────────────────────────────────────────────────── 5
  {
    id: 'rtos-context-switch',
    title: 'Context switching: what the kernel saves and what it costs',
    minutes: 45,
    summary: 'How a processor stops one task mid-instruction-stream and resumes another: the Cortex-M mechanism in detail, RISC-V in outline.',
    skills: ['rtos-sk-context'],
    blocks: [
      `## The problem

A task with a 512-byte stack runs a small loop that uses 120 bytes of locals. It overflows its stack anyway — but only when interrupts are busy. A second puzzle from the same project: raising the tick rate from 100 Hz to 10 kHz "to make delays more precise" made the whole system measurably slower. Both have the same root: a context switch is real work done with real memory, and you have to budget for it.`,

      `## What a context is

A task's **context** is everything the processor needs in order to continue it later as if nothing had happened:

- the general-purpose registers (they hold the task's intermediate values);
- the program counter (where it was);
- the status register (condition flags from the last comparison);
- the stack pointer (where its stack is);
- floating-point registers, if the task uses the FPU.

The task's *memory* — its stack and any globals — is not copied anywhere. It stays where it is. A [[Context switch]] is: push the outgoing task's registers onto **its own stack**, write the resulting stack pointer into its TCB, pick the next task, read that task's stack pointer from *its* TCB, and pop its registers.`,

      `## Cortex-M: two stack pointers and three exceptions

Arm designed the Cortex-M exception model with an RTOS in mind. Three features do the work.

**Two stack pointers.** The core has a Main Stack Pointer (**MSP**) and a Process Stack Pointer (**PSP**). Exception handlers always use MSP. Thread-mode code can be switched to PSP, and FreeRTOS runs every task on PSP. So there is **one** interrupt stack (MSP) shared by all ISRs, and each task's stack (PSP) only needs room for that task — plus one exception frame, as you will see.

**Automatic stacking.** When any exception is taken, the hardware itself pushes eight words onto the *current* stack: R0–R3, R12, LR, the return PC and xPSR. These are exactly the registers the C calling convention lets a function clobber, which is why a Cortex-M ISR can be an ordinary C function. On return, a special value in LR (\`EXC_RETURN\`) tells the core which stack to pop the frame from and which mode to return to.

**Three system exceptions used by the port:**

| Exception | Raised by | FreeRTOS uses it to |
|---|---|---|
| **SVC** | the \`svc\` instruction | start the very first task |
| **SysTick** | a 24-bit down-counter in the core | generate the tick; it calls the tick handler and, if a switch is needed, pends PendSV |
| **PendSV** | software setting a pending bit | perform the context switch |

PendSV is set to the **lowest** interrupt priority. That is the trick: when an ISR decides a switch is needed it only sets the PendSV pending bit. The switch itself runs after every other active ISR has finished, so a context switch never delays a hardware interrupt and never happens in the middle of one.`,
      { t: 'ascii', caption: 'A task\'s stack at the moment it has been switched out on a Cortex-M4 (no FPU in use). The first eight words were pushed by hardware, the rest by the PendSV handler.',
        text: `higher addresses
  ┌──────────────┐
  │ task's frames │  locals, return addresses of the task's own calls
  ├──────────────┤
  │ xPSR         │ ┐
  │ PC (return)  │ │
  │ LR           │ │ pushed automatically by the core
  │ R12          │ │ on exception entry (8 words = 32 bytes)
  │ R3 R2 R1 R0  │ ┘
  ├──────────────┤
  │ R11 … R4     │ ┐ pushed by the PendSV handler (8 words),
  │ (EXC_RETURN) │ ┘ plus EXC_RETURN on ports with an FPU
  └──────────────┘ ◄ value saved in TCB->pxTopOfStack
lower addresses` },
      { t: 'code', lang: 'c', status: 'pseudo', caption: 'What the Cortex-M PendSV handler does, written as C-like steps. The real handler is a dozen lines of assembly in the port layer.',
        code: C`void PendSV_Handler(void)          /* lowest-priority exception; runs on MSP        */
{
    /* hardware has already pushed R0-R3, R12, LR, PC, xPSR onto the task's PSP stack */
    uint32_t *sp = read_PSP();
    push(sp, R4..R11);             /* the registers hardware did not save           */
    pxCurrentTCB->pxTopOfStack = sp;

    mask_kernel_interrupts();
    vTaskSwitchContext();          /* pxCurrentTCB = highest-priority ready task    */
    unmask_kernel_interrupts();

    sp = pxCurrentTCB->pxTopOfStack;
    pop(sp, R4..R11);
    write_PSP(sp);
    /* exception return: hardware pops R0-R3, R12, LR, PC, xPSR from the NEW task */
}`,
        explain: [
          { lines: '4-6', md: 'The outgoing task is now completely described by one pointer stored in its TCB.' },
          { lines: '9', md: 'The only C function in the switch. It walks the ready lists (and runs the stack-overflow check if enabled).' },
          { lines: '12-15', md: 'Returning from the exception "returns" into a different task than the one that was interrupted. Its PC is whatever was stacked when *it* was last switched out.' },
        ] },
      { t: 'widget', name: 'interrupt-flow', props: { arch: 'cortex-m' }, title: 'Exception entry and return on Cortex-M',
        caption: 'Step through stacking, the vector fetch and the return. A context switch is this sequence with the stack pointer swapped in the middle.' },

      `## Why ISRs get their own stack

If interrupts ran on whichever task stack happened to be current, **every** task stack would need room for the deepest possible nest of ISRs. Ten tasks would pay for it ten times. With a separate interrupt stack you pay once. On Cortex-M the split is free (MSP/PSP). Even so, each task stack must still hold **one hardware exception frame** — the first interrupt that arrives while the task runs is stacked on the task's PSP before the core switches to MSP — plus the software-saved registers when the task is switched out. That is the first puzzle solved: 120 bytes of locals, plus call frames, plus about 64 bytes of saved context (more than 130 bytes extra with the FPU registers) does not fit comfortably in a stack sized for the locals alone.`,

      `## RISC-V in outline

RISC-V (ESP32-C3, ESP32-C6, the second core of the MAX78000) makes the opposite design choice: **the hardware saves almost nothing.** On a trap the core copies the PC into the \`mepc\` CSR, records the cause in \`mcause\`, updates \`mstatus\`, and jumps to the trap vector. Every general-purpose register is saved by software, and the port's trap handler switches to a dedicated interrupt stack by hand. A task asks for a switch with the \`ecall\` instruction (or the port pends a software interrupt), and the tick comes from the machine timer.`,
      { t: 'widget', name: 'interrupt-flow', props: { arch: 'riscv' }, title: 'The same event on RISC-V',
        caption: 'Compare with Cortex-M: CSRs record where to return, and the handler\'s own prologue saves the registers.' },
      `The original ESP32 and the ESP32-S3 use Xtensa cores, whose register-window mechanism makes the saved context larger and the port more involved. You do not need the details to use FreeRTOS on them; you do need to know that their task stacks must be sized generously and measured.`,

      `## Cost

A context switch costs time in three places: saving and restoring registers (a few dozen memory accesses), the scheduler's selection, and — on bigger cores — cache effects. On a Cortex-M it is typically in the range of microseconds; **measure it on your own target** rather than quoting a figure. What matters for design:

- Each tick interrupt costs time even when no switch results. Tick rate × tick cost is a constant tax on the CPU. That is the second puzzle: 10 kHz ticks spend a noticeable fraction of the processor on bookkeeping.
- Every blocking hand-off between tasks costs two switches (out and back). A design that passes single bytes between tasks through a queue pays that per byte.
- A higher tick rate does not make the system "more real-time". Response to events comes from interrupts and priorities, not from the tick.`,
      { t: 'callout', kind: 'mistake', title: 'Raising the tick rate to get precise timing',
        md: `If you need a 250 µs period, do not set the tick to 4 kHz. Use a hardware timer with its own interrupt and, if a task must do the work, wake that task from the timer ISR. The tick is for coarse timeouts and delays.` },
      { t: 'callout', kind: 'decision', title: 'Does this task need the FPU?',
        md: `On a Cortex-M4F, a task that uses floating point has 16 or more extra registers to save. FreeRTOS ports use *lazy stacking* so tasks that never touch the FPU do not pay, but a task that does needs a noticeably larger stack. Using floating point inside an ISR extends the cost to every interrupt entry. Keep float maths in as few tasks as you can and out of ISRs. (On ESP-IDF, check the documentation for FPU use in ISRs on your chip; it is restricted.)` },

      { t: 'predict',
        q: 'On a Cortex-M running FreeRTOS, a UART ISR (priority above the kernel\'s PendSV) gives a semaphore that readies a high-priority task and requests a switch. A timer ISR of even higher priority fires while the UART ISR is still running. In what order do these complete: UART ISR, timer ISR, PendSV (context switch), high-priority task starts?',
        choices: [
          { t: 'Timer ISR, UART ISR, PendSV, then the task.', ok: true, why: 'The timer ISR preempts and finishes first; the UART ISR resumes and finishes; only then is the lowest-priority exception, PendSV, allowed to run; its return lands in the new task.' },
          { t: 'UART ISR, PendSV, the task, then the timer ISR.', why: 'A pending interrupt of higher priority than the running handler is taken at once. It does not wait for a task switch.' },
          { t: 'PendSV immediately, then the task, then both ISRs.', why: 'PendSV has the lowest priority precisely so that it cannot run while any other handler is active.' },
        ],
        reveal: 'All interrupt work finishes before any task-level switching happens. The request for a switch is just a pending bit that waits its turn.' },

      { t: 'exercise',
        prompt: 'A system runs a 1 kHz tick. Suppose you measure the tick interrupt at 4 µs when no switch happens and a full context switch at 12 µs. In the worst case a switch happens on every tick. What percentage of CPU time is spent on tick plus switch overhead?',
        hints: ['Overhead per tick = tick handler + switch.', 'Divide by the tick period (1000 µs).'],
        answer: { type: 'number', value: 1.6, tol: 0.05, unit: '%' },
        solution: '(4 + 12) µs every 1000 µs = **1.6 %**. At a 10 kHz tick the same numbers give 16 % — the "more precise" tick would cost a sixth of the processor. The figures are invented for the exercise; measure your own with a GPIO toggle around the handler.' },

      { t: 'exercise',
        prompt: 'Stack budget. On a Cortex-M4 without FPU use, a task\'s deepest call chain needs 3 nested frames of 48, 96 and 160 bytes. Add one hardware exception frame (32 bytes) and the software-saved context (36 bytes). Then add a 25 % safety margin on top of that total and round up to a multiple of 64 bytes. What stack size in bytes do you allocate?',
        hints: [
          'Sum the frames: 48 + 96 + 160.',
          'Add 32 + 36 for the context.',
          'Multiply by 1.25, then round up to the next multiple of 64.',
        ],
        answer: { type: 'number', value: 512, tol: 0, unit: 'bytes' },
        solution: '48 + 96 + 160 = 304; + 32 + 36 = 372; × 1.25 = 465; rounded up to a multiple of 64 = **512 bytes**. On upstream FreeRTOS you would pass 128 (words); on ESP-IDF, 512 (bytes) — and on an ESP32 this would still be far too small in practice, because the context and library calls are much heavier there. A calculated budget is a starting point; the high-water mark measured under worst-case load is the evidence.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'A product has 8 tasks. A new requirement adds an interrupt handler that calls a signal-processing routine needing 1.5 KB of stack. Compare the RAM cost on (a) a port where ISRs run on the interrupted task\'s stack and (b) a port with a separate interrupt stack. What would you do to the design regardless of the port?',
        hints: ['In (a), which task might be running when the interrupt fires?', 'Is 1.5 KB of work something an ISR should be doing?'],
        solution: '(a) Any of the 8 tasks may be the one interrupted, so all 8 stacks must grow by 1.5 KB: **12 KB**. (b) Only the interrupt stack grows: **1.5 KB**.\n\nRegardless: an ISR that needs 1.5 KB of stack is doing task-level work. Move the processing into a task woken by the ISR (deferred interrupt handling, next lesson). Then exactly one task stack carries the 1.5 KB, the ISR returns in microseconds, and other interrupts are not held off while the maths runs.' },

      { t: 'refs', items: [
        { title: 'Arm: Cortex-M exception model (ARMv7-M Architecture Reference Manual, exception entry and return)', url: 'https://developer.arm.com/documentation', note: 'Search for the ARMv7-M or ARMv6-M Architecture Reference Manual; section on exception entry behaviour.' },
        { title: 'FreeRTOS-Kernel: portable/GCC/ARM_CM4F/port.c (PendSV, SVC and SysTick handlers)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/portable/GCC/ARM_CM4F/port.c' },
        { title: 'RISC-V privileged specification (machine-mode traps, mepc/mcause/mstatus)', url: 'https://github.com/riscv/riscv-isa-manual' },
      ] },
    ],
    quiz: [
      { q: 'On Cortex-M, which registers does the *hardware* push when an exception is taken?', kind: 'arch',
        choices: [
          { t: 'R0–R3, R12, LR, PC and xPSR.', ok: true, why: 'These are the caller-saved registers of the Arm calling convention plus what is needed to resume, which lets handlers be plain C functions.' },
          { t: 'All sixteen core registers.', why: 'R4–R11 are left alone by hardware. A C handler preserves them itself if it uses them, and the RTOS port saves them only when switching tasks.' },
          { t: 'Only the return PC, into a link register.', why: 'Saving only the PC is closer to what RISC-V does (into a CSR). Cortex-M stacks a full eight-word frame.' },
        ] },
      { q: 'Why does FreeRTOS on Cortex-M do the actual switch in PendSV at the lowest interrupt priority?', kind: 'arch',
        choices: [
          { t: 'So the switch runs only after every other interrupt handler has finished.', ok: true, why: 'An ISR just sets a pending bit; the heavier save/restore work waits until no hardware interrupt is active.' },
          { t: 'Because PendSV is the only exception that is allowed to read and write the process stack pointer.', why: 'Any handler can read and write PSP with the appropriate instructions. The choice is about ordering, not access.' },
          { t: 'So that task switches are as fast as possible.', why: 'Lowest priority means it runs last, not fastest. The benefit is that interrupt latency is not increased by switching.' },
        ] },
      { q: 'Tasks run on PSP and handlers on MSP. What is the main RAM benefit?', kind: 'arch',
        choices: [
          { t: 'Worst-case interrupt nesting is budgeted once, not in every task\'s stack.', ok: true, why: 'Only the first exception frame lands on the task stack; everything deeper uses the single main stack.' },
          { t: 'Tasks no longer need stacks of their own.', why: 'Each task still needs a stack for its calls, locals and saved context.' },
          { t: 'The core can then detect every task stack overflow in hardware and raise a fault.', why: 'Two stack pointers do not provide bounds checking. Detection needs stack-limit registers, an MPU region, or the kernel\'s software check.' },
        ] },
      { q: 'How does RISC-V trap entry differ from Cortex-M exception entry?', kind: 'arch',
        choices: [
          { t: 'The hardware saves the return address and cause in CSRs; software must save every general-purpose register.', ok: true, why: 'There is no automatic stack frame, so the trap handler\'s first instructions store the registers it will disturb.' },
          { t: 'RISC-V pushes all 31 general-purpose registers automatically, where Cortex-M pushes only eight.', why: 'It pushes none; the save is entirely the handler\'s job.' },
          { t: 'RISC-V cannot nest interrupts, so its handlers need no stack of their own.', why: 'Nesting is possible but must be arranged by software re-enabling interrupts after saving state.' },
        ] },
      { q: 'A team raises the tick from 100 Hz to 5 kHz to "improve responsiveness to button presses" handled by an interrupt and a semaphore. What actually changes?', kind: 'concept',
        choices: [
          { t: 'Tick overhead rises fifty-fold; the response to the button is unchanged.', ok: true, why: 'The response never depended on the tick: the ISR readies the task and requests a switch immediately. The tick only governs delays and timeouts.' },
          { t: 'The button task now starts within 200 µs of the press instead of within 10 ms.', why: 'That would be true only if the task were found by polling at each tick. An ISR-driven wake-up does not wait for a tick.' },
          { t: 'Nothing measurable changes, since the tick only counts time.', why: 'Something does change: the CPU now services fifty times as many tick interrupts.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 6
  {
    id: 'rtos-interrupts',
    title: 'Interrupt priorities and deferred interrupt handling',
    minutes: 50,
    summary: 'Hardware priority is not task priority. Which kernel calls an ISR may make, how to wake a task from an ISR, and why you should.',
    skills: ['rtos-sk-isr-defer'],
    blocks: [
      `## The problem

A button ISR calls \`xSemaphoreTake(i2c_mutex, portMAX_DELAY)\` so that it can read a port expander over I2C and find out which key was pressed. On the bench it works most of the time. Sometimes the board locks up solid; sometimes it resets with an assertion from deep inside the kernel. The author's defence: "The ISR is the most urgent thing in the system, so it should be allowed to wait for the bus."

An ISR cannot wait for anything. Understanding why requires separating two priority systems that share a word.`,

      `## Two different priority systems

**Interrupt priority** is implemented in hardware by the interrupt controller (the NVIC on Cortex-M). It decides which *handler* runs when several are pending and whether one handler may preempt another.

**Task priority** is a number in a TCB, used by scheduler *software* to choose among ready tasks.

They are not on one scale. The relationship is absolute:

> **Every ISR, even the lowest-priority one, preempts every task, even the highest-priority one.**

The scheduler only gets to choose a task when no handler is active. And an ISR is not a task: it has no TCB, so it cannot be placed on a waiting list, so it **cannot block**. Any API that might block — taking a mutex, waiting on a queue, \`vTaskDelay\`, most \`printf\`/logging paths, anything that allocates — is forbidden in an ISR. In the opening problem, the ISR tries to block on a mutex held by a task; that task can never run to release it because the ISR is in the way.`,
      { t: 'callout', kind: 'warn', title: 'The numbers run in opposite directions on Cortex-M',
        md: `FreeRTOS **task** priorities: a larger number is more urgent. Cortex-M **interrupt** priorities: a *smaller* number is more urgent (0 is the highest). Also, only the top few bits of the 8-bit priority field are implemented — the MSPM0L2228's Cortex-M0+ has 2 priority bits, i.e. 4 levels (as on every Cortex-M0+). Say "logically higher" and "numerically lower" out loud when you configure these.` },

      `## The FromISR API

Kernel functions that are safe in an ISR have names ending in \`FromISR\`. They differ from the task versions in two ways: they **never block** (they return a failure code instead), and instead of switching tasks themselves they **tell you** whether a switch is needed, through an out-parameter usually called \`pxHigherPriorityTaskWoken\`.`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Deferred interrupt handling on ESP-IDF with a direct-to-task notification. Calls checked against the ESP-IDF v6.1 headers; `handle_press()` is your own code. Not compiled as a whole or run on a board here.',
        code: C`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_attr.h"

#define BUTTON_GPIO 27
static void handle_press(void) { /* your application code: may block, log, take a mutex */ }
static TaskHandle_t s_button_task;

static void IRAM_ATTR button_isr(void *arg)
{
    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(s_button_task, &woken);
    portYIELD_FROM_ISR(woken);
}

static void button_task(void *arg)
{
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);     /* sleep until the ISR signals */
        vTaskDelay(pdMS_TO_TICKS(20));               /* let contact bounce settle   */
        ulTaskNotifyTake(pdTRUE, 0);                 /* forget edges seen while bouncing */
        if (gpio_get_level(BUTTON_GPIO) == 0) {
            handle_press();                          /* may block, log, take a mutex */
        }
    }
}

void app_main(void)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    gpio_config(&io);

    xTaskCreate(button_task, "button", 3072, NULL, 10, &s_button_task);

    gpio_install_isr_service(0);
    gpio_isr_handler_add(BUTTON_GPIO, button_isr, NULL);
}`,
        explain: [
          { lines: '10', md: '`IRAM_ATTR` places the handler in internal RAM so it can run even while the flash cache is disabled (during a flash write). ESP-specific; a Cortex-M handler needs no such attribute.' },
          { lines: '12', md: 'Must start as `pdFALSE`. The kernel only ever sets it to `pdTRUE`; it never clears it.' },
          { lines: '13', md: 'Increments the task\'s notification value and, if the task was blocked waiting for it, moves the TCB to its ready list. If that task has a higher priority than the one that was interrupted, `woken` becomes `pdTRUE`.' },
          { lines: '14', md: 'If `woken` is true, requests a context switch so the interrupt returns straight into `button_task` instead of the task that was interrupted. Without this line the woken task waits until the next tick or the next blocking call — up to a whole tick of extra latency.' },
          { lines: '20', md: 'The task is Blocked here and uses no CPU. `pdTRUE` clears the count on exit, so edges that arrived before the task got here collapse into one wake-up.' },
          { lines: '21-22', md: 'A bouncing contact produces more falling edges during the 20 ms wait, and each one sets the notification again. The second take, with a timeout of 0, clears them without blocking. Leave it out and the loop comes round, finds a notification already pending, waits 20 ms, sees the button still held and reports the same press a second time.' },
          { lines: '39-42', md: 'The task is created **before** the interrupt is enabled, so the ISR never uses an uninitialised handle.' },
        ] },
      `This is **[[Deferred interrupt handling]]**: the ISR does only what must happen at interrupt level — acknowledge the hardware, capture volatile data — and hands the rest to a task. The task's *task priority* then decides how soon the rest runs relative to other tasks, which puts the decision back under the scheduler's control. A deferred handler given a high task priority runs immediately after the ISR, almost as if it were part of it, but it is allowed to block.`,
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'isr-defer' }, title: 'ISR, then the task it wakes',
        caption: 'The simulator starts with the deferred handler wrongly placed: Handler has priority 1, below a Worker (priority 2) that never blocks. Run it, then raise Handler above Worker and compare with the trace below.' },
      { t: 'ascii', caption: 'The simulator\'s two outcomes, tick by tick. ! = the ISR (1 tick), H = Handler (2 ticks of work per byte), W = Worker. The interrupt fires at ticks 4, 12, 20 and 28.',
        text: `tick:               0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22

Handler priority 1 (below Worker): the ISR runs, the handling never does
runs:               W  W  W  W  !  W  W  W  W  W  W  W  !  W  W  W  W  W  W  W  !  W  W
  tick 4   ISR preempts Worker, gives the semaphore (count 0 -> 1), returns.
  tick 5   Handler is Ready, but Worker (2) outranks it (1) and never blocks: Worker runs.
  tick 12  ISR gives again. The count is already 1 and cannot go higher: this event is LOST.
  ticks 20, 28: lost again. Handler has not run once.

Handler priority 3 (above Worker): deferred handling as intended
runs:               W  W  W  W  !  H  H  W  W  W  W  W  !  H  H  W  W  W  W  W  !  H  H
  tick 0   Handler is picked first, finds the semaphore empty and Blocks at once
           (the call takes no time in this model), so Worker has the whole tick.
  tick 4   ISR preempts Worker, gives the semaphore: Handler becomes Ready.
  tick 5   On the way out of the ISR the scheduler picks Handler (3 > 2), not Worker.
  ticks 5-6  Handler does its 2 ticks of work, takes the semaphore again and Blocks.
  tick 7   Worker resumes where it was interrupted. Nothing is lost.` },
      `Two lessons in that trace. The ISR always runs at once, whatever the task priorities — but the *work* is done by a task, and a task waits its turn. And a binary semaphore remembers one event, so a handler that falls behind does not just respond late: it loses events. With equal priorities (try Handler = 2) the simulator shows the middle case: Handler gets its turn one tick late, by round-robin.`,
      { t: 'predict',
        q: 'An ISR calls `xSemaphoreGiveFromISR(sem, &woken)` and then returns **without** calling `portYIELD_FROM_ISR(woken)`. The task waiting on the semaphore has the highest priority in the system. The tick is 10 ms. When does that task run?',
        choices: [
          { t: 'At the next tick, or sooner if the interrupted task happens to block or yield first.', ok: true, why: 'The task is on the ready list, but nobody asked for a switch. The interrupt returns to the task it interrupted, and the scheduler only notices at its next opportunity: up to about 10 ms later.' },
          { t: 'Immediately; the kernel always switches when a higher-priority task becomes ready.', why: 'From an ISR the kernel deliberately leaves the switch request to the caller, so that an ISR handling many events can request one switch at the end.' },
          { t: 'Never; the give is lost.', why: 'The semaphore was given and the task was made ready. Nothing is lost — only delayed.' },
        ],
        reveal: 'Forgetting the yield does not break correctness, which is why it survives testing. It shows up as response-time jitter of up to one tick: sometimes fast (when the tick happens to follow), sometimes slow.' },

      `## Which interrupts may call the kernel

FreeRTOS protects its own data structures by masking interrupts briefly. On Cortex-M3/M4/M7 it does not mask *all* of them: it raises the \`BASEPRI\` register to \`configMAX_SYSCALL_INTERRUPT_PRIORITY\`, which masks only interrupts at or below that urgency. This splits your interrupts into two groups:

| Interrupt priority | Masked by kernel critical sections? | May call \`…FromISR\` API? |
|---|---|---|
| logically **at or below** \`configMAX_SYSCALL_INTERRUPT_PRIORITY\` (numerically ≥) | yes, briefly | **yes** |
| logically **above** it (numerically <) | never | **no — never** |

Interrupts above the threshold have zero kernel-induced latency, which is what you want for something like motor commutation. The price is that they must not touch any kernel object, because they can interrupt the kernel halfway through updating a list. On Cortex-M0/M0+ there is no \`BASEPRI\`; the port masks all interrupts in critical sections, so no interrupt escapes the kernel's masking.

A classic bug follows from the reset state: Cortex-M interrupt priorities default to 0, the **highest**. An interrupt you enabled without setting its priority is therefore above the threshold, and its \`FromISR\` call corrupts kernel lists at random. With \`configASSERT\` defined, recent FreeRTOS ports check for this and stop at the offending call.

On ESP32-family chips the equivalent rule is expressed in interrupt *levels*: ordinary C handlers registered through the ESP-IDF interrupt allocator may use the \`FromISR\` API; high-level interrupts have special rules. Check the ESP-IDF "High Priority Interrupts" guide for your chip rather than assuming Cortex-M numbers.`,
      { t: 'callout', kind: 'mistake', title: 'Four ISR bugs that pass a quick test',
        md: `1. **Calling a blocking API** (\`xQueueSend\`, \`xSemaphoreTake\`, \`vTaskDelay\`, \`ESP_LOGI\`/\`printf\`) instead of the \`FromISR\` form.
2. **Giving a mutex from an ISR.** Mutexes have an owner and priority inheritance; an ISR is not a task and cannot own one. Use a binary semaphore or a task notification to signal from an ISR.
3. **Forgetting \`portYIELD_FROM_ISR\`**, adding up to a tick of latency.
4. **Leaving \`woken\` uninitialised.** It is a stack variable; if it happens to be non-zero you request a pointless switch on every interrupt.` },
      { t: 'callout', kind: 'decision', title: 'Notification, semaphore or queue from the ISR?',
        md: `**Task notification** when exactly one known task handles the interrupt and all it needs is "it happened (n times)": fastest, no extra object. **Queue** when the ISR captured data that would otherwise be overwritten (a received byte, a timestamp, an ADC result). **Binary semaphore** when the waiter is not a single fixed task. Use a stream buffer for byte streams from one ISR to one task.` },

      { t: 'exercise',
        prompt: 'Find every defect in this ISR and its setup (there are five). It is meant to pass each received byte to a parser task.',
        code: C`static QueueHandle_t rx_queue;
static SemaphoreHandle_t stats_mutex;
static uint32_t rx_count;

static void IRAM_ATTR uart_rx_isr(void *arg)
{
    BaseType_t woken;
    uint8_t byte = read_rx_register();

    xSemaphoreTake(stats_mutex, portMAX_DELAY);
    rx_count++;
    xSemaphoreGive(stats_mutex);

    xQueueSend(rx_queue, &byte, portMAX_DELAY);
    ESP_LOGI("uart", "got 0x%02x", byte);
}

void app_main(void)
{
    enable_uart_rx_interrupt(uart_rx_isr);
    rx_queue = xQueueCreate(64, sizeof(uint8_t));
    stats_mutex = xSemaphoreCreateMutex();
}`,
        hints: [
          'Go line by line through the ISR and ask: can this call block?',
          'Look at `woken`: how is it initialised and where is it used?',
          'Look at the order of the three lines in `app_main`.',
        ],
        solution: `1. **Mutex taken in an ISR** (line 10): an ISR cannot block and cannot own a mutex. Protect \`rx_count\` with a short critical section, or better, let the parser task count bytes.
2. **\`xQueueSend\` with \`portMAX_DELAY\`** (line 14): blocking API in an ISR. Use \`xQueueSendFromISR(rx_queue, &byte, &woken)\` and decide what to do when it returns \`errQUEUE_FULL\` (count the overrun).
3. **\`woken\` is uninitialised and never used**: initialise to \`pdFALSE\`, pass it to the FromISR call, and finish with \`portYIELD_FROM_ISR(woken)\`.
4. **Logging in an ISR** (line 15): the normal logging macros can block on a lock and take a long time. Remove it (ESP-IDF has \`ESP_EARLY_LOGI\`/\`ESP_DRAM_LOGI\` for debugging only).
5. **Interrupt enabled before the queue exists** (lines 20–22): the first byte makes the ISR use a NULL handle. Create kernel objects first, enable the interrupt last.

Corrected ISR:
\`\`\`c
static void IRAM_ATTR uart_rx_isr(void *arg)
{
    BaseType_t woken = pdFALSE;
    uint8_t byte = read_rx_register();
    if (xQueueSendFromISR(rx_queue, &byte, &woken) != pdTRUE) {
        rx_overruns++;              /* only the ISR writes this */
    }
    portYIELD_FROM_ISR(woken);
}
\`\`\`` },

      { t: 'widget', name: 'c-lab', title: 'Bench-MCU: the ISR captures, the main loop processes',
        props: {
          title: 'Receive in the ISR, process in the loop',
          prompt: `Bench-MCU's UART raises \`IRQ_UART_RX\` when a byte is waiting (enable it with bit 1 of \`UART_CTRL\`). The UART holds received bytes only briefly, so the ISR must move them somewhere safe at once; the slow work (here: converting to upper case and printing) belongs in the main loop.

Complete \`rx_isr\` so that it drains the UART into the ring buffer: while \`UART_STATUS\` has \`UART_RX_AVAIL\` set, read \`UART_DATA\` and store the byte at \`buf[head]\`, then advance \`head\` (wrapping at \`BUF_SIZE\`). If the buffer is full, drop the byte. The ISR must not print.

The main loop is already written: it consumes bytes until it sees a newline. Only the ISR writes \`head\`; only the main loop writes \`tail\`.`,
          starter: C`#include <stdint.h>
#include <stdio.h>

#define BUF_SIZE 16

volatile uint8_t  buf[BUF_SIZE];
volatile uint32_t head = 0;       /* written only by the ISR       */
volatile uint32_t tail = 0;       /* written only by the main loop */

void rx_isr(void) {
    /* TODO: while a byte is available, read it and push it into buf[] */
}

int main(void) {
    int done = 0;
    irq_attach(IRQ_UART_RX, rx_isr);
    UART_CTRL = 3;                /* ENABLE | RX_IRQ_EN */
    irq_enable();

    while (!done) {
        if (head != tail) {
            uint8_t b = buf[tail];
            tail = (tail + 1) % BUF_SIZE;
            if (b == '\n') {
                done = 1;
            } else if (b >= 'a' && b <= 'z') {
                putchar(b - 32);
            } else {
                putchar(b);
            }
        }
    }
    putchar('\n');
    return 0;
}
`,
          solution: C`#include <stdint.h>
#include <stdio.h>

#define BUF_SIZE 16

volatile uint8_t  buf[BUF_SIZE];
volatile uint32_t head = 0;       /* written only by the ISR       */
volatile uint32_t tail = 0;       /* written only by the main loop */

void rx_isr(void) {
    while (UART_STATUS & UART_RX_AVAIL) {
        uint8_t b = (uint8_t)UART_DATA;
        uint32_t next = (head + 1) % BUF_SIZE;
        if (next != tail) {
            buf[head] = b;
            head = next;
        }
    }
}

int main(void) {
    int done = 0;
    irq_attach(IRQ_UART_RX, rx_isr);
    UART_CTRL = 3;                /* ENABLE | RX_IRQ_EN */
    irq_enable();

    while (!done) {
        if (head != tail) {
            uint8_t b = buf[tail];
            tail = (tail + 1) % BUF_SIZE;
            if (b == '\n') {
                done = 1;
            } else if (b >= 'a' && b <= 'z') {
                putchar(b - 32);
            } else {
                putchar(b);
            }
        }
    }
    putchar('\n');
    return 0;
}
`,
          tests: [
            { name: 'echoes one line in upper case', uartRx: 'bench\n', stdout: 'BENCH\n' },
            { name: 'non-letters pass through', uartRx: 'irq 7 ok\n', stdout: 'IRQ 7 OK\n' },
            { name: 'a line longer than the buffer: head must wrap', uartRx: 'deferred interrupt handling wraps\n', stdout: 'DEFERRED INTERRUPT HANDLING WRAPS\n' },
          ],
          hints: [
            'What makes the interrupt request go away, and what happens to an ISR that returns while the request is still there? And once `head` reaches the end of the array, where must the next byte go?',
            'Reading `UART_DATA` pops the byte and is what clears the interrupt condition. An ISR that does not read it will be re-entered forever.',
            'Store first, then advance: `buf[head] = b; head = (head + 1) % BUF_SIZE;` — the main loop treats everything before `head` as valid.',
            'Full means "advancing head would make it equal to tail". In that case read the byte (to clear the interrupt) but do not store it.',
          ],
          explain: 'This is deferred interrupt handling without a kernel. It is safe without disabling interrupts because of a strict ownership rule: one writer per index, and the ISR writes the data byte *before* publishing it by advancing `head`. A FreeRTOS queue or stream buffer filled with `…FromISR` calls is the same structure with blocking added for the consumer.',
        } },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'On a Cortex-M4, `configMAX_SYSCALL_INTERRUPT_PRIORITY` corresponds to priority level 5 (of 0–15, 0 most urgent). A motor encoder interrupt runs at level 2 and currently calls `xQueueSendFromISR` to pass each edge timestamp to a task. The system crashes about once an hour inside the kernel\'s list code. Explain the crash and give two valid redesigns.',
        hints: [
          'Is level 2 logically above or below level 5?',
          'What can a level-2 interrupt interrupt that a level-6 one cannot?',
          'One redesign changes the priority; the other keeps it and avoids the kernel.',
        ],
        solution: 'Level 2 is logically **above** the syscall threshold, so kernel critical sections do not mask it. Occasionally it fires while the kernel is halfway through relinking a list, and its own `xQueueSendFromISR` then walks and modifies the half-updated list.\n\n**Redesign A:** lower the encoder interrupt to level 5 or numerically greater. It may then use the FromISR API, at the cost of being delayed by kernel critical sections (short, bounded).\n\n**Redesign B:** keep level 2 for zero kernel latency, and make the ISR kernel-free: write timestamps into a lock-free single-producer ring buffer (as in the Bench-MCU exercise), and have it pend a second, lower-priority interrupt (at level ≥ 5) whose handler does the `FromISR` notification. The urgent part stays above the kernel; the hand-off happens below the threshold.' },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel — interrupt management chapter (deferred processing, FromISR, xHigherPriorityTaskWoken)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'FreeRTOS-Kernel: ARM_CM4F port (configMAX_SYSCALL_INTERRUPT_PRIORITY and BASEPRI use)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/portable/GCC/ARM_CM4F/port.c' },
        { title: 'ESP-IDF: GPIO driver documentation source (ISR service, handler registration)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/gpio.rst' },
        { title: 'ESP-IDF: High priority interrupts — documentation source', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/hlinterrupts.rst' },
      ] },
    ],
    quiz: [
      { q: 'A system has an ISR at the lowest hardware interrupt priority and a task at the highest task priority. The task is running and the interrupt fires. What happens?', kind: 'concept',
        choices: [
          { t: 'The ISR runs at once; the task resumes when it returns.', ok: true, why: 'Task priority is only compared with other tasks. Any enabled interrupt preempts whatever task is running.' },
          { t: 'The ISR waits until the task blocks, because the task has higher priority.', why: 'The two priorities are different mechanisms. The hardware does not consult the scheduler before taking an interrupt.' },
          { t: 'The scheduler compares the two priorities and picks one.', why: 'The scheduler is software that runs only when asked; the interrupt controller acts before any software has a say.' },
        ] },
      { q: 'What is wrong here?', code: C`static SemaphoreHandle_t spi_mutex;   /* xSemaphoreCreateMutex() */

static void IRAM_ATTR dma_done_isr(void *arg)
{
    BaseType_t woken = pdFALSE;
    xSemaphoreGiveFromISR(spi_mutex, &woken);   /* release the bus for the next user */
    portYIELD_FROM_ISR(woken);
}`, kind: 'code',
        choices: [
          { t: 'An ISR cannot own or release a mutex; the task that took it must give it.', ok: true, why: 'Mutex ownership and priority inheritance are tied to a task. The task that took the mutex should wait for a completion signal from the ISR and then give the mutex itself.' },
          { t: '`woken` must be left uninitialised so that the kernel can tell whether it wrote to it.', why: 'It must be initialised to `pdFALSE`, because the kernel only ever sets it and never clears it.' },
          { t: 'The ISR should call `xSemaphoreGive` instead, since it is not blocking.', why: 'The non-ISR form assumes it is running in a task and may try to switch context directly. Inside a handler only FromISR forms are allowed.' },
        ] },
      { q: 'What does `xHigherPriorityTaskWoken` tell the ISR?', kind: 'code',
        choices: [
          { t: 'That the call readied a task that outranks the interrupted one, so a switch is due.', ok: true, why: 'The kernel reports it and leaves the decision to the ISR, which normally passes it to `portYIELD_FROM_ISR`.' },
          { t: 'That the queue or semaphore operation succeeded and some task received the item.', why: 'Success is the function\'s return value. The out-parameter is about scheduling only.' },
          { t: 'That an interrupt of higher priority became pending while this handler was running.', why: 'Pending interrupts are the interrupt controller\'s business. This flag concerns tasks.' },
        ] },
      { q: 'On a Cortex-M4 FreeRTOS port, an interrupt is configured logically *above* `configMAX_SYSCALL_INTERRUPT_PRIORITY`. Which statement is correct?', kind: 'arch',
        choices: [
          { t: 'It is never delayed by the kernel, and it must not call any FreeRTOS API.', ok: true, why: 'Kernel critical sections leave it unmasked, so it can interrupt the kernel mid-update; touching kernel objects from it corrupts them.' },
          { t: 'It may call the FromISR functions, and they complete sooner because nothing can mask it.', why: 'The FromISR functions rely on not being entered while the kernel is in a critical section, which is exactly what this priority violates.' },
          { t: 'It cannot preempt tasks.', why: 'Every interrupt preempts tasks. The threshold only concerns the relationship between interrupts and kernel critical sections.' },
        ] },
      { q: 'Why is deferring work from an ISR to a high-priority task usually better than doing it in the ISR?', kind: 'arch',
        choices: [
          { t: 'The work may block and use normal APIs, and other interrupts are not held off meanwhile.', ok: true, why: 'The ISR shrinks to a few instructions, and the urgency of the rest is set by a task priority you control, so the scheduler decides how the work competes with other tasks.' },
          { t: 'Code in a task executes faster than the same code in an ISR.', why: 'The CPU runs code at the same speed in both. The gain is in what the code is allowed to do and what it delays.' },
          { t: 'An ISR cannot access global variables, so it cannot do the work itself.', why: 'They can, and that is exactly how data sharing hazards between ISRs and tasks arise.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 7
  {
    id: 'rtos-queues-sems',
    title: 'Queues, semaphores, notifications and event groups',
    minutes: 50,
    summary: 'The kernel objects tasks use to wait for each other, what each one costs, and how to choose.',
    skills: ['rtos-sk-ipc-choose'],
    blocks: [
      `## The problem

A sampling task builds a reading in a local struct and sends its **address** through a queue to a logging task. The logger prints garbage — but only when the system is busy. When you single-step it, the values are right. The queue "works"; the data does not. What was actually sent?`,

      `## Queues copy data

A FreeRTOS [[Queue]] is a fixed-length FIFO of fixed-size items. \`xQueueCreate(length, item_size)\` allocates \`length × item_size\` bytes of storage. \`xQueueSend\` **copies** \`item_size\` bytes from the address you pass into that storage; \`xQueueReceive\` copies them out into the buffer you provide. After the send returns, the sender's variable is irrelevant.

Copying is what makes queues safe: sender and receiver never touch the same memory, so there is nothing to protect. It also means that if the *item* is a pointer, only the pointer is copied — and the opening bug appears: the pointer refers to a local variable on the sender's stack, which the sender reuses as soon as it loops round.

Both operations take a **timeout in ticks**:

| Call | If it cannot proceed now |
|---|---|
| \`xQueueSend(q, &item, ticks)\` on a full queue | caller Blocks until space appears or the timeout expires; returns \`errQUEUE_FULL\` on timeout |
| \`xQueueReceive(q, &buf, ticks)\` on an empty queue | caller Blocks until an item arrives or the timeout expires; returns \`pdFALSE\` on timeout |

A timeout of 0 means "try, do not wait". \`portMAX_DELAY\` means "wait forever". If several tasks are blocked on the same queue, the highest-priority one is served first.`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Producer and consumer exchanging a struct by value. A fragment: `read_adc()`, `process()` and `dropped_samples` are your own; the FreeRTOS calls were checked against the ESP-IDF v6.1 headers.',
        code: C`typedef struct {
    uint32_t timestamp_ms;
    int16_t  raw;
    uint8_t  channel;
} sample_t;

static QueueHandle_t s_samples;

static void producer_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sample_t s = {
            .timestamp_ms = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS),
            .raw = read_adc(),
            .channel = 0,
        };
        if (xQueueSend(s_samples, &s, 0) != pdTRUE) {
            dropped_samples++;                 /* queue full: record it, do not block */
        }
        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));
    }
}

static void consumer_task(void *arg)
{
    sample_t s;
    for (;;) {
        if (xQueueReceive(s_samples, &s, pdMS_TO_TICKS(1000)) == pdTRUE) {
            process(&s);
        } else {
            ESP_LOGW("consumer", "no samples for 1 s");
        }
    }
}

void app_main(void)
{
    s_samples = xQueueCreate(16, sizeof(sample_t));
    configASSERT(s_samples);
    xTaskCreate(consumer_task, "consumer", 4096, NULL, 4, NULL);
    xTaskCreate(producer_task, "producer", 4096, NULL, 6, NULL);
}`,
        explain: [
          { lines: '18', md: 'Copies `sizeof(sample_t)` bytes from the producer\'s stack into the queue\'s storage. Timeout 0: a periodic producer must not have its period stretched by a slow consumer, so it drops and counts instead.' },
          { lines: '29', md: 'The consumer is Blocked here, costing nothing, until the send moves it to the ready list. The 1 s timeout turns "the producer died" from a silent hang into a log line.' },
          { lines: '39-40', md: 'Storage for 16 items is allocated once. Creation can fail if the heap is exhausted; a NULL handle used later crashes somewhere unrelated, so check it here.' },
        ] },
      { t: 'callout', kind: 'mistake', title: 'Sending a pointer to a stack variable',
        md: `\`xQueueSend(q, &ptr_to_local, …)\` copies the *pointer*. By the time the receiver dereferences it, the sender has moved on and that stack memory holds something else. If you must pass large data by reference, the memory must outlive the hand-off: take it from a pool of static buffers, and transfer **ownership** with the pointer — after sending, the sender never touches it again and the receiver returns it to the pool.` },

      `## Semaphores

A semaphore is a counter with blocking. Internally it is a queue whose items have size zero.

- **[[Binary semaphore]]**: count is 0 or 1. Use it to *signal*: one context gives ("it happened"), another takes ("wait until it happens"). Created empty by \`xSemaphoreCreateBinary()\`. Giving twice before a take records only one event.
- **[[Counting semaphore]]**: count from 0 to a maximum. Use it to count events so none are lost (\`xSemaphoreCreateCounting(max, 0)\`), or to guard a pool of N identical resources (\`xSemaphoreCreateCounting(N, N)\`).
- **Mutex**: looks similar in the API but is for *mutual exclusion*, has an owner and priority inheritance, and gets its own lesson.

The usage patterns are different in shape. A signalling semaphore is given by one context and taken by another. A mutex is taken and given by the **same** task around a critical region.`,

      `## Task notifications

Every task has a built-in 32-bit notification value. \`xTaskNotifyGive(handle)\` increments it and wakes the task; \`ulTaskNotifyTake(clear, ticks)\` blocks until it is non-zero and then either clears it (binary-semaphore behaviour) or decrements it (counting behaviour). There are also forms that set bits or overwrite the value.

Notifications need no separate object and are faster than a semaphore. The restrictions: the sender must know **which task** to notify, only that one task can wait, and the sender never blocks (there is no "wait for space").`,

      `## Event groups, stream buffers, message buffers

- An **[[Event group]]** is a word of flag bits. A task can block until *any* or *all* of a set of bits are set (\`xEventGroupWaitBits\`), and one \`xEventGroupSetBits\` can wake several tasks. Use it for conditions like "Wi-Fi connected **and** time synchronised". It carries no data and does not count events. Setting bits from an ISR is deferred to the timer daemon task, so it is not the fastest path.
- A **stream buffer** passes a stream of bytes from one writer to one reader with no per-item overhead — ideal from a UART ISR to a parser task. A **message buffer** is the same thing carrying variable-length discrete messages. Both assume a single writer and a single reader.`,
      { t: 'callout', kind: 'decision', title: 'Choosing the object',
        md: `| You need to… | Use |
|---|---|
| pass data, possibly from several senders | **queue** |
| tell one specific task "go" (from a task or ISR) | **task notification** |
| signal an event to whichever task is waiting | **binary semaphore** |
| count events so that none are lost, or limit access to N resources | **counting semaphore** |
| wait for a combination of conditions, or wake several tasks | **event group** |
| move a byte stream from one ISR/task to one task | **stream buffer** |
| protect shared state | **mutex** (not a semaphore) |

When in doubt, a queue of small structs is the least surprising choice: it carries data, it buffers, and it decouples timing.` },

      { t: 'predict',
        q: 'An ISR fires three times in quick succession while the handler task (waiting on a **binary** semaphore) is busy with the first event. Each ISR gives the semaphore. How many times does the handler task run in total?',
        choices: [
          { t: 'Twice: once for the first event, once for the other two together.', ok: true, why: 'The first give wakes the task. While it is busy, the second give sets the count to 1 and the third finds it already 1 and changes nothing.' },
          { t: 'Three times, once per interrupt, because each give is stored until it is taken.', why: 'A binary semaphore can hold at most one pending give. It records that something happened, not how many times.' },
          { t: 'Once; extra gives are ignored until the task waits again.', why: 'A give that arrives while the task is busy is latched and satisfies its next take.' },
        ],
        reveal: 'If every event needs its own processing, use a counting semaphore, a notification taken with `pdFALSE` (decrement), or a queue. If the handler drains everything pending each time it wakes ("process until the hardware FIFO is empty"), binary is correct and cheaper.' },

      { t: 'exercise',
        prompt: 'Queue sizing. A producer generates 200 items/s during bursts lasting at most 0.5 s; between bursts it is idle for at least 2 s. The consumer processes a steady 120 items/s. What is the minimum queue length (in items) that never overflows?',
        hints: [
          'During a burst the queue fills at (production rate − consumption rate).',
          'Multiply by the burst length.',
          'Check that the idle gap is long enough to drain it.',
        ],
        answer: { type: 'number', value: 40, tol: 0, unit: 'items' },
        solution: 'Net fill rate during a burst: 200 − 120 = 80 items/s. Over 0.5 s: **40 items**. Draining 40 items at 120/s takes 0.33 s, well inside the 2 s gap, so bursts do not stack up. Add margin for consumer jitter (say 48 or 64). If each item is a 16-byte struct, 64 items cost 1024 bytes of heap. Note the precondition: the *average* production rate (100 items per 2.5 s = 40/s) must be below the consumption rate, or no finite queue is enough.' },

      { t: 'exercise',
        prompt: 'This is the bug from the opening problem. Explain precisely what the logger reads, and fix it two ways.',
        code: C`static QueueHandle_t q;       /* xQueueCreate(8, sizeof(reading_t *)) */

static void sampler_task(void *arg)
{
    for (;;) {
        reading_t r;
        r.temp_c10 = read_temp();
        r.tick     = xTaskGetTickCount();
        reading_t *p = &r;
        xQueueSend(q, &p, portMAX_DELAY);
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

static void logger_task(void *arg)     /* lower priority than sampler */
{
    reading_t *p;
    for (;;) {
        xQueueReceive(q, &p, portMAX_DELAY);
        ESP_LOGI("log", "t=%u temp=%d", (unsigned)p->tick, p->temp_c10);
    }
}`,
        hints: [
          'What does the queue storage contain after the send?',
          'Where does `r` live, and what happens to that memory on the next loop iteration?',
          'The logger is lower priority: could several pointers be queued before it runs?',
        ],
        solution: 'The queue holds the *address* of `r`, a local on the sampler\'s stack. Every loop iteration reuses the same address. When the logger is slow, the queue contains several copies of the same pointer, and each dereference reads whatever the sampler has most recently written there — possibly half-way through an update. Single-stepping makes the logger run right after each send, hiding the bug.\n\n**Fix 1 (preferred):** queue the struct by value: `xQueueCreate(8, sizeof(reading_t))`, `xQueueSend(q, &r, …)`, and receive into a `reading_t`.\n\n**Fix 2 (for large items):** allocate each reading from a static pool, send the pointer, and make the logger return the block to the pool. The pointer transfer is then also an ownership transfer.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'A task must wait for whichever happens first: a byte arriving on a UART queue, a button event on a second queue, or a 500 ms timeout to refresh a display. Blocking on one queue ignores the other. Give two designs that avoid polling, and say which you prefer.',
        hints: [
          'Could both sources send into a single queue? What would the item need to contain?',
          'FreeRTOS has an object for blocking on several queues/semaphores at once.',
        ],
        solution: '**Design A — one queue of tagged events.** Define `typedef struct { enum { EV_UART_BYTE, EV_BUTTON } type; uint32_t data; } event_t;` and have both sources send into one queue. The task does `xQueueReceive(events, &ev, pdMS_TO_TICKS(500))`: a received item is dispatched on `type`, a timeout refreshes the display. \n\n**Design B — a queue set.** `xQueueCreateSet`, add both queues, and block on `xQueueSelectFromSet` with the timeout; it returns the handle that has data.\n\nPrefer A. It gives a single ordered stream of events, one place to add a new source, and no special object. Most event-driven tasks end up as "one queue of tagged messages plus a switch", which is a state machine with a mailbox.' },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel — queue management, task notifications, event groups chapters', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'FreeRTOS-Kernel: include/queue.h, semphr.h, event_groups.h, stream_buffer.h (API contracts)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel/tree/main/include' },
      ] },
    ],
    quiz: [
      { q: '`xQueueCreate(10, sizeof(msg_t))` where `msg_t` is 24 bytes. A task sends a `msg_t` and then immediately overwrites its local copy. What does the receiver get?', kind: 'code',
        choices: [
          { t: 'The original contents; the queue stored its own 24-byte copy at send time.', ok: true, why: 'Queue storage is separate memory, filled by a copy during the send call.' },
          { t: 'The overwritten contents, because the queue stores a reference to the sender\'s variable.', why: 'A FreeRTOS queue never keeps a reference to the sender\'s variable unless the item you chose to send is itself a pointer.' },
          { t: 'Undefined data, because the sender must keep the variable alive.', why: 'Lifetime only matters for what a queued pointer points at. A by-value item is complete inside the queue.' },
        ] },
      { q: 'Which object fits: "an ISR must tell one particular task that a DMA transfer finished"?', kind: 'arch',
        choices: [
          { t: 'A direct-to-task notification.', ok: true, why: 'One known receiver, no data beyond "done", and it is the lightest mechanism with a FromISR form.' },
          { t: 'A mutex given from the ISR.', why: 'A mutex is for exclusion and is tied to an owning task; it is not a signalling device and has no place in an ISR.' },
          { t: 'An event group, because it is the most flexible.', why: 'Setting event bits from an ISR is deferred through the timer task, adding latency and a dependency for no benefit here.' },
        ] },
      { q: 'A producer at priority 6 calls `xQueueSend(q, &x, portMAX_DELAY)`; the consumer at priority 3 is slow and the queue is full. What happens to the producer?', kind: 'concept',
        choices: [
          { t: 'It blocks until the consumer removes an item.', ok: true, why: 'A blocking send on a full queue is back-pressure: the producer\'s rate is throttled to the consumer\'s, whatever their priorities.' },
          { t: 'The send succeeds and the oldest item in the queue is overwritten.', why: 'Overwriting only happens with the dedicated overwrite call on a length-one queue. A normal send never discards data.' },
          { t: 'It preempts the consumer and empties the queue itself.', why: 'A task blocked on a full queue is not running at all; only the consumer can make space.' },
        ] },
      { q: 'What distinguishes a counting semaphore from a binary one in an interrupt-signalling role?', kind: 'concept',
        choices: [
          { t: 'It remembers how many gives happened, so a burst of interrupts is not collapsed into one wake-up.', ok: true, why: 'Each give increments the count up to the maximum, and each take consumes one, so a burst of interrupts is not collapsed into a single wake-up.' },
          { t: 'It has a FromISR give function, while a binary semaphore can only be given from a task.', why: 'Both have FromISR give functions. The difference is in how many pending events they can hold.' },
          { t: 'It raises the handler task\'s priority while events are pending.', why: 'No semaphore changes anybody\'s priority. Priority inheritance exists only in mutexes, and it concerns the holder of a lock, not a handler of events.' },
        ] },
      { q: 'A task needs to proceed only when both "network up" and "config loaded" are true; each is reported by a different task. Best fit?', kind: 'arch',
        choices: [
          { t: 'An event group, waiting for both bits.', ok: true, why: 'Waiting for a combination of conditions set by different sources is exactly what `xEventGroupWaitBits` with wait-for-all does.' },
          { t: 'Two binary semaphores taken one after the other.', why: 'It can work, but the task blocks on them in a fixed order and the semaphores are consumed, so a third task interested in the same conditions cannot also wait.' },
          { t: 'Polling two global flags every 10 ms.', why: 'Polling wakes the CPU needlessly, adds latency, and shares unprotected state when a blocking primitive exists for the purpose.' },
        ] },
      { q: 'Why is a stream buffer a better choice than a queue of single bytes for UART reception at 115200 baud?', kind: 'arch',
        choices: [
          { t: 'The reader can be woken once for a batch of bytes instead of once per byte.', ok: true, why: 'A queue of bytes costs a queue operation, and possibly a context switch, per byte. Stream buffers have a trigger level and no per-item bookkeeping, which suits a continuous byte stream from one writer to one reader.' },
          { t: 'A queue cannot be written from an ISR, and a stream buffer can.', why: 'Queues have a FromISR send. The issue is overhead per item, not permission.' },
          { t: 'A stream buffer lets several parser tasks read the same bytes without a lock.', why: 'They are designed for exactly one writer and one reader; more needs external locking.' },
        ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 8
  {
    id: 'rtos-races',
    title: 'Race conditions and critical sections',
    minutes: 55,
    summary: 'How shared state goes wrong — lost updates, torn reads, check-then-act — and the three tools for making a sequence indivisible, with their costs.',
    skills: ['rtos-sk-race-find', 'rtos-sk-critical'],
    blocks: [
      `## The problem

A flow meter counts pulses in an ISR (\`pulses++\`) and a task subtracts the amount it has reported (\`pulses -= reported\`). Over a day the total is short by a few dozen pulses out of millions. No crash, no assertion, and the bug disappears when you add logging. Tests pass. The code is two lines.

This is a [[Race condition]]: the result depends on the exact interleaving of two execution contexts. It is the defining bug class of concurrent firmware, and it cannot be found reliably by testing. It has to be found by reading the code with the right questions.`,

      `## Shared state and atomicity

Data is **shared** if more than one execution context (task, ISR, or — on a dual-core chip — core) can access it and at least one of them writes. An operation is **[[Atomic]]** with respect to another context if that context can never observe or interrupt it part-way.

Almost nothing in C is atomic. \`pulses++\` compiles to three steps:`,
      { t: 'ascii', caption: 'A lost update. The ISR\'s increment is overwritten because the task had already loaded the old value.',
        text: `task:   pulses -= reported;            ISR:   pulses++;

 task   LOAD  r0 ← pulses      (r0 = 100)
 task   SUB   r0 ← r0 - 40     (r0 = 60)
   ── interrupt ──────────────────────────────
   ISR  LOAD  r1 ← pulses      (r1 = 100)
   ISR  ADD   r1 ← r1 + 1      (r1 = 101)
   ISR  STORE pulses ← r1      (pulses = 101)
   ── return ─────────────────────────────────
 task   STORE pulses ← r0      (pulses = 60)   ← the pulse is gone` },
      `The window is two instructions wide — well under a microsecond — and it is only hit when an interrupt lands inside it. That is why the failure is rare, why it vanishes when timing shifts, and why "it passed a week of soak testing" proves nothing.`,
      { t: 'ascii', caption: 'The same failure in the form the simulator below uses: two tasks each run counter++ once, starting from 0. One order of the six steps that loses an update.',
        text: `step  who     does               A's r0   B's r0   counter
 1    Task A  LOAD  r0 <- counter    0        -         0
 2    Task B  LOAD  r0 <- counter    0        0         0     <- B reads before A has stored
 3    Task B  ADD   r0 <- r0 + 1     0        1         0
 4    Task B  STORE counter <- r0    0        1         1
 5    Task A  ADD   r0 <- r0 + 1     1        1         1
 6    Task A  STORE counter <- r0    1        1         1     <- A overwrites 1 with 1

Two increments ran; counter is 1. Any order in which the second LOAD comes before
the first STORE gives this result. Only "A completely, then B" (or B then A) gives 2.` },
      { t: 'widget', name: 'race-condition', props: { scenario: 'counter' }, title: 'Make an update disappear',
        caption: 'Interleave the load/add/store steps of two contexts by hand until the final count is wrong. Then enable the critical section and try again.' },

      `## Three shapes of race

**1. Read-modify-write (lost update).** Any \`x++\`, \`x |= bit\`, \`x = x + n\`, including on hardware registers: two contexts doing \`GPIO_OUT |= mask\` on different pins of the same port can undo each other. That is why MCUs provide write-only SET/CLR/TOGGLE registers — a single store cannot be split.

**2. Torn read or write of multi-word data.** A 64-bit timestamp on a 32-bit MCU takes two loads. If an ISR increments it between them, the reader combines the old high word with the new low word. The same applies to any struct: a reader can observe field A from one update and field B from the previous one. Each individual access may be atomic while the *group* is not.

**3. Check-then-act.** \`if (count < MAX) { buf[count++] = x; }\` or \`if (!busy) { busy = true; … }\`. The check was true when made; by the time the action happens another context has changed the state. Both contexts pass the check and both act.`,
      { t: 'widget', name: 'race-condition', props: { scenario: 'check-then-act' }, title: 'Two contexts both pass the check',
        caption: 'Find the interleaving in which both contexts see the flag clear and both proceed.' },
      { t: 'predict',
        q: 'On a 32-bit MCU, a timer ISR does `uptime_ms++` on a `volatile uint64_t`. A task reads it with `uint64_t now = uptime_ms;`. The value is currently `0x00000000_FFFFFFFF`. The task reads the low word, then the interrupt fires, then the task reads the high word. What does the task get?',
        choices: [
          { t: '`0x00000001_FFFFFFFF` — about 49.7 days in the future.', ok: true, why: 'Low word read before the increment (0xFFFFFFFF), high word after it carried (0x00000001). Neither the old value nor the new one.' },
          { t: '`0x00000000_FFFFFFFF`, the value before the interrupt.', why: 'Only the low half came from the old value. The high half was read after the ISR had carried into it.' },
          { t: '`0x00000001_00000000`, the value after the interrupt.', why: 'Only the high half came from the new value. The low half was read before the ISR ran.' },
        ],
        reveal: 'A torn read produces a value that never existed. `volatile` does not help: it guarantees the reads happen, not that they happen together. The classic lock-free fix for a counter like this is to read twice and retry until the two reads agree; the general fix is a critical section around the read.' },

      `## How to find races by reading

For every variable that is not local to one function, ask:

1. **Who touches it?** List every task and ISR (and remember both cores).
2. **Does anyone write?** If all are readers, there is no race.
3. **Is each access a single indivisible step for the data involved?** Any read-modify-write, any multi-word value, any group of fields that must be consistent, any check followed by an action, is a "no".
4. **Could another toucher run in the middle?** An ISR can always interrupt a task. A higher-priority task can preempt a lower one. On two cores, anything can run alongside anything.

If the answers are "more than one", "yes", "no", "yes", you need protection — or a redesign that removes the sharing.`,

      `## Tool 1: disable interrupts (critical section)

\`taskENTER_CRITICAL()\` … \`taskEXIT_CRITICAL()\` masks interrupts (up to the kernel's syscall threshold on Cortex-M3/4) so that neither an ISR nor a context switch can occur in between. The calls nest. It is the **only** tool that protects against an ISR, and the cheapest — a couple of instructions. The cost falls on everyone else: every masked interrupt is delayed by the length of the section. So critical sections must be **short and of bounded length**: a few assignments, never a loop over a variable-length buffer, never a function call you have not read, never anything that blocks.

On ESP-IDF, the macros take a spinlock argument. Masking interrupts stops the current core only; the spinlock keeps the *other* core out.`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'A critical section on ESP-IDF protecting data shared between a task and an ISR. Macros and types checked against the ESP-IDF v6.1 FreeRTOS port headers.',
        code: C`static portMUX_TYPE s_pulse_lock = portMUX_INITIALIZER_UNLOCKED;
static uint32_t s_pulses;                 /* shared: ISR increments, task consumes */

static void IRAM_ATTR pulse_isr(void *arg)
{
    portENTER_CRITICAL_ISR(&s_pulse_lock);
    s_pulses++;
    portEXIT_CRITICAL_ISR(&s_pulse_lock);
}

static uint32_t take_pulses(void)         /* called from a task */
{
    uint32_t n;
    taskENTER_CRITICAL(&s_pulse_lock);
    n = s_pulses;
    s_pulses = 0;
    taskEXIT_CRITICAL(&s_pulse_lock);
    return n;                             /* slow work happens outside the lock */
}`,
        explain: [
          { lines: '1', md: 'A spinlock is one small structure in RAM. Use a separate lock per independent piece of data so that unrelated critical sections do not contend.' },
          { lines: '6-8', md: 'In the ISR, interrupts on this core are already restricted, but the other core could be inside `take_pulses()` at the same moment. The spinlock makes this core wait (spin) for those few instructions to finish.' },
          { lines: '14-17', md: 'Interrupts on this core are masked and the spinlock is held for exactly two assignments. The read-and-clear is now indivisible with respect to the ISR and to the other core.' },
          { lines: '18', md: 'The design point: take a consistent snapshot inside the lock, then work on the private copy with interrupts enabled.' },
        ] },
      { t: 'callout', kind: 'mistake', title: 'The unbounded critical section',
        md: `\`taskENTER_CRITICAL(); for (i = 0; i < len; i++) send_byte(buf[i]); taskEXIT_CRITICAL();\` — interrupts are off for as long as it takes to send \`len\` bytes. Ticks are lost, UART receive overruns, and the worst-case interrupt latency of the whole system is now set by a buffer length. On ESP-IDF, calling a blocking function or holding a critical section too long triggers the interrupt watchdog. Rule: nothing inside a critical section whose duration you cannot state in instructions.` },

      `## Tool 2: suspend the scheduler

\`vTaskSuspendAll()\` … \`xTaskResumeAll()\` stops task switching but leaves interrupts enabled. It protects against **other tasks only**, not ISRs, and it may last longer than a critical section without hurting interrupt latency. While it is in force the current task must not call anything that could block. It delays *every* other task, including more urgent ones, so it is only right for moderately long task-only sequences. On ESP-IDF's dual-core kernel it only suspends scheduling on the calling core, so it does **not** provide mutual exclusion against a task on the other core — on ESP32, prefer a mutex.

## Tool 3: a mutex

A mutex makes only the tasks that want *the same resource* wait; everyone else, and all interrupts, carry on. It is the right tool for anything long or blocking (a bus transaction, a file write). It costs more per use, cannot be used from an ISR, and brings its own hazards (next lessons).`,
      { t: 'callout', kind: 'decision', title: 'Which protection?',
        md: `| Situation | Use | Why not the others |
|---|---|---|
| shared with an ISR; a few instructions | **critical section** | a mutex cannot be used in an ISR; scheduler suspension does not stop ISRs |
| shared between tasks; a few instructions | **critical section** | cheapest; the delay to interrupts is negligible |
| shared between tasks; long or calls into a driver | **mutex** | a critical section would stall interrupts; suspension stalls urgent tasks |
| shared between tasks on a single core; medium length, no blocking | scheduler suspension (rarely) | — |
| can be restructured | **no sharing**: one owner task plus a queue | nothing to protect at all |

Prefer the last row. The best critical section is the one a design made unnecessary.` },

      { t: 'widget', name: 'c-lab', title: 'Bench-MCU: find and fix a lost update',
        props: {
          title: 'Lost update between main code and an ISR',
          prompt: `The timer ISR and the main loop both add to \`shared\`. Each also keeps a private count of how many times it ran, so at the end \`shared\` should equal \`main_runs + isr_runs\`. Run the starter: some updates are lost, because the main loop's update is split across three statements and the ISR can run between them.

Make the main loop's update indivisible with \`irq_disable()\` / \`irq_enable()\`. Keep the protected region as short as possible — only the three statements that touch \`shared\`. The program must print \`lost=0\`.

Keep the update as three statements. They stand for the three machine instructions (load, add, store) that a real compiler emits for \`shared = shared + 1\`. Bench-MCU only lets an interrupt in *between statements*, so writing the update as one statement would hide the bug in this simulator without fixing it on any real processor.`,
          starter: C`#include <stdint.h>
#include <stdio.h>

volatile uint32_t shared = 0;
volatile uint32_t isr_runs = 0;

void timer_isr(void) {
    TIM_STATUS = 1;
    shared = shared + 1;
    isr_runs = isr_runs + 1;
}

int main(void) {
    uint32_t main_runs = 0;
    uint32_t tmp;

    irq_attach(IRQ_TIMER, timer_isr);
    TIM_LOAD = 11;
    TIM_CTRL = 7;                 /* ENABLE | AUTO_RELOAD | IRQ_EN */
    irq_enable();

    while (main_runs < 300) {
        tmp = shared;             /* load   */
        tmp = tmp + 1;            /* modify */
        shared = tmp;             /* store  */
        main_runs++;
    }

    irq_disable();
    TIM_CTRL = 0;
    printf("lost=%u\n", main_runs + isr_runs - shared);
    printf("isr %s\n", isr_runs > 0 ? "ran" : "never ran");
    return 0;
}
`,
          solution: C`#include <stdint.h>
#include <stdio.h>

volatile uint32_t shared = 0;
volatile uint32_t isr_runs = 0;

void timer_isr(void) {
    TIM_STATUS = 1;
    shared = shared + 1;
    isr_runs = isr_runs + 1;
}

int main(void) {
    uint32_t main_runs = 0;
    uint32_t tmp;

    irq_attach(IRQ_TIMER, timer_isr);
    TIM_LOAD = 11;
    TIM_CTRL = 7;                 /* ENABLE | AUTO_RELOAD | IRQ_EN */
    irq_enable();

    while (main_runs < 300) {
        irq_disable();
        tmp = shared;             /* load   */
        tmp = tmp + 1;            /* modify */
        shared = tmp;             /* store  */
        irq_enable();
        main_runs++;
    }

    irq_disable();
    TIM_CTRL = 0;
    printf("lost=%u\n", main_runs + isr_runs - shared);
    printf("isr %s\n", isr_runs > 0 ? "ran" : "never ran");
    return 0;
}
`,
          tests: [
            { name: 'no update is lost and the ISR really ran', stdout: 'lost=0\nisr ran\n' },
          ],
          hints: [
            'Which three statements form the read-modify-write? The ISR must not run between the first and the last of them.',
            'Put `irq_disable();` before `tmp = shared;` and `irq_enable();` after `shared = tmp;`.',
            'Do not disable interrupts around the whole `while` loop: the ISR would never run, and "isr never ran" fails the test. A pending timer interrupt is taken as soon as you re-enable.',
          ],
          explain: 'With interrupts masked for three statements, the ISR is delayed by at most those three statements and then runs: nothing is lost on either side. On a real MCU you would save and restore the previous interrupt state instead of unconditionally enabling, so the function is safe to call from code that already has interrupts off — that is what `taskENTER_CRITICAL` nesting does for you.',
        } },

      { t: 'exercise',
        prompt: 'Read this ESP-IDF code. `settings` is written by a network task and read by a control task. Identify the race, name its shape, and fix it without holding a lock while `apply()` runs.',
        code: C`typedef struct { int32_t kp, ki, kd; uint32_t version; } pid_cfg_t;
static pid_cfg_t settings;

/* network task */
void on_new_config(const pid_cfg_t *in)
{
    settings.kp = in->kp;
    settings.ki = in->ki;
    settings.kd = in->kd;
    settings.version++;
}

/* control task, every 1 ms */
void control_step(void)
{
    apply(settings.kp, settings.ki, settings.kd);   /* takes ~200 us */
}`,
        hints: [
          'Can the control task run between two of the assignments in `on_new_config`?',
          'What set of gains would it use then? Did anyone ever intend that set?',
          'Copy the struct to a local inside a short protected region, then use the local.',
        ],
        solution: 'A **torn update of multi-field data**: the control task can run (by preemption or on the other core) after `kp` is written but before `ki`/`kd`, and compute with a mixture of new and old gains that was never a valid configuration — potentially an unstable controller for one step.\n\nFix: snapshot under a short critical section, compute outside it.\n```c\nstatic portMUX_TYPE cfg_lock = portMUX_INITIALIZER_UNLOCKED;\n\nvoid on_new_config(const pid_cfg_t *in)\n{\n    taskENTER_CRITICAL(&cfg_lock);\n    settings.kp = in->kp; settings.ki = in->ki; settings.kd = in->kd;\n    settings.version++;\n    taskEXIT_CRITICAL(&cfg_lock);\n}\n\nvoid control_step(void)\n{\n    pid_cfg_t c;\n    taskENTER_CRITICAL(&cfg_lock);\n    c = settings;                 /* 16-byte copy: bounded and tiny */\n    taskEXIT_CRITICAL(&cfg_lock);\n    apply(c.kp, c.ki, c.kd);      /* 200 us of work with no lock held */\n}\n```\nA mutex would also be correct; the critical section is chosen because the protected region is four words. Alternatively the network task could send whole `pid_cfg_t` values through a length-1 queue, which removes the shared variable.' },

      `## A harder case`,
      { t: 'exercise',
        prompt: 'A driver guards a one-at-a-time flash operation like this, called from several tasks: `if (!flash_busy) { flash_busy = true; start_erase(); }`. A reviewer changes `flash_busy` to `volatile` and declares it fixed. Explain why it is not, and what a correct version looks like. Then: the erase takes 40 ms — should the protection be held for the whole erase?',
        hints: [
          'Which of the three race shapes is this?',
          'What must be indivisible: the test, the set, or both together?',
          'There are two different things to protect: the decision to start, and the flash itself for 40 ms.',
        ],
        solution: 'It is **check-then-act**. Two tasks can both evaluate `!flash_busy` as true before either sets it; `volatile` forces each read to be real but does not join the test to the set. Both then start an erase.\n\nThe test-and-set must be one indivisible step:\n```c\nbool claimed = false;\ntaskENTER_CRITICAL(&lock);\nif (!flash_busy) { flash_busy = true; claimed = true; }\ntaskEXIT_CRITICAL(&lock);\nif (claimed) { start_erase(); /* ... */ }\n```\nThe critical section covers only the decision (a few instructions). It must **not** be held for the 40 ms erase — that would block interrupts for 40 ms. The `flash_busy` flag is what keeps other tasks out during the erase. In practice this pattern is exactly what a mutex is: `xSemaphoreTake(flash_mutex, timeout)` performs the atomic claim, lets waiters sleep instead of failing, and adds priority inheritance.' },

      { t: 'refs', items: [
        { title: 'Mastering the FreeRTOS Real Time Kernel — resource management chapter (critical sections, scheduler suspension, mutexes)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book' },
        { title: 'ESP-IDF: FreeRTOS (IDF) — critical sections and spinlocks, documentation source', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/system/freertos_idf.rst' },
      ] },
    ],
    quiz: [
      { q: 'Two tasks on a single core run `flags |= 0x01` and `flags |= 0x02` on the same global. What is the hazard?', kind: 'code',
        choices: [
          { t: 'A preemption between load and store lets one task write back a word without the other\'s bit.', ok: true, why: 'Each statement is load, OR, store. They touch different bits but the same word, and the store rewrites the whole word from a stale copy.' },
          { t: 'None: the tasks modify different bits, and a write to one bit cannot disturb another.', why: 'The CPU cannot store a single bit of an ordinary variable. Each statement rewrites all the bits of the word.' },
          { t: 'The compiler rejects a global that two tasks write unless it is declared `volatile`.', why: 'It compiles without complaint. C has no built-in notion of which contexts share a variable.' },
        ] },
      { q: 'Which of these can be protected **only** by a critical section (masking interrupts), not by a mutex?', kind: 'concept',
        choices: [
          { t: 'A counter incremented in an ISR and read-and-cleared by a task.', ok: true, why: 'An ISR cannot take a mutex. The task must briefly prevent the ISR from running at all.' },
          { t: 'An I2C bus used by three tasks, each for multi-byte transactions.', why: 'No ISR is contending and the operation is long and blocking, which is the classic case for a mutex.' },
          { t: 'A log file on an SD card that two tasks append lines to.', why: 'Both contenders are tasks and the write is slow. Masking interrupts for the duration would wreck interrupt latency.' },
        ] },
      { q: 'Why does ESP-IDF\'s `taskENTER_CRITICAL` take a spinlock argument when upstream single-core FreeRTOS does not?', kind: 'arch',
        choices: [
          { t: 'Masking interrupts stops only the calling core; the spinlock keeps code on the other core out of the same section.', ok: true, why: 'On one core, "nothing can interrupt me" implies exclusivity. On two cores it does not.' },
          { t: 'To record which task owns the section, so that the kernel can apply priority inheritance to it.', why: 'Critical sections have no ownership or inheritance. That belongs to mutexes.' },
          { t: 'Because interrupts cannot be disabled on an ESP32, so a lock is used in their place.', why: 'They can be and are; the spinlock is in addition to masking interrupts on the calling core.' },
        ] },
      { q: 'A reviewer sees `if (queue_count < QUEUE_MAX) { queue[queue_count] = item; queue_count++; }` called from two tasks. What is the worst outcome?', kind: 'code',
        choices: [
          { t: 'Both pass the check at `QUEUE_MAX - 1`; one writes past the end of the array.', ok: true, why: 'Check-then-act: after the first increments the count to the maximum, the second still acts on its stale check and writes one element out of bounds.' },
          { t: 'One of the two items is held back and stored by the next call to the function.', why: 'Nothing is retried. The interleaving corrupts state rather than postponing work.' },
          { t: 'Nothing: each of the three statements is atomic on a 32-bit MCU, so the sequence is safe.', why: 'Even if each statement were atomic, the correctness depends on the check still being true when the write happens.' },
        ] },
      { q: 'What limits how long a critical section may be?', kind: 'concept',
        choices: [
          { t: 'It adds its full length to the worst-case latency of every interrupt it masks.', ok: true, why: 'While interrupts are masked, pending ones wait. A long section can overrun a UART FIFO or lose ticks.' },
          { t: 'The kernel forcibly ends it at the next tick interrupt, so it can last at most one tick.', why: 'Nothing ends it for you; with interrupts masked the tick itself cannot run.' },
          { t: 'Only one may exist in a program.', why: 'There can be as many as needed. The constraint is on duration, not number.' },
        ] },
      { q: 'On a dual-core ESP32, a task calls `vTaskSuspendAll()` and then updates a struct that a task pinned to the other core also reads. Is the update protected?', kind: 'arch',
        choices: [
          { t: 'No. Scheduling is suspended on the calling core only; the other core carries on.', ok: true, why: 'In ESP-IDF FreeRTOS the suspension is per core: the task on the other core keeps running, so there is no exclusion against it.' },
          { t: 'Yes: all task switching stops on both cores until `xTaskResumeAll()`.', why: 'That is upstream single-core behaviour. The ESP-IDF dual-core kernel documents a per-core effect.' },
          { t: 'Yes, because it also masks interrupts on both cores.', why: 'Scheduler suspension leaves interrupts enabled, by design, on any port — and masking interrupts would not stop a task that is already running on the other core.' },
        ] },
    ],
  },
];

export default { lessons };
