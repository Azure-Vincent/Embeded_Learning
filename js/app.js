import { h, s as svg, clear, append } from './core/dom.js';
import { md, inline } from './core/md.js';
import { store, PASS, INTERVALS } from './core/store.js';
import * as C from './core/curriculum.js';
import { renderBlocks, renderLab, quiz, question } from './core/render.js';
import { practiceLabel } from './core/keys.js';
import { WIDGETS, mountWidget } from './widgets/registry.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const pct = (x) => Math.round(x * 100) + '%';
const go = (hash) => (location.hash = hash);
const meter = (v, label) => h('div', { class: 'meter', role: 'img', 'aria-label': `${label || ''} ${pct(v)}` }, h('span', { style: { width: pct(v) } }));

function applyTheme() {
  const t = store.s.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

function renderNav() {
  const due = C.reviewDue().length;
  const cur = location.hash.split('/')[2];
  append(clear(nav), [
    h('a', { class: 'navlink' + (location.hash === '#/' || !location.hash ? ' on' : ''), href: '#/' }, 'Dashboard'),
    h('div', { class: 'navhead' }, 'Curriculum'),
    C.sections.map((sec, i) => {
      const p = C.sectionProgress(sec), locked = C.isLocked(sec);
      return h('a', { class: 'navlink sec' + (cur === sec.id ? ' on' : '') + (locked ? ' locked' : ''), href: '#/section/' + sec.id, title: locked ? 'Locked: finish the prerequisites first' : '' },
        h('span', { class: 'pin' }, String(i + 1).padStart(2, '0')), h('span', { class: 'lbl' }, sec.title),
        h('span', { class: 'st' }, locked ? 'locked' : p.pct >= 1 ? 'done' : p.pct > 0 ? pct(p.pct) : ''));
    }),
    h('div', { class: 'navhead' }, 'Tools'),
    [['review', 'Review'], ['practice', 'Practice'], ['workbench', 'Workbench tools'], ['skills', 'Skills matrix'], ['notebook', 'Lab notebook'], ['bookmarks', 'Bookmarks'], ['glossary', 'Glossary'], ['troubleshooting', 'Troubleshooting'], ['references', 'Primary sources'], ['settings', 'Settings']]
      .map(([r, t]) => h('a', { class: 'navlink' + (location.hash.startsWith('#/' + r) ? ' on' : ''), href: '#/' + r }, t, r === 'review' && due ? h('span', { class: 'due-pill', title: 'questions due for review' }, due) : null)),
  ]);
}

function page(title, lead, ...kids) {
  append(clear(main), [h('header', { class: 'pagehead' }, h('h1', {}, title), lead ? h('p', { class: 'lead', html: inline(lead) }) : null), kids]);
  document.title = title + ' — Mitre Prep Tool';
  main.focus({ preventScroll: true }); window.scrollTo(0, 0);
}
const crumbs = (...items) => h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, items.flatMap((it, i) => [i ? h('span', {}, '/') : null, it[1] ? h('a', { href: it[1] }, it[0]) : h('span', {}, it[0])]));

