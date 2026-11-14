import { h, clear } from '../core/dom.js';
import { bootChain } from '../sim/attacks.js';

// Chain of trust: each stage verifies the next before running it. The learner changes images and
// settings and sees where boot stops. Hashes are real SHA-256 (WebCrypto); signatures are modelled.
const LABELS = {
  generic: ['Boot ROM (immutable)', 'Bootloader', 'Application'],
  esp32: ['ROM bootloader (mask ROM)', 'Second-stage bootloader', 'Application image'],
};
export default function mount(el, props = {}, ctx = {}) {
  const names = LABELS[props.platform] || LABELS.generic;
  const cfg = { secureBoot: false, antiRollback: false, minVersion: 2, debugLocked: false, flashEnc: false };
  const st = [{ name: 'ROM' }, { name: 'bootloader', tampered: false, signedWithWrongKey: false, version: 2, bytes: 'bootloader v2' }, { name: 'app', tampered: false, signedWithWrongKey: false, version: 2, bytes: 'application v2' }];
  const done = new Set();
  const stagesEl = h('div', { class: 'sbc-stages' }), logEl = h('ol', { class: 'sbc-log' }), msg = h('div', { class: 'w-msg' }), tasks = h('ul', { class: 'sbc-tasks' });
  const TASKS = [['unsigned', 'With secure boot off, boot a modified application'], ['blocked', 'Turn secure boot on and show the modified application is refused'], ['rollback', 'With secure boot on, boot an older, validly signed application'], ['norollback', 'Enable anti-rollback and show the old version is refused']];
  const sha = async (t) => { try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('') + '…'; } catch { return '(SHA-256 unavailable in this context)'; } };
  const toggle = (label, obj, key, after) => { const cb = h('input', { type: 'checkbox', checked: obj[key], onchange: () => { obj[key] = cb.checked; after?.(); draw(); } }); return h('label', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, cb, h('span', {}, label)); };

  async function draw() {
    clear(stagesEl);
    for (let i = 0; i < 3; i++) {
      const x = st[i];
      const card = h('div', { class: 'sbc-stage' }, h('h4', {}, names[i]));
      if (i === 0) card.append(h('p', { class: 'w-note' }, 'Cannot be modified. Trusts one thing: the hash of the root public key, burned into one-time-programmable memory.'), h('button', { type: 'button', class: 'btn small ghost', onclick: () => { msg.className = 'w-msg ok'; msg.textContent = 'Refused: one-time-programmable bits cannot be rewritten. This is why the root of trust lives there and not in flash.'; } }, 'Try to replace the root key hash'));
      else {
        const body = x.bytes + (x.tampered ? ' + extra code' : '');
        card.append(h('div', { class: 'w-kv' }, h('dt', {}, 'version'), h('dd', {}, x.version), h('dt', {}, 'SHA-256'), h('dd', {}, await sha(body)), h('dt', {}, 'signature'), h('dd', {}, x.signedWithWrongKey ? 'made with an unknown key' : x.tampered ? 'no longer matches image' : 'valid')),
          toggle('Modify the image bytes', x, 'tampered'), toggle('Re-sign with a key the device does not trust', x, 'signedWithWrongKey'),
          ...(i === 2 ? [h('label', { class: 'row' }, 'Version ', (() => { const sel = h('select', { onchange: () => { x.version = +sel.value; x.bytes = `application v${x.version}`; draw(); } }, [1, 2, 3].map((v) => h('option', { value: v, selected: v === x.version }, `v${v}${v === 1 ? ' (old, has a known bug)' : ''}`))); return sel; })())] : []));
      }
      stagesEl.append(card);
    }
    clear(tasks).append(...TASKS.map(([k, t]) => h('li', { class: done.has(k) ? 'ok' : '' }, (done.has(k) ? '✓ ' : '○ ') + t)));
  }
  function boot() {
    const r = bootChain(st, cfg);
    clear(logEl).append(...r.log.map((l) => h('li', { class: l.ok ? '' : 'bad' }, h('strong', {}, names[['ROM', 'bootloader', 'app'].indexOf(l.stage)] + ': '), l.msg)));
    const app = st[2], bl = st[1], mod = app.tampered || app.signedWithWrongKey || bl.tampered || bl.signedWithWrongKey;
    msg.className = 'w-msg ' + (r.booted ? (mod || app.version < cfg.minVersion ? 'bad' : 'ok') : 'ok');
    msg.textContent = r.booted ? (mod ? 'The device is running code nobody signed.' : app.version < 2 ? 'Booted an old but genuinely signed image, bringing its known bug back. A valid signature says who made the image, not that it is the newest one.' : 'Booted a verified, current image.') : `Boot stopped at ${r.stoppedAt}. The device stays in a safe state.`;
    if (r.booted && mod && !cfg.secureBoot) done.add('unsigned');
    if (!r.booted && mod && cfg.secureBoot) done.add('blocked');
    if (r.booted && cfg.secureBoot && !mod && app.version < 2) done.add('rollback');
    if (!r.booted && cfg.antiRollback && !mod && app.version < cfg.minVersion) done.add('norollback');
    draw();
    if (done.size === TASKS.length) ctx.complete?.();
  }
  el.append(
    h('div', { class: 'w-task' }, h('p', {}, 'Work through the four tasks. Each one changes an image or a setting, then presses Boot.'), tasks),
    h('div', { class: 'row' }, toggle('Secure boot enabled', cfg, 'secureBoot'), toggle('Anti-rollback enabled (minimum version 2)', cfg, 'antiRollback'), toggle('Flash encryption', cfg, 'flashEnc', () => { msg.className = 'w-msg'; msg.textContent = 'Flash encryption keeps the image confidential if the flash chip is read out. It does not authenticate anything: it is a companion to secure boot, never a replacement.'; }), toggle('Debug port locked', cfg, 'debugLocked', () => { msg.className = 'w-msg'; msg.textContent = 'An open debug port lets someone with physical access halt the CPU and change memory after verification has passed, so the chain needs the port locked in production.'; })),
    stagesEl, h('button', { type: 'button', class: 'btn', onclick: boot }, 'Boot'), logEl, msg,
    h('p', { class: 'w-note' }, props.platform === 'esp32' ? 'Labels follow ESP32 Secure Boot V2: the ROM verifies the second-stage bootloader, which verifies the application; the digest of the public signing key is stored in eFuse. See the ESP-IDF security guide for the scheme and chip-revision requirements.' : 'Generic model. Real chips differ in which stages exist, which algorithm signs them and where the key hash is stored.', ' Signature checks are modelled here; the displayed hashes are real. Verify a real design by attempting to boot a modified image, an image signed with a different key and a downgraded image, and confirming each is refused.'));
  draw();
}
