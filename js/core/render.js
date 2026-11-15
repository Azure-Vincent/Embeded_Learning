// Turns lesson/lab data into DOM. See docs/CONTENT_GUIDE.md for the block schema.
import { h, clear, append } from './dom.js';
import { md, inline } from './md.js';
import { highlight } from './highlight.js';
import { store, PASS } from './store.js';
import { blockKeys, isPractice, practiceLabel } from './keys.js';
import { mountWidget, WIDGETS } from '../widgets/registry.js';

const CALLOUT = {
  why: 'Why it works', warn: 'Careful', mistake: 'Common mistake', note: 'Note', security: 'Security angle',
  sim: 'Simulated', hw: 'On real hardware', decision: 'Engineering decision',
};
export const CODE_STATUS = {
  'host-tested': 'Compiled and run with GCC on Linux when this lesson was written.',
  interp: 'Runs in this app’s C interpreter, which simulates the hardware.',
  'idf-built': 'Compiled for the ESP32 target with ESP-IDF v6.1 while this course was reviewed. Not run on a physical board.',
  'idf-checked': 'Every ESP-IDF call was checked against the ESP-IDF v6.1 headers. Not compiled as a whole program and not run on a board.',
  reviewed: 'Written against the vendor documentation. Not compiled or run on a physical board by this app — build it yourself and trust your own result.',
  hw: 'Requires physical hardware. Nothing here has measured it for you.',
  pseudo: 'Illustrative fragment, not a complete program.',
};

export function codeBlock(code, lang = 'c', { caption, status, explain } = {}) {
  const pre = h('pre', { class: 'code', 'data-lang': lang }, h('code', { html: highlight(code.replace(/^\n+|\s+$/g, ''), lang) }));
  const copy = h('button', { class: 'copy', type: 'button', onclick: () => { navigator.clipboard?.writeText(code.trim()); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); } }, 'Copy');
  const fig = h('figure', { class: 'codefig' }, h('div', { class: 'codebar' }, h('span', { class: 'lang' }, lang), caption ? h('span', { class: 'cap', html: inline(caption) }) : null, copy), pre);
  if (status && CODE_STATUS[status]) fig.append(h('figcaption', { class: 'status status-' + status }, CODE_STATUS[status]));
  if (explain?.length) {
    fig.append(h('dl', { class: 'explain' }, explain.map((e) => [h('dt', {}, e.lines ? 'Lines ' + e.lines : e.what || ''), h('dd', { html: md(e.md) })])));
  }
  return fig;
}

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** One multiple-choice question. Wrong picks explain the misconception and let the learner try again. */
export function question(q, idx, onSolved) {
  let tries = 0, solved = false;
  const fb = h('div', { class: 'fb', 'aria-live': 'polite' });
  const opts = h('div', { class: 'opts' }, shuffle(q.choices).map((c) => {
    const b = h('button', { type: 'button', class: 'opt', html: inline(c.t) });
    b.addEventListener('click', () => {
      if (solved || b.disabled) return;
      tries++;
      if (c.ok) {
        solved = true; b.classList.add('right');
        opts.querySelectorAll('.opt').forEach((o) => (o.disabled = true));
        fb.className = 'fb ok'; fb.innerHTML = md((tries === 1 ? '**Correct.** ' : '**That’s it.** ') + (c.why || q.explain || ''));
        onSolved(tries === 1);
      } else {
        b.classList.add('wrong'); b.disabled = true;
        fb.className = 'fb no'; fb.innerHTML = md('**Not quite.** ' + (c.why || 'Think about what actually happens in the hardware, then try another answer.'));
      }
    });
    return b;
  }));
  return h('div', { class: 'q' }, h('div', { class: 'qtext' }, h('span', { class: 'qn' }, idx + 1 + '.'), h('div', { html: md(q.q) })), q.code ? codeBlock(q.code, q.lang || 'c') : null, opts, fb);
}

