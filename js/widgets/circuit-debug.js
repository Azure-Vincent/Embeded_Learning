// Circuit troubleshooting: a build that does not behave like its schematic. The learner probes it with a virtual
// multimeter, then names the fault and the fix. All readings come from the DC solver, including the meter's own
// 10 MΩ loading of the circuit.
import { h, s, clear, fmtSI } from '../core/dom.js';
import { measureVoltage, resistanceBetween } from '../sim/circuit.js';

const V3 = { id: 'V3', type: 'vsource', p: 'V', n: 'G', v: 3.3 };
const BEEP_BELOW = 50; // ohms

// Schematic of the LED circuits (as designed): IO0 → R1 → LED1 → GND.
const LED_DRAW = [
  ['chip', 20, 60, 90, 110, 'MCU'], ['pin', 110, 90, 'IO0'], ['pinv', 60, 60, '3V3'], ['pinv', 60, 170, 'GND'],
  ['wire', [[60, 60], [60, 34]]], ['rail', 60, 34, '3V3'],
  ['wire', [[110, 90], [160, 90]]], ['res', 160, 90, 240, 90, 'R1 220 Ω'], ['wire', [[240, 90], [280, 90]]],
  ['led', 280, 90, 350, 90, 'LED1 red'], ['wire', [[350, 90], [400, 90], [400, 210], [60, 210], [60, 170]]], ['gnd', 230, 210],
];
const LED_POINTS = [
  { id: 'V', label: '3V3', node: 'V', x: 60, y: 46, lx: 12, ly: 4 }, { id: 'A', label: 'A', node: 'A', x: 136, y: 90, lx: 0, ly: -10 },
  { id: 'B', label: 'B', node: 'B', x: 262, y: 90, lx: 0, ly: -10 }, { id: 'C', label: 'C', node: 'C', x: 400, y: 150, lx: 12, ly: 4 },
  { id: 'G', label: 'GND', node: 'G', x: 60, y: 192, lx: 14, ly: 4 },
];
const pinNotDriven = (extra) => ({ text: 'IO0 is not being driven high (wrong pin number, or the pin was left as an input).', feedback: 'If the pin were not driven, test point A would sit near 0 V. Put the red probe on A and the black probe on GND: it reads ' + extra + ', so the pin is doing its job and the fault is further along.' });

