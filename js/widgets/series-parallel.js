// Series/parallel network builder: a chain of stages in series, each stage one to three resistors in parallel.
import { h, clear, fmtSI } from '../core/dom.js';
import { solveNetwork, fmtR, eSeriesValues } from '../sim/electronics.js';
import { svg, wire, resistor, battery, txt, dot, flow, slider, readout, equation, messages, note } from '../sim/electronics-draw.js';

export const MAX_STAGES = 3, MAX_BRANCHES = 3, RATING = 0.25;

/** stages: [[r, r…], …] → network tree for solveNetwork. */
export const toTree = (stages) => ({ series: stages.map((b) => (b.length === 1 ? { r: b[0] } : { parallel: b.map((r) => ({ r })) })) });
/** Flat per-resistor results: [{name, stage, r, v, i, p}] plus totals. */
export function analyse(stages, v) {
  const sol = solveNetwork(toTree(stages), v), rows = [];
  let n = 0;
  sol.series.forEach((st, si) => {
    const kids = st.parallel || [st];
    kids.forEach((k) => rows.push({ name: 'R' + (++n), stage: si, r: k.r, v: k.v, i: k.i, p: k.p }));
  });
  return { rows, req: sol.req, i: sol.i, p: sol.p, stageV: sol.series.map((x) => x.v), stageR: sol.series.map((x) => x.req) };
}
/** Symbolic expression such as "R1 + (R2 ∥ R3)". */
export function expression(stages, label = (n) => 'R' + n) {
  let n = 0;
  return stages.map((b) => { const names = b.map(() => label(++n)); return names.length > 1 ? '(' + names.join(' ∥ ') + ')' : names[0]; }).join(' + ');
}