// ---- Dashboard -----------------------------------------------------------
function dashboard() {
  const next = C.nextUp(), prof = C.trackProficiency(), ready = C.competitionReadiness();
  const totalL = C.sections.reduce((a, x) => a + (x.lessons?.length || 0), 0), mast = C.sections.reduce((a, x) => a + (x.lessons || []).filter(C.lessonMastered).length, 0);
  const totalLabs = C.sections.reduce((a, x) => a + (x.labs?.length || 0), 0), labsDone = C.sections.reduce((a, x) => a + (x.labs || []).filter(C.labDone).length, 0);
  const hwLabs = Object.values(store.s.labs).filter((l) => l.done && l.mode === 'hardware').length;
  const scores = Object.values(store.s.lessons).map((l) => l.best);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  page('Embedded systems and hardware security', 'From Ohm’s law to an eCTF-style secure design. Progress here is earned by passing assessments and building labs, not by scrolling.',
    next ? h('section', { class: 'next' }, h('div', {}, h('div', { class: 'tag' }, 'Continue'), h('h2', {}, next.lesson ? next.lesson.title : next.lab.title), h('p', { class: 'muted' }, `${next.sec.title} · ${next.lesson ? 'lesson' : 'laboratory'}`)),
      h('a', { class: 'btn', href: next.lesson ? `#/lesson/${next.sec.id}/${next.lesson.id}` : `#/lab/${next.sec.id}/${next.lab.id}` }, next.lesson ? 'Open lesson' : 'Open lab')) : h('section', { class: 'next' }, h('h2', {}, 'Everything unlocked is complete.')),
    h('section', { class: 'stats' },
      [['Lessons mastered', `${mast} / ${totalL}`], ['Labs completed', `${labsDone} / ${totalLabs}`], ['Labs verified on hardware', hwLabs], ['Average assessment score', scores.length ? pct(avg) : '—']]
        .map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k)))),
    reviewPanel(),
    h('section', { class: 'cols2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Proficiency'), h('p', { class: 'muted' }, 'Average demonstrated level across each track’s skills. Reading alone does not move these.'),
        [['programming', 'Programming'], ['hardware', 'Hardware'], ['security', 'Security']].map(([k, t]) => h('div', { class: 'profrow' }, h('span', {}, t), meter(prof[k] || 0, t), h('span', { class: 'num' }, pct(prof[k] || 0)))),
        h('h3', { style: { fontSize: '1rem', margin: '16px 0 4px' } }, 'First-attempt accuracy by question type'),
        Object.keys(store.s.kinds).length ? [['concept', 'Concepts'], ['code', 'Code reading'], ['circuit', 'Circuit analysis'], ['arch', 'Architecture'], ['security', 'Security reasoning']].map(([k, t]) => { const v = store.s.kinds[k]; return h('div', { class: 'kindrow' }, h('span', {}, t), v ? meter(v.ok / v.n, t) : h('span', { class: 'muted' }, 'no answers yet'), h('span', { class: 'num' }, v ? `${pct(v.ok / v.n)} of ${v.n}` : '')); })
          : h('p', { class: 'muted' }, 'Appears once you have answered assessment questions. It shows which kind of reasoning to practise.'),
        h('div', { class: 'profrow ready' }, h('span', {}, 'Competition readiness'), meter(ready, 'Competition readiness'), h('span', { class: 'num' }, pct(ready))),
        h('p', {}, h('a', { href: '#/skills' }, 'Open the skills matrix'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Recent notebook entries'),
        store.s.notes.length ? h('ul', { class: 'plain' }, store.s.notes.slice(0, 4).map((n) => h('li', {}, h('a', { href: '#/notebook' }, n.title || 'Untitled'), h('span', { class: 'muted' }, ' ' + new Date(n.ts).toLocaleDateString()))))
          : h('p', { class: 'muted' }, 'Nothing yet. Engineers keep notebooks: record what you measured, what surprised you and what you would do differently.'),
        h('p', {}, h('a', { href: '#/notebook' }, 'Open the notebook')))),
    h('section', {}, h('h2', {}, 'Learning path'), h('p', { class: 'muted' }, 'Arrows show what each section builds on. Filled: demonstrated. Outlined: open to you now. Dashed: still locked.'), pathDiagram()),
    h('section', {}, h('h2', {}, 'Curriculum map'), h('p', { class: 'muted' }, 'A section unlocks when 80% of the lessons in each prerequisite are mastered, or when you pass that prerequisite’s checkpoint test.'),
      h('div', { class: 'secgrid' }, C.sections.map((sec, i) => {
        const p = C.sectionProgress(sec), locked = C.isLocked(sec);
        return h('a', { class: 'seccard' + (locked ? ' locked' : ''), href: '#/section/' + sec.id },
          h('div', { class: 'pin' }, String(i + 1).padStart(2, '0')), h('h3', {}, sec.title), h('p', {}, sec.tagline || ''), meter(p.pct, sec.title),
          h('div', { class: 'meta' }, locked ? 'Needs: ' + C.missingPrereqs(sec).map((r) => r.title).join(', ') : `${p.mastered}/${p.lessons} lessons` + (p.labs ? `, ${p.labsDone}/${p.labs} labs` : '')));
      }))));
}

