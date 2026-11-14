import { h, clear } from '../core/dom.js';
import { makeLock, lockAccept } from '../sim/attacks.js';

// A key fob and a lock. Messages carry a real HMAC-SHA-256 tag, yet a recorded message can still be
// re-sent unless the protocol also proves freshness (counter or challenge-response).
const KEY = new TextEncoder().encode('demo-key-shown-for-teaching-only');
const hexs = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function mac(text) { const k = await crypto.subtle.importKey('raw', KEY, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hexs(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text))).slice(0, 16); }

export default function mount(el, props = {}, ctx = {}) {
  let defence = props.defence || 'none', lock = makeLock(defence), fobCounter = 0, recorded = [];
  const done = { replayed: false, blocked: false };
  const air = h('div', { class: 'w-term', style: { minHeight: '7em' } }), msg = h('div', { class: 'w-msg' }), rec = h('div', { class: 'row' });
  const say = (t) => { air.textContent += t + '\n'; air.scrollTop = 1e6; };
  const defSel = h('select', { 'aria-label': 'Protocol', onchange: () => { defence = defSel.value; lock = makeLock(defence); fobCounter = 0; recorded = []; air.textContent = ''; msg.textContent = ''; msg.className = 'w-msg'; drawRec(); } },
    [['none', 'v1: MAC over the command'], ['counter', 'v2: MAC over command + counter'], ['nonce', 'v3: challenge–response']].map(([v, t]) => h('option', { value: v, selected: v === defence }, t)));

  async function press() {
    try {
      let frame;
      if (defence === 'none') frame = { text: 'UNLOCK' };
      else if (defence === 'counter') frame = { text: `UNLOCK|ctr=${++fobCounter}`, counter: fobCounter };
      else { lock.lastNonce = crypto.getRandomValues(new Uint32Array(1))[0]; say(`lock → fob   CHALLENGE nonce=${lock.lastNonce.toString(16)}`); frame = { text: `UNLOCK|nonce=${lock.lastNonce.toString(16)}`, nonce: lock.lastNonce }; }
      frame.tag = await mac(frame.text);
      say(`fob  → lock  ${frame.text}  tag=${frame.tag}`);
      deliver(frame, false);
      recorded.push(frame); drawRec();
    } catch (e) { msg.className = 'w-msg warn'; msg.textContent = 'WebCrypto is not available in this context (it needs https or localhost).'; }
  }
  async function deliver(frame, isReplay) {
    const valid = (await mac(frame.text)) === frame.tag;
    if (isReplay && defence === 'nonce') { lock.lastNonce = crypto.getRandomValues(new Uint32Array(1))[0]; say(`lock → ?     CHALLENGE nonce=${lock.lastNonce.toString(16)}`); }
    const r = lockAccept(lock, frame, valid);
    say(`lock: ${r.accepted ? 'OPEN' : 'rejected'} — ${r.reason}`);
    if (isReplay) {
      msg.className = 'w-msg ' + (r.accepted ? 'bad' : 'ok');
      msg.textContent = r.accepted ? 'The lock opened for a recording. The listener never learned the key; it did not need to. Authenticity is not freshness.' : 'The recording was refused. The tag is still valid, but the message is not fresh.';
      if (r.accepted && defence === 'none') done.replayed = true;
      if (!r.accepted && defence !== 'none') done.blocked = true;
      if (done.replayed && done.blocked) ctx.complete?.();
    }
  }
  function drawRec() {
    clear(rec).append(recorded.length ? h('span', { class: 'w-note' }, 'Recorded off the air: ') : h('span', { class: 'w-note' }, 'Nothing recorded yet.'),
      ...recorded.slice(-4).map((f) => h('button', { type: 'button', class: 'btn small ghost', onclick: () => { say(`??   → lock  ${f.text}  tag=${f.tag}   (re-sent recording)`); deliver(f, true); } }, 'Re-send “' + f.text + '”')));
  }
  el.append(
    h('div', { class: 'w-task' }, h('p', {}, 'Press the fob so a message crosses the air, then re-send the recording. Show that protocol v1 accepts it. Then switch to v2 or v3, record a new message, and show the recording is refused.')),
    h('div', { class: 'row' }, h('label', {}, 'Protocol ', defSel), h('button', { type: 'button', class: 'btn small', onclick: press }, 'Press the fob button')),
    air, rec, msg,
    h('p', { class: 'w-note' }, 'The tags are real HMAC-SHA-256 (truncated for display) under a demo key. Simplifications: no radio, no timing, a perfect channel. Design notes: a counter must be stored so it survives reset and power loss, or it can be wound back; a nonce must come from a real random source; in both cases the MAC must cover every field the receiver acts on. Verify with a test that sends every accepted message a second time and expects a rejection, including after a power cycle.'));
  drawRec();
}
