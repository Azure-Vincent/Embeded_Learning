// Embedded Security, part A: the protective mechanisms (threat modelling, crypto building blocks, secure boot,
// key management, data at rest, updates, debug and memory protection, lifecycle). Part B covers weakness classes.
import { skills, glossary, troubleshooting, refs } from './a/meta.js';
import lessons1 from './a/lessons-1.js';
import lessons2 from './a/lessons-2.js';

export default {
  skills,
  lessons: [...lessons1, ...lessons2],
  labs: [],
  glossary, troubleshooting, refs,
};