/** Quiz: score is the fraction answered correctly on the first try. */
export function quiz(questions, { onFinish, onAnswer, best, title = 'Check your understanding', sample } = {}) {
  const wrap = h('section', { class: 'quiz' });
  const run = () => {
    clear(wrap);
    const qs = typeof questions === 'function' ? questions() : sample ? shuffle(questions).slice(0, sample) : questions;
    let done = 0, first = 0;
    const status = h('div', { class: 'quiz-status', 'aria-live': 'polite' });
    const setStatus = () => {
      if (done < qs.length) { status.textContent = `${done} of ${qs.length} answered` + (best != null && best > 0 ? ` · best so far ${Math.round(best * 100)}%` : ''); return; }
      const score = first / qs.length; best = Math.max(best || 0, score);
      clear(status);
      status.append(h('strong', {}, `${first} of ${qs.length} right first time (${Math.round(score * 100)}%). `),
        score >= PASS ? 'Passed.' : `You need ${Math.round(PASS * 100)}% on first attempts — the score measures what you knew before the feedback. Review the explanations, then retake.`,
        ' ', h('button', { type: 'button', class: 'btn small', onclick: run }, score >= PASS ? 'Retake' : 'Retake the quiz'));
      status.className = 'quiz-status ' + (score >= PASS ? 'pass' : 'fail');
      onFinish?.(score);
    };
    append(wrap, [h('h3', {}, title), h('p', { class: 'muted' }, 'A wrong answer shows why it is wrong and lets you try again; only first attempts count toward mastery.'),
      qs.map((q, i) => question(q, i, (firstTry) => { done++; if (firstTry) first++; onAnswer?.(q, firstTry); setStatus(); })), status]);
    setStatus();
  };
  run();
  return wrap;
}

function predict(b) {
  const reveal = h('div', { class: 'reveal', hidden: true, html: md(b.reveal || b.explain || '') });
  const box = h('div', { class: 'predict' }, h('div', { class: 'tag' }, 'Predict first'), h('div', { html: md(b.q) }), b.code ? codeBlock(b.code, b.lang || 'c') : null);
  if (b.choices) {
    const fb = h('div', { class: 'fb' });
    box.append(h('div', { class: 'opts' }, b.choices.map((c) => {
      const btn = h('button', { type: 'button', class: 'opt', html: inline(c.t) });
      btn.onclick = () => {
        btn.classList.add(c.ok ? 'right' : 'wrong');
        fb.className = 'fb ' + (c.ok ? 'ok' : 'no'); fb.innerHTML = md(c.why || (c.ok ? 'Yes.' : 'Not this one.'));
        if (c.ok) reveal.hidden = false; else btn.disabled = true;
      };
      return btn;
    })), fb, reveal);
  } else {
    const ta = h('textarea', { rows: 2, placeholder: 'Write what you expect to happen, and why…', 'aria-label': 'Your prediction' });
    const btn = h('button', { type: 'button', class: 'btn small', disabled: true, onclick: () => { reveal.hidden = false; btn.hidden = true; } }, 'Compare with the explanation');
    ta.oninput = () => (btn.disabled = ta.value.trim().length < 8);
    box.append(ta, btn, reveal);
  }
  return box;
}

