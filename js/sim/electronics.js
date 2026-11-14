// Pure electronics maths shared by the electronics widgets. No DOM access: everything here runs under `node --test`.
// These are first-order teaching models (ideal sources, constant diode drops, no tolerances unless stated).

// ---------------------------------------------------------------- E-series and resistor values
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const SERIES = { E12, E24 };
const sig = (x, n = 6) => +x.toPrecision(n);

/** All values of a series from 10^minExp up to and including 10^maxExp, ascending. */
export function eSeriesValues(series = 'E12', minExp = 0, maxExp = 6) {
  const base = SERIES[series] || E12, out = [];
  for (let e = minExp; e < maxExp; e++) for (const b of base) out.push(sig(b * 10 ** e));
  out.push(sig(10 ** maxExp));
  return out;
}
/** Nearest preferred value (smallest ratio error). */
export function nearestE(value, series = 'E12') {
  if (!(value > 0)) return NaN;
  const base = SERIES[series] || E12, e = Math.floor(Math.log10(value));
  let best = NaN, err = Infinity;
  for (const d of [e - 1, e, e + 1]) for (const b of base) {
    const c = sig(b * 10 ** d), k = Math.abs(Math.log(c / value));
    if (k < err - 1e-12) { err = k; best = c; }
  }
  return best;
}
/** Smallest preferred value that is >= value (the safe direction for a current-limiting resistor). */
export function nextEUp(value, series = 'E12') {
  const base = SERIES[series] || E12, e = Math.floor(Math.log10(value));
  for (const d of [e - 1, e, e + 1]) for (const b of base) { const c = sig(b * 10 ** d); if (c >= value * (1 - 1e-9)) return c; }
  return NaN;
}
/** "4.7 kΩ", "220 Ω", "1 MΩ" */
export function fmtR(r) {
  if (!isFinite(r)) return '∞ Ω';
  const a = Math.abs(r);
  if (a >= 1e6) return sig(r / 1e6, 4) + ' MΩ';
  if (a >= 1e3) return sig(r / 1e3, 4) + ' kΩ';
  return sig(r, 4) + ' Ω';
}
/** Parse "4k7", "4.7k", "220", "1M", "10 kΩ", "0R47", "470R". Returns NaN when it is not a resistance. */
export function parseR(text) {
  const t = String(text).trim().replace(/\s+/g, '').replace(/[Ωω]|ohms?$/gi, '').replace(/,/g, '.');
  let m = /^(\d+)([RrkKmMgG])(\d+)$/.exec(t);
  const mult = (c) => ({ r: 1, R: 1, k: 1e3, K: 1e3, M: 1e6, m: 1e6, G: 1e9, g: 1e9 }[c] ?? 1);
  if (m) return sig(parseFloat(m[1] + '.' + m[3]) * mult(m[2]));
  m = /^(\d*\.?\d+)([RrkKmMgG]?)$/.exec(t);
  if (m) return sig(parseFloat(m[1]) * mult(m[2]));
  return NaN;
}

// ---------------------------------------------------------------- colour code
export const COLOURS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white', 'gold', 'silver'];
export const MULTIPLIER = { black: 1, brown: 10, red: 100, orange: 1e3, yellow: 1e4, green: 1e5, blue: 1e6, violet: 1e7, grey: 1e8, white: 1e9, gold: 0.1, silver: 0.01 };
/** Tolerance in percent by band colour (IEC 60062). */
export const TOLERANCE = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, grey: 0.05, gold: 5, silver: 10 };
const digitOf = (c) => { const i = COLOURS.indexOf(c); return i >= 0 && i <= 9 ? i : NaN; };