export const SCENARIOS = {
  'led-reversed': {
    title: 'The LED that stays dark',
    symptom: 'Firmware sets IO0 high. LED1 stays dark.',
    draw: LED_DRAW, points: LED_POINTS,
    circuit: () => ({ ground: 'G', components: [V3, { id: 'IO0', type: 'pin', node: 'A', mode: 'out-high' }, { id: 'R1', type: 'resistor', a: 'A', b: 'B', r: 220 }, { id: 'LED1', type: 'led', a: 'C', k: 'B', color: 'red' }, { id: 'Wg', type: 'wire', a: 'C', b: 'G' }] }),
    diagnoses: [
      pinNotDriven('3.30 V'),
      { text: 'R1 is open (broken, or a leg is not making contact).', feedback: 'With R1 open, B would be cut off from the pin: B to GND would read about 0 V and the ohmmeter would show open between A and B. Instead B reads 3.30 V and A–B measures 220 Ω.' },
      { text: 'LED1 is fitted backwards: it blocks, so no current flows.', correct: true, feedback: 'Yes. The pin is at 3.30 V, yet there is 0 V across R1. By Ohm\'s law no drop means no current, so something in the loop is open, and the whole 3.3 V appears across that open element: the LED, reverse-biased.' },
      { text: 'The return path from LED1 to the MCU\'s GND is missing.', feedback: 'Check it: continuity from C to GND beeps, and C sits at 0 V. The return path is intact; the break is between B and C.' },
    ],
    fixes: [
      { text: 'Replace R1 with a smaller value so more current flows.', feedback: 'No current flows at all, so the resistor value is irrelevant: 0 A × R is 0 V for any R. And if the LED were then fitted correctly, a much smaller resistor would overdrive it.' },
      { text: 'Turn LED1 round so its anode (long leg) faces R1 and its cathode goes to GND.', correct: true, feedback: 'Right. Forward-biased, the LED drops about 1.8 V and the current becomes roughly (3.3 V − 1.8 V) ÷ 220 Ω ≈ 6 mA after the pin\'s own resistance.' },
      { text: 'Feed the circuit from a higher voltage to push through the LED.', feedback: 'A reverse-biased LED keeps blocking until it breaks down, and LEDs tolerate only a few volts in reverse (see the LED\'s datasheet). More voltage damages it instead of lighting it.' },
    ],
    explain: 'The pattern to remember: voltage present at the source, zero volts across the series resistor, full voltage across one element. Zero volts across a resistor means zero current, and the element that has all the voltage across it is the one that is open. A reversed LED and a dead (open) LED look identical to a voltmeter.',
  },
  'missing-ground': {
    title: 'Everything is connected, nothing happens',
    symptom: 'Firmware sets IO0 high. LED1 stays dark. On the bench, the LED\'s cathode (test point C) is plugged into the breadboard\'s − rail.',
    draw: LED_DRAW, points: LED_POINTS,
    circuit: () => ({ ground: 'G', components: [V3, { id: 'IO0', type: 'pin', node: 'A', mode: 'out-high' }, { id: 'R1', type: 'resistor', a: 'A', b: 'B', r: 220 }, { id: 'LED1', type: 'led', a: 'B', k: 'C', color: 'red' }] }),
    diagnoses: [
      { text: 'LED1 is fitted backwards.', feedback: 'A reversed LED would still leave C firmly at ground: C to GND would read 0 V and beep on continuity. Here C reads about 1.5 V relative to GND and there is no continuity. A "ground" that is not at 0 V is not connected to ground.' },
      { text: 'The − rail that C is plugged into is not connected to the MCU\'s GND, so the loop is open.', correct: true, feedback: 'Yes. Continuity from C to GND is open. The meter still reads about 1.5 V there because its own 10 MΩ completes a tiny loop through the LED: 3.3 V minus the LED\'s 1.8 V.' },
      pinNotDriven('3.30 V'),
      { text: 'R1 is shorted out.', feedback: 'A bypassed resistor would make the LED too bright, not dark, and A–B would read almost 0 Ω. It measures 220 Ω.' },
    ],
    fixes: [
      { text: 'Turn LED1 round.', feedback: 'Then there would be two faults: an open return path and a reversed LED. The loop is still open at the rail.' },
      { text: 'Run a jumper from the − rail to one of the MCU\'s GND pins.', correct: true, feedback: 'Right. A breadboard rail is only a strip of metal. It becomes "ground" when, and only when, a wire joins it to the supply\'s ground.' },
      { text: 'Enable a pull-down on IO0.', feedback: 'IO0 is an output and already at 3.30 V. A pull-down on the pin does nothing for a return path that is missing at the other end of the circuit.' },
    ],
    explain: 'Current flows in loops. A source pin and a correct component chain are only half a loop; the return to the source\'s ground is the other half. On breadboards the usual cause is a rail that was never jumpered to GND, or a rail on the other side of the board, which is a separate strip.',
  },
  'floating-input': {
    title: 'The button that reads at random',
    symptom: 'Firmware configures IO1 as a plain input and reads the button. Pressed, it reads 0 every time. Released, it reads 0 or 1 at random, and the value changes when a hand comes near the wire.',
    toggles: [{ key: 'pressed', label: 'Hold SW1 pressed' }],
    draw: [
      ['chip', 20, 60, 90, 110, 'MCU'], ['pin', 110, 100, 'IO1'], ['pinv', 60, 60, '3V3'], ['pinv', 60, 170, 'GND'],
      ['wire', [[60, 60], [60, 34]]], ['rail', 60, 34, '3V3'], ['text', 122, 76, 'input, no pull', 'dim'],
      ['wire', [[110, 100], [300, 100], [300, 120]]], ['sw', 300, 120, 300, 190, 'SW1', 'pressed'], ['wire', [[300, 190], [300, 210], [60, 210], [60, 170]]], ['gnd', 190, 210],
    ],
    points: [{ id: 'V', label: '3V3', node: 'V', x: 60, y: 46, lx: 12, ly: 4 }, { id: 'A', label: 'A', node: 'A', x: 210, y: 100, lx: 0, ly: -10 }, { id: 'G', label: 'GND', node: 'G', x: 60, y: 192, lx: 14, ly: 4 }],
    circuit: (st) => ({ ground: 'G', components: [V3, { id: 'IO1', type: 'pin', node: 'A', mode: 'input' }, { id: 'SW1', type: 'switch', a: 'A', b: 'G', closed: !!st.pressed }] }),
    diagnoses: [
      { text: 'SW1 is worn and its contacts bounce.', feedback: 'Bounce lasts a few milliseconds at the instant of pressing or releasing. This input misbehaves while nobody touches the button. And the switch tests fine: continuity A to GND is open when released and beeps when pressed.' },
      { text: 'The 3V3 supply is missing or unstable.', feedback: '3V3 to GND reads a steady 3.30 V.' },
      { text: 'With SW1 open, nothing connects IO1 to any voltage: the input floats.', correct: true, feedback: 'Yes. Released, the meter reads 0 V from A to GND and also 0 V from 3V3 to A. Both cannot be true of a driven node. The node simply follows whichever probe touches it, through the meter\'s 10 MΩ: nothing else is holding it.' },
      { text: 'SW1 is wired to 3V3 instead of GND.', feedback: 'With the button held, continuity from A to GND beeps and A to 3V3 stays open. The button does go to ground.' },
    ],
    fixes: [
      { text: 'Add a resistor in series with the button.', feedback: 'When the button is open, a series resistor is connected to nothing at one end. The pin is exactly as undefined as before.' },
      { text: 'Wire IO1 straight to 3V3 so it reads 1 when released.', feedback: 'That defines the released level, but pressing the button then joins 3V3 to GND directly: a short circuit. The connection to 3V3 has to be weak, which is to say, a resistor.' },
      { text: 'Enable the pin\'s internal pull-up (or fit about 10 kΩ from IO1 to 3V3).', correct: true, feedback: 'Right. Released, the resistor holds the pin at 3.3 V with no current flowing. Pressed, the switch wins easily and the pin is at 0 V while well under a milliamp flows through the resistor.' },
    ],
    explain: 'A CMOS input draws practically no current, so with nothing connected it keeps whatever stray charge reaches it. Notice what the meter did: connecting it gave the node a path and made the reading look like a solid 0 V. Measuring a floating node changes it. Two contradictory readings are the clue.',
  },
  'no-current-limit': {
    title: 'The LED that is too bright',
    symptom: 'LED1 lights, noticeably brighter than on the other boards, and this board sometimes misbehaves when the LED is on. The design calls for 220 Ω in series.',
    draw: LED_DRAW, points: LED_POINTS,
    circuit: () => ({ ground: 'G', components: [V3, { id: 'IO0', type: 'pin', node: 'A', mode: 'out-high' }, { id: 'R1', type: 'resistor', a: 'A', b: 'B', r: 220 }, { id: 'Wx', type: 'wire', a: 'A', b: 'B' }, { id: 'LED1', type: 'led', a: 'B', k: 'C', color: 'red' }, { id: 'Wg', type: 'wire', a: 'C', b: 'G' }] }),
    diagnoses: [
      { text: 'LED1 is a different colour with a lower forward voltage.', feedback: 'A different LED shifts its own drop by a few tenths of a volt. It cannot make the drop across R1 exactly 0 V while current flows: A to B reads 0.00 V and the ohmmeter shows almost 0 Ω where 220 Ω should be.' },
      { text: 'R1 is bypassed: its two legs are joined (same breadboard strip, or a solder bridge), so nothing limits the current.', correct: true, feedback: 'Yes. Zero volts across a resistor that is carrying current, and continuity across it, mean the current is going around it. The pin reads only about 2.2 V because its own output resistance is now the only thing limiting the current.' },
      { text: 'IO0 is set to input with pull-up instead of output.', feedback: 'Through a 45 kΩ pull-up the LED would get about 30 µA and be almost dark, not brighter.' },
      { text: 'The 3V3 rail is too high.', feedback: '3V3 to GND reads 3.30 V.' },
    ],
    fixes: [
      { text: 'Dim the LED in firmware by switching it on for shorter periods.', feedback: 'While the pin is on it still delivers about 37 mA, far above the typical safe figure for a GPIO. Shorter pulses lower the average, not the peak the driver has to survive.' },
      { text: 'Move one leg of R1 into its own row so the current has to pass through it.', correct: true, feedback: 'Right. With 220 Ω really in series the current falls from about 37 mA to about 6 mA and the pin returns to nearly 3.3 V.' },
      { text: 'Use a 5 V supply so the pin voltage stops sagging.', feedback: 'The pin sags because it is overloaded. More voltage means more current through the same unprotected LED and pin.' },
    ],
    explain: 'An LED does not limit its own current: above its forward voltage, a small rise in voltage produces a large rise in current. Here the only resistance left was the pin\'s output driver. A HIGH output that measures well below the rail is the sign of an overloaded pin. On a breadboard the classic cause is both legs of the resistor in one five-hole strip.',
  },
  brownout: {
    title: 'Resets when the motor starts',
    symptom: 'The board runs normally until firmware switches the motor on. Then it resets, every time. With the motor unplugged it never resets. Assume the board\'s regulator needs at least 4.3 V at its input to hold the 3.3 V rail (the real figure is the regulator\'s dropout voltage: see its datasheet).',
    toggles: [{ key: 'motor', label: 'Motor running' }],
    draw: [
      ['src', 40, 80, 40, 190, '5 V source'], ['wire', [[40, 80], [40, 50], [90, 50]]], ['wire', [[90, 50], [330, 50]]], ['text', 150, 42, 'supply lead', 'dim'],
      ['wire', [[250, 50], [250, 70]]], ['motor', 250, 70, 250, 130, 'M'], ['sw', 250, 130, 250, 190, 'driver', 'motor'], ['wire', [[250, 190], [250, 210]]],
      ['wire', [[330, 50], [390, 50], [390, 90]]], ['chip', 350, 90, 80, 80, 'MCU board'], ['pinv', 390, 90, 'VIN'], ['pinv', 390, 170, 'GND'],
      ['wire', [[40, 190], [40, 210], [390, 210], [390, 170]]], ['gnd', 150, 210],
    ],
    points: [{ id: 'S', label: 'S', node: 'S', x: 70, y: 50, lx: 0, ly: -10 }, { id: 'B', label: 'B', node: 'B', x: 330, y: 50, lx: 0, ly: -10 }, { id: 'G', label: 'GND', node: 'G', x: 100, y: 210, lx: 0, ly: -10 }],
    circuit: (st) => ({ ground: 'G', components: [{ id: 'VS', type: 'vsource', p: 'S', n: 'G', v: 5, ilimit: 5 }, { id: 'Rlead', type: 'resistor', a: 'S', b: 'B', r: 1.2, rating: Infinity }, { id: 'Rboard', type: 'resistor', a: 'B', b: 'G', r: 100, rating: Infinity },
      { id: 'SWm', type: 'switch', a: 'B', b: 'M', closed: !!st.motor }, { id: 'Rmotor', type: 'resistor', a: 'M', b: 'G', r: 4.5, rating: Infinity }] }),
    diagnoses: [
      { text: 'The 5 V source cannot deliver the motor current, so its output collapses.', feedback: 'Measure at the source with the motor running: S to GND still reads 5.00 V. The source holds. The voltage is being lost somewhere between S and B.' },
      { text: 'The motor is wired with the wrong polarity.', feedback: 'A reversed DC motor turns the other way and draws the same current. It would not explain why the voltage at B falls when the motor runs.' },
      { text: 'The supply lead has too much resistance for the motor current: the voltage at the board drops when the motor runs.', correct: true, feedback: 'Yes. With the motor running there is about 1.1 V between S and B: nearly an amp flowing through about an ohm of wire and contacts. The board is left with about 3.9 V, below what its regulator needs, so the 3.3 V rail falls and the MCU resets.' },
      { text: 'It is a firmware bug in the motor code.', feedback: 'A measurement cannot prove code correct, but it can show an electrical cause that is sufficient by itself: B drops from 4.94 V to about 3.9 V when the motor runs. Fix what you can measure first.' },
    ],
    fixes: [
      { text: 'Add a delay in firmware before starting the motor.', feedback: 'The drop lasts as long as the motor current flows. Waiting changes when the board resets, not whether.' },
      { text: 'Raise the source to 6.5 V to make up for the drop.', feedback: 'Then the board sees about 6.4 V whenever the motor is off, and the drop still follows the motor current up and down. You would have to check everything on that rail against the higher voltage, and the cause is untouched.' },
      { text: 'Give the motor its own short, thick leads straight from the source, separate from the board\'s lead, with the grounds joined at the source.', correct: true, feedback: 'Right. The motor current then no longer flows through the wire that feeds the board, so the board\'s supply stays near 5 V whatever the motor does. On real hardware you would also add capacitance close to the board and the motor.' },
    ],
    explain: 'Every wire and contact is a small resistor, and V = I × R applies to it. At milliamps it does not matter; at an amp, one ohm costs one volt. Measure the supply at the load, while the load is running, not at the source with nothing happening. This model is DC only: a real motor draws several times more for an instant at start-up, which makes the dip deeper, and the lead resistance here is lumped into the positive wire.',
  },
  'wrong-rail': {
    title: 'It works, and it kills pins',
    symptom: 'The button input works: IO1 reads 1 released and 0 pressed. But IO1 has stopped working on two boards built this way after a few days. A fresh board is on the bench. Find out what this build does to the pin.',
    toggles: [{ key: 'pressed', label: 'Hold SW1 pressed' }],
    draw: [
      ['chip', 20, 70, 90, 100, 'MCU'], ['pin', 110, 120, 'IO1'], ['pinv', 60, 70, '3V3'], ['pinv', 60, 170, 'GND'],
      ['wire', [[60, 70], [60, 34]]], ['rail', 60, 34, '3V3'], ['text', 122, 142, 'input', 'dim'],
      ['wire', [[110, 120], [320, 120], [320, 130]]], ['res', 240, 120, 240, 50, 'R1 10 kΩ'], ['wire', [[240, 50], [240, 34]]], ['rail', 240, 34, '3V3'], ['dot', 240, 120],
      ['sw', 320, 130, 320, 195, 'SW1', 'pressed'], ['wire', [[320, 195], [320, 210], [60, 210], [60, 170]]], ['gnd', 190, 210],
    ],
    points: [{ id: 'V', label: '3V3', node: 'V', x: 60, y: 50, lx: 12, ly: 4 }, { id: 'P', label: 'P', node: 'P', x: 240, y: 46, lx: 12, ly: 4 }, { id: 'A', label: 'A', node: 'A', x: 170, y: 120, lx: 0, ly: -10 }, { id: 'G', label: 'GND', node: 'G', x: 60, y: 192, lx: 14, ly: 4 }],
    circuit: (st) => ({ ground: 'G', components: [V3, { id: 'V5', type: 'vsource', p: 'X5', n: 'G', v: 5 }, { id: 'Wp', type: 'wire', a: 'X5', b: 'P' }, { id: 'R1', type: 'resistor', a: 'P', b: 'A', r: 10000 },
      { id: 'IO1', type: 'pin', node: 'A', mode: 'input' }, { id: 'Dclamp', type: 'diode', a: 'A', k: 'V', vf: 0.6 }, { id: 'SW1', type: 'switch', a: 'A', b: 'G', closed: !!st.pressed }] }),
    diagnoses: [
      { text: 'R1 is the wrong value: far too small.', feedback: 'The ohmmeter shows 10 kΩ between P and A, as designed. With the button pressed only half a milliamp flows through it.' },
      { text: 'Pressing SW1 shorts the 3V3 rail to GND.', feedback: 'With the button held, 3V3 to GND still reads 3.30 V and A reads 0 V: R1 limits the current. That part of the circuit is fine.' },
      { text: 'The top of R1 is on a 5 V rail, not 3V3: the released pin is pushed above the MCU\'s own supply.', correct: true, feedback: 'Yes. P reads 5.00 V where the schematic says 3V3, and the released pin sits at about 3.9 V: one diode drop above the 3.3 V rail, because the pin\'s protection diode is conducting into the supply. The logic still reads "1", which is why nobody noticed.' },
      { text: 'The internal pull-up is enabled as well and fights R1.', feedback: 'Two pull-ups to the same rail just act in parallel. Neither could lift the pin above 3.3 V, and A reads about 3.9 V.' },
    ],
    fixes: [
      { text: 'Keep R1 on 5 V but increase it to 100 kΩ.', feedback: 'That reduces the current forced into the pin, but the pin is still driven beyond its supply all the time. Whether a given pin tolerates that is a datasheet question (injection current, absolute maximum ratings), not something to design in on purpose.' },
      { text: 'Move the top of R1 to the 3V3 rail.', correct: true, feedback: 'Right. The pull-up must go to the supply of the chip whose input it feeds. Then the released pin sits at exactly 3.3 V and no current flows into it.' },
      { text: 'Configure IO1 as an output.', feedback: 'Then the pin would fight the button and the pull-up, and firmware could no longer read the button at all.' },
    ],
    explain: 'A circuit can work and still be wrong. Logic levels only tell you 0 or 1; a voltmeter tells you whether "1" is 3.3 V or something the chip was never rated for. This model gives the pin a protection diode to 3V3 with a 0.6 V drop. Many pins have such a structure and some (5 V-tolerant ones) do not: the absolute maximum ratings in the datasheet are the authority.',
  },
};

