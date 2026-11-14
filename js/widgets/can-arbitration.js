// CAN bitwise arbitration: nodes start together, the wired-AND bus lets dominant (0) overwrite recessive (1),
// and a node that sends recessive but reads dominant stops transmitting.
import { h, clear, hex } from '../core/dom.js';
import { canArbitrate, canFrame } from '../sim/signals.js';

export const CHALLENGES = { 'predict-winner': { title: 'Predict which node wins arbitration' } };
const NAMES = ['A', 'B', 'C'];

/** '65A', '0x65a' -> 0x65A; null unless it is an 11-bit hex value. */
export function parseId(text) {
  const t = String(text).trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,3}$/i.test(t)) return null;
  const v = parseInt(t, 16);
  return v <= 0x7ff ? v : null;
}

/** One sentence about what happened in a step of canArbitrate(). */
export function explainStep(step, names = NAMES) {
  const active = step.sent.map((v, i) => (v === null ? null : names[i])).filter(Boolean);
  if (step.name === 'SOF') return 'Start of frame: every node that wants to send pulls the bus dominant (0) at the same moment. From here they send their identifiers MSB first and read the bus back after every bit.';
  if (step.lost.length) {
    const losers = step.lost.map((i) => names[i]).join(' and ');
    return `${step.name}: ${losers} sent recessive (1) but read dominant (0) on the bus. Someone with a lower identifier is still sending, so ${losers} stop${step.lost.length > 1 ? '' : 's'} transmitting at once and become${step.lost.length > 1 ? '' : 's'} a receiver. The bit on the bus was not damaged: the winner never notices.`;
  }
  if (active.length > 1) return `${step.name}: ${active.join(', ')} all sent ${step.sent.find((v) => v !== null)}, the bus shows the same, nobody can tell there is a competitor yet.`;
  return `${step.name}: only ${active[0]} is still transmitting; the bus follows it.`;
}

export function makeChallenge(rnd = Math.random) {
  for (;;) {
    const base = Math.floor(rnd() * 0x800), ids = [base, base ^ (1 << Math.floor(rnd() * 5)), base ^ (1 << (5 + Math.floor(rnd() * 5))) ^ Math.floor(rnd() * 8)].map((v) => v & 0x7ff);
    if (new Set(ids).size === 3) { for (let i = 2; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; } return ids; }
  }
}

