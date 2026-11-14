import { h, clear } from '../core/dom.js';

// Real cryptography through the browser's WebCrypto API. Demo keys only.
const enc = (t) => new TextEncoder().encode(t);
const hexs = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const TABS = [['hash', 'Hash'], ['hmac', 'MAC'], ['sign', 'Signature'], ['aead', 'Authenticated encryption']];

export default function mount(el, props = {}, ctx = {}) {
  if (!globalThis.crypto?.subtle) { el.append(h('div', { class: 'w-msg warn' }, 'WebCrypto is unavailable here. Open the app over https or from localhost.')); return; }
  let tab = props.tab || 'hash';
  const solved = new Set();
  const need = props.tab ? [props.tab] : TABS.map((t) => t[0]);
  const mark = (k) => { solved.add(k); if (need.every((x) => solved.has(x))) ctx.complete?.(); };
  const body = h('div');
  const tabs = h('div', { class: 'w-tabs' }, TABS.map(([k, t]) => h('button', { type: 'button', class: 'w-tab', onclick: () => { tab = k; draw(); } }, t)));
  const area = (v, rows = 2) => h('textarea', { rows, class: 'mono', spellcheck: 'false' }, v);
  const out = () => h('pre', { class: 'ascii', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } });
  const ask = (k, q, options, why) => { const fb = h('div', { class: 'fb' }); return h('div', { class: 'w-task' }, h('p', {}, q), h('div', { class: 'opts' }, options.map(([t, ok, w]) => { const b = h('button', { type: 'button', class: 'opt' }, t); b.onclick = () => { b.classList.add(ok ? 'right' : 'wrong'); fb.className = 'fb ' + (ok ? 'ok' : 'no'); fb.textContent = w; if (ok) mark(k); }; return b; })), fb); };

  const views = {
    async hash() {
      const a = area('firmware image v1.2'), o = out();
      const run = async () => {
        const d1 = new Uint8Array(await crypto.subtle.digest('SHA-256', enc(a.value)));
        const flipped = enc(a.value); if (flipped.length) flipped[0] ^= 1;
        const d2 = new Uint8Array(await crypto.subtle.digest('SHA-256', flipped));
        let diff = 0; for (let i = 0; i < 32; i++) { let x = d1[i] ^ d2[i]; while (x) { diff += x & 1; x >>= 1; } }
        o.textContent = `SHA-256(input)            ${hexs(d1)}\nSHA-256(one bit flipped)  ${hexs(d2)}\n${diff} of 256 output bits differ (about half: the avalanche effect)`;
      };
      a.oninput = run; await run();
      return [h('p', {}, 'A hash maps any input to a fixed-size fingerprint. Change one bit and about half the output bits change.'), a, o,
        ask('hash', 'A device stores a firmware image and, next to it in the same flash, the SHA-256 of that image, and checks them at boot. What does this protect against?', [
          ['Accidental corruption only', true, 'Right. Anyone who can rewrite the image can rewrite the stored hash too. A bare hash gives integrity against accidents, not authenticity.'],
          ['Deliberate modification by someone with flash access', false, 'They would replace the hash along with the image, and the check would pass.'],
          ['Reading the firmware out of the chip', false, 'A hash does not hide anything; the image is stored in the clear.']])];
    },
    async hmac() {
      const key = area('shared-device-key', 1), m = area('UNLOCK door 3'), tagIn = h('input', { type: 'text', class: 'mono', style: { width: '100%' }, 'aria-label': 'Tag to verify' }), o = out();
      const tagOf = async () => hexs(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', enc(key.value || ' '), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc(m.value)));
      const run = async () => { const t = await tagOf(); if (!tagIn.dataset.touched) tagIn.value = t; o.textContent = `HMAC-SHA-256 tag   ${t}\nverification       ${tagIn.value === t ? 'VALID' : 'INVALID — message or key differs from when the tag was made'}`; };
      [key, m].forEach((x) => (x.oninput = run)); tagIn.oninput = () => { tagIn.dataset.touched = 1; run(); };
      await run();
      return [h('p', {}, 'A MAC is a keyed fingerprint. Only holders of the key can produce a valid tag. Press the button, then edit the message and watch verification fail.'), h('label', {}, 'Key', key), h('label', {}, 'Message', m), h('button', { type: 'button', class: 'btn small ghost', onclick: () => { tagIn.dataset.touched = 1; run(); } }, 'Freeze this tag, then edit the message'), h('label', {}, 'Tag received', tagIn), o,
        ask('hmac', 'Ten thousand devices ship with the same HMAC key. One is opened and its flash read out. What is the consequence?', [
          ['Valid tags can now be forged for every device', true, 'Yes. A symmetric key shared across a fleet falls for all units when it falls for one. Derive per-device keys, or use signatures so devices hold only a public key.'],
          ['Only that one device is affected', false, 'The key in that device is the same key in all the others.'],
          ['Nothing, because HMAC cannot be reversed', false, 'Nobody needs to reverse anything: the key itself was read from flash.']])];
    },
    async sign() {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const img = area('firmware image v1.3'), o = out(); let sig = null, wrongKey = false;
      const run = async () => { if (!sig) { o.textContent = 'Sign the image first.'; return; } const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, (wrongKey ? other : kp).publicKey, sig, enc(img.value)); o.textContent = `signature (ECDSA P-256)  ${hexs(sig).slice(0, 64)}…\ndevice verifies with ${wrongKey ? 'a DIFFERENT public key' : 'the vendor public key'}: ${ok ? 'VALID — install' : 'INVALID — refuse'}`; };
      img.oninput = run;
      return [h('p', {}, 'The vendor signs with a private key that never leaves the build server. Devices hold only the public key, which can verify but cannot sign.'), img,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: async () => { sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc(img.value)); run(); } }, 'Sign on the build server'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { wrongKey = !wrongKey; run(); } }, 'Swap the public key in the device')), o, h('p', { class: 'w-note' }, 'After signing, edit the image text: verification fails. That is why the public key (or its hash) must sit in storage an attacker cannot rewrite.'),
        ask('sign', 'Someone extracts everything stored in a device that verifies ECDSA-signed updates. Can they now sign firmware the fleet will accept?', [
          ['No: the device holds only the public key', true, 'Correct, and this is the main reason update authentication uses signatures rather than a shared MAC key.'],
          ['Yes: the verification key is the signing key', false, 'That is true of a MAC. With a signature scheme the two keys are different, and only the public one is in the device.'],
          ['Yes, once they also know the image hash', false, 'The hash is public anyway. Producing a signature requires the private key.']])];
    },
    async aead() {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const p1 = area('PIN=4821 slot=3', 1), p2 = area('PIN=0000 slot=3', 1), o = out();
      const run = async () => {
        const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc('hdr') }, key, enc(p1.value)));
        const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc('hdr') }, key, enc(p2.value)));
        const n = Math.min(p1.value.length, p2.value.length);
        const x = Array.from({ length: n }, (_, i) => c1[i] ^ c2[i]), px = Array.from({ length: n }, (_, i) => enc(p1.value)[i] ^ enc(p2.value)[i]);
        const bad = c1.slice(); bad[0] ^= 1; let tamper = 'accepted (!)';
        try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc('hdr') }, key, bad); } catch { tamper = 'REJECTED — authentication tag does not match'; }
        o.textContent = `ciphertext 1 + tag  ${hexs(c1)}\nciphertext 2 + tag  ${hexs(c2)}\n\nflip one ciphertext bit and decrypt: ${tamper}\n\nSame key AND same nonce were used for both messages:\nC1 xor C2  ${hexs(x)}\nP1 xor P2  ${hexs(px)}   ← identical: the key stream cancelled out`;
      };
      [p1, p2].forEach((x) => (x.oninput = run)); await run();
      return [h('p', {}, 'AES-GCM encrypts and authenticates in one operation. It has one rule that must never be broken: a nonce is used once per key.'), h('label', {}, 'Message 1', p1), h('label', {}, 'Message 2 (encrypted with the same nonce, which is the mistake)', p2), o,
        ask('aead', 'A device encrypts each log record with AES-GCM using a nonce counter that restarts at zero after every reset. What goes wrong?', [
          ['Nonces repeat under the same key, exposing relationships between plaintexts and weakening authentication', true, 'Yes. Persist the counter, or use a random 96-bit nonce from a real random source, or derive a fresh key per boot.'],
          ['Nothing, the key is still secret', false, 'The demonstration above used a secret key throughout and still leaked the XOR of the two plaintexts.'],
          ['Decryption stops working after a reset', false, 'It keeps working, which is why this bug survives testing. The failure is in secrecy, not in function.']])];
    },
  };
  async function draw() {
    tabs.querySelectorAll('.w-tab').forEach((b, i) => b.classList.toggle('on', TABS[i][0] === tab));
    clear(body); const kids = await views[tab](); body.append(...kids.filter(Boolean));
  }
  el.append(tabs, body, h('p', { class: 'w-note' }, 'These run real SHA-256, HMAC, ECDSA P-256 and AES-256-GCM in your browser. On a microcontroller you would use the vendor crypto library or hardware accelerator, with the same properties and the same rules. For per-device keys, derive each from a master secret and the device ID with HKDF at provisioning time.'));
  draw();
}