/** One meter reading. mode 'v' = volts red→black, 'c' = continuity/resistance with the circuit unpowered. */
export function reading(sc, mode, redId, blackId, st = {}) {
  const node = (id) => sc.points.find((p) => p.id === id).node;
  const c = sc.circuit(st), a = node(redId), b = node(blackId);
  if (mode === 'v') {
    let v = measureVoltage(c, a, b);
    if (Math.abs(v) < 0.005) v = 0;
    return { value: v, text: v.toFixed(2) + ' V', beep: false };
  }
  const r = resistanceBetween(c, a, b);
  if (r > 2e7) return { value: Infinity, text: 'OL (open circuit)', beep: false };
  const beep = r < BEEP_BELOW;
  return { value: r, text: (r < 0.1 ? '0.0 Ω' : fmtSI(r, 'Ω')) + (beep ? ' · beep' : ''), beep };
}

// ---- schematic drawing ---------------------------------------------------------------------------------------
function symbol(kind, x1, y1, x2, y2, st, key) {
  const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, c = len / 2;
  const g = s('g', { transform: `translate(${x1} ${y1}) rotate(${ang})` });
  const lead = (a, b) => g.append(s('line', { class: 'w', x1: a, y1: 0, x2: b, y2: 0 }));
  if (kind === 'res') { lead(0, c - 15); lead(c + 15, len); g.append(s('rect', { class: 'sym', x: c - 15, y: -6, width: 30, height: 12 })); }
  if (kind === 'led') {
    lead(0, c - 8); lead(c + 7, len);
    g.append(s('path', { class: 'sym', d: `M${c - 8} -9 L${c - 8} 9 L${c + 7} 0 Z` }), s('line', { class: 'w', x1: c + 7, y1: -9, x2: c + 7, y2: 9 }),
      s('path', { class: 'w', d: `M${c - 2} -13 l6 -8 m-4.5 1 l4.5 -1 l-.5 4.5 M${c + 7} -13 l6 -8 m-4.5 1 l4.5 -1 l-.5 4.5` }));
  }
  if (kind === 'sw') {
    const closed = !!st[key];
    lead(0, c - 12); lead(c + 12, len);
    g.append(s('circle', { class: 'sym', cx: c - 12, cy: 0, r: 2.5 }), s('circle', { class: 'sym', cx: c + 12, cy: 0, r: 2.5 }), s('line', { class: 'w', x1: c - 12, y1: 0, x2: c + 11, y2: closed ? -2.5 : -12 }));
  }
  if (kind === 'motor') { lead(0, c - 14); lead(c + 14, len); g.append(s('circle', { class: 'sym', cx: c, cy: 0, r: 14 })); }
  if (kind === 'src') { lead(0, c - 4); lead(c + 4, len); g.append(s('line', { class: 'w', x1: c - 4, y1: -12, x2: c - 4, y2: 12 }), s('line', { class: 'w', x1: c + 4, y1: -6, x2: c + 4, y2: 6, 'stroke-width': 3.5 })); }
  return g;
}
function drawSchematic(svg, sc, st) {
  for (const d of sc.draw) {
    const [k, a, b, c, e, f, g2] = d;
    if (k === 'wire') svg.append(s('polyline', { class: 'w', points: a.map((p) => p.join(',')).join(' ') }));
    else if (k === 'chip') svg.append(s('rect', { class: 'chip', x: a, y: b, width: c, height: e, rx: 3 }), s('text', { x: a + c / 2, y: b + e / 2 + 4, 'text-anchor': 'middle' }, f));
    else if (k === 'pin') svg.append(s('text', { class: 'dim', x: a - 5, y: b + 3.5, 'text-anchor': 'end' }, c));
    else if (k === 'pinv') svg.append(s('text', { class: 'dim', x: a, y: b + (b > 120 ? -5 : 12), 'text-anchor': 'middle' }, c));
    else if (k === 'rail') svg.append(s('line', { class: 'w', x1: a - 9, y1: b, x2: a + 9, y2: b }), s('text', { x: a, y: b - 5, 'text-anchor': 'middle' }, c));
    else if (k === 'gnd') svg.append(s('path', { class: 'w', d: `M${a} ${b} v8 m-10 0 h20 m-16 4 h12 m-8 4 h4` }));
    else if (k === 'dot') svg.append(s('circle', { class: 'fillink', cx: a, cy: b, r: 2.5 }));
    else if (k === 'text') svg.append(s('text', { class: e || '', x: a, y: b }, c));
    else {
      svg.append(symbol(k, a, b, c, e, st, g2));
      const vert = Math.abs(c - a) < 1, mx = (a + c) / 2, my = (b + e) / 2;
      if (k === 'motor') svg.append(s('text', { x: mx, y: my + 4, 'text-anchor': 'middle' }, 'M'), s('text', { class: 'dim', x: mx + 20, y: my + 4 }, 'motor'));
      else if (k === 'src') svg.append(s('text', { x: mx + 16, y: my + 4 }, f), s('text', { class: 'dim', x: mx - 14, y: my - 8, 'text-anchor': 'middle' }, '+'));
      else svg.append(s('text', vert ? { x: mx + 16, y: my + 4 } : { x: mx, y: my + 24, 'text-anchor': 'middle' }, f));
    }
  }
}

