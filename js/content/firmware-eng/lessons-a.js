// Firmware engineering, part A: buffers, stack, state machines.
import { clRingPutGet, clRingOffByOne, clFrameBounds, clStackPaint, clRecursion, clDebounce, clNonBlocking,
  clLineReceiver, clTableFsm } from './clabs.js';

const C = String.raw;

/* ============================================================== 1. Buffer management */
const buffers = {
  id: 'fw-buffers', title: 'Buffer management: FIFOs, framing and bounds', minutes: 55,
  summary: 'Why bytes arriving from a UART need a ring buffer, how to build one that an interrupt can share with the main loop, and how to turn a byte stream into messages without trusting it.',
  skills: ['fw-ringbuf', 'fw-framing'],
  blocks: [
    `## The problem

A UART at 115200 baud delivers a new byte roughly every 87 µs. The hardware has room for one received byte (some UARTs have a small hardware FIFO; check the chip's reference manual for its depth). If your code has not taken the byte out of the data register before the next one finishes arriving, the UART sets an **overrun** flag and one of the two bytes is gone.

Your main loop also updates a display, which takes 4 ms. During those 4 ms about 46 bytes arrive. Where do they go?

The answer has two parts:

1. An **interrupt** takes each byte out of the UART the moment it arrives. That takes a few microseconds, so no byte is lost in the hardware.
2. The interrupt cannot *process* the byte (parsing a command inside an interrupt handler would block every other interrupt). So it puts the byte in a queue, and the main loop takes bytes out of the queue when it has time.

That queue is a **ring buffer**, also called a circular buffer or FIFO. It is the most common data structure in firmware, and it is easy to get subtly wrong.`,

    `## How a ring buffer works

A ring buffer is a plain array plus two indices:

- \`head\`: where the next byte will be **written**.
- \`tail\`: where the next byte will be **read**.

Writing stores at \`head\` and advances it. Reading fetches from \`tail\` and advances it. When an index reaches the end of the array it wraps to 0. Data is never moved: only the indices move.`,
    { t: 'ascii', text:
`index:    0    1    2    3    4    5    6    7
        +----+----+----+----+----+----+----+----+
        | X  | Y  |    |    | d  | e  | f  | g  |
        +----+----+----+----+----+----+----+----+
                    ^         ^
                   head      tail
   Reading order: d e f g X Y      (tail runs to 7, wraps to 0, stops at head)
   Next write goes to index 2. Free slots: 2 and 3, but only ONE may be used (see below).`,
      caption: 'An 8-slot ring buffer holding six bytes that wrap around the end of the array.' },
    `### Empty or full?

If \`head == tail\`, no bytes are waiting: the buffer is **empty**. But fill all eight slots and \`head\` comes round to equal \`tail\` again. The same condition would mean both empty and full.

There are three standard ways out:

| Approach | Full when | Cost |
|---|---|---|
| **Keep one slot empty** | \`(head + 1) % size == tail\` | An N-slot array holds N−1 bytes |
| Separate \`count\` variable | \`count == size\` | Both sides write \`count\`: it needs a critical section |
| Free-running indices (never wrapped when stored, only when used as an array index) | \`head - tail == size\` | Size must be a power of two; slightly harder to read |

This course uses the first. The reason is the next heading.`,

    `### One producer, one consumer

The interrupt handler and the main loop both touch the buffer, and the interrupt can fire between any two machine instructions of the main loop. Normally that calls for disabling interrupts around every access. The ring buffer avoids it with one rule:

> **Only the producer writes \`head\`. Only the consumer writes \`tail\`.**

The producer (the ISR) reads \`tail\` to check for "full" but never changes it. The consumer (the main loop) reads \`head\` to check for "empty" but never changes it. Each index has exactly one writer, so there is no read-modify-write that the other side can interrupt halfway.

This is called **single-producer/single-consumer (SPSC)** discipline. It holds on a single-core MCU provided that:

- each index can be read and written in **one machine instruction** (on a 32-bit MCU: any type up to 32 bits; on an 8-bit AVR a 16-bit index is *two* instructions and the rule breaks);
- the indices are \`volatile\`, so the compiler re-reads them instead of caching a copy in a register;
- there really is one producer and one consumer. Two tasks calling \`rb_put\` on the same buffer need a lock.

A shared \`count\` variable breaks the rule: both sides would write it. That is why the one-empty-slot scheme is preferred.`,
    { t: 'callout', kind: 'hw', md: `On a multi-core chip (the original ESP32 has two cores, per the ESP-IDF Kconfig) "the interrupt cannot run at the same time as the main loop" is no longer true, and the compiler and CPU may also reorder memory accesses. Use the RTOS's queue or stream-buffer primitives there instead of a hand-rolled ring buffer, unless you know both ends are pinned to the same core.` },

    `## Worked example: the ring buffer in this course's example code

The file \`examples/firmware-eng/src/ringbuf.c\` is a complete implementation, and \`tests/test_ringbuf.c\` exercises it on the host. Its two central functions:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/src/ringbuf.c (excerpt). Built and run by `make test`.',
      code: C`bool rb_put(ringbuf_t *rb, uint8_t byte)
{
    uint16_t head = rb->head;
    uint16_t next = (uint16_t)((head + 1u) & rb->mask);
    if (next == rb->tail) {          /* advancing would make head == tail, which means "empty" */
        rb->dropped++;
        return false;                /* overflow policy: drop the newest byte, keep the old ones */
    }
    rb->buf[head] = byte;            /* store first ...                                   */
    rb->head = next;                 /* ... publish second: the consumer never sees a slot
                                        that has not been written yet                     */
    return true;
}

bool rb_get(ringbuf_t *rb, uint8_t *byte)
{
    uint16_t tail = rb->tail;
    if (tail == rb->head) return false;          /* empty */
    *byte = rb->buf[tail];
    rb->tail = (uint16_t)((tail + 1u) & rb->mask);
    return true;
}`,
      explain: [
        { lines: '3', md: 'One read of the volatile `head` into a local. The CPU loads it from RAM once; everything after works on a register copy.' },
        { lines: '4', md: '`& rb->mask` is the wrap. With a power-of-two size, `mask = size - 1` and the AND is a single instruction. `% size` would be a division, which on a Cortex-M0+ (no divide instruction) is a library call of dozens of cycles, inside an interrupt.' },
        { lines: '5-8', md: 'The full check compares the *wrapped next* index with `tail`. The buffer refuses the byte and counts it. Counting matters: a drop you cannot see is a bug you cannot find.' },
        { lines: '9-10', md: 'Order matters. The store to `buf[head]` happens before the store to `rb->head`. The consumer learns about the byte only through `head`, so it can never read a slot that has not been filled.' },
        { lines: '17', md: 'Empty check: one read of `head`. If the ISR adds a byte one instruction later, the consumer simply sees it on its next call.' },
      ] },

    `### Overflow policy is a design decision

When the buffer is full and another byte arrives, something has to give. The options:

| Policy | Effect | Use when |
|---|---|---|
| **Drop newest** (refuse the put) | Old data intact, the stream has a gap at the end | Commands and protocols: a frame's start stays valid; safe for SPSC |
| **Overwrite oldest** | Always holds the most recent N bytes | Logs and sensor history, where fresh data matters most. The producer must then move \`tail\`, which breaks the one-writer rule: it needs a critical section |
| **Flow control** | Tell the sender to pause (RTS/CTS, XON/XOFF, or a protocol-level ACK) | You control both ends and cannot afford loss |

Whatever you choose, **count the drops** and make the count visible (a status command, a log line). And size the buffer from numbers, not by feel.`,
    { t: 'callout', kind: 'decision', title: 'Sizing the buffer', md: `Buffer size ≥ (longest time the consumer can be away) × (byte rate). At 115200 baud with 8N1 framing, one byte is 10 bits, so 11520 bytes/s. If the main loop's worst-case pass is 4 ms: 0.004 × 11520 ≈ 46 bytes. Round **up** to the next power of two that leaves margin: 64 (which holds 63). If you do not know your worst-case loop time, measure it: toggle a GPIO at the top of the loop and look at the longest gap on a logic analyser.` },

    { t: 'predict', q: 'A ring buffer is declared with `RB_SIZE 8` and uses the keep-one-slot-empty scheme. The buffer is empty with `head = tail = 6`. The ISR then stores 5 bytes before the main loop reads anything. What are `head` and the number of bytes waiting?',
      choices: [
        { t: 'head = 3, 5 bytes waiting', ok: true, why: '6 + 5 = 11, and 11 & 7 = 3. Count = (head − tail) & mask = (3 − 6) & 7 = 5. The data occupies indices 6, 7, 0, 1, 2.' },
        { t: 'head = 11, 5 bytes waiting', why: 'An index of 11 would be outside an 8-element array. Every index is wrapped as it is advanced, so it can never exceed 7.' },
        { t: 'head = 3, −3 bytes waiting', why: 'Plain subtraction gives a negative number whenever head has wrapped and tail has not. The count has to be wrapped too.' },
        { t: 'head = 7, 2 bytes waiting: the rest were dropped at the end of the array', why: 'The end of the array is not a limit. The index wraps to 0 and writing continues; only catching up with tail stops it.' },
      ],
      reveal: 'Indices wrap; counts are computed with a wrapped subtraction. Hold on to this: the two bugs in the second exercise below are exactly the two wrong answers here.' },

    { t: 'widget', name: 'c-lab', props: clRingPutGet },
    { t: 'callout', kind: 'mistake', title: 'The full check that forgets to wrap', md: `Writing \`if (head + 1 == tail)\` instead of \`if (((head + 1) & mask) == tail)\`. It works in every test where the buffer fills while \`head\` is not at the last index. When it does fail, it does not lose one byte: \`head\` wraps onto \`tail\`, the buffer now *looks empty*, and everything queued disappears. Debug one yourself:` },
    { t: 'widget', name: 'c-lab', props: clRingOffByOne },

    `## From bytes to messages: framing

A UART delivers a stream of bytes with no boundaries. The receiver has to decide where one message ends and the next begins. Two families of answer:

| | Delimiter framing | Length-prefixed framing |
|---|---|---|
| Idea | A special byte ends each message (\`'\\n'\` for text) | A header says how many bytes follow |
| Good for | Human-readable commands, logs | Binary data, where any byte value may appear |
| Problem | The delimiter cannot appear in the data, unless you add **escaping** (byte stuffing) | A corrupted or malicious length field desynchronises the receiver or overflows its buffer |
| Resync after an error | Easy: wait for the next delimiter | Hard: needs a start marker, a checksum and a timeout |

Real binary protocols usually combine them: a start-of-frame marker, a length, the payload and a CRC. The 2026 eCTF reference design, for instance, uses a packet header of a magic byte \`%\`, a 1-byte command and a 16-bit length (see that year's \`host_messaging.h\`).

Explore a frame of that shape here. Corrupt a bit and see whether the check catches it, then take the challenge: make a receiver that trusts LEN write past its buffer.`,
    { t: 'widget', name: 'packet-explorer', props: { challenge: 'find-length-bug' }, caption: 'A byte-level frame and the receiver state machine that consumes it.' },

    `### Bounds discipline

Every buffer bug in firmware is one of two mistakes:

1. writing or reading at an index that was never compared with the buffer's size, or
2. comparing it, but with the wrong operator or after arithmetic that wrapped.

Rules that prevent both:

- **A length that came from outside is data, not a fact.** Check it against the destination capacity *and* against the number of bytes actually received, before using it.
- **Validate, then commit.** Do every check before the first write to state that outlives the function.
- **Sizes come from \`sizeof\`, not from a second copy of the number.** \`char buf[24]\` and a separate \`#define LEN 24\` will drift apart; \`sizeof buf\` cannot.
- **Leave room for the terminator.** A C string of N characters needs N+1 bytes.
- **Test the boundaries**: exactly the maximum, one more than the maximum, zero.`,
    { t: 'widget', name: 'c-lab', props: clFrameBounds },

    `### Copy or zero-copy?

Each time a byte moves from one buffer to another it costs CPU time and, more importantly, RAM for the second buffer.

- **Copying** design: ISR → ring buffer → line buffer → command struct. Simple ownership: each stage owns its own memory and nobody else can change it underneath.
- **Zero-copy** design: the driver receives straight into a frame buffer (often by DMA) and passes a *pointer and length* up the stack. No bytes move, but now you must answer: who owns the buffer, and when may the driver reuse it?

For command-rate data (a few lines per second) copy without guilt: clarity wins. For bulk data (audio, camera frames, flash images) the copies dominate and zero-copy with a pool of fixed-size buffers is worth its complexity. A zero-copy bug is a use-after-free: the parser still holds a pointer into a buffer the driver has started refilling.`,

    { t: 'exercise', prompt: `A GPS module sends NMEA sentences at 9600 baud, 8N1. Each sentence is at most 82 bytes and the module sends a burst of 6 sentences once per second with no gaps inside the burst. Your main loop can be busy for up to **120 ms** writing to an SD card. Using keep-one-slot-empty and power-of-two sizes, what is the smallest ring buffer size (in bytes) that cannot overflow?`,
      hints: [
        '9600 baud with 10 bits per byte is how many bytes per second?',
        '960 bytes/s × 0.120 s = about 115 bytes can arrive while the loop is away (the burst is 492 bytes, so it easily lasts that long).',
        'You need capacity for 116 bytes (round up). A buffer of size N holds N−1. Which power of two satisfies N−1 ≥ 116?',
      ],
      answer: { type: 'number', value: 128, tol: 0 },
      solution: `960 bytes/s × 0.12 s = 115.2, so up to 116 bytes can be waiting. A 128-byte buffer holds 127: enough. A 64-byte buffer holds 63: it would drop about half of what arrives during an SD write. The burst length (492 bytes) does not set the size, because the consumer keeps draining during the burst; only the longest *absence* of the consumer does.` },

    `## Harder application

Your device receives firmware updates over UART as length-prefixed frames of up to 1024 bytes and writes each to flash. A flash page erase blocks for tens of milliseconds (check the datasheet's flash timing table for your chip). Design the receive path: where is the ring buffer, how big is it, what is the overflow policy, and how does the sender learn that a frame was lost? Write your answer in the notebook before reading on.

One sound design: an RX interrupt feeding a ring buffer sized for the erase time; a frame parser in the main loop that validates length and CRC before touching flash; a **stop-and-wait protocol**, in which the sender transmits one frame and waits for an ACK before the next, so the device is never asked to receive while it erases. Flow control at the protocol level makes the buffer size a matter of one frame, not of timing. The 2025 eCTF flasher works this way in spirit: it sends 16-byte blocks through the bootloader and waits between them (see that year's \`flash.py\`).`,
    { t: 'refs', items: [
      { title: 'SEI CERT C: ARR30-C. Do not form or use out-of-bounds pointers or array subscripts', url: 'https://wiki.sei.cmu.edu/confluence/display/c/ARR30-C.+Do+not+form+or+use+out-of-bounds+pointers+or+array+subscripts' },
      { title: 'FreeRTOS: stream buffers (an SPSC byte queue provided by the kernel)', url: 'https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/04-Stream-and-message-buffers/02-Stream-buffer-example' },
      { title: 'MITRE eCTF 2026 insecure example: host_messaging.h', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/host_messaging.h' },
    ] },
  ],
  quiz: [
    { q: 'Why does the keep-one-slot-empty ring buffer need no interrupt disabling when an ISR produces and the main loop consumes, on a single-core 32-bit MCU?', kind: 'concept', choices: [
      { t: 'Each index is written by exactly one side, and a 16- or 32-bit index is read or written in one instruction', ok: true, why: 'With one writer per variable there is no read-modify-write sequence that the other side can corrupt, and single-instruction access means no half-updated value is ever visible.' },
      { t: 'Because `volatile` makes accesses atomic', why: '`volatile` only forces the compiler to perform each access; it does nothing to stop an interrupt arriving between a read and the following write.' },
      { t: 'Because interrupts are automatically disabled while the main loop runs', why: 'They are not: an enabled interrupt can pre-empt the main loop between any two instructions, which is the whole reason the question arises.' },
      { t: 'Because the array itself is `static`', why: 'Storage class decides where the array lives and who can name it, not whether two contexts can safely update shared indices.' },
    ] },
    { q: 'A 32-slot keep-one-empty buffer has `head = 2`, `tail = 30`. How many bytes are waiting?', kind: 'code', choices: [
      { t: '4', ok: true, why: '(2 − 30) & 31 = (−28) & 31 = 4: indices 30, 31, 0 and 1 are occupied.' },
      { t: '28', why: 'That is tail − head, the number of slots that are *not* occupied (less the reserved one).' },
      { t: '−28', why: 'The raw difference is negative because head has wrapped; a count has to be reduced modulo the size.' },
      { t: '32', why: 'A keep-one-empty buffer can never report more than size − 1, and here the indices are only four apart.' },
    ] },
    { q: 'Your command parser uses drop-newest overflow. A burst overflows the buffer in the middle of a line. What must the *line parser* do to stay correct?', kind: 'arch', choices: [
      { t: 'Nothing special: the truncated line fails its own validation or is rejected as over-long, and parsing resynchronises at the next newline', ok: true, why: 'A gap inside a delimiter-framed stream damages at most the lines it touches; the next delimiter restores alignment, provided damaged lines are rejected rather than executed.' },
      { t: 'Reset the microcontroller, since the stream is now corrupt', why: 'A reset loses all state for a recoverable condition. Delimiter framing exists so that one damaged message does not poison the following ones.' },
      { t: 'Execute the partial line, because some of a command is better than none', why: 'A truncated command is a different command. `PIN 49` is not a weaker form of `PIN 4921`, and `ERASE 1` is not a safe fraction of `ERASE 10`.' },
      { t: 'Switch to overwrite-oldest so that nothing is lost', why: 'Overwrite-oldest still loses bytes, just older ones, and it destroys the start of the line that was being assembled.' },
    ] },
    { q: 'What is wrong with this receive handler?', kind: 'security', code: C`#define BUF 32
static uint8_t payload[BUF];

void on_frame(const uint8_t *in, uint8_t n)   /* n bytes received */
{
    uint8_t len = in[0];
    if (len <= n) memcpy(payload, &in[1], len);
}`, choices: [
      { t: '`len` is checked against the received count but not against `BUF`, so a 200-byte frame overflows `payload`', ok: true, why: 'Two bounds apply to every copy: the source size and the destination size. Only the source was checked (and loosely: the length byte itself should not count).' },
      { t: '`memcpy` cannot be used in firmware', why: '`memcpy` is fine and usually optimal; the issue is the size it is given, not the function.' },
      { t: '`len` should be `int` so that negative lengths can be rejected', why: 'A byte from the wire is 0–255; widening the type adds no check. The missing comparison is against the capacity of the destination.' },
      { t: 'Nothing: comparing with `n` guarantees the copy is safe', why: 'It guarantees the copy does not read past what was received. It says nothing about where the bytes are written to.' },
    ] },
    { q: 'When is zero-copy reception worth its complexity?', kind: 'arch', choices: [
      { t: 'For bulk data such as images or audio, where copying each byte several times costs real CPU time and RAM', ok: true, why: 'The cost of copying scales with data volume; ownership bugs scale with design complexity. For large, fast streams the first dominates.' },
      { t: 'Always: copying data is a sign of poor design', why: 'For low-rate command traffic a copy costs microseconds and buys simple ownership. Removing it adds lifetime rules that can go wrong for no measurable gain.' },
      { t: 'Never on a microcontroller, because pointers are unsafe', why: 'DMA into a frame buffer handed on by pointer is a standard MCU technique; it needs clear ownership rules, not avoidance.' },
      { t: 'Only when the data is text', why: 'The data\'s meaning is irrelevant to the trade-off; its volume and rate are what matter.' },
    ] },
    { q: 'A ring buffer index is declared `uint16_t` on an **8-bit** AVR. Why is the lock-free SPSC argument no longer valid?', kind: 'concept', choices: [
      { t: 'A 16-bit read takes two instructions there, so the main loop can read one half, be interrupted, and combine it with the other half of a different value', ok: true, why: 'Atomic single-instruction access to each index is a precondition of the scheme. A torn read of 0x00FF→0x0100 can yield 0x0000 or 0x01FF.' },
      { t: 'AVR has no interrupts', why: 'It has them; the problem is precisely that an interrupt can land between the two byte reads.' },
      { t: '`uint16_t` does not exist on 8-bit CPUs', why: 'The type exists; the compiler implements it with multi-instruction sequences, which is the hazard.' },
    ] },
  ],
};

/* ============================================================== 2. Stack usage */
const stack = {
  id: 'fw-stack', title: 'Stack usage: budgeting the memory you cannot see', minutes: 50,
  summary: 'What consumes stack, how to measure and bound it with -fstack-usage and stack painting, and what an overflow looks like on a chip with no memory protection.',
  skills: ['fw-stack-budget'],
  blocks: [
    `## The problem

A device works for days, then one configuration value silently changes, or it resets. The code that owns the corrupted variable is correct. No test reproduces it.

A very common cause: the **stack grew into memory that belongs to something else**. On a PC the operating system places an unmapped guard page below the stack and you get a segmentation fault. A small microcontroller has no operating system and, unless you set one up, no guard. The stack pointer simply keeps going down into \`.bss\`, \`.data\` or the heap, and function calls overwrite your variables with return addresses.

The 2026 eCTF reference design for the MSPM0L2228 has 32 KB of SRAM in total and its linker script reserves a stack of **256 bytes** (per docs/FACTS and that design's \`firmware.ld\`). One careless \`char buf[512]\` as a local variable is twice the entire stack.`,

    `## What uses stack

Every function call pushes a **stack frame**. It contains:

| Item | Typical size on Cortex-M | Notes |
|---|---|---|
| Return address (LR) and saved registers | 4–36 bytes | Only the callee-saved registers the function actually uses |
| Local variables | whatever you declared | Arrays and structs are the big ones |
| Temporaries and outgoing arguments beyond the first four | a few words | Compiler-dependent |
| Alignment padding | 0–4 bytes | The ABI keeps SP 8-byte aligned at calls |

On top of that:

- **Interrupts use the stack of whatever was running.** On Cortex-M, exception entry pushes 8 words (32 bytes) automatically, more with the FPU's state (on an M4F with lazy stacking; check the Arm documentation for the exact frame), and then the handler's own frame follows. With nested interrupts each level adds another.
- Under an **RTOS, every task has its own stack**, sized when the task is created. Bare-metal has one stack; an RTOS has one per task plus (on Cortex-M) the main stack used by interrupts.

The worst case is therefore: *deepest call chain of the thread* + *deepest chain of every interrupt that can nest on top of it*.`,
    { t: 'widget', name: 'stack-heap', props: { program: 'recursion' }, caption: 'Step the recursion until the stack pointer leaves the stack region. Note that nothing stops it.' },

    `## Measuring: static analysis with -fstack-usage

GCC can tell you the frame size of every function. Compile with \`-fstack-usage\` and it writes a \`.su\` file next to each object file.

The example \`examples/firmware-eng/bugs/stack_hog.c\` contains four functions with different appetites. \`make su\` in that directory runs:

\`\`\`
gcc -std=c11 -Wall -Wextra -O1 -fstack-usage -c bugs/stack_hog.c -o build/stack_hog.o
\`\`\`

and this is the real \`.su\` output from GCC 13.3 on x86-64 in this repository's environment:

\`\`\`
bugs/stack_hog.c:7:10:checksum	8	static
bugs/stack_hog.c:15:10:format_report	544	static
bugs/stack_hog.c:23:10:depth_sum	48	static
bugs/stack_hog.c:31:10:echo_copy	48	dynamic
bugs/stack_hog.c:38:5:main	32	static
\`\`\`

Each line is \`file:line:column:function\`, the frame size in bytes, and a qualifier:

- **static**: the frame size is fixed at compile time.
- **dynamic**: the function adjusts the stack at run time (a variable-length array or \`alloca\`). The number shown is only the fixed part. The true size depends on data.
- **dynamic,bounded**: dynamic, but the compiler knows an upper bound and reports it.`,
    { t: 'callout', kind: 'note', md: `These numbers are for an x86-64 host build. Frame sizes on a Cortex-M or RISC-V target differ (different register widths, calling convention and alignment), usually smaller. The *ranking* of functions carries over; the bytes do not. Always produce the \`.su\` files with the cross-compiler and flags you ship.` },
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/bugs/stack_hog.c (excerpt): the functions behind the .su listing.',
      code: C`/* A "temporary" buffer on the stack: 512 bytes every time this is called. */
uint32_t format_report(uint32_t value)
{
    char line[512];
    int n = snprintf(line, sizeof line, "value=%lu", (unsigned long)value);
    return checksum((const uint8_t *)line, (uint32_t)n);
}

/* Recursion: the frame is small, but there is one per level and the depth is data-dependent. */
uint32_t depth_sum(uint32_t n)
{
    volatile uint32_t pad[4] = { n, n, n, n };
    if (n == 0) return pad[0];
    return pad[1] + depth_sum(n - 1);
}

/* Variable-length array: the frame size is not known until run time. */
uint32_t echo_copy(const uint8_t *src, uint32_t len)
{
    uint8_t copy[len];
    memcpy(copy, src, len);
    return checksum(copy, len);
}`,
      explain: [
        { lines: '4', md: '512 bytes are reserved by one subtraction from SP on entry. The `.su` line says 544: the array plus saved registers, a stack-protector canary slot on this host, and alignment.' },
        { lines: '10-15', md: '48 bytes per call, but `depth_sum(100)` uses 100 × 48 = 4800 bytes. The `.su` file cannot tell you the depth.' },
        { lines: '20', md: 'A VLA: `sub sp, len` at run time. If `len` comes from a packet, the sender chooses your stack usage.' },
      ] },

    `### From frames to a worst case

The \`.su\` file gives frame sizes. The worst-case stack depth is the most expensive **path** through the call graph:

\`\`\`
main (32) → format_report (544) → checksum (8)        = 584 bytes
\`\`\`

plus \`snprintf\`'s own usage, which is in the C library and not in your \`.su\` files (printf-family functions are notoriously stack-hungry; the library's documentation or a measurement is the only source). Tools automate the graph walk: GCC's \`-fcallgraph-info=su\` emits the call graph with sizes, and vendor IDEs include stack analysers. They all stop at three things: **recursion**, **calls through function pointers**, and **dynamic frames**. Those need a human bound or a ban.`,
    { t: 'exercise', prompt: `Using the \`.su\` listing above: which function should you fix first if the target's whole stack is 256 bytes? Give the function name.`,
      hints: ['Look for the largest number in the size column.', 'One function alone needs more than twice the available stack.'],
      answer: { type: 'text', accept: ['format_report', 'format_report\\(\\)'], nudge: 'Look at which single frame exceeds 256 bytes on its own.' },
      solution: `\`format_report\`, at 544 bytes: it cannot run at all in 256 bytes. The fix is to make \`line\` a \`static\` buffer (it then lives in \`.bss\` and costs no stack, but the function is no longer reentrant), to shrink it to what the output actually needs, or to format and send the pieces without an intermediate buffer. \`depth_sum\` and \`echo_copy\` are the next problems: their usage is unbounded.` },

    `## Measuring: run-time high-water marks

Static analysis gives an upper bound when it can. A **high-water mark** tells you what actually happened:

1. At start-up, before the stack is deep, fill the unused part of the stack region with a known pattern (\`0xA5A5A5A5\` and \`0xDEADBEEF\` are traditional). This is **stack painting**.
2. Run the system through its worst cases.
3. Scan from the far end of the stack towards the start, counting how many words still hold the pattern. That is the minimum free stack ever observed.`,
    { t: 'widget', name: 'c-lab', props: clStackPaint },
    `### FreeRTOS does this for you

FreeRTOS fills each task's stack with a fixed byte when the task is created, and

\`\`\`c
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t task);   /* NULL = the calling task */
\`\`\`

returns the smallest amount of free stack that task has ever had. In the reference FreeRTOS kernel the unit is **words** (4 bytes on a 32-bit port). ESP-IDF's FreeRTOS specifies stack sizes in **bytes**; check the ESP-IDF FreeRTOS documentation for the unit its port returns before you do arithmetic on it.

FreeRTOS can also check for overflow at each context switch (\`configCHECK_FOR_STACK_OVERFLOW\`, methods 1 and 2) and call a hook function you provide. It catches most overflows shortly after they happen, but not all, and by then memory may already be damaged: treat the hook as a reason to halt and report, not to continue.`,
    { t: 'code', lang: 'c', status: 'reviewed', caption: 'Logging stack headroom from a FreeRTOS task. Written against the FreeRTOS API; not run on a board here.',
      code: C`void sensor_task(void *arg)
{
    (void)arg;
    for (;;) {
        read_and_publish();
        UBaseType_t free_min = uxTaskGetStackHighWaterMark(NULL);
        if (free_min < 64) {                       /* units: see your port's documentation */
            log_warn("sensor_task stack low: %u", (unsigned)free_min);
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}`,
      explain: [{ lines: '6', md: 'Scans this task\'s stack for surviving fill bytes. It is a linear scan, so call it occasionally, not in a fast loop.' }] },

    { t: 'predict', q: 'A bare-metal Cortex-M0+ program has its stack at the top of RAM, growing down towards `.bss`. A deep call chain pushes the stack pointer 40 bytes into `.bss`. No MPU, no stack limit register. What happens at that moment?',
      choices: [
        { t: 'Nothing visible. The pushes overwrite whichever variables live there; the symptom appears later, somewhere else', ok: true, why: 'RAM is RAM: a store below the intended stack limit is an ordinary, legal write. The variables it lands on now hold return addresses and saved registers, and the functions that own them misbehave later.' },
        { t: 'A HardFault, because the CPU detects the stack overflow', why: 'A plain Cortex-M0+ has no stack-limit check. A fault only occurs if the stack pointer leaves RAM altogether, or later when corrupted data is used as an address.' },
        { t: 'The compiler prevents this at build time', why: 'The compiler reserves frames per function but does not know the run-time call depth, the interrupt nesting or how much RAM the linker script granted the stack.' },
        { t: 'The stack wraps to the top of RAM', why: 'The stack pointer is an ordinary register being decremented; it does not wrap at a region boundary it has never been told about.' },
      ],
      reveal: 'This is why stack overflows are so hard to diagnose: the fault is silent and the damage appears in an unrelated module. Typical symptoms: a global that changes "by itself", a crash on *return* from a function (its saved return address was overwritten by someone else\'s data, or the other way round), behaviour that changes when you add an unrelated variable (the layout of `.bss` moved), and failures that only occur when an interrupt arrives at the deepest point of the main code.' },

    `## Defences on real hardware

| Defence | What it does | Available on |
|---|---|---|
| Put the stack at the **bottom** of RAM, growing towards the start of RAM | An overflow leaves RAM and faults immediately instead of corrupting data | Any chip: it is a linker-script choice |
| MPU guard region below the stack | A write into the guard raises a MemManage fault | Cores with an MPU (the MAX78000's Cortex-M4 and the MSPM0L2228's Cortex-M0+ both report one, per their device headers) |
| Stack limit registers (\`MSPLIM\`/\`PSPLIM\`) | Hardware fault when SP goes below the limit | Armv8-M cores; not Cortex-M0+/M4 |
| \`-fstack-protector\` canaries | Detects a *buffer overrun inside a frame* on function return | Compiler feature; this is about overwritten frames, not about total depth |
| Painting + periodic check | Detects after the fact | Anywhere |

And the design rules that keep the number small and knowable:

- No large locals. Buffers above a few tens of bytes are \`static\` or belong to a module-level context struct.
- No recursion and no variable-length arrays, so every frame is \`static\` and the call graph is finite.
- Keep interrupt handlers shallow: set a flag or push a byte, return.
- Do not call \`printf\` from deep call chains or from interrupts.`,
    { t: 'callout', kind: 'mistake', title: 'Fixing a stack overflow by doubling the stack', md: `It makes the symptom go away, and if the cause was a 512-byte local or unbounded recursion it will come back with the next input that is a little larger. First find out **what** used the stack (\`.su\` files, high-water mark, a watchpoint on the last stack word), fix what is unreasonable, and only then set the size to *measured worst case plus a margin* (25–50 % is common practice).` },
    { t: 'widget', name: 'c-lab', props: clRecursion },

    `## Harder application

A bare-metal firmware has a main loop whose deepest path is 380 bytes (from \`.su\` files of the cross-build, including library calls you measured). It has three interrupts: UART (frame 48 bytes), timer (frame 64 bytes) and an ADC interrupt (frame 40 bytes). On this Cortex-M0+ exception entry pushes 32 bytes. The timer interrupt has a higher priority than the other two, which share a priority.`,
    { t: 'exercise', prompt: 'What is the worst-case stack depth in bytes, before adding any margin? (Interrupts of equal priority cannot pre-empt each other; a higher-priority one can pre-empt a lower one.)',
      hints: [
        'Start with the main loop at its deepest: 380 bytes.',
        'One of the two low-priority interrupts arrives: 32 bytes of exception frame plus its handler\'s frame. Take the larger handler.',
        'While that handler runs, the timer interrupt pre-empts it: another 32 + 64.',
      ],
      answer: { type: 'number', value: 556, tol: 0, unit: 'bytes' },
      solution: `380 (main) + 32 + 48 (UART, the larger of the two that share a priority) + 32 + 64 (timer pre-empting it) = **556 bytes**. The ADC handler cannot stack on top of the UART handler because they have the same priority. With a 25 % margin you would reserve about 700 bytes. Note what this says about a 256-byte stack: this design does not fit, and no amount of testing would have proven otherwise.` },
    { t: 'refs', items: [
      { title: 'GCC manual: -fstack-usage (Developer/instrumentation options)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Developer-Options.html' },
      { title: 'FreeRTOS: uxTaskGetStackHighWaterMark', url: 'https://www.freertos.org/Documentation/02-Kernel/04-API-references/03-Task-utilities/04-uxTaskGetStackHighWaterMark' },
      { title: 'FreeRTOS: stack usage and stack overflow checking', url: 'https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/09-Memory-management/02-Stack-usage-and-stack-overflow-checking' },
      { title: 'MITRE eCTF 2026 insecure example: firmware.ld', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/firmware.ld' },
    ] },
  ],
  quiz: [
    { q: 'A `.su` line reads `parser.c:40:6:handle_packet  72  dynamic`. What does it tell you?', kind: 'code', choices: [
      { t: 'The fixed part of the frame is 72 bytes, and the function also adjusts the stack by an amount decided at run time', ok: true, why: '"dynamic" means a VLA or `alloca`: 72 is a floor, and the real usage depends on a run-time value you must bound yourself.' },
      { t: 'The function uses at most 72 bytes', why: 'That would be the meaning of `static` (or `dynamic,bounded`). Plain `dynamic` gives no upper limit.' },
      { t: 'The function uses 72 bytes of heap', why: '`-fstack-usage` reports stack frames only; heap allocations do not appear in it.' },
      { t: 'The function is called 72 times', why: 'The number is a size in bytes; the file contains no call counts.' },
    ] },
    { q: 'Why does a stack high-water mark from testing not *prove* the stack is large enough?', kind: 'concept', choices: [
      { t: 'It records only the paths and interrupt timings that occurred during the test, not the worst that can occur', ok: true, why: 'The deepest case needs the deepest call chain and the worst interrupt nesting to coincide; a test may never produce that coincidence.' },
      { t: 'Painting patterns are unreliable because RAM forgets them', why: 'SRAM holds its contents as long as it is powered. The limitation is coverage, not retention.' },
      { t: 'High-water marks only work under an RTOS', why: 'Painting works on any stack region, including the single bare-metal stack; the RTOS merely automates it.' },
    ] },
    { q: 'A global `config.baud` changes from 115200 to a value that looks like a code address (`0x00002A41`). Nothing writes it. Most likely cause?', kind: 'concept', choices: [
      { t: 'The stack grew into `.data`/`.bss` and a pushed return address landed on the variable', ok: true, why: 'A value that looks like a flash address with the Thumb bit set, in a variable nobody assigns, is the fingerprint of a saved LR written by a function call far below the intended stack limit.' },
      { t: 'Cosmic rays', why: 'Possible in principle, but a random bit flip does not produce a well-formed code address. Start with the explanation that predicts the exact value seen.' },
      { t: 'The baud rate register overflowed', why: 'The variable is in RAM and holds what was last stored there; a peripheral register cannot overflow into it.' },
      { t: 'The compiler optimised the variable away', why: 'An optimised-away variable has no storage to corrupt and would not show a changing value.' },
    ] },
    { q: 'Which change reduces worst-case stack use *without* making a function non-reentrant?', kind: 'code', choices: [
      { t: 'Have the caller pass in a buffer it owns, instead of declaring a large local array', ok: true, why: 'The memory then lives wherever the caller decides (static, or its own context struct) and each caller can supply a different one, so concurrent use stays safe.' },
      { t: 'Declare the large local array `static`', why: 'That removes it from the stack but makes every call share one buffer: two callers (main loop and an ISR, or two tasks) would overwrite each other.' },
      { t: 'Compile with `-O0`', why: 'Unoptimised code usually uses more stack, since every temporary gets a slot and nothing is kept in registers.' },
      { t: 'Mark the function `inline`', why: 'Inlining merges the frame into the caller\'s; the bytes are still needed, now in a larger caller frame.' },
    ] },
    { q: 'Under FreeRTOS, where do interrupt handlers get their stack on a Cortex-M port?', kind: 'arch', choices: [
      { t: 'From the main stack (MSP), separate from every task stack', ok: true, why: 'Cortex-M switches to the main stack pointer for handler mode, so each task stack only needs room for the automatically pushed exception frame, not for the handlers\' own frames.' },
      { t: 'From the heap, allocated on each interrupt', why: 'Allocating memory on interrupt entry would be slow and could fail; no port does that.' },
      { t: 'Interrupt handlers do not use a stack', why: 'They are functions: they save registers and have locals like any other.' },
    ] },
    { q: 'Why do many embedded coding standards prohibit recursion?', kind: 'concept', choices: [
      { t: 'With recursion the maximum stack depth depends on run-time data, so it cannot be bounded from the call graph', ok: true, why: 'A finite, acyclic call graph with static frames yields a computable worst case. A cycle in the graph makes the depth a property of the input.' },
      { t: 'Recursive functions are slower than loops on ARM', why: 'Speed is not the concern and is often comparable; predictability of memory use is.' },
      { t: 'C compilers for microcontrollers do not support recursion', why: 'They support it fully, which is exactly why a rule is needed to keep it out.' },
    ] },
  ],
};

/* ============================================================== 3. State machines */
const fsm = {
  id: 'fw-fsm', title: 'State machines: firmware that never waits', minutes: 70,
  summary: 'Why firmware is event-driven, how to write states, events, transitions and actions as a switch or a table, and how that replaces every delay() in a design.',
  skills: ['fw-fsm-design', 'fw-nonblocking'],
  blocks: [
    `## The problem

Here is a door lock written the way most people write their first firmware:`,
    { t: 'code', lang: 'c', status: 'pseudo', caption: 'Blocking style. Every line that waits stops everything else.',
      code: C`for (;;) {
    read_line(line);                 /* waits here until a full line arrives        */
    if (pin_ok(line)) {
        latch_open();
        delay_ms(5000);              /* waits here: deaf to the UART for 5 seconds  */
        latch_close();
    } else if (++bad == 3) {
        led_on();
        delay_ms(30000);             /* waits here: 30 seconds of doing nothing     */
        led_off();
        bad = 0;
    }
}`,
      explain: [
        { lines: '2', md: 'While this waits for a newline, the lock cannot time out, blink or notice a button.' },
        { lines: '5', md: 'A `LOCK` command sent during these 5 seconds is not acted on. Bytes that arrive pile up in the UART (and overrun) because nobody is reading.' },
      ] },
    `It reads like the requirements, which is its appeal. But each wait is a period during which the device does nothing else. Add "the LED must blink during lockout", "a LOCK command must close the latch immediately" and "feed the watchdog every 100 ms", and the structure collapses: you cannot blink inside \`delay_ms(30000)\`.

Firmware is **reactive**. It does not run from start to finish; it sits ready and responds to things that happen: a byte arrived, a timer expired, a pin changed. The structure that fits is the **state machine**.`,

    `## The vocabulary

| Term | Meaning | Door-lock example |
|---|---|---|
| **State** | What the system is currently *waiting for*; a summary of all relevant history | \`LOCKED\`, \`UNLOCKED\`, \`LOCKOUT\` |
| **Event** | Something that happened, delivered to the machine one at a time | correct PIN, wrong PIN, lock command, time passed |
| **Transition** | "In state S, on event E, go to state T" | \`LOCKED\` + correct PIN → \`UNLOCKED\` |
| **Guard** | A condition that must also hold for the transition | wrong PIN **and** it is the third → \`LOCKOUT\` |
| **Action** | What to do on a transition (or on entering/leaving a state) | open the latch, start the relock timer |
| **Extended state** | Variables that hold quantities instead of modes | the bad-PIN counter, the deadline timestamp |

Two properties make state machines the right tool:

1. **A step never blocks.** The machine is handed an event, updates its state, performs an action and returns. Waiting is represented by *being in a state*, not by code sitting in a loop.
2. **Every combination is decided.** For each state you must say what each event does, including "nothing". The unhandled case (a PIN arriving during lockout) is where bugs and security holes live, and the state machine forces you to look at it.`,
    { t: 'figure', caption: 'The door lock as a state diagram. Arrows are labelled event [guard] / action.', svg:
`<svg viewBox="0 0 640 250" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12" fill="none" stroke="currentColor">
  <defs><marker id="fwa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" stroke="none"/></marker></defs>
  <rect x="40" y="95" width="120" height="50" rx="22" stroke="var(--sig1)" stroke-width="2"/>
  <rect x="460" y="20" width="130" height="50" rx="22" stroke="var(--sig2)" stroke-width="2"/>
  <rect x="460" y="175" width="130" height="50" rx="22" stroke="var(--sig3)" stroke-width="2"/>
  <g fill="currentColor" stroke="none" text-anchor="middle">
    <text x="100" y="125" font-weight="bold">LOCKED</text>
    <text x="525" y="50" font-weight="bold">UNLOCKED</text>
    <text x="525" y="205" font-weight="bold">LOCKOUT</text>
    <text x="300" y="38">PIN ok / open latch, deadline = now + 5 s</text>
    <text x="300" y="98">LOCK, or TICK [deadline passed] / close latch</text>
    <text x="290" y="168">PIN bad [3rd in a row] / LED on, deadline = now + 30 s</text>
    <text x="290" y="238">TICK [deadline passed] / LED off, count = 0</text>
    <text x="100" y="62">PIN bad [fewer than 3]</text>
    <text x="100" y="76">/ count++</text>
    <text x="20" y="20" text-anchor="start">power-on</text>
  </g>
  <circle cx="14" cy="34" r="5" fill="currentColor"/>
  <path d="M18,38 L52,98" marker-end="url(#fwa)"/>
  <path d="M150,98 C240,45 380,40 458,45" marker-end="url(#fwa)"/>
  <path d="M460,58 C380,105 250,110 162,115" marker-end="url(#fwa)"/>
  <path d="M150,142 C240,180 380,190 458,195" marker-end="url(#fwa)"/>
  <path d="M460,212 C330,235 180,220 120,147" marker-end="url(#fwa)"/>
  <path d="M70,95 C50,60 120,55 105,93" marker-end="url(#fwa)"/>
</svg>` },

    `## Implementation 1: switch on state

The most direct translation: an \`enum\` for the states, a \`switch\` on the current state, and inside each case the events that state cares about. This is the lock from \`examples/firmware-eng/src/lock.c\`:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/src/lock.c (excerpt). Its tests are tests/test_lock.c.',
      code: C`static bool time_reached(uint32_t now_ms, uint32_t deadline_ms)
{
    return (int32_t)(now_ms - deadline_ms) >= 0;
}

void lock_dispatch(lock_t *lk, lock_event_t ev, uint32_t now_ms)
{
    switch (lk->state) {
    case LOCK_LOCKED:
        if (ev == LOCK_EV_PIN_OK) {
            lk->bad_count = 0;
            lk->deadline_ms = now_ms + LOCK_UNLOCK_MS;
            lk->state = LOCK_UNLOCKED;
        } else if (ev == LOCK_EV_PIN_BAD) {
            lk->bad_count++;
            if (lk->bad_count >= LOCK_MAX_BAD) {
                lk->deadline_ms = now_ms + LOCK_LOCKOUT_MS;
                lk->state = LOCK_LOCKOUT;
            }
        }
        break;

    case LOCK_UNLOCKED:
        if (ev == LOCK_EV_LOCK ||
            (ev == LOCK_EV_TICK && time_reached(now_ms, lk->deadline_ms))) {
            lk->state = LOCK_LOCKED;
        }
        break;                    /* PIN events are ignored while open */

    case LOCK_LOCKOUT:
        /* Every PIN event is ignored here, including a correct one. */
        if (ev == LOCK_EV_TICK && time_reached(now_ms, lk->deadline_ms)) {
            lk->bad_count = 0;
            lk->state = LOCK_LOCKED;
        }
        break;

    default:                      /* corrupted state variable: recover to the safe state */
        lock_init(lk);
        break;
    }
}`,
      explain: [
        { lines: '1-4', md: 'Wrap-safe time comparison. A 32-bit millisecond counter wraps after about 49.7 days. `now - deadline` in unsigned arithmetic, reinterpreted as signed, is negative before the deadline and non-negative after it, across the wrap, as long as deadlines are less than 2³¹ ms ahead. `if (now >= deadline)` breaks at the wrap.' },
        { lines: '6', md: 'The function takes the current time as a parameter instead of reading a clock. That one decision makes the whole machine testable on a PC: the test decides what time it is.' },
        { lines: '12', md: 'A timeout is not a delay. It is a number stored in the state: "the moment at which TICK events start to matter".' },
        { lines: '24-25', md: 'The 5-second wait of the blocking version became a guard on the TICK event. Between ticks the CPU is free.' },
        { lines: '31', md: 'Lockout deliberately has no PIN transition. Written as an explicit comment so a reviewer can see it was decided, not forgotten.' },
        { lines: '38-40', md: 'If the state variable holds a value that is not a state (memory corruption, a fault-injection glitch), go to the secure state. For a lock that is "locked".' },
      ] },
    `Notice what the function does **not** do: it does not touch a GPIO, a UART or a timer. It is pure logic. The caller translates the state into pin levels:

\`\`\`c
hal_gpio_write(HAL_PIN_LATCH, lock_latch_open(&s_lock));
\`\`\`

Deriving outputs from the state in one place, every loop pass, is more robust than scattering \`latch_open()\`/\`latch_close()\` calls over the transitions: there is no path that can leave the latch open in the \`LOCKED\` state.`,
    { t: 'widget', name: 'state-machine', props: { machine: 'door-lock' }, caption: 'Send events to a door-lock machine and watch which case of the switch runs. This one reads a keypad digit by digit, so it has an extra ENTERING state that the example file (which receives whole PIN lines) does not need; the structure is the same.' },

    { t: 'predict', q: 'The lock is in `LOCKOUT` with 20 seconds remaining. An attacker who has guessed the correct PIN sends it. Using the code above, what happens?',
      choices: [
        { t: 'Nothing: the event is ignored and the lockout continues for its full duration', ok: true, why: 'The `LOCK_LOCKOUT` case reacts only to TICK. A PIN event falls through to `break` with no change of state.' },
        { t: 'The lock opens, because a correct PIN always wins', why: 'Then lockout would cost an attacker nothing: they could keep guessing at full speed and be let in the moment they hit the right value.' },
        { t: 'The lockout timer restarts at 30 seconds', why: 'There is no code in that case that writes `deadline_ms` on a PIN event. (Restarting on every attempt is a legitimate design, but it is not this one, and it lets an attacker keep the legitimate user out indefinitely.)' },
      ],
      reveal: 'The lockout only limits the guess rate if it also rejects *correct* guesses. The test `test_correct_pin_is_refused_during_lockout` in `tests/test_lock.c` pins that behaviour down so that nobody "fixes" it later.' },

    `## Replacing delay() with a state

The mechanical recipe for making blocking code non-blocking:

1. Find every place the code waits (\`delay\`, \`while (!flag)\`, a blocking read).
2. Each wait becomes a **state** named after what is awaited.
3. The code after the wait becomes the **action** on the event that ends the wait.
4. The function is called repeatedly from the main loop and returns immediately every time.`,
    { t: 'widget', name: 'c-lab', props: clNonBlocking },

    `## Worked example: debouncing a button

A mechanical switch does not close cleanly. For a few milliseconds the contacts bounce, and the pin reads 0-1-0-1-1-0-1-1-1 (the duration varies by switch; a datasheet gives a maximum bounce time, and 5–20 ms is a common allowance). Sampling the pin and counting rising edges counts one press as several.

The fix is a state machine sampled at a fixed rate, which only believes a level once it has been stable for N consecutive samples:`,
    { t: 'widget', name: 'state-machine', props: { machine: 'debounce' }, caption: 'Feed raw samples and watch the debounce machine move between its four states.' },
    { t: 'widget', name: 'c-lab', props: clDebounce },

    `## Worked example: a UART frame parser

A parser is a state machine whose events are bytes. The state answers "which part of the message am I in?". For a binary frame the states are typically: wait for start byte → read length → read payload (counting down) → read checksum. For text lines there are just two: collecting, and discarding the rest of a line that was too long.`,
    { t: 'widget', name: 'state-machine', props: { machine: 'uart-parser' }, caption: 'Step a frame parser one byte at a time, including a bad length and a corrupted byte.' },
    { t: 'widget', name: 'c-lab', props: clLineReceiver },
    { t: 'callout', kind: 'security', md: `Parsers are where outside data first meets your code, so they are where most firmware vulnerabilities are found. A parser written as an explicit state machine has a short list of states and one place where each byte is stored, which makes its bounds checks reviewable. A parser written as nested loops with indices carried between them rarely is. This course only attacks parsers in its own intentionally vulnerable simulations; the same review habits apply to code you own.` },

    `## Implementation 2: table-driven

When the transitions are regular, write them as **data**. A two-dimensional array indexed by state and event holds the next state (and, in richer versions, a pointer to an action function):`,
    { t: 'widget', name: 'c-lab', props: clTableFsm },
    { t: 'callout', kind: 'decision', title: 'Switch or table?', md: `**Switch** when there are few states, transitions have guards and different actions, and you want to read the behaviour top to bottom. Most device-control machines are like this.

**Table** when the machine is large and regular (protocol decoders, menu systems, lexers), when it must be reviewed against a specification cell by cell, or when the table is generated by a tool. A \`const\` table lives in flash and costs no RAM.

Both are fine. What is not fine is the third option: no explicit state at all, with the "state" spread over a handful of boolean flags (\`is_open\`, \`waiting\`, \`timeout_started\`). Five booleans are 32 combinations, most of them meaningless, and nothing stops the code reaching them.` },

    `## Hierarchical state machines, briefly

Real devices have behaviour common to many states: "in *any* operating state, a low-battery event goes to SHUTDOWN". In a flat machine you repeat that transition in every state. A **hierarchical state machine** (statechart) lets states nest: a parent state \`OPERATING\` contains \`LOCKED\`, \`UNLOCKED\` and \`LOCKOUT\`, and an event that no child handles is offered to the parent.

In C the simplest form is a second \`switch\` that runs first for events handled the same everywhere:

\`\`\`c
if (ev == EV_LOW_BATTERY) { enter_shutdown(); return; }   /* parent: applies in every state */
switch (state) { /* children */ }
\`\`\`

Beyond two levels, use a framework or generator rather than hand-nesting. For this course, know that the idea exists and recognise it when a codebase uses it.`,
    { t: 'callout', kind: 'mistake', title: 'Blocking inside a state', md: `Writing a state machine and then calling \`delay_ms(50)\` or a blocking \`uart_read_line()\` in one of its actions. The machine's whole value is that a step returns promptly; one blocking action reintroduces every problem you removed. If an action needs time, it is not an action: it is another state.` },

    `## Harder application

Extend the door lock with a **door sensor** and an **alarm**. Requirements: (1) if the door is opened while the lock is in \`LOCKED\`, sound the alarm until a correct PIN is entered; (2) if the door is still open 20 s after unlocking, beep every 2 s until it is closed; (3) the latch must not relock while the door is open.

Before writing any code: list the new events and states, draw the diagram, and for **every** state write what each event does. How many (state, event) pairs are there now, and how many of them did the three requirement sentences actually specify? The unspecified ones are the questions to take back to whoever wrote the requirements. Then implement it by extending \`examples/firmware-eng/src/lock.c\` and add a test for each requirement to \`tests/test_lock.c\`.`,
    { t: 'refs', items: [
      { title: 'Harel, D. (1987) Statecharts: a visual formalism for complex systems (Science of Computer Programming 8)', url: 'https://www.sciencedirect.com/science/article/pii/0167642387900359', note: 'The original paper on hierarchical state machines.' },
      { title: 'SEI CERT C: MSC01-C. Strive for logical completeness (default cases in switch)', url: 'https://wiki.sei.cmu.edu/confluence/display/c/MSC01-C.+Strive+for+logical+completeness' },
    ] },
  ],
  quiz: [
    { q: 'What is the fundamental problem with `delay_ms(5000)` in a main loop?', kind: 'concept', choices: [
      { t: 'For five seconds the loop cannot react to any other event: input is missed, other timeouts are late, the watchdog is not fed', ok: true, why: 'A delay is the CPU deliberately refusing to do anything else. Every other responsibility of the loop is suspended for its duration.' },
      { t: 'It wastes power', why: 'It may, but a busy-wait and a sleep-based delay differ in power while sharing the real defect: unresponsiveness.' },
      { t: 'Delays are inaccurate', why: 'Accuracy can be made as good as the clock. The defect remains even with a perfect delay.' },
      { t: 'It uses too much stack', why: 'A delay loop needs almost no stack; its cost is time during which nothing else runs.' },
    ] },
    { q: 'A machine stores `deadline = now + 5000` and later tests `if (now >= deadline)`. `now` is a `uint32_t` millisecond counter. When does this fail?', kind: 'code', choices: [
      { t: 'When `now + 5000` wraps past 2³²: the deadline becomes a small number and the test is true immediately', ok: true, why: 'Near the wrap the sum overflows to a small value, so the very next comparison sees `now >= deadline` and the timeout fires at once, after about 49.7 days of uptime.' },
      { t: 'Never: unsigned arithmetic cannot overflow', why: 'Unsigned arithmetic is well defined on overflow, but "well defined" means it wraps modulo 2³², which is exactly what breaks the comparison.' },
      { t: 'Whenever the timeout is longer than 255 ms', why: 'A 32-bit counter has no 8-bit limit; the comparison is fine until the counter itself approaches its maximum.' },
    ] },
    { q: 'In a table-driven machine, what should the lookup do if the state variable holds a value outside the table?', kind: 'security', choices: [
      { t: 'Detect it with a bounds check before indexing and force a defined safe state', ok: true, why: 'An out-of-range index reads whatever follows the table in flash and uses it as a state. Checking first turns memory corruption or a glitch into a controlled recovery.' },
      { t: 'Nothing: an enum variable can only hold its enumerators', why: 'In C an enum is an integer and can hold any value its underlying type can, for example after corruption or a bad cast.' },
      { t: 'Index the table anyway; the table is `const` so it is safe', why: '`const` protects the table from writes. It does not stop a read beyond its end from returning unrelated bytes.' },
    ] },
    { q: 'Which design keeps a state machine testable on a PC?', kind: 'arch', choices: [
      { t: 'The step function receives events and the current time as parameters and touches no hardware', ok: true, why: 'With all inputs passed in and outputs readable from the state, a test can drive any sequence, including time jumps, with no peripherals.' },
      { t: 'The step function reads the timer and UART registers directly so that it is self-contained', why: 'Direct register access ties the logic to one chip and makes it impossible to run, let alone control time, on a host.' },
      { t: 'The state is kept in several `static` booleans inside the function', why: 'Hidden static flags cannot be reset or inspected between tests and permit meaningless combinations.' },
    ] },
    { q: 'A debounce machine samples every 5 ms and requires 4 equal samples. What is the delay between the contact first closing and the press being reported, assuming it then stays closed?', kind: 'circuit', choices: [
      { t: 'About 15–20 ms', ok: true, why: 'Four consecutive samples span three sample periods (15 ms), plus up to one period of waiting for the first sample after the contact closes.' },
      { t: '5 ms', why: 'One sample cannot distinguish a real press from a bounce or a noise spike; the machine needs all four.' },
      { t: '4 ms', why: 'The count of samples is 4, but they are 5 ms apart; the delay is measured in sample periods, not in samples.' },
      { t: 'No delay: debouncing is instantaneous', why: 'Requiring stability over time necessarily costs that time. Latency is the price of rejecting bounce.' },
    ] },
    { q: 'You find firmware with flags `is_open`, `in_lockout`, `timer_running` and `alarm_on` instead of a state variable. What is the main risk?', kind: 'concept', choices: [
      { t: 'Sixteen flag combinations exist but only a few are meaningful, and nothing prevents the code entering the others', ok: true, why: 'A single enum makes illegal states unrepresentable; independent booleans allow `is_open && in_lockout`, and behaviour in such combinations is whatever the if-chains happen to do.' },
      { t: 'Booleans use more RAM than an enum', why: 'The difference is a few bytes and irrelevant next to the correctness problem.' },
      { t: 'Flags are slower to test than a switch', why: 'Performance is comparable. The problem is the unreviewable set of reachable combinations.' },
    ] },
  ],
};

export default [buffers, stack, fsm];