/** Prerequisite graph of the sections, laid out by depth, coloured by the learner's state. */
function pathDiagram() {
  const depth = {}; const d = (sec) => depth[sec.id] ?? (depth[sec.id] = (sec.requires || []).length ? 1 + Math.max(...sec.requires.map((r) => d(C.section(r)))) : 0);
  C.sections.forEach(d);
  const cols = []; for (const sec of C.sections) (cols[depth[sec.id]] ||= []).push(sec);
  // top-to-bottom: one row per prerequisite depth, so it stays legible on a phone
  const W = 168, H = 34, GX = 14, GY = 26, per = Math.max(...cols.map((c) => c.length));
  const width = per * (W + GX) - GX + 4, height = cols.length * (H + GY) - GY + 4, pos = {};
  cols.forEach((row, ri) => row.forEach((sec, ci) => { pos[sec.id] = { x: 2 + (width - 4 - (row.length * (W + GX) - GX)) / 2 + ci * (W + GX), y: 2 + ri * (H + GY) }; }));
  const el = svg('svg', { class: 'pathmap', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Prerequisite map of the twelve sections' },
    svg('defs', {}, svg('marker', { id: 'arr', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' }, svg('path', { d: 'M0 0 8 4 0 8z', fill: 'var(--muted)' }))));
  for (const sec of C.sections) for (const r of sec.requires || []) {
    const a = pos[r], b = pos[sec.id], x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y - 2, my = (y1 + y2) / 2;
    el.append(svg('path', { d: `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.2, 'marker-end': 'url(#arr)', opacity: .7 }));
  }
  for (const sec of C.sections) {
    const { x, y } = pos[sec.id], passed = C.sectionPassed(sec), locked = C.isLocked(sec);
    const words = sec.title.split(' '), half = Math.ceil(words.length / 2);
    const lines = sec.title.length > 26 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [sec.title];
    const g = svg('a', { href: '#/section/' + sec.id, 'aria-label': `${sec.title}: ${passed ? 'demonstrated' : locked ? 'locked' : 'open'}` },
      svg('rect', { x, y, width: W, height: H, rx: 4, fill: passed ? 'var(--mask)' : 'var(--surface)', stroke: locked ? 'var(--muted)' : 'var(--mask)', 'stroke-width': 1.5, 'stroke-dasharray': locked ? '4 3' : null }),
      lines.map((t, i) => svg('text', { x: x + W / 2, y: y + H / 2 + (lines.length === 1 ? 4 : i * 13 - 2), 'text-anchor': 'middle', 'font-size': 12.5, fill: passed ? 'var(--mask-ink)' : locked ? 'var(--muted)' : 'var(--ink)' }, t)));
    el.append(g);
  }
  return h('div', { class: 'pathwrap' }, el);
}

function reviewPanel() {
  const deck = C.reviewDeck(), due = deck.filter((c) => c.due <= Date.now()).length, last = store.s.last;
  if (!deck.length && !last) return null;
  return h('section', { class: 'cols2' },
    h('div', { class: 'panel' }, h('h2', {}, 'Review'), deck.length
      ? [h('p', {}, due ? `${due} question${due === 1 ? ' is' : 's are'} due from lessons you mastered earlier.` : `Nothing due. ${deck.length} questions are scheduled.`), h('a', { class: due ? 'btn' : 'btn ghost', href: '#/review' }, due ? 'Review now' : 'Open review')]
      : h('p', { class: 'muted' }, 'Questions join the review deck when you master a lesson, and return at growing intervals.')),
    last ? h('div', { class: 'panel' }, h('h2', {}, 'Where you left off'), h('p', {}, last.title), h('a', { class: 'btn ghost', href: last.href }, 'Return to it')) : null);
}

// ---- Section ---------------------------------------------------------------
function sectionView(sid) {
  const sec = C.section(sid); if (!sec) return notFound();
  const locked = C.isLocked(sec), p = C.sectionProgress(sec);
  const kids = [crumbs(['Dashboard', '#/'], [sec.title])];
  if (locked) {
    kids.push(h('section', { class: 'callout c-warn' }, h('div', { class: 'tag' }, 'Locked'),
      h('p', {}, 'This section builds directly on material you have not demonstrated yet:'),
      h('ul', {}, C.missingPrereqs(sec).map((r) => h('li', {}, h('a', { href: '#/section/' + r.id }, r.title), ' — master its lessons, or ', h('a', { href: '#/checkpoint/' + r.id }, 'take its checkpoint test'), ' if you already know it.'))),
      h('p', { class: 'muted' }, 'You can read the outline below. Review mode in Settings opens everything, without changing what counts as demonstrated.')));
  }
  if (sec.intro) kids.push(h('div', { class: 'prose', html: md(sec.intro) }));
  const row = (href, title, meta, state, cls) => locked
    ? h('div', { class: 'item locked' }, h('span', { class: 'ititle' }, title), h('span', { class: 'imeta' }, meta))
    : h('a', { class: 'item ' + (cls || ''), href }, h('span', { class: 'ititle' }, title), h('span', { class: 'imeta' }, meta), h('span', { class: 'istate ' + (state ? 's-' + state.replace(/\W.*/, '').toLowerCase() : '') }, state || ''));
  if (sec.lessons?.length) kids.push(h('section', {}, h('h2', {}, 'Lessons'), h('div', { class: 'items' }, sec.lessons.map((l) => {
    const r = store.s.lessons[l.id];
    const pk = C.practiceKeys(l), pd = pk.filter(store.isDone).length;
    const isNext = l === sec.lessons.find((x) => !C.lessonMastered(x));
    return row(`#/lesson/${sec.id}/${l.id}`, l.title, `${l.minutes || 20} min` + (pk.length ? ` · practice ${pd}/${pk.length}` : ''), C.lessonMastered(l) ? 'Mastered' : r ? `Best ${pct(r.best)}` : isNext ? 'Next' : '');
  }))));
  if (sec.labs?.length) kids.push(h('section', {}, h('h2', {}, sec.labsTitle || 'Laboratories'), h('div', { class: 'items' }, sec.labs.map((l) => {
    const r = store.s.labs[l.id];
    return row(`#/lab/${sec.id}/${l.id}`, l.title, l.kind || `${l.minutes || 60} min`, r?.done ? (r.mode === 'hardware' ? 'Hardware-verified' : 'Done (no hardware)') : '');
  }))));
  if (sec.lessons?.length) kids.push(h('section', { class: 'panel' }, h('h2', {}, 'Checkpoint test'), h('p', {}, `A test with at least one question from every lesson in this section. Passing at ${PASS * 100}% counts as demonstrating the section and unlocks what depends on it — the route for learners who already know the material.`),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: '#/checkpoint/' + sec.id }, 'Take the checkpoint'), store.s.checkpoints[sec.id] != null ? h('span', { class: 'muted' }, 'Best: ' + pct(store.s.checkpoints[sec.id])) : null)));
  page(sec.title, sec.tagline, h('div', { class: 'secprog' }, meter(p.pct, 'Section progress'), h('span', {}, pct(p.pct))), ...kids);
}

function toolbar(ref, title) {
  const bm = h('button', { type: 'button', class: 'btn small ghost' });
  const set = () => (bm.textContent = store.isBookmarked(ref) ? 'Bookmarked' : 'Bookmark');
  bm.onclick = () => { store.toggleBookmark(ref, title); set(); }; set();
  return h('div', { class: 'toolbar' }, bm, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { store.addNote({ title: 'Notes: ' + title, ref }); go('#/notebook'); } }, 'Add notebook entry'));
}

