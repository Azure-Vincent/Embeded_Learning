import p0 from './ectf/platforms.js';
import p1 from './ectf/prep.js';
import p2 from './ectf/scenarios.js';

const parts = [p0, p1, p2];
const cat = (k) => parts.flatMap((p) => p[k] || []);
export default {
  id: 'ectf', title: 'eCTF Preparation', track: 'competition', requires: ['security', 'rtos'],
  tagline: 'The hardware MITRE’s Embedded Capture the Flag has actually used, and the design-then-review workflow it rewards.',
  labsTitle: 'Practice scenarios',
  intro: `MITRE’s eCTF has changed hardware several times. This track names the year for every platform statement, works from MITRE’s public reference repositories and the manufacturers’ SDKs, and is explicit about what could not be verified. The practice scenarios are written for this course: they are modelled on the *shape* of eCTF work — a functional spec, security requirements, an insecure reference design, then a review that finds and fixes its weaknesses — and are not official MITRE challenges.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
