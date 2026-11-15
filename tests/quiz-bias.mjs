// Reports how often the keyed answer is the longest option. Usage: node tests/quiz-bias.mjs [--list section]
import * as C from '../js/core/curriculum.js';
const list = process.argv.indexOf('--list') > 0 ? process.argv[process.argv.indexOf('--list') + 1] : null;
let tot = 0, longest = 0, big = 0;
for (const sec of C.sections) {
  let n = 0, l = 0, g = 0;
  const each = (owner, qs) => { for (const q of qs || []) {
    const ok = q.choices.find((c) => c.ok), others = q.choices.filter((c) => !c.ok);
    const maxO = Math.max(...others.map((c) => c.t.length)), avgO = others.reduce((a, c) => a + c.t.length, 0) / others.length;
    n++; if (ok.t.length > maxO) l++;
    const give = ok.t.length > maxO * 1.3 && ok.t.length - maxO > 15;   // clearly longer than every distractor
    if (give) { g++; if (list === sec.id) console.log(`${owner}: ${ok.t.length} vs ${Math.round(avgO)} :: ${q.q.slice(0, 70).replace(/\n/g, ' ')}`); }
  } };
  for (const x of sec.lessons || []) each(x.id, x.quiz);
  for (const x of sec.labs || []) each(x.id, x.quiz);
  tot += n; longest += l; big += g;
  if (!list) console.log(sec.id.padEnd(18), 'questions', String(n).padStart(3), ' key is longest', String(Math.round(100 * l / n)).padStart(3) + '%', ' clearly longest', String(Math.round(100 * g / n)).padStart(3) + '%');
}
if (!list) console.log('ALL'.padEnd(18), 'questions', tot, ' key is longest', Math.round(100 * longest / tot) + '%', ' clearly longest', Math.round(100 * big / tot) + '%', '(chance for 4 options: 25%)');
