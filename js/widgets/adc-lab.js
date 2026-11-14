// ADC explorer: sampling in time, quantisation in voltage, the code <-> voltage formula, and aliasing.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { adcCode, adcVoltage, adcLsb, aliasFrequency, sampleSine } from '../sim/electronics.js';
import { svg, txt, scale, axes, polyline, slider, select, readout, equation, messages, note } from '../sim/electronics-draw.js';

const WINDOW = 0.5;   // seconds of signal shown

/** Summary of a sampling set-up. */
export function samplingPlan({ f, fs, bits, vref, amp, offset }) {
  const nyquist = fs / 2, aliased = f > nyquist, fApparent = aliasFrequency(f, fs);
  // signed alias frequency: the sine that passes through exactly the same sample points
  const fSigned = f - fs * Math.round(f / fs);
  return { nyquist, aliased, fApparent, fSigned, perCycle: fs / f, lsb: adcLsb(vref, bits), levels: 2 ** bits, clipsHigh: offset + amp > vref, clipsLow: offset - amp < 0 };
}

export default function mount(el, props = {}) {
  const num = (x, d, lo, hi) => (x == null || isNaN(+x) ? d : Math.min(hi, Math.max(lo, +x)));
  const st = { bits: Math.round(num(props.bits, 4, 1, 16)), vref: num(props.vref, 3.3, 0.5, 5.5), f: 6, fs: 60, ampPct: 40, vin: 1.2 };
  const vrefs = [[1.1, '1.1 V'], [2.5, '2.5 V'], [3.3, '3.3 V'], [5, '5 V']];
  if (!vrefs.some(([v]) => v === st.vref)) vrefs.push([st.vref, st.vref + ' V']);
  const sBits = slider({ label: 'Resolution', min: 1, max: 16, step: 1, value: st.bits, fmt: (v) => `${v} bits`, oninput: (v) => { st.bits = v; render(); } });
  const sVref = select({ label: 'Reference Vref', options: vrefs, value: st.vref, onchange: (v) => { st.vref = +v; st.vin = Math.min(st.vin, st.vref * 1.2); sVin.input.max = (st.vref * 1.2).toFixed(2); sVin.set(st.vin); render(); } });
  const sF = slider({ label: 'Signal frequency', min: 1, max: 100, step: 1, value: st.f, fmt: (v) => v + ' Hz', oninput: (v) => { st.f = v; render(); } });
  const sFs = slider({ label: 'Sample rate', min: 4, max: 400, log: true, value: st.fs, fmt: (v) => fmtSI(v, 'Hz'), oninput: (v) => { st.fs = v; render(); } });
  const sAmp = slider({ label: 'Signal swing', min: 5, max: 70, step: 1, value: st.ampPct, fmt: (v) => `±${v} % of Vref`, oninput: (v) => { st.ampPct = v; render(); } });
  const sVin = slider({ label: 'Input voltage', min: 0, max: +(st.vref * 1.2).toFixed(2), step: 0.01, value: st.vin, fmt: (v) => v.toFixed(2) + ' V', oninput: (v) => { st.vin = v; render(); } });
  st.fs = sFs.get();
  const codeIn = h('input', { type: 'number', min: 0, step: 1, value: 0, 'aria-label': 'ADC code to convert to a voltage' });
  codeIn.addEventListener('input', () => renderConv(true));
  const fig = h('div'), fig2 = h('div'), ro = readout(), eq = equation(), eq2 = equation(), msg = messages(), msg2 = messages();
  clear(el).append(h('div', { class: 'w-grid adc-lab' },
    h('div', { class: 'el-col' }, h('div', { class: 'el-sub' }, 'Sampling a sine wave'), fig, eq.el),
    h('div', { class: 'el-col' }, h('div', { class: 'w-controls' }, sBits.el, sVref.el, sF.el, sFs.el, sAmp.el), ro.el, msg.el),
    h('div', { class: 'el-col' }, h('div', { class: 'el-sub' }, 'One conversion: voltage → code → voltage'), fig2, eq2.el),
    h('div', { class: 'el-col' }, h('div', { class: 'w-controls' }, sVin.el, h('div', { class: 'w-field adc-lab-code' }, h('label', {}, 'Code → voltage'), codeIn, h('output', {}))), msg2.el)),
  note('ideal ADC: instant sampling, perfectly even steps, no noise, offset or gain error, and code = floor(Vin / Vref × 2^n) clamped to 0 … 2^n − 1. Some datasheets and libraries divide by 2^n − 1 instead; the difference is under one step. Real converters lose one to two bits to noise, need a low source impedance, and are damaged by inputs beyond the supply rails: check your chip\'s datasheet for its absolute maximum input voltage.'));

  function render() { renderSampling(); renderConv(false); }

  function renderSampling() {
    const amp = st.vref * st.ampPct / 100, offset = st.vref / 2, p = samplingPlan({ f: st.f, fs: st.fs, bits: st.bits, vref: st.vref, amp, offset });
    const top = st.vref * 1.25, sc = scale({ x: 40, y: 22, w: 288, h: 170 }, 0, WINDOW, -0.08 * st.vref, top);
    const curve = (fn, n = 400) => { const pts = []; for (let k = 0; k <= n; k++) { const t = WINDOW * k / n; pts.push([sc.x(t), sc.y(fn(t))]); } return pts; };
    const samples = sampleSine({ f: st.f, fs: st.fs, amp, offset, vref: st.vref, bits: st.bits, duration: WINDOW });
    const stair = []; samples.forEach((q, i) => { const tn = Math.min(WINDOW, i + 1 < samples.length ? samples[i + 1].t : WINDOW); stair.push([sc.x(q.t), sc.y(q.vq)], [sc.x(tn), sc.y(q.vq)]); });
    const levelLines = st.bits <= 5 ? Array.from({ length: p.levels + 1 }, (_, k) => s('path', { d: `M${sc.x(0)} ${sc.y(k * p.lsb)}H${sc.x(WINDOW)}`, class: 'el-grid' })) : null;
    clear(fig).append(svg(340, 222, `Sine at ${st.f} hertz sampled at ${fmtSI(st.fs, 'Hz')} with ${st.bits} bits. ${p.aliased ? 'Aliased: the samples look like ' + p.fApparent.toFixed(1) + ' hertz.' : 'Not aliased.'}`,
      axes(sc, { ylabel: 'volts', xlabel: 'time', xticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => [t, t * 1000 + ' ms']), yticks: [[0, '0'], [st.vref, 'Vref']] }),
      levelLines,
      s('rect', { x: sc.x(0), y: sc.y(top), width: sc.x(WINDOW) - sc.x(0), height: sc.y(st.vref) - sc.y(top), class: 'band-bad' }),
      polyline(curve((t) => offset + amp * Math.sin(2 * Math.PI * st.f * t)), 't6 thin'),
      polyline(stair, 't1'),
      p.aliased ? polyline(curve((t) => Math.min(st.vref, Math.max(0, offset + amp * Math.sin(2 * Math.PI * p.fSigned * t)))), 't2 dashed') : null,
      samples.length <= 120 ? samples.map((q) => s('circle', { cx: sc.x(q.t), cy: sc.y(q.vq), r: 2.6, class: 'f1' })) : null,
      txt(sc.x(0) + 4, sc.y(top) + 12, 'grey: real signal   blue: what the ADC stores' + (p.aliased ? '   red: what it looks like' : ''), { cls: 'sub' })));
    ro.set([['Step size (1 LSB)', fmtSI(p.lsb, 'V')], ['Levels', String(p.levels)], ['Nyquist limit (fs / 2)', fmtSI(p.nyquist, 'Hz'), p.aliased ? 'el-hot' : ''], ['Samples per cycle', (+p.perCycle.toPrecision(3)).toString(), p.aliased ? 'el-hot' : ''],
      ['Frequency in the data', fmtSI(p.fApparent, 'Hz'), p.aliased ? 'el-hot' : ''], ['Worst rounding error', fmtSI(p.lsb, 'V')]]);
    eq.set([`1 LSB = Vref / 2^n = ${st.vref} V / ${p.levels} = ${fmtSI(p.lsb, 'V')}`,
      `no aliasing needs  f_signal < fs / 2:   ${st.f} Hz ${p.aliased ? '>' : '<'} ${fmtSI(p.nyquist, 'Hz')}`,
      p.aliased ? `apparent f = |f − fs × round(f / fs)| = |${st.f} − ${fmtSI(st.fs, 'Hz').replace(' Hz', '')} × ${Math.round(st.f / st.fs)}| = ${fmtSI(p.fApparent, 'Hz')}` : `apparent f = ${st.f} Hz (the real one)`]);
    const m = [];
    if (p.aliased) m.push(['bad', `Aliasing. The ADC takes fewer than two samples per cycle, so the stored points trace out a ${fmtSI(p.fApparent, 'Hz')} wave that does not exist${p.fApparent < 0.05 ? ' (here a constant: it catches the same point of every cycle)' : ''}. Nothing in the data distinguishes it from a real ${fmtSI(p.fApparent, 'Hz')} signal, so no software can undo it afterwards. Sample faster, or low-pass filter the signal before the ADC pin so nothing above fs / 2 reaches it.`]);
    else if (p.perCycle < 5) m.push(['warn', `Above the Nyquist limit, so the frequency is preserved, but with only ${p.perCycle.toFixed(1)} samples per cycle the stored shape looks nothing like a sine and the peaks are usually missed. Five to ten samples per cycle is a practical minimum when the shape matters.`]);
    else m.push(['ok', `${p.perCycle.toFixed(0)} samples per cycle: the stored points follow the signal.`]);
    if (p.clipsHigh || p.clipsLow) m.push(['bad', `The signal swings ${p.clipsHigh ? 'above Vref' : ''}${p.clipsHigh && p.clipsLow ? ' and ' : ''}${p.clipsLow ? 'below 0 V' : ''}: those parts all read as ${p.clipsHigh ? 'the maximum code' : ''}${p.clipsHigh && p.clipsLow ? ' or ' : ''}${p.clipsLow ? '0' : ''} (clipping). If the pin also goes outside the chip's supply rails, the input can be damaged.`]);
    if (st.bits <= 5) m.push(['', `With ${st.bits} bits there are only ${p.levels} levels, drawn as grid lines: every sample is pushed down to the level below it. Raise the resolution and the staircase closes in on the signal.`]);
    msg.set(m);
  }

  function renderConv(fromCode) {
    const n = 2 ** st.bits, lsb = adcLsb(st.vref, st.bits), code = adcCode(st.vin, st.vref, st.bits), over = st.vin > st.vref;
    codeIn.max = n - 1;
    if (!fromCode) codeIn.value = code;
    const c2 = Math.max(0, Math.min(n - 1, Math.round(+codeIn.value || 0))), v2 = adcVoltage(c2, st.vref, st.bits);
    codeIn.nextSibling.textContent = `${v2.toFixed(4)} V`;
    // number line: zoom on the steps around the input when there are too many to draw
    const span = st.bits <= 4 ? n : 8, first = st.bits <= 4 ? 0 : Math.max(0, Math.min(n - span, code - 3));
    const sc = scale({ x: 20, y: 30, w: 300, h: 26 }, first * lsb, (first + span) * lsb, 0, 1), kids = [];
    for (let k = 0; k < span; k++) {
      const cdn = first + k, x0 = sc.x(cdn * lsb), x1 = sc.x((cdn + 1) * lsb);
      kids.push(s('rect', { x: x0, y: 30, width: x1 - x0, height: 26, class: cdn === code && !over ? 'band-fill' : 'el-plot' }));
      if (span <= 8 || k % 2 === 0) kids.push(txt((x0 + x1) / 2, 47, String(cdn), { anchor: 'middle', cls: cdn === code ? '' : 'sub' }));
    }
    kids.push(txt(20, 72, (first * lsb).toFixed(3) + ' V', { cls: 'sub' }), txt(320, 72, ((first + span) * lsb).toFixed(3) + ' V', { anchor: 'end', cls: 'sub' }));
    const mx = sc.x(Math.min(st.vin, (first + span) * lsb));
    kids.push(s('path', { d: `M${mx} 28l5 -8h-10Z`, class: 'marker' }), txt(Math.min(Math.max(mx, 50), 290), 14, `Vin ${st.vin.toFixed(2)} V → code ${code}`, { anchor: 'middle', cls: over ? 'hot' : 'sig' }));
    clear(fig2).append(svg(340, 80, `Number line of ADC codes: ${st.vin.toFixed(2)} volts falls in code ${code}.`, ...kids));
    eq2.set([`code = floor(Vin / Vref × 2^n) = floor(${st.vin.toFixed(2)} / ${st.vref} × ${n}) = floor(${(st.vin / st.vref * n).toFixed(2)}) = ${Math.floor(st.vin / st.vref * n)}${over ? ` → clamped to ${n - 1}` : ''}`,
      `V = code × Vref / 2^n = ${c2} × ${st.vref} / ${n} = ${v2.toFixed(4)} V   (bottom of the step; the step is ${fmtSI(lsb, 'V')} wide)`,
      `in C, without floats:  mv = (uint32_t)code * ${Math.round(st.vref * 1000)} / ${n};   // ${Math.floor(c2 * Math.round(st.vref * 1000) / n)} mV`]);
    const m = [];
    if (over) m.push(['bad', `${st.vin.toFixed(2)} V is above Vref. Every voltage up here returns the same full-scale code ${n - 1}, so firmware cannot tell 0.1 V over from 1 V over. Above the supply rail it also exceeds the pin's absolute maximum on most chips (check the datasheet).`]);
    else m.push(['', `Every voltage from ${adcVoltage(code, st.vref, st.bits).toFixed(4)} V up to just under ${adcVoltage(code + 1, st.vref, st.bits).toFixed(4)} V gives code ${code}. Converting back cannot recover where in that step the input was: that lost detail is the quantisation error.`]);
    msg2.set(m);
  }
  render();
}