// ---- widget --------------------------------------------------------------------------------------------------
export default function mount(el, props = {}, ctx) {
  clear(el); el.classList.add('circuit-debug');
  if (SCENARIOS[props.scenario]) return run(el, props.scenario, ctx, null);
  const picker = () => {
    clear(el);
    el.append(h('p', {}, 'Each of these circuits was built from a correct schematic and does not behave. Pick one, measure it, and find out why.'),
      h('div', { class: 'circuit-debug-pick' }, Object.entries(SCENARIOS).map(([id, sc]) => h('button', { type: 'button', 'data-scenario': id, onclick: () => run(el, id, ctx, picker) }, h('strong', {}, sc.title), h('span', {}, sc.symptom.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.'))))));
  };
  picker();
}

function run(el, id, ctx, back) {
  const sc = SCENARIOS[id];
  const st = {}; let mode = 'v', red = null, black = null, next = 'red', count = 0, wrong = 0, stage = 'diagnose';
  clear(el);
  const svg = s('svg', { class: 'w-svg circuit-debug-svg', viewBox: '0 0 440 240', role: 'group', 'aria-label': 'Schematic with test points' });
  const lcd = h('div', { class: 'lcd', role: 'status', 'aria-live': 'polite', 'data-lcd': '' }, '—');
  const probes = h('div', { class: 'row' });
  const log = h('ol', { class: 'circuit-debug-log', 'aria-label': 'Measurement log' });
  const counter = h('span', { class: 'w-mono', 'data-count': '' }, '0 measurements');
  const hint = h('p', { class: 'w-note', role: 'status' });
  const answer = h('div', {});
  const pt = (pid) => sc.points.find((p) => p.id === pid);

  function draw() {
    clear(svg);
    drawSchematic(svg, sc, st);
    for (const p of sc.points) {
      const g = s('g', { class: 'tp' + (red === p.id ? ' red' : '') + (black === p.id ? ' black' : ''), role: 'button', tabindex: 0, 'data-tp': p.id,
        'aria-label': `Test point ${p.label}` + (red === p.id ? ', red probe here' : '') + (black === p.id ? ', black probe here' : ''),
        onclick: () => place(p.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(p.id); } } },
        s('rect', { class: 'hit', x: p.x - 13, y: p.y - 13, width: 26, height: 26, rx: 4 }), s('circle', { class: 'dot', cx: p.x, cy: p.y, r: 6 }),
        s('text', { x: p.x + p.lx, y: p.y + p.ly, 'text-anchor': p.lx ? 'start' : 'middle' }, p.label));
      svg.append(g);
    }
    clear(probes);
    probes.append(
      h('button', { type: 'button', class: 'w-tab' + (next === 'red' ? ' on' : ''), 'data-probe': 'red', 'aria-pressed': String(next === 'red'), onclick: () => { next = 'red'; draw(); } }, h('span', { class: 'probe red' }, h('i', {}), 'Red (+): ' + (red ? pt(red).label : 'not placed'))),
      h('button', { type: 'button', class: 'w-tab' + (next === 'black' ? ' on' : ''), 'data-probe': 'black', 'aria-pressed': String(next === 'black'), onclick: () => { next = 'black'; draw(); } }, h('span', { class: 'probe black' }, h('i', {}), 'Black (−): ' + (black ? pt(black).label : 'not placed'))));
    hint.textContent = !red || !black ? `Select a test point on the schematic to place the ${next} probe.` : 'Both probes placed. Press Measure, or select a test point to move the ' + next + ' probe.';
  }
  function place(pid) {
    const focusId = pid;
    if (next === 'red') { red = pid; next = 'black'; } else { black = pid; next = 'red'; }
    lcd.textContent = '—';
    draw();
    svg.querySelector(`[data-tp="${focusId}"]`)?.focus();
  }
  function measure() {
    if (!red || !black) { hint.textContent = 'Place both probes first: red, then black.'; return; }
    const r = reading(sc, mode, red, black, st);
    count++;
    lcd.textContent = r.text;
    const cond = (sc.toggles || []).filter((t) => st[t.key]).map((t) => t.label.toLowerCase()).join(', ');
    log.append(h('li', {}, `${mode === 'v' ? 'V' : 'Ω'}  ${pt(red).label} → ${pt(black).label}: ${r.text}${cond ? `  (${cond})` : ''}`));
    log.scrollTop = log.scrollHeight;
    counter.textContent = `${count} measurement${count === 1 ? '' : 's'}`;
    if (red === black) hint.textContent = 'Both probes are on the same point, so the meter reads nothing useful.';
    drawAnswer();
  }
  function question(name, legend, opts, onRight) {
    const fb = h('div', { class: 'w-msg', hidden: true, role: 'status', 'data-fb': name });
    const btn = h('button', { type: 'button', class: 'btn small', 'data-act': 'submit-' + name, disabled: count === 0, onclick: () => {
      const pick = answer.querySelector(`input[name="cd-${name}"]:checked`);
      if (!pick) { fb.hidden = false; fb.className = 'w-msg warn'; fb.textContent = 'Choose one of the options.'; return; }
      const o = opts[+pick.value];
      fb.hidden = false; fb.className = 'w-msg ' + (o.correct ? 'ok' : 'bad'); fb.textContent = o.feedback;
      if (o.correct) onRight(); else wrong++;
    } }, 'Submit');
    return h('fieldset', {}, h('legend', {}, legend), h('div', { class: 'circuit-debug-opts' }, opts.map((o, i) => h('label', {}, h('input', { type: 'radio', name: 'cd-' + name, value: i }), h('span', {}, o.text)))),
      btn, count === 0 ? h('span', { class: 'w-note' }, ' Take at least one measurement first: a diagnosis needs evidence.') : null, fb);
  }
  let diagEl = null, fixEl = null, doneEl = null;
  function drawAnswer() {
    // Only rebuild what the measurement count unlocks; keep answered questions and their feedback on screen.
    if (!diagEl || (diagEl.dataset.locked === '1' && count > 0)) {
      const fresh = question('diag', 'What is wrong with this build?', sc.diagnoses, () => {
        stage = 'fix'; fresh.querySelectorAll('input,button').forEach((x) => { x.disabled = true; });
        fixEl = question('fix', 'What is the right fix?', sc.fixes, () => {
          stage = 'done'; fixEl.querySelectorAll('input,button').forEach((x) => { x.disabled = true; });
          doneEl = h('div', { class: 'w-msg ok', 'data-done': '' }, h('strong', {}, `Solved with ${count} measurement${count === 1 ? '' : 's'} and ${wrong} wrong guess${wrong === 1 ? '' : 'es'}. `), sc.explain);
          answer.append(doneEl);
          ctx?.complete?.();
        });
        answer.append(fixEl);
      });
      fresh.dataset.locked = count === 0 ? '1' : '0';
      if (diagEl) diagEl.replaceWith(fresh); else answer.append(fresh);
      diagEl = fresh;
    }
  }

  const modeTabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Meter mode' });
  const drawModes = () => { clear(modeTabs); for (const [k, label] of [['v', 'Voltage (V)'], ['c', 'Continuity / Ω']]) modeTabs.append(h('button', { type: 'button', class: 'w-tab' + (mode === k ? ' on' : ''), 'data-mode': k, 'aria-pressed': String(mode === k), onclick: () => { mode = k; lcd.textContent = '—'; drawModes(); } }, label)); };
  const toggles = (sc.toggles || []).map((t) => h('label', { class: 'breadboard-check' }, h('input', { type: 'checkbox', 'data-toggle': t.key, onchange: (e) => { st[t.key] = e.target.checked; lcd.textContent = '—'; draw(); } }), ' ' + t.label));

  el.append(
    back ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small ghost', 'data-act': 'back', onclick: back }, '← All scenarios')) : null,
    h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, sc.title + '. '), sc.symptom), h('p', {}, 'Probe the circuit, then say what is wrong and how to fix it. Fewer measurements is better, but guessing costs more than measuring.'), ctx?.isDone?.() ? h('p', { class: 'w-note' }, 'Solved before.') : null),
    h('div', { class: 'circuit-debug-layout' },
      h('div', {}, svg, h('p', { class: 'w-note' }, 'The schematic shows the circuit as designed. The build on the bench may differ from it: that is what you are finding out.'), toggles.length ? h('div', { class: 'row' }, toggles) : null),
      h('div', {}, h('div', { class: 'circuit-debug-meter' }, h('h4', { style: { marginTop: 0 } }, 'Multimeter'), modeTabs, probes, lcd,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', 'data-act': 'measure', onclick: measure }, 'Measure'), counter), hint, log))),
    h('h4', {}, 'Diagnosis'), answer,
    h('p', { class: 'w-note' }, 'A DC simulation, not a real bench. The voltmeter is modelled as 10 MΩ between its probes and is part of the circuit while it measures. Continuity is measured with the circuit unpowered (the simulator removes power for you), treats LEDs as open and beeps below 50 Ω. Pin, LED and pull-up values are typical teaching figures.'));
  drawModes(); draw(); drawAnswer();
}
