import { h, clear } from '../core/dom.js';
import { md } from '../core/md.js';
import { create, DEVICES } from '../sim/vulndevices.js';
import { store } from '../core/store.js';
export { DEVICES };

// Console to a fictional, intentionally weak device simulated in the page. The point of each device is
// the review that follows: what class of weakness it was, how to detect it, how to fix it, how to prove the fix.
const CLASS = {
  'debug-backdoor': 'Factory or debug functionality left in a release build',
  'hardcoded-pin': 'One shared secret compiled into every unit',
  'format-leak': 'Untrusted input used as a format string',
  'overflow-auth': 'Unbounded copy into a fixed buffer next to security state',
  'replay-fob': 'Authenticated messages without freshness, and fields the MAC does not cover',
  'rollback-updater': 'Signed updates without a minimum-version check',
  'weak-prng': 'Challenge values from a predictable generator',
};
const DEFENCE = {
  'hardcoded-pin': 'Give each unit its own credential at provisioning, store only a salted hash or keep it in protected key storage, and rate-limit attempts. Check by extracting your own release image and searching it for credentials.',
  'format-leak': 'Never pass external text as the format argument: write `printf("%s", text)`. Build with `-Wformat -Wformat-security -Werror`. Check with inputs containing `%` conversions and confirm they are echoed literally.',
  'overflow-auth': 'Bound every copy by the destination size, reject over-long input rather than truncating silently, and keep authorisation state away from input buffers. Check by sending inputs of every length around the limit on a host build with AddressSanitizer.',
  'replay-fob': 'Include a counter or a fresh challenge inside the authenticated data, make the MAC cover every field the receiver acts on, and never report the expected value on a status channel. Check by re-sending every accepted frame and expecting rejection.',
  'rollback-updater': 'Store a monotonic minimum version in protected storage and refuse anything older, even when correctly signed. Check by attempting to install each older signed release.',
  'weak-prng': 'Draw challenges from the hardware random number generator, never from time or a linear generator, and discard a challenge after one use. Check by collecting many challenges and testing for repeats and predictability across reboots.',
};

export default function mount(el, props = {}, ctx = {}) {
  if (!props.device) return picker(el);
  const meta = DEVICES[props.device];
  if (!meta) { el.textContent = `Unknown device "${props.device}".`; return; }
  let dev = create(props.device), hintIdx = 0;
  const hist = []; let hi = 0;
  const term = h('div', { class: 'w-term', 'aria-live': 'polite' }, dev.banner + '\n');
  const input = h('input', { type: 'text', class: 'w-term-in', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Console input', placeholder: 'type a command and press Enter' });
  const after = h('div');
  const hints = h('div');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); input.value = hist[hi] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; e.preventDefault(); }
    else if (e.key === 'Enter' && input.value.trim()) {
      const line = input.value; hist.push(line); hi = hist.length; input.value = '';
      term.textContent += dev.prompt + line + '\n' + dev.send(line) + '\n'; term.scrollTop = 1e6;
      if (dev.solved) solved();
    }
  });
  function solved() {
    if (after.firstChild) return;
    ctx.complete?.();
    const d = meta.debrief;
    after.append(h('div', { class: 'w-msg ok' }, 'Objective reached. The review below is the part that matters.'),
      h('div', { class: 'prose', html: md(d ? `
### Review
- **What it was.** ${d.what}
- **How it works.** ${d.how}
- **How it was used.** ${d.exploit}
- **How to detect it.** ${d.detect}
- **How to defend.** ${d.defend}
- **How to verify the defence.** ${d.verify}` : `
### Review
- **Weakness class.** ${CLASS[props.device]}.
- **Defence and verification.** ${DEFENCE[props.device]}
- Write your own notes for the remaining facets (how it works, how to detect it) in the lab notebook.`) }),
      d?.code ? h('pre', { class: 'code' }, d.code) : null);
  }
  const hintBtn = meta.hints?.length ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { if (hintIdx < meta.hints.length) hints.append(h('div', { class: 'hint', html: md(`**Hint ${hintIdx + 1}.** ` + meta.hints[hintIdx++]) })); if (hintIdx >= meta.hints.length) hintBtn.disabled = true; } }, 'Give me a hint') : null;
  el.append(
    h('div', { class: 'w-msg warn' }, 'A fictional device simulated in your browser. Only ever test real equipment that you own or have written permission to assess.'),
    h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, `${meta.product} — ${meta.difficulty}. `), meta.briefing || `Review this device's service console as its own design team would before release. Weakness class to look for: ${CLASS[props.device].toLowerCase()}.`),
      h('p', {}, meta.goal || 'Objective: show whether the protected value (of the form BENCH{...}) can be reached without proper authorisation, then write up the fix.'),
      meta.briefing ? null : h('p', { class: 'w-note' }, 'This device has no guided walkthrough: explore the console, then complete the written review below.')),
    h('div', { class: 'w-grid' }, h('div', {}, term, input),
      meta.panels?.length ? h('div', {}, meta.panels.map((p) => [h('div', { class: 'tag' }, p.title), h('pre', { class: 'ascii' }, p.text)])) : null),
    h('div', { class: 'row' }, hintBtn, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { dev = create(props.device); term.textContent = dev.banner + '\n'; } }, 'Power-cycle the device')),
    hints, after, meta.briefing ? null : reviewForm());

  // Devices without guided notes are completed by a written design review, which is the skill being practised.
  function reviewForm() {
    const ta = h('textarea', { rows: 7, 'aria-label': 'Your design review', placeholder: 'What the weakness is and how it arises · what it would let someone do · how a design team would detect it · the fix · the test that proves the fix' });
    const fb = h('div', { class: 'w-msg' });
    const save = h('button', { type: 'button', class: 'btn small', onclick: () => {
      if (ta.value.trim().length < 200) { fb.className = 'w-msg warn'; fb.textContent = 'Cover all five points: the weakness, its consequence, detection, the fix, and the verifying test.'; return; }
      store.addNote({ title: `Design review: ${meta.product}`, body: ta.value.trim() });
      fb.className = 'w-msg ok'; fb.textContent = 'Recorded and saved to your lab notebook. Compare it with the lesson’s discussion of this weakness class.';
      ctx.complete?.();
    } }, 'Record my review');
    return h('div', { class: 'exercise', style: { marginTop: '14px' } }, h('div', { class: 'tag' }, 'Your review'),
      h('p', {}, 'Explore the console, then write the review a design team should have written before release. Recording it completes this exercise.'), ta, h('div', { class: 'row' }, save), fb);
  }
}
function picker(el) {
  const out = h('div');
  const list = h('div', { class: 'items' }, Object.entries(DEVICES).sort((a, b) => a[1].level - b[1].level).map(([id, d]) =>
    h('button', { type: 'button', class: 'item', style: { width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', font: 'inherit', textAlign: 'left', cursor: 'pointer' }, onclick: () => { clear(out); mount(out, { device: id }, {}); } },
      h('span', { class: 'ititle' }, d.title), h('span', { class: 'imeta' }, `${d.difficulty} · ${CLASS[id]}`))));
  el.append(h('p', {}, 'Choose a device to review.'), list, out);
}
