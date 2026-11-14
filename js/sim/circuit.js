// DC circuit solver for the breadboard and troubleshooting tools.
//
// Method: modified nodal analysis. Every node gets a KCL equation; every voltage source adds one branch-current
// unknown. Diodes and LEDs use a piecewise-linear model (open below the knee voltage, then knee + series
// resistance), so the non-linear problem becomes "guess which diodes conduct, solve the linear circuit, check the
// guess, repeat". That matches the hand calculation taught in the course: I = (Vsupply - Vf) / R.
//
// What is modelled: steady-state DC only. No capacitance, no inductance, no time, no temperature, no tolerance.
// Every number in DEFAULTS is a *typical* teaching value, not a datasheet figure for any particular chip.

export const DEFAULTS = {
  vdd: 3.3,            // MCU supply rail, volts
  pinRout: 30,         // output driver resistance behind an ideal 0 V / VDD source, ohms (typical order of magnitude)
  pinRpull: 45000,     // internal pull-up / pull-down, ohms (typical; real parts vary widely)
  pinLimit: 0.020,     // per-pin source/sink current treated as the safe limit, amps (typical conservative figure)
  vil: 0.3,            // input reads 0 at or below vil * VDD (typical CMOS)
  vih: 0.7,            // input reads 1 at or above vih * VDD (typical CMOS)
  overV: 0.3,          // a pin more than this beyond a rail is flagged, volts
  shortLimit: 0.5,     // supply current above this is reported as a short circuit, amps
  resistorRating: 0.25, // watts
  ledMax: 0.020,       // continuous LED current limit, amps (typical 5 mm indicator)
  ledRon: 10,          // LED slope resistance above the knee, ohms
  diodeRon: 1,
  wireR: 0.01,         // jumper wire, ohms
  switchR: 0.05,       // closed switch contact, ohms
  gmin: 1e-9,          // conductance to ground added to floating nodes so the matrix stays solvable, siemens
  goff: 1e-10,         // leakage of a non-conducting diode, siemens
  meterR: 1e7,         // voltmeter input resistance, ohms
};

/** Typical forward (knee) voltage by LED colour. Real parts differ: check the LED's datasheet. */
export const LED_VF = { red: 1.8, yellow: 2.0, green: 2.1, blue: 3.0, white: 3.0 };

/** Rough perceived brightness 0..1 for an indicator LED carrying `i` amps. */
export function ledBrightness(i) {
  if (!(i > 5e-5)) return 0;
  return Math.min(1, Math.sqrt(i / 0.015));
}

/** What a digital input reads for a node voltage: 'low' | 'high' | 'undefined'. */
export function logicLevel(v, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (v <= o.vil * o.vdd + 1e-9) return 'low';
  if (v >= o.vih * o.vdd - 1e-9) return 'high';
  return 'undefined';
}

// Solve A x = b in place with partial pivoting. Returns null if singular.
function gauss(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-18) return null;
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]]; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let k = r + 1; k < n; k++) sum -= A[r][k] * x[k];
    x[r] = sum / A[r][r];
  }
  return x;
}

/**
 * Solve a DC circuit.
 *
 * circuit = { ground: 'GND', components: [ ... ] } where each component has a unique `id` and a `type`:
 *   { type:'vsource', p, n, v, rs? }             ideal source (optional series resistance rs)
 *   { type:'isource', from, to, i }              ideal current source pushing i amps into node `to`
 *   { type:'resistor', a, b, r, rating? }
 *   { type:'wire', a, b }
 *   { type:'switch', a, b, closed }
 *   { type:'pot', a, w, b, r, pos }              pos 0..1 is the wiper position from end a to end b
 *   { type:'led', a, k, color?|vf?, ron?, imax? } a = anode, k = cathode
 *   { type:'diode', a, k, vf?, ron? }
 *   { type:'pin', node, mode, vdd?, rout?, rpull? }  mode: 'out-high' | 'out-low' | 'input' | 'input-pullup' |
 *                                                    'input-pulldown' | 'analog'
 *
 * Returns { ok, nodes, floating, components, diagnostics, v(node) }.
 *   nodes[name]      volts relative to ground, or null if the node floats
 *   components[id]   per-part results (v, i, p, ...); currents flow a→b, anode→cathode, out of a source's +
 *                    terminal, and out of an MCU pin (negative = the pin is sinking)
 *   diagnostics      [{ code, severity:'error'|'warn', component?, node?, ...data }]
 */
