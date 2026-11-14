// SVG schematics for the electronics section. Small drawing kit + the finished figures.
// Everything uses currentColor / CSS variables so it follows the light and dark themes.

const A = 'stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const rot = (d, x, y) => (d ? ` transform="rotate(${d} ${x} ${y})"` : '');
const frame = (w, h, label, body) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg" font-size="13" font-family="inherit"><g ${A}>${body}</g></svg>`;
const wire = (d, o = {}) => `<path d="${d}"${o.c ? ` stroke="${o.c}"` : ''}${o.dash ? ' stroke-dasharray="5 5"' : ''}${o.w ? ` stroke-width="${o.w}"` : ''}/>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="currentColor"/>`;
const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" fill="${o.c || 'currentColor'}" stroke="none" text-anchor="${o.a || 'start'}"${o.size ? ` font-size="${o.size}"` : ''}${o.b ? ' font-weight="600"' : ''}>${s}</text>`;
const res = (x, y, d = 0) => `<path${rot(d, x, y)} d="M${x - 30} ${y}h12l3 -7l6 14l6 -14l6 14l6 -14l6 14l3 -7h12"/>`;
const cap = (x, y, d = 0) => `<path${rot(d, x, y)} d="M${x - 30} ${y}H${x - 4}M${x - 4} ${y - 11}v22M${x + 4} ${y - 11}v22M${x + 4} ${y}H${x + 30}"/>`;
const diode = (x, y, d = 0, kind = '') => {
  let p = `M${x - 30} ${y}H${x - 9}M${x - 9} ${y - 9}v18l18 -9zM${x + 9} ${y - 9}v18M${x + 9} ${y}H${x + 30}`;
  if (kind === 'led') p += `M${x - 3} ${y - 13}l6 -8m-4 0h4v4M${x + 6} ${y - 13}l6 -8m-4 0h4v4`;
  if (kind === 'zener') p += `M${x + 9} ${y - 9}l4 -4M${x + 9} ${y + 9}l-4 4`;
  if (kind === 'schottky') p += `M${x + 9} ${y - 9}h4v3M${x + 9} ${y + 9}h-4v-3`;
  return `<path${rot(d, x, y)} d="${p}"/>`;
};
const gnd = (x, y) => `<path d="M${x} ${y}v8M${x - 10} ${y + 8}h20M${x - 6} ${y + 12}h12M${x - 2} ${y + 16}h4"/>`;
const rail = (x, y, label) => `<path d="M${x} ${y}v-10M${x - 9} ${y - 10}h18"/>${txt(x, y - 16, label, { a: 'middle' })}`;
const coil = (x, y, d = 0) => `<path${rot(d, x, y)} d="M${x - 30} ${y}h10a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0h10"/>`;
const sw = (x, y, d = 0) =>
  `<g${rot(d, x, y)}><path d="M${x - 30} ${y}H${x - 12}M${x + 12} ${y}H${x + 30}M${x - 13} ${y - 9}h26M${x} ${y - 9}v-8"/><circle cx="${x - 12}" cy="${y}" r="2.5" fill="currentColor"/><circle cx="${x + 12}" cy="${y}" r="2.5" fill="currentColor"/></g>`;
// N-MOSFET: gate (x-30,y), drain (x+10,y-30), source (x+10,y+30) at 0 degrees
const nmos = (x, y, d = 0) =>
  `<path${rot(d, x, y)} d="M${x - 30} ${y}H${x - 10}M${x - 10} ${y - 12}v24M${x - 4} ${y - 16}v32M${x - 4} ${y - 10}H${x + 10}V${y - 30}M${x - 4} ${y + 10}H${x + 10}V${y + 30}M${x} ${y + 6}l6 4l-6 4"/>`;
// NPN: base (x-30,y), collector (x+10,y-30), emitter (x+10,y+30)
const npn = (x, y) =>
  `<path d="M${x - 30} ${y}H${x - 6}M${x - 6} ${y - 14}v28M${x - 6} ${y - 6}L${x + 10} ${y - 16}V${y - 30}M${x - 6} ${y + 6}L${x + 10} ${y + 16}V${y + 30}"/><path d="M${x + 10} ${y + 16}L${x + 1.3} ${y + 14.8}L${x + 5.1} ${y + 8.8}z" fill="currentColor"/>`;
