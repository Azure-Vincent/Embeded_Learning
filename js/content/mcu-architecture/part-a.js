// Microcontroller architecture, part A: what an MCU is, CPU execution, memory-mapped registers, memory types.
const R = String.raw;

export default [
  // ───────────────────────────────────────────────────────────────── 1
  {
    id: 'mcu-what-is-mcu',
    title: 'Microcontrollers, microprocessors, SoCs and modules',
    minutes: 30,
    summary: 'What is inside the black rectangle, and why the answer decides how much board you have to design around it.',
    skills: ['mcu-sk-classify'],
    blocks: [
      `## The problem

You are handed a parts list for a battery-powered door sensor. One candidate is "ESP32-WROOM-32E", another is
"MSPM0L2228", a third is a "Cortex-A53 applications processor". All three "run code". Which of them can you solder
down next to a battery and a reed switch and expect to work, and which needs a dozen supporting chips first?

You cannot answer from the name of the CPU. You have to know what else is in the package.`,

      `## Theory: it is about what is integrated

A **CPU core** executes instructions. On its own it can do nothing useful: it needs somewhere to fetch
instructions from, somewhere to keep variables, a clock, and a way to touch the outside world.

| Term | What is in the package | What you add on the board |
|---|---|---|
| **Microprocessor (MPU)** | CPU core(s), caches, usually an MMU. No program memory, little or no RAM | External RAM (DDR), external boot flash, several power rails with sequencing, a crystal. Usually runs Linux or another full OS |
| **Microcontroller (MCU)** | CPU, flash, SRAM, clock sources, reset circuit, GPIO, timers, serial interfaces, ADC, all on one die | Decoupling capacitors, maybe a crystal, a debug header |
| **System on chip (SoC)** | A loose word for "a CPU plus most of a system on one die". An MCU is a small SoC; the term is normally used when something large is integrated, such as a radio or a neural-network accelerator | Depends: the original ESP32 chip still needs external flash, a crystal and an antenna network |
| **Module** | A small PCB carrying an SoC plus the parts it cannot work without, under a metal shield, sold as one component | Power, and your own circuit |

The practical differences that follow from integration:

- **Where code lives.** An MCU executes from its own flash at a fixed address the moment reset is released. An MPU
  runs a boot ROM that must find, load and often decompress code from external storage into RAM first.
- **Memory protection.** MPUs have a memory management unit (MMU): each process gets its own virtual address space.
  Most MCUs have no MMU. Every pointer in your firmware is a physical address, and a wild pointer can write to any
  RAM or any peripheral. Some MCUs have a simpler *memory protection unit* (MPU, confusingly the same letters),
  covered in the Cortex-M lesson.
- **Timing.** With no OS paging and no deep caches, an MCU's response to an event is predictable to within a few
  clock cycles. That predictability is why MCUs control motors and MPUs do not.
- **Power.** An MCU can sleep at microamps and wake in microseconds. An MPU with DDR RAM cannot.`,

      { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'generic' }, title: 'A generic microcontroller',
        caption: 'Click each block. Before reading the explanation, say out loud what would stop working if that block were removed.' },

      `## On real hardware: the three course platforms

**ESP32-WROOM module.** The ESP32 *chip* contains two Xtensa CPU cores, RAM, a mask ROM, radio, and peripherals, but
**no program flash**. The WROOM *module* is a small PCB that adds an SPI flash chip, a crystal (typically 40 MHz), the RF matching
network and a PCB antenna under a shield can. On the original ESP32, GPIO6–11 are normally wired to that flash inside
the module, which is why you must not use them. So an ESP32-WROOM is: a module, containing an SoC, which behaves like
an MCU once the flash is attached. A development board (DevKitC and similar) is a third layer: module plus USB-to-UART
bridge, regulator and buttons.

**MAX78000.** A single-die MCU: Arm Cortex-M4 with FPU, 512 KB flash at \`0x1000_0000\`, 128 KB SRAM at
\`0x2000_0000\`, plus a second, RISC-V core and a convolutional neural-network accelerator. The MAX78000FTHR board
adds a debug adapter (a MAX32625PICO presenting as a DAPLink drive), LEDs and buttons.

**MSPM0L2228.** A single-die MCU: Arm Cortex-M0+, 256 KB flash at \`0x0000_0000\`, 32 KB SRAM at \`0x2020_0000\`,
with an LCD controller and security peripherals (AES, TRNG, key store). The evaluation board is the LP-MSPM0L2228.`,

      { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'esp32' }, title: 'ESP32',
        caption: 'Find the flash. Is it inside the chip boundary or outside it?' },
      { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'max78000' }, title: 'MAX78000',
        caption: 'Two different CPU architectures share one bus and one set of peripherals.' },
      { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'mspm0l2228' }, title: 'MSPM0L2228' },

      `## Worked example: reading a part's first page

A datasheet's first page lists features. Train yourself to sort every line into five bins:

1. **Core**: architecture, maximum clock, FPU/MPU present?
2. **Memory**: flash size, RAM size, any ROM, any one-time-programmable memory.
3. **Clocks and power**: internal oscillators, crystal pins, supply range, sleep currents.
4. **Peripherals**: counts of UART/I2C/SPI/timers/ADC channels, anything unusual.
5. **Debug and boot**: SWD or JTAG, ROM bootloader interfaces.

For the MSPM0L2228, the device header in TI's SDK already tells you most of it: Cortex-M0+, MPU present, 2 interrupt
priority bits, five UARTs, three I2C, two SPI, one ADC, an LCD controller, AES, TRNG and a key store. The maximum CPU
frequency and ADC resolution are datasheet items: look them up, do not guess.`,

      { t: 'predict',
        q: 'A design uses the bare ESP32 chip (not a module) and the designer forgets to fit the external SPI flash. Power is applied. What does the chip do?',
        choices: [
          { t: 'Nothing at all: with no flash chip answering, the CPU is held in reset and no code of any kind runs', why: 'The CPU does leave reset. Think about which memory is inside the chip and already contains code.' },
          { t: 'The mask ROM runs, finds no valid bootloader, and reports that on the UART', ok: true, why: 'ROM is on the die, so the first-stage code always runs. It is the load from external flash that fails. A serial terminal on UART0 is the first diagnostic tool for exactly this reason.' },
          { t: 'It runs the application from a small internal flash, but at reduced speed because the cache is unused', why: 'There is no internal program flash on the original ESP32 to fall back on; check where the widget draws the flash block.' },
        ],
        reveal: 'The boot ROM is part of the silicon. It always runs, and it prints a reset reason and boot mode on UART0. Everything after that depends on external parts being present and correctly wired. This is the general rule for diagnosing a dead board: find the earliest stage that is guaranteed to work and look for its output.' },

      { t: 'callout', kind: 'mistake', title: 'Treating a module pin list as the chip pin list',
        md: 'A module does not bring out every chip pin, and some that it does bring out are already used inside the module (flash, PSRAM, strapping resistors). Always design from the **module** datasheet, then cross-check the chip datasheet for electrical limits.' },

      { t: 'callout', kind: 'decision', title: 'Module or bare chip?',
        md: 'For anything with a radio, use a module unless you are building tens of thousands. The module vendor has already done the RF layout and holds the regulatory certification for it; a bare-chip design repeats that work and its cost. For a wired MCU such as the MSPM0L2228 there is no module: the chip plus decoupling capacitors *is* the minimum system.' },

      { t: 'exercise',
        prompt: `A product needs: a 5-year life on a coin cell, wake on a pin change within 1 ms, an I2C temperature sensor, and no radio. Which class of part do you choose (MPU, MCU, or radio SoC module), and what is the single strongest reason? Answer with the class.`,
        hints: [
          'Which requirement would be hardest to meet for a part that needs external DDR RAM?',
          'Turn "five years on a coin cell" into a number: capacity in mAh divided by hours of life gives the average current allowed.',
          'A coin cell of about 200 mAh over 5 × 8760 h allows roughly 4.6 µA on average. Which class can retain state while drawing that?',
        ],
        answer: { type: 'text', accept: ['\\bmcu\\b', 'micro\\s*controller'], nudge: 'Think about sleep current and wake time.' },
        solution: `An **MCU**. The deciding requirement is average current: a coin cell of roughly 200 mAh over five years allows only about 4–5 µA average. Only an MCU can keep its RAM alive in a deep-sleep mode at that level and wake on a pin in well under a millisecond. An MPU cannot hold DDR RAM at microamps, and a radio module adds cost and leakage for a feature that is not required.` },

      `## Harder application

The MAX78000 has two CPU cores of *different* architectures. Using only what you know so far, list three things the
two cores must agree on before both can use the same UART safely. (Suggested answer: who enables the peripheral's
clock, who owns each interrupt, and how they take turns writing the registers. The chip provides inter-core
semaphores for the last one. You will meet all three ideas later in this section.)`,
    ],
    quiz: [
      { q: 'Which statement best separates a microcontroller from a microprocessor?', kind: 'concept', choices: [
        { t: 'A microcontroller has program memory, RAM and peripherals on the CPU\'s die', ok: true, why: 'Integration is the defining property: code runs from internal memory with almost no external parts.' },
        { t: 'A microcontroller has a slower CPU: its clock is limited to a few tens of megahertz', why: 'Speed overlaps: some MCUs run at hundreds of MHz. The distinction is about what else is in the package.' },
        { t: 'A microcontroller is always 8-bit', why: 'All three course platforms are 32-bit MCUs. Word size does not define the category.' },
        { t: 'A microprocessor cannot run without an operating system, whereas a microcontroller can', why: 'An MPU can run bare-metal code; it is simply awkward because code and RAM are external.' },
      ] },
      { q: 'On an ESP32-WROOM module, where is the application code stored?', kind: 'arch', choices: [
        { t: 'In an SPI flash chip in the module, outside the ESP32 die', ok: true, why: 'The module adds the flash; the chip reaches it over SPI and maps it into its address space through a cache.' },
        { t: 'In flash memory on the ESP32 die itself, which is why the chip is called an SoC', why: 'The original ESP32 die has ROM and RAM but no program flash; look at what the module adds.' },
        { t: 'In the mask ROM, which the flashing tool rewrites over the serial port', why: 'Mask ROM is fixed when the chip is manufactured and holds the first-stage boot code, not your application.' },
      ] },
      { q: 'A firmware bug writes through a wild pointer on a typical MCU with no MMU and no MPU configured. What limits the damage?', kind: 'security', choices: [
        { t: 'Nothing in hardware: any writable RAM or peripheral register can be hit', ok: true, why: 'All addresses are physical and all code runs with full access unless a protection unit is configured.' },
        { t: 'The operating system notices the invalid access and kills the offending task', why: 'That requires hardware-enforced isolation, which is exactly what is missing here.' },
        { t: 'The write is ignored, because pointers hold virtual addresses that must be mapped first', why: 'There is no address translation on such an MCU; the pointer value is the physical address.' },
      ] },
      { q: 'You need GPIO6 on an original ESP32-WROOM-32 module for a button. What should you check first?', kind: 'circuit', choices: [
        { t: 'Whether the module already uses that pin for its SPI flash', ok: true, why: 'GPIO6–11 are usually connected to the module flash; driving them breaks code execution.' },
        { t: 'Whether the pin tolerates 5 V, since buttons are usually wired to the 5 V rail', why: 'Voltage tolerance matters for any pin, but it is not what makes this particular pin a problem.' },
        { t: 'Whether the button needs a debouncing capacitor before it can be read reliably', why: 'Debouncing is a later concern; it does not tell you whether the pin is available at all.' },
      ] },
      { q: 'Why can an MCU respond to an input with more predictable timing than a Linux-class MPU?', kind: 'concept', choices: [
        { t: 'No virtual memory, little or no cache, and no general-purpose scheduler in the path', ok: true, why: 'Each of those layers adds variable delay; an MCU has few or none of them.' },
        { t: 'MCUs are built with faster transistors, so every instruction finishes in a fixed, shorter time', why: 'They are usually built on older, slower processes. Predictability comes from simplicity, not raw speed.' },
        { t: 'MCUs do not use interrupts, so nothing can ever delay the code that handles the input', why: 'MCUs rely heavily on interrupts; that is how they achieve fast response.' },
      ] },
      { q: 'Which line from a feature list tells you the *board* must supply something essential?', kind: 'arch', choices: [
        { t: '"Supports up to 16 MB of external SPI flash"', ok: true, why: '"External" means program storage is not on the die, so the board or module must carry it.' },
        { t: '"256 KB flash, 32 KB SRAM, both available from reset"', why: 'These are on-chip memories; nothing extra is needed for the chip to run code.' },
        { t: '"Internal 32 MHz oscillator, no external components needed"', why: 'An internal oscillator removes a board requirement rather than adding one.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 2
  {
    id: 'mcu-cpu-execution',
    title: 'How a CPU executes instructions',
    minutes: 40,
    summary: 'Fetch, decode, execute: the loop underneath every line of C, and why a load/store machine makes register access look the way it does.',
    skills: ['mcu-sk-trace-exec'],
    blocks: [
      `## The problem

A debugger halts your firmware and shows \`pc = 0x0800_0124\`, eight registers full of hex, and one line of assembly.
The C source line it claims to be on is \`count += 1;\` and yet single-stepping takes three steps to get past it.
Why three? And why did an interrupt that fired "during" that line see the old value of \`count\`?

To answer you need the model of what the processor does on each step.`,

      `## Theory: the cycle

A CPU is a state machine that repeats forever:

1. **Fetch**: read the instruction at the address held in the **program counter (PC)**.
2. **Decode**: work out which operation it encodes and which registers or constants it uses.
3. **Execute**: do it in the arithmetic/logic unit, or compute a memory address.
4. **Memory / write-back**: read or write memory if needed, store the result in a register, update the flags.
5. PC moves to the next instruction, unless the instruction was a branch that changed it.

The state it works on is small:

- **General-purpose registers**: a handful of word-sized storage cells inside the CPU. Access takes no bus cycle.
- **PC**: address of the next instruction.
- **Stack pointer (SP)**: address of the top of the stack.
- **Status flags**: N (negative), Z (zero), C (carry), V (overflow) on Arm. Set by arithmetic, read by conditional branches.

### Load/store architecture

Arm Cortex-M and RISC-V are **load/store** (RISC) machines: arithmetic works only on registers. Memory is touched
by exactly two kinds of instruction, *load* (memory → register) and *store* (register → memory). There is no
"add 1 to this memory location" instruction. So \`count += 1\` on a global becomes:

\`\`\`
load   r0 ← [address of count]
add    r0 ← r0 + 1
store  [address of count] ← r0
\`\`\`

That is the three steps. Between the load and the store the only up-to-date copy of the value is in \`r0\`.
An interrupt arriving there sees stale memory. Keep this picture: it explains \`volatile\`, read-modify-write
races on registers, and every lost-update bug in the RTOS section.

### Pipelines, briefly

Real cores overlap the stages: while one instruction executes, the next is being decoded and a third fetched. The
Cortex-M0+ has a two-stage pipeline, the Cortex-M4 three. The visible consequences are small: a taken branch
discards the instructions already fetched behind it (a cycle or two lost), and on Arm, reading PC in an instruction
returns the address of the current instruction plus 4. You do not need to reason about the pipeline to write
firmware, only to explain odd PC values and why branches cost more than straight-line code.`,

      { t: 'widget', name: 'cpu-stepper', props: { program: 'blink' }, title: 'Step a program that drives an LED port',
        caption: 'Step until the LED changes. Which single instruction changed it, and what kind of instruction was it?' },

      `## On real hardware

Compile \`count += 1;\` for a Cortex-M0+ with optimisation and you get something of this shape:`,

      { t: 'code', lang: 'asm', status: 'reviewed', caption: 'Typical Thumb code for incrementing a global (register choice and literal layout vary by compiler)',
        code: R`    ldr   r3, .L_count_addr   @ r3 = address of count (a constant stored near the code)
    ldr   r2, [r3]            @ r2 = value at that address        (LOAD)
    adds  r2, r2, #1          @ r2 = r2 + 1, flags updated
    str   r2, [r3]            @ memory at that address = r2       (STORE)
    ...
.L_count_addr:
    .word count               @ the linker fills in the 32-bit address`,
        explain: [
          { lines: '1', md: 'A 16-bit Thumb instruction cannot hold a 32-bit address, so the compiler places the address in a *literal pool* near the function and loads it PC-relative.' },
          { lines: '2', md: 'A bus read. If \`count\` were a peripheral register, this read is what the peripheral sees.' },
          { lines: '3', md: 'Pure register arithmetic: no bus activity, cannot be observed from outside the CPU.' },
          { lines: '4', md: 'A bus write. Only now does memory, or a peripheral, change.' },
        ] },

      { t: 'widget', name: 'cpu-stepper', props: { program: 'sum' }, title: 'A loop with a conditional branch',
        caption: 'Watch the Z flag. Which instruction sets it, and which instruction reads it?' },

      { t: 'predict',
        q: 'In the "sum" program, the loop ends with a compare followed by a branch-if-not-equal. Just before the final pass through the compare, what decides whether the branch is taken?',
        choices: [
          { t: 'The branch instruction itself re-reads the two registers and compares them again', why: 'A branch instruction has no operands to compare; think about what the compare left behind.' },
          { t: 'The Z flag, left behind by the compare instruction', ok: true, why: 'Compare is a subtract that only updates flags. The conditional branch looks at the flags and nothing else.' },
          { t: 'The value in the program counter, which the compare advanced by an extra step', why: 'PC says where execution is, not what the outcome of a comparison was.' },
        ],
        reveal: 'Decisions are always two steps: an instruction that sets flags, then an instruction that tests them. If anything between the two changes the flags (on Arm, most arithmetic with an \`s\` suffix), the branch tests the wrong thing. Compilers get this right; hand-written assembly and fault-injection attacks both exploit the gap.' },

      `## Function calls

A call must remember where to come back to. On Arm, \`bl target\` ("branch with link") copies the address of the next
instruction into the **link register (LR)** and loads PC with the target. Return is "load PC from LR". If the
function itself calls another function, LR would be overwritten, so it first pushes LR onto the stack and pops
it back into PC at the end. RISC-V does the same thing with the \`ra\` register and \`jal\`/\`ret\`.`,

      { t: 'widget', name: 'cpu-stepper', props: { program: 'call' }, title: 'Call and return',
        caption: 'Step through the call. Write down the value saved as the return address before you step the return.' },

      { t: 'callout', kind: 'mistake', title: 'Believing one C statement is one indivisible step',
        md: 'No C statement that touches memory is atomic on a load/store machine unless the hardware gives you a special instruction or you disable interrupts around it. \`flags |= 4;\` is load, OR, store. Treat every read-modify-write as three separate events.' },

      { t: 'callout', kind: 'security', title: 'Why this matters to an attacker',
        md: 'The return address is ordinary data: in LR for a moment, then on the stack next to local arrays. Overwrite it and "return" becomes "jump where I say". The stack-smashing material in the security section depends on exactly the call sequence you just stepped through.' },

      { t: 'exercise',
        prompt: `A load/store CPU executes the following. Memory word at address \`0x2000_0010\` initially holds 7.

\`\`\`
1: load  r1 ← [0x2000_0010]
2: add   r1 ← r1 + r1
3: load  r2 ← [0x2000_0010]
4: add   r1 ← r1 + r2
5: store [0x2000_0010] ← r1
\`\`\`

An interrupt handler runs between instructions 2 and 3 and stores the value 1 to \`0x2000_0010\`. The handler
preserves all registers. What value does memory hold after instruction 5?`,
        hints: [
          'Which of the five instructions read memory, and which only use registers? A handler that writes memory can only affect the first kind.',
          'Make a table with columns r1, r2 and memory, one row per instruction, and insert a row for the handler between instructions 2 and 3.',
          'After instruction 2, r1 = 14 and that value lives only in the register, so the handler cannot touch it. Instruction 3 reads memory again: what does memory hold at that moment?',
        ],
        answer: { type: 'number', value: 15 },
        solution: `After 2: \`r1 = 14\`. The handler writes 1 to memory. Instruction 3 loads \`r2 = 1\`. Instruction 4: \`r1 = 15\`. Instruction 5 stores **15**. Without the interrupt the answer would be 21. The program used two different values of the "same" variable in one calculation.` },

      `## Harder application

A colleague writes \`if (sensor_ready) { value = sensor_data; }\` where both variables are written by an interrupt
handler. Using only the load/store model, describe a sequence in which \`value\` receives data belonging to the
*next* reading rather than the one that set \`sensor_ready\`. (The handler runs between the load of \`sensor_ready\`
and the load of \`sensor_data\`. The fix, taking both under one protected section, is the subject of the
RTOS section.)`,
    ],
    quiz: [
      { q: 'What does the program counter hold?', kind: 'arch', choices: [
        { t: 'The address of the next instruction to fetch', ok: true, why: 'Fetch reads from the address in PC; every branch works by changing it.' },
        { t: 'The number of instructions executed so far', why: 'It is an address, not a count; a loop revisits the same PC values many times.' },
        { t: 'The result of the most recent arithmetic operation', why: 'Results go to general-purpose registers; flags summarise them.' },
      ] },
      { q: 'On a load/store architecture, how many memory accesses does `x = y + z;` need if all three are globals (ignore fetching the instructions)?', kind: 'code', choices: [
        { t: 'Three: two loads and one store', ok: true, why: 'Each source operand is loaded to a register, the add is register-only, and the result is stored.' },
        { t: 'One: the add instruction reads and writes memory directly', why: 'That describes a memory-operand instruction set; here arithmetic can only use registers.' },
        { t: 'None: globals live in registers', why: 'There are far more globals than registers; globals live in RAM and are loaded when needed.' },
      ] },
      { q: 'A function is entered with `bl`. It then calls a second function without first saving LR. What happens when the first function returns?', kind: 'arch', choices: [
        { t: 'It jumps back to just after its own call to the second function', ok: true, why: 'The inner bl overwrote LR with a return address inside the first function, so its return goes back into itself.' },
        { t: 'It returns correctly, because `bl` saves the old LR on the stack automatically', why: 'bl only writes LR; nothing saves the previous contents unless the code pushes it.' },
        { t: 'The CPU raises a fault at the second `bl`, because LR is already in use', why: 'Overwriting LR is legal; the processor cannot know the old value mattered.' },
      ] },
      { q: 'Why does a taken branch cost more cycles than a not-taken one on a pipelined core?', kind: 'concept', choices: [
        { t: 'Instructions already fetched behind the branch are discarded', ok: true, why: 'The pipeline fetched sequentially; a change of PC makes that work useless.' },
        { t: 'The branch target must be loaded from flash, which is slower than the RAM used for straight-line code', why: 'All instructions are fetched from the same memory; the cost is in the wasted fetches.' },
        { t: 'The flags must be recomputed for the instruction at the target', why: 'Flags were already set by an earlier instruction; the branch only reads them.' },
      ] },
      { q: 'You single-step `status |= 0x10;` on a global and an interrupt that also modifies `status` fires after the load. What is the likely result?', kind: 'code', choices: [
        { t: 'The handler\'s change is overwritten when main stores its stale copy', ok: true, why: 'The store writes the old value OR 0x10, discarding whatever the handler wrote in between.' },
        { t: 'Both changes are kept, because OR is commutative and the order does not matter', why: 'Commutativity would help only if both operations used the current value; one of them uses an old copy.' },
        { t: 'The CPU detects the conflicting store and automatically re-runs the statement', why: 'There is no conflict detection on a plain load and store.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 3
  {
    id: 'mcu-mmio',
    title: 'Registers and memory-mapped I/O',
    minutes: 50,
    summary: 'A peripheral register is an address. Learn to find it in a datasheet, write to it safely, and see why the compiler must be told it is special.',
    skills: ['mcu-sk-register', 'mcu-sk-bitops'],
    blocks: [
      `## The problem

A vendor example turns an LED on with \`gpio_set_level(5, 1)\`. You are asked to do the same from a 200-byte
bootloader stub that cannot link the vendor library. Somewhere under that function call is one store instruction to
one address. Which address, which value, and how do you find them without the library?`,

      `## Theory: peripherals live in the address space

The CPU has one way to move data: load and store to an address. Hardware designers use that. They attach the
peripherals to the same bus as memory and give each control or status **register** an address. A store to that
address does not put a value in RAM; it drives flip-flops that switch a pin, start a conversion or set a baud rate. A
load from it reads the live state of the hardware. This is **memory-mapped I/O (MMIO)**.

Consequences that differ from ordinary memory:

- **A read can have side effects.** Reading a UART data register removes a byte from its FIFO. Reading some status
  registers clears them.
- **A write may not read back.** Write-only registers return zero or garbage. Self-clearing "start" bits read as 0.
- **The value can change by itself.** A status flag is set by hardware, not by your code.
- **Bits have access types.** A register table marks each field:

| Marking | Meaning | How to write it safely |
|---|---|---|
| **RW** | Read/write, reads back what was written | read-modify-write |
| **RO** | Read-only; writes ignored | do not rely on writes |
| **WO** | Write-only; reads undefined or 0 | plain write, keep a shadow copy if you need the value |
| **W1C** | Write 1 to clear; writing 0 does nothing | write a mask with only the flags you handled. **Never** use an OR-assignment |
| **W1S / W1T** | Write 1 to set / toggle | plain write of a mask |
| **Reserved** | Not implemented or for the vendor's use | preserve the read value, or write the documented reset value. Never assume 0 |`,

      `## Reading a register table

Every reference manual describes a peripheral the same way: a **base address** for the peripheral instance, then a
table of registers by **offset**, then a bit-field table for each. The Bench-MCU timer used in this course's simulator:

| Offset | Name | Access | Fields |
|---|---|---|---|
| \`0x00\` | \`TIM_CTRL\` | RW | bit 0 \`ENABLE\`, bit 1 \`AUTO_RELOAD\`, bit 2 \`IRQ_EN\` |
| \`0x04\` | \`TIM_LOAD\` | RW | reload value |
| \`0x08\` | \`TIM_COUNT\` | RO | current count |
| \`0x0C\` | \`TIM_STATUS\` | RW, W1C | bit 0 \`EXPIRED\` |

Base \`0x4000_2000\`. So "start the timer in auto-reload mode" is: store \`0x3\` to address \`0x4000_2000\`.
"Has it expired?" is: load from \`0x4000_200C\` and test bit 0. "Acknowledge the expiry" is: store \`0x1\` to
\`0x4000_200C\`.

### One access, followed all the way down

Take the C statement \`TIM_CTRL |= 0x3;\` with the timer currently stopped (\`TIM_CTRL\` reads 0). Nothing in it
mentions RAM or hardware; the *address* decides which one it is.

\`\`\`
step  CPU instruction         bus activity                      what happens
────  ──────────────────────  ────────────────────────────────  ─────────────────────────────────────────
 1    r3 = 0x40002000         none                              the address is just a number in a register
 2    load  r2 <- [r3]        READ  addr 0x40002000             the address decoder sees 0x4000_2xxx and
                                                                selects TIMER0 instead of a RAM cell;
                                                                offset 0x00 selects TIM_CTRL, whose
                                                                flip-flops drive 0x00000000 onto the bus
 3    r2 = r2 | 0x3           none                              r2 = 0x00000003, inside the CPU only
 4    store [r3] <- r2        WRITE addr 0x40002000, data 0x3   on the next clock edge the ENABLE and
                                                                AUTO_RELOAD flip-flops become 1 and the
                                                                counter starts to count
\`\`\`

Change only the number in step 1 to \`0x20000100\` and the same four instructions update a variable in SRAM. The CPU
cannot tell the difference. That is the whole idea: **an address is a register**, and the peripheral, not the CPU,
gives the access its meaning.

On a real chip the path is the same, only longer. For the original ESP32, ESP-IDF v6.1's register headers
(\`soc/reg_base.h\`, \`soc/gpio_reg.h\`) put the GPIO block at base \`0x3FF4_4000\`, with \`GPIO_OUT_REG\` at offset
\`0x04\`, the write-1-to-set register \`GPIO_OUT_W1TS_REG\` at \`0x08\` and the write-1-to-clear register
\`GPIO_OUT_W1TC_REG\` at \`0x0C\`. The opening problem therefore has a short answer: for a pin below 32,
\`gpio_set_level(5, 1)\` ends in one store of \`0x0000_0020\` (bit 5) to address \`0x3FF4_4008\`. The pin must already
be configured as a GPIO output; that is separate register work, covered in the GPIO lesson. Find the same three
registers in the GPIO register summary of the technical reference manual: locating that table is the skill.`,

      { t: 'ascii', caption: 'From C expression to bus transaction',
        text: R`  C source                         What the CPU does                 What the peripheral sees
  ───────────────────────────────  ────────────────────────────────  ─────────────────────────────
  *(volatile uint32_t*)0x4000200C  load r0 <- [0x4000200C]           read strobe on TIM_STATUS
       & 1u                        and  r0 <- r0 & 1                 nothing (register-only)
  REG = 1u;                        store [0x4000200C] <- 1           write strobe, data = 1
                                                                     -> EXPIRED flag cleared` },

      `## The C idiom, line by line`,

      { t: 'code', lang: 'c', status: 'host-tested', caption: 'The cast that turns a number into a register (host-tested against a fake register array; the addresses only mean something on the target)',
        code: R`#include <stdint.h>

#define TIM_BASE    0x40002000u
#define TIM_CTRL    (*(volatile uint32_t *)(TIM_BASE + 0x00u))
#define TIM_STATUS  (*(volatile uint32_t *)(TIM_BASE + 0x0Cu))

#define TIM_CTRL_ENABLE       (1u << 0)
#define TIM_CTRL_AUTO_RELOAD  (1u << 1)
#define TIM_STATUS_EXPIRED    (1u << 0)

void timer_start(void)
{
    TIM_CTRL |= TIM_CTRL_ENABLE | TIM_CTRL_AUTO_RELOAD;
}

void timer_wait(void)
{
    while ((TIM_STATUS & TIM_STATUS_EXPIRED) == 0u) {
        /* wait */
    }
    TIM_STATUS = TIM_STATUS_EXPIRED;
}`,
        explain: [
          { lines: '4', md: '\`(volatile uint32_t *)\` converts the integer to "pointer to a 32-bit object that may change behind the compiler\'s back". The leading \`*\` dereferences it, so \`TIM_CTRL\` behaves like a variable located at that address.' },
          { lines: '7-9', md: 'Masks built with \`1u <<\`. The \`u\` matters: shifting a signed 1 into bit 31 is undefined behaviour.' },
          { lines: '13', md: 'Read-modify-write: one load, one OR in a register, one store. Correct for an RW register; other bits keep their values.' },
          { lines: '18-20', md: 'Each loop iteration performs a real bus read, because the object is \`volatile\`. Without it the compiler may read once and spin forever.' },
          { lines: '21', md: 'Plain assignment, not \`|=\`: the field is write-1-to-clear. Writing only the mask clears only that flag.' },
        ] },

      { t: 'callout', kind: 'why', title: 'Why volatile',
        md: `The compiler assumes that memory only changes when your code writes it. Under that assumption, a loop that reads the same address twice with no write between can be reduced to one read, and two writes to the same address with no read between can be reduced to the last one. Both are wrong for hardware. \`volatile\` tells the compiler: **every access written in the source must happen, exactly once, in order**. It does not make anything atomic and does not protect against interrupts.` },

      { t: 'predict',
        q: 'A status register has two W1C flags: bit 0 RX_DONE and bit 1 TX_DONE. Both are currently set. Your receive handler runs `STATUS |= RX_DONE;` to acknowledge reception. What is in the register afterwards?',
        choices: [
          { t: 'Only RX_DONE is cleared; TX_DONE stays set, because the mask names only RX_DONE', why: 'Trace the three steps: what value does the load return, and what value does the store write?' },
          { t: 'Both flags are cleared, so the transmit-complete event is lost', ok: true, why: 'The load returns 0b11, the OR leaves 0b11, and the store writes a 1 to both W1C bits.' },
          { t: 'Nothing changes, because OR-ing a bit that is already set has no effect', why: 'That would be true for an RW bit. For W1C, the stored 1 is a command, not a value.' },
        ],
        reveal: '\`|=\` on a W1C register clears every flag that happened to be set at the moment of the read. The transmit side then waits forever for an event that has already been erased. The correct form is \`STATUS = RX_DONE;\`.' },

      `## Practise the bit operations

Four idioms cover almost every register access. Work each challenge by typing the C expression.

\`\`\`c
reg |=  (1u << n);                                   /* set bit n            */
reg &= ~(1u << n);                                   /* clear bit n          */
reg ^=  (1u << n);                                   /* toggle bit n         */

/* a field of width w at position p:  MASK = (1u << w) - 1                    */
reg = (reg & ~(MASK << p)) | ((value & MASK) << p);  /* write the field      */
field = (reg >> p) & MASK;                           /* read the field       */
\`\`\``,

      { t: 'widget', name: 'register-bits', props: { challenge: 'set-bit' }, title: 'Set one bit' },
      { t: 'widget', name: 'register-bits', props: { challenge: 'clear-bit' }, title: 'Clear one bit' },
      { t: 'widget', name: 'register-bits', props: { challenge: 'toggle' }, title: 'Toggle one bit' },
      { t: 'widget', name: 'register-bits', props: { challenge: 'field-write' }, title: 'Write a multi-bit field',
        caption: 'Clear the field first, then OR in the new value. Skipping the clear leaves old 1 bits behind.' },
      { t: 'widget', name: 'register-bits', props: { challenge: 'field-read' }, title: 'Read a multi-bit field' },

      { t: 'callout', kind: 'mistake', title: 'Assigning a whole register when you meant to change one bit',
        md: '\`GPIO_DIR = 1u << 5;\` makes pin 5 an output and **every other pin an input**. Whatever another driver configured is gone. Unless you own the whole register, modify, do not assign.' },

      { t: 'widget', name: 'c-lab', title: 'C lab: one pin, without touching the others',
        props: {
          title: 'Configure pin 5 without disturbing other pins',
          prompt: `The Bench-MCU GPIO block is at base \`0x4000_0000\`: \`GPIO_DIR\` at offset \`0x00\` (1 = output) and \`GPIO_OUT\` at offset \`0x04\` (output latch). Both are RW.

\`board_init()\` models another driver that already owns pins 0, 1 and 12. Fix \`led_init()\` so that pin 5 becomes an output driven high, and pins 0, 1 and 12 keep their direction and level.

Bench-MCU is a simulated teaching target; the addresses are not those of any real chip.`,
          starter: R`#include <stdint.h>
#include <stdio.h>

/* Registers defined by hand from the table: base 0x40000000 */
#define MY_GPIO_DIR (*(volatile uint32_t *)0x40000000u)
#define MY_GPIO_OUT (*(volatile uint32_t *)0x40000004u)

static void board_init(void)
{
    /* Another driver owns pins 0, 1 and 12. Do not change this function. */
    MY_GPIO_DIR = 0x1003u;
    MY_GPIO_OUT = 0x1001u;
}

static void led_init(void)
{
    /* TODO: pin 5 output, driven high, other pins untouched. */
    MY_GPIO_DIR = 1u << 5;
    MY_GPIO_OUT = 1u << 5;
}

int main(void)
{
    board_init();
    led_init();
    printf("DIR=%x OUT=%x\n", MY_GPIO_DIR, MY_GPIO_OUT);
    return 0;
}
`,
          solution: R`#include <stdint.h>
#include <stdio.h>

#define MY_GPIO_DIR (*(volatile uint32_t *)0x40000000u)
#define MY_GPIO_OUT (*(volatile uint32_t *)0x40000004u)

static void board_init(void)
{
    MY_GPIO_DIR = 0x1003u;
    MY_GPIO_OUT = 0x1001u;
}

static void led_init(void)
{
    MY_GPIO_OUT |= (1u << 5);
    MY_GPIO_DIR |= (1u << 5);
}

int main(void)
{
    board_init();
    led_init();
    printf("DIR=%x OUT=%x\n", MY_GPIO_DIR, MY_GPIO_OUT);
    return 0;
}
`,
          tests: [
            { name: 'pin 5 is an output and high; pins 0, 1, 12 unchanged', regs: { GPIO_DIR: 0x1023, GPIO_OUT: 0x1021 }, stdoutIncludes: 'DIR=1023 OUT=1021' },
          ],
          hints: [
            'Run the starter and compare the printed DIR with what \`board_init\` wrote. Which bits disappeared?',
            'A plain \`=\` replaces all 32 bits. You need an operation that keeps the bits you are not naming.',
            '\`reg |= (1u << 5);\` loads the register, sets bit 5 in the copy, and stores it back.',
            'Order matters on real hardware: set the output latch before switching the pin to output, so the pin never drives the wrong level, even briefly.',
          ],
          explain: 'The solution writes \`GPIO_OUT\` before \`GPIO_DIR\`. If the direction were switched first, the pin would drive whatever the latch held (low) for a few hundred nanoseconds. For an LED nobody notices; for a reset line or a MOSFET gate, that glitch is a real fault.',
        } },

      `## Harder application

A device header describes a UART interrupt-flag register like this: bits 0–3 are W1C event flags, bits 8–11 are RW
interrupt enables, the rest are reserved with reset value 0. You must acknowledge event bit 2 without changing the
enables and without clearing other pending events. Write the single C statement. (Answer: read the register, keep
only the RW enable bits, OR in the one flag to clear, and write it back:
\`REG = (REG & 0x00000F00u) | (1u << 2);\`. A plain \`REG = 1u << 2\` would zero the enables; a \`|=\` would clear
every pending flag. Mixed-access registers are where most driver bugs hide, which is why many chips put flags and
enables in separate registers.)`,

      { t: 'refs', items: [
        { title: 'ESP-IDF soc register headers (ESP32)', url: 'https://github.com/espressif/esp-idf/tree/v6.1/components/soc/esp32', note: 'Register addresses as the SDK defines them; compare with the TRM tables.' },
        { title: 'MSDK MAX78000 device header', url: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/max78000.h', note: 'Peripheral base addresses.' },
        { title: 'MSPM0 device header', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/mspm0l222x.h' },
      ] },
    ],
    quiz: [
      { q: 'A reference manual gives a peripheral base of `0x4000_1000` and a register at offset `0x0C`. Which C expression reads it correctly?', kind: 'code', choices: [
        { t: '`*(volatile uint32_t *)(0x40001000u + 0x0Cu)`', ok: true, why: 'Add the offset to the integer base first, then cast and dereference.' },
        { t: '`*((volatile uint32_t *)0x40001000u + 0x0C)`', why: 'Adding to a pointer scales by the element size, so this reaches offset 0x30, not 0x0C.' },
        { t: '`(volatile uint32_t)0x4000100C`', why: 'This just converts the number to an integer type; nothing is dereferenced, so no bus access occurs.' },
      ] },
      { q: 'Why must MMIO registers be accessed through a `volatile`-qualified type?', kind: 'concept', choices: [
        { t: 'So the compiler performs every access the source asks for, in order', ok: true, why: 'Without it the optimiser may remove or merge accesses it considers redundant.' },
        { t: 'So that each read-modify-write of the register becomes a single atomic operation', why: 'The qualifier changes nothing about how many instructions are used; a read-modify-write is still three steps.' },
        { t: 'So the linker places the object at the fixed address instead of in RAM', why: 'Placement is decided by the address in the cast (or the linker), not by this qualifier.' },
      ] },
      { q: 'An interrupt-flag register is W1C. Which statement clears only flag bit 3?', kind: 'code', choices: [
        { t: '`FLAGS = (1u << 3);`', ok: true, why: 'Zeros written to the other bits are ignored, so only bit 3 is cleared.' },
        { t: '`FLAGS &= ~(1u << 3);`', why: 'This writes 1s back to every other flag that is currently set, clearing them, and writes 0 to bit 3, which does nothing.' },
        { t: '`FLAGS |= (1u << 3);`', why: 'The value written includes every flag that was set when read, so all of them are cleared.' },
      ] },
      { q: 'A field table marks bits 31:12 of a control register as "Reserved". What should a driver do with them when updating bit 0?', kind: 'arch', choices: [
        { t: 'Preserve whatever was read from them', ok: true, why: 'Reserved bits may carry hidden state or gain meaning in a later silicon revision; read-modify-write keeps them intact.' },
        { t: 'Always write zeros', why: 'Zero is safe only if the manual says so; some reserved bits have non-zero reset values that must be kept.' },
        { t: 'Use them to store spare driver state', why: 'They may not be backed by storage at all, or may control undocumented test features.' },
      ] },
      { q: 'A loop `while (UART_STATUS & RX_AVAIL) { }` never exits on an optimised build, although bytes are arriving. `UART_STATUS` is defined as `(*(uint32_t *)0x40001004)`. What is the most likely cause?', kind: 'code', choices: [
        { t: 'The compiler read the register once and reused the value', ok: true, why: 'Nothing in the loop writes memory, so a non-volatile read is treated as loop-invariant.' },
        { t: 'The address is wrong by one word, so the loop is watching a different register', why: 'A wrong address would misbehave at every optimisation level, not only when optimising.' },
        { t: 'The UART clock is too slow for the status bit to change within one iteration', why: 'A slow clock changes when bits arrive, not whether the code observes a status change.' },
      ] },
      { q: 'Reading a UART receive data register twice in a row usually returns:', kind: 'arch', choices: [
        { t: 'Two different bytes (or a byte, then empty): the read pops the FIFO', ok: true, why: 'This is a read with a side effect: each read strobe advances the FIFO.' },
        { t: 'The same byte twice, as with any memory location that nobody has written in between', why: 'That assumes the register is storage. Here the read strobe itself changes the hardware state.' },
        { t: 'A bus fault on the second read, because the register is empty by then', why: 'Reading a valid register address never faults merely because it was read before.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 4
  {
    id: 'mcu-memory-types',
    title: 'Flash, SRAM, ROM, EEPROM and eFuses',
    minutes: 40,
    summary: 'Which memory forgets at reset, which forgets at power-off, which wears out, and which can never be changed again.',
    skills: ['mcu-sk-memtype'],
    blocks: [
      `## The problem

A data logger stores a 4-byte "last sample index" in flash every second so it can resume after a power cut. It works
on the bench for a week. Units in the field start returning corrupt indices after a few months, and a few will not
boot. Nothing in the code changed. What did the designer not know about flash?`,

      `## Theory: four behaviours to tell apart

| Memory | Keeps data without power? | Rewritable? | How writes work | Typical use |
|---|---|---|---|---|
| **SRAM** | No | Freely, any byte, any time, at bus speed | Just a store | Variables, stack, heap |
| **Mask ROM** | Yes | Never: fixed at manufacture | — | First-stage boot code, factory routines |
| **Flash** | Yes | Yes, but: erase in blocks, limited cycles | Erase block → all 1s; program can only turn 1s into 0s | Program code, constants, stored settings |
| **EEPROM** | Yes | Yes, byte-erasable, higher endurance than flash | Byte write with internal erase | Small configuration data |
| **OTP / eFuse** | Yes | Each bit once: 0 → 1, never back | Blow a fuse | Keys, security configuration, MAC addresses, lifecycle state |

### Reset is not power-off

SRAM is *volatile* with respect to power, not reset. A reset (button, watchdog, software) leaves SRAM cells powered,
so they still hold their old contents. Variables look freshly initialised after reset only because the startup code
re-copies \`.data\` and zeroes \`.bss\` (the linker lesson shows this). Memory the startup code does not touch survives. Firmware
uses this deliberately ("no-init" sections holding a crash record). Attackers use it too: secrets left in RAM
survive a reset into a bootloader.

After a real power-off, SRAM contents are undefined at the next power-up. Not zero: undefined.

### How flash really writes

A flash cell stores charge on a floating gate. **Erase** removes the charge from every cell in a block, and all
bits read 1 (\`0xFF\`). **Program** adds charge to selected cells, turning 1 into 0. Program can never turn 0 back
into 1. So:

- To change a byte from \`0x0F\` to \`0xF0\` you must erase the whole block containing it and rewrite everything else in that block.
- The erase unit is large. MAX78000: 8 KB pages (\`0x2000\`). The MSPM0 code in the 2026 eCTF reference design uses
  1 KB flash pages. Typical SPI flash on an ESP32 module: 4 KB sectors.
- Erase is slow (milliseconds to hundreds of milliseconds). Losing power in the middle leaves a
  block in an undefined state.
- Each erase damages the cells slightly. **Endurance** is specified in the datasheet as a minimum number of
  program/erase cycles: commonly in the range of ten thousand to a hundred thousand for MCU flash. Look up the figure
  for your part; do not assume.

Now the logger: one erase per second is 86,400 a day. A block rated for 10,000 cycles is past its guaranteed life in
under three hours of that treatment. The rating is a guaranteed minimum, not the point of failure: cells usually go on
working well beyond it, then fail gradually and unevenly, which is why the bench test passed and the field units died
one by one.`,

      { t: 'ascii', caption: 'Program can only clear bits; only erase sets them',
        text: R`  erased page        1111 1111   (0xFF)
  program 0xA5       1010 0101   ok: only 1 -> 0 transitions
  program 0x0F  ->   0000 0101   NOT 0x0F: result is old AND new (0xA5 & 0x0F = 0x05)
  erase page         1111 1111   whole page, every byte, one endurance cycle used` },

      `### Execute in place, or through a cache

On most MCUs the CPU fetches instructions directly from internal flash at its bus address: **execute in place
(XIP)**. MAX78000 code runs from \`0x1000_0000\`, MSPM0L2228 code from \`0x0000_0000\`. Nothing is copied to RAM
except initialised variables.

The ESP32 cannot do that directly: its flash is an external chip on SPI, far too slow to sit on the CPU bus. Instead
a **flash cache with an MMU** maps 64 KB pages of flash into two address ranges (on the original ESP32, read-only
data at \`0x3F40_0000\` and code at \`0x400D_0000\`). The first access to a page reads it over SPI into cache RAM;
later accesses hit the cache. Two consequences:

- A cache miss costs many microseconds. Timing of flash-resident code is not constant.
- While firmware erases or writes flash, the cache is disabled. Any code or constant that must run then
  (interrupt handlers especially) has to live in internal RAM. ESP-IDF marks such functions \`IRAM_ATTR\`, which
  places them at \`0x4008_0000\` onwards.

### One-time-programmable memory

An **eFuse** bit starts at 0 and can be burned to 1 once. There is no erase. Chips use them for facts that must never
change or be forged: the ESP32 keeps its flash-encryption key, secure-boot key digest and the counters that enable
those features in eFuses, with further fuses that block software from reading the key blocks back. The MSPM0 family
keeps boot configuration (debug access policy, bootloader options, write protection) in a separate flash region called
NONMAIN at \`0x41C0_0000\`; it is flash rather than fuses, but can be write-protected so that it behaves as permanent.`,

      { t: 'widget', name: 'memory-map', props: { platform: 'generic' }, title: 'A generic MCU address space',
        caption: 'For each region, say whether a write there is a plain store, an erase/program sequence, or impossible.' },
      { t: 'widget', name: 'memory-map', props: { platform: 'esp32' }, title: 'ESP32 address space',
        caption: 'Find the two ranges that are windows onto external flash, and the range where code must live to run with the cache off.' },

      { t: 'callout', kind: 'security', title: 'Burning the wrong fuse is permanent',
        md: 'Security eFuses and NONMAIN lock bits cannot be undone. A wrong secure-boot key digest, or debug disabled before the firmware works, turns a board into scrap. Rehearse on a simulator or a sacrificial board, read back and verify before any irreversible step, and keep a written record of every fuse you burn.' },

      `## Worked example: wear budget

Requirement: store a 16-byte record once a minute for 10 years. Flash page size 8 KB, guaranteed endurance
10,000 cycles (an assumed figure for the example; use your datasheet's).

- Writes needed: 60 × 24 × 365 × 10 ≈ 5.26 million.
- Naive design (erase the page for every write): 5.26 million erases on one page, about 526 times its rated life.
- Append design: an 8 KB page holds 512 records of 16 bytes. Write records one after another into erased space and
  erase only when the page is full. Erases needed: 5.26 M / 512 ≈ 10,270 on one page. Still slightly over.
- Use two pages alternately (which you need anyway, so that a power cut during erase never destroys the only copy):
  about 5,135 erases per page. Inside the budget with a factor of two to spare.

This append-and-rotate scheme is the core of every flash key-value store, including ESP-IDF's NVS.`,

      { t: 'predict',
        q: 'A device is running, holding a decrypted key in a global array in SRAM. An attacker pulses the reset pin, and the chip restarts into a ROM bootloader that offers a "read RAM" command. Power was never removed. What does the attacker read at the address of the array?',
        choices: [
          { t: 'Zeros, because the reset signal clears every RAM cell before any code runs', why: 'Ask what physically clears an SRAM cell. A reset signal goes to the CPU and peripherals, not to every memory cell.' },
          { t: 'Most likely the key, unless the bootloader overwrote it', ok: true, why: 'SRAM keeps its contents while powered. Only code that runs after reset can change it.' },
          { t: 'Random values, because SRAM is volatile and loses its contents on any restart', why: 'Volatile refers to loss of power. The supply never dropped here.' },
        ],
        reveal: 'RAM survives reset. Defences: erase secrets as soon as they are no longer needed, zero sensitive RAM early in your own startup code, and disable or authenticate ROM bootloader commands that read memory. To verify the defence, do what the attacker does: reset under a debugger and dump the region.' },

      { t: 'callout', kind: 'mistake', title: 'Writing flash without erasing',
        md: 'Programming over existing data does not fail loudly: it yields the bitwise AND of old and new. The write call may even report success. Always verify by reading back, and treat "value has more zero bits than I wrote" as the signature of a missing erase.' },

      { t: 'callout', kind: 'decision', title: 'Where should a setting live?',
        md: `- Changes every boot or more often, and loss on power-off is acceptable → **SRAM** (optionally a no-init section to survive reset).
- Changes occasionally, must survive power loss → **flash with wear levelling** (a vendor NVS/EEPROM-emulation library), not a hand-rolled single page.
- Never changes after manufacture and must not be forgeable → **eFuse/OTP** or a write-protected flash region.
- Constant for a firmware version → \`const\` data in **flash** alongside the code.` },

      { t: 'exercise',
        prompt: `A flash page currently holds the byte \`0xC3\` at some address. Without erasing, firmware programs \`0x5A\` to the same address. What byte is read back? Answer in hex.`,
        hints: [
          'Which direction can a program operation move a bit, and which direction needs an erase?',
          'Go bit by bit: a bit ends up 1 only if it was 1 before and the new value also has a 1 there.',
          'That rule is a bitwise AND of the old and new values. Write both in binary and AND them.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0x)?42h?\\s*$'], nudge: 'Write 0xC3 and 0x5A in binary and AND them.' },
        solution: `\`0xC3 = 1100 0011\`, \`0x5A = 0101 1010\`. AND → \`0100 0010 = 0x42\`. Neither the old value nor the new one.` },

      `## Harder application

You must store a monotonic counter that an attacker with flash-write access cannot roll back, using only eFuse bits
(each bit burns 0 → 1 once). You have 32 spare bits. How do you encode the counter, how many increments do you get, and
what does that tell you about how often the counter may be bumped? (Unary encoding: the counter is the number of
burned bits, giving 32 increments in total. Binary would give more values but an attacker, or a bug, could only ever
set more bits, and binary values do not increase monotonically when bits are added. Thirty-two increments is a budget
for security-critical firmware revisions, not for every build. Real anti-rollback schemes work exactly this way.)`,
    ],
    quiz: [
      { q: 'After a watchdog reset with power maintained, an uninitialised region of SRAM that the startup code does not touch will contain:', kind: 'arch', choices: [
        { t: 'Whatever it held before the reset', ok: true, why: 'Reset does not remove power from the cells, and nothing has overwritten them.' },
        { t: 'All zeros, because hardware clears RAM on every reset', why: 'Zeroing is done by startup code for .bss only; the hardware does not clear memory.' },
        { t: 'All 0xFF, the same as erased flash', why: '0xFF is the erased state of flash cells, which work on a different physical principle.' },
      ] },
      { q: 'Why can a single byte in flash not simply be overwritten with a new value?', kind: 'concept', choices: [
        { t: 'Programming only turns 1s into 0s; getting 1s back needs a block erase', ok: true, why: 'The asymmetric physics of the cell forces erase-before-write at block granularity.' },
        { t: 'Flash is read-only once the factory has programmed it; only RAM can be rewritten', why: 'That describes mask ROM. Flash is reprogrammed every time you download firmware.' },
        { t: 'The CPU has no store instruction that can target a flash address', why: 'The limitation is in the memory cells and controller sequence, not in the instruction set.' },
      ] },
      { q: 'On an ESP32, an interrupt handler crashes only when it fires during a flash write. The handler is an ordinary C function. Most likely cause?', kind: 'arch', choices: [
        { t: 'Its code is in cache-mapped flash, which cannot be read during the write', ok: true, why: 'Code that must run during flash operations has to be placed in internal RAM.' },
        { t: 'Flash writes disable all interrupts, so the handler was entered in an illegal state', why: 'If that were so there would be no crash; the problem is that it does run and its code cannot be fetched.' },
        { t: 'The handler uses too much stack, and flash writes leave less stack available', why: 'Stack use would not correlate specifically with flash writes.' },
      ] },
      { q: 'Which data belongs in eFuse/OTP rather than ordinary flash?', kind: 'security', choices: [
        { t: 'The digest of the public key used to verify firmware', ok: true, why: 'It must not be replaceable by anyone who can rewrite flash; one-time memory gives that property.' },
        { t: 'The user\'s Wi-Fi password, so that it survives a factory reset', why: 'It changes over the product\'s life, and one-time memory cannot be rewritten.' },
        { t: 'A boot counter incremented at every power-up', why: 'A few dozen spare one-time bits would be used up within days.' },
      ] },
      { q: 'A 4 KB sector rated for 100,000 erase cycles stores 8-byte records appended one after another, erasing only when full. Roughly how many records can be written before the rating is reached?', kind: 'code', choices: [
        { t: '51 million', ok: true, why: '512 records per sector fill × 100,000 erases = 51.2 million.' },
        { t: '100,000 records', why: 'That assumes one erase per record; appending gives hundreds of records per erase.' },
        { t: '512 records', why: 'That is the number of records per fill of the sector, before the first erase is even needed.' },
      ] },
      { q: 'A bootloader keeps a "boot attempts" counter in one flash byte. The byte is erased to `0xFF` once, and after each failed boot the code programs it with a new value **without erasing**. Which sequence of values can be stored correctly this way?', kind: 'code', choices: [
        { t: '`0xFF`, `0xFE`, `0xFC`, `0xF8`', ok: true, why: 'Every step only turns 1s into 0s, which programming can do without an erase. Eight attempts fit in the byte.' },
        { t: '`0x00`, `0x01`, `0x02`, `0x03`', why: 'Going from 0x01 to 0x02 needs bit 1 to become 1 again. Work out old AND new for that step.' },
        { t: '`0xFF`, `0xFE`, `0xFD`, `0xFC`', why: 'Check the step from 0xFE to 0xFD: bit 0 would have to go from 0 back to 1. What does the cell actually hold afterwards?' },
      ] },
      { q: 'What does "execute in place" mean?', kind: 'concept', choices: [
        { t: 'The CPU fetches instructions straight from non-volatile memory', ok: true, why: 'This is the normal mode for internal MCU flash and saves RAM.' },
        { t: 'The code is position-independent, so it runs correctly wherever it is loaded', why: 'Position independence is about how addresses are encoded, not about which memory holds the code.' },
        { t: 'Interrupts are disabled while the code runs, so it cannot be moved', why: 'Interrupt masking is unrelated to where instructions are fetched from.' },
      ] },
    ],
  },
];
