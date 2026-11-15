// Electronics lessons 1-6: quantities, circuit laws, signals, passives, diodes, transistors.
import { figTwoLoop, figWaveforms, figFlyback, figReverseProtect, figLowSide, figNpn } from './figures.js';

export default [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'elec-vir', title: 'Voltage, current, resistance and power', minutes: 35,
    summary: 'The four quantities every other lesson is built from, and the one law that links them.',
    skills: ['elec-ohm-calc'],
    blocks: [
      `## The problem

      You connect an LED straight between a board's 3.3 V supply pin and ground. It flashes brightly once and never lights
      again. The same LED with a small resistor in series runs for years. Nothing about the LED changed. What changed is how much **current** was
      allowed to flow, and to see why you need four quantities and the relationship between them.`,

      `## Four quantities

      **Charge** is the thing that moves. In a wire it is carried by electrons. You rarely calculate with charge directly, but
      the other quantities are defined from it.

      **Current (I, amperes)** is the rate at which charge passes a point: one ampere is one coulomb per second. Current is a
      flow *through* a component. It is the same at both ends of a wire or a two-terminal part, because charge does not pile up
      inside it.

      **Voltage (V, volts)** is the energy difference per unit of charge between two points. It is always measured *between*
      two points. "The pin is at 3.3 V" is shorthand for "3.3 V between the pin and the point we agreed to call ground".
      Voltage is what pushes charge; without a difference in voltage, nothing flows.

      **Resistance (R, ohms)** is how strongly a part opposes current. For a resistor, the ratio of the voltage across it to
      the current through it is constant.

      **Power (P, watts)** is the rate at which energy is converted, in a resistor into heat: P = V × I.

      A water analogy helps for a first picture and then stops helping: pressure difference is like voltage, flow rate is like
      current, a narrow pipe is like resistance. The analogy breaks for capacitors, inductors and anything fast, so use it only
      to remember that voltage is *across* and current is *through*.`,

      { t: 'callout', kind: 'why', md: `**Conventional current** flows from the more positive point to the more negative one. Electrons, being negative, physically drift the other way. Every schematic, datasheet and formula uses conventional current, so this course does too. The choice makes no difference to any calculation.` },

      `## Ohm's law

      For a resistor:

      **V = I × R**, and so **I = V / R** and **R = V / I**.

      Combine it with P = V × I and you get two more forms that save a step:

      **P = I² × R** and **P = V² / R**.

      Units matter more than the algebra. Embedded work lives in milliamps and kilohms. A useful habit: volts divided by
      kilohms gives milliamps directly (3.3 V / 10 kΩ = 0.33 mA), and volts times milliamps gives milliwatts.

      | Prefix | Factor | Example |
      |---|---|---|
      | M (mega) | 1 000 000 | 1 MΩ pull-down |
      | k (kilo) | 1 000 | 10 kΩ pull-up |
      | m (milli) | 0.001 | 20 mA LED current |
      | µ (micro) | 0.000 001 | 10 µA sleep current |
      | n (nano) | 0.000 000 001 | 100 nF capacitor |
      | p (pico) | 0.000 000 000 001 | 20 pF pin capacitance |`,

      `## On real hardware

      - A microcontroller GPIO is a voltage source with limits. Its datasheet gives the maximum current a pin may source or
        sink and a total for the whole chip. Those limits are in the "absolute maximum ratings" and "DC characteristics"
        tables. Exceeding them does not trip a fuse; it slowly or quickly damages the output transistors.
      - A resistor has a **power rating** as well as a value. The common through-hole size is 0.25 W. A small surface-mount
        0603 part is typically around 0.1 W. Dissipating more than the rating overheats the part.
      - Wires, connectors, breadboard contacts and USB cables all have a small resistance. At milliamps it is invisible. At
        an amp it is not.`,

      `## Worked example

      A 3.3 V rail feeds a 10 kΩ resistor to ground.

      - Current: I = V / R = 3.3 V / 10 kΩ = 0.33 mA.
      - Power: P = V × I = 3.3 V × 0.33 mA ≈ 1.1 mW. A 0.25 W resistor does not notice.

      Replace the 10 kΩ with 10 Ω:

      - Current: 3.3 V / 10 Ω = 330 mA.
      - Power: 3.3 V × 0.33 A ≈ 1.1 W. A 0.25 W resistor is now running at more than four times its rating and will scorch.

      Same voltage, same formula. Three orders of magnitude in resistance became three orders of magnitude in current and heat.`,

      { t: 'predict', q: `A resistor is connected across a supply. You double the supply voltage and change nothing else. What happens to the power dissipated in the resistor?`,
        choices: [
          { t: 'It doubles', why: `The voltage doubled, but the current through a fixed resistor rises with the voltage too. Power depends on both.` },
          { t: 'It becomes four times larger', ok: true, why: `Yes. Current doubles along with voltage, and P = V × I, so the product goes up fourfold.` },
          { t: 'It stays the same, because the resistance did not change', why: `Resistance sets the ratio of V to I, not the power. With more voltage across the same resistance, more current flows.` },
        ],
        reveal: `P = V² / R. Power goes with the **square** of voltage. This is why a part that is comfortable on 3.3 V can overheat on 5 V (2.3 times the power), and why running a 5 V relay coil from 12 V destroys it (5.8 times the power).` },

      { t: 'widget', name: 'ohms-law', props: { v: 3.3, r: 220 }, caption: 'Change V and R. Watch the current and compare the power with the resistor rating. Find the smallest resistance a 0.25 W resistor survives on 5 V.' },

      { t: 'exercise', prompt: `A 220 Ω resistor is connected between a 3.3 V rail and ground. How much power does it dissipate, in milliwatts?`,
        hints: [`You can go through the current first (I = V / R), or use the form of the power equation that needs only V and R.`, `P = V² / R. Keep volts and ohms; the result is in watts.`],
        solution: `I = 3.3 V / 220 Ω = 15 mA. P = 3.3 V × 15 mA = **49.5 mW**. Or directly: 3.3² / 220 = 10.89 / 220 = 0.0495 W. That is a fifth of a 0.25 W rating, so the resistor runs cool.`,
        answer: { type: 'number', value: 49.5, tol: 1, unit: 'mW' } },

      { t: 'callout', kind: 'mistake', md: `**Treating current as something a supply "pushes" at its rated value.** A 5 V, 2 A adapter does not force 2 A into your board. It holds 5 V and *can* deliver up to 2 A. The load decides how much current flows, by Ohm's law. A bigger-rated supply at the correct voltage is safe. A supply at the wrong *voltage* is not.` },

      `## Harder application: the cable that browns out a board

      A development board draws 500 mA peaks from a USB port through a thin 2 m cable. Each of the cable's two power
      conductors (5 V and ground) measures 0.25 Ω.

      The current flows out through one conductor and back through the other, so the resistance in the loop is 0.5 Ω.`,

      { t: 'exercise', prompt: `With 0.5 Ω of total cable resistance and a 500 mA peak, how many volts are lost in the cable? The port supplies exactly 5.00 V.`,
        hints: [`The cable is a resistor in series with the board. The same current flows through both.`, `V = I × R, with I in amps.`],
        solution: `V lost = 0.5 A × 0.5 Ω = **0.25 V**. The board sees 4.75 V during the peak, and 5.00 V when idle. The regulator on the board must still work from 4.75 V. A cheaper cable with 1 Ω of loop resistance would leave 4.5 V. A linear regulator needs its input to stay above its output by some headroom (its "dropout", covered in the power lesson); for older 3.3 V parts that headroom is a volt or more, so 4.5 V is at or below their limit. This is one of the most common reasons a board "resets when Wi-Fi starts": the fault is in the cable, not in the code.`,
        answer: { type: 'number', value: 0.25, tol: 0.01, unit: 'V' } },

      { t: 'refs', items: [
        { title: 'NIST: SI units and prefixes', url: 'https://www.nist.gov/pml/owm/metric-si/si-units', note: 'definitions of the ampere, volt, ohm and watt' },
        { title: 'Texas Instruments: Analog Engineer\'s Pocket Reference', url: 'https://www.ti.com/seclit/eb/slyw038c/slyw038c.pdf', note: 'compact formula reference, standard resistor values, PCB trace resistance' },
      ] },
    ],
    quiz: [
      { q: 'A multimeter probe on a pin shows 3.3 V. What does this number describe?', kind: 'concept', choices: [
        { t: 'The energy difference per unit charge between that pin and wherever the other probe is', ok: true, why: 'Voltage always exists between two points. The reading depends on where the black probe sits.' },
        { t: 'How much charge is stored in the pin', why: 'Stored charge is measured in coulombs and depends on capacitance. A meter on the volts range does not report it.' },
        { t: 'How much current the pin is delivering', why: 'Current is a flow through a path. A pin can sit at 3.3 V while delivering no current at all.' },
      ] },
      { q: 'A 5 V supply is connected across a 100 Ω, 0.25 W resistor. What happens?', kind: 'circuit', choices: [
        { t: 'It dissipates 0.25 W, exactly at its rating, and runs hot', ok: true, why: 'P = 5² / 100 = 0.25 W. At the rating a resistor is very hot to touch; good practice is to stay below half.' },
        { t: 'It dissipates 50 mW and stays cool', why: '50 mA is the current here, not the power. Power needs the voltage multiplied in as well.' },
        { t: 'Nothing flows because 100 Ω is too large for 5 V', why: 'Any finite resistance lets current flow in proportion to the voltage. 100 Ω at 5 V is a substantial 50 mA.' },
      ] },
      { q: 'You replace a 1 A phone charger with a 3 A charger of the same voltage to power a board that draws 0.3 A. What current flows?', kind: 'concept', choices: [
        { t: '0.3 A, the same as before', ok: true, why: 'The load sets the current. The rating is only how much the supply is able to deliver while holding its voltage.' },
        { t: '3 A, which may damage the board', why: 'A voltage source does not force its rated current into a load. Only the voltage and the load resistance decide the current.' },
        { t: '1 A, the average of the old supply', why: 'The previous supply has no influence on the circuit once it is removed.' },
      ] },
      { q: 'Which change makes a resistor run hottest?', kind: 'concept', choices: [
        { t: 'Doubling the voltage across it', ok: true, why: 'Power rises with the square of the voltage, so this gives four times the heat.' },
        { t: 'Doubling its resistance at the same voltage', why: 'More resistance at a fixed voltage means less current, so the power falls.' },
        { t: 'Moving it to the ground side of the load instead of the supply side', why: 'In a series path the same current flows through the resistor wherever it sits, so the heat is unchanged.' },
      ] },
      { q: 'A sensor draws 2 mA from a 3.3 V rail. Treated as a resistor, what resistance does it present?', kind: 'circuit', choices: [
        { t: '1.65 kΩ', ok: true, why: 'R = V / I = 3.3 V / 2 mA = 1.65 kΩ. Volts divided by milliamps gives kilohms.' },
        { t: '6.6 Ω', why: 'This multiplies voltage by current, which gives power in milliwatts, not resistance.' },
        { t: '0.6 Ω', why: 'This divides current by voltage, which is the inverse of resistance.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'elec-kirchhoff', title: "Kirchhoff's laws, series and parallel circuits", minutes: 45,
    summary: 'Two bookkeeping rules that let you solve any resistor network, and the shortcuts that come from them.',
    skills: ['elec-kirchhoff', 'elec-series-parallel', 'elec-divider'],
    blocks: [
      `## The problem

      A sensor output is connected to an ADC pin through a divider you calculated to give 1.65 V. The meter reads 1.2 V. Every
      resistor is the value you intended. The divider formula you used is correct, but only for a circuit with nothing else
      connected to it. To predict a real circuit you need rules that work for any arrangement of parts.`,

      `## Two conservation laws

      **Kirchhoff's current law (KCL):** the currents flowing into a node add up to the currents flowing out. A node is any
      point where parts join. Charge does not accumulate in a junction, so whatever arrives must leave.

      **Kirchhoff's voltage law (KVL):** going round any closed loop, the voltage rises and drops add up to zero. Voltage is
      energy per charge; a charge that returns to its starting point has the energy it started with.

      Ohm's law describes one part. KCL and KVL describe how parts are connected. With those three you can solve any network
      of resistors and sources.`,

      `## Series

      Parts are in **series** when the same current must flow through each in turn, with no branch between them.

      - The current is identical in every part (KCL: nowhere else to go).
      - The voltages add up to the source voltage (KVL).
      - Resistances add: R total = R1 + R2 + …

      The largest resistor takes the largest share of the voltage.

      ## Parallel

      Parts are in **parallel** when both ends of each are joined to the same two nodes.

      - The voltage is identical across every part.
      - The currents add (KCL).
      - Conductances add: 1 / R total = 1 / R1 + 1 / R2 + … For two resistors, R total = R1 × R2 / (R1 + R2).

      A parallel combination is always smaller than its smallest member. Two equal resistors in parallel give half the value.
      A very large resistor in parallel with a small one barely changes it.`,

      { t: 'widget', name: 'series-parallel', caption: 'Build a series pair, then a parallel pair, then a mix. Before you press anything, predict which resistor carries the most current and which has the largest voltage drop.' },

      `## The voltage divider

      Two resistors in series across a supply, output taken from the middle. The same current I = Vin / (R1 + R2) flows
      through both, so the voltage across the bottom one is

      **Vout = Vin × R2 / (R1 + R2)**

      That formula assumes all of the current through R1 continues through R2. Connect a load to the output and some current
      takes the other branch. The load is in parallel with R2, so R2 is effectively smaller, and Vout drops.`,

      { t: 'predict', q: `A divider made from two 10 kΩ resistors across 3.3 V gives 1.65 V. You connect a 10 kΩ load from the output to ground. What does the output become?`,
        choices: [
          { t: 'Still 1.65 V; the load only draws current', why: `Drawing current is what changes it. That current flows through R1 and adds to its voltage drop.` },
          { t: '1.10 V', ok: true, why: `Yes. The load in parallel with the lower 10 kΩ makes 5 kΩ, so the divider is now 10 kΩ over 5 kΩ: one third of 3.3 V.` },
          { t: '0.83 V', why: `That would be half of the unloaded output. The load does not halve the voltage; it halves the lower resistance, and the ratio changes by less than that.` },
        ],
        reveal: `Lower leg: 10 kΩ ∥ 10 kΩ = 5 kΩ. Vout = 3.3 × 5 / (10 + 5) = 1.10 V. Rule of thumb: a divider holds its ratio only if the load resistance is at least ten times, better a hundred times, the divider's lower resistor. This is exactly what happened in the opening problem.` },

      { t: 'widget', name: 'voltage-divider', props: { challenge: 'loaded' }, caption: 'The same effect with different numbers: a 10 kΩ / 10 kΩ divider from 5 V, loaded by 4.7 kΩ. Before you move a slider, calculate the loaded output yourself (R2 ∥ load first). Then make the divider hold 2.5 V with the load connected.' },

      `## Worked example: two sources, two loops

      This circuit cannot be reduced with series and parallel rules alone, because it has two sources. It is also a realistic
      one: a 5 V output connected through a 1 kΩ series resistor to a node that already has a 1 kΩ resistor up to a 3.3 V
      rail (a "pull-up"; a later lesson covers why it is there), with a 10 kΩ load to ground.`,

      { t: 'figure', svg: figTwoLoop, caption: 'Two sources feed node A through R1 and R3. Current directions are assumed; the arithmetic will tell us if an assumption was wrong.' },

      `**Step 1: name the unknowns and pick directions.** Call the voltage at node A "VA". Assume I1 flows from V1 into A, I3
      flows from V2 into A, and I2 flows from A down to ground. If a guess is wrong the answer comes out negative, which is
      fine.

      **Step 2: KVL round each loop gives each current in terms of VA.**

      - Loop 1 (V1, R1, R2): 5 − I1·R1 − VA = 0, so I1 = (5 − VA) / 1 kΩ
      - Loop 2 (V2, R3, R2): 3.3 − I3·R3 − VA = 0, so I3 = (3.3 − VA) / 1 kΩ
      - Across R2: I2 = VA / 10 kΩ

      **Step 3: KCL at node A.** In equals out: I1 + I3 = I2.

      (5 − VA) / 1 + (3.3 − VA) / 1 = VA / 10 (working in volts, kilohms and milliamps)

      8.3 − 2·VA = 0.1·VA, so VA = 8.3 / 2.1 = **3.95 V**

      **Step 4: back-substitute.**

      - I1 = (5 − 3.95) / 1 kΩ = **1.05 mA**
      - I3 = (3.3 − 3.95) / 1 kΩ = **−0.65 mA**
      - I2 = 3.95 / 10 kΩ = **0.40 mA**

      Check KCL: 1.05 − 0.65 = 0.40. It balances.

      **Step 5: read the result.** I3 is negative. The assumed direction was wrong: 0.65 mA flows *out of* node A, through R3,
      *into* the 3.3 V supply. The 5 V source is pushing current backwards into the 3.3 V rail, and the node sits at 3.95 V,
      well above 3.3 V. If node A were a 3.3 V microcontroller pin, it would be over its supply voltage. You could not have
      seen that from the divider formula.`,

      { t: 'callout', kind: 'mistake', md: `**Using the divider formula on a circuit that is not a plain divider.** The formula is a special case of KVL and KCL with exactly two resistors, one source and no load. If anything else touches the middle node (a load, a pull-up, a pin's protection diode, a second source), go back to KCL at that node.` },

      { t: 'exercise', prompt: `A 1 kΩ resistor is in series with a parallel pair (2.2 kΩ and 3.3 kΩ). The whole chain is across 5 V. What is the voltage across the parallel pair?`,
        hints: [`Reduce the parallel pair to one equivalent resistor first.`, `2.2 kΩ ∥ 3.3 kΩ = (2.2 × 3.3) / (2.2 + 3.3) kΩ.`, `Now it is a two-resistor divider: 1 kΩ on top, the equivalent below.`],
        solution: `Parallel pair: 7.26 / 5.5 = 1.32 kΩ. Total: 2.32 kΩ. Current: 5 / 2.32 kΩ = 2.155 mA. Voltage across the pair: 2.155 mA × 1.32 kΩ = **2.84 V** (or 5 × 1.32 / 2.32). Check with KVL: the 1 kΩ drops 2.155 V, and 2.155 + 2.845 = 5.`,
        answer: { type: 'number', value: 2.845, tol: 0.03, unit: 'V' } },

      { t: 'callout', kind: 'decision', title: 'Design choice: how stiff should a divider be?', md: `Low resistor values (1 kΩ and below) make the output hold against loads but waste current all the time: 3.3 V across 2 kΩ is 1.65 mA, which matters on a battery. High values (1 MΩ) waste almost nothing but sag under any load and pick up noise. For signals into a high-impedance input, 10 kΩ to 100 kΩ is the usual compromise. For anything that must deliver real current, do not use a divider at all; use a regulator.` },

      `## Harder application

      In the two-loop circuit, R1 is there to protect the 3.3 V side. Suppose you may change only R1.`,

      { t: 'exercise', prompt: `Keeping V1 = 5 V, V2 = 3.3 V, R3 = 1 kΩ and R2 = 10 kΩ, what value of R1 (in kΩ) makes node A sit at exactly 3.3 V, so that no current flows in R3 in either direction?`,
        hints: [`If VA = 3.3 V there is no voltage across R3, so I3 = 0.`, `Then KCL at A says I1 = I2. You know I2 from VA and R2.`, `I1 = (5 − 3.3) / R1 must equal 3.3 V / 10 kΩ.`],
        solution: `I2 = 3.3 V / 10 kΩ = 0.33 mA. With I3 = 0, I1 = 0.33 mA. R1 = (5 − 3.3) V / 0.33 mA = **5.15 kΩ**. Notice what happened: with no current in R3 the circuit is just a divider of R1 over R2, and 5 × 10 / (5.15 + 10) = 3.3 V. A real design would not rely on this balance; it would use a proper level shifter (lesson on logic levels).`,
        answer: { type: 'number', value: 5.15, tol: 0.08, unit: 'kΩ' } },

      { t: 'refs', items: [
        { title: 'MIT OpenCourseWare 6.002: Circuits and Electronics', url: 'https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/', note: 'lectures 2-3 cover KCL, KVL and the node method used here' },
      ] },
    ],
    quiz: [
      { q: 'Three resistors meet at a node. 4 mA flows in through the first and 1.5 mA flows in through the second. What flows in the third?', kind: 'circuit', choices: [
        { t: '5.5 mA, out of the node', ok: true, why: 'KCL: what flows in must flow out. Both known currents arrive, so the third carries their sum away.' },
        { t: '2.5 mA, out of the node', why: 'Subtracting would be right if one of the known currents were leaving. Both of them arrive.' },
        { t: 'It depends on the third resistor value', why: 'The resistor value sets the voltage needed to carry the current, but the current itself is fixed by charge conservation at the node.' },
      ] },
      { q: 'A 100 Ω and a 100 kΩ resistor are in parallel. The combination is approximately:', kind: 'circuit', choices: [
        { t: '99.9 Ω', ok: true, why: 'A parallel combination is always below its smallest member, and a branch a thousand times larger carries a thousandth of the current.' },
        { t: '50 kΩ', why: 'Halving applies only to two equal resistors. Here nearly all the current takes the small branch.' },
        { t: '100.1 kΩ', why: 'Adding the values is the series rule. In parallel, an extra path can only make it easier for current to flow.' },
      ] },
      { q: 'Two LEDs with their own resistors are wired in parallel across 5 V. One LED fails open. The other:', kind: 'circuit', choices: [
        { t: 'Stays lit at the same brightness', ok: true, why: 'Each parallel branch has the full supply voltage across it regardless of the others, assuming the supply holds its voltage.' },
        { t: 'Goes out, because the circuit is broken', why: 'That is the behaviour of a series string, where one open part interrupts the only path.' },
        { t: 'Gets twice as bright, because it now takes all the current', why: 'The supply fixes the voltage, not the total current. The surviving branch draws what its own resistor allows.' },
      ] },
      { q: 'You solve a circuit and one branch current comes out as −2 mA. What does it mean?', kind: 'concept', choices: [
        { t: 'The current is 2 mA in the opposite direction to the one you assumed', ok: true, why: 'The sign is relative to the arrow you drew. The magnitude and all other results are still valid.' },
        { t: 'You made an arithmetic error; currents cannot be negative', why: 'A negative result is a normal outcome of guessing a direction. Check KCL before assuming a mistake.' },
        { t: 'The branch is absorbing power instead of dissipating it', why: 'A resistor dissipates power whichever way the current flows, since power goes with the square of the current.' },
      ] },
      { q: 'A 100 kΩ / 100 kΩ divider from 3.3 V feeds a circuit whose input resistance is 100 kΩ. The measured output is closest to:', kind: 'circuit', choices: [
        { t: '1.1 V', ok: true, why: 'The input resistance sits in parallel with the lower resistor, giving 50 kΩ. 3.3 × 50 / 150 = 1.1 V.' },
        { t: '1.65 V', why: 'This is the unloaded value. An input resistance equal to the divider resistance is a heavy load.' },
        { t: '2.2 V', why: 'This would result if the load were in parallel with the upper resistor instead of the lower one.' },
      ] },
      { q: 'Going clockwise round a loop you pass a 5 V source (minus to plus), then a resistor dropping 3.2 V, then an LED. What is the voltage across the LED?', kind: 'circuit', choices: [
        { t: '1.8 V', ok: true, why: 'KVL: the rise of 5 V must be matched by drops totalling 5 V, and 3.2 V is already accounted for.' },
        { t: '8.2 V', why: 'Adding a drop to the source rise would mean the loop gains energy on each lap, which KVL forbids.' },
        { t: '5 V, the LED sees the full supply', why: 'The resistor is in the same loop and takes its share. Only what is left over appears across the LED.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'elec-signals', title: 'DC, AC and signals: analog and digital', minutes: 35,
    summary: 'A signal is a voltage that changes with time. What matters about that for supplies, sensors and logic.',
    skills: ['elec-signals'],
    blocks: [
      `## The problem

      A drawer contains three adapters with the same barrel plug: "9 V DC regulated", "9 V DC" with no other marking, and
      "9 V AC". A project needs 9 V. On a meter, the first reads 9.0 V, the second 12.4 V with nothing connected, and the third
      reads about 0 V on the DC range. Only one of them is safe to plug in without thinking. To know which, you need to treat
      voltage as something that varies with time.`,

      `## DC and AC

      **DC (direct current)** means the voltage keeps one polarity. A battery and a regulator output are DC. Almost every
      electronic part in this course runs on DC.

      **AC (alternating current)** means the voltage swings both positive and negative around zero, usually as a sine wave.
      Mains electricity is AC at 50 or 60 Hz because transformers, which change voltage efficiently, only work with a changing
      current.

      An AC waveform is described by:

      - **frequency** (hertz, cycles per second) and **period** (seconds per cycle, T = 1 / f)
      - **amplitude**: the peak voltage, or peak-to-peak
      - **RMS** value: the DC voltage that would deliver the same heating power into a resistor. For a sine wave,
        V rms = V peak / √2 ≈ 0.707 × V peak. "230 V mains" is an RMS figure; its peak is about 325 V.

      That is all the RMS theory embedded work normally needs. The place it bites is the peak: a transformer marked 9 V AC
      produces peaks near 12.7 V.`,

      { t: 'figure', svg: figWaveforms, caption: 'The same axes for all four: voltage upward, time to the right. Only the AC waveform crosses zero.' },

      `## From mains to a DC rail

      A classic unregulated adapter is a transformer, a rectifier (diodes that turn both half-cycles positive) and a large
      capacitor. The capacitor charges to the peak and then supplies the load until the next peak arrives. Between peaks its
      voltage sags. That sag is **ripple**.

      Ripple size follows directly from the capacitor relation I = C × dV/dt, rearranged:

      **ΔV ≈ I × Δt / C**

      where Δt is the time between charging peaks (10 ms for full-wave rectified 50 Hz).

      Two consequences:

      - The output of an unregulated supply depends on the load. Lightly loaded it sits near the peak, which is why the
        unmarked "9 V" adapter read 12.4 V. Loaded, it sags and ripples.
      - A **regulator** after the capacitor removes most of the ripple and holds the output constant, as long as the lowest
        point of the ripple stays above the regulator's minimum input voltage.

      Modern USB chargers are switching supplies that regulate properly, but they add their own high-frequency ripple of tens
      of millivolts. An ADC can see that.`,

      { t: 'callout', kind: 'warn', md: `Mains voltage can kill. Nothing in this course requires you to open a mains-powered device or work on the primary side of a power supply. Use a ready-made, certified adapter or USB supply and treat its low-voltage output as your starting point.` },

      `## Signals

      A **signal** is a voltage (or current) whose variation with time carries information. Whether a wire is "power" or
      "signal" is a matter of intent, not physics: both obey the same laws.

      It is useful to split any waveform into a **DC component** (its average level) and an **AC component** (the variation
      around the average). A microphone output might be 1.65 V DC with 20 mV of AC on top; the audio is the 20 mV.

      ### Analog signals

      An **analog** signal is meaningful at every voltage within its range. A temperature sensor that outputs 10 mV per degree
      is analog: 0.250 V and 0.251 V mean different temperatures. Any noise added to an analog signal becomes part of it and
      cannot be told apart from the real value afterwards.

      ### Digital signals

      A **digital** signal uses only two voltage ranges: a low range meaning 0 and a high range meaning 1. The receiver does
      not care whether a high is 3.1 V or 3.3 V. This is what makes digital robust: noise smaller than the gap between the
      ranges is ignored at every stage, instead of accumulating.

      A digital signal is still an analog voltage. It takes real time to move between levels (the **rise time** and
      **fall time**), it overshoots and rings on long wires, and while it is passing between the two ranges its meaning is
      undefined. Most "impossible" digital bugs are analog problems on a digital wire.

      | | Analog | Digital |
      |---|---|---|
      | Information is in | the exact voltage | which of two ranges |
      | Effect of small noise | corrupts the value | none |
      | Typical examples | thermistor divider, microphone, battery voltage | GPIO, UART, SPI, I2C |
      | MCU peripheral | ADC, DAC, comparator | GPIO, timers, serial peripherals |`,

      { t: 'predict', q: `A UART line idles high at 3.3 V and sends bytes as a stream of highs and lows. You measure it with a multimeter on the DC volts range while data is flowing continuously. What will the meter show?`,
        reveal: `Something between 0 and 3.3 V, steady or wandering slowly: perhaps 2 V. A multimeter averages over a fraction of a second, so it shows the DC component of the waveform, which depends on how much of the time the line is high. The individual bits, around 100 µs each at 9600 baud, are invisible to it. A multimeter answers "is there a supply voltage here?" and "is this line stuck?". To see a signal you need an oscilloscope or a logic analyser. A reading that is neither a clean high nor a clean low on a data line usually means "there is activity", not "there is a fault".` },

      `## Worked example: is the ripple acceptable?

      An unregulated supply uses a full-wave rectifier on 50 Hz mains and a 1000 µF capacitor. The load draws 100 mA. Peaks
      arrive every 10 ms.

      ΔV ≈ I × Δt / C = 0.1 A × 0.010 s / 0.001 F = **1.0 V** of ripple.

      If the peak is 12 V, the rail swings between about 11 V and 12 V, a hundred times a second. Feeding a 5 V regulator that
      needs at least 7 V in, that is fine. Feeding a 9 V regulator that needs 11 V in, there is no margin left.`,

      { t: 'exercise', prompt: `A small transformer is marked 12 V AC (RMS). What is the peak voltage of its output, before any diode drops?`,
        hints: [`RMS and peak of a sine are related by a fixed factor.`, `V peak = V rms × √2.`],
        solution: `12 × 1.414 = **17.0 V**. After a bridge rectifier (two diode drops, about 1.4 V) a capacitor charges to roughly 15.6 V at light load. A part rated for 16 V is uncomfortably close, and mains voltage itself varies by several percent. This is why a "12 V" unregulated supply can destroy a 12 V device.`,
        answer: { type: 'number', value: 16.97, tol: 0.2, unit: 'V' } },

      { t: 'exercise', prompt: `The load in the worked example grows to 400 mA and you want no more than 0.5 V of ripple. What minimum capacitance is needed, in microfarads? (Full-wave, 50 Hz.)`,
        hints: [`Rearrange ΔV = I × Δt / C for C.`, `C = I × Δt / ΔV with I in amps, Δt = 0.010 s, ΔV in volts gives farads.`],
        solution: `C = 0.4 × 0.010 / 0.5 = 0.008 F = **8000 µF**. You would fit the next standard value above, 10 000 µF. The four-times-larger current and half the allowed ripple cost eight times the capacitance. At this point a switching regulator, which tolerates large input ripple, is the better design.`,
        answer: { type: 'number', value: 8000, tol: 100, unit: 'µF' } },

      { t: 'callout', kind: 'mistake', md: `**Choosing an adapter by plug size and the big number on the label.** Check four things: AC or DC output; regulated or not; voltage; and polarity of the barrel (the small diagram showing whether the centre pin is positive). Then confirm with a meter before connecting anything you care about.` },

      `## Harder application: back to the drawer

      Use what you now know to classify the three adapters.

      - "9 V DC regulated", 9.0 V unloaded: a regulated supply. Safe for a 9 V input.
      - "9 V DC", 12.4 V unloaded: an unregulated supply. It will fall towards 9 V only at its rated load. A light load such as
        a microcontroller board will see 12 V or more. Safe only if the board's regulator accepts that and can shed the heat.
      - "9 V AC", about 0 V on the DC range: an AC output. Its average is zero, which is what the DC range shows. On the AC
        range it would read about 9 V. Connected to a DC-only board with no rectifier, it applies reverse voltage fifty times
        a second.`,

      { t: 'refs', items: [
        { title: 'Texas Instruments: Linear and Switching Voltage Regulator Fundamentals (SNVA558)', url: 'https://www.ti.com/lit/an/snva558/snva558.pdf', note: 'how unregulated input and ripple relate to regulator requirements' },
      ] },
    ],
    quiz: [
      { q: 'A supply is described as 5 V with 100 mV peak-to-peak ripple. Which statement is accurate?', kind: 'concept', choices: [
        { t: 'It is a DC supply whose voltage varies by 100 mV around its average', ok: true, why: 'Ripple is the AC component riding on a DC level. The polarity never reverses.' },
        { t: 'It is an AC supply because its voltage changes', why: 'AC means the polarity alternates around zero. A varying voltage that stays positive is still DC.' },
        { t: 'The voltage is 5 V half of the time and 0.1 V the rest', why: 'Peak-to-peak describes the size of the variation, not a second level the output switches to.' },
      ] },
      { q: 'Why can a digital link tolerate noise that would ruin an analog one?', kind: 'concept', choices: [
        { t: 'The receiver only decides which of two ranges the voltage is in, so small deviations are discarded', ok: true, why: 'Each receiver restores a clean level, so noise below the margin does not accumulate along a chain.' },
        { t: 'Digital signals are immune to interference because they use higher voltages', why: 'Digital and analog signals often share the same voltage range. The immunity comes from how the receiver interprets the voltage.' },
        { t: 'Digital wires carry no current, so noise cannot couple in', why: 'Digital lines carry current every time they change level, and noise couples into them just as it does into any wire.' },
      ] },
      { q: 'A 50 Hz full-wave supply has 2 V of ripple with a 470 µF capacitor. You change to 2200 µF with the same load. The ripple becomes about:', kind: 'circuit', choices: [
        { t: '0.43 V', ok: true, why: 'Ripple is inversely proportional to capacitance: 2 V × 470 / 2200.' },
        { t: '9.4 V', why: 'This scales the wrong way. A larger reservoir sags less between charging peaks.' },
        { t: '2 V, since ripple depends only on the load current', why: 'Load current is one factor. The capacitor size sets how far that current pulls the voltage down between peaks.' },
      ] },
      { q: 'A multimeter on DC volts shows 1.6 V on an SPI clock pin during a transfer. The most reasonable interpretation is:', kind: 'circuit', choices: [
        { t: 'The pin is toggling between 0 and 3.3 V and the meter shows the average', ok: true, why: 'A clock is high about half the time, and a meter averages far more slowly than the clock toggles.' },
        { t: 'The pin is faulty and stuck at an invalid level', why: 'A stuck level would persist when the bus is idle too. A mid-range average during activity is expected.' },
        { t: 'The supply rail has dropped to 1.6 V', why: 'The rail can be measured directly on a power pin. A reading on a signal pin says nothing certain about it.' },
      ] },
      { q: 'An unmarked adapter labelled "12 V DC 500 mA" reads 16.5 V with no load. What is it?', kind: 'concept', choices: [
        { t: 'An unregulated supply that reaches 12 V only near its rated load', ok: true, why: 'With little load, the reservoir capacitor stays near the transformer peak, well above the nominal figure.' },
        { t: 'A broken regulated supply', why: 'A regulated supply holds its nominal voltage at any load. A high unloaded reading is normal for an unregulated design.' },
        { t: 'An AC adapter mislabelled as DC', why: 'An AC output would average to about zero on the DC range of the meter, not to a steady positive voltage.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'elec-rc', title: 'Resistors and capacitors', minutes: 50,
    summary: 'Choosing a real resistor, what a capacitor stores, and the RC time constant behind delays, filters and debouncing.',
    skills: ['elec-resistor-select', 'elec-rc-timing'],
    blocks: [
      `## The problem

      Your calculation says 263 Ω. The parts drawer has 220, 270 and 330. A button connected to an interrupt pin fires the
      handler five times per press. A board resets at random until someone adds a small ceramic part next to the chip. All
      three are solved by knowing what real resistors and capacitors do.`,

      `## Resistors as components

      **Preferred values.** Resistors are made in series of values spaced by a constant ratio, so that each value plus or
      minus its tolerance just meets the next. **E12** has twelve values per decade for 10 % parts: 10, 12, 15, 18, 22, 27, 33,
      39, 47, 56, 68, 82. **E24** adds the values between for 5 %, and **E96** serves 1 %. You design to a calculated value,
      then pick the nearest preferred value in the *safe* direction: larger for a current-limiting resistor, for example.

      **Tolerance.** A 10 kΩ 5 % resistor is somewhere between 9.5 kΩ and 10.5 kΩ. For a pull-up that is irrelevant. For a
      divider feeding an ADC, two 5 % parts can put the ratio off by nearly 5 %, so use 1 % parts where a ratio sets a
      measurement.

      **Power rating.** The part must dissipate P = I² × R without overheating. Aim to stay below half the rating.

      **Reading the value.** Through-hole resistors use colour bands. Four-band: two digits, multiplier, tolerance. Five-band:
      three digits, multiplier, tolerance. The digits are black 0, brown 1, red 2, orange 3, yellow 4, green 5, blue 6,
      violet 7, grey 8, white 9. Gold as the last band means 5 %, brown 1 %. Surface-mount parts print digits directly:
      "103" means 10 followed by 3 zeros, 10 kΩ. When in doubt, measure with a multimeter before fitting. Brown, red and
      orange look alike under poor light.`,

      { t: 'widget', name: 'resistor-code', props: { mode: 'quiz' }, caption: 'Read the bands and give the value. Get five in a row before moving on.' },

      `## Capacitors

      A capacitor is two conductors separated by an insulator. Pushing charge onto one plate and off the other builds up a
      voltage between them. **Capacitance** (farads) is how much charge it holds per volt: Q = C × V.

      The relation that explains its behaviour in a circuit is

      **I = C × dV/dt**

      Read it two ways:

      - To change the voltage across a capacitor you must move charge, which takes current and time. **The voltage across a
        capacitor cannot jump.** A capacitor opposes sudden changes in voltage.
      - A capacitor passes current only while its voltage is changing. With steady DC across it, the current is zero: it looks
        like an open circuit. For fast changes it looks like a low impedance.

      Those two facts cover nearly every use: it smooths a supply (resists voltage change), it passes fast signals while
      blocking DC, and with a resistor it sets a time.`,

      `## The RC time constant

      Charge a capacitor through a resistor from a step of voltage V. At the start the capacitor has 0 V across it, so the full
      voltage is across R and the current is V / R. As the capacitor charges, less voltage is left across R, the current falls,
      and the charging slows. The result is an exponential:

      **Vc(t) = V × (1 − e^(−t / τ))**, with **τ = R × C**

      τ (tau) is the **time constant**, in seconds when R is in ohms and C in farads. Kilohms times microfarads gives
      milliseconds.

      | Time | Charged to |
      |---|---|
      | 1 τ | 63 % |
      | 2 τ | 86 % |
      | 3 τ | 95 % |
      | 5 τ | 99 % ("fully charged" for practical purposes) |

      Discharging follows the mirror image: Vc(t) = V × e^(−t / τ), reaching 37 % after one τ.

      To find when the voltage crosses a threshold Vth while charging: **t = −τ × ln(1 − Vth / V)**. For a threshold at half
      the supply this gives t = 0.69 τ.`,

      { t: 'predict', q: `A 10 kΩ resistor charges a 100 nF capacitor from 3.3 V. Roughly how long until the capacitor is "fully" charged?`,
        choices: [
          { t: 'About 1 ms', why: `That is one time constant. After one τ the capacitor has reached only 63 % of the final value.` },
          { t: 'About 5 ms', ok: true, why: `Yes. τ = 10 kΩ × 100 nF = 1 ms, and after five time constants it is within 1 % of the supply.` },
          { t: 'Instantly; 100 nF is tiny', why: `Small is relative. The resistor limits the charging current to 0.33 mA at most, and the charge still has to be delivered.` },
        ],
        reveal: `τ = R × C = 10 000 × 0.000 000 1 = 0.001 s. It reaches 63 % (2.08 V) at 1 ms and 99 % at 5 ms. Try it below, then change R or C by a factor of ten and predict the new curve before you look.` },

      { t: 'widget', name: 'rc-circuit', props: { r: 10000, c: 1e-7, mode: 'charge' }, caption: 'Step response of an RC circuit. Find the time at which the voltage crosses half the supply and compare it with 0.69 τ.' },

      `## On real hardware

      **Capacitor types you will meet**

      | Type | Typical range | Polarised? | Used for |
      |---|---|---|---|
      | Ceramic (MLCC) | 1 pF to about 100 µF | No | Decoupling, filtering, timing. Fast, low internal resistance |
      | Aluminium electrolytic | 1 µF to many mF | **Yes** | Bulk energy storage, low-frequency smoothing |
      | Tantalum / polymer | 1 µF to several hundred µF | **Yes** | Compact bulk capacitance |

      **Polarity.** An electrolytic capacitor has a positive and a negative lead. The negative side is marked with a stripe
      and the shorter lead. Fitted backwards, its insulating oxide layer breaks down, it conducts, heats, and can vent or burst.
      Tantalum parts fail more violently. Check polarity before applying power, every time.

      **Voltage rating.** Every capacitor has a maximum working voltage. Use a part rated comfortably above the highest voltage
      it will see: at least 25 % margin, and more for ceramics, whose real capacitance falls as the DC voltage across them
      approaches the rating (see the manufacturer's DC-bias curves).

      **Markings.** Small ceramics use a three-digit code in picofarads: "104" is 10 followed by 4 zeros pF = 100 000 pF =
      100 nF. "220" is 22 pF. Electrolytics print the value and voltage in full.

      **Decoupling versus bulk.** Two different jobs:

      - A **decoupling** (bypass) capacitor is a small ceramic, typically 100 nF, placed right at an IC's power pin. When the
        chip's logic switches it demands a burst of current within nanoseconds. The supply wiring has inductance and cannot
        deliver that quickly, so the local capacitor supplies it. Position matters more than value.
      - A **bulk** capacitor is a larger one (10 µF to hundreds of µF) that holds the rail up during slower, larger demands:
        a radio starting to transmit, a motor starting.

      Both are covered again in the power lesson, where you will size them.`,

      `## Worked example: debouncing a button

      A mechanical switch does not close once. Its contacts bounce for a few milliseconds, producing several rapid edges. A
      microcontroller is fast enough to see every one.

      Put a resistor in series from the switch node to the pin, and a capacitor from the pin to ground. The capacitor voltage
      cannot jump, so brief bounces only nudge it. The pin sees one slow edge.

      Choose τ longer than the bounce time but shorter than a human notices. With bounce lasting up to 5 ms:
      R = 10 kΩ, C = 1 µF gives τ = 10 ms. The pin crosses a mid-supply threshold about 7 ms after the contacts settle.`,

      { t: 'widget', name: 'rc-circuit', props: { r: 10000, c: 1e-6, mode: 'debounce' }, caption: 'A bouncing switch through an RC filter. Reduce C until the bounces come through, then find the smallest value that gives one clean edge.' },

      { t: 'callout', kind: 'mistake', md: `**Feeding a slow RC edge into an ordinary digital input and expecting one clean transition.** A slowly rising voltage lingers in the undefined region between the low and high thresholds, where noise can make an ordinary input toggle several times. Inputs with **Schmitt trigger** hysteresis (different thresholds for rising and falling) handle slow edges correctly. Check whether your MCU's GPIO inputs have hysteresis, or finish the job with a software debounce.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: hardware or software debounce?', md: `An RC filter costs two parts per button and fixes the signal for everything downstream, including interrupts and wake-from-sleep logic. Software debouncing (ignore further edges for 20 ms, or sample every few milliseconds and require agreement) costs no parts and is easy to tune, but the pin still sees the bounces, so an edge interrupt fires several times. Common practice: software for ordinary buttons; add the RC when the button must wake the processor or drive hardware directly.` },

      { t: 'exercise', prompt: `A reset circuit holds an enable pin low at power-up using a 10 kΩ resistor to 3.3 V and a 1 µF capacitor to ground. The chip treats the pin as high once it passes 75 % of the supply. How long after power is applied does that happen, in milliseconds?`,
        hints: [`First find τ = R × C.`, `Use t = −τ × ln(1 − fraction), where the fraction is 0.75.`, `ln(0.25) = −1.386.`],
        solution: `τ = 10 kΩ × 1 µF = 10 ms. t = −10 ms × ln(1 − 0.75) = 10 ms × 1.386 = **13.9 ms**. The delay gives the supply time to settle before the chip starts. The 75 % figure is an assumption for this exercise: take the real threshold from the chip's datasheet.`,
        answer: { type: 'number', value: 13.86, tol: 0.3, unit: 'ms' } },

      `## Harder application: a filter is the same circuit

      The series-R, C-to-ground arrangement is a **low-pass filter**. Slow changes pass; fast ones are attenuated. Its
      **cutoff frequency**, where the output has fallen to about 71 % of the input amplitude, is

      **fc = 1 / (2π × R × C)**`,

      { t: 'exercise', prompt: `A sensor signal changes at most a few times per second, but it carries 50 Hz hum. You add a low-pass filter with R = 16 kΩ and C = 1 µF before the ADC. What is its cutoff frequency in hertz?`,
        hints: [`fc = 1 / (2π × R × C), with R in ohms and C in farads.`, `R × C = 0.016 s.`],
        solution: `fc = 1 / (2π × 0.016) = **9.9 Hz**. A signal of a few hertz passes almost unchanged, while 50 Hz, five times above the cutoff, is reduced to roughly a fifth. The cost is delay: τ = 16 ms, so the output takes about 80 ms (5 τ) to settle after a step. Every filter trades noise rejection against response time.`,
        answer: { type: 'number', value: 9.95, tol: 0.3, unit: 'Hz' } },

      { t: 'refs', items: [
        { title: 'IEC 60063: Preferred number series for resistors and capacitors', url: 'https://webstore.iec.ch/en/publication/22025', note: 'the standard that defines E6 to E192' },
        { title: 'Murata: capacitor basics and DC-bias characteristics', url: 'https://www.murata.com/en-global/support/faqs/capacitor/ceramiccapacitor/char/0005', note: 'why a ceramic capacitor loses capacitance under DC voltage' },
        { title: 'Texas Instruments: Debounce a Switch (SCEA094)', url: 'https://www.ti.com/lit/ab/scea094/scea094.pdf', note: 'RC plus Schmitt-trigger debounce' },
      ] },
    ],
    quiz: [
      { q: 'A calculation for an LED series resistor gives 136 Ω as the minimum. From the E12 series you should fit:', kind: 'circuit', choices: [
        { t: '150 Ω', ok: true, why: 'For a current limit, round up: the next preferred value above the minimum keeps the current below the target.' },
        { t: '120 Ω', why: 'This is the next preferred value down. A value below the minimum lets more current flow than the design allows.' },
        { t: '136 Ω exactly, ordered specially', why: 'With a 5 % tolerance a nominal 136 Ω part could be lower than the minimum anyway. Preferred values exist to avoid this.' },
      ] },
      { q: 'A ceramic capacitor is marked 473. Its value is:', kind: 'concept', choices: [
        { t: '47 nF', ok: true, why: '47 followed by three zeros is 47 000 pF, which is 47 nF.' },
        { t: '473 pF', why: 'The third digit is a multiplier (the number of zeros), not a third significant digit.' },
        { t: '4.73 µF', why: 'The code counts in picofarads. 47 000 pF is far smaller than a microfarad.' },
      ] },
      { q: 'An RC circuit has R = 47 kΩ and C = 10 µF. Its time constant is:', kind: 'circuit', choices: [
        { t: '470 ms', ok: true, why: 'Kilohms times microfarads gives milliseconds: 47 × 10.' },
        { t: '4.7 ms', why: 'This is out by a factor of a hundred. Check the unit prefixes: k times µ leaves m.' },
        { t: '4.7 s', why: 'This treats the capacitor as 100 µF. Kilohms times microfarads gives milliseconds directly.' },
      ] },
      { q: 'What does a capacitor do to the voltage across it when the circuit tries to change that voltage abruptly?', kind: 'concept', choices: [
        { t: 'It holds the voltage momentarily and lets it change only as charge flows in or out', ok: true, why: 'Changing the voltage needs charge to move, and that takes current over time: I = C × dV/dt.' },
        { t: 'It blocks the change permanently', why: 'A capacitor delays a change. Given current and time, its voltage moves to any new value.' },
        { t: 'It lets the voltage jump but limits the current', why: 'Limiting current gradually is the behaviour of an inductor. A capacitor will supply or absorb a large current to resist a voltage jump.' },
      ] },
      { q: 'An electrolytic capacitor is fitted with its stripe towards the positive rail. What is the likely outcome?', kind: 'circuit', choices: [
        { t: 'It conducts, heats up and may vent or burst', ok: true, why: 'The stripe marks the negative lead. Reverse voltage destroys the oxide insulation, and the part becomes a heater.' },
        { t: 'It works normally with slightly less capacitance', why: 'Only non-polarised types such as ceramics are indifferent to direction. An electrolytic depends on correct polarity for its insulation.' },
        { t: 'Nothing; the stripe marks the positive lead', why: 'On aluminium electrolytics the stripe marks the negative lead. Some tantalum parts mark positive, which is why the datasheet matters.' },
      ] },
      { q: 'Why is a 100 nF capacitor placed within millimetres of a chip\'s power pin instead of anywhere convenient on the rail?', kind: 'concept', choices: [
        { t: 'The wiring between the capacitor and the pin has inductance that slows current delivery, so distance defeats its purpose', ok: true, why: 'The capacitor exists to supply nanosecond current bursts. Any extra track length in that path adds inductance exactly where speed is needed.' },
        { t: 'Capacitors lose their charge along long tracks', why: 'Track resistance does not drain a capacitor. The issue is how quickly current can be delivered, not how much charge is held.' },
        { t: 'It reduces the total capacitance required on the board', why: 'Placement does not change how much capacitance there is. It changes how useful that capacitance is for fast demands.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 5 */
  {
    id: 'elec-diodes', title: 'Inductors and diodes', minutes: 50,
    summary: 'Why a coil fights being switched off, how a diode steers current, and how to size the resistor for an LED.',
    skills: ['elec-led-resistor', 'elec-flyback'],
    blocks: [
      `## The problem

      A relay driven from a transistor works on the bench for a week. Then the microcontroller starts resetting whenever the
      relay releases, and one day the transistor is dead. No voltage in the design exceeds 5 V. Something in the circuit
      produced a great deal more than that.`,

      `## Inductors: inertia for current

      An inductor is a coil of wire. Current through it builds a magnetic field, and that field stores energy. The governing
      relation mirrors the capacitor's:

      **V = L × dI/dt**

      - To change the current through an inductor you must apply a voltage for a time. **The current through an inductor
        cannot jump.** An inductor opposes sudden changes in current.
      - With steady DC, dI/dt is zero, so there is no voltage across an ideal inductor: it looks like a wire.

      | | Capacitor | Inductor |
      |---|---|---|
      | Stores energy in | electric field | magnetic field |
      | Cannot change instantly | voltage across it | current through it |
      | Steady DC | open circuit | short circuit |
      | Relation | I = C × dV/dt | V = L × dI/dt |

      You do not need to fit a part labelled "inductor" to have one. Every relay coil, motor winding, solenoid and
      loudspeaker is an inductor, and every length of wire has a little inductance.

      ## Inductive kick

      Current is flowing through a relay coil. The transistor switches off and tries to reduce the current to zero in less
      than a microsecond. The inductor does not permit that. Rearranging the relation: the voltage across it becomes whatever
      is needed to keep the current flowing, V = L × dI/dt, and dI/dt is now huge and negative.

      The end of the coil connected to the transistor shoots up to tens or hundreds of volts, until something breaks down and
      provides a path: usually the transistor. This is **inductive kick**, or flyback.`,

      { t: 'exercise', prompt: `A relay coil of 100 mH carries 50 mA. A switch tries to stop that current in 1 µs. Using V = L × dI/dt, what voltage would the coil generate?`,
        hints: [`dI/dt is the change in current divided by the time: 0.05 A in 0.000 001 s.`, `Multiply by L = 0.1 H.`],
        solution: `dI/dt = 0.05 / 0.000 001 = 50 000 A/s. V = 0.1 × 50 000 = **5000 V**. In practice the voltage never gets that far: it rises until the transistor's breakdown voltage is reached (a few tens of volts for a small transistor) and then the transistor conducts in avalanche, absorbing the coil's energy as heat. Each release damages it a little.`,
        answer: { type: 'number', value: 5000, tol: 50, unit: 'V' } },

      `## Diodes

      A diode conducts in one direction. Its two terminals are the **anode** and the **cathode**; conventional current flows
      from anode to cathode. The schematic symbol's triangle points the way current can flow, and the bar is the cathode. On
      the part, a band marks the cathode.

      A diode is not a switch with zero resistance. When conducting it keeps a nearly constant **forward voltage** (Vf) across
      itself, almost regardless of current:

      | Diode | Typical Vf | Notes |
      |---|---|---|
      | Silicon signal or rectifier (1N4148, 1N400x families) | 0.6 to 0.7 V at low current, up to about 1 V at high current | General purpose |
      | Schottky | 0.2 to 0.45 V | Lower loss and very fast, but more reverse leakage |
      | LED, red | about 1.8 to 2.2 V | Vf rises with the energy of the colour |
      | LED, green (traditional) / yellow | about 2.0 to 2.4 V | |
      | LED, blue / white / "pure" green | about 2.8 to 3.4 V | |

      These are typical ranges. The datasheet for the specific part gives Vf at a stated current.

      Reverse-biased, a diode blocks, passing only a tiny leakage current, up to its **reverse breakdown voltage**. A **zener
      diode** is built to break down at a precise, low voltage (3.3 V, 5.1 V and so on) and survive it. Used backwards on
      purpose, with a series resistor, it clamps a node to that voltage. That makes it useful as a crude reference or to
      protect an input from over-voltage. It is not a substitute for a regulator when real current is needed.`,

      `## The flyback diode

      Put a diode across the coil, cathode to the positive supply, anode to the switched end. In normal operation it is
      reverse-biased and does nothing.

      When the transistor switches off, the coil pushes its switched end upward. As soon as that end rises one diode drop above
      the supply, the diode conducts. The coil current now has a path: round through the diode and back into the coil. It
      circulates and dies away as the coil's resistance turns the stored energy into heat. The transistor never sees more
      than the supply plus about 0.7 V.`,

      { t: 'figure', svg: figFlyback, caption: 'A flyback diode gives the coil current somewhere to go when the switch opens. The diode points "against" the supply: cathode to positive.' },

      { t: 'callout', kind: 'mistake', md: `**Fitting the flyback diode the other way round.** Anode to the supply makes the diode conduct whenever the transistor is on, shorting the supply through the transistor. The diode must be reverse-biased in normal operation. Say it aloud while building: "band to plus".` },

      `## LEDs and why they need a resistor

      An LED is a diode that emits light. Like any diode, once its forward voltage is reached, a small increase in voltage
      produces a very large increase in current: around the operating point, one or two tenths of a volt more can multiply
      the current several times over (the I–V curve in the LED's datasheet shows how steep). Compare a resistor, where 10 %
      more voltage gives exactly 10 % more current. A supply that is "about right" for a resistor is therefore either too low
      to light an LED or high enough to overdrive it, and the boundary moves with temperature and from part to part. There is
      no stable operating point if you simply apply a voltage. Something else must set the current, and the simplest
      something is a series resistor.

      Apply KVL round the loop: supply = resistor drop + LED drop. So the resistor has (V supply − Vf) across it, and by Ohm's
      law

      **R = (V supply − Vf) / I LED**

      ## Worked example

      A red LED with Vf = 2.0 V, driven from a 3.3 V GPIO at 5 mA (plenty for an indicator with a modern LED):

      R = (3.3 − 2.0) / 0.005 = 260 Ω. The next E12 value up is **270 Ω**, giving (3.3 − 2.0) / 270 = 4.8 mA.

      Then check three limits:

      - LED maximum continuous current (commonly 20 mA for a 5 mm indicator; check the datasheet). 4.8 mA is fine.
      - GPIO maximum source current, and the chip's total. Find both in the MCU datasheet.
      - Resistor power: 1.3 V × 4.8 mA = 6 mW. Trivial.`,

      { t: 'predict', q: `A red LED (Vf about 2.0 V) is connected directly between a 3.3 V GPIO and ground, with no resistor. It lights. What is limiting the current?`,
        reveal: `Only things you did not design: the internal resistance of the GPIO's output transistor (a few tens of ohms), the LED's own small series resistance, and the wiring. The pin's output voltage sags under the overload until the loop balances, often at several tens of milliamps. That may be above the pin's rated current and the LED's. It can appear to work for a long time while both parts are degraded. On a supply with more headroom, such as 5 V or a direct regulator output, the same mistake destroys the LED at once. "It lights" is not evidence that a circuit is correct.` },

      { t: 'widget', name: 'led-resistor', props: { challenge: 'gpio-3v3-red' }, caption: 'Choose a resistor that lights the LED clearly while staying within the pin limit. The task takes this LED\'s Vf as 1.8 V (the worked example used 2.0 V) and assumes a pin limit of 8 mA as a stand-in: the real limit for your chip is in its datasheet. Calculate first, then check.' },

      { t: 'widget', name: 'circuit-debug', props: { scenario: 'no-current-limit' }, caption: 'Find the fault with the virtual multimeter. Measure before you guess.' },

      { t: 'widget', name: 'circuit-debug', props: { scenario: 'led-reversed' }, caption: 'This LED will not light. Work out why from voltage readings alone.' },

      `## On real hardware

      - LED polarity: the longer lead is the anode; the flat on the rim and the larger internal plate mark the cathode. A
        multimeter's diode-test range lights most red and green LEDs dimly and shows Vf.
      - An LED can be wired from GPIO to ground (lit when the pin is high, "active high") or from the supply to the GPIO (lit
        when the pin is low, "active low"). Both are correct. Many development boards use active low; read the schematic.
      - **Reverse-polarity protection.** A Schottky diode in series with the supply input passes current only when the supply
        is the right way round. The cost is its forward drop, around 0.3 V, and its heat. For higher currents a P-channel
        MOSFET does the same job with far less loss.
      - Many development boards feed USB 5 V through a Schottky diode so that an external supply cannot push current back into
        the USB port. That is why the "5V" pin often measures about 4.7 V.`,

      { t: 'figure', svg: figReverseProtect, caption: 'Series Schottky diode for reverse-polarity protection. Connected backwards, the diode blocks and the circuit simply stays off.' },

      { t: 'callout', kind: 'decision', title: 'Design choice: which diode for flyback?', md: `For a small relay or motor, a 1N4148 (fast, low current) or a 1N400x rectifier (slower, 1 A) across the coil both work, because the diode only needs to carry the coil's own current briefly. For loads switched by PWM at kilohertz rates, use a Schottky or fast-recovery diode: an ordinary rectifier takes too long to stop conducting and wastes power on every cycle. The diode's reverse voltage rating must exceed the supply, and its current rating must cover the load current.` },

      `## Harder application: too little headroom

      A blue LED has a typical Vf of 3.0 V. Someone drives it from 3.3 V at 5 mA.`,

      { t: 'exercise', prompt: `The design uses R = (3.3 − 3.0) / 5 mA = 60 Ω. The LED actually fitted has Vf = 2.8 V, well within normal spread. What current flows, in milliamps?`,
        hints: [`The resistor is fixed at 60 Ω. Recalculate the voltage across it with the new Vf.`, `I = (3.3 − 2.8) / 60.`],
        solution: `I = 0.5 V / 60 Ω = **8.3 mA**, two thirds more than intended, from a 0.2 V difference between parts. With Vf = 3.2 V the current would be 1.7 mA, a third of the design value. When the supply is only slightly above Vf, the resistor has almost no voltage across it and cannot control the current: small variations in Vf, temperature or supply become large variations in brightness. Fixes: drive the LED from a higher rail through a transistor, or use a constant-current driver. As a rule, leave the resistor at least 1 V.`,
        answer: { type: 'number', value: 8.33, tol: 0.2, unit: 'mA' } },

      { t: 'refs', items: [
        { title: 'onsemi: 1N4148 / 1N914 small signal diode datasheet', url: 'https://www.onsemi.com/pdf/datasheet/1n914-d.pdf', note: 'forward voltage against current curves' },
        { title: 'Texas Instruments: Reverse Current/Battery Protection Circuits (SLVA139)', url: 'https://www.ti.com/lit/an/slva139/slva139.pdf', note: 'diode and MOSFET reverse-polarity protection compared' },
        { title: 'TE Connectivity: Coil Suppression Can Reduce Relay Life (application note 13C3264)', url: 'https://www.te.com/commerce/DocumentDelivery/DDEController?Action=srchrtrv&DocNm=13C3264_AppNote&DocType=CS&DocLang=EN', note: 'how flyback diodes affect relay release; URL not load-tested from this environment' },
      ] },
    ],
    quiz: [
      { q: 'Current is flowing in a motor winding when its switch opens. With no flyback diode, what happens at the switch?', kind: 'circuit', choices: [
        { t: 'The voltage across the switch rises far above the supply until something breaks down', ok: true, why: 'The winding forces its current to continue. With no path, the voltage rises until one is created through the switch itself.' },
        { t: 'The current stops instantly and the voltage falls to zero', why: 'An inductor cannot change its current instantly. Forcing it to try is exactly what generates the spike.' },
        { t: 'The voltage across the switch equals the supply and stays there', why: 'That would be true of a resistive load. A coil adds its own generated voltage on top of the supply.' },
      ] },
      { q: 'A flyback diode across a relay coil fed from +12 V must be fitted with:', kind: 'circuit', choices: [
        { t: 'Cathode to +12 V, anode to the transistor side of the coil', ok: true, why: 'It is reverse-biased while the relay is on, and conducts only when the switched end rises above the supply.' },
        { t: 'Anode to +12 V, cathode to the transistor side of the coil', why: 'This orientation conducts whenever the transistor is on, placing a forward-biased diode straight across the supply.' },
        { t: 'Either way; diodes across coils are not polarity sensitive', why: 'A diode conducts in one direction only. One orientation protects and the other shorts the supply.' },
      ] },
      { q: 'A green LED with Vf = 2.2 V is to run at 10 mA from 5 V. The series resistor should be about:', kind: 'circuit', choices: [
        { t: '280 Ω (fit 330 Ω, or 270 Ω if slightly more current is acceptable)', ok: true, why: 'The resistor sees 5 − 2.2 = 2.8 V, and 2.8 V / 10 mA = 280 Ω.' },
        { t: '500 Ω', why: 'This uses the whole supply voltage. The LED takes its forward voltage first; the resistor only gets the remainder.' },
        { t: '220 Ω', why: 'This divides the forward voltage by the current. The resistor value comes from the voltage across the resistor, not across the LED.' },
      ] },
      { q: 'Why can you not set LED brightness by choosing a supply voltage equal to its forward voltage and omitting the resistor?', kind: 'concept', choices: [
        { t: 'Near Vf a tiny change in voltage or temperature causes a large change in current, so there is no stable operating point', ok: true, why: 'The diode curve is very steep. Something with a gentler voltage-to-current relation must be in series to set the current.' },
        { t: 'LEDs need AC to emit light', why: 'LEDs emit on steady forward current. They are DC devices.' },
        { t: 'The LED would not light at exactly Vf', why: 'It would conduct, but the current would be uncontrolled and would drift with temperature and from part to part.' },
      ] },
      { q: 'A board is protected with a series Schottky diode that drops 0.3 V and carries 800 mA. How much power does the diode dissipate?', kind: 'circuit', choices: [
        { t: '0.24 W', ok: true, why: 'P = V × I = 0.3 V × 0.8 A. That is enough to warm a small surface-mount diode noticeably.' },
        { t: '2.67 W', why: 'This divides current by voltage. Power is the product of the voltage across the part and the current through it.' },
        { t: 'Nothing, because a conducting diode has no resistance', why: 'A conducting diode keeps its forward voltage across it, and voltage times current is dissipated as heat.' },
      ] },
      { q: 'A zener diode rated 3.3 V is placed from an input pin to ground, cathode to the pin, with a series resistor before it. What is it for?', kind: 'concept', choices: [
        { t: 'Clamping the pin to about 3.3 V if the incoming voltage goes higher', ok: true, why: 'Reverse-connected, the zener breaks down at its rated voltage and the series resistor absorbs the excess.' },
        { t: 'Blocking current from flowing into the pin', why: 'A diode from pin to ground is in parallel with the pin, so it cannot block anything in series.' },
        { t: 'Regulating the supply for the whole board', why: 'A zener and resistor waste power and regulate poorly under varying load. They suit signals and references, not supplies.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 6 */
  {
    id: 'elec-transistors', title: 'Transistors and MOSFETs as switches', minutes: 55,
    summary: 'Using a small current or voltage from a GPIO to control a load the pin could never drive.',
    skills: ['elec-transistor-switch', 'elec-flyback'],
    blocks: [
      `## The problem

      A GPIO can supply a few milliamps at 3.3 V. A small motor wants 300 mA at 6 V, a relay coil 70 mA at 5 V, an LED strip
      2 A at 12 V. The pin can supply neither the current nor the voltage. You need a part that lets the pin *control* the
      current without *carrying* it.`,

      `## The switch model

      Used as a switch, a transistor has two states:

      - **off**: no current flows through the load path; the full supply voltage appears across the transistor
      - **fully on**: the transistor looks like a closed contact with a very small voltage across it; almost the full supply
        appears across the load

      In both states the transistor dissipates little power: off, the current is zero; on, the voltage is near zero. The
      danger is in between. A half-on transistor has substantial voltage *and* current, and gets hot. The design task is to
      guarantee "fully on".

      ## Low-side switching

      The usual arrangement puts the transistor between the load and ground: the load's other end is tied to its supply. This
      is **low-side** switching. The control signal is referenced to ground, the same ground as the microcontroller, so a
      3.3 V GPIO can switch a 12 V or 24 V load. The load supply and the logic supply may be different voltages. Their grounds
      must be connected.`,

      `## The BJT (NPN) switch

      A bipolar junction transistor has a **base**, **collector** and **emitter**. A small current into the base allows a
      larger current to flow from collector to emitter. The ratio is the current gain, hFE (or β), typically 100 to 300 for a
      small-signal part but strongly dependent on current and temperature.

      The base-emitter junction is a diode: it drops about 0.7 V when conducting. So the base needs a **series resistor** to
      set the base current, for the same reason an LED needs one.

      To use the BJT as a switch you drive it into **saturation**: you supply more base current than the gain would require,
      so the collector voltage falls as low as it can, VCE(sat), typically 0.1 to 0.3 V. Datasheets specify VCE(sat) at a
      forced ratio of IC / IB = 10. Designing for a ratio of 10 to 20 guarantees saturation whatever the gain of the
      individual part.

      **Base resistor calculation**

      1. Load current IC (from the load's datasheet or Ohm's law).
      2. Base current IB = IC / 10 (strong saturation) to IC / 20.
      3. RB = (V GPIO − VBE) / IB, with VBE ≈ 0.7 V.
      4. Check that IB is within the GPIO's current limit.`,

      { t: 'figure', svg: figNpn, caption: 'NPN low-side switch. The base resistor sets IB; the collector carries the load current IC. The diode is there because the load is a coil.' },

      `### Worked example

      A 5 V relay with a 70 Ω coil, driven from a 3.3 V GPIO with a general-purpose NPN transistor.

      - IC = 5 V / 70 Ω ≈ 71 mA
      - IB = IC / 20 ≈ 3.6 mA
      - RB = (3.3 − 0.7) / 3.6 mA = 722 Ω. Fit **680 Ω**, giving IB = 3.8 mA.
      - GPIO check: 3.8 mA is modest for most microcontrollers, but confirm against the datasheet.
      - Transistor check: IC must be below the part's maximum collector current with margin, and the collector must withstand
        the supply voltage.
      - Flyback diode across the coil: required.`,

      { t: 'widget', name: 'transistor-switch', props: { type: 'npn' }, caption: 'Vary the base resistor. Watch for the point where the transistor leaves saturation and starts to heat.' },

      { t: 'exercise', prompt: `An NPN transistor must switch a 200 mA load from a 3.3 V GPIO. Using a forced ratio IC / IB = 20 and VBE = 0.7 V, what base resistor does the calculation give, in ohms?`,
        hints: [`Base current first: IB = 200 mA / 20.`, `The resistor has the GPIO voltage minus VBE across it.`],
        solution: `IB = 10 mA. RB = (3.3 − 0.7) V / 10 mA = **260 Ω**; fit 270 Ω (IB = 9.6 mA) or 220 Ω. Now the important check: 10 mA from one GPIO may be more than you want to take, and may approach the pin's rating on some microcontrollers. This is where a BJT starts to be the wrong tool. A MOSFET needs no steady drive current at all.`,
        answer: { type: 'number', value: 260, tol: 6, unit: 'Ω' } },

      `## The MOSFET switch

      An N-channel MOSFET has a **gate**, **drain** and **source**. The gate is insulated from the rest of the device: it is
      one plate of a small capacitor. A *voltage* between gate and source (VGS) creates a conducting channel between drain and
      source. No steady gate current flows. Once on, the channel behaves as a small resistance, **RDS(on)**.

      Low-side connection: source to ground, drain to the load, gate to the GPIO.

      ### Threshold voltage is not the turn-on voltage

      This is the single most common MOSFET selection error. The datasheet lists **VGS(th)**, the gate threshold voltage. It
      is defined as the gate voltage at which the device *just begins* to conduct: typically 250 µA or 1 mA of drain current.
      It is the point where the MOSFET stops being off. It says nothing about how well it conducts amps.

      What tells you whether the MOSFET is fully on is the **RDS(on)** line of the datasheet, which is always given *at a
      stated VGS*. For a 3.3 V GPIO you need a part whose RDS(on) is specified at a gate voltage you can actually supply:
      VGS = 2.5 V, or lower. Parts described as "logic level" are often specified only at 4.5 V or 5 V: logic level for 5 V
      logic, not for 3.3 V.

      | Datasheet says | Means for a 3.3 V GPIO |
      |---|---|
      | VGS(th) = 1 to 2.5 V; RDS(on) given at 10 V only | Not suitable. Will be partly on, resistive and hot |
      | RDS(on) given at 4.5 V and 10 V | Marginal to unsuitable. No guarantee at 3.3 V |
      | RDS(on) given at 2.5 V (and often 1.8 V) | Suitable. Use the 2.5 V figure for your loss calculation |

      Power lost in a conducting MOSFET is **P = I² × RDS(on)**.`,

      { t: 'predict', q: `A MOSFET datasheet lists VGS(th) max = 2.5 V and RDS(on) = 0.05 Ω at VGS = 10 V. You drive its gate from a 3.3 V GPIO to switch a 2 A load. What do you expect?`,
        choices: [
          { t: 'It works: 3.3 V is above the 2.5 V threshold, so it is on', why: `Above threshold means "no longer off". At that point the datasheet promises only a fraction of a milliamp, not 2 A.` },
          { t: 'It conducts poorly: channel resistance far above 0.05 Ω, load under-powered, MOSFET hot', ok: true, why: `Yes. The 0.05 Ω figure is only promised at 10 V on the gate. At 3.3 V the device is barely past threshold.` },
          { t: 'It does not conduct at all', why: `The gate is above threshold, so some current flows. The problem is that the channel is nowhere near fully formed.` },
        ],
        reveal: `With only 0.8 V of drive beyond a worst-case threshold, the channel resistance might be several ohms and varies widely between individual parts. At 2 A, even 1 Ω means 4 W in a small package. The MOSFET overheats and the load sees a reduced voltage. The fix is a part with RDS(on) specified at VGS = 2.5 V, or a gate driver that provides a higher gate voltage.` },

      `### The other two resistors

      **Gate pull-down (10 kΩ to 100 kΩ, gate to ground).** While the microcontroller is in reset, booting, or being
      programmed, most of its pins are high-impedance inputs (the datasheet lists each pin's state at reset). A MOSFET gate connected to nothing holds whatever stray charge reaches
      it. The motor may run, or the MOSFET may sit half-on and overheat. The pull-down guarantees "off" until the firmware
      takes control. Do not rely on the internal pull-down of the MCU pin: it is not active before the firmware configures it.

      **Gate series resistor (about 100 Ω, GPIO to gate).** The gate is a capacitor. Charging it draws a brief current spike
      from the pin, and the gate capacitance together with wiring inductance can ring. A small series resistor limits the
      spike and damps the ringing. It slows the switching slightly, which only matters for fast PWM.`,

      { t: 'figure', svg: figLowSide, caption: 'Complete low-side MOSFET switch. Rg limits the gate charging current, Rpd holds the gate low while the GPIO is not driven, and the diode handles the inductive kick from the motor.' },

      { t: 'widget', name: 'transistor-switch', props: { type: 'nmos', challenge: 'motor' }, caption: 'Make the motor run from a 3.3 V GPIO without overheating the transistor or leaving it unprotected.' },

      { t: 'callout', kind: 'mistake', md: `**Choosing a MOSFET by its threshold voltage, or by the phrase "logic level" on a shop page.** Read the RDS(on) row of the datasheet and find the lowest VGS at which it is specified. If that voltage is higher than your GPIO's guaranteed high output, the part is not specified for your design, whatever works on the bench with one sample.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: BJT or MOSFET?', md: `**BJT:** cheap, predictable turn-on at 0.7 V so it works from any logic voltage, but needs continuous base current (IC / 10 to IC / 20) and drops 0.1 to 0.3 V. Good up to a few hundred milliamps. **MOSFET:** no steady drive current, very low loss at high currents, but must be chosen for the gate voltage available, and the gate needs a pull-down. Prefer a suitable MOSFET above about 100 mA or wherever battery life matters; a BJT is fine for a small relay or a buzzer.` },

      `## High-side switching

      Sometimes the load must stay connected to ground and the *supply* side is switched: for example, to cut power to a
      sensor whose signal pins would otherwise be back-fed, or where the load's case is grounded.

      An N-channel MOSFET is awkward here. Its source would be at the load voltage, so to keep VGS positive the gate would
      have to be driven *above* the supply. The usual answer is a **P-channel MOSFET**: source to the supply, drain to the
      load. It turns on when its gate is pulled *below* its source.

      - If the switched supply equals the logic supply (3.3 V), a GPIO can drive the P-MOSFET gate directly: low is on, high is
        off, with a pull-up from gate to source so it defaults to off.
      - If the switched supply is higher than the logic supply (12 V), a GPIO high of 3.3 V still leaves the gate 8.7 V below
        the source and the P-MOSFET stays on. A small NPN or N-MOSFET is added to pull the gate down, with a pull-up to the
        12 V rail to turn it off. Check the P-MOSFET's maximum VGS.

      | | Low-side (N-channel) | High-side (P-channel) |
      |---|---|---|
      | Drive from 3.3 V logic | Direct | Direct only if switching the logic rail itself |
      | Load when off | Still connected to its supply; floats near supply voltage | Fully disconnected from supply, sits at ground |
      | Ground of the load | Lifted slightly by the switch drop | Solid |
      | Use when | Motors, relays, LED strips, most loads | Powering down modules and sensors, grounded loads |`,

      `## Harder application`,

      { t: 'exercise', prompt: `A MOSFET with RDS(on) = 0.045 Ω at VGS = 2.5 V switches a 12 V LED strip drawing 3 A, driven from a 3.3 V GPIO. How much power does the MOSFET dissipate when on, in watts?`,
        hints: [`The MOSFET looks like a resistor of RDS(on). Which power formula uses current and resistance?`, `P = I² × R.`],
        solution: `P = 3² × 0.045 = **0.405 W**. The voltage lost is 3 A × 0.045 Ω = 0.135 V, about 1 % of the supply. Whether 0.4 W is acceptable depends on the package: use the junction-to-ambient thermal resistance from the datasheet to estimate the temperature rise (rise = P × θJA). In a small SOT-23 package this could be a rise of the order of 100 °C, which is too much; a larger package or a lower-resistance part is needed. RDS(on) also increases as the part heats, so leave margin.`,
        answer: { type: 'number', value: 0.405, tol: 0.01, unit: 'W' } },

      { t: 'refs', items: [
        { title: 'Infineon: MOSFET basics application note (AN_201611_PL11_010, "Datasheet explanation")', url: 'https://www.infineon.com/dgdl/Infineon-MOSFET_OptiMOS_datasheet_explanation-AN-v01_00-EN.pdf?fileId=db3a30433b47825b013b6b8c6a3424c4', note: 'how to read VGS(th), RDS(on) and the transfer curves; URL not load-tested from this environment' },
        { title: 'onsemi: 2N3904 general purpose NPN datasheet', url: 'https://www.onsemi.com/pdf/datasheet/2n3903-d.pdf', note: 'see VCE(sat) specified at IC/IB = 10' },
        { title: 'Texas Instruments: Understanding MOSFET data sheets (SLYT664 series)', url: 'https://www.ti.com/lit/an/slyt664/slyt664.pdf', note: 'what the datasheet numbers do and do not guarantee' },
      ] },
    ],
    quiz: [
      { q: 'Why is a transistor used as a switch designed to be either fully on or fully off, never in between?', kind: 'concept', choices: [
        { t: 'In between, it has both significant voltage across it and current through it, so it dissipates the most heat', ok: true, why: 'Power is voltage times current. Off, the current is zero; fully on, the voltage is near zero. Halfway, neither is.' },
        { t: 'A transistor cannot physically operate in between', why: 'It can, and amplifiers rely on it. The intermediate region is avoided in switches because of the heat it produces.' },
        { t: 'The load would receive AC instead of DC', why: 'A partly on transistor passes a reduced DC current. Nothing about it creates an alternating voltage.' },
      ] },
      { q: 'A 3.3 V GPIO drives an NPN base through 1 kΩ. Roughly what base current flows?', kind: 'circuit', choices: [
        { t: '2.6 mA', ok: true, why: 'The base-emitter junction takes about 0.7 V, leaving 2.6 V across the 1 kΩ resistor.' },
        { t: '3.3 mA', why: 'This ignores the base-emitter drop. The junction behaves as a diode and takes its forward voltage first.' },
        { t: '0.7 mA', why: 'This puts the junction voltage across the resistor. The resistor gets what remains after the junction drop.' },
      ] },
      { q: 'Two MOSFETs are candidates for a 3.3 V GPIO. Part A: VGS(th) 0.5–1.0 V, RDS(on) specified at 2.5 V and 4.5 V. Part B: VGS(th) 1–2 V, RDS(on) specified at 4.5 V and 10 V. Choose:', kind: 'circuit', choices: [
        { t: 'Part A, because its on-resistance is guaranteed at a gate voltage the GPIO can supply', ok: true, why: 'The RDS(on) specification at 2.5 V is the manufacturer\'s statement that the part is fully on at that drive.' },
        { t: 'Part B, because 3.3 V is above its 2 V maximum threshold', why: 'Clearing the threshold only guarantees microamps to a milliamp of drain current. Its conduction at 3.3 V is not specified.' },
        { t: 'Either, since both thresholds are below 3.3 V', why: 'Threshold marks where conduction begins, not where the channel reaches its low rated resistance.' },
      ] },
      { q: 'What is the gate pull-down resistor on a low-side MOSFET for?', kind: 'circuit', choices: [
        { t: 'Keeping the MOSFET off while the GPIO is high-impedance during reset and boot', ok: true, why: 'An undriven gate holds stray charge. The resistor gives it a defined off level until firmware drives the pin.' },
        { t: 'Limiting the current through the load', why: 'The load current flows from drain to source. A resistor from gate to ground is not in that path.' },
        { t: 'Protecting the MOSFET from inductive kick', why: 'Inductive kick appears at the drain and is handled by a diode across the load, not by anything on the gate.' },
      ] },
      { q: 'A 12 V fan is low-side switched by an N-MOSFET from an ESP32-class board powered by USB. The fan has its own 12 V supply. Which connection is essential?', kind: 'circuit', choices: [
        { t: 'The 12 V supply ground joined to the board ground', ok: true, why: 'The gate voltage is measured relative to the source, which is on the 12 V supply ground. Without a shared ground the gate has no reference.' },
        { t: 'The 12 V positive joined to the board 5 V pin', why: 'Joining different supply rails forces 12 V onto 5 V parts and destroys them. Only the grounds are common.' },
        { t: 'No connection between the supplies; they must stay isolated', why: 'With no common reference, the GPIO voltage means nothing to the MOSFET and the gate floats relative to the source.' },
      ] },
      { q: 'You need to cut power to a 3.3 V sensor module from a 3.3 V MCU so it draws nothing in sleep. Which switch suits best?', kind: 'arch', choices: [
        { t: 'A P-channel MOSFET in the sensor supply line, gate driven by a GPIO with a pull-up to 3.3 V', ok: true, why: 'High-side switching removes the supply while keeping the sensor ground solid, and a P-MOSFET on the logic rail can be driven directly.' },
        { t: 'An N-channel MOSFET in the sensor supply line, gate driven by the GPIO', why: 'With its source at the load, an N-MOSFET needs a gate voltage above the rail to stay on, which a GPIO on the same rail cannot give.' },
        { t: 'An N-channel MOSFET in the sensor ground line', why: 'Lifting the ground leaves the sensor tied to 3.3 V, and its signal pins can then be back-fed through their protection diodes.' },
      ] },
    ],
  },
];