function exercise(b, ctx) {
  let attempts = 0, hintIdx = 0;
  const hints = h('div', { class: 'hints' });
  const sol = h('div', { class: 'reveal', hidden: true }, h('div', { class: 'tag' }, 'Worked solution'), h('div', { html: md(b.solution || '') }));
  const fb = h('div', { class: 'fb', 'aria-live': 'polite' });
  const solBtn = h('button', { type: 'button', class: 'btn small ghost', disabled: true, title: 'Make an attempt first', onclick: () => { sol.hidden = false; ctx?.complete?.(); } }, 'Show solution');
  const hintBtn = b.hints?.length ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => {
    if (hintIdx < b.hints.length) hints.append(h('div', { class: 'hint', html: md(`**Hint ${hintIdx + 1}.** ` + b.hints[hintIdx++]) }));
    if (hintIdx >= b.hints.length) { hintBtn.disabled = true; solBtn.disabled = false; solBtn.title = ''; }
  } }, 'Give me a hint') : null;
  const attempt = () => { attempts++; solBtn.disabled = false; solBtn.title = ''; };
  let input;
  if (b.answer?.type === 'number') {
    input = h('input', { type: 'text', inputmode: 'decimal', class: 'ans', 'aria-label': 'Your answer', placeholder: b.answer.unit ? `answer in ${b.answer.unit}` : 'your answer' });
    const check = () => {
      const v = parseFloat(input.value.replace(',', '.')); if (isNaN(v)) { fb.className = 'fb no'; fb.textContent = 'Enter a number.'; return; }
      attempt();
      const tol = b.answer.tol ?? Math.abs(b.answer.value) * 0.02;
      if (Math.abs(v - b.answer.value) <= tol + 1e-12) { fb.className = 'fb ok'; fb.innerHTML = md('**Correct.** ' + (b.answer.why || 'Open the solution to compare your method.')); ctx?.complete?.(); }
      else { fb.className = 'fb no'; fb.innerHTML = md(`**Not yet.** ${v > b.answer.value ? 'Too high' : 'Too low'}. Re-check your working${b.hints?.length ? ' or take a hint' : ''}.`); }
    };
    input.onkeydown = (e) => e.key === 'Enter' && check();
    input = h('div', { class: 'row' }, input, b.answer.unit ? h('span', { class: 'unit' }, b.answer.unit) : null, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check'));
  } else if (b.answer?.type === 'text') {
    const field = h('input', { type: 'text', class: 'ans wide', 'aria-label': 'Your answer', placeholder: b.answer.placeholder || 'your answer', spellcheck: 'false' });
    const check = () => {
      if (!field.value.trim()) return; attempt();
      const norm = field.value.trim().replace(/\s+/g, ' ');
      const ok = b.answer.accept.some((p) => new RegExp('^(?:' + p + ')$', 'i').test(norm) || new RegExp('^(?:' + p + ')$', 'i').test(norm.replace(/\s+/g, '')));
      fb.className = 'fb ' + (ok ? 'ok' : 'no');
      fb.innerHTML = md(ok ? '**Correct.** ' + (b.answer.why || '') : '**Not yet.** ' + (b.answer.nudge || 'Try again, or take a hint.'));
      if (ok) ctx?.complete?.();
    };
    field.onkeydown = (e) => e.key === 'Enter' && check();
    input = h('div', { class: 'row' }, field, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check'));
  } else {
    const ta = h('textarea', { rows: b.rows || 4, spellcheck: 'false', class: b.code ? 'mono' : '', placeholder: b.placeholder || 'Work it out here before looking at the solution…', 'aria-label': 'Your attempt' });
    ta.oninput = () => { if (ta.value.trim().length >= (b.minChars || 20)) attempt(); };
    input = ta;
  }
  return h('div', { class: 'exercise' }, h('div', { class: 'tag' }, 'Your turn'), h('div', { html: md(b.prompt) }), b.code ? codeBlock(b.code, b.lang || 'c') : null, input, fb, hints, h('div', { class: 'row' }, hintBtn, solBtn), sol);
}

function widgetBlock(b, ctx) {
  const meta = WIDGETS[b.name];
  const body = h('div', { class: 'widget-body' });
  const fig = h('figure', { class: 'widget', 'data-widget': b.name },
    h('div', { class: 'widget-bar' }, h('span', { class: 'widget-title' }, b.title || meta?.title || b.name), h('span', { class: 'sim-badge', title: 'This is a simulation running in your browser, not a measurement of real hardware.' }, 'Simulation')),
    body, b.caption ? h('figcaption', { html: inline(b.caption) }) : null);
  mountWidget(body, b.name, b.props || {}, ctx);
  return fig;
}

export function renderBlock(b, ctx) {
  if (typeof b === 'string') return h('div', { class: 'prose', html: md(b) });
  switch (b.t) {
    case 'md': return h('div', { class: 'prose', html: md(b.md) });
    case 'callout': return h('aside', { class: 'callout c-' + (b.kind || 'note') }, h('div', { class: 'tag' }, b.title || CALLOUT[b.kind] || 'Note'), h('div', { html: md(b.md) }));
    case 'code': return codeBlock(b.code, b.lang || 'c', b);
    case 'predict': return predict(b);
    case 'exercise': return exercise(b, ctx);
    case 'widget': return widgetBlock(b, ctx);
    case 'figure': return h('figure', { class: 'fig' }, h('div', { class: 'svgwrap', html: b.svg }), b.caption ? h('figcaption', { html: inline(b.caption) }) : null);
    case 'ascii': return h('figure', { class: 'fig' }, h('pre', { class: 'ascii' }, b.text.replace(/^\n+|\s+$/g, '')), b.caption ? h('figcaption', { html: inline(b.caption) }) : null);
    case 'refs': return h('aside', { class: 'refs' }, h('div', { class: 'tag' }, 'Primary sources'), h('ul', {}, b.items.map((r) => h('li', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.title), r.note ? ' — ' + r.note : ''))));
    default: return h('div', { class: 'prose muted' }, `[unknown block type ${b.t}]`);
  }
}