function lessonView(sid, lid, focusKey) {
  const sec = C.section(sid), l = C.lessonOf(sid, lid); if (!l) return notFound();
  if (C.isLocked(sec)) return sectionView(sid);
  const idx = sec.lessons.indexOf(l), prev = sec.lessons[idx - 1], nxt = sec.lessons[idx + 1];
  const state = h('div', { class: 'mastery' });
  const drawState = () => {
    const r = store.s.lessons[l.id];
    const keys = C.practiceKeys(l), doneN = keys.filter(store.isDone).length;
    append(clear(state), [C.lessonMastered(l) ? h('span', { class: 'ok' }, `Mastered (${pct(r.best)})`) : h('span', {}, r ? `Best quiz score ${pct(r.best)} — ${PASS * 100}% needed` : 'Not yet assessed'),
      keys.length ? h('span', { class: 'muted' }, ` · practice ${doneN}/${keys.length}`) : null]);
  };
  const refresh = () => { drawState(); renderNav(); };
  const unsub = store.subscribe(() => (document.body.contains(state) ? drawState() : unsub()));
  const article = h('article', { class: 'lesson' }, renderBlocks(l.blocks, l.id));
  const bar = h('div', { class: 'readbar', 'aria-hidden': 'true' }, h('span'));
  const quizEl = l.quiz?.length ? quiz(l.quiz, { best: store.s.lessons[l.id]?.best,
    onAnswer: (q, first) => store.recordKind(q.kind, first),
    onFinish: (sc) => { store.recordQuiz(l.id, sc); if (C.lessonMastered(l)) C.enrollLesson(sec, l); refresh(); } }) : null;
  store.setLast(`#/lesson/${sid}/${lid}`, l.title);
  page(l.title, l.summary,
    crumbs(['Dashboard', '#/'], [sec.title, '#/section/' + sid], [`Lesson ${idx + 1} of ${sec.lessons.length}`]),
    h('div', { class: 'lessonmeta' }, state, toolbar(`#/lesson/${sid}/${lid}`, l.title)),
    bar, outline(article, quizEl), article, quizEl,
    h('nav', { class: 'pager' }, prev ? h('a', { href: `#/lesson/${sid}/${prev.id}` }, '← ' + prev.title) : h('span'), nxt ? h('a', { href: `#/lesson/${sid}/${nxt.id}` }, nxt.title + ' →') : h('a', { href: '#/section/' + sid }, 'Back to ' + sec.title)));
  refresh();
  // reading progress: how far through the lesson body the learner has scrolled
  const onScroll = () => {
    if (!bar.isConnected) return window.removeEventListener('scroll', onScroll);
    const r = article.getBoundingClientRect(), total = r.height - window.innerHeight * 0.5;
    bar.firstChild.style.width = Math.max(0, Math.min(1, total > 0 ? -r.top / total : 1)) * 100 + '%';
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  if (focusKey) { const el = article.querySelector(`[data-key="${CSS.escape(decodeURIComponent(focusKey))}"]`); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50); }
}

/** "In this lesson": headings plus the things to do, so a long lesson can be navigated and resumed. */
function outline(article, quizEl) {
  const items = [];
  for (const el of article.children) {
    if (el.matches('.prose')) el.querySelectorAll('h2, h3').forEach((hd) => items.push({ el: hd, text: hd.textContent, sub: false }));
    else if (el.matches('.exercise')) items.push({ el, text: 'Exercise', sub: true });
    else if (el.matches('.predict')) items.push({ el, text: 'Predict first', sub: true });
    else if (el.matches('.widget')) items.push({ el, text: 'Hands-on: ' + (el.querySelector('.widget-title')?.textContent || 'tool'), sub: true });
  }
  if (quizEl) items.push({ el: quizEl, text: 'Check your understanding', sub: false });
  if (items.length < 4) return null;
  const jump = (el) => { const y = el.getBoundingClientRect().top + window.scrollY - 64; window.scrollTo({ top: y }); };
  return h('details', { class: 'outline' }, h('summary', {}, `In this lesson (${items.filter((i) => i.sub).length} things to do)`),
    h('ol', {}, items.map((it) => h('li', { class: it.sub ? 'sub' : '' }, h('button', { type: 'button', onclick: () => jump(it.el) }, it.text)))));
}