/** bands: 4 colours (2 digits, multiplier, tolerance) or 5 colours (3 digits, multiplier, tolerance). */
export function bandsToValue(bands) {
  const n = bands.length;
  if (n !== 4 && n !== 5) return { ohms: NaN, tolerance: NaN, valid: false };
  const digits = bands.slice(0, n - 2).map(digitOf);
  const mult = MULTIPLIER[bands[n - 2]], tolerance = TOLERANCE[bands[n - 1]];
  const valid = digits.every((d) => !isNaN(d)) && mult != null && tolerance != null;
  const ohms = valid ? sig(digits.reduce((a, d) => a * 10 + d, 0) * mult) : NaN;
  return { ohms, tolerance, valid, min: ohms * (1 - tolerance / 100), max: ohms * (1 + tolerance / 100) };
}
/** Colour bands for a value. Returns null when the value cannot be written with that many digit bands. */
export function valueToBands(ohms, nBands = 4, tolColour = nBands === 5 ? 'brown' : 'gold') {
  const nd = nBands - 2;
  if (!(ohms > 0)) return null;
  let exp = Math.floor(Math.log10(ohms)) - (nd - 1);
  let mant = Math.round(ohms / 10 ** exp);
  if (mant >= 10 ** nd) { mant = Math.round(mant / 10); exp++; }
  if (Math.abs(mant * 10 ** exp - ohms) > ohms * 1e-6) return null; // needs more significant digits than there are bands
  const multColour = Object.keys(MULTIPLIER).find((c) => Math.abs(MULTIPLIER[c] - 10 ** exp) < 10 ** exp * 1e-9);
  if (!multColour) return null;
  const ds = String(mant).padStart(nd, '0').split('').map((d) => COLOURS[+d]);
  return [...ds, multColour, tolColour];
}

// ---------------------------------------------------------------- Ohm's law and networks
/** Given any two of v, i, r returns all of v, i, r, p. */
export function ohm({ v, i, r }) {
  if (v != null && r != null) i = r === 0 ? Infinity : v / r;
  else if (i != null && r != null) v = i * r;
  else if (v != null && i != null) r = i === 0 ? Infinity : v / i;
  return { v, i, r, p: v * i };
}
export const seriesR = (rs) => rs.reduce((a, b) => a + b, 0);
export const parallelR = (rs) => (rs.some((r) => r === 0) ? 0 : 1 / rs.reduce((a, r) => a + 1 / r, 0));

/** Network tree: {r} | {series:[...]} | {parallel:[...]}. Returns the same shape annotated with req, v, i, p. */
export function solveNetwork(node, v) {
  const req = (n) => (n.series ? seriesR(n.series.map(req)) : n.parallel ? parallelR(n.parallel.map(req)) : n.r);
  const walk = (n, vn) => {
    const r = req(n), i = r === 0 ? Infinity : vn / r;
    const out = { req: r, v: vn, i, p: vn * i };
    if (n.series) out.series = n.series.map((k) => walk(k, i * req(k)));
    else if (n.parallel) out.parallel = n.parallel.map((k) => walk(k, vn));
    else out.r = n.r;
    return out;
  };
  return walk(node, v);
}

/** Resistive divider, optionally loaded by rload across R2. */
export function divider(vin, r1, r2, rload = Infinity) {
  const r2eff = isFinite(rload) ? parallelR([r2, rload]) : r2;
  const vUnloaded = vin * r2 / (r1 + r2);
  const vout = vin * r2eff / (r1 + r2eff);
  const iIn = vin / (r1 + r2eff);
  return {
    vout, vUnloaded, r2eff, iIn,
    iLoad: isFinite(rload) ? vout / rload : 0,
    rth: parallelR([r1, r2]),              // source resistance seen by whatever is connected to the tap
    pR1: (vin - vout) ** 2 / r1, pR2: vout ** 2 / r2,
    sagPct: vUnloaded === 0 ? 0 : (vUnloaded - vout) / vUnloaded * 100,
  };
}