const box = (x, y, w, h, label, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="var(--surface)"${o.c ? ` stroke="${o.c}"` : ''}/>${label ? txt(x + w / 2, y + h / 2 + 5, label, { a: 'middle', b: 1 }) : ''}`;
const motor = (x, y) => `<path d="M${x} ${y - 30}v15M${x} ${y + 15}v15"/><circle cx="${x}" cy="${y}" r="15" fill="var(--surface)"/>${txt(x, y + 5, 'M', { a: 'middle', b: 1 })}`;
const src = (x, y) => `<path d="M${x} ${y - 30}v14M${x} ${y + 16}v14"/><circle cx="${x}" cy="${y}" r="16" fill="var(--surface)"/>${txt(x, y - 2, '+', { a: 'middle' })}${txt(x, y + 12, '−', { a: 'middle' })}`;
function arrow(x1, y1, x2, y2, c = 'var(--sig1)') {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  const bx = x2 - ux * 8, by = y2 - uy * 8;
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${c}"/><path d="M${x2} ${y2}L${(bx - uy * 4).toFixed(1)} ${(by + ux * 4).toFixed(1)}L${(bx + uy * 4).toFixed(1)} ${(by - ux * 4).toFixed(1)}z" fill="${c}" stroke="${c}"/>`;
}

/* ---------- finished figures ---------- */

export const figTwoLoop = frame(600, 250, 'Two-loop circuit: a 5 V source through R1 and a 3.3 V source through R3 both feed node A, which R2 connects to ground',
  src(70, 130) + wire('M70 100V60H140M200 60H400M460 60H530V100M70 160V200H530V160M300 60V100M300 160V200') +
  res(170, 60) + res(430, 60) + res(300, 130, 90) + src(530, 130) + dot(300, 60) + dot(300, 200) + gnd(300, 200) +
  txt(28, 126, 'V1', { b: 1 }) + txt(22, 143, '5 V') + txt(554, 126, 'V2', { b: 1 }) + txt(554, 143, '3.3 V') +
  txt(170, 38, 'R1 1 kΩ', { a: 'middle' }) + txt(430, 38, 'R3 1 kΩ', { a: 'middle' }) + txt(322, 135, 'R2 10 kΩ') + txt(300, 50, 'A', { a: 'middle', b: 1 }) +
  arrow(215, 78, 265, 78) + txt(240, 96, 'I1', { a: 'middle', c: 'var(--sig1)' }) +
  arrow(385, 78, 335, 78, 'var(--sig2)') + txt(360, 96, 'I3', { a: 'middle', c: 'var(--sig2)' }) +
  arrow(282, 108, 282, 152, 'var(--sig3)') + txt(262, 135, 'I2', { a: 'middle', c: 'var(--sig3)' }) +
  txt(160, 150, 'loop 1', { a: 'middle', c: 'var(--muted)' }) + txt(430, 150, 'loop 2', { a: 'middle', c: 'var(--muted)' }));

function wavePath(x0, y0, w, fn) {
  let d = '';
  for (let i = 0; i <= 120; i++) { const t = i / 120; d += `${i ? 'L' : 'M'}${(x0 + t * w).toFixed(1)} ${(y0 - fn(t)).toFixed(1)}`; }
  return d;
}
const panel = (x, title, sub, fn, c, zeroAt) =>
  wire(`M${x} 30V170M${x} ${zeroAt}H${x + 140}`, { c: 'var(--line)', w: 1.5 }) + wire(wavePath(x, zeroAt, 140, fn), { c }) +
  txt(x + 70, 192, title, { a: 'middle', b: 1 }) + txt(x + 70, 208, sub, { a: 'middle', c: 'var(--muted)', size: 12 }) + txt(x - 4, zeroAt + 4, '0', { a: 'end', c: 'var(--muted)', size: 11 });
