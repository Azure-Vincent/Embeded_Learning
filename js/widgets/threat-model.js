import { h, clear } from '../core/dom.js';
import { store } from '../core/store.js';

// A worksheet, not a simulator: the learner writes the threat model; the checker only says which
// standard areas are still unaddressed, never what to write.
const SECTIONS = [
  ['system', 'System', 'What the device does, its parts, and who uses it.'],
  ['assets', 'Assets', 'What is worth protecting, and whether it needs confidentiality, integrity or availability.'],
  ['adversaries', 'Adversaries', 'Who might attack and what they can do: remote only, physical access with a debug probe, owns one unit to take apart, insider, supply chain.'],
  ['entry', 'Entry points', 'Every way in: debug ports, serial consoles, buses between chips, the flash chip, the update channel, radio, power and clock.'],
  ['threats', 'Threats', 'For each entry point: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege.'],
  ['mitigations', 'Mitigations and verification', 'For each threat: the control, and the test or measurement that shows it works.'],
  ['residual', 'Residual risk', 'What you chose not to defend against, and why that is acceptable.'],
];
const TEMPLATES = {
  blank: {},
  'smart-lock': { system: 'A battery-powered door lock. An MCU drives the motor, talks to a phone over BLE, and stores user credentials in flash. Firmware updates arrive over BLE.', assets: 'User credentials (confidentiality)\nThe ability to open the door (integrity)', entry: 'BLE interface\nFirmware update channel' },
  hsm: { system: 'A small hardware security module. A host sends commands over UART; the module stores keys and signs or decrypts on request. It never exports private keys.', assets: 'Private keys (confidentiality)\nCorrect use of keys only by authorised hosts (integrity)', adversaries: 'A malicious or compromised host computer' },
};
// canonical areas a complete model for these templates would mention; used only to list gaps
const EXPECT = [['entry', /uart|serial|console/i, 'a serial console or UART'], ['entry', /jtag|swd|debug/i, 'the debug port'], ['entry', /flash|memory chip|readout|extract/i, 'reading the flash contents'], ['entry', /update|bootloader|firmware/i, 'the firmware update path'], ['entry', /power|glitch|clock|fault|side.?channel|timing/i, 'physical effects such as glitching or side channels'],
  ['adversaries', /physical|probe|open|disassembl/i, 'an adversary with physical access'], ['assets', /firmware|code|ip/i, 'the firmware itself as an asset'], ['assets', /key|credential|secret/i, 'keys or credentials'],
  ['threats', /replay/i, 'replay of recorded messages'], ['threats', /rollback|downgrade|old version/i, 'rollback to old firmware'], ['mitigations', /test|verify|measure|check/i, 'how each mitigation is verified'], ['residual', /\S{8}/, 'residual risk']];

export default function mount(el, props = {}, ctx = {}) {
  const key = 'bench.tm.' + (ctx.key || props.template || 'free');
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key) || 'null') || { ...(TEMPLATES[props.template] || {}) }; } catch { data = { ...(TEMPLATES[props.template] || {}) }; }
  const gaps = h('div', { class: 'w-msg' });
  const save = () => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* not persisted */ } };
  const toMd = () => '# Threat model\n\n' + SECTIONS.map(([k, t]) => `## ${t}\n${data[k] || '_not written_'}\n`).join('\n');
  function check() {
    const miss = EXPECT.filter(([k, re]) => !re.test(data[k] || '')).map((e) => e[2]);
    const empty = SECTIONS.filter(([k]) => !(data[k] || '').trim()).map((s) => s[1]);
    clear(gaps);
    if (!miss.length && !empty.length) { gaps.className = 'w-msg ok'; gaps.textContent = 'Every standard area is addressed. That makes the model complete in coverage, not necessarily correct: have someone else try to find what you missed.'; ctx.complete?.(); return; }
    gaps.className = 'w-msg warn';
    gaps.append(h('strong', {}, 'Not yet addressed: '), [...empty.map((e) => `the ${e} section`), ...miss].join('; ') + '.');
  }
  const fields = SECTIONS.map(([k, t, help]) => { const ta = h('textarea', { rows: 4, 'aria-label': t, placeholder: help }, data[k] || ''); ta.value = data[k] || ''; ta.oninput = () => { data[k] = ta.value; save(); }; return h('div', {}, h('h4', { style: { margin: '10px 0 2px' } }, t), h('p', { class: 'w-note', style: { margin: '0 0 4px' } }, help), ta); });
  el.append(h('div', { class: 'w-task' }, h('p', {}, 'Write the threat model before you design the defences. One item per line. The checker lists areas you have not mentioned; it will not fill them in for you.')), ...fields,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: check }, 'Check coverage'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => navigator.clipboard?.writeText(toMd()) }, 'Copy as Markdown'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => { store.addNote({ title: 'Threat model', body: toMd() }); gaps.className = 'w-msg ok'; gaps.textContent = 'Saved to your lab notebook.'; } }, 'Save to lab notebook')), gaps);
}