export default function mount(el) {
  const st = { v: 5, stages: [[220], [1000, 1000]] };
  const values = eSeriesValues('E12', 1, 6);
  const sV = slider({ label: 'Source voltage', min: 1, max: 24, step: 0.5, value: st.v, fmt: (v) => v.toFixed(1) + ' V', oninput: (v) => { st.v = v; draw(); } });
  const fig = h('div'), editor = h('div', { class: 'el-col' }), ro = readout(), eq = equation(), msg = messages(), table = h('div', { class: 'table-wrap' });
  clear(el).append(h('div', { class: 'w-grid series-parallel' },
    h('div', { class: 'el-col' }, fig, ro.el, eq.el, table, msg.el),
    h('div', { class: 'el-col' }, h('div', { class: 'w-controls' }, sV.el), editor)),
  note(`ideal resistors and wires, ideal source. Power warnings assume ${fmtSI(RATING, 'W')} parts. The builder is limited to ${MAX_STAGES} series stages of up to ${MAX_BRANCHES} parallel branches; bridge networks need nodal analysis and are out of scope here.`));

  function buildEditor() {
    clear(editor);
    let n = 0;
    st.stages.forEach((branches, si) => {
      const card = h('div', { class: 'series-parallel-stage' },
        h('h4', {}, `Stage ${si + 1}` + (branches.length > 1 ? ' — parallel group' : ' — single resistor'),
          st.stages.length > 1 ? h('button', { type: 'button', class: 'series-parallel-x', 'aria-label': `Remove stage ${si + 1}`, onclick: () => { st.stages.splice(si, 1); buildEditor(); draw(); } }, 'Remove stage') : null));
      branches.forEach((r, bi) => {
        const name = 'R' + (++n);
        const sel = h('select', { 'aria-label': name + ' value' }, values.map((v) => h('option', { value: v, selected: v === r }, fmtR(v))));
        sel.addEventListener('change', () => { branches[bi] = +sel.value; draw(); });
        card.append(h('div', { class: 'series-parallel-r' }, h('span', {}, name), sel,
          branches.length > 1 ? h('button', { type: 'button', class: 'series-parallel-x', 'aria-label': 'Remove ' + name, onclick: () => { branches.splice(bi, 1); buildEditor(); draw(); } }, '×') : h('span')));
      });
      if (branches.length < MAX_BRANCHES) card.append(h('button', { type: 'button', class: 'btn small ghost', onclick: () => { branches.push(1000); buildEditor(); draw(); } }, '+ parallel branch'));
      editor.append(card);
    });
    if (st.stages.length < MAX_STAGES) editor.append(h('button', { type: 'button', class: 'btn small', onclick: () => { st.stages.push([470]); buildEditor(); draw(); } }, '+ series stage'));
  }

  function draw() {
    const a = analyse(st.stages, st.v), n = st.stages.length;
    const xr = 66 + n * 104, W = xr + 22, H = 232, top = 46, bot = 206;
    const kids = [wire([54, 106], [54, top], [80, top]), wire([54, 146], [54, bot], [xr, bot], [xr, top]), battery(54, 106, fmtSI(st.v, 'V')),
      flow(`M54 106V${top}H80`, a.i), flow(`M${xr} ${top}V${bot}H54V146`, a.i)];
    let k = 0;
    st.stages.forEach((branches, si) => {
      const x0 = 90 + si * 104, xl = x0 - 10, xrb = x0 + 70;
      kids.push(wire([xl, top], [x0, top]), wire([x0 + 60, top], [xrb, top], [xrb + (si === n - 1 ? 10 : 24), top]));
      branches.forEach((r, bi) => {
        const y = top + bi * 48, row = a.rows[k++];
        if (bi > 0) kids.push(wire([xl, y - 48], [xl, y], [x0, y]), wire([x0 + 60, y], [xrb, y], [xrb, y - 48]), dot(xl, y - 48), dot(xrb, y - 48));
        kids.push(resistor(x0, y, 'h', `${row.name} ${fmtR(r)}`, null, row.p > RATING ? 'hot' : ''), txt(x0 + 30, y + 19, fmtSI(row.i, 'A'), { anchor: 'middle', cls: 'sig' }));
      });
      kids.push(wire('el-dash', [xl, bot - 22], [xrb, bot - 22]), txt(x0 + 30, bot - 8, fmtSI(a.stageV[si], 'V') + ' drop', { anchor: 'middle', cls: 'sub' }));
    });
    clear(fig).append(svg(W, H, `Network ${expression(st.stages)} across ${st.v} volts; equivalent resistance ${fmtR(a.req)}.`, ...kids));
    ro.set([['Equivalent R', fmtR(a.req)], ['Total current', fmtSI(a.i, 'A')], ['Total power', fmtSI(a.p, 'W')]]);
    const lines = [`Req = ${expression(st.stages)}`];
    let m = 0;
    st.stages.forEach((b, si) => { if (b.length > 1) lines.push(`${b.map(() => 'R' + (++m)).join(' ∥ ')} = 1 / (${b.map((r) => '1/' + fmtR(r).replace(' ', '')).join(' + ')}) = ${fmtR(a.stageR[si])}`); else m++; });
    lines.push(`Req = ${a.stageR.map(fmtR).join(' + ')} = ${fmtR(a.req)}`, `I = V / Req = ${fmtSI(st.v, 'V')} / ${fmtR(a.req)} = ${fmtSI(a.i, 'A')}`);
    eq.set(lines);
    clear(table).append(h('table', { class: 'el-table' }, h('thead', {}, h('tr', {}, ['Part', 'R', 'Drop', 'Current', 'Power'].map((t) => h('th', {}, t)))),
      h('tbody', {}, a.rows.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, fmtR(r.r)), h('td', {}, fmtSI(r.v, 'V')), h('td', {}, fmtSI(r.i, 'A')), h('td', { class: r.p > RATING ? 'el-hot' : '' }, fmtSI(r.p, 'W')))))));
    const out = [];
    const hot = a.rows.filter((r) => r.p > RATING);
    if (hot.length) out.push(['bad', `${hot.map((r) => r.name).join(', ')} would dissipate more than ${fmtSI(RATING, 'W')}: a standard quarter-watt part overheats. Note that it is the smallest resistor in a parallel group, and the largest in a series chain, that takes the most power.`]);
    out.push(['', `Check: the stage drops add up to the source (${a.stageV.map((v) => fmtSI(v, 'V')).join(' + ')} = ${fmtSI(st.v, 'V')}), and the branch currents in each parallel group add up to the total ${fmtSI(a.i, 'A')}.`]);
    msg.set(out);
  }
  buildEditor(); draw();
}