function labView(sid, lid) {
  const sec = C.section(sid), lab = C.labOf(sid, lid); if (!lab) return notFound();
  if (C.isLocked(sec)) return sectionView(sid);
  const miss = (lab.requires || []).map(C.section).filter((r) => r && !C.sectionPassed(r));
  const head = [crumbs(['Dashboard', '#/'], [sec.title, '#/section/' + sid], [lab.kind || 'Laboratory'])];
  store.setLast(`#/lab/${sid}/${lid}`, lab.title);
  if (miss.length && !store.s.settings.review) {
    // Lab-level prerequisites lock the lab itself; the learner still sees what it will ask of them.
    return page(lab.title, lab.summary, ...head,
      h('aside', { class: 'callout c-warn' }, h('div', { class: 'tag' }, 'Locked'),
        h('p', {}, 'This project builds on sections you have not demonstrated yet:'),
        h('ul', {}, miss.map((r) => h('li', {}, h('a', { href: '#/section/' + r.id }, r.title), ' — master its lessons or ', h('a', { href: '#/checkpoint/' + r.id }, 'pass its checkpoint test'), '.')))),
      h('section', {}, h('h2', {}, 'What you will do'), h('ul', {}, (lab.objectives || []).map((o) => h('li', { html: inline(o) })))));
  }
  page(lab.title, lab.summary, ...head,
    h('div', { class: 'lessonmeta' }, h('span', { class: 'muted' }, `About ${lab.minutes || 60} minutes`), toolbar(`#/lab/${sid}/${lid}`, lab.title)),
    renderLab(lab, renderNav));
}

function checkpointView(sid) {
  const sec = C.section(sid); if (!sec) return notFound();
  const n = C.checkpointQuestions(sec).length;
  page('Checkpoint: ' + sec.title, `${n} questions, with at least one from every lesson in the section. ${PASS * 100}% on first attempts demonstrates it.`, crumbs(['Dashboard', '#/'], [sec.title, '#/section/' + sid], ['Checkpoint']),
    n ? quiz(() => C.checkpointQuestions(sec), { title: 'Checkpoint test', best: store.s.checkpoints[sid], onAnswer: (q, first) => store.recordKind(q.kind, first), onFinish: (sc) => { store.recordCheckpoint(sid, sc); renderNav(); } }) : h('p', {}, 'No questions available yet.'));
}

// ---- Spaced review -----------------------------------------------------------
function reviewView(mode) {
  const deck = C.reviewDeck(), now = Date.now();
  const due = deck.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
  const early = mode === 'early';
  const cards = (early ? [...deck].sort((a, b) => a.box - b.box || a.due - b.due) : due).slice(0, 12);
  const kids = [h('div', { class: 'prose', html: md(`Questions from lessons you have mastered come back here at growing intervals: after ${INTERVALS.slice(1).join(', ')} days. Answer from memory. A miss sends the question back to tomorrow and points you at the lesson. This is what keeps week-two material available in week ten.`) })];
  if (!deck.length) kids.push(h('p', { class: 'muted' }, 'Nothing to review yet. Questions join the review deck when you master a lesson.'), h('a', { class: 'btn', href: '#/' }, 'Go to the dashboard'));
  else if (!cards.length) {
    const next = Math.min(...deck.map((c) => c.due));
    kids.push(h('section', { class: 'panel' }, h('h2', {}, 'Nothing is due'), h('p', {}, `${deck.length} questions are in your deck. The next one is due ${new Date(next).toLocaleDateString()}.`), h('a', { class: 'btn ghost', href: '#/review/early' }, 'Review early anyway')));
  } else {
    let left = cards.length, right = 0;
    const summary = h('div', { class: 'quiz-status', 'aria-live': 'polite' }, `${cards.length} of ${early ? deck.length : due.length} ${early ? 'in the deck' : 'due'} in this session.`);
    kids.push(...cards.map((c, i) => {
      const from = h('div', { class: 'from' });
      const q = question(c.q, i, (first) => {
        store.reviewAnswer(c.qid, first); store.recordKind(c.q.kind, first);
        left--; if (first) right++;
        append(clear(from), [first ? `Remembered. Returns in ${INTERVALS[store.s.review[c.qid].box]} days.` : 'Missed, so it returns tomorrow. Revisit ', first ? null : h('a', { href: `#/lesson/${c.sec.id}/${c.lesson.id}` }, c.lesson.title), first ? null : '.']);
        if (!left) { summary.className = 'quiz-status pass'; append(clear(summary), [`Session done: ${right} of ${cards.length} from memory. `, h('a', { href: '#/review' }, 'Check for more'), ' · ', h('a', { href: '#/' }, 'Dashboard')]); renderNav(); }
      });
      return h('div', { class: 'review-card' }, q, from, h('div', { class: 'from' }, `${c.sec.title} · ${c.lesson.title}`));
    }), summary);
  }
  page('Review', `${due.length} due now · ${deck.length} in your deck`, ...kids);
}