export const figWaveforms = frame(660, 216, 'Four voltage-against-time sketches: steady DC, DC with ripple, AC sine wave, digital square wave',
  panel(24, 'Steady DC', 'battery, regulator', () => 90, 'var(--sig1)', 160) +
  panel(188, 'DC with ripple', 'loaded mains adapter', (t) => 96 - 22 * ((t * 4) % 1), 'var(--sig2)', 160) +
  panel(352, 'AC', 'mains, audio, radio', (t) => 55 * Math.sin(t * 4 * Math.PI), 'var(--sig3)', 100) +
  panel(516, 'Digital signal', 'GPIO, UART line', (t) => ([1, 0, 1, 1, 0, 1, 0, 0][Math.min(7, Math.floor(t * 8))] ? 100 : 4), 'var(--sig4)', 160));

export const figFlyback = frame(600, 262, 'Relay coil switched to ground, with a flyback diode across the coil, cathode to the positive rail',
  wire('M120 44H380M200 44V80M300 44V80M200 140V165M300 140V160H200M200 225V236') + rail(250, 44, '+5 V') +
  coil(200, 110, 90) + diode(300, 110, 270) + sw(200, 195, 90) + gnd(200, 236) + dot(200, 160) + dot(200, 44) + dot(300, 44) +
  txt(184, 114, 'relay coil', { a: 'end' }) + txt(322, 106, 'flyback diode') + txt(322, 122, '(cathode to +)', { c: 'var(--muted)', size: 12 }) +
  txt(160, 199, 'switch', { a: 'end' }) + txt(160, 215, '(transistor)', { a: 'end', c: 'var(--muted)', size: 12 }) +
  wire('M216 150H284M284 70H216', { c: 'var(--sig2)', dash: 1 }) + arrow(240, 150, 276, 150, 'var(--sig2)') + arrow(260, 70, 224, 70, 'var(--sig2)') +
  txt(400, 150, 'When the switch opens, the coil', { c: 'var(--sig2)' }) + txt(400, 166, 'current keeps flowing round', { c: 'var(--sig2)' }) + txt(400, 182, 'this loop until it dies away.', { c: 'var(--sig2)' }));

export const figReverseProtect = frame(560, 150, 'A Schottky diode in series with the positive supply lead blocks current if the supply is connected backwards',
  wire('M50 50H100M160 50H330M50 110H330') + diode(130, 50, 0, 'schottky') + box(330, 30, 150, 100, 'your circuit') +
  txt(46, 54, '+', { a: 'end', b: 1 }) + txt(46, 114, '−', { a: 'end', b: 1 }) + txt(130, 28, 'Schottky', { a: 'middle' }) +
  txt(245, 40, 'Vin − about 0.3 V', { a: 'middle', c: 'var(--muted)', size: 12 }) + txt(190, 104, 'GND', { a: 'middle', c: 'var(--muted)', size: 12 }));

export const figLowSide = frame(620, 312, 'Low-side N-MOSFET switch: GPIO through a gate resistor to the gate, pull-down from gate to ground, motor between the supply and the drain, flyback diode across the motor',
  wire('M300 44H500M360 44V70M450 44V70M360 130V180M450 130V155H360M360 240V266M130 210H200M260 210H320M290 210V220M290 280V282') +
  rail(400, 44, '+V motor') + motor(360, 100) + diode(450, 100, 270) + nmos(350, 210) + gnd(360, 266) + res(230, 210) + res(290, 250, 90) + gnd(290, 282) +
  dot(360, 155) + dot(290, 210) + dot(360, 44) + dot(450, 44) +
  txt(124, 214, 'GPIO', { a: 'end', b: 1 }) + txt(230, 192, 'Rg 100 Ω', { a: 'middle' }) + txt(276, 254, 'Rpd 100 kΩ', { a: 'end' }) +
  txt(368, 176, 'D', { c: 'var(--muted)' }) + txt(318, 202, 'G', { a: 'end', c: 'var(--muted)' }) + txt(368, 252, 'S', { c: 'var(--muted)' }) +
  txt(472, 104, 'flyback diode') + txt(380, 300, 'motor supply ground and MCU ground joined here', { c: 'var(--muted)', size: 12 }));