// ---------------------------------------------------------------- ADC
/** Ideal unipolar ADC: code = floor(v / vref * 2^bits), clamped to 0 … 2^bits − 1. */
export function adcCode(v, vref = 3.3, bits = 12) {
  const max = 2 ** bits - 1;
  if (!(v > 0)) return 0;
  return Math.min(max, Math.floor(v / vref * 2 ** bits + 1e-9));
}
/** Voltage at the bottom of a code's step. Add lsb/2 for the centre of the step. */
export const adcVoltage = (code, vref = 3.3, bits = 12) => code * vref / 2 ** bits;
export const adcLsb = (vref = 3.3, bits = 12) => vref / 2 ** bits;
/** Frequency a sampled sine appears to have: folds fsig into 0 … fs/2. */
export function aliasFrequency(fsig, fs) {
  if (!(fs > 0)) return NaN;
  return Math.abs(fsig - fs * Math.round(fsig / fs));
}
/** Sample v(t) = offset + amp·sin(2π f t) at fs for `duration` seconds. Returns [{t, v, code, vq}]. */
export function sampleSine({ f, fs, amp, offset, vref = 3.3, bits = 12, duration }) {
  const out = [], n = Math.floor(duration * fs + 1e-9);
  for (let k = 0; k <= n; k++) {
    const t = k / fs, v = offset + amp * Math.sin(2 * Math.PI * f * t);
    const code = adcCode(v, vref, bits);
    out.push({ t, v, code, vq: adcVoltage(code, vref, bits) });
  }
  return out;
}

// ---------------------------------------------------------------- RC
export const rcTau = (r, c) => r * c;
/** Capacitor voltage t seconds after a step from v0 towards vf. */
export const rcVoltage = (v0, vf, t, tau) => vf + (v0 - vf) * Math.exp(-t / tau);
/** Time for the capacitor to move from v0 to vth while heading for vf. Infinity if it never gets there. */
export function rcTimeTo(v0, vf, vth, tau) {
  const a = (vth - vf) / (v0 - vf);
  if (!(a > 0)) return Infinity;      // vth is beyond the final value
  if (a >= 1) return 0;               // already past it
  return -tau * Math.log(a);
}
export const rcCutoff = (r, c) => 1 / (2 * Math.PI * r * c);

/** Small deterministic PRNG so "random" demos are repeatable and testable. */
export function prng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** Contact state over time for one press and one release. Returns edge list [{t, closed}] (seconds). */
export function bounceEdges({ pressAt = 0.005, releaseAt = 0.045, bounceMs = 4, seed = 7 } = {}) {
  const rnd = prng(seed), edges = [{ t: 0, closed: false }];
  const burst = (t0, final) => {
    let t = t0, st = final; const end = t0 + bounceMs / 1000;
    edges.push({ t, closed: st });
    if (bounceMs <= 0) return;
    for (;;) {
      t += (0.03 + 0.14 * rnd()) * bounceMs / 1000;
      if (t >= end) break;
      st = !st; edges.push({ t, closed: st });
    }
    if (st !== final) edges.push({ t: end, closed: final });
  };
  burst(pressAt, true); burst(releaseAt, false);
  return edges;
}
/**
 * Active-low button: pull-up rp to vcc, switch to ground, series r into capacitor c, Schmitt-trigger input.
 * Open: C charges through rp + r. Closed: C discharges through r. Returns sampled traces and edge counts.
 */
export function simulateDebounce({ r, c, rp = 10e3, vcc = 3.3, vtLow = 0.3 * 3.3, vtHigh = 0.7 * 3.3, edges, duration = 0.08, steps = 1600 }) {
  const dt = duration / steps, raw = [], vc = [], out = [];
  let v = vcc, logic = 1, ei = 0, closed = false, rawEdges = 0, outEdges = 0, prevRaw = 1, firstOutFall = NaN;
  for (let k = 0; k <= steps; k++) {
    const t = k * dt;
    while (ei < edges.length && edges[ei].t <= t) closed = edges[ei++].closed;
    const rawLevel = closed ? 0 : 1;
    if (rawLevel !== prevRaw) { rawEdges++; prevRaw = rawLevel; }
    const tau = closed ? r * c : (rp + r) * c, target = closed ? 0 : vcc;
    v = tau > 0 ? target + (v - target) * Math.exp(-dt / tau) : target;
    if (logic === 1 && v < vtLow) { logic = 0; outEdges++; if (isNaN(firstOutFall)) firstOutFall = t; }
    else if (logic === 0 && v > vtHigh) { logic = 1; outEdges++; }
    raw.push(rawLevel); vc.push(v); out.push(logic);
  }
  return { dt, raw, vc, out, rawEdges, outEdges, firstOutFall };
}

