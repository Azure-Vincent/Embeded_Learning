// Firmware engineering: how firmware is structured, built and kept correct.
import lessonsA from './firmware-eng/lessons-a.js';
import lessonsB from './firmware-eng/lessons-b.js';
import lessonsC from './firmware-eng/lessons-c.js';
import labs from './firmware-eng/lab.js';
import { glossary, troubleshooting, refs } from './firmware-eng/reference.js';

export default {
  id: 'firmware-eng', title: 'Firmware Engineering', track: 'programming', requires: ['embedded-c'],
  tagline: 'Structure, build and test firmware so that it stays correct: buffers, stacks, state machines, HALs, drivers, toolchains and host testing.',
  intro: `The Embedded C section taught the language. This section is about everything around it that decides whether firmware works on the bench *and* keeps working: where received bytes wait, how much stack a call chain needs, how to write code that never blocks, where the boundary to the hardware goes, what the compiler and linker actually produce, and how to test all of it without a board.

Almost every exercise here is code you read, write, change or debug in the C lab, which runs on **Bench-MCU**, a fictional teaching microcontroller simulated in the browser. The larger examples are real files under \`examples/firmware-eng/\`: build them with \`make test\` on any machine with GCC. Tool output shown in the lessons (\`nm\`, \`size\`, \`.su\` files, linker errors, sanitizer reports) was produced by GCC 13.3 and Binutils 2.42 on an x86-64 Linux host in this repository's environment; your versions will print slightly different addresses and sizes. Nothing here was run on a physical board.`,
  skills: [
    { id: 'fw-ringbuf', name: 'Implement and debug a single-producer/single-consumer ring buffer', track: 'programming' },
    { id: 'fw-framing', name: 'Parse a framed byte stream with complete bounds checking', track: 'programming' },
    { id: 'fw-stack-budget', name: 'Bound worst-case stack use with -fstack-usage and high-water marks', track: 'programming' },
    { id: 'fw-fsm-design', name: 'Design and implement a state machine as a switch or a table', track: 'programming' },
    { id: 'fw-nonblocking', name: 'Convert blocking code into non-blocking, event-driven code', track: 'programming' },
    { id: 'fw-hal-design', name: 'Define a hardware abstraction layer and port an application across it', track: 'programming' },
    { id: 'fw-driver-write', name: 'Write a register-level driver with timeouts and error reporting', track: 'programming' },
    { id: 'fw-architecture', name: 'Organise firmware into layers with a consistent error-handling strategy', track: 'programming' },
    { id: 'fw-toolchain-inspect', name: 'Inspect object files and ELF images with nm, size, objdump and the map file', track: 'programming' },
    { id: 'fw-link-errors', name: 'Diagnose undefined-reference and multiple-definition link errors', track: 'programming' },
    { id: 'fw-sanitizers', name: 'Find memory and undefined-behaviour bugs with warnings, static analysis and sanitizers', track: 'programming' },
    { id: 'fw-cross-build', name: 'Explain what a cross toolchain, startup file and linker script contribute to an image', track: 'programming' },
    { id: 'fw-repro-build', name: 'Set up a pinned, reproducible firmware build', track: 'programming' },
    { id: 'fw-host-test', name: 'Unit-test firmware logic on the host against a fake HAL', track: 'programming' },
  ],
  lessons: [...lessonsA, ...lessonsB, ...lessonsC],
  labs,
  glossary, troubleshooting, refs,
};
