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
import { blockKeys, isPractice, questionId } from './keys.js';

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
/** Keys of the interactive items in a lesson that count as practice (exercises, C exercises, tool challenges). */
export function practiceItems(lesson) {
  const keys = blockKeys(lesson.id, lesson.blocks);
  return (lesson.blocks || []).map((b, i) => ({ b, key: keys[i] })).filter((x) => isPractice(x.b));
}
export const practiceKeys = (lesson) => practiceItems(lesson).map((x) => x.key);
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
/** Glossary merged across sections: one entry per term, keeping the fullest definition and listing where it is taught. */
export function glossary() {
  const by = new Map();
  for (const sec of sections) for (const g of sec.glossary || []) {
    const k = g.term.trim().toLowerCase();
    const e = by.get(k);
    if (!e) by.set(k, { ...g, sections: [sec] });
    else { if (!e.sections.includes(sec)) e.sections.push(sec); if ((g.def || '').length > (e.def || '').length) e.def = g.def; }
  }
  return [...by.values()].sort((a, b) => a.term.localeCompare(b.term));
}
export function glossaryLookup(term) {
  const k = term.trim().toLowerCase(), all = glossary();
  return all.find((g) => g.term.toLowerCase() === k) || all.find((g) => g.term.toLowerCase().replace(/s$/, '') === k.replace(/s$/, '')) || all.find((g) => g.term.toLowerCase().startsWith(k) || k.startsWith(g.term.toLowerCase()));
}

// ---- Spaced review ---------------------------------------------------------
/** Put every question of a mastered lesson into the review deck (idempotent). */
export function enrollLesson(sec, lesson) {
  let added = 0;
  for (const q of lesson.quiz || []) if (store.enroll(questionId(lesson.id, q), lesson.id, sec.id)) added++;
  if (added) store.commit();
}
/** Review cards whose question still exists: [{ qid, q, lesson, sec, box, due }]. */
export function reviewDeck() {
  const out = [];
  for (const sec of sections) for (const l of sec.lessons || []) for (const q of l.quiz || []) {
    const qid = questionId(l.id, q), r = store.s.review[qid];
    if (r) out.push({ qid, q, lesson: l, sec, box: r.box, due: r.due });
  }
  return out;
}
export const reviewDue = (now = Date.now()) => reviewDeck().filter((c) => c.due <= now);

/** Checkpoint questions: at least one from every lesson, then filled to a target size. */
export function checkpointQuestions(sec) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const lessons = (sec.lessons || []).filter((l) => l.quiz?.length);
  const chosen = new Set(lessons.map((l) => pick(l.quiz)));
  const rest = lessons.flatMap((l) => l.quiz).filter((q) => !chosen.has(q)).sort(() => Math.random() - 0.5);
  const target = Math.min(lessons.flatMap((l) => l.quiz).length, Math.max(12, lessons.length + 6));
  while (chosen.size < target && rest.length) chosen.add(rest.pop());
  return [...chosen].sort(() => Math.random() - 0.5);
}
export const troubleshooting = () => sections.flatMap((x) => (x.troubleshooting || []).map((g) => ({ ...g, section: x.id, sectionTitle: x.title })));
export const references = () => sections.flatMap((x) => (x.refs || []).map((g) => ({ ...g, section: x.title })));
