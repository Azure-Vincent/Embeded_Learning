import p0 from './security/part-a.js';
import p1 from './security/part-b.js';

const parts = [p0, p1];
const cat = (k) => parts.flatMap((p) => p[k] || []);
export default {
  id: 'security', title: 'Embedded Security', track: 'security', requires: ['debugging', 'firmware-eng'],
  tagline: 'How embedded devices are attacked and defended, from threat models to glitching.',
  intro: `Every topic here is taught the same way: what it is, how it works in hardware or firmware, how an attacker uses it, how you detect it, how you defend against it and how you verify the defence. Every attack runs against a simulated device in this app or against hardware you own. Attacking equipment you do not own or have written permission to test is illegal in most places and is not what this course is for.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