export default function mount(el, props = {}, ctx = {}) {
  const st = { tab: props.challenge ? 'challenge' : 'explore', ids: [0x65a, 0x652, 0x123], three: true, step: 0, data: 0xa5, chIds: makeChallenge(), fb: null, answered: false };
  const tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'View' });
  const top = h('div'), gridBox = h('div', { class: 'can-arbitration-scroll', tabindex: '0', role: 'group', 'aria-label': 'Arbitration table (scrolls sideways)' });
  const btns = h('div', { class: 'row' });
  const msg = h('div', { class: 'w-msg', role: 'status', 'aria-live': 'polite' });
  const frameBox = h('div');
  el.append(tabs, top, btns, gridBox, msg, frameBox,
    h('p', { class: 'w-note' }, 'Model: classic CAN with 11-bit identifiers, all nodes perfectly synchronised on the start-of-frame edge, ideal bus levels. Bit timing, resynchronisation, error frames and CAN FD are not modelled. ',
      'Two nodes must never send data frames with the same identifier: arbitration would not separate them and they would collide in the data field.'));

  const ids = () => (st.tab === 'challenge' ? st.chIds : st.three ? st.ids : st.ids.slice(0, 2));
  const result = () => canArbitrate(ids());
  const total = 13;
  const B = (label, fn, cls = '', dis = false) => h('button', { type: 'button', class: 'btn small ' + cls, disabled: dis, onclick: fn }, label);

  function drawTop() {
    clear(top);
    if (st.tab === 'explore') {
      const row = h('div', { class: 'row' });
      NAMES.forEach((n, i) => {
        if (i === 2 && !st.three) return;
        const e = h('input', { type: 'text', class: 'mono can-arbitration-id', value: st.ids[i].toString(16).toUpperCase().padStart(3, '0'), maxlength: 5, 'aria-label': `Node ${n} identifier (hex, up to 7FF)`,
          onchange: () => { const v = parseId(e.value); if (v != null) { st.ids[i] = v; st.step = 0; } e.value = st.ids[i].toString(16).toUpperCase().padStart(3, '0'); draw(); } });
        row.append(h('label', { class: 'row can-arbitration-node' }, `Node ${n} ID 0x`, e));
      });
      row.append(h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: st.three, onchange: (e) => { st.three = e.target.checked; st.step = 0; drawTop(); draw(); } }), 'third node'));
      top.append(h('p', null, 'All nodes start a frame in the same bit time. Step through the identifier bits and watch the bus.'), row);
    } else {
      const c = st.chIds;
      top.append(h('div', { class: 'w-task' }, h('p', null, h('strong', null, 'Task. '), `Three nodes start transmitting at the same instant with identifiers A = ${hex(c[0], 3)}, B = ${hex(c[1], 3)}, C = ${hex(c[2], 3)}. Which node is still transmitting after arbitration? Write the IDs in binary before you answer.`)),
        h('div', { class: 'row', role: 'group', 'aria-label': 'Your answer' },
          NAMES.map((n, i) => B('Node ' + n, () => answer(i), st.fb && st.fb.pick === i ? '' : 'ghost')),
          B('New IDs', () => { st.chIds = makeChallenge(); st.fb = null; st.answered = false; st.step = 0; drawTop(); draw(); }, 'ghost')));
    }
  }
  function answer(i) {
    const r = result(), c = st.chIds, w = r.winners[0];
    st.answered = true; st.step = total;
    if (i === w) {
      st.fb = { ok: true, pick: i, msg: `Correct. ${NAMES[w]} has the numerically lowest identifier, so at the first bit where the IDs differ it is the one sending dominant. Check each bit in the table below.` };
      if (ctx.complete) ctx.complete();
    } else {
      const at = r.steps.find((s) => s.lost.includes(i));
      const why = c[i] === Math.max(...c) ? 'A higher number is not higher priority on CAN: it is the other way round.' : 'It is not about which ID has more ones or where it sits on the wire, only about the first bit where it differs from the others.';
      st.fb = { ok: false, pick: i, msg: `Not ${NAMES[i]}. At ${at.name} it sent recessive (1) while another node sent dominant (0); it read back 0, knew it had lost, and stopped. ${why} The table below shows every bit.` };
    }
    drawTop(); draw();
    top.querySelectorAll('button')[i].focus();
  }

  function draw() {
    clear(tabs);
    for (const [k, label] of [['explore', 'Explore'], ['challenge', 'Predict the winner']]) {
      tabs.append(h('button', { type: 'button', class: 'w-tab' + (st.tab === k ? ' on' : ''), 'aria-pressed': String(st.tab === k), onclick: () => { st.tab = k; st.step = st.tab === 'challenge' && st.answered ? total : 0; drawTop(); draw(); tabs.querySelector('.on').focus(); } }, label));
    }
    const r = result(), list = ids();
    const hidden = st.tab === 'challenge' && !st.answered;
    gridBox.hidden = btns.hidden = hidden;
    clear(btns).append(B('Step one bit', () => { st.step = Math.min(total, st.step + 1); draw(); btns.firstChild.focus(); }, '', st.step >= total),
      B('Run to the end', () => { st.step = total; draw(); }, 'ghost', st.step >= total), B('Back to the start', () => { st.step = 0; draw(); }, 'ghost', st.step === 0));
    // table
    const lostAt = list.map((_, n) => r.steps.findIndex((s) => s.lost.includes(n)));
    const tbl = h('table', { class: 'can-arbitration-grid' },
      h('thead', null, h('tr', null, h('th', null, ''), r.steps.map((s, i) => h('th', { class: i === st.step - 1 ? 'cur' : null }, s.name.replace('ID', ''))))),
      h('tbody', null,
        list.map((id, n) => h('tr', null, h('th', { scope: 'row' }, `${NAMES[n]} ${hex(id, 3)}`),
          r.steps.map((s, i) => {
            if (i >= st.step) return h('td', { class: 'todo' }, '');
            if (s.sent[n] === null) return h('td', { class: 'quiet', title: 'listening only' }, '·');
            return h('td', { class: (s.sent[n] ? 'rec' : 'dom') + (lostAt[n] === i ? ' lost' : '') + (i === st.step - 1 ? ' cur' : ''), title: lostAt[n] === i ? 'sent 1, read 0: lost arbitration' : s.sent[n] ? 'recessive' : 'dominant' }, String(s.sent[n]));
          }))),
        h('tr', { class: 'bus' }, h('th', { scope: 'row' }, 'Bus (AND)'), r.steps.map((s, i) => h('td', { class: i >= st.step ? 'todo' : (s.bus ? 'rec' : 'dom') + (i === st.step - 1 ? ' cur' : '') }, i >= st.step ? '' : String(s.bus))))));
    clear(gridBox).append(tbl);
    // message
    msg.hidden = false;
    if (st.tab === 'challenge' && st.fb) { msg.className = 'w-msg ' + (st.fb.ok ? 'ok' : 'bad'); msg.textContent = st.fb.msg; }
    else if (hidden) msg.hidden = true;
    else if (st.step === 0) { msg.className = 'w-msg'; msg.textContent = 'The bus is idle (recessive). Each transceiver can only pull the bus dominant or leave it alone, so the bus level is the AND of what everyone sends: any 0 wins. Column headers are SOF, identifier bits 10 down to 0, then RTR. Solid cells are dominant.'; }
    else if (st.step < total) { msg.className = 'w-msg' + (r.steps[st.step - 1].lost.length ? ' warn' : ''); msg.textContent = explainStep(r.steps[st.step - 1]); }
    else if (r.winners.length > 1) { msg.className = 'w-msg bad'; msg.textContent = `Nodes ${r.winners.map((i) => NAMES[i]).join(' and ')} sent identical bits all the way through, so arbitration did not pick one. Both keep transmitting and will collide as soon as their frames differ, producing bit errors. This is why every identifier on a CAN bus may be sent by only one node.`; }
    else {
      const w = r.winners[0];
      msg.className = 'w-msg ok';
      msg.textContent = `Node ${NAMES[w]} (${hex(list[w], 3)}) won without losing a single bit or any time: arbitration is non-destructive. A 0 in a more significant position beats a 1, so the lowest identifier always wins, which makes the identifier a priority. The losers retry when the bus is next idle.`;
    }
    drawFrame(r, list, hidden);
  }

  function drawFrame(r, list, hidden) {
    clear(frameBox);
    if (hidden || st.step < total || r.winners.length !== 1) return;
    const w = r.winners[0], f = canFrame({ id: list[w], data: [st.data] });
    const dIn = h('input', { type: 'text', class: 'mono can-arbitration-id', value: st.data.toString(16).toUpperCase().padStart(2, '0'), maxlength: 4, 'aria-label': 'Data byte (hex)',
      onchange: () => { const v = parseId(dIn.value); if (v != null && v <= 0xff) st.data = v; draw(); } });
    const strip = h('div', { class: 'can-arbitration-frame' });
    let i = 0;
    for (const fld of f.fields) {
      const cells = [];
      while (i < f.stuffed.length && f.stuffed[i].field === fld.name) { const b = f.stuffed[i++]; cells.push(h('span', { class: 'bit' + (b.stuff ? ' stuff' : ''), title: b.stuff ? 'stuff bit (not data)' : fld.name }, String(b.v))); }
      if (cells.length) strip.append(h('span', { class: 'fld' }, h('span', { class: 'name' }, fld.name), h('span', { class: 'bits' }, cells)));
    }
    frameBox.append(h('h4', { class: 'can-arbitration-h' }, `The frame node ${NAMES[w]} goes on to send`),
      h('label', { class: 'row' }, 'One data byte 0x', dIn),
      strip,
      h('p', { class: 'w-note' }, `${f.stuffed.length} bits on the wire, ${f.stuffCount} of them stuff bits (outlined). After five equal bits in a row the transmitter inserts one opposite bit so receivers always get edges to resynchronise on; receivers remove them. `
        + 'Stuffing covers SOF through the CRC. Fields: SOF start of frame; ID identifier; RTR 0 for a data frame; IDE 0 for an 11-bit identifier; r0 reserved; DLC number of data bytes; '
        + `CRC 15-bit checksum (${hex(f.crc, 4)} here); CRC delimiter; ACK slot, sent recessive by the transmitter and pulled dominant by any node that received the frame correctly; ACK delimiter; EOF seven recessive bits.`));
  }
  drawTop(); draw();
}
