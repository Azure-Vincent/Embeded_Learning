import p0 from './esp32/lessons.js';
import p1 from './esp32/labs-a.js';
import p2 from './esp32/labs-b.js';

const parts = [p0, p1, p2];
const cat = (k) => parts.flatMap((p) => p[k] || []);
export default {
  id: 'esp32', title: 'ESP32 Development', track: 'programming', requires: ['mcu-architecture'],
  tagline: 'Ten lessons and ten build projects on the ESP32 with ESP-IDF, from one LED to a multi-peripheral device.',
  labsTitle: 'Projects',
  intro: `The ESP32 is this course’s first real board: cheap, well documented and capable enough to carry you through GPIO, timers, buses, radios and FreeRTOS. Lessons use ESP-IDF in C, and show the Arduino equivalent where that helps you read other people’s code. The projects are where the learning happens — build them on a real board if you possibly can.`,
  skills: cat('skills'), lessons: cat('lessons'), labs: cat('labs'),
  glossary: cat('glossary'), troubleshooting: cat('troubleshooting'), refs: cat('refs'),
};
