import intro from './capstones/intro.js';
import cap1 from './capstones/cap1.js';
import cap2 from './capstones/cap2.js';
import cap3 from './capstones/cap3.js';
import cap4 from './capstones/cap4.js';
import cap5 from './capstones/cap5.js';
import cap6 from './capstones/cap6.js';

const parts = [intro, cap1, cap2, cap3, cap4, cap5, cap6];
const cat = (k) => parts.flatMap((p) => p[k] || []);

export default {
  id: 'capstones', title: 'Capstone Projects', track: 'competition', requires: ['esp32'],
  tagline: 'Six integrative projects where you design, build, debug, analyse and secure a whole system on your own.',
  labsTitle: 'Capstones',
  intro: `These are not exercises with one right answer. Each capstone hands you a brief — requirements, a method, scaffolding, a test plan and a rubric — and asks you to pull the whole course together into a working, defensible system. You get the engineering milestones, the design questions worth arguing about, and the tests that decide whether you are done. You do not get a finished solution: the point is to prove you can produce one.

Work in order if you can. Capstone 1 integrates a device; 2 and 3 add real communication and real-time behaviour; 4 and 5 are the two halves of security — build the defences, then analyse something that lacks them; 6 is the final integrative project, modelled on the shape of MITRE eCTF work and explicitly not an official challenge. Nothing here was run on physical hardware; firmware is written against the vendor SDKs, every attack targets this course's own simulations or hardware you own, and every claim is something you verify, not something you take on trust.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
