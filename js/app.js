import { h, clear, append } from './core/dom.js';
import { md, inline } from './core/md.js';
import { store, PASS } from './core/store.js';
import * as C from './core/curriculum.js';
import { renderBlocks, renderLab, quiz } from './core/render.js';
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
    h('div', { class: 'navhead' }, 'Bench'),
    [['workbench', 'Workbench tools'], ['skills', 'Skills matrix'], ['notebook', 'Lab notebook'], ['bookmarks', 'Bookmarks'], ['glossary', 'Glossary'], ['troubleshooting', 'Troubleshooting'], ['references', 'Primary sources'], ['settings', 'Settings']]
      .map(([r, t]) => h('a', { class: 'navlink' + (location.hash.startsWith('#/' + r) ? ' on' : ''), href: '#/' + r }, t)),
  ]);
}

function page(title, lead, ...kids) {
  append(clear(main), [h('header', { class: 'pagehead' }, h('h1', {}, title), lead ? h('p', { class: 'lead', html: inline(lead) }) : null), kids]);
  document.title = title + ' — Bench';
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
    h('section', { class: 'cols2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Proficiency'), h('p', { class: 'muted' }, 'Average demonstrated level across each track’s skills. Reading alone does not move these.'),
        [['programming', 'Programming'], ['hardware', 'Hardware'], ['security', 'Security']].map(([k, t]) => h('div', { class: 'profrow' }, h('span', {}, t), meter(prof[k] || 0, t), h('span', { class: 'num' }, pct(prof[k] || 0)))),
        h('div', { class: 'profrow ready' }, h('span', {}, 'Competition readiness'), meter(ready, 'Competition readiness'), h('span', { class: 'num' }, pct(ready))),
        h('p', {}, h('a', { href: '#/skills' }, 'Open the skills matrix'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Recent notebook entries'),
        store.s.notes.length ? h('ul', { class: 'plain' }, store.s.notes.slice(0, 4).map((n) => h('li', {}, h('a', { href: '#/notebook' }, n.title || 'Untitled'), h('span', { class: 'muted' }, ' ' + new Date(n.ts).toLocaleDateString()))))
          : h('p', { class: 'muted' }, 'Nothing yet. Engineers keep notebooks: record what you measured, what surprised you and what you would do differently.'),
        h('p', {}, h('a', { href: '#/notebook' }, 'Open the notebook')))),
    h('section', {}, h('h2', {}, 'Curriculum map'), h('p', { class: 'muted' }, 'A section unlocks when 80% of the lessons in each prerequisite are mastered, or when you pass that prerequisite’s checkpoint test.'),
      h('div', { class: 'secgrid' }, C.sections.map((sec, i) => {
        const p = C.sectionProgress(sec), locked = C.isLocked(sec);
        return h('a', { class: 'seccard' + (locked ? ' locked' : ''), href: '#/section/' + sec.id },
          h('div', { class: 'pin' }, String(i + 1).padStart(2, '0')), h('h3', {}, sec.title), h('p', {}, sec.tagline || ''), meter(p.pct, sec.title),
          h('div', { class: 'meta' }, locked ? 'Needs: ' + C.missingPrereqs(sec).map((r) => r.title).join(', ') : `${p.mastered}/${p.lessons} lessons` + (p.labs ? `, ${p.labsDone}/${p.labs} labs` : '')));
      }))));
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
    return row(`#/lesson/${sec.id}/${l.id}`, l.title, `${l.minutes || 20} min`, C.lessonMastered(l) ? 'Mastered' : r ? `Best ${pct(r.best)}` : '');
  }))));
  if (sec.labs?.length) kids.push(h('section', {}, h('h2', {}, sec.labsTitle || 'Laboratories'), h('div', { class: 'items' }, sec.labs.map((l) => {
    const r = store.s.labs[l.id];
    return row(`#/lab/${sec.id}/${l.id}`, l.title, l.kind || `${l.minutes || 60} min`, r?.done ? (r.mode === 'hardware' ? 'Hardware-verified' : 'Done (no hardware)') : '');
  }))));
  if (sec.lessons?.length) kids.push(h('section', { class: 'panel' }, h('h2', {}, 'Checkpoint test'), h('p', {}, `Ten questions drawn from across this section. Passing at ${PASS * 100}% counts as demonstrating the section and unlocks what depends on it — the route for learners who already know the material.`),
    h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: '#/checkpoint/' + sec.id }, 'Take the checkpoint'), store.s.checkpoints[sec.id] != null ? h('span', { class: 'muted' }, 'Best: ' + pct(store.s.checkpoints[sec.id])) : null)));
  page(sec.title, sec.tagline, h('div', { class: 'secprog' }, meter(p.pct, 'Section progress'), h('span', {}, pct(p.pct))), ...kids);
}