// ---- Practice index ------------------------------------------------------------
function practiceView(filter) {
  const only = filter === 'c' ? 'C exercise' : null;
  let total = 0, done = 0;
  const secs = C.sections.map((sec) => {
    const locked = C.isLocked(sec);
    const rows = [];
    for (const l of sec.lessons || []) for (const it of C.practiceItems(l)) {
      const kind = practiceLabel(it.b); if (only && kind !== only) continue;
      const d = store.isDone(it.key); total++; if (d) done++;
      const name = it.b.t === 'exercise' ? (it.b.prompt || '').replace(/[`*#\[\]]/g, '').split(/(?<=[.?!])\s/)[0].slice(0, 90) : (it.b.props?.title || it.b.title || WIDGETS[it.b.name]?.title || it.b.name) + (it.b.name !== 'c-lab' ? ': ' + (it.b.props.challenge || it.b.props.scenario || it.b.props.device || it.b.props.capture || it.b.props.image || '') : '');
      rows.push(locked ? h('div', { class: 'pitem' }, h('span', { class: 'mk' }, '○'), h('span', { class: 'muted' }, name), h('span', { class: 'kind' }, 'locked'))
        : h('a', { class: 'pitem' + (d ? ' done' : ''), href: `#/lesson/${sec.id}/${l.id}/${encodeURIComponent(it.key)}` }, h('span', { class: 'mk' }, d ? '●' : '○'), h('span', {}, name, h('span', { class: 'muted' }, ' — ' + l.title)), h('span', { class: 'kind' }, kind)));
    }
    return rows.length ? h('section', {}, h('h2', {}, sec.title), h('div', { class: 'items' }, rows)) : null;
  });
  page('Practice', `${done} of ${total} done. Every exercise and tool challenge in the course, so you can drill one skill without rereading a lesson.`,
    h('div', { class: 'w-tabs' }, h('a', { class: 'w-tab' + (!only ? ' on' : ''), href: '#/practice' }, 'Everything'), h('a', { class: 'w-tab' + (only ? ' on' : ''), href: '#/practice/c' }, 'C programming only')), ...secs);
}

// ---- Tool pages -----------------------------------------------------------
function skillsView() {
  const skills = C.allSkills();
  const body = Object.entries(C.TRACKS).map(([tk, tname]) => {
    const rows = skills.filter((x) => x.track === tk); if (!rows.length) return null;
    return h('section', {}, h('h2', {}, tname), h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Skill you can demonstrate'), h('th', {}, 'Section'), C.LEVELS.slice(1).map((n) => h('th', { class: 'lv' }, n)))),
      h('tbody', {}, rows.map((sk) => { const lv = C.skillLevel(sk); return h('tr', {}, h('td', {}, sk.name), h('td', {}, h('a', { href: '#/section/' + sk.section }, sk.sectionTitle)), [1, 2, 3, 4].map((n) => h('td', { class: 'lv ' + (lv >= n ? 'on' : '') , 'aria-label': lv >= n ? 'reached' : 'not reached' }, lv >= n ? '●' : '○'))); })))));
  });
  page('Skills matrix', 'What you have shown you can do, and with what evidence.',
    h('div', { class: 'prose', html: md(`
- **Explained** — you passed the assessment of a lesson that teaches the skill.
- **Practised** — you mastered every lesson for the skill and completed their exercises and simulator challenges.
- **Built in a lab** — you completed a laboratory that uses the skill, in simulation or by review.
- **Verified on hardware** — you recorded that lab as built and tested on a physical board. Only you can attest to this.`) }), ...body);
}

function notebookView() {
  const listEl = h('div', { class: 'notes' });
  const draw = () => {
    clear(listEl);
    if (!store.s.notes.length) listEl.append(h('p', { class: 'muted' }, 'No entries yet. Add one for each lab: wiring as built, measurements, what failed and how you found it.'));
    for (const n of store.s.notes) {
      const title = h('input', { type: 'text', value: n.title, placeholder: 'Title', 'aria-label': 'Entry title', onchange: () => store.updateNote(n.id, { title: title.value }) });
      const body = h('textarea', { rows: 6, placeholder: 'Date, setup, measurements, observations, conclusions…', 'aria-label': 'Entry body', onchange: () => store.updateNote(n.id, { body: body.value }) }, n.body);
      body.value = n.body;
      listEl.append(h('article', { class: 'note' }, title, body, h('div', { class: 'row' }, h('span', { class: 'muted' }, new Date(n.ts).toLocaleString()), n.ref ? h('a', { href: n.ref }, 'Linked page') : null,
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { if (confirm('Delete this entry?')) { store.deleteNote(n.id); draw(); } } }, 'Delete'))));
    }
  };
  draw();
  page('Lab notebook', 'Your own record. Saved in this browser; export it from Settings to keep a copy.',
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { store.addNote({ title: '' }); draw(); listEl.querySelector('input')?.focus(); } }, 'New entry'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { const t = store.s.notes.map((n) => `# ${n.title}\n${new Date(n.ts).toISOString()}\n\n${n.body}\n`).join('\n---\n\n'); const a = h('a', { href: URL.createObjectURL(new Blob([t], { type: 'text/markdown' })), download: 'lab-notebook.md' }); a.click(); } }, 'Download as Markdown')), listEl);
}

function bookmarksView() {
  page('Bookmarks', 'Pages and terms you marked to come back to.', store.s.bookmarks.length
    ? h('div', { class: 'items' }, store.s.bookmarks.map((b) => h('a', { class: 'item', href: b.ref }, h('span', { class: 'ititle' }, b.title))))
    : h('p', { class: 'muted' }, 'Nothing bookmarked yet. Use the Bookmark button on any lesson, lab or glossary term.'));
}

function filterable(placeholder, items, render, text, initial = '') {
  const out = h('div', { class: 'flist' });
  const input = h('input', { type: 'search', class: 'filter', placeholder, value: initial, 'aria-label': placeholder });
  const draw = () => {
    const q = input.value.trim().toLowerCase(); clear(out);
    const hit = items.filter((it) => !q || text(it).toLowerCase().includes(q));
    append(out, [hit.length ? hit.map(render) : h('p', { class: 'muted' }, `Nothing matches “${input.value}”.`)]);
  };
  input.oninput = draw; draw();
  return [input, out];
}

