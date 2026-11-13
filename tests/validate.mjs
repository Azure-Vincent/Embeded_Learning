// Validates all course content. Usage: node tests/validate.mjs
import { readdirSync, existsSync } from 'node:fs';
const ids = ['foundations', 'electronics', 'mcu-architecture', 'esp32', 'embedded-c', 'protocols', 'rtos', 'debugging', 'firmware-eng', 'security', 'ectf', 'capstones'];
const only = process.argv.slice(2);
const { WIDGETS } = await import('../js/widgets/registry.js');
const haveWidget = (n) => existsSync(new URL(`../js/widgets/${n}.js`, import.meta.url));
let cinterp = null;
try { cinterp = await import('../js/sim/cinterp.js'); } catch { /* interpreter not built yet */ }
const errs = [], warns = [], seen = new Set(), sectionIds = new Set(ids);
const E = (w, m) => errs.push(`${w}: ${m}`), W = (w, m) => warns.push(`${w}: ${m}`);
const STATUS = ['host-tested', 'interp', 'reviewed', 'hw', 'pseudo'];
const CALL = ['why', 'warn', 'mistake', 'note', 'security', 'sim', 'hw', 'decision'];
let nLessons = 0, nLabs = 0, nQ = 0, nCLab = 0;

function checkQs(where, qs, min) {
  if (!Array.isArray(qs) || qs.length < min) return E(where, `needs at least ${min} quiz questions, has ${qs?.length || 0}`);
  qs.forEach((q, i) => {
    nQ++;
    const w = `${where} q${i + 1}`;
    if (!q.q) E(w, 'missing q');
    if (!Array.isArray(q.choices) || q.choices.length < 3 || q.choices.length > 5) return E(w, 'needs 3-5 choices');
    if (q.choices.filter((c) => c.ok).length !== 1) E(w, 'needs exactly one ok choice');
    q.choices.forEach((c, j) => { if (!c.t) E(w, `choice ${j + 1} missing t`); if (!c.why || c.why.length < 15) E(w, `choice ${j + 1} needs a real "why" explanation`); });
  });
}
function checkBlocks(where, blocks) {
  if (typeof blocks === 'string') return;
  if (!Array.isArray(blocks)) return E(where, 'expected markdown string or block array');
  blocks.forEach((b, i) => {
    const w = `${where} block ${i}`;
    if (typeof b === 'string') return;
    if (!b || typeof b !== 'object') return E(w, 'bad block');
    switch (b.t) {
      case 'md': if (!b.md) E(w, 'md missing'); break;
      case 'callout': if (!CALL.includes(b.kind)) E(w, `bad callout kind ${b.kind}`); if (!b.md) E(w, 'callout md missing'); break;
      case 'code': if (!b.code) E(w, 'code missing'); if (!STATUS.includes(b.status)) E(w, `code status must be one of ${STATUS.join('/')}`); break;
      case 'predict': if (!b.q || !(b.reveal || b.explain)) E(w, 'predict needs q and reveal'); if (b.choices && b.choices.filter((c) => c.ok).length !== 1) E(w, 'predict choices need exactly one ok'); break;
      case 'exercise': if (!b.prompt || !b.solution) E(w, 'exercise needs prompt and solution');
        if (b.answer?.type === 'text') for (const p of b.answer.accept || []) { try { new RegExp(p); } catch { E(w, `bad regex ${p}`); } }
        if (b.answer?.type === 'number' && typeof b.answer.value !== 'number') E(w, 'numeric answer needs value'); break;
      case 'widget': if (!WIDGETS[b.name]) E(w, `unknown widget "${b.name}"`); else if (!haveWidget(b.name)) W(w, `widget file js/widgets/${b.name}.js not present yet`);
        if (b.name === 'c-lab') checkCLab(w, b.props || {}); break;
      case 'figure': if (!b.svg || !/viewBox/.test(b.svg)) E(w, 'figure needs svg with viewBox'); break;
      case 'ascii': if (!b.text) E(w, 'ascii text missing'); break;
      case 'refs': for (const r of b.items || []) if (!/^https:\/\//.test(r.url || '')) E(w, `ref url must be https: ${r.title}`); break;
      default: E(w, `unknown block type ${b.t}`);
    }
  });
}
function checkCLab(w, p) {
  nCLab++;
  for (const k of ['prompt', 'starter', 'solution']) if (!p[k]) E(w, `c-lab missing ${k}`);
  if (!Array.isArray(p.tests) || !p.tests.length) return E(w, 'c-lab needs tests');
  if (!cinterp || !p.solution) return;
  for (const t of p.tests) {
    let r;
    try { r = cinterp.runTest(p.solution, t); } catch (e) { E(w, `c-lab solution crashed interpreter: ${e.message}`); continue; }
    if (!r.pass) E(w, `c-lab solution fails test "${t.name || ''}": ${r.message}`);
    if (p.starter && p.starter !== p.solution) { try { if (p.tests.every((tt) => cinterp.runTest(p.starter, tt).pass)) W(w, 'c-lab starter already passes every test'); } catch { /* fine */ } }
  }
}
for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  let sec;
  try { sec = (await import(`../js/content/${id}.js`)).default; } catch (e) { E(id, `failed to import: ${e.message}`); continue; }
  if (sec.id !== id) E(id, 'id mismatch');
  for (const r of sec.requires || []) if (!sectionIds.has(r)) E(id, `unknown prerequisite ${r}`);
  const skillIds = new Set((sec.skills || []).map((s) => s.id)), used = new Set();
  for (const s of sec.skills || []) { if (seen.has('sk:' + s.id)) E(id, `duplicate skill id ${s.id}`); seen.add('sk:' + s.id); if (!s.name) E(id, `skill ${s.id} needs name`); }
  for (const l of sec.lessons || []) {
    nLessons++;
    const w = `${id}/${l.id}`;
    if (!l.id || seen.has(l.id)) E(w, 'missing or duplicate id'); seen.add(l.id);
    if (!l.title) E(w, 'no title');
    for (const s of l.skills || []) { used.add(s); if (!skillIds.has(s)) E(w, `unknown skill ${s}`); }
    checkBlocks(w, l.blocks || []);
    const types = (l.blocks || []).map((b) => (typeof b === 'string' ? 'md' : b.t));
    if (!types.includes('predict')) E(w, 'lesson needs a predict block');
    if (!types.includes('exercise') && !types.includes('widget')) E(w, 'lesson needs an exercise or widget');
    checkQs(w, l.quiz, 5);
  }
  for (const l of sec.labs || []) {
    nLabs++;
    const w = `${id}/${l.id}`;
    if (!l.id || seen.has(l.id)) E(w, 'missing or duplicate id'); seen.add(l.id);
    for (const s of l.skills || []) { used.add(s); if (![...seen].includes('sk:' + s) && !skillIds.has(s)) W(w, `skill ${s} not defined (yet)`); }
    for (const k of ['objectives', 'hardware', 'software', 'steps', 'troubleshooting']) if (!Array.isArray(l[k]) || !l[k].length) E(w, `lab needs non-empty ${k}`);
    for (const k of ['background', 'diagram', 'walkthrough', 'testing', 'challenge']) { if (!l[k]) E(w, `lab needs ${k}`); else checkBlocks(`${w}.${k}`, l[k]); }
    (l.steps || []).forEach((s, i) => { if (!s.title) E(w, `step ${i + 1} needs title`); if (s.code && !STATUS.includes(s.status)) E(w, `step ${i + 1} code needs status`); if (s.blocks) checkBlocks(`${w}.step${i + 1}`, s.blocks); });
    for (const t of l.troubleshooting || []) if (!t.symptom || !t.cause || !t.fix) E(w, 'troubleshooting rows need symptom, cause, fix');
    for (const r of l.requires || []) if (!sectionIds.has(r)) E(w, `unknown required section ${r}`);
    checkQs(w, l.quiz, 4);
  }
  for (const s of skillIds) if (!used.has(s)) W(id, `skill ${s} is not referenced by any lesson or lab in this section`);
  for (const r of sec.refs || []) if (!/^https:\/\//.test(r.url || '')) E(id, `ref url must be https: ${r.title}`);
  for (const g of sec.glossary || []) if (!g.term || !g.def) E(id, 'glossary entries need term and def');
  for (const t of sec.troubleshooting || []) if (!t.symptom || !t.causes || !t.fix) E(id, 'troubleshooting entries need symptom, causes, fix');
}
for (const w of warns) console.log('warn  ' + w);
for (const e of errs) console.log('ERROR ' + e);
console.log(`${nLessons} lessons, ${nLabs} labs, ${nQ} questions, ${nCLab} C labs` + (cinterp ? '' : ' (C interpreter not present: C lab solutions not executed)'));
console.log(errs.length ? `FAILED with ${errs.length} error(s)` : 'OK');
process.exit(errs.length ? 1 : 0);