// ---------------------------------------------------------------- LED
/** Constant-forward-voltage LED model in series with r. */
export function ledCircuit(vsupply, vf, r) {
  const headroom = vsupply - vf;
  const i = headroom <= 0 ? 0 : r <= 0 ? Infinity : headroom / r;
  return { i, headroom, vR: headroom > 0 ? headroom : 0, pR: headroom > 0 ? headroom * i : 0, pLed: vf * i, pTotal: vsupply * i };
}
export const ledResistorFor = (vsupply, vf, i) => (vsupply - vf) / i;

// ---------------------------------------------------------------- transistor switches
/**
 * Low-side N-MOSFET switch. Device: vth (gate threshold), vgsSpec (the VGS at which the datasheet guarantees rdsOn),
 * rdsOn. Between vth and vgsSpec the channel is only partly formed: modelled as a square-law current limit that
 * reaches iSpec at vgsSpec.
 */
export function nmosSwitch({ vgs, vth, vgsSpec, rdsOn, iSpec = 5, vsupply, rload }) {
  const iWanted = vsupply / (rload + rdsOn);
  let region, id;
  if (vgs < vth) { region = 'off'; id = 0; }
  else {
    const k = iSpec / (vgsSpec - vth) ** 2, iSat = k * (vgs - vth) ** 2;
    if (vgs >= vgsSpec || iSat >= iWanted * 3) { region = 'on'; id = iWanted; }
    else { region = 'partial'; id = Math.min(iWanted, iSat); }
  }
  const vds = region === 'off' ? vsupply : Math.max(id * rdsOn, vsupply - id * rload);
  return { region, id, vds, p: vds * id, iWanted, vload: vsupply - vds, guaranteed: vgs >= vgsSpec };
}
/** Low-side NPN switch with base resistor rb driven from vdrive. */
export function npnSwitch({ vdrive, rb, beta = 100, vsupply, rload, vbe = 0.7, vceSat = 0.2 }) {
  const ib = vdrive > vbe ? (vdrive - vbe) / rb : 0;
  const icSat = Math.max(0, (vsupply - vceSat) / rload);
  let region, ic, vce;
  if (ib <= 0) { region = 'off'; ic = 0; vce = vsupply; }
  else if (beta * ib >= icSat) { region = 'saturated'; ic = icSat; vce = vceSat; }
  else { region = 'linear'; ic = beta * ib; vce = vsupply - ic * rload; }
  return { region, ib, ic, vce, icSat, p: vce * ic + vbe * ib, overdrive: icSat > 0 ? beta * ib / icSat : Infinity, forcedBeta: ib > 0 ? ic / ib : Infinity };
}

// ---------------------------------------------------------------- GPIO pin
export const GPIO_DEFAULTS = { vdd: 3.3, rOn: 30, rPull: 45e3, vilFrac: 0.3, vihFrac: 0.7 };
export const GPIO_EXTERNALS = {
  none: { title: 'Nothing connected' },
  'button-gnd': { title: 'Push button to GND', button: true },
  'button-vdd': { title: 'Push button to 3.3 V', button: true },
  'led-gnd': { title: 'LED + 330 Ω to GND (pin sources current)' },
  'led-vdd': { title: 'LED + 330 Ω to 3.3 V (pin sinks current)' },
  'pullup-ext': { title: 'External 4.7 kΩ pull-up to 3.3 V' },
  'pullup-5v': { title: 'External 4.7 kΩ pull-up to 5 V' },
  'drive-5v': { title: '5 V logic output driving the pin' },
  'short-gnd': { title: 'Wire straight to GND' },
};
/**
 * DC operating point of one GPIO pin.
 * cfg: { mode:'pp'|'od'|'in', level:0|1, pull:'none'|'up'|'down', ext: key of GPIO_EXTERNALS, pressed, ledVf, rLed }
 * Returns { v (NaN when floating), floating, logic: 0|1|'x'|'float', iPin (A, positive = out of the pin driver),
 *           iClamp, contention, branches }.
 */