function glossaryView(term) {
  const g = C.glossary();
  const q = term ? decodeURIComponent(term) : '';
  page('Glossary', `${g.length} terms. Type to filter.`, ...filterable('Filter terms…', g, (it) => {
    const ref = '#/glossary/' + encodeURIComponent(it.term.toLowerCase());
    const bm = h('button', { type: 'button', class: 'linkbtn', onclick: () => { store.toggleBookmark(ref, 'Glossary: ' + it.term); bm.textContent = store.isBookmarked(ref) ? 'bookmarked' : 'bookmark'; } }, store.isBookmarked(ref) ? 'bookmarked' : 'bookmark');
    return h('div', { class: 'gterm' }, h('dt', {}, it.term, ' ', bm), h('dd', { html: md(it.def) }),
      h('dd', { class: 'muted', style: { fontSize: '.8rem' } }, 'Taught in ', it.sections.map((x, i) => [i ? ', ' : '', h('a', { href: '#/section/' + x.id }, x.title)])));
  }, (it) => it.term + ' ' + it.def, q));
}

/** Clicking a glossary link inside a lesson shows the definition in place instead of leaving the lesson. */
function glossPopover(a) {
  document.querySelector('.gloss-pop')?.remove();
  const term = decodeURIComponent(a.getAttribute('href').split('/').pop());
  const g = C.glossaryLookup(term);
  const pop = h('div', { class: 'gloss-pop', role: 'dialog', 'aria-label': 'Definition' },
    g ? [h('h4', {}, g.term), h('div', { html: md(g.def) }), h('div', { class: 'meta' }, h('a', { href: '#/glossary/' + encodeURIComponent(g.term.toLowerCase()) }, 'Open in glossary'))]
      : [h('p', {}, `“${term}” is not in the glossary yet.`), h('div', { class: 'meta' }, h('a', { href: '#/search/' + encodeURIComponent(term) }, 'Search the course for it'))]);
  document.body.append(pop);
  const r = a.getBoundingClientRect();
  pop.style.top = r.bottom + window.scrollY + 6 + 'px';
  pop.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + 'px';
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a.gloss');
  if (a && main.contains(a) && !a.closest('.gloss-pop')) { e.preventDefault(); glossPopover(a); return; }
  if (!e.target.closest?.('.gloss-pop')) document.querySelector('.gloss-pop')?.remove();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelector('.gloss-pop')?.remove();
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) { e.preventDefault(); document.querySelector('#search input').focus(); }
});

function troubleView() {
  page('Troubleshooting', 'Symptoms first. Find what you are seeing, then check causes in order of likelihood.', ...filterable('Describe the symptom…', C.troubleshooting(), (t) =>
    h('article', { class: 'trouble' }, h('h3', {}, t.symptom), h('div', { class: 'meta' }, t.area || t.sectionTitle), h('div', { html: md('**Likely causes.** ' + t.causes) }), h('div', { html: md('**What to do.** ' + t.fix) })),
  (t) => [t.symptom, t.area, t.causes, t.fix].join(' ')));
}

function referencesView() {
  const refs = C.references(), by = {};
  for (const r of refs) (by[r.org || 'Other'] ||= []).push(r);
  page('Primary sources', 'The manufacturer, standards-body and competition documents this curriculum is written against. When this app and a datasheet disagree, the datasheet wins.',
    Object.entries(by).sort().map(([org, rs]) => h('section', {}, h('h2', {}, org), h('ul', {}, rs.map((r) => h('li', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.title), r.note ? ' — ' + r.note : ''))))));
}

function workbenchView(name) {
  if (name && WIDGETS[name]) {
    const body = h('div', { class: 'widget-body' });
    page(WIDGETS[name].title, 'Standalone tool. Simulated behaviour — verify anything that matters on a real board.', crumbs(['Workbench', '#/workbench'], [WIDGETS[name].title]), h('figure', { class: 'widget' }, body));
    mountWidget(body, name, {}, {});
    return;
  }
  const groups = {};
  for (const [k, w] of Object.entries(WIDGETS)) (groups[w.group] ||= []).push([k, w]);
  page('Workbench', 'Every simulator and calculator in the course, usable on its own.', Object.entries(groups).map(([g, ws]) => h('section', {}, h('h2', {}, g), h('div', { class: 'items' }, ws.map(([k, w]) => h('a', { class: 'item', href: '#/workbench/' + k }, h('span', { class: 'ititle' }, w.title)))))));
}

