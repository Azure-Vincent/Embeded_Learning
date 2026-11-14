import a from './rtos/part-a.js';
import b from './rtos/part-b.js';
import c from './rtos/part-c.js';
import d from './rtos/part-d.js';

const parts = [a, b, c, d];
const cat = (k) => parts.flatMap((p) => p[k] || []);

export default {
  id: 'rtos', title: 'Real-Time Systems', track: 'programming', requires: ['embedded-c', 'esp32'],
  tagline: 'From a superloop to a measured multitasking design: scheduling, interrupts, shared state, and proving that deadlines are met.',
  intro: `A microcontroller has one processor (sometimes two) and many things to do, some of which cannot wait. This section is about deciding what runs when. It starts with what you can do with no operating system at all, then opens up FreeRTOS — the kernel that ESP-IDF builds on — far enough that you can predict a schedule on paper, find a race condition by reading, and explain a deadlock from a lock order. Code examples are ESP-IDF flavoured FreeRTOS, written against the documentation and not run on a board here; the simulators let you step through schedules and interleavings that are hard to catch on real hardware.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