export function solve(circuit, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const gnd = circuit.ground ?? 'GND';
  const comps = circuit.components || [];
  const idx = new Map(); const names = [];
  const N = (name) => {
    if (name == null) throw new Error('circuit: a component terminal has no node');
    if (name === gnd) return -1;
    if (!idx.has(name)) { idx.set(name, names.length); names.push(name); }
    return idx.get(name);
  };
  const conds = [];    // { a, b, g }
  const inject = [];   // { n, i }   current pushed into node n
  const vsrcs = [];    // { p, n, v, rs, c }
  const diodes = [];   // { a, k, vf, ron, c, on }
  const strong = [];   // [a, b] node-index pairs that give a DC path (for the floating-node analysis)
  const attach = new Map(); // node name -> [{ id, type, term }]
  const diagnostics = [];
  const shorted = new Set();
  const seen = new Set();

  const touch = (node, c, term) => { if (!attach.has(node)) attach.set(node, []); attach.get(node).push({ id: c.id, type: c.type, term }); };
  const cond = (a, b, r) => { conds.push({ a, b, g: 1 / r }); strong.push([a, b]); };

  for (const c of comps) {
    if (c.id == null) throw new Error('circuit: component without an id');
    if (seen.has(c.id)) throw new Error('circuit: duplicate component id ' + c.id);
    seen.add(c.id);
    const two = (x, y) => {
      touch(x, c, 0); touch(y, c, 1);
      if (x === y) { shorted.add(c.id); diagnostics.push({ code: 'shorted-part', severity: c.type === 'wire' || c.type === 'switch' ? 'warn' : 'error', component: c.id, node: x }); return false; }
      return true;
    };
    switch (c.type) {
      case 'resistor':
        if (!(c.r > 0)) throw new Error('circuit: resistor ' + c.id + ' needs r > 0');
        if (two(c.a, c.b)) cond(N(c.a), N(c.b), c.r); else N(c.a);
        break;
      case 'wire':
        if (two(c.a, c.b)) cond(N(c.a), N(c.b), o.wireR); else N(c.a);
        break;
      case 'switch':
        if (two(c.a, c.b)) { const a = N(c.a), b = N(c.b); if (c.closed) cond(a, b, o.switchR); } else N(c.a);
        break;
      case 'pot': {
        if (!(c.r > 0)) throw new Error('circuit: pot ' + c.id + ' needs r > 0');
        touch(c.a, c, 0); touch(c.w, c, 1); touch(c.b, c, 2);
        const pos = Math.min(1, Math.max(0, c.pos ?? 0.5));
        const a = N(c.a), w = N(c.w), b = N(c.b);
        if (a !== w) cond(a, w, Math.max(0.5, c.r * pos));
        if (w !== b) cond(w, b, Math.max(0.5, c.r * (1 - pos)));
        break;
      }
      case 'led': case 'diode': {
        const isLed = c.type === 'led';
        const vf = c.vf ?? (isLed ? (LED_VF[c.color] ?? LED_VF.red) : 0.6);
        if (two(c.a, c.k)) { const a = N(c.a), k = N(c.k); diodes.push({ a, k, vf, ron: c.ron ?? (isLed ? o.ledRon : o.diodeRon), c, on: false }); strong.push([a, k]); } else N(c.a);
        break;
      }
      case 'vsource': {
        touch(c.p, c, 0); touch(c.n, c, 1);
        const p = N(c.p), n = N(c.n);
        if (p === n) throw new Error('circuit: source ' + c.id + ' has both terminals on one node');
        vsrcs.push({ p, n, v: c.v, rs: c.rs ?? 0, c }); strong.push([p, n]);
        break;
      }
      case 'isource': {
        touch(c.from, c, 0); touch(c.to, c, 1);
        const f = N(c.from), t = N(c.to);
        inject.push({ n: t, i: c.i }, { n: f, i: -c.i });
        break;
      }
      case 'pin': {
        touch(c.node, c, 0);
        const n = N(c.node), vdd = c.vdd ?? o.vdd, rout = c.rout ?? o.pinRout, rpull = c.rpull ?? o.pinRpull;
        if (c.mode === 'out-high' || c.mode === 'out-low') { conds.push({ a: n, b: -1, g: 1 / rout }); if (c.mode === 'out-high') inject.push({ n, i: vdd / rout }); strong.push([n, -1]); }
        else if (c.mode === 'input-pullup') { conds.push({ a: n, b: -1, g: 1 / rpull }); inject.push({ n, i: vdd / rpull }); strong.push([n, -1]); }
        else if (c.mode === 'input-pulldown') { conds.push({ a: n, b: -1, g: 1 / rpull }); strong.push([n, -1]); }
        else if (c.mode !== 'input' && c.mode !== 'analog') throw new Error('circuit: pin ' + c.id + ' has unknown mode ' + c.mode);
        break;
      }
      default: throw new Error('circuit: unknown component type ' + c.type);
    }
  }

  // Which nodes have a DC path to ground? Union-find over the "strong" edges.
  const n = names.length;
  const parent = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const G = n; // index used for ground inside the union-find
  for (const [a, b] of strong) parent[find(a < 0 ? G : a)] = find(b < 0 ? G : b);
  const isFloating = names.map((_, i) => find(i) !== find(G));

  // Linear solve for a given set of diode states.
  const m = vsrcs.length, size = n + m;
  const linear = () => {
    const A = Array.from({ length: size }, () => new Array(size).fill(0));
    const b = new Array(size).fill(0);
    const stampG = (a, k, g) => { if (a >= 0) A[a][a] += g; if (k >= 0) A[k][k] += g; if (a >= 0 && k >= 0) { A[a][k] -= g; A[k][a] -= g; } };
    for (const c of conds) stampG(c.a, c.b, c.g);
    for (const s of inject) if (s.n >= 0) b[s.n] += s.i;
    for (let i = 0; i < n; i++) if (isFloating[i]) A[i][i] += o.gmin;
    for (const d of diodes) {
      if (d.on) { const g = 1 / d.ron; stampG(d.a, d.k, g); const j = d.vf * g; if (d.a >= 0) b[d.a] += j; if (d.k >= 0) b[d.k] -= j; }
      else stampG(d.a, d.k, o.goff);
    }
    vsrcs.forEach((s, j) => {
      const r = n + j;
      if (s.p >= 0) { A[s.p][r] += 1; A[r][s.p] += 1; }
      if (s.n >= 0) { A[s.n][r] -= 1; A[r][s.n] -= 1; }
      A[r][r] -= s.rs; b[r] = s.v;
    });
    return gauss(A, b);
  };

  let x = null, converged = false;
  for (let iter = 0; iter < 80; iter++) {
    x = linear();
    if (!x) break;
    const V = (i) => (i < 0 ? 0 : x[i]);
    let worst = null; const wrong = [];
    for (const d of diodes) {
      const vd = V(d.a) - V(d.k);
      const viol = d.on ? (d.vf - vd) : (vd - d.vf);       // > 0 means the assumed state is inconsistent
      if (viol > 1e-9) { wrong.push(d); if (!worst || viol > worst.viol) worst = { d, viol }; }
    }
    if (!wrong.length) { converged = true; break; }
    if (iter < 12) for (const d of wrong) d.on = !d.on; else worst.d.on = !worst.d.on;
  }
  if (!x) {
    diagnostics.push({ code: 'unsolvable', severity: 'error' });
    return { ok: false, nodes: {}, floating: [], components: {}, diagnostics, v: () => NaN };
  }
  if (!converged) diagnostics.push({ code: 'no-convergence', severity: 'warn' });

  const Vi = (i) => (i < 0 ? 0 : x[i]);
  const v = (name) => (name === gnd ? 0 : idx.has(name) ? x[idx.get(name)] : NaN);
  const nodes = { [gnd]: 0 };
  names.forEach((nm, i) => { nodes[nm] = isFloating[i] ? null : x[i]; });
  const floating = names.filter((_, i) => isFloating[i]);
  const floats = (name) => name !== gnd && isFloating[idx.get(name)];

  // Per-component results.
  const out = {};
  const diodeOf = new Map(diodes.map((d) => [d.c.id, d]));
  vsrcs.forEach((s, j) => {
    const i = -x[n + j];
    out[s.c.id] = { type: 'vsource', v: Vi(s.p) - Vi(s.n), i, p: (Vi(s.p) - Vi(s.n)) * i };
    const lim = s.c.ilimit ?? o.shortLimit;
    if (Math.abs(i) > lim) diagnostics.push({ code: 'short-circuit', severity: 'error', component: s.c.id, i, limit: lim });
  });
  for (const c of comps) {
    switch (c.type) {
      case 'resistor': {
        const vv = shorted.has(c.id) ? 0 : v(c.a) - v(c.b), i = vv / c.r, p = vv * i;
        out[c.id] = { type: c.type, v: vv, i, p };
        const rating = c.rating ?? o.resistorRating;
        if (p > rating * 1.0001) diagnostics.push({ code: 'over-power', severity: 'error', component: c.id, p, rating });
        break;
      }
      case 'wire': case 'switch': {
        const live = !shorted.has(c.id) && (c.type === 'wire' || c.closed);
        const vv = shorted.has(c.id) ? 0 : v(c.a) - v(c.b);
        out[c.id] = { type: c.type, v: vv, i: live ? vv / (c.type === 'wire' ? o.wireR : o.switchR) : 0, closed: c.type === 'wire' || !!c.closed };
        break;
      }
      case 'pot': {
        const pos = Math.min(1, Math.max(0, c.pos ?? 0.5));
        const ra = Math.max(0.5, c.r * pos), rb = Math.max(0.5, c.r * (1 - pos));
        const va = v(c.a), vw = v(c.w), vb = v(c.b);
        const iA = c.a === c.w ? 0 : (va - vw) / ra, iB = c.w === c.b ? 0 : (vw - vb) / rb;
        const p = iA * iA * ra + iB * iB * rb;
        out[c.id] = { type: 'pot', va, vw, vb, iA, iB, i: Math.max(Math.abs(iA), Math.abs(iB)), p, ra, rb };
        const rating = c.rating ?? o.resistorRating;
        if (p > rating * 1.0001) diagnostics.push({ code: 'over-power', severity: 'error', component: c.id, p, rating });
        break;
      }
      case 'led': case 'diode': {
        const d = diodeOf.get(c.id);
        if (!d) { out[c.id] = { type: c.type, v: 0, i: 0, p: 0, on: false, vf: c.vf ?? LED_VF[c.color] ?? (c.type === 'led' ? LED_VF.red : 0.6) }; break; }
        const vd = Vi(d.a) - Vi(d.k), i = d.on ? Math.max(0, (vd - d.vf) / d.ron) : 0;
        const reversed = vd < -0.5;
        out[c.id] = { type: c.type, v: vd, i, p: vd * i, on: d.on && i > 0, vf: d.vf, reversed };
        if (c.type === 'led') {
          if (reversed) diagnostics.push({ code: 'led-reversed', severity: 'error', component: c.id, v: vd });
          const imax = c.imax ?? o.ledMax;
          if (i > imax * 1.0001) diagnostics.push({ code: 'over-current', severity: 'error', component: c.id, i, limit: imax });
        }
        break;
      }
      case 'isource': out[c.id] = { type: c.type, v: v(c.to) - v(c.from), i: c.i }; break;
      case 'pin': {
        const vdd = c.vdd ?? o.vdd, rout = c.rout ?? o.pinRout, rpull = c.rpull ?? o.pinRpull, vn = v(c.node), fl = floats(c.node);
        let i = 0;
        if (c.mode === 'out-high') i = (vdd - vn) / rout; else if (c.mode === 'out-low') i = -vn / rout;
        else if (c.mode === 'input-pullup') i = (vdd - vn) / rpull; else if (c.mode === 'input-pulldown') i = -vn / rpull;
        const isOut = c.mode === 'out-high' || c.mode === 'out-low', digitalIn = !isOut && c.mode !== 'analog';
        const level = fl ? 'floating' : logicLevel(vn, { vdd, vil: o.vil, vih: o.vih });
        out[c.id] = { type: 'pin', mode: c.mode, v: fl ? null : vn, i, level, floating: fl };
        if (isOut && Math.abs(i) > (c.limit ?? o.pinLimit) * 1.0001) diagnostics.push({ code: 'pin-overcurrent', severity: 'error', component: c.id, i, limit: c.limit ?? o.pinLimit, direction: i > 0 ? 'source' : 'sink' });
        if (fl && (c.mode === 'input' || c.mode === 'analog')) diagnostics.push({ code: 'floating-input', severity: 'error', component: c.id, node: c.node });
        if (!fl && digitalIn && level === 'undefined') diagnostics.push({ code: 'input-undefined', severity: 'warn', component: c.id, v: vn, low: o.vil * vdd, high: o.vih * vdd });
        if (!fl && (vn > vdd + o.overV || vn < -o.overV)) diagnostics.push({ code: 'input-overvoltage', severity: 'error', component: c.id, v: vn, vdd });
        break;
      }
    }
  }

  // Floating islands (groups of nodes joined to each other but not to ground).
  const islands = new Map();
  names.forEach((nm, i) => { if (isFloating[i]) { const r = find(i); if (!islands.has(r)) islands.set(r, []); islands.get(r).push(nm); } });
  for (const group of islands.values()) diagnostics.push({ code: 'floating-node', severity: 'warn', nodes: group, node: group[0] });

  // Legs that connect to nothing else.
  for (const [node, list] of attach) {
    if (node === gnd || list.length !== 1) continue;
    const t = list[0];
    if (t.type === 'pin' || t.type === 'vsource' || t.type === 'isource' || shorted.has(t.id)) continue;
    diagnostics.push({ code: 'dangling', severity: 'warn', component: t.id, node, term: t.term });
  }

  return { ok: true, nodes, floating, components: out, diagnostics, v };
}