const odDev = (cx, name) =>
  wire(`M${cx} 130V160`) + dot(cx, 130) + nmos(cx - 10, 190) + gnd(cx, 220) + txt(cx - 46, 194, name, { a: 'end', b: 1 });
export const figOpenDrain = frame(640, 256, 'Open-drain bus: one pull-up resistor to 3.3 V and three devices that can each only pull the shared line to ground',
  wire('M140 44V60M140 120V130M80 130H590') + rail(140, 44, '3.3 V') + res(140, 90, 90) + dot(140, 130) +
  txt(158, 94, 'Rpull-up') + txt(596, 134, 'SDA', { b: 1 }) + odDev(270, 'A') + odDev(400, 'B') + odDev(530, 'C') +
  txt(320, 250, 'Any device can pull the line low. Nobody ever drives it high: the resistor does that.', { a: 'middle', c: 'var(--muted)', size: 12 }));

const band = (x, y1, y2, c, label) =>
  `<rect x="${x}" y="${y1}" width="90" height="${y2 - y1}" fill="${c}" fill-opacity="0.28" stroke="none"/>${txt(x + 45, (y1 + y2) / 2 + 4, label, { a: 'middle', size: 12 })}`;
export const figLogicLevels = frame(620, 270, 'Logic thresholds: the output guarantees VOH and VOL, the input requires VIH and VIL, and the gaps between them are the noise margins',
  txt(165, 20, 'Driver output', { a: 'middle', b: 1 }) + txt(455, 20, 'Receiver input', { a: 'middle', b: 1 }) +
  `<rect x="120" y="30" width="90" height="210"/><rect x="410" y="30" width="90" height="210"/>` +
  band(120, 30, 62, 'var(--sig1)', 'drives 1 here') + band(120, 214, 240, 'var(--sig3)', 'drives 0 here') +
  band(410, 30, 98, 'var(--sig1)', 'reads as 1') + band(410, 98, 172, 'var(--sig5)', 'undefined') + band(410, 172, 240, 'var(--sig3)', 'reads as 0') +
  wire('M120 62H210M120 214H210M410 98H500M410 172H500') +
  txt(112, 34, 'VDD', { a: 'end' }) + txt(112, 66, 'VOH', { a: 'end', b: 1 }) + txt(112, 218, 'VOL', { a: 'end', b: 1 }) + txt(112, 244, 'GND', { a: 'end' }) +
  txt(508, 34, 'VDD') + txt(508, 102, 'VIH', { b: 1 }) + txt(508, 176, 'VIL', { b: 1 }) + txt(508, 244, 'GND') +
  wire('M210 62H410M210 214H410', { c: 'var(--line)', dash: 1, w: 1.5 }) + wire('M410 98H250M410 172H250', { c: 'var(--line)', dash: 1, w: 1.5 }) +
  arrow(310, 90, 310, 64, 'var(--sig2)') + arrow(310, 70, 310, 96, 'var(--sig2)') + txt(300, 84, 'high noise margin', { a: 'end', c: 'var(--sig2)', size: 12 }) +
  arrow(310, 206, 310, 174, 'var(--sig2)') + arrow(310, 180, 310, 212, 'var(--sig2)') + txt(300, 198, 'low noise margin', { a: 'end', c: 'var(--sig2)', size: 12 }) +
  txt(310, 262, 'The link is valid only if VOH is above VIH and VOL is below VIL.', { a: 'middle', c: 'var(--muted)', size: 12 }));

