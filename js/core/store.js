// Learner state, persisted in localStorage. Everything lives in this browser only.
const KEY = 'bench.v1';
const blank = () => ({
  lessons: {},      // lessonId -> { best: 0..1, attempts, last }
  labs: {},         // labId -> { steps: {i:true}, quiz: 0..1, mode: 'hardware'|'sim'|null, done: bool }
  done: {},         // interactive item key -> true (exercises, widget challenges)
  checkpoints: {},  // sectionId -> best score 0..1
  bookmarks: [],    // [{ref, title}]
  notes: [],        // [{id, ts, title, body, ref}]
  review: {},       // questionId -> { box: 1..5, due: epoch ms, lesson, section }
  kinds: {},        // question kind -> { n, ok } over first attempts
  last: null,       // { href, title } of the lesson or lab last opened
  settings: { theme: 'auto', review: false },
});
let state = load();
const subs = new Set();
function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return blank(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: progress lasts for this page only */ }
  subs.forEach((f) => f(state));
}
export const store = {
  get s() { return state; },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
  recordQuiz(lessonId, score) {
    const r = state.lessons[lessonId] || { best: 0, attempts: 0 };
    r.best = Math.max(r.best, score); r.attempts++; r.last = score; state.lessons[lessonId] = r; save();
  },
  recordKind(kind, ok) { const k = state.kinds[kind || 'concept'] || (state.kinds[kind || 'concept'] = { n: 0, ok: 0 }); k.n++; if (ok) k.ok++; save(); },
  setLast(href, title) { state.last = { href, title }; save(); },
  enroll(qid, lesson, section) { if (!state.review[qid]) { state.review[qid] = { box: 1, due: Date.now() + DAY, lesson, section }; return true; } return false; },
  commit() { save(); },
  reviewAnswer(qid, ok) {
    const r = state.review[qid]; if (!r) return;
    r.box = ok ? Math.min(r.box + 1, INTERVALS.length - 1) : 1;
    r.due = Date.now() + INTERVALS[r.box] * DAY; r.last = Date.now(); save();
  },
  dropReview(qid) { delete state.review[qid]; },
  markDone(key) { if (!state.done[key]) { state.done[key] = true; save(); } },
  isDone: (key) => !!state.done[key],
  lab(id) { return state.labs[id] || (state.labs[id] = { steps: {}, quiz: 0, mode: null, done: false }); },
  saveLab() { save(); },
  recordCheckpoint(sid, score) { state.checkpoints[sid] = Math.max(state.checkpoints[sid] || 0, score); save(); },
  toggleBookmark(ref, title) {
    const i = state.bookmarks.findIndex((b) => b.ref === ref);
    if (i >= 0) state.bookmarks.splice(i, 1); else state.bookmarks.unshift({ ref, title });
    save(); return i < 0;
  },
  isBookmarked: (ref) => state.bookmarks.some((b) => b.ref === ref),
  addNote(n) { state.notes.unshift({ id: Date.now().toString(36), ts: Date.now(), title: '', body: '', ref: '', ...n }); save(); return state.notes[0]; },
  updateNote(id, patch) { const n = state.notes.find((x) => x.id === id); if (n) { Object.assign(n, patch, { ts: Date.now() }); save(); } },
  deleteNote(id) { state.notes = state.notes.filter((x) => x.id !== id); save(); },
  set(k, v) { state.settings[k] = v; save(); },
  exportJSON: () => JSON.stringify(state, null, 2),
  importJSON(txt) { state = Object.assign(blank(), JSON.parse(txt)); save(); },
  reset() { state = blank(); save(); },
};
export const PASS = 0.8;
export const DAY = 86400000;
/** Days until a question returns, by box. Box 1 is tomorrow; a wrong answer sends it back to box 1. */
export const INTERVALS = [0, 1, 3, 7, 16, 35];