/**
 * What a voltmeter reads with its red lead on `red` and black lead on `black`. The meter is part of the circuit:
 * its input resistance (10 MΩ by default) is added between the probes before solving, which is why probing a
 * floating node gives a definite reading and can change the behaviour being measured.
 */
export function measureVoltage(circuit, red, black, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (red === black) return 0;
  const r = solve({ ...circuit, components: [...circuit.components, { id: '__meter', type: 'resistor', a: red, b: black, r: o.meterR, rating: Infinity }] }, options);
  if (!r.ok) return NaN;
  return r.v(red) - r.v(black);
}

/**
 * Resistance between two nodes with the circuit unpowered, as an ohmmeter or continuity tester sees it.
 * Sources and MCU pins are removed and diodes are treated as open. Returns Infinity for an open circuit.
 */
export function resistanceBetween(circuit, a, b, options = {}) {
  if (a === b) return 0;
  const passive = circuit.components.filter((c) => ['resistor', 'wire', 'switch', 'pot'].includes(c.type));
  const itest = 1e-3;
  const r = solve({ ground: b, components: [...passive, { id: '__ohm', type: 'isource', from: b, to: a, i: itest }] }, options);
  if (!r.ok || r.nodes[a] == null) return Infinity;
  return Math.max(0, r.nodes[a] / itest);
}
