// Pure maths for the signal explorer: waveform samples, measurements, and conversion to logic levels.
export function sampleWave({ shape = 'sine', amp = 1.2, offset = 1.65, freq = 2, noise = 0, edge = 0.2 }, n = 400, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (i / n) * freq, f = ph - Math.floor(ph);
    let v;
    if (shape === 'dc') v = offset;
    else if (shape === 'sine') v = offset + amp * Math.sin(2 * Math.PI * ph);
    else if (shape === 'square') v = offset + (f < 0.5 ? amp : -amp);
    else { // 'slow': a square wave whose edges take a fraction `edge` of the half period to move
      const half = f < 0.5 ? f / 0.5 : (f - 0.5) / 0.5, k = Math.min(1, half / Math.max(edge, 1e-6));
      v = offset + (f < 0.5 ? -amp + 2 * amp * k : amp - 2 * amp * k);
    }
    out[i] = v + noise * 2 * rnd();
  }
  return out;
}
export function measure(v) {
  const n = v.length, mean = v.reduce((a, b) => a + b, 0) / n;
  const max = Math.max(...v), min = Math.min(...v);
  return { mean, max, min, pp: max - min, rms: Math.sqrt(v.reduce((a, b) => a + b * b, 0) / n), acRms: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n) };
}
/** One threshold: the output follows every crossing, including those caused by noise. */
export function toLogicSingle(v, vth) { return v.map((x) => (x > vth ? 1 : 0)); }
/** Schmitt trigger: goes high above vHigh, low below vLow, and holds its state in between. */
export function toLogicSchmitt(v, vLow, vHigh, start = 0) {
  let st = start; return v.map((x) => { if (x > vHigh) st = 1; else if (x < vLow) st = 0; return st; });
}
export const transitions = (bits) => bits.reduce((n, b, i) => n + (i && b !== bits[i - 1] ? 1 : 0), 0);
/** Fraction of samples that sit in the undefined band between VIL and VIH. */
export const undefinedFraction = (v, vil, vih) => v.filter((x) => x > vil && x < vih).length / v.length;