function toolbar(ref, title) {
  const bm = h('button', { type: 'button', class: 'btn small ghost' });
  const set = () => (bm.textContent = store.isBookmarked(ref) ? 'Bookmarked' : 'Bookmark');
  bm.onclick = () => { store.toggleBookmark(ref, title); set(); }; set();
  return h('div', { class: 'toolbar' }, bm, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { store.addNote({ title: 'Notes: ' + title, ref }); go('#/notebook'); } }, 'Add notebook entry'));
}

function lessonView(sid, lid) {
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
  page(l.title, l.summary,
    crumbs(['Dashboard', '#/'], [sec.title, '#/section/' + sid], [`Lesson ${idx + 1} of ${sec.lessons.length}`]),
    h('div', { class: 'lessonmeta' }, state, toolbar(`#/lesson/${sid}/${lid}`, l.title)),
    h('article', { class: 'lesson' }, renderBlocks(l.blocks, l.id)),
    l.quiz?.length ? quiz(l.quiz, { best: store.s.lessons[l.id]?.best, onFinish: (sc) => { store.recordQuiz(l.id, sc); refresh(); } }) : null,
    h('nav', { class: 'pager' }, prev ? h('a', { href: `#/lesson/${sid}/${prev.id}` }, '← ' + prev.title) : h('span'), nxt ? h('a', { href: `#/lesson/${sid}/${nxt.id}` }, nxt.title + ' →') : h('a', { href: '#/section/' + sid }, 'Back to ' + sec.title)));
  refresh();
}

function labView(sid, lid) {
  const sec = C.section(sid), lab = C.labOf(sid, lid); if (!lab) return notFound();
  if (C.isLocked(sec)) return sectionView(sid);
  const miss = (lab.requires || []).map(C.section).filter((r) => r && !C.sectionPassed(r));
  const head = [crumbs(['Dashboard', '#/'], [sec.title, '#/section/' + sid], [lab.kind || 'Laboratory'])];
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
  const pool = (sec.lessons || []).flatMap((l) => l.quiz || []);
  page('Checkpoint: ' + sec.title, `Ten questions sampled from the whole section. ${PASS * 100}% on first attempts demonstrates it.`, crumbs(['Dashboard', '#/'], [sec.title, '#/section/' + sid], ['Checkpoint']),
    pool.length ? quiz(pool, { sample: Math.min(10, pool.length), title: 'Checkpoint test', best: store.s.checkpoints[sid], onFinish: (sc) => { store.recordCheckpoint(sid, sc); renderNav(); } }) : h('p', {}, 'No questions available yet.'));
}

// ---- Bench pages -----------------------------------------------------------
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
    return h('div', { class: 'gterm' }, h('dt', {}, it.term, ' ', bm), h('dd', { html: md(it.def) }));
  }, (it) => it.term + ' ' + it.def, q));
}

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
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' })), download: 'bench-progress.json' }); a.click(); } }, 'Export progress'),
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
  const [, r, a, b] = location.hash.split('/');
  document.body.classList.remove('navopen');
  ({ '': dashboard, section: () => sectionView(a), lesson: () => lessonView(a, b), lab: () => labView(a, b), checkpoint: () => checkpointView(a), skills: skillsView, notebook: notebookView, bookmarks: bookmarksView,
    glossary: () => glossaryView(a), troubleshooting: troubleView, references: referencesView, workbench: () => workbenchView(a), settings: settingsView, search: () => searchView(a) }[r || ''] || notFound)();
  renderNav();
}

document.getElementById('search').addEventListener('submit', (e) => { e.preventDefault(); go('#/search/' + encodeURIComponent(e.target.q.value)); });
document.getElementById('menu').addEventListener('click', () => document.body.classList.toggle('navopen'));
window.addEventListener('hashchange', route);
applyTheme(); route();