export function renderBlocks(blocks, keyPrefix) {
  const keys = blockKeys(keyPrefix, blocks);
  return (blocks || []).map((b, i) => {
    const key = keys[i];
    const el = renderBlock(b, { key, complete: () => store.markDone(key), isDone: () => store.isDone(key) });
    el.dataset.key = key;
    if (isPractice(b)) {
      // a visible record of what has been done, so a learner returning to a lesson sees where they stopped
      const badge = h('div', { class: 'practice-state' });
      const draw = () => { const d = store.isDone(key); badge.className = 'practice-state' + (d ? ' done' : ''); badge.textContent = (d ? 'Done: ' : 'To do: ') + practiceLabel(b).toLowerCase(); };
      draw();
      const unsub = store.subscribe(() => (el.isConnected ? draw() : unsub()));
      el.prepend(badge);
    }
    return el;
  });
}

/** Guided laboratory: the ten parts every lab has, with step checkboxes and an honest completion record. */
export function renderLab(lab, onChange) {
  const rec = store.lab(lab.id);
  const sec = (n, title, ...kids) => h('section', { class: 'labsec' }, h('h3', {}, h('span', { class: 'labn' }, n), title), kids);
  const list = (items) => h('ul', {}, (items || []).map((x) => h('li', { html: inline(x) })));
  const out = h('div', { class: 'lab' });
  const blocks = (v, key) => Array.isArray(v) ? renderBlocks(v, `${lab.id}:${key}`) : h('div', { class: 'prose', html: md(v || '') });

  if (lab.requirements) {
    out.append(h('section', { class: 'labsec reqs' }, h('h3', {}, 'Requirements'),
      h('div', { class: 'cols2' },
        h('div', {}, h('h4', {}, 'Functional'), h('ol', {}, (lab.requirements.functional || []).map((x) => h('li', { html: inline(x) })))),
        h('div', {}, h('h4', {}, 'Security'), h('ol', {}, (lab.requirements.security || []).map((x) => h('li', { html: inline(x) })))))));
  }
  out.append(
    sec(1, 'Learning objectives', list(lab.objectives)),
    sec(2, 'Hardware and software', h('div', { class: 'cols2' }, h('div', {}, h('h4', {}, 'Hardware'), list(lab.hardware)), h('div', {}, h('h4', {}, 'Software'), list(lab.software)))),
    sec(3, 'Background', blocks(lab.background, 'bg')),
    sec(4, lab.diagramTitle || 'Circuit or architecture diagram', blocks(lab.diagram, 'dg')),
  );
  const stepsEl = h('ol', { class: 'steps' }, (lab.steps || []).map((st, i) => {
    const cb = h('input', { type: 'checkbox', checked: !!rec.steps[i], onchange: () => { rec.steps[i] = cb.checked; store.saveLab(); refresh(); } });
    return h('li', { class: 'step' }, h('label', { class: 'stephead' }, cb, h('span', {}, st.title)), Array.isArray(st.blocks) ? renderBlocks(st.blocks, `${lab.id}:s${i}`) : h('div', { class: 'prose', html: md(st.md || '') }), st.code ? codeBlock(st.code, st.lang || 'c', st) : null);
  }));
  out.append(sec(5, 'Guided implementation', stepsEl), sec(6, 'Code walkthrough', blocks(lab.walkthrough, 'wt')), sec(7, 'Testing', blocks(lab.testing, 'ts')));
  out.append(sec(8, 'Troubleshooting', h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Symptom'), h('th', {}, 'Likely cause'), h('th', {}, 'What to do'))),
    h('tbody', {}, (lab.troubleshooting || []).map((t) => h('tr', {}, h('td', { html: inline(t.symptom) }), h('td', { html: inline(t.cause) }), h('td', { html: inline(t.fix) }))))))));
  out.append(sec(9, 'Independent challenge', blocks(lab.challenge, 'ch')));
  if (lab.rubric) {
    out.append(h('section', { class: 'labsec' }, h('h3', {}, 'Evaluation rubric'), h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Criterion'), h('th', {}, 'Points'), h('th', {}, 'Evidence required'))),
      h('tbody', {}, lab.rubric.map((r) => h('tr', {}, h('td', { html: inline(r.criterion) }), h('td', {}, r.points), h('td', { html: inline(r.evidence) }))))))));
  }
  const done = h('section', { class: 'labsec labdone' });
  out.append(sec(10, 'Knowledge assessment', quiz(lab.quiz || [], { best: rec.quiz, title: 'Lab assessment', onFinish: (sc) => { rec.quiz = Math.max(rec.quiz || 0, sc); store.saveLab(); refresh(); } })), done);

  function refresh() {
    const stepsOk = (lab.steps || []).every((_, i) => rec.steps[i]);
    const quizOk = !(lab.quiz?.length) || rec.quiz >= PASS;
    clear(done);
    done.append(h('h3', {}, 'Record this lab'));
    if (rec.done) {
      done.append(h('p', { class: 'ok' }, rec.mode === 'hardware' ? 'Recorded as built and tested on physical hardware.' : 'Recorded as completed in simulation or by code review only. Repeat it on a real board to raise the skill level.'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { rec.done = false; store.saveLab(); refresh(); onChange?.(); } }, 'Reopen lab'));
      return;
    }
    done.append(h('p', {}, 'How did you verify your result? Be honest with yourself — the skills matrix distinguishes hardware evidence from simulation.'));
    const mk = (mode, label) => h('button', { type: 'button', class: 'btn', disabled: !(stepsOk && quizOk), onclick: () => { rec.mode = mode; rec.done = true; store.saveLab(); refresh(); onChange?.(); } }, label);
    done.append(h('div', { class: 'row' }, mk('hardware', 'I built and tested it on real hardware'), mk('sim', 'I completed it without hardware')));
    if (!(stepsOk && quizOk)) done.append(h('p', { class: 'muted' }, [!stepsOk && 'Tick every implementation step', !quizOk && `pass the assessment at ${PASS * 100}%`].filter(Boolean).join(' and ') + ' to record the lab.'));
  }
  refresh();
  return out;
}