export function gpioSolve(cfg, P = GPIO_DEFAULTS) {
  const { mode = 'in', level = 0, pull = 'none', ext = 'none', pressed = false, ledVf = 1.8, rLed = 330 } = cfg;
  const { vdd, rOn, rPull } = P;
  // Each branch is a Thevenin source {v, r} to the pin node. `drv` marks the pin's own output transistor.
  const br = [];
  if (mode === 'pp') br.push({ v: level ? vdd : 0, r: rOn, drv: true });
  if (mode === 'od' && !level) br.push({ v: 0, r: rOn, drv: true });
  if (pull === 'up') br.push({ v: vdd, r: rPull, name: 'internal pull-up' });
  if (pull === 'down') br.push({ v: 0, r: rPull, name: 'internal pull-down' });
  if (ext === 'button-gnd' && pressed) br.push({ v: 0, r: 0.1, name: 'button' });
  if (ext === 'button-vdd' && pressed) br.push({ v: vdd, r: 0.1, name: 'button' });
  if (ext === 'pullup-ext') br.push({ v: vdd, r: 4700, name: 'external pull-up' });
  if (ext === 'pullup-5v') br.push({ v: 5, r: 4700, name: 'external pull-up' });
  if (ext === 'drive-5v') br.push({ v: 5, r: 50, name: '5 V driver' });
  if (ext === 'short-gnd') br.push({ v: 0, r: 0.1, name: 'wire' });
  const solve = (list) => { let g = 0, gi = 0; for (const b of list) { g += 1 / b.r; gi += b.v / b.r; } return g ? gi / g : NaN; };
  let v = solve(br), ledOn = false;
  // LED branches conduct only when forward biased past Vf; then they look like a source Vf behind rLed.
  if (ext === 'led-gnd' && v > ledVf) { br.push({ v: ledVf, r: rLed, name: 'LED' }); v = solve(br); ledOn = true; }
  if (ext === 'led-vdd' && !(v > vdd - ledVf)) {
    if (!isNaN(v)) { br.push({ v: vdd - ledVf, r: rLed, name: 'LED' }); v = solve(br); ledOn = true; }
  }
  let floating = isNaN(v), iClamp = 0;
  // Protection diode to VDD: clamps at about VDD + 0.6 V and carries whatever the outside world pushes in.
  if (!floating && v > vdd + 0.6) {
    const vc = vdd + 0.6;
    iClamp = br.reduce((a, b) => a + (b.v - vc) / b.r, 0);
    v = vc;
  }
  const drv = br.find((b) => b.drv);
  const iPin = drv && !floating ? (drv.v - v) / drv.r : 0;
  const vil = P.vilFrac * vdd, vih = P.vihFrac * vdd;
  const logic = floating ? 'float' : v <= vil ? 0 : v >= vih ? 1 : 'x';
  const iLed = ledOn ? Math.abs((v - br[br.length - 1].v) / rLed) : 0;
  return { v, floating, logic, iPin, iClamp, ledOn, iLed, vil, vih, contention: !!drv && Math.abs(iPin) > 0.02, branches: br };
}

// ---------------------------------------------------------------- PWM
/** Largest duty resolution a counter clocked at fclk can give at fpwm: floor(log2(fclk / fpwm)). */
export function pwmMaxBits(fclk, fpwm) {
  if (!(fclk > 0) || !(fpwm > 0) || fpwm > fclk) return 0;
  return Math.max(0, Math.floor(Math.log2(fclk / fpwm) + 1e-9));
}
/** Highest PWM frequency that still allows `bits` of resolution. */
export const pwmMaxFreq = (fclk, bits) => fclk / 2 ** bits;
/** Quantise a duty fraction to a counter compare value. */
export function pwmQuantise(duty, bits) {
  const steps = 2 ** bits, count = Math.max(0, Math.min(steps, Math.round(duty * steps)));
  return { count, steps, duty: count / steps, stepPct: 100 / steps };
}
export const pwmAverage = (vhigh, duty) => vhigh * duty;
export const pwmRms = (vhigh, duty) => vhigh * Math.sqrt(duty);
