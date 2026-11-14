import a from './protocols/a.js';
import b from './protocols/b.js';
import c from './protocols/c.js';
import meta from './protocols/meta.js';

const parts = [a, b, c, meta];
const cat = (k) => parts.flatMap((p) => p[k] || []);
export default {
  id: 'protocols', title: 'Communication Protocols', track: 'hardware', requires: ['esp32'],
  tagline: 'UART, I2C, SPI, CAN and USB from the voltage on the wire up to framed, checked, retried messages.',
  intro: `Every embedded system is a set of chips talking to each other, and most bugs you will chase live on the wires between them. This section teaches each bus at two levels at once: what the voltages are doing, and what the bits mean. Then it builds upward: how to frame bytes into messages, protect them with a CRC, decide who may talk, and find the fault when a link is silent. Nothing here was measured on physical hardware; the interactive tools are simulations, and the two labs tell you what you should see on a real bench and how to check it.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