export const figLevelShifter = frame(580, 230, 'Bidirectional MOSFET level shifter: N-MOSFET with gate on 3.3 V, source on the 3.3 V side, drain on the 5 V side, a pull-up on each side',
  wire('M70 160H250M310 160H510M160 130V160M400 130V160M160 70V54M400 70V54M280 120V62H160') + rail(160, 54, '3.3 V') + rail(400, 54, '5 V') +
  res(160, 100, 90) + res(400, 100, 90) + nmos(280, 150, 90) + dot(160, 160) + dot(400, 160) + dot(160, 62) +
  txt(146, 104, '10 kΩ', { a: 'end' }) + txt(416, 104, '10 kΩ') + txt(70, 180, '3.3 V device', { b: 1 }) + txt(510, 180, '5 V device', { a: 'end', b: 1 }) +
  txt(240, 180, 'S', { c: 'var(--muted)' }) + txt(314, 180, 'D', { c: 'var(--muted)' }) + txt(288, 112, 'G', { c: 'var(--muted)' }) +
  txt(290, 216, 'Works for open-drain lines such as I2C. Either side can pull the line low.', { a: 'middle', c: 'var(--muted)', size: 12 }));

export const figAdcInput = frame(640, 216, 'ADC input model: the signal source and its resistance charge a small sampling capacitor through a switch',
  src(60, 110) + wire('M60 80V70H110M170 70H280M340 70H470M60 140V180H400M400 100V70M400 160V180M240 70V100M240 160V180', {}) +
  res(140, 70) + sw(310, 70) + cap(400, 130, 90) + cap(240, 130, 90) + dot(240, 70) + dot(400, 70) + dot(240, 180) + gnd(240, 180) + box(470, 45, 110, 50, 'converter') +
  txt(22, 114, 'Vs', { b: 1 }) + txt(140, 48, 'R source', { a: 'middle' }) + txt(310, 40, 'sample switch', { a: 'middle' }) + txt(416, 134, 'C sample') + txt(416, 150, '(a few pF)', { c: 'var(--muted)', size: 12 }) +
  txt(226, 128, 'optional', { a: 'end', c: 'var(--muted)', size: 12 }) + txt(226, 144, '100 nF', { a: 'end', c: 'var(--muted)', size: 12 }) + txt(240, 60, 'pin', { a: 'middle', c: 'var(--muted)', size: 12 }) +
  txt(320, 208, 'The switch closes for a short time. C sample must reach Vs through R source within that time.', { a: 'middle', c: 'var(--muted)', size: 12 }));

const pulse = (y, wHigh, label) => {
  let d = `M60 ${y}`;
  for (const x of [80, 300, 520]) d += `H${x}V${y - 28}H${x + wHigh}V${y}`;
  return wire(d + 'H590', { c: 'var(--sig1)' }) + txt(54, y - 8, label, { a: 'end' });
};
export const figServo = frame(700, 200, 'Servo control pulses: one pulse every 20 ms, 1 ms wide for one end, 1.5 ms for centre, 2 ms for the other end',
  pulse(60, 16, '1.0 ms') + pulse(110, 24, '1.5 ms') + pulse(160, 32, '2.0 ms') +
  wire('M80 172V184M300 172V184M80 178H300', { c: 'var(--muted)', w: 1.5 }) + txt(190, 195, '20 ms period (50 Hz)', { a: 'middle', c: 'var(--muted)', size: 12 }) +
  txt(600, 56, 'one end') + txt(600, 106, 'centre') + txt(600, 156, 'other end') + txt(330, 16, 'Pulse widths drawn wider than scale so the difference is visible', { a: 'middle', c: 'var(--muted)', size: 12 }));

const cell = (i, name, draw) => {
  const x = 20 + (i % 4) * 160, y = 14 + Math.floor(i / 4) * 92;
  return draw(x + 80, y + 26) + txt(x + 80, y + 80, name, { a: 'middle', size: 12 });
};
export const figSymbols = frame(660, 384, 'Chart of common schematic symbols',
  [
    ['Resistor', (x, y) => res(x, y)], ['Capacitor', (x, y) => cap(x, y)],
    ['Polarised capacitor', (x, y) => cap(x, y) + txt(x - 14, y - 6, '+', { a: 'middle' })], ['Inductor / coil', (x, y) => coil(x, y)],
    ['Diode (current flows →)', (x, y) => diode(x, y)], ['LED', (x, y) => diode(x, y + 4, 0, 'led')],
    ['Schottky diode', (x, y) => diode(x, y, 0, 'schottky')], ['Zener diode', (x, y) => diode(x, y, 0, 'zener')],
    ['Push-button', (x, y) => sw(x, y + 6)], ['Ground', (x, y) => gnd(x, y - 6)],
    ['Supply rail', (x, y) => rail(x, y + 18, '3V3')], ['NPN transistor', (x, y) => npn(x - 4, y + 4)],
    ['N-channel MOSFET', (x, y) => nmos(x - 4, y + 4)], ['Wires joined (dot)', (x, y) => wire(`M${x - 28} ${y}H${x + 28}M${x} ${y - 20}V${y + 20}`) + dot(x, y)],
    ['Wires crossing, not joined', (x, y) => wire(`M${x - 28} ${y}H${x + 28}M${x} ${y - 20}V${y + 20}`)], ['Net label', (x, y) => wire(`M${x - 28} ${y + 4}H${x}`) + txt(x + 6, y + 8, 'SDA', { b: 1 })],
  ].map(([n, d], i) => cell(i, n, d)).join(''));