function settingsView() {
  const theme = h('select', { 'aria-label': 'Theme', onchange: () => { store.set('theme', theme.value); applyTheme(); } }, ['auto', 'light', 'dark'].map((t) => h('option', { value: t, selected: store.s.settings.theme === t }, t[0].toUpperCase() + t.slice(1))));
  const review = h('input', { type: 'checkbox', checked: store.s.settings.review, onchange: () => { store.set('review', review.checked); renderNav(); } });
  const file = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async () => { try { store.importJSON(await file.files[0].text()); alert('Progress imported.'); route(); } catch (e) { alert('That file is not a valid progress export: ' + e.message); } } });
  page('Settings', null,
    h('section', { class: 'panel' }, h('h2', {}, 'Appearance'), h('label', { class: 'row' }, 'Theme ', theme)),
    h('section', { class: 'panel' }, h('h2', {}, 'Review mode'), h('label', { class: 'row' }, review, h('span', {}, 'Open every section regardless of prerequisites')), h('p', { class: 'muted' }, 'For instructors and returning learners. It does not change what counts as demonstrated.')),
    h('section', { class: 'panel' }, h('h2', {}, 'Your data'), h('p', {}, 'Progress, notes and bookmarks are stored only in this browser.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' })), download: 'mitre-prep-tool-progress.json' }); a.click(); } }, 'Export progress'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => file.click() }, 'Import progress'), file,
        h('button', { type: 'button', class: 'btn ghost danger', onclick: () => { if (confirm('Erase all progress, notes and bookmarks in this browser?')) { store.reset(); route(); } } }, 'Erase everything'))));
}

// ---- Search ------------------------------------------------------------------
let INDEX;
function buildIndex() {
  const out = [];
  const textOf = (blocks) => (blocks || []).map((b) => typeof b === 'string' ? b : [b.md, b.q, b.prompt, b.reveal, b.caption, b.code].filter(Boolean).join(' ')).join(' ');
  for (const sec of C.sections) {
    for (const l of sec.lessons || []) out.push({ kind: 'Lesson', title: l.title, where: sec.title, href: `#/lesson/${sec.id}/${l.id}`, text: (l.summary || '') + ' ' + textOf(l.blocks) });
    for (const l of sec.labs || []) out.push({ kind: l.kind || 'Lab', title: l.title, where: sec.title, href: `#/lab/${sec.id}/${l.id}`, text: [l.summary, ...(l.objectives || []), typeof l.background === 'string' ? l.background : textOf(l.background), ...(l.steps || []).map((s) => s.title + ' ' + (s.md || ''))].join(' ') });
  }
  for (const g of C.glossary()) out.push({ kind: 'Glossary', title: g.term, where: '', href: '#/glossary/' + encodeURIComponent(g.term.toLowerCase()), text: g.def });
  for (const t of C.troubleshooting()) out.push({ kind: 'Troubleshooting', title: t.symptom, where: t.sectionTitle, href: '#/troubleshooting', text: t.causes + ' ' + t.fix });
  for (const [k, w] of Object.entries(WIDGETS)) out.push({ kind: 'Tool', title: w.title, where: w.group, href: '#/workbench/' + k, text: '' });
  return out.map((o) => ({ ...o, lt: o.title.toLowerCase(), lx: o.text.toLowerCase() }));
}
function searchView(q) {
  q = decodeURIComponent(q || '').trim();
  INDEX ||= buildIndex();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = !terms.length ? [] : INDEX.map((o) => {
    let score = 0;
    for (const t of terms) { const a = o.lt.includes(t), b = o.lx.includes(t); if (!a && !b) return null; score += (a ? 10 : 0) + (b ? 1 : 0); }
    return { o, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 60);
  const snip = (o) => { const i = o.lx.indexOf(terms[0]); return i < 0 ? '' : '…' + o.text.slice(Math.max(0, i - 60), i + 100).replace(/[`*#|\n]+/g, ' ') + '…'; };
  page(`Search: ${q}`, `${hits.length} result${hits.length === 1 ? '' : 's'} across lessons, labs, glossary, troubleshooting and tools.`,
    hits.length ? h('div', { class: 'items' }, hits.map(({ o }) => h('a', { class: 'item tall', href: o.href }, h('span', { class: 'ititle' }, o.title), h('span', { class: 'imeta' }, o.kind + (o.where ? ' · ' + o.where : '')), h('span', { class: 'snip' }, snip(o)))))
      : h('p', { class: 'muted' }, q ? 'No matches. Try a shorter or more general term.' : 'Type in the search box above.'));
}

function notFound() { page('Page not found', 'That address does not match anything in the course.', h('a', { class: 'btn', href: '#/' }, 'Go to the dashboard')); }

function route() {
  const [, r, a, b, c] = location.hash.split('/');
  document.querySelector('.gloss-pop')?.remove();
  document.body.classList.remove('navopen');
  ({ '': dashboard, section: () => sectionView(a), lesson: () => lessonView(a, b, c), review: () => reviewView(a), practice: () => practiceView(a), lab: () => labView(a, b), checkpoint: () => checkpointView(a), skills: skillsView, notebook: notebookView, bookmarks: bookmarksView,
    glossary: () => glossaryView(a), troubleshooting: troubleView, references: referencesView, workbench: () => workbenchView(a), settings: settingsView, search: () => searchView(a) }[r || ''] || notFound)();
  renderNav();
}

document.getElementById('search').addEventListener('submit', (e) => { e.preventDefault(); go('#/search/' + encodeURIComponent(e.target.q.value)); });
document.getElementById('menu').addEventListener('click', () => document.body.classList.toggle('navopen'));
window.addEventListener('hashchange', route);
// When served by the desktop launcher, tell it a page is still open so it can stop itself after the tab closes.
// On any other host the request simply fails and is ignored.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  const ping = () => fetch('/bench-ping', { cache: 'no-store' }).catch(() => {});
  ping(); setInterval(ping, 60000);
}
applyTheme(); route();
