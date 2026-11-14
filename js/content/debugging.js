// Hardware debugging and reverse engineering. Content lives in js/content/debugging/*.js.
import a from './debugging/part-a.js';
import b from './debugging/part-b.js';
import c from './debugging/part-c.js';
import labs from './debugging/labs.js';

const parts = [a, b, c, labs];
const cat = (k) => parts.flatMap((p) => p[k] || []);
export default {
  id: 'debugging', title: 'Hardware Debugging', track: 'hardware', requires: ['embedded-c', 'protocols'],
  tagline: 'Bench instruments, debug ports, GDB and firmware analysis: finding out what a board is really doing.',
  intro: `Debugging is measurement. This section starts with the instruments on the bench (multimeter, oscilloscope, logic analyser), moves to the interfaces that let you stop a processor and look inside it (UART consoles, JTAG, SWD, OpenOCD, GDB), and ends with reading firmware itself: file formats, extraction and disassembly.

The same skills are used by engineers fixing their own boards and by security researchers examining someone else's. Every analysis technique here is taught on hardware you own or on the synthetic firmware images bundled with this app, and each one is paired with what a designer does to protect a product against it.

Nothing in this section was run on physical hardware. Command transcripts marked as host-tested were produced on an x86-64 Linux host with gcc, binutils and gdb, using the small programs in \`examples/debugging/\`. Transcripts for boards are written from vendor documentation and say what you should expect to see.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