function breadboard() {
  let o = '';
  const hole = (x, y) => `<circle cx="${x}" cy="${y}" r="2.6" fill="var(--sunk)" stroke="var(--muted)" stroke-width="1"/>`;
  const cols = 30, x0 = 46, dx = 19;
  // power rails: split in the middle on this board
  [[24, 'var(--bad)', '+'], [42, 'var(--link)', '−'], [224, 'var(--bad)', '+'], [242, 'var(--link)', '−']].forEach(([y, c, s]) => {
    o += wire(`M${x0} ${y}H${x0 + 13 * dx}M${x0 + 16 * dx} ${y}H${x0 + 29 * dx}`, { c, w: 5 });
    for (let i = 0; i < cols; i++) if (i < 14 || i > 15) o += hole(x0 + i * dx, y);
    o += txt(x0 - 14, y + 4, s, { a: 'end', c, b: 1 });
  });
  // terminal strips: 5 holes per column, each side of the centre gap
  for (let i = 0; i < cols; i++) {
    const x = x0 + i * dx;
    o += wire(`M${x} 70V122M${x} 148V200`, { c: 'var(--sig2)', w: 5 });
    for (let r = 0; r < 5; r++) o += hole(x, 70 + r * 13) + hole(x, 148 + r * 13);
  }
  o += txt(x0 - 14, 100, 'a–e', { a: 'end', c: 'var(--muted)', size: 12 }) + txt(x0 - 14, 178, 'f–j', { a: 'end', c: 'var(--muted)', size: 12 });
  o += txt(x0 + 14.5 * dx, 139, 'centre gap: no connection across it', { a: 'middle', c: 'var(--muted)', size: 12 });
  o += wire(`M${x0 + 14.5 * dx} 8V50M${x0 + 14.5 * dx} 216V256`, { c: 'var(--warn)', dash: 1, w: 1.5 });
  o += txt(x0 + 14.5 * dx, 272, 'rail break on some boards: bridge it with a jumper or the far half is dead', { a: 'middle', c: 'var(--warn)', size: 12 });
  return o;
}
export const figBreadboard = frame(640, 282, 'Breadboard internal connections: each column of five holes is joined, the two halves are separated by the centre gap, the power rails run lengthwise and may be split in the middle', breadboard());

export const figLdo = frame(660, 220, 'Linear regulator with input and output capacitors, and a 100 nF decoupling capacitor next to the microcontroller power pin',
  wire('M40 70H180M280 70H550M120 70V90M120 150V160M340 70V90M340 150V160M480 70V90M480 150V160M230 95V160M590 95V160') +
  box(180, 45, 100, 50, 'LDO') + box(550, 45, 80, 50, 'MCU') + cap(120, 120, 90) + cap(340, 120, 90) + cap(480, 120, 90) +
  gnd(120, 160) + gnd(340, 160) + gnd(480, 160) + gnd(230, 160) + gnd(590, 160) + dot(120, 70) + dot(340, 70) + dot(480, 70) +
  txt(40, 60, 'VIN 5 V', { b: 1 }) + txt(410, 60, '3.3 V', { a: 'middle', b: 1 }) + txt(136, 124, 'C in') + txt(356, 124, 'C out') + txt(356, 140, '(bulk)', { c: 'var(--muted)', size: 12 }) +
  txt(466, 124, '100 nF', { a: 'end' }) + txt(520, 206, 'placed right at the power pin', { a: 'middle', c: 'var(--muted)', size: 12 }) +
  txt(230, 206, 'heat = (VIN − VOUT) × I', { a: 'middle', c: 'var(--sig2)' }));

