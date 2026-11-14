// Microcontroller architecture, part D: stack/heap/static memory and endianness, Arm Cortex-M, RISC-V.
const R = String.raw;

export default [
  // ───────────────────────────────────────────────────────────────── 12
  {
    id: 'mcu-stack-heap-endian',
    title: 'Stack, heap, static memory and byte order',
    minutes: 55,
    summary: 'Three ways RAM is used, how each one fails on a chip with no memory protection, and the order in which a multi-byte value is laid out in memory.',
    skills: ['mcu-sk-stack', 'mcu-sk-endian'],
    blocks: [
      `## The problem

A device runs for eleven days and then reports a configuration value of 1,953,719,668 instead of 100. No code
writes that variable after start-up. Printed as bytes, the number is ¬'t' 'e' 's' 't'¬. Something else wrote
text over it. On a PC the operating system would have stopped the offending program with a segmentation fault. On
this microcontroller nothing stopped anything. Why not, and what wrote there?`,

      `## Theory: three kinds of storage

| | Static | Stack | Heap |
|---|---|---|---|
| What | Globals and ¬static¬ variables (¬.data¬, ¬.bss¬) | Function locals, saved registers, return addresses | Blocks from ¬malloc¬ |
| Lifetime | Whole program | Until the function returns | Until ¬free¬ |
| Address decided | At link time | At run time, by the stack pointer | At run time, by the allocator |
| Size known | Exactly, from the map file | Only by analysis or measurement | Depends on run-time behaviour |
| Cost of allocation | None | One subtract from SP | A search through allocator data structures |
| Typical failure | Link error (region full) | Overflow into other memory | Exhaustion, fragmentation, use-after-free |

### The stack

Each function call creates a **stack frame**: the saved return address, any callee-saved registers the function
uses, and its local variables. Entering the function moves the stack pointer down by the frame size; returning
moves it back. On Arm Cortex-M and by convention on RISC-V the stack is **full descending**: it grows toward lower
addresses, and SP points at the last item pushed.

Worst-case stack use is the deepest chain of calls, plus the frames of every interrupt that can nest on top of it at
that moment. Interrupt handlers use the stack of whatever they interrupted (on Cortex-M, the main stack).`,

      { t: 'ascii', caption: 'A common RAM layout: static data at the bottom, heap growing up, stack growing down from the top',
        text: R`  high addresses
  0x2002_0000  ┌──────────────────────┐ ◄─ initial SP (top of RAM, MAX78000 example)
               │ stack                │   grows DOWN on each call / interrupt
               │   │                  │
               │   ▼                  │
               │ ........free........ │   nothing here stops the two from meeting
               │   ▲                  │
               │   │                  │
               │ heap                 │   grows UP as malloc needs more
               ├──────────────────────┤ ◄─ _ebss / heap start
               │ .bss  (zeroed)       │
               ├──────────────────────┤
               │ .data (copied)       │
  0x2000_0000  └──────────────────────┘
  low addresses` },

      { t: 'widget', name: 'stack-heap', props: { program: 'nested' }, title: 'Frames appear and disappear',
        caption: 'Step through the calls. For each frame, point to the return address and to the locals.' },

      `### Stack overflow without an MMU

A desktop OS puts an unmapped *guard page* below each stack; overflow touches it and the process is killed at once.
A microcontroller has no MMU and, unless you configure a protection unit, no guard. When the stack pointer moves
below the space reserved for the stack, pushes continue to succeed. They are ordinary stores to ordinary RAM, which
happens to contain the heap or ¬.bss¬. The symptoms appear later and elsewhere:

- a global variable changes "by itself" (the stack wrote over it), or
- a function returns to a garbage address (a global write went through the stack's saved return address), or
- on layouts where the stack is at the *bottom* of RAM, the overflow runs off the start of RAM and faults
  immediately. That is why some linker scripts deliberately put the stack first: a crash at the moment of
  overflow is far better than silent corruption.

Large local arrays, recursion, and ¬printf¬-family functions (hundreds of bytes of frame) are the usual causes.`,

      { t: 'widget', name: 'stack-heap', props: { program: 'recursion' }, title: 'Recursion until the stack runs out',
        caption: 'Before stepping, predict which region the stack will reach first and what will be corrupted.' },

      `### The heap

¬malloc(n)¬ finds a free block of at least *n* bytes in a region managed by the allocator, records its size in a
small header, and returns its address. ¬free¬ returns the block. After many allocations and frees of different
sizes, free memory is split into small pieces between live blocks: **fragmentation**. The total free memory may be
ample while no single piece is large enough, so ¬malloc¬ returns ¬NULL¬. A PC hides this with virtual memory and
gigabytes of space. A device with 32 KB of RAM that must run for years does not.

Other heap hazards: use after free (the block has been given to someone else), double free (corrupts the
allocator's lists), forgetting to free (leak; the device fails after days), and allocation time that varies with
the state of the heap, which breaks timing guarantees.`,

      { t: 'widget', name: 'stack-heap', props: { program: 'fragmentation' }, title: 'Fragmentation',
        caption: 'Add up the free bytes when the allocation fails. Why could the request not be satisfied?' },
      { t: 'widget', name: 'stack-heap', props: { program: 'dangling' }, title: 'A dangling pointer' },

      { t: 'callout', kind: 'decision', title: 'Why many firmware projects ban malloc after initialisation',
        md: `With all allocation done once at start-up (or none at all), memory use is fixed, visible in the map file, and identical on day 1 and day 1000. There is nothing to fragment, leak or fail at run time, and no allocation-time jitter. The price is that maximum sizes must be decided at design time. Common patterns: static buffers, fixed-size block pools (every block the same size, so fragmentation is impossible), and "allocate at boot, never free". Safety and security coding standards such as MISRA C restrict dynamic allocation for these reasons.` },

      { t: 'predict',
        q: 'A function declares `char name[8];` as a local and copies a 20-character string into it with `strcpy`. On a Cortex-M with a descending stack, what is most likely to be overwritten by the extra 12 bytes?',
        choices: [
          { t: 'Memory below the array: locals of functions called later', why: 'Array indices increase toward higher addresses. Which way is "up" from the array on a descending stack?' },
          { t: 'Memory above the array: other locals, saved registers and the saved return address of this function', ok: true, why: 'The array is filled from low to high addresses; the frame\'s saved state lies at higher addresses, pushed earlier.' },
          { t: 'Nothing: the write faults at the end of the array', why: 'Nothing in C or in the hardware marks the end of a local array; they are plain stores.' },
        ],
        reveal: 'The stack grows down, but buffers fill upward, straight toward the saved return address. That geometry is what makes stack buffer overflows exploitable, and it is the answer to this lesson\'s opening problem in the other direction: text written past the end of some buffer landed on a neighbouring variable. The security section\'s ¬stack-smash¬ tool lets you do it deliberately against a simulated target.' },

      `### Finding out how much stack you use

- **Static analysis**: compilers can report each function's frame size (GCC ¬-fstack-usage¬); add up the deepest
  call chain and the worst interrupt nesting.
- **High-water mark**: at boot, fill the stack region with a pattern such as ¬0xA5¬; later, scan from the far end to
  find how far the pattern has been overwritten. RTOS kernels provide this per task.
- **Guard**: place a known word at the end of the stack region and check it periodically, or configure the MPU
  (Cortex-M) so that an access to the guard region faults.`,

      `## Endianness

A 32-bit value occupies four byte addresses. **Byte order** says which byte goes at the lowest address.

- **Little-endian**: least significant byte at the lowest address. Arm Cortex-M (as built into all MCUs you
  will meet), RISC-V, Xtensa on the ESP32 and x86 are all little-endian.
- **Big-endian**: most significant byte first. This is "network byte order", and many sensors, file formats
  and cryptographic specifications use it.`,

      { t: 'ascii', caption: 'The value 0x12345678 stored at address 0x2000_0010',
        text: R`  address        0x...10  0x...11  0x...12  0x...13
  little-endian    78       56       34       12       <- all course MCUs
  big-endian       12       34       56       78       <- network order, many sensor registers` },

      { t: 'widget', name: 'endianness', props: { value: 0x12345678 }, title: 'One value, two layouts',
        caption: 'Do the cast-to-bytes and network-order tasks. Predict each byte before revealing it.' },

      `Byte order is invisible while you treat a value as a whole. It appears the moment bytes cross a boundary:
a hex dump, a pointer cast, a ¬memcpy¬ of a struct into a packet, a sensor that sends its high byte first.

The portable way to convert is to say exactly what you mean with shifts, which works on any CPU, at any alignment:`,

      { t: 'code', lang: 'c', status: 'host-tested', caption: 'Byte-order-independent serialisation',
        code: R`#include <stdint.h>

/* Read a big-endian 16-bit value from two received bytes. */
uint16_t get_be16(const uint8_t *p)
{
    return (uint16_t)(((uint16_t)p[0] << 8) | (uint16_t)p[1]);
}

/* Write a 32-bit value into a buffer in big-endian (network) order. */
void put_be32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v >> 24);
    p[1] = (uint8_t)(v >> 16);
    p[2] = (uint8_t)(v >> 8);
    p[3] = (uint8_t)v;
}`,
        explain: [
          { lines: '6', md: 'Shifts operate on the *value*, not on memory, so the result is the same whatever the CPU\'s byte order. Byte accesses also have no alignment requirement.' },
          { lines: '12-15', md: 'Four single-byte stores. Compilers recognise this pattern and often emit one byte-reverse instruction and one store.' },
        ] },

      { t: 'callout', kind: 'mistake', title: 'Casting a byte buffer to a wider pointer',
        md: '¬uint32_t v = *(uint32_t *)&rx_buf[3];¬ has three bugs in one line: it assumes the CPU\'s byte order matches the sender\'s, it may read from an unaligned address (which faults on a Cortex-M0+), and it violates C\'s aliasing rules, which lets an optimiser break it. Assemble the value from bytes instead.' },

      { t: 'exercise',
        prompt: `A little-endian MCU holds ¬uint32_t x = 0x0A0B0C0D;¬. Code executes ¬uint8_t *p = (uint8_t *)&x;¬ and then reads ¬p[1]¬. What value is read? Answer in hex.`,
        hints: [
          'p[0] is the byte at the lowest address.',
          'Little-endian puts the least significant byte, 0x0D, at the lowest address. What comes next?',
        ],
        answer: { type: 'text', accept: ['^\\s*(0x)?0?ch?\\s*$'], nudge: 'List the four bytes in address order first.' },
        solution: `In memory, lowest address first: ¬0D 0C 0B 0A¬. ¬p[1]¬ is **¬0x0C¬**. On a big-endian machine it would be ¬0x0B¬. (Reading an object through a ¬uint8_t¬ pointer is allowed by C; it is the wider casts that are dangerous.)` },

      `## Harder application

A sensor returns a 12-bit temperature left-justified in two bytes, high byte first: bytes ¬0x1C¬, ¬0x80¬. A driver
does ¬int16_t raw = *(int16_t *)buf; temp = raw >> 4;¬ on a little-endian MCU and reports nonsense. Give the value
the driver computes, the value it should compute, and a corrected expression. (The driver reads ¬0x801C¬, which as a
signed 16-bit number is negative, then shifts: −2047. The intended value is ¬0x1C80 >> 4 = 0x1C8 = 456¬. Correct:
¬(int16_t)((buf[0] << 8) | buf[1]) >> 4¬, and check the datasheet for whether the shift should be arithmetic.)`,
    ],
    quiz: [
      { q: 'On an MCU with no MMU and no MPU configured, what happens at the moment the stack grows past its reserved area into .bss?', kind: 'arch', choices: [
        { t: 'Nothing visible: the pushes succeed and overwrite global variables', ok: true, why: 'They are valid stores to valid RAM; the damage shows up later, somewhere else.' },
        { t: 'The CPU raises a stack-overflow exception', why: 'Detecting that requires a boundary the hardware knows about, such as a protection region or stack-limit register, which is not configured here.' },
        { t: 'The linker reports an error', why: 'The linker runs at build time and cannot know how deep calls go at run time.' },
      ] },
      { q: 'A heap has 6 KB free in total, yet `malloc(2048)` returns NULL. What is the most likely explanation?', kind: 'concept', choices: [
        { t: 'The free memory is fragmented into pieces each smaller than 2 KB', ok: true, why: 'An allocation needs one contiguous block; total free space is not enough by itself.' },
        { t: 'malloc cannot allocate more than 1 KB at a time', why: 'There is no such general limit; requests are bounded only by the largest free block.' },
        { t: 'The stack has overflowed', why: 'An overflow could corrupt the heap, but the given facts are fully explained without assuming one.' },
      ] },
      { q: 'Which statement about variable lifetime is correct?', kind: 'code', choices: [
        { t: 'Returning the address of a local variable gives a pointer to memory that the next function call will reuse', ok: true, why: 'The frame is released on return; the bytes remain until overwritten, which is why the bug can appear to work.' },
        { t: 'A static local variable is re-created on every call', why: 'It is placed in .data or .bss and exists for the whole program; only its name is local.' },
        { t: 'Heap blocks are freed automatically when the allocating function returns', why: 'Nothing ties a heap block to a function scope; it stays allocated until explicitly freed.' },
      ] },
      { q: 'Why do interrupt handlers matter when sizing the main stack on a Cortex-M?', kind: 'arch', choices: [
        { t: 'Their frames, and the hardware-stacked context, are pushed on top of whatever was running, so worst cases add up', ok: true, why: 'The deepest call chain can be interrupted, and that interrupt can be preempted by a higher-priority one.' },
        { t: 'Handlers allocate their locals from the heap', why: 'Handlers are ordinary functions as far as storage goes; their locals are on a stack.' },
        { t: 'They do not matter: each handler has its own separate stack by default', why: 'Exceptions on this architecture share one stack unless an OS arranges otherwise.' },
      ] },
      { q: 'A little-endian MCU receives the bytes `01 02 03 04` (in that order) into a buffer and copies them into a `uint32_t` with `memcpy`. What value does the variable hold?', kind: 'code', choices: [
        { t: '0x04030201', ok: true, why: 'The first byte lands at the lowest address, which is the least significant byte on a little-endian machine.' },
        { t: '0x01020304', why: 'That is how the bytes would be interpreted if the first byte were the most significant, which is the other byte order.' },
        { t: '0x02010403', why: 'Bytes are not swapped in pairs; the whole word has one ordering.' },
      ] },
      { q: 'What is the main reason a fixed-size block pool does not suffer from fragmentation?', kind: 'concept', choices: [
        { t: 'Every block is the same size, so any free block satisfies any request', ok: true, why: 'Fragmentation arises from mixing sizes; with one size there are no unusable gaps.' },
        { t: 'It compacts memory by moving live blocks', why: 'Moving blocks would invalidate the pointers the program holds; pools do not do that.' },
        { t: 'It never returns blocks to the pool', why: 'Blocks are returned and reused; that is the point of a pool.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 13
  {
    id: 'mcu-cortex-m',
    title: 'Arm Cortex-M architecture',
    minutes: 60,
    summary: 'The register set, modes and stacks, the exception model, faults and the MPU, and what differs between the Cortex-M4F in the MAX78000 and the Cortex-M0+ in the MSPM0L2228.',
    skills: ['mcu-sk-cortexm', 'mcu-sk-irq'],
    blocks: [
      `## The problem

The debugger halts in a function called ¬HardFault_Handler¬. The call stack shows only that one function. LR holds
¬0xFFFF_FFF9¬, which is not an address in your program. The firmware was working yesterday. Where was the
processor when it went wrong, and why? Everything you need is in memory; you have to know where the core put it.`,

      `## Theory

### Registers

| Register | Role |
|---|---|
| ¬r0¬–¬r3¬ | Arguments and return value; a called function may overwrite them (caller-saved) |
| ¬r4¬–¬r11¬ | Must be preserved by a called function (callee-saved) |
| ¬r12¬ | Scratch (caller-saved) |
| ¬r13¬ = **SP** | Stack pointer. Two physical registers exist, **MSP** and **PSP**; one is visible as SP at any time |
| ¬r14¬ = **LR** | Link register: return address after ¬bl¬; holds an ¬EXC_RETURN¬ code inside a handler |
| ¬r15¬ = **PC** | Program counter |
| **xPSR** | Program status: N, Z, C, V flags; the Thumb state bit; and the number of the exception currently being handled (IPSR field) |
| ¬PRIMASK¬ | 1 = mask all configurable-priority exceptions |
| ¬BASEPRI¬, ¬FAULTMASK¬ | Finer masking; ARMv7-M only |
| ¬CONTROL¬ | Selects PSP or MSP in thread mode, and privileged or unprivileged thread mode |

**Thumb.** Cortex-M executes only the Thumb instruction set: mostly 16-bit encodings for code density, with 32-bit
encodings mixed in (Thumb-2). ARMv6-M (Cortex-M0+) has the 16-bit set plus a handful of 32-bit instructions (such as
¬bl¬ and the system-register access instructions). ARMv7-M (Cortex-M3/M4) has the full Thumb-2 set, including
hardware divide, bit-field instructions and conditional execution with ¬it¬ blocks. Low registers ¬r0¬–¬r7¬ are
reachable by all 16-bit instructions; ¬r8¬–¬r12¬ only by some, which is why compilers for the M0+ prefer the low
ones.

### Modes and stacks

- **Thread mode**: normal code. Entered at reset.
- **Handler mode**: entered for any exception; always privileged, always uses MSP.

Thread mode can use either stack pointer. Bare-metal firmware uses MSP for everything. An RTOS gives each task its
own stack on **PSP** and keeps MSP for the kernel and interrupts, so a task's stack overflow cannot directly
destroy the stack that handlers run on.

### Exceptions

"Exception" is the Arm term for anything that diverts execution through the vector table: reset, faults, system
calls, and interrupts. Numbers 1–15 are defined by Arm; 16 and up are the chip's peripheral interrupts, managed by
the **NVIC** (nested vectored interrupt controller), which is part of the core, not a vendor peripheral.

| No. | Name | Purpose |
|---|---|---|
| 1 | Reset | |
| 2 | NMI | Non-maskable interrupt |
| 3 | HardFault | Any fault with no enabled specific handler, and all faults on ARMv6-M |
| 4, 5, 6 | MemManage, BusFault, UsageFault | ARMv7-M only: MPU violation; bus error; undefined instruction, divide by zero, bad state |
| 11 | SVCall | ¬svc¬ instruction: system call into an OS |
| 14 | PendSV | Software-requested, lowest priority: used for context switches |
| 15 | SysTick | The core's 24-bit down-counting system timer |
| 16+ | IRQ0… | Peripheral interrupts |

Priority is a number; **lower is more urgent**. Reset, NMI and HardFault have fixed negative priorities (−3, −2, −1)
and so always win. Chips implement only the top bits of each 8-bit priority field: 2 bits on ARMv6-M (four levels,
as on the MSPM0L2228), and from 3 to 8 bits on ARMv7-M as the chip maker chooses.

### Exception entry: the stack frame

When an exception is taken, the hardware:

1. Pushes eight words onto the stack in use (MSP or PSP).
2. Reads the vector and loads PC.
3. Sets LR to an **EXC_RETURN** value that records which stack was used and which mode to return to.
4. Switches to handler mode and MSP.`,

      { t: 'ascii', caption: 'Basic exception stack frame (no floating-point context). SP points at the stacked r0 on handler entry.',
        text: R`  higher addresses    (stack contents before the exception)
        SP + 0x1C      xPSR      <- status at the moment of the exception
        SP + 0x18      PC        <- return address: where execution was interrupted
        SP + 0x14      LR        <- the interrupted code's link register
        SP + 0x10      r12
        SP + 0x0C      r3
        SP + 0x08      r2
        SP + 0x04      r1
        SP + 0x00      r0        <- SP on entry to the handler
  lower addresses

  EXC_RETURN in LR:   0xFFFFFFF1  return to handler mode, frame on MSP   (nested exception)
                      0xFFFFFFF9  return to thread mode,  frame on MSP
                      0xFFFFFFFD  return to thread mode,  frame on PSP   (RTOS task)` },

      `The handler returns with an ordinary function return. Loading an ¬EXC_RETURN¬ value into PC is what tells the
core to pop the frame and resume. The stacked registers are exactly the caller-saved set, so handlers are plain
C functions.

With an FPU in use (Cortex-M4F), the frame can be extended with floating-point registers ¬s0¬–¬s15¬ and the
floating-point status word. **Lazy stacking** reserves the space but only writes it if the handler actually uses
the FPU, keeping latency low.`,

      { t: 'widget', name: 'interrupt-flow', props: { arch: 'cortex-m' }, title: 'Entry, nesting and return',
        caption: 'Run the nested-priority case. Note the EXC_RETURN value in LR at each level and say what it means.' },

      `## Worked example: where did it fault?

Back to the opening problem. LR = ¬0xFFFF_FFF9¬ means "thread mode, frame on MSP". So the frame is at MSP. The
debugger shows:

¬¬¬
(gdb) x/8xw $msp
0x20007f98:  0x00000000  0x20000410  0x00000040  0x0000000a
0x20007fa8:  0x00000000  0x0800123d  0x08001a52  0x61000000
¬¬¬

Reading it against the frame layout: r0 = 0, r1 = ¬0x2000_0410¬, r2 = ¬0x40¬, r3 = ¬0xA¬, r12 = 0,
LR = ¬0x0800_123D¬, **PC = ¬0x0800_1A52¬**, xPSR = ¬0x6100_0000¬.

- The faulting instruction is at ¬0x0800_1A52¬. Ask the debugger: ¬info line *0x08001a52¬ or look it up in the
  disassembly. Suppose it is a ¬str¬ through ¬r0¬ inside ¬memset¬.
- r0 is 0: a write through a null pointer. On this (hypothetical) chip address 0 is flash, so the store faulted.
- The stacked LR, ¬0x0800_123D¬, is where ¬memset¬ was called from (clear bit 0): that names the guilty caller.
- xPSR has the Thumb bit (bit 24) set and an exception number of 0: the fault happened in thread mode.

On an ARMv7-M core the fault status registers in the System Control Block (CFSR, HFSR, and the fault address
registers MMFAR and BFAR) say more: which kind of fault, and for some bus faults the exact address accessed. ARMv6-M
has none of these; the stacked frame is all the evidence there is. The ¬debug-session¬ tool in the debugging
section lets you practise this on a simulated target.`,

      { t: 'predict',
        q: 'Firmware written for a Cortex-M4 reads a `uint32_t` from an odd address inside a received packet using a pointer cast. It is ported unchanged to a Cortex-M0+. What happens at that line?',
        choices: [
          { t: 'It works the same way: both are little-endian Arm cores', why: 'Byte order is the same, but this access also has an alignment property. Do both architectures treat that the same?' },
          { t: 'The Cortex-M0+ takes a HardFault, because ARMv6-M does not support unaligned word accesses', ok: true, why: 'ARMv7-M performs most unaligned loads as multiple bus accesses; ARMv6-M always faults on them.' },
          { t: 'The compiler rejects the code for the Cortex-M0+', why: 'The address is a run-time value; the compiler has no way to know it is odd.' },
        ],
        reveal: 'Code that is wrong but tolerated on one core becomes a crash on another. Assemble multi-byte values from bytes (previous lesson) and the question never arises. This is one of the first things to check when a port from an M4 to an M0+ hard-faults in protocol code.' },

      `### The MPU

The optional **memory protection unit** lets privileged code define a small number of regions (commonly 8), each with
a base, a size and access permissions: no access, read-only, read/write, execute-never. An access that violates
them raises MemManage (ARMv7-M) or HardFault (ARMv6-M). It does not translate addresses; it only permits or
refuses. Both course cores have one. Uses:

- a no-access region at the end of the stack: overflow faults immediately instead of corrupting data;
- RAM marked execute-never, so injected data cannot be run as code;
- flash marked read-only and task memory isolated, under an RTOS that runs tasks unprivileged.

### Cortex-M0+ versus Cortex-M4F

| | Cortex-M0+ (MSPM0L2228) | Cortex-M4F (MAX78000) |
|---|---|---|
| Architecture | ARMv6-M | ARMv7E-M |
| Instruction set | 16-bit Thumb plus a few 32-bit instructions | Full Thumb-2, plus DSP extension (saturating and SIMD-style arithmetic, single-cycle multiply-accumulate) |
| Hardware divide | No (library routine) | Yes (¬sdiv¬, ¬udiv¬) |
| Floating point | Software only (the eCTF 2026 build uses ¬-mfloat-abi=soft¬) | Single-precision FPU; ¬double¬ is still done in software |
| Fault exceptions | HardFault only; no fault status registers | HardFault, MemManage, BusFault, UsageFault, with status and address registers |
| Interrupt priority bits | 2 (4 levels) | 3 to 8, chip-specific: see the device header's ¬__NVIC_PRIO_BITS¬ |
| Interrupt masking | PRIMASK only | PRIMASK, FAULTMASK, BASEPRI (mask below a chosen priority) |
| Interrupt lines | Up to 32 | Up to 240 |
| Unaligned access | Always faults | Supported for most instructions |
| Lock-free updates | No exclusive-access instructions | ¬ldrex¬/¬strex¬ for lock-free updates |
| MPU, VTOR | Optional in the architecture; present on the MSPM0L2228 | Present |

Practical consequences when moving code to the M0+: ¬float¬ arithmetic and division become slow library calls; code
that relied on BASEPRI for critical sections must use PRIMASK; fault handlers have less to report; four priority
levels must be shared among all interrupts.`,

      { t: 'callout', kind: 'mistake', title: 'Reading "priority 5" as higher than "priority 2"',
        md: 'On Cortex-M the numerically lower value preempts the higher. And because only the top bits of the priority field exist, writing a raw value that uses unimplemented low bits silently rounds: on a 2-bit chip, raw priorities 0x00–0x3F are all the same level. Use the vendor or CMSIS priority-setting function and the number of levels from the device header.' },

      { t: 'callout', kind: 'security', title: 'What the architecture gives a defender',
        md: 'Execute-never RAM regions, a stack guard region, privileged/unprivileged separation with ¬svc¬ as the only way in, and fault handlers that record PC and LR before resetting. None is enabled by default. Each one you turn on converts a class of silent corruption into an immediate, logged fault. Verify by writing a test that deliberately violates the rule and checking that the fault fires.' },

      { t: 'exercise',
        prompt: `In a HardFault handler on a Cortex-M0+, LR holds ¬0xFFFFFFF9¬ and MSP is ¬0x2020_7FA0¬. At what address is the stacked PC (the address of the instruction that was executing when the fault occurred)? Answer in hex.`,
        hints: [
          'The frame starts at SP with r0, then r1, r2, r3, r12, LR, PC, xPSR, four bytes each.',
          'PC is the seventh word: offset 6 × 4 = 0x18.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0x)?2020_?7fb8h?\\s*$'], nudge: 'Count the words from r0 at offset 0.' },
        solution: `¬0xFFFFFFF9¬ confirms the frame is on MSP. PC is at offset ¬0x18¬: ¬0x2020_7FA0 + 0x18¬ = **¬0x2020_7FB8¬**. Read that word (¬x/xw 0x20207fb8¬) to get the faulting instruction's address.` },

      `## Harder application

Write, in words, a HardFault handler that works on both course cores and gives a field engineer something useful.
Consider: which stack pointer holds the frame (test bit 2 of ¬EXC_RETURN¬), what to do if the fault *was* a stack
overflow so the stack itself is unusable (switch to a small dedicated stack first), where to store the stacked PC
and LR so they survive the reset that follows (a no-init RAM section, checked and reported on the next boot),
and what must not be done in the handler (anything that could fault again, since a fault inside HardFault locks
the core up).`,

      { t: 'refs', items: [
        { title: 'Arm developer documentation (ARMv6-M and ARMv7-M Architecture Reference Manuals; Cortex-M0+ and Cortex-M4 Devices Generic User Guides)', url: 'https://developer.arm.com/documentation', note: 'Search for the document titles. The exception model chapter of each ARM ARM is the authority for everything in this lesson.' },
        { title: 'CMSIS core headers', url: 'https://github.com/ARM-software/CMSIS_6', note: 'core_cm0plus.h and core_cm4.h define the system registers named here.' },
        { title: 'MSPM0L222x device header (core configuration)', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/mspm0l222x.h' },
        { title: 'MAX78000 device header (core configuration)', url: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/max78000.h' },
      ] },
    ],
    quiz: [
      { q: 'Inside an interrupt handler on a Cortex-M, LR contains `0xFFFFFFFD`. What does that tell you?', kind: 'arch', choices: [
        { t: 'The interrupted code was in thread mode using the process stack (PSP), so the exception frame is on PSP', ok: true, why: 'This EXC_RETURN value encodes "return to thread mode, restore from PSP", the usual case for an RTOS task.' },
        { t: 'The handler was called from address 0xFFFFFFFD', why: 'Values in this range are not code addresses; they are special codes recognised on return.' },
        { t: 'A fault occurred during stacking', why: 'Stacking faults are reported through fault exceptions and status bits, not through this value.' },
      ] },
      { q: 'Which registers does a Cortex-M push automatically on exception entry (without FPU context)?', kind: 'arch', choices: [
        { t: 'r0–r3, r12, LR, PC and xPSR', ok: true, why: 'Eight words: the caller-saved registers plus the return address and status.' },
        { t: 'All of r0–r15', why: 'Callee-saved registers r4–r11 are left for the handler\'s own compiled prologue to save if it uses them.' },
        { t: 'Only PC and xPSR', why: 'That would not be enough for a C function to run safely as a handler.' },
      ] },
      { q: 'Two interrupts are configured on a Cortex-M: A with priority 1 and B with priority 3. B\'s handler is running when A becomes pending. What happens?', kind: 'arch', choices: [
        { t: 'A preempts B immediately; B resumes when A returns', ok: true, why: 'A lower priority number is more urgent, so it nests on top of the running handler.' },
        { t: 'A waits until B finishes, because 3 is greater than 1', why: 'This reads the numbers as "bigger wins"; the architecture orders them the other way.' },
        { t: 'Both handlers are abandoned and a HardFault is raised', why: 'Nesting is a normal, supported situation and involves no fault.' },
      ] },
      { q: 'A divide-by-zero trap is enabled on a Cortex-M4 and the same source is built for a Cortex-M0+. How is the divide-by-zero reported on the M0+?', kind: 'arch', choices: [
        { t: 'There is no hardware divide instruction; division is a library call whose behaviour for zero is defined by that library', ok: true, why: 'ARMv6-M lacks sdiv/udiv and the UsageFault that would report them, so the hardware plays no part.' },
        { t: 'As a UsageFault with the DIVBYZERO bit set', why: 'That fault and its status register belong to the larger architecture profile.' },
        { t: 'As a BusFault', why: 'Bus faults concern memory accesses, and this architecture profile does not have a separate one anyway.' },
      ] },
      { q: 'What does an MPU region configured as "no access" at the bottom of a task\'s stack achieve?', kind: 'security', choices: [
        { t: 'A stack overflow faults at once instead of silently overwriting adjacent memory', ok: true, why: 'The first push into the guard region violates the permission and raises an exception.' },
        { t: 'It increases the size of the stack', why: 'It consumes a little of the stack space; it adds none.' },
        { t: 'It encrypts the stack contents', why: 'A protection unit checks permissions on accesses; it does not transform data.' },
      ] },
      { q: 'Why does an RTOS on Cortex-M run tasks on PSP and keep MSP for handlers?', kind: 'concept', choices: [
        { t: 'Each task gets its own stack, and interrupts do not consume, or depend on, any task\'s stack', ok: true, why: 'Handler mode always uses MSP, so interrupt stack usage is budgeted once rather than in every task.' },
        { t: 'PSP is faster to access than MSP', why: 'They are the same kind of register; there is no speed difference.' },
        { t: 'MSP can only be used at reset', why: 'It is used at reset and by every exception handler thereafter.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 14
  {
    id: 'mcu-riscv',
    title: 'RISC-V architecture',
    minutes: 50,
    summary: 'An open instruction set built from a small base and optional extensions: registers and their ABI names, the control and status registers that run the trap mechanism, and where RISC-V appears on the course platforms.',
    skills: ['mcu-sk-riscv', 'mcu-sk-irq'],
    blocks: [
      `## The problem

You move a project from the original ESP32 to an ESP32-C3 because of cost. The C code compiles. The crash dump,
however, no longer talks about the registers you learned: it lists ¬MEPC¬, ¬MCAUSE¬, ¬MTVAL¬, ¬RA¬, ¬SP¬, ¬A0¬.
Meanwhile the MAX78000 on the next bench has a second core that the documentation calls "RV32". To debug either,
you need a second mental model beside the Cortex-M one.`,

      `## Theory

### A base and extensions

RISC-V is an open instruction-set *specification*, not a core. Anyone may implement it. It is modular: a small
mandatory base plus named extensions, spelled out in the architecture string.

| Letter | Adds |
|---|---|
| **RV32I** | Base 32-bit integer set: 32 registers, load/store, add/sub, logic, shifts, compare, branches, jumps. No multiply |
| **E** | Alternative base with only 16 registers, for the smallest cores |
| **M** | Integer multiply and divide |
| **A** | Atomic instructions: load-reserved/store-conditional and atomic read-modify-write |
| **F**, **D** | Single- and double-precision floating point |
| **C** | Compressed 16-bit encodings of common instructions (the counterpart of Thumb's density) |
| **Zicsr** | The CSR access instructions |

"RV32IMC" therefore means: 32-bit base, multiply/divide, compressed instructions. The ESP-IDF build for a given chip
states the string it compiles for; check it rather than assuming, because it decides which instructions exist.

Base instructions are 32 bits wide; with C, 16-bit and 32-bit instructions are mixed, and instructions need
only be 2-byte aligned.

### Registers

There are 32 integer registers ¬x0¬–¬x31¬ and a separate ¬pc¬. ¬x0¬ is hard-wired to zero: writes are discarded.
Nothing in the hardware makes any other register special; their roles come from the calling convention (ABI), and
tools show the ABI names.

| Register | ABI name | Role | Saved by |
|---|---|---|---|
| ¬x0¬ | ¬zero¬ | Constant 0 | — |
| ¬x1¬ | ¬ra¬ | Return address | caller |
| ¬x2¬ | ¬sp¬ | Stack pointer | callee |
| ¬x3¬ | ¬gp¬ | Global pointer | — |
| ¬x4¬ | ¬tp¬ | Thread pointer | — |
| ¬x5¬–¬x7¬, ¬x28¬–¬x31¬ | ¬t0¬–¬t6¬ | Temporaries | caller |
| ¬x8¬, ¬x9¬, ¬x18¬–¬x27¬ | ¬s0¬/¬fp¬, ¬s1¬–¬s11¬ | Saved registers | callee |
| ¬x10¬–¬x17¬ | ¬a0¬–¬a7¬ | Arguments; ¬a0¬/¬a1¬ return values | caller |

There is **no flags register**. A conditional branch compares two registers itself: ¬beq a0, a1, label¬,
¬bltu t0, t1, label¬. A call is ¬jal ra, target¬ (jump and link); return is ¬jalr zero, 0(ra)¬, written ¬ret¬.

### Privilege modes and CSRs

RISC-V defines privilege modes: **Machine (M)**, always present and all-powerful; optionally **Supervisor (S)**
and **User (U)**. A small microcontroller core implements M only, or M and U.

The processor's control state lives in **control and status registers (CSRs)**, a separate 12-bit address space
reached only by special instructions (¬csrr¬ to read, ¬csrw¬ to write, ¬csrs¬/¬csrc¬ to set or clear bits). They
are *not* memory-mapped.

| CSR | Purpose |
|---|---|
| ¬mstatus¬ | Global state. Bit 3 **MIE**: machine interrupts enabled. Bit 7 **MPIE**: the previous MIE, saved on trap entry. Bits 12:11 **MPP**: the previous privilege mode |
| ¬mtvec¬ | Trap vector base address. Low 2 bits select the mode: 0 = **direct** (every trap jumps to the base), 1 = **vectored** (interrupts jump to base + 4 × cause) |
| ¬mepc¬ | PC of the instruction that was interrupted or that caused the exception |
| ¬mcause¬ | Why: top bit 1 = interrupt, 0 = exception; the remaining bits are the cause code |
| ¬mtval¬ | Extra information: the faulting address, or the bad instruction |
| ¬mie¬ / ¬mip¬ | Per-source interrupt enable / pending bits |
| ¬mscratch¬ | A spare word for the trap handler, typically a pointer to a save area |

Standard cause codes worth recognising: interrupts 3 (machine software), 7 (machine timer), 11 (machine external);
exceptions 0 (instruction address misaligned), 1 (instruction access fault), 2 (illegal instruction), 3
(breakpoint), 4/6 (load/store address misaligned), 5/7 (load/store access fault), 8/11 (¬ecall¬ from U/M mode).

### Taking a trap

"Trap" covers both interrupts and exceptions. In machine mode the hardware does this and no more:

1. ¬mepc¬ ← current PC.
2. ¬mcause¬ ← cause (and ¬mtval¬ ← detail).
3. ¬mstatus.MPIE¬ ← ¬mstatus.MIE¬; ¬mstatus.MIE¬ ← 0 (interrupts off); ¬mstatus.MPP¬ ← current mode.
4. PC ← address derived from ¬mtvec¬.

No general register is saved and nothing is pushed. The handler must save every register it will use, do its
work, restore them, and execute ¬mret¬, which restores MIE from MPIE, the mode from MPP, and PC from ¬mepc¬.
For a synchronous exception such as ¬ecall¬, ¬mepc¬ points *at* the instruction, so a handler that wants to continue
after it must add the instruction's length to ¬mepc¬ first.`,

      { t: 'widget', name: 'interrupt-flow', props: { arch: 'riscv' }, title: 'A RISC-V machine-mode trap',
        caption: 'Step it and list, in order, every CSR the hardware writes. Then list what the software prologue has to save.' },

      { t: 'code', lang: 'asm', status: 'reviewed', caption: 'Shape of a minimal direct-mode trap entry (saves only the caller-saved registers before calling C)',
        code: R`trap_entry:
    addi  sp, sp, -64          # make room on the interrupted code's stack
    sw    ra,  0(sp)           # save every register a C function may overwrite:
    sw    t0,  4(sp)           #   ra, t0-t6, a0-a7 (16 words)
    sw    t1,  8(sp)
    # ... t2, a0-a7, t3-t6 saved the same way ...
    csrr  a0, mcause           # first argument: why
    csrr  a1, mepc             # second argument: where
    call  trap_handler_c       # C code decides what to do; returns new mepc in a0
    csrw  mepc, a0
    # ... restore t1-t6, a0-a7 ...
    lw    t0,  4(sp)
    lw    ra,  0(sp)
    addi  sp, sp, 64
    mret                       # MIE <- MPIE, pc <- mepc`,
        explain: [
          { lines: '2-5', md: 'This is the work a Cortex-M does in hardware. Here it is visible, and costs instructions and time. A compiler emits the equivalent for functions marked ¬__attribute__((interrupt))¬.' },
          { lines: '7-8', md: 'CSRs are read with ¬csrr¬ into ordinary registers; they cannot be loaded from an address.' },
          { lines: '9', md: 'The C function is a normal function, so it preserves the callee-saved registers ¬s0¬–¬s11¬ itself. That is why the stub need not save them.' },
          { lines: '15', md: '¬mret¬ is the only way back. A plain ¬ret¬ would jump to whatever ¬ra¬ holds and leave interrupts disabled.' },
        ] },

      `### Interrupt controllers

The core has just three standard machine interrupt inputs: software, timer, external. The classic companions are:

- **CLINT** (core-local interruptor): memory-mapped ¬mtime¬ and ¬mtimecmp¬ registers that raise the timer interrupt
  when time reaches the compare value, and a software-interrupt bit.
- **PLIC** (platform-level interrupt controller): gathers many peripheral sources into the one external interrupt.
  Each source has a priority and an enable; the handler *claims* the highest-priority pending source by reading a
  register, services it, and writes the same number back to signal *completion*.

Microcontroller vendors often replace these with their own controllers that add per-interrupt vectors and
preemption levels. Do not assume a standard PLIC and CLINT on a given chip: read the interrupt chapter of its
reference manual.

## On the course platforms

**ESP32 family.** The original ESP32 and the ESP32-S3 use Xtensa cores (two of them). The **ESP32-C3 and ESP32-C6
are RISC-V**, single core, with CPU frequencies up to 160 MHz. Their ROM loads the second-stage bootloader from
flash offset ¬0x0¬, not ¬0x1000¬. ESP-IDF hides most of the difference; you meet RISC-V in panic dumps (which list
MEPC, MCAUSE, MTVAL and the ABI-named registers), in the debugger, and in any assembly or ¬naked¬ functions.

**MAX78000.** Besides the Cortex-M4 there is a RISC-V core. It does not start by itself: the Arm core must set
it up and hand over, the two share peripherals and coordinate through inter-core semaphores, and it is debugged
through a separate JTAG port. The MSDK device header has a separate interrupt map for it. Which RV32 variant and
extensions it implements is a user-guide item; look it up before writing code for it.`,

      { t: 'predict',
        q: 'A RISC-V trap handler written in C is declared as an ordinary function (no interrupt attribute, no assembly stub) and installed directly in `mtvec`. It increments a counter and returns. What happens?',
        choices: [
          { t: 'It works: the hardware saves and restores registers as on Cortex-M', why: 'Check the four steps of trap entry again. Which general registers did the hardware save?' },
          { t: 'The interrupted code resumes at the wrong place or with corrupted temporaries, and interrupts stay disabled', ok: true, why: 'An ordinary function ends with ret (a jump to ra, which still belongs to the interrupted code), clobbers caller-saved registers, and never executes mret.' },
          { t: 'The CPU refuses to enter a handler without the attribute', why: 'The hardware jumps to whatever address the trap vector holds; it cannot inspect how the code was compiled.' },
        ],
        reveal: 'The failure is intermittent, because it depends on what the interrupted code had in its temporaries and in ra at that instant. This is the single most important behavioural difference from Cortex-M: there, a handler is a C function; here, something must make it one.' },

      { t: 'callout', kind: 'mistake', title: 'Looking for a flags register',
        md: 'People coming from Arm search a RISC-V register dump for N, Z, C, V. There are none. Comparisons happen inside the branch instruction, and carry is computed explicitly with ¬sltu¬ when multi-word arithmetic needs it. In disassembly, read the branch itself to see the condition.' },

      { t: 'callout', kind: 'decision', title: 'Does the architecture matter for your application?',
        md: 'For C application code, rarely: the compiler and the vendor SDK hide it. It matters for start-up code, interrupt entry, context switches, fault diagnosis, reading disassembly during reverse engineering, and anything timing-critical. Choose a chip for its peripherals, memory, power, tools and security features first; then learn the architecture it happens to bring.' },

      `## Worked example: decoding a trap

A panic dump on a RISC-V MCU shows:

¬¬¬
MEPC    : 0x42001a3c   RA : 0x42001a20   SP : 0x3fc91f40
MCAUSE  : 0x00000007   MTVAL : 0x00000004
¬¬¬

- ¬mcause¬ top bit is 0: an exception, not an interrupt. Code 7: store access fault.
- ¬mtval¬ = 4: the address the store tried to write. Address 4 is a null pointer plus an offset of 4, typically
  writing the second field of a struct through a ¬NULL¬ pointer.
- ¬mepc¬ = ¬0x4200_1A3C¬: the store instruction. Look it up with ¬addr2line¬ or the debugger.
- ¬ra¬ = ¬0x4200_1A20¬: the current function was called from just before that address (or is the same function, if
  it has made no calls yet).

Had ¬mcause¬ been ¬0x8000_0007¬, the top bit would mark an interrupt and code 7 would mean the machine timer.
The same number means different things depending on that bit.`,

      { t: 'exercise',
        prompt: `A RISC-V core reports ¬mcause = 0x8000000B¬. Is this an interrupt or an exception, and which standard cause is it? Answer with the cause's usual name.`,
        hints: [
          'The most significant bit distinguishes interrupts from exceptions.',
          'The low bits are 0xB = 11. Look up interrupt code 11 in the table above.',
        ],
        answer: { type: 'text', accept: ['external'], nudge: 'Top bit set means interrupt; then decode the number 11.' },
        solution: `The top bit is set, so it is an **interrupt**; code 11 is the **machine external interrupt**, the one driven by the platform's interrupt controller on behalf of a peripheral. The handler must now ask that controller which source it was.` },

      `## Harder application

Compare the cost of interrupt entry on the two architectures. On Cortex-M the hardware always stacks eight words.
On RISC-V a hand-written handler for a simple event can save only the two or three registers it uses. Describe one
situation where each approach has lower latency, and one where each is more error-prone. Then explain why a
RISC-V RTOS port must save all 31 registers on a context switch but only the caller-saved set when calling a C
interrupt handler.`,

      { t: 'refs', items: [
        { title: 'RISC-V ISA manual (unprivileged and privileged specifications, source)', url: 'https://github.com/riscv/riscv-isa-manual', note: 'The privileged volume\'s "Machine-Level ISA" chapter defines every CSR in this lesson.' },
        { title: 'RISC-V specifications index', url: 'https://riscv.org/specifications/' },
        { title: 'ESP-IDF SoC capability files (which chips are RISC-V)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32c3/include/soc/Kconfig.soc_caps.in' },
        { title: 'MSDK User Guide (RISC-V core on the MAX78000)', url: 'https://github.com/analogdevicesinc/msdk/blob/main/USERGUIDE.md' },
      ] },
    ],
    quiz: [
      { q: 'What does the architecture string RV32IMC tell you?', kind: 'arch', choices: [
        { t: '32-bit base integer instructions, plus multiply/divide, plus compressed 16-bit encodings', ok: true, why: 'Each letter after the base names one standard extension.' },
        { t: '32 registers, integrated memory controller', why: 'The letters are extension names, not hardware features such as memory controllers.' },
        { t: 'A 32-bit core with interrupts, MPU and cache', why: 'None of those are denoted by these letters; they describe instruction-set extensions only.' },
      ] },
      { q: 'On trap entry in machine mode, where does a RISC-V core save the interrupted PC?', kind: 'arch', choices: [
        { t: 'In the mepc CSR', ok: true, why: 'Nothing is pushed to memory; the return address is held in a control register until mret.' },
        { t: 'On the stack, with seven other registers', why: 'That is the other architecture\'s automatic stacking; this one writes no memory on entry.' },
        { t: 'In ra (x1)', why: 'ra is left untouched and still holds the interrupted code\'s own return address.' },
      ] },
      { q: 'How does RISC-V code perform "branch if a < b"?', kind: 'code', choices: [
        { t: 'With a single instruction that compares two registers and branches, such as `blt a0, a1, label`', ok: true, why: 'Compare-and-branch is fused; there is no status register to hold a comparison result.' },
        { t: 'With a compare instruction that sets flags, then a conditional branch', why: 'That two-step scheme needs a flags register, which this architecture does not have.' },
        { t: 'By subtracting and testing the carry flag', why: 'There is no carry flag to test.' },
      ] },
      { q: 'Which of these chips have RISC-V CPUs, according to the ESP-IDF sources?', kind: 'arch', choices: [
        { t: 'ESP32-C3 and ESP32-C6', ok: true, why: 'Both are single-core RISC-V parts; the original ESP32 and the S3 are Xtensa.' },
        { t: 'ESP32 and ESP32-S3', why: 'Those two are the dual-core Xtensa members of the family.' },
        { t: 'All chips with "ESP32" in the name', why: 'The family spans two different CPU architectures; the name does not indicate which.' },
      ] },
      { q: 'A handler for an `ecall` exception returns with `mret` without changing `mepc`. What happens?', kind: 'code', choices: [
        { t: 'The same ecall executes again, trapping forever', ok: true, why: 'For synchronous exceptions mepc points at the trapping instruction itself, so returning there repeats it.' },
        { t: 'Execution continues with the instruction after the ecall', why: 'That requires the handler to advance the saved PC by the instruction length; the hardware does not do it.' },
        { t: 'The core switches to user mode permanently', why: 'The mode restored comes from the saved previous-privilege field and is unrelated to where execution resumes.' },
      ] },
      { q: 'What is special about the MAX78000\'s RISC-V core at power-up?', kind: 'arch', choices: [
        { t: 'It does not run until the Arm core has set it up and handed over to it', ok: true, why: 'The Cortex-M4 is the boot core; the second core is started by firmware.' },
        { t: 'It boots first and then starts the Arm core', why: 'The order is the reverse; the vendor documentation describes the Arm core as the one that starts the other.' },
        { t: 'It runs the same binary as the Arm core in parallel', why: 'The two cores have different instruction sets and cannot execute the same machine code.' },
      ] },
    ],
  },
];
