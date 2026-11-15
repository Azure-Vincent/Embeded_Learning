import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockKeys, isPractice, questionId } from '../js/core/keys.js';
import * as C from '../js/core/curriculum.js';
import { store, INTERVALS, DAY } from '../js/core/store.js';

test('block keys do not change when a block is inserted before them', () => {
  const ex = { t: 'exercise', prompt: 'Compute the divider output', solution: 'x' };
  const w = { t: 'widget', name: 'breadboard', props: { challenge: 'led' } };
  const before = blockKeys('L', ['intro', ex, w]);
  const after = blockKeys('L', ['intro', 'a new paragraph', { t: 'callout', kind: 'note', md: 'x' }, ex, w]);
  assert.equal(before[1], after[3]);
  assert.equal(before[2], after[4]);
});

test('identical blocks in one lesson get distinct keys', () => {
  const w = { t: 'widget', name: 'breadboard', props: { challenge: 'led' } };
  const k = blockKeys('L', [w, w]);
  assert.notEqual(k[0], k[1]);
});

test('practice detection', () => {
  assert.ok(isPractice({ t: 'exercise', prompt: 'p' }));
  assert.ok(isPractice({ t: 'widget', name: 'c-lab', props: {} }));
  assert.ok(isPractice({ t: 'widget', name: 'logic-analyzer', props: { capture: 'mystery' } }));
  assert.ok(!isPractice({ t: 'widget', name: 'ohms-law', props: {} }));
  assert.ok(!isPractice('text'));
});

test('every practice key in the course is unique', () => {
  const seen = new Set();
  for (const sec of C.sections) for (const l of sec.lessons || []) for (const k of C.practiceKeys(l)) { assert.ok(!seen.has(k), 'duplicate ' + k); seen.add(k); }
  assert.ok(seen.size > 200);
});

test('every question id in the course is unique', () => {
  const seen = new Set();
  for (const sec of C.sections) for (const l of sec.lessons || []) for (const q of l.quiz || []) { const id = questionId(l.id, q); assert.ok(!seen.has(id), 'duplicate question in ' + l.id); seen.add(id); }
});

test('checkpoint covers every lesson of a section', () => {
  for (const sec of C.sections) {
    const lessons = (sec.lessons || []).filter((l) => l.quiz?.length); if (!lessons.length) continue;
    const qs = new Set(C.checkpointQuestions(sec));
    for (const l of lessons) assert.ok(l.quiz.some((q) => qs.has(q)), `${sec.id}: no question from ${l.id}`);
    assert.ok(qs.size >= Math.min(12, lessons.flatMap((l) => l.quiz).length));
  }
});

test('glossary has one entry per term', () => {
  const g = C.glossary(), keys = g.map((x) => x.term.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(g.every((x) => x.sections.length >= 1));
});

test('prerequisites form a graph with no cycles and no unknown sections', () => {
  const state = {};
  const visit = (sec) => { if (state[sec.id] === 2) return; assert.notEqual(state[sec.id], 1, 'cycle at ' + sec.id); state[sec.id] = 1; for (const r of sec.requires || []) { assert.ok(C.section(r), 'unknown ' + r); visit(C.section(r)); } state[sec.id] = 2; };
  C.sections.forEach(visit);
});

test('review schedule: right answers lengthen the interval, a miss resets it', () => {
  const sec = C.sections[0], l = sec.lessons[0], qid = questionId(l.id, l.quiz[0]);
  C.enrollLesson(sec, l);
  assert.equal(store.s.review[qid].box, 1);
  assert.equal(C.reviewDue().length, 0, 'nothing is due on the day of mastery');
  assert.ok(C.reviewDue(Date.now() + 2 * DAY).length >= l.quiz.length);
  store.reviewAnswer(qid, true); assert.equal(store.s.review[qid].box, 2);
  store.reviewAnswer(qid, true); assert.equal(store.s.review[qid].box, 3);
  assert.ok(store.s.review[qid].due > Date.now() + (INTERVALS[3] - 1) * DAY);
  store.reviewAnswer(qid, false); assert.equal(store.s.review[qid].box, 1);
  C.enrollLesson(sec, l); assert.equal(store.s.review[qid].box, 1, 'enrolling twice does not reset progress');
});