export const figCommonGround = frame(620, 200, 'Two boards with separate supplies: the signal wire from TX to RX and the ground wire that completes the loop',
  box(40, 40, 170, 110, '') + box(410, 40, 170, 110, '') + txt(125, 64, 'Board A', { a: 'middle', b: 1 }) + txt(125, 80, 'powered from USB', { a: 'middle', c: 'var(--muted)', size: 12 }) +
  txt(495, 64, 'Board B', { a: 'middle', b: 1 }) + txt(495, 80, 'powered from a battery', { a: 'middle', c: 'var(--muted)', size: 12 }) +
  wire('M210 100H410', { c: 'var(--sig1)' }) + arrow(290, 100, 330, 100, 'var(--sig1)') + wire('M210 135H410', { c: 'var(--sig3)', dash: 1 }) + arrow(330, 135, 290, 135, 'var(--sig3)') +
  txt(204, 104, 'TX', { a: 'end' }) + txt(416, 104, 'RX') + txt(204, 139, 'GND', { a: 'end' }) + txt(416, 139, 'GND') +
  txt(310, 90, 'signal current out', { a: 'middle', c: 'var(--sig1)', size: 12 }) + txt(310, 156, 'return current back', { a: 'middle', c: 'var(--sig3)', size: 12 }) +
  txt(310, 188, 'Remove the ground wire and Board B has no reference for what “3.3 V on TX” means.', { a: 'middle', c: 'var(--muted)', size: 12 }));

export const figButtonPullup = frame(520, 230, 'Button with pull-up: resistor from 3.3 V to the GPIO node, button from the node to ground',
  wire('M200 50V60M200 120V140M200 140H330M200 140V150M200 210V212') + rail(200, 50, '3.3 V') + res(200, 90, 90) + sw(200, 180, 90) + gnd(200, 212) + dot(200, 140) +
  box(330, 115, 110, 50, 'GPIO input') + txt(184, 94, '10 kΩ', { a: 'end' }) + txt(170, 184, 'button', { a: 'end' }) +
  txt(265, 132, 'node', { a: 'middle', c: 'var(--muted)', size: 12 }) + txt(350, 196, 'released: 3.3 V (1)', { c: 'var(--muted)', size: 12 }) + txt(350, 212, 'pressed: 0 V (0)', { c: 'var(--muted)', size: 12 }));

export const figNpn = frame(560, 290, 'NPN low-side switch: GPIO through a base resistor to the base, relay coil with flyback diode between +5 V and the collector, emitter to ground',
  wire('M260 44H420M300 44V70M390 44V70M300 130V170M390 130V150H300M300 230V250M120 200H170M230 200H260') +
  rail(340, 44, '+5 V') + coil(300, 100, 90) + diode(390, 100, 270) + npn(290, 200) + gnd(300, 250) + res(200, 200) + dot(300, 150) + dot(300, 44) + dot(390, 44) +
  txt(114, 204, 'GPIO', { a: 'end', b: 1 }) + txt(200, 182, 'RB', { a: 'middle' }) + txt(284, 104, 'relay coil', { a: 'end' }) + txt(412, 104, 'flyback diode') +
  txt(308, 168, 'C', { c: 'var(--muted)' }) + txt(254, 192, 'B', { c: 'var(--muted)' }) + txt(308, 244, 'E', { c: 'var(--muted)' }) +
  arrow(140, 216, 180, 216, 'var(--sig1)') + txt(160, 234, 'IB', { a: 'middle', c: 'var(--sig1)' }) + arrow(318, 176, 318, 226, 'var(--sig2)') + txt(330, 206, 'IC', { c: 'var(--sig2)' }));
