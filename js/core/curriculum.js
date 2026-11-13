// Assembles section modules into one curriculum and derives progress, prerequisites and skills.
import foundations from '../content/foundations.js';
import electronics from '../content/electronics.js';
import mcu from '../content/mcu-architecture.js';
import esp32 from '../content/esp32.js';
import embeddedC from '../content/embedded-c.js';
import protocols from '../content/protocols.js';
import rtos from '../content/rtos.js';
import debugging from '../content/debugging.js';
import firmware from '../content/firmware-eng.js';
import security from '../content/security.js';
import ectf from '../content/ectf.js';
import capstones from '../content/capstones.js';
import { store, PASS } from './store.js';

export const sections = [foundations, electronics, mcu, esp32, embeddedC, protocols, rtos, debugging, firmware, security, ectf, capstones];
export const TRACKS = { foundations: 'Foundations', hardware: 'Hardware', programming: 'Programming', security: 'Security', competition: 'Competition' };
export const section = (id) => sections.find((x) => x.id === id);
export const lessonOf = (sid, lid) => (section(sid)?.lessons || []).find((l) => l.id === lid);
export const labOf = (sid, lid) => (section(sid)?.labs || []).find((l) => l.id === lid);

export const lessonMastered = (l) => (store.s.lessons[l.id]?.best || 0) >= PASS;
export const labDone = (lab) => !!store.s.labs[lab.id]?.done;

export function sectionProgress(sec) {
  const ls = sec.lessons || [], labs = sec.labs || [];
  const m = ls.filter(lessonMastered).length, d = labs.filter(labDone).length;
  const total = ls.length + labs.length;
  return { lessons: ls.length, mastered: m, labs: labs.length, labsDone: d, pct: total ? (m + d) / total : 0 };
}
/** A section counts as passed when 80% of its lessons are mastered, or its checkpoint test was passed. */
export function sectionPassed(sec) {
  if ((store.s.checkpoints[sec.id] || 0) >= PASS) return true;
  const ls = sec.lessons || [];
  return ls.length > 0 && ls.filter(lessonMastered).length / ls.length >= PASS;
}
export function missingPrereqs(sec) {
  return (sec.requires || []).map(section).filter((r) => r && !sectionPassed(r));
}
export const isLocked = (sec) => !store.s.settings.review && missingPrereqs(sec).length > 0;

// ---- Skills matrix -------------------------------------------------------
export const LEVELS = ['Not yet shown', 'Explained', 'Practised', 'Built in a lab', 'Verified on hardware'];
export function allSkills() {
  const out = [];
  for (const sec of sections) for (const sk of sec.skills || []) out.push({ ...sk, section: sec.id, sectionTitle: sec.title, track: sk.track || sec.track });
  return out;
}
export function skillLevel(skill) {
  const sec = section(skill.section);
  const ls = (sec.lessons || []).filter((l) => (l.skills || []).includes(skill.id));
  const labs = (sec.labs || []).filter((l) => (l.skills || []).includes(skill.id));
  // labs in other sections may also exercise this skill
  for (const o of sections) if (o !== sec) for (const lab of o.labs || []) if ((lab.skills || []).includes(skill.id)) labs.push(lab);
  if (labs.some((l) => labDone(l) && store.s.labs[l.id].mode === 'hardware')) return 4;
  if (labs.some(labDone)) return 3;
  const mastered = ls.filter(lessonMastered);
  if (ls.length && mastered.length === ls.length && ls.every(practiceComplete)) return 2;
  if (mastered.length) return 1;
  return 0;
}
/** Keys of interactive items in a lesson: exercises, predictions with choices, widgets that declare a challenge. */
export function practiceKeys(lesson) {
  const keys = [];
  (lesson.blocks || []).forEach((b, i) => {
    if (typeof b !== 'object') return;
    if (b.t === 'exercise' || (b.t === 'widget' && (b.name === 'c-lab' || b.challenge || b.props?.challenge || b.props?.scenario || b.props?.device))) keys.push(`${lesson.id}:${i}`);
  });
  return keys;
}
export const practiceComplete = (lesson) => practiceKeys(lesson).every((k) => store.isDone(k));

export function trackProficiency() {
  const acc = {};
  for (const sk of allSkills()) { (acc[sk.track] ||= []).push(skillLevel(sk) / 4); }
  const out = {};
  for (const t of Object.keys(TRACKS)) out[t] = acc[t]?.length ? acc[t].reduce((a, b) => a + b, 0) / acc[t].length : 0;
  return out;
}
export function competitionReadiness() {
  const p = (id) => sectionProgress(section(id)).pct;
  const caps = section('capstones')?.labs || [];
  const late = caps.slice(-3); // firmware security lab, reverse engineering, eCTF-style system
  const capPct = late.length ? late.filter(labDone).length / late.length : 0;
  return 0.35 * p('ectf') + 0.25 * p('security') + 0.15 * p('debugging') + 0.25 * capPct;
}
export function nextUp() {
  for (const sec of sections) {
    if (isLocked(sec)) continue;
    for (const l of sec.lessons || []) if (!lessonMastered(l)) return { sec, lesson: l };
    for (const lab of sec.labs || []) if (!labDone(lab)) return { sec, lab };
  }
  return null;
}
export const glossary = () => sections.flatMap((x) => (x.glossary || []).map((g) => ({ ...g, section: x.id }))).sort((a, b) => a.term.localeCompare(b.term));
export const troubleshooting = () => sections.flatMap((x) => (x.troubleshooting || []).map((g) => ({ ...g, section: x.id, sectionTitle: x.title })));
export const references = () => sections.flatMap((x) => (x.refs || []).map((g) => ({ ...g, section: x.title })));
