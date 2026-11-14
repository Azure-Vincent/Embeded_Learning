// Embedded C: the language as it meets the machine. Content lives in ./embedded-c/*.js.
import lessonsA from './embedded-c/lessons-a.js';
import lessonsB from './embedded-c/lessons-b.js';
import lessonsC from './embedded-c/lessons-c.js';

export default {
  id: 'embedded-c', title: 'Embedded C', track: 'programming', requires: ['mcu-architecture'],
  tagline: 'C as it meets the machine: types, pointers, bits, registers, volatile, interrupts and the habits that keep firmware correct.',
  skills: [], lessons: [...lessonsA, ...lessonsB, ...lessonsC], labs: [], glossary: [], troubleshooting: [], refs: [],
};
