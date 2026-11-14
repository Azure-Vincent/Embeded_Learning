// Reset → ROM → bootloader → application, one stage at a time, with what each stage verifies. Facts from js/sim/platforms.js.
import { h, clear } from '../core/dom.js';
import { PLATFORMS, PLATFORM_IDS, getPlatform, show } from '../sim/platforms.js';

const STORAGE = {
  core: 'CPU hardware', rom: 'ROM — fixed at manufacture, cannot be reflashed', flash: 'Flash — rewritable',
  config: 'Configuration flash — rewritable unless write-protected',
};

/** Index of the first stage an attacker who can rewrite program flash controls. */
export function firstMutableStage(platformId) {
  return getPlatform(platformId).boot.findIndex((b) => b.firstMutable);
}

const WHY = {
  generic: 'There is no ROM stage in this layout: the vector table itself is in flash. Whoever writes flash chooses the initial stack pointer and the first instruction. Nothing earlier exists to object.',
  esp32: 'The ROM bootloader cannot be changed, but everything it loads from flash can. Without Secure Boot the ROM runs whatever second-stage bootloader it finds at the fixed offset. With Secure Boot V2 the ROM checks that bootloader\'s signature first, which is why the chain has to start in ROM.',
  max78000: 'The ROM is fixed; the bootloader at the start of flash is the first rewritable stage. Whether the ROM checks it is not verified here — see the datasheet. Any guarantee the later stages give depends on that answer.',
  mspm0l2228: 'The first code in main flash is the first stage a flash writer controls. Note the stage before it: the boot configuration in NONMAIN is also rewritable flash, which is why it has its own static write-protection option. A secure design locks NONMAIN as well as the bootloader.',
};

export default function mount(el, props = {}, ctx) {
  let pid = PLATFORM_IDS.includes(props.platform) ? props.platform : 'generic';
  let i = 0, answer = null;
  const root = h('div', { class: 'boot-sequence' });
  el.append(root);

  function draw() {
    clear(root);
    const p = getPlatform(pid), stages = p.boot, cur = stages[i];
    const atEnd = i === stages.length - 1;
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Platform' }, PLATFORM_IDS.map((id) =>
      h('button', { type: 'button', class: 'w-tab' + (id === pid ? ' on' : ''), 'aria-pressed': String(id === pid), onclick: () => { pid = id; i = 0; answer = null; draw(); } }, PLATFORMS[id].short))));
    if (p.illustrative) root.append(h('p', { class: 'w-msg warn' }, 'Illustrative Cortex-M layout, not a real chip. The reset sequence shown is the Arm Cortex-M architecture\'s.'));

    const asking = atEnd && !(answer && answer.ok);
    const chain = h('ol', { class: 'boot-sequence-chain' }, stages.map((st, k) => {
      const reached = k <= i;
      const body = [h('span', { class: 'boot-sequence-n' }, String(k + 1)), h('span', { class: 'boot-sequence-t' }, st.title),
        reached ? h('span', { class: 'boot-sequence-s s-' + st.storage }, STORAGE[st.storage].split(' — ')[0]) : null];
      return h('li', { class: 'boot-sequence-st' + (k === i ? ' cur' : '') + (reached ? ' reached' : '') + (answer && answer.pick === k ? (answer.ok ? ' right' : ' wrong') : '') },
        asking ? h('button', { type: 'button', class: 'boot-sequence-pick', onclick: () => pick(k) }, body) : h('div', { class: 'boot-sequence-pick' }, body));
    }));

    const detail = h('div', { class: 'boot-sequence-detail', 'aria-live': 'polite' },
      h('h4', {}, `${i + 1}. ${cur.title}`),
      h('dl', { class: 'w-kv' },
        h('dt', {}, 'Runs from'), h('dd', {}, cur.where),
        h('dt', {}, 'Stored in'), h('dd', {}, STORAGE[cur.storage])),
      h('p', {}, h('strong', {}, 'What it does. '), show(cur.does)),
      h('p', { class: 'boot-sequence-ver' }, h('strong', {}, 'What it verifies before handing over. '), show(cur.verifies)),
      h('p', { class: 'w-note' }, 'Source: ', h('a', { href: cur.does.src, target: '_blank', rel: 'noopener' }, cur.does.src.replace('https://github.com/', '')),
        cur.verifies.src !== cur.does.src ? [' · ', h('a', { href: cur.verifies.src, target: '_blank', rel: 'noopener' }, cur.verifies.src.replace('https://github.com/', ''))] : null),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Back'),
        h('button', { type: 'button', class: 'btn small', disabled: atEnd, onclick: () => { i++; draw(); root.querySelector('.boot-sequence-detail .btn:not(.ghost)')?.focus(); } }, 'Next stage')));

    root.append(h('div', { class: 'boot-sequence-grid' }, chain, detail));
    if (atEnd) {
      root.append(h('div', { class: 'w-task' }, h('p', {}, 'An attacker can rewrite program flash but cannot change ROM or the CPU. Select, in the chain, the first stage they control.')));
      if (answer) root.append(h('p', { class: 'w-msg ' + (answer.ok ? 'ok' : 'bad'), 'aria-live': 'polite' }, answer.text));
    }
    root.append(h('p', { class: 'w-note' }, 'Model: a description of the stages, not an emulation. Each statement comes from the vendor source linked beside it; where that source did not settle a point the text says so instead of guessing.'));
  }

  function pick(k) {
    const p = getPlatform(pid), right = firstMutableStage(pid), st = p.boot[k];
    if (k === right) { answer = { pick: k, ok: true, text: 'Correct. ' + WHY[pid] }; ctx?.complete?.(); }
    else if (k < right) answer = { pick: k, ok: false, text: `"${st.title}" is stored in: ${STORAGE[st.storage]}. ` + (st.storage === 'config' ? 'It is rewritable, but it is configuration rather than program flash; look for the first code the attacker can replace.' : 'Rewriting program flash does not change it. Look further down the chain.') };
    else answer = { pick: k, ok: false, text: `They do control "${st.title}", but it is not the first. An earlier stage is also in flash, and whoever controls an earlier stage decides whether this one runs at all.` };
    draw();
  }
  draw();
}
