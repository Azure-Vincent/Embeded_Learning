// Electronics lessons 7-13: pull-ups, logic levels, ADC/DAC, PWM, breadboards, power, grounding and faults.
import { figButtonPullup, figOpenDrain, figLogicLevels, figLevelShifter, figAdcInput, figServo, figSymbols, figBreadboard, figLdo, figCommonGround } from './figures.js';

export default [
  /* ------------------------------------------------------------------ 7 */
  {
    id: 'elec-pullups', title: 'Pull-up and pull-down resistors', minutes: 40,
    summary: 'Why an unconnected input reads garbage, and how one resistor gives every wire a defined level.',
    skills: ['elec-pullup'],
    blocks: [
      `## The problem

      A button is wired from a GPIO to ground. The firmware reads the pin. With the button pressed it reads 0, as expected.
      With the button released it reads 0, then 1, then 0, and changes when you wave a hand near the wire. The code is three
      lines long and correct.`,

      `## Floating inputs

      A CMOS input is the gate of a pair of MOSFETs: an insulated plate with a capacitance of a few picofarads and a leakage
      current measured in nanoamps. It draws essentially nothing, which is what makes it a good input.

      It also means that when nothing drives the pin, nothing sets its voltage. The few picofarads hold whatever charge they
      last had, and any nearby electric field (mains wiring, a finger, the adjacent pin toggling) moves that charge about.
      The pin **floats**. Reading it returns noise.

      Put numbers on it (illustrative values; your chip's are in its datasheet). Take a pin capacitance of 5 pF and a stray
      current of 10 nA from leakage or coupling. From I = C × dV/dt, the pin voltage moves at
      10 nA / 5 pF = 2000 V/s: two volts every millisecond, enough to cross from a 0 to a 1 between two reads. Now add a
      10 kΩ pull-up. The same 10 nA flowing through 10 kΩ shifts the pin by 10 nA × 10 kΩ = 0.1 mV. The stray current has not
      gone away; it has been given an easy path, and the pin stays within a fraction of a millivolt of the rail.

      A floating input has a second cost. When its voltage drifts into the region between low and high, both transistors of
      the input stage conduct partially at once and the pin draws extra supply current. On a battery device, floating pins
      can dominate the sleep current.

      Rule: **every input must be driven to a defined level at all times**, by a device output or by a resistor.`,

      `## Pull-up and pull-down

      A **pull-up** is a resistor from the signal to the positive rail. A **pull-down** is a resistor from the signal to
      ground. Each provides a *weak* default: weak enough that a switch or an output can easily override it, strong enough to
      beat leakage and noise.

      With a pull-up and a button to ground:

      - released: no current flows through the resistor (the input draws none), so there is no voltage across it and the pin
        sits at the rail: logic 1
      - pressed: the button connects the pin to ground: logic 0. Current V / R flows through the resistor for as long as the
        button is held

      The logic is inverted: pressed reads 0. This "active low" arrangement is the common one, and firmware handles it.`,

      { t: 'figure', svg: figButtonPullup, caption: 'Button with pull-up. The resistor defines the released level; the button overrides it.' },

      `## Choosing a value

      The resistor is a compromise between two things.

      **Too small** wastes current whenever the line is pulled the other way, and can exceed what the driving device can sink.
      A 100 Ω pull-up on 3.3 V draws 33 mA every time the button is pressed.

      **Too large** makes the line weak: leakage currents create a significant voltage across it, noise couples in easily, and
      with the capacitance of the wire it forms a slow RC, so the rising edge takes too long.

      | Use | Typical value | Why |
      |---|---|---|
      | Button, configuration jumper | 10 kΩ (4.7 kΩ to 100 kΩ) | 0.33 mA when pressed at 3.3 V; fast enough for a human |
      | Battery device, rarely pressed input | 100 kΩ to 1 MΩ | Minimises current; needs short wiring |
      | I2C bus | 2.2 kΩ to 10 kΩ | Must charge the bus capacitance within the rise-time limit |
      | MOSFET gate default | 10 kΩ to 100 kΩ | Only has to beat leakage |
      | Reset or enable pin | Value from the chip's datasheet or reference design | Often part of a required RC |`,

      `## Internal or external?

      Most microcontrollers can connect an internal pull-up or pull-down to a pin under software control. They are convenient
      and cost nothing, with three limits:

      - They are **weak and imprecise**: tens of kilohms, with a wide tolerance. The value and its range are in the
        datasheet's DC characteristics (the ESP32 datasheet v5.3, Table 5-3, gives 45 kΩ typical for both pull-up and
        pull-down).
      - They do not exist until your firmware enables them. During reset and boot the pin floats. For anything that must be in
        a safe state from power-on (a MOSFET gate, a chip-select, a motor-enable), fit an external resistor.
      - Not every pin has them. On the original ESP32, GPIO34 to GPIO39 are input-only and have no internal pull-up or
        pull-down, so they always need an external one.

      Some pins have a further constraint: **strapping pins** are sampled at reset to select the boot mode. An external
      pull-up or pull-down on a strapping pin can stop the chip booting. On the original ESP32 these are GPIO0, GPIO2, GPIO5,
      GPIO12 and GPIO15; other chips differ, so check the datasheet for yours.`,

      { t: 'widget', name: 'gpio-electrical', caption: 'One GPIO pin. Set it to input and leave it floating, then add an internal pull-up, then a pull-down. Switch it to an open-drain output and see what is needed to produce a high level.' },

      { t: 'predict', q: `A pin is configured as an input with a 10 kΩ pull-up to 3.3 V. You also connect a 10 kΩ pull-down from the same pin to ground "to be safe". What does the pin read?`,
        choices: [
          { t: 'A solid 1, the pull-up wins', why: `Neither resistor is stronger than the other. They carry the same current and share the voltage.` },
          { t: 'A solid 0, the pull-down wins', why: `Neither resistor is stronger than the other. They carry the same current and share the voltage.` },
          { t: 'About 1.65 V: an undefined level', ok: true, why: `Yes. Two equal resistors from rail to ground form a divider, and its midpoint is in the forbidden zone between low and high.` },
        ],
        reveal: `You have built a voltage divider that holds the pin at half the supply, the worst possible place: neither a valid low nor a valid high, and the point where the input stage draws most current. This happens by accident more often than you would think: an internal pull-down enabled in firmware against an external pull-up, or a module with its own pull-up connected to a board that also has one pulling the other way.` },

      { t: 'widget', name: 'circuit-debug', props: { scenario: 'floating-input' }, caption: 'A button input that misbehaves. Find out why with the multimeter and fix it.' },

      { t: 'widget', name: 'breadboard', props: { challenge: 'button-pullup' }, caption: 'Wire a button on the virtual breadboard so that the input reads 1 when released and 0 when pressed. This task uses the pin\'s internal pull-up (about 45 kΩ in this model), so you set the pin mode instead of fitting a resistor. Try "Input (no pull)" first and see what the simulator says about the released level.' },

      `## Open-drain outputs and shared buses

      A normal **push-pull** output has two transistors: one connects the pin to the supply for a 1, the other to ground for
      a 0. If two push-pull outputs are joined and disagree, one drives high while the other drives low: a short circuit from
      supply to ground through both.

      An **open-drain** output has only the lower transistor. It can pull the line low, or let go. It never drives high. A
      single pull-up resistor on the wire supplies the high level.

      Now any number of devices can share the wire safely:

      - if every device lets go, the resistor pulls the line high
      - if any device pulls low, the line is low

      Nobody ever fights. This "wired-AND" behaviour is why I2C, 1-Wire, and shared interrupt and reset lines are open-drain.
      It is also the mechanism behind I2C clock stretching and bus arbitration, which the protocols section builds on.`,

      { t: 'figure', svg: figOpenDrain, caption: 'An open-drain bus. The pull-up is the only thing that ever makes the line high.' },

      `## Worked example: sizing I2C pull-ups

      The pull-up on an open-drain bus has a lower and an upper limit.

      **Lower limit: the weakest driver must be able to pull the line to a valid low.** The I2C specification requires a
      device to sink 3 mA while holding the line below 0.4 V (standard and fast modes). At 3.3 V:

      R min = (3.3 − 0.4) V / 3 mA ≈ **970 Ω**

      **Upper limit: the line must rise fast enough.** When all devices let go, the resistor charges the bus capacitance (pins,
      tracks, wires): an RC. The specification gives the time to rise from 30 % to 70 % of the supply as t = 0.8473 × R × C,
      and limits it to 1000 ns in standard mode (100 kHz) and 300 ns in fast mode (400 kHz).

      For fast mode with 100 pF of bus capacitance:

      R max = 300 ns / (0.8473 × 100 pF) ≈ **3.5 kΩ**

      So any value between about 1 kΩ and 3.5 kΩ works; 2.2 kΩ is a sound choice. Long jumper wires add capacitance and push
      R max down.`,

      { t: 'exercise', prompt: `An I2C bus runs in standard mode (rise time limit 1000 ns) on a breadboard with long wires, giving about 200 pF of bus capacitance. What is the largest pull-up resistance that still meets the rise time, in ohms?`,
        hints: [`Which limit is this: the one set by how much current a device can sink, or the one set by how fast the resistor can charge the bus capacitance? Only one of them gets worse as R grows.`, `Rise time (30 % to 70 %) = 0.8473 × R × C. Set it equal to the limit and solve for R.`, `R max = t / (0.8473 × C), with t = 0.000 001 s and C = 0.000 000 000 2 F.`],
        solution: `R max = 1000 ns / (0.8473 × 200 pF) = **5.9 kΩ**. The common 4.7 kΩ meets it; 10 kΩ does not, even though 10 kΩ pull-ups are fitted to many breakout boards. A marginal rise time shows up as occasional NACKs and corrupted bytes that vanish when you shorten the wires or lower the clock speed.`,
        answer: { type: 'number', value: 5900, tol: 120, unit: 'Ω' } },

      { t: 'callout', kind: 'mistake', md: `**Stacking pull-ups without noticing.** Most I2C breakout boards carry their own pull-ups. Three boards with 4.7 kΩ each on one bus put the resistors in parallel: about 1.6 kΩ. Five boards give under 1 kΩ, below the minimum, and a weak device can no longer pull the line to a valid low. Count the pull-ups on a bus and compute the parallel value.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: pull-up or pull-down for a button?', md: `Either gives a defined level. Pull-up with a switch to ground is the convention because: internal pull-ups are more commonly available than pull-downs; routing a ground wire to a remote switch is safer than routing the supply (a damaged wire shorts ground to ground, not supply to ground); and open-drain logic already works this way. Use a pull-down when the default must be low for hardware reasons: a MOSFET gate, or an enable pin that must stay inactive at power-up.` },

      `## Harder application

      A battery-powered door sensor uses a reed switch that is **closed** for as long as the door is shut, which is nearly
      always. The input has a 10 kΩ pull-up to 3.3 V and the switch connects it to ground.`,

      { t: 'exercise', prompt: `How much current does the 10 kΩ pull-up waste while the door is shut, in microamps? Then decide what you would change if the rest of the device sleeps at 10 µA.`,
        hints: [`With the switch closed, the full supply is across the pull-up.`, `I = 3.3 V / 10 kΩ. Convert to microamps.`],
        solution: `I = 3.3 / 10 000 = **330 µA**, thirty-three times the sleep current of everything else. Options: raise the pull-up to 1 MΩ (3.3 µA; acceptable if wiring is short and the pin's leakage is small compared with that); use a switch that is open in the normal state; or power the pull-up from a GPIO and enable it only for the few microseconds needed to sample the switch, which reduces the average to almost nothing at the cost of not getting an edge interrupt.`,
        answer: { type: 'number', value: 330, tol: 5, unit: 'µA' } },

      { t: 'refs', items: [
        { title: 'NXP UM10204: I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf', note: 'section 7.1: pull-up resistor sizing, rise-time limits and the 0.8473 factor' },
        { title: 'Texas Instruments: I2C Bus Pullup Resistor Calculation (SLVA689)', url: 'https://www.ti.com/lit/an/slva689/slva689.pdf', note: 'worked minimum and maximum values' },
        { title: 'ESP-IDF GPIO documentation (ESP32 pin notes)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/gpio/esp32.inc', note: 'input-only pins without pull resistors, strapping pins' },
        { title: 'Texas Instruments: Implications of Slow or Floating CMOS Inputs (SCBA004)', url: 'https://www.ti.com/lit/an/scba004e/scba004e.pdf', note: 'why floating inputs draw supply current' },
      ] },
    ],
    quiz: [
      { q: 'Why does an unconnected CMOS input read unpredictable values?', kind: 'concept', choices: [
        { t: 'Nothing sets its voltage, so stray charge moves it across the thresholds', ok: true, why: 'With nanoamp leakage and picofarad capacitance, a very small coupled charge is enough to swing the pin.' },
        { t: 'The input draws a current from neighbouring pins, and that current varies', why: 'A CMOS input draws almost no current from anywhere. That is the root of the problem, not the cure: with no current path, nothing holds the voltage still.' },
        { t: 'Unconnected pins default to ground but the reading is delayed', why: 'There is no default. Unless a resistor or driver is connected, the pin has no path to either rail.' },
      ] },
      { q: 'A button with a 10 kΩ pull-up to 3.3 V is held down. What current flows through the resistor?', kind: 'circuit', choices: [
        { t: '0.33 mA', ok: true, why: 'The button puts 0 V on the pin, so the full 3.3 V is across 10 kΩ.' },
        { t: 'None, because the input draws no current', why: 'The input draws none, but the pressed button provides a path to ground through the resistor.' },
        { t: '33 mA', why: 'That would need a 100 Ω resistor. Volts divided by kilohms gives milliamps.' },
      ] },
      { q: 'A MOSFET that enables a heater must stay off from the instant power is applied. Which gives that guarantee?', kind: 'circuit', choices: [
        { t: 'An external pull-down on the gate', ok: true, why: 'A physical resistor acts from the moment power arrives, before any code has run.' },
        { t: 'Enabling the internal pull-down as the first line of main()', why: 'Between power-on and that line executing, the pin is undriven for milliseconds or longer, and stays so if the firmware fails to start.' },
        { t: 'Driving the GPIO low in the firmware initialisation', why: 'Initialisation code only runs after reset and boot complete. The gate floats until then.' },
      ] },
      { q: 'Two devices with push-pull outputs are connected to the same wire. One drives high, the other low. What happens?', kind: 'circuit', choices: [
        { t: 'A large current flows from supply to ground through both output transistors', ok: true, why: 'One device connects the wire to the rail and the other to ground: a short limited only by the transistors themselves.' },
        { t: 'The wire reads low, because a low output always wins over a high one', why: 'Low wins only on open-drain buses, where nothing drives high. Push-pull outputs both drive actively.' },
        { t: 'The outputs detect the conflict and both switch themselves off', why: 'Ordinary GPIO outputs have no contention detection. They keep driving until something overheats.' },
      ] },
      { q: 'An I2C bus works with one sensor but fails when four more breakout boards are added. Each board carries 10 kΩ pull-ups. A likely electrical reason is:', kind: 'circuit', choices: [
        { t: 'Added wiring and pin capacitance has slowed the rising edges beyond the limit', ok: true, why: 'Five 10 kΩ in parallel is a reasonable 2 kΩ, so the more probable culprit is the extra capacitance of five boards and their wires.' },
        { t: 'The combined pull-up, now 50 kΩ, is too weak to pull the line high', why: 'Pull-ups on the same line are in parallel, so adding boards lowers the resistance.' },
        { t: 'I2C supports only one device on each bus', why: 'I2C is a multi-device bus by design. Each device has an address.' },
      ] },
      { q: 'On the original ESP32 you wire a button to GPIO35 and enable the internal pull-up in software. The released reading is erratic. Why?', kind: 'arch', choices: [
        { t: 'GPIO34–39 have no internal pull resistors, so the pin floats', ok: true, why: 'The software request has nothing to switch on. These pins need an external resistor.' },
        { t: 'Internal pull-ups take several seconds to charge the pin after being enabled', why: 'A pull-up acts within microseconds, limited only by the RC of the resistor and the pin capacitance.' },
        { t: 'GPIO35 is a strapping pin and is held by the bootloader', why: 'The strapping pins on this chip are GPIO0, 2, 5, 12 and 15. The issue here is the missing resistor.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 8 */
  {
    id: 'elec-logic-levels', title: 'Logic levels and voltage compatibility', minutes: 45,
    summary: 'Four datasheet numbers decide whether two chips can talk, and whether one will damage the other.',
    skills: ['elec-level-compat', 'elec-divider'],
    blocks: [
      `## The problem

      You have a 5 V ultrasonic sensor and a 3.3 V microcontroller. A forum post says "just connect it, it works". It does
      work, for that person, for now. You need to know two separate things: will the signals be *understood* in each
      direction, and will anything be *damaged*? Both answers are in the datasheets.`,

      `## Four thresholds

      A digital output does not produce exactly 0 V and exactly the supply voltage, and a digital input does not switch at a
      single voltage. Datasheets specify four numbers:

      | Symbol | Meaning |
      |---|---|
      | **VOH** | Output high: the *lowest* voltage the output will produce for a 1, at a stated load current |
      | **VOL** | Output low: the *highest* voltage the output will produce for a 0, at a stated load current |
      | **VIH** | Input high: the *lowest* voltage the input is guaranteed to read as 1 |
      | **VIL** | Input low: the *highest* voltage the input is guaranteed to read as 0 |

      Between VIL and VIH the input's reading is not guaranteed.

      A connection from a driver to a receiver is valid when:

      - **VOH (driver) ≥ VIH (receiver)**, and
      - **VOL (driver) ≤ VIL (receiver)**

      The differences are the **noise margins**: how much interference the link tolerates before a bit can be misread.`,

      { t: 'figure', svg: figLogicLevels, caption: 'The driver guarantees its output stays within the outer bands. The receiver guarantees to interpret the inner bands. The gap is the noise margin.' },

      `## Typical families

      CMOS inputs usually have thresholds that scale with their own supply: VIH around 0.7 × VDD and VIL around 0.3 × VDD are
      the classic figures. Some parts are stricter and some looser, which is why you look it up. TTL-compatible inputs have
      fixed thresholds: VIH = 2.0 V and VIL = 0.8 V regardless of supply.

      | Receiver | VIH | VIL |
      |---|---|---|
      | 5 V CMOS (for example 74HC at 5 V, many 5 V microcontrollers) | about 3.5 V | about 1.5 V |
      | 5 V TTL-compatible (74HCT, 74AHCT) | 2.0 V | 0.8 V |
      | 3.3 V CMOS | about 2.3 V | about 1.0 V |

      Treat these as the usual pattern, and the datasheet of each actual part as the fact.`,

      `## Question 1: will it be understood?

      **3.3 V output into a 5 V CMOS input.** The driver's high is at most 3.3 V, typically a little less under load. The
      receiver wants at least 3.5 V. The condition VOH ≥ VIH fails. It often appears to work, because real thresholds sit
      nearer the middle than the guaranteed limit, but there is no margin and it can fail with temperature, supply variation
      or a different batch of parts.

      **3.3 V output into a 5 V TTL-compatible input.** The receiver wants 2.0 V. 3.3 V clears it with more than a volt of
      margin. This works reliably, which is why a 74AHCT or 74HCT buffer powered from 5 V is the standard way to shift a
      3.3 V signal up to 5 V.

      **5 V output into a 3.3 V input.** It will certainly be read as a 1. This direction fails the other question.`,

      `## Question 2: will it be damaged?

      Every pin has an **absolute maximum** input voltage. On most CMOS chips it is the chip's own supply plus a few tenths of
      a volt. The reason is structural: each pin has protection diodes to the supply rail and to ground. If the pin is driven
      above the supply by more than a diode drop, the upper diode conducts and current flows from the pin into the chip's
      supply rail. Uncontrolled, that current damages the diode, raises the 3.3 V rail, or triggers latch-up.

      Some chips have inputs built without the upper diode and are specified as **5 V tolerant**: a 5 V signal may be applied
      while the chip runs at 3.3 V. This is a property of a specific pin on a specific chip, stated in its datasheet, often
      with conditions (only in digital input mode, only while the chip is powered, not on analog-capable pins).`,

      { t: 'callout', kind: 'warn', md: `**"5 V tolerant" must be verified per chip and per pin, in the datasheet.** Do not infer it from a product family, a forum post, or the fact that a board survived. For the original ESP32 the datasheet (v5.3) settles it: it contains **no 5 V-tolerance statement**. The DC characteristics (Table 5-3) give the highest input level as VDD + 0.3 V, and the absolute maximum on the supply pins (Table 5-1) is 3.6 V. So 5 V on an ESP32 GPIO is out of specification, whatever a forum post or a surviving board suggests. For any other chip, read the same two tables in its own datasheet before deciding. Assuming "not tolerant" costs two resistors; the opposite assumption can cost the chip.` },

      { t: 'predict', q: `A 5 V sensor output is connected directly to a GPIO of a 3.3 V microcontroller whose pins are not 5 V tolerant. The board appears to work. Where does current flow when the sensor output is high?`,
        reveal: `From the sensor output, into the pin, up through the pin's internal protection diode and into the microcontroller's 3.3 V rail. The pin is clamped at roughly 3.3 V plus a diode drop, around 3.9 V, and the only thing limiting the current is the sensor's output resistance. It "works" because the pin still reads a 1. Meanwhile the diode carries a current it was never rated for, the 3.3 V rail is being pushed upward by an outside source, and if the microcontroller is unpowered while the sensor is on, the chip is partially powered through a signal pin. Failures from this tend to appear weeks later as a dead pin or an erratic chip.` },

      { t: 'widget', name: 'circuit-debug', props: { scenario: 'wrong-rail' }, caption: 'Something on this board is connected to the wrong supply. Use the meter to find which node is at a voltage it should not be.' },

      `## Three ways to connect 5 V to 3.3 V

      ### 1. Resistor divider (5 V output to 3.3 V input, one direction)

      Two resistors scale the signal: Vout = 5 × R2 / (R1 + R2). With R1 = 10 kΩ on top and R2 = 20 kΩ below, the output is
      3.33 V. That is the textbook pair, but look at it critically: it lands a few tens of millivolts *above* a nominal 3.3 V
      rail before any tolerance is counted. A ratio that lands just below the rail, as in the exercise further down, is the
      better design.

      It is cheap and adequate for slow, one-way signals: an echo pulse, a UART receive line at moderate baud rate. Its limits:
      the divider's output resistance (R1 in parallel with R2, 6.7 kΩ here) forms an RC with the pin and wiring capacitance
      and slows the edges, and it cannot work on a bidirectional line.

      ### 2. A buffer or dedicated level-shifter IC

      For 3.3 V up to 5 V: a 74AHCT or 74HCT gate powered from 5 V. For 5 V down to 3.3 V: a buffer from a family with
      5 V-tolerant inputs (such as 74LVC) powered from 3.3 V. For many lines or both directions: a dual-supply translator IC.
      These give clean, fast edges and are the right choice for SPI and anything above a few hundred kilohertz.

      ### 3. MOSFET bidirectional shifter (open-drain buses)

      For I2C, where either side may pull the line low, one small N-MOSFET per line and a pull-up on each side does the job.`,

      { t: 'figure', svg: figLevelShifter, caption: 'Bidirectional level shifter for an open-drain line. The gate is tied to the lower supply.' },

      `How it works, case by case:

      - **Nobody pulls low.** The source is pulled to 3.3 V, the gate is at 3.3 V, so VGS = 0 and the MOSFET is off. Each side
        rests at its own supply: 3.3 V on the left, 5 V on the right.
      - **The 3.3 V side pulls low.** The source goes to 0 V while the gate stays at 3.3 V. VGS = 3.3 V, the MOSFET turns on
        and pulls the 5 V side low as well.
      - **The 5 V side pulls low.** The drain goes low. The MOSFET's internal body diode (from source to drain) conducts and
        drags the source down to about 0.6 V. Now VGS is large enough to turn the channel on, and the 3.3 V side goes fully
        low.

      The MOSFET must turn on with a gate drive of less than 3.3 V, the same selection rule as in the transistor lesson. This
      circuit is what the small "bidirectional logic level converter" breakout boards contain. It is too slow for fast
      push-pull signals, because the high level is produced only by the pull-ups.`,

      { t: 'widget', name: 'voltage-divider', props: { challenge: 'level-shift-5v-3v3' }, caption: 'Choose R1 and R2 so a 5 V output is safe for a 3.3 V input and is still read as a 1. The thresholds the tool checks against (0.7 × VDD for a high, VDD + 0.3 V as the damage limit) are typical CMOS figures, not those of a particular chip. The ESP32 datasheet (v5.3, Table 5-3) is slightly stricter on the first: a high needs at least 0.75 × VDD, and a low at most 0.25 × VDD.' },

      { t: 'exercise', prompt: `You have a 3.3 kΩ resistor for the lower leg (R2) and choose 1.8 kΩ for the upper leg (R1). What voltage does a 5 V signal produce at the divider output?`,
        hints: [`Which of the two resistors is the output taken across? Its share of the total resistance is the share of the voltage you get.`, `Vout = Vin × R2 / (R1 + R2).`, `5 × 3.3 / (1.8 + 3.3).`],
        solution: `Vout = 5 × 3.3 / 5.1 = **3.24 V**. That is below 3.3 V, so it is within the supply of a 3.3 V part, and far above a typical 3.3 V CMOS VIH of about 2.3 V (0.7 × VDD) and the ESP32's 0.75 × VDD = 2.48 V (datasheet v5.3, Table 5-3). Check the tolerance too: with 5 % resistors at their worst (R1 low, R2 high) and the 5 V rail at 5.25 V, the output reaches about 3.5 V, uncomfortably close to the ESP32's VDD + 0.3 V = 3.6 V input maximum. Use 1 % resistors or a slightly larger R1 if the limit matters.`,
        answer: { type: 'number', value: 3.235, tol: 0.03, unit: 'V' } },

      { t: 'callout', kind: 'mistake', md: `**Using a resistor divider on a bidirectional or open-drain line such as I2C SDA.** A divider only scales a signal travelling from its top to its tap. When the 3.3 V device tries to drive the tap, it is fighting the divider and the 5 V device sees a level set by the resistors, not a valid logic level. Bidirectional lines need the MOSFET circuit or a translator IC.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: avoid the problem', md: `The best level shifter is none. Many "5 V" modules contain a 3.3 V chip and a regulator, and will run from 3.3 V directly: check the chip's datasheet, not the module listing. Many sensors exist in 3.3 V versions. An I2C bus whose pull-ups go only to 3.3 V is at 3.3 V levels even if a device on it is powered from 5 V, provided that device accepts 3.3 V as a high (check its VIH). Shift levels only when the datasheets say you must.` },

      `## Harder application

      A 3.3 V microcontroller must send data to a strip of 5 V addressable LEDs. The LED datasheet gives VIH = 0.7 × VDD.`,

      { t: 'exercise', prompt: `The LED strip is powered from 5.0 V. What is the minimum input voltage it is guaranteed to read as a 1? Then decide whether a 3.3 V GPIO meets it.`,
        hints: [`VIH = 0.7 × VDD.`, `Compare with the highest voltage a 3.3 V output can produce.`],
        solution: `VIH = 0.7 × 5.0 = **3.5 V**. A 3.3 V GPIO cannot reach it, so the link is out of specification even though it frequently works on the bench. Reliable fixes: a 74AHCT buffer powered from 5 V (VIH 2.0 V in, 5 V out); or lower the supply of the *first* LED only (through a series diode, to about 4.3 V), which lowers its threshold to 3.0 V. That first LED then regenerates the signal at a level the rest of the strip accepts. The divider and the MOSFET shifter are both wrong here: a divider only reduces voltage, and the MOSFET circuit's pulled-up rising edge is too slow for this fast one-wire protocol.`,
        answer: { type: 'number', value: 3.5, tol: 0.02, unit: 'V' } },

      { t: 'refs', items: [
        { title: 'NXP AN10441: Level shifting techniques in I2C-bus design', url: 'https://www.nxp.com/docs/en/application-note/AN10441.pdf', note: 'the MOSFET bidirectional shifter, analysed state by state' },
        { title: 'Texas Instruments: Logic Guide / Voltage translation selection', url: 'https://www.ti.com/lit/sg/sdyu001ab/sdyu001ab.pdf', note: 'logic family thresholds and 5 V tolerant families' },
        { title: 'Espressif: ESP32 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf', note: 'v5.3: absolute maximum ratings (Table 5-1) and DC characteristics (Table 5-3): VIH ≥ 0.75 × VDD, VIL ≤ 0.25 × VDD, input maximum VDD + 0.3 V; no 5 V-tolerance statement' },
        { title: 'Texas Instruments: Latch-Up, ESD, and Other Phenomena (SLYA014)', url: 'https://www.ti.com/lit/an/slya014a/slya014a.pdf', note: 'what the input protection diodes do when over-driven' },
      ] },
    ],
    quiz: [
      { q: 'A driver guarantees VOH = 2.4 V. A receiver requires VIH = 2.0 V. What is the high-level noise margin?', kind: 'circuit', choices: [
        { t: '0.4 V', ok: true, why: 'The margin is the gap between the lowest high the driver produces and the lowest high the receiver accepts.' },
        { t: '4.4 V', why: 'Adding the two figures has no physical meaning. The margin is how far the signal can be disturbed before it is misread.' },
        { t: 'There is none; the link is invalid', why: 'The driver output exceeds the receiver requirement, so the link is valid with room to spare.' },
      ] },
      { q: 'A 3.3 V MCU output drives a 5 V CMOS input with VIH = 3.5 V. Which description is correct?', kind: 'circuit', choices: [
        { t: 'Out of specification: it may work on the bench but has no guaranteed margin', ok: true, why: 'The driver cannot reach the guaranteed threshold. Real parts often switch lower, which is why it seems fine until conditions change.' },
        { t: 'Guaranteed to work, because 3.3 V is more than half of 5 V', why: 'The guaranteed threshold is not the midpoint. The datasheet requires more than the driver can deliver.' },
        { t: 'It will damage the 5 V input', why: 'A voltage below the receiver supply is always safe for it. The concern here is recognition, not damage.' },
      ] },
      { q: 'What physically happens when a pin without 5 V tolerance is driven to 5 V on a chip powered at 3.3 V?', kind: 'concept', choices: [
        { t: 'The pin\'s protection diode conducts current into the 3.3 V rail', ok: true, why: 'The pin rises a diode drop above the rail and then the diode clamps it, carrying whatever current the source can supply.' },
        { t: 'The input simply reads 1 and no current flows, since inputs are high-impedance', why: 'It does read 1, but an input is only high-impedance while its voltage is within the supply range. This one is not.' },
        { t: 'The chip regulates the excess voltage down internally at the pin', why: 'GPIO pins have no regulator. They have clamp diodes, which pass the excess into the rail instead of removing it.' },
      ] },
      { q: 'Which method is appropriate for connecting a 5 V I2C device to a 3.3 V MCU whose pins are not 5 V tolerant, when the device has pull-ups to 5 V?', kind: 'arch', choices: [
        { t: 'An N-MOSFET bidirectional shifter with pull-ups on both sides', ok: true, why: 'I2C lines are bidirectional and open-drain. The MOSFET circuit passes a low in either direction and keeps each side at its own high level.' },
        { t: 'A resistor divider from 5 V to ground on each of SDA and SCL', why: 'A divider scales in one direction only. SDA is driven from both ends, and the divider would also load the pull-up.' },
        { t: 'A 74LVC buffer with 5 V-tolerant inputs, powered from 3.3 V, in each line', why: 'The voltages would be acceptable, but a buffer has a fixed direction. It cannot carry SDA, which both devices drive at different times.' },
      ] },
      { q: 'A divider of 10 kΩ over 20 kΩ shifts a 5 V UART line down. At 1 Mbaud the received data is corrupt, though it is fine at 9600. Most likely cause:', kind: 'circuit', choices: [
        { t: 'The divider resistance and the pin capacitance form an RC that rounds the edges', ok: true, why: 'About 6.7 kΩ of source resistance with tens of picofarads gives a time constant that is a large part of a 1 µs bit.' },
        { t: 'Resistive dividers invert signals once the bit rate exceeds their bandwidth', why: 'A resistive divider never inverts. It attenuates, and with capacitance it slows edges.' },
        { t: 'The divider output voltage rises with frequency and over-drives the 3.3 V input', why: 'With capacitance at the output the amplitude falls with frequency, never rises.' },
      ] },
      { q: 'A module is sold as "5 V". Before adding a level shifter, what should you check first?', kind: 'concept', choices: [
        { t: 'The chip\'s datasheet: its supply range and its VIH', ok: true, why: 'Many such modules run correctly from 3.3 V, or accept a 3.3 V high, which removes the need for any shifting.' },
        { t: 'Whether other people report that it works without one', why: 'A working sample shows only that one unit at one temperature switched. It does not show there is margin.' },
        { t: 'The module\'s supply current, so that the 5 V rail can be sized for it', why: 'That belongs in the power budget. It says nothing about which voltages the module\'s pins accept or produce.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 9 */
  {
    id: 'elec-adc-dac', title: 'ADC and DAC fundamentals', minutes: 50,
    summary: 'Turning a voltage into a number and back: resolution, reference, sampling, and why readings are never perfect.',
    skills: ['elec-adc', 'elec-divider'],
    blocks: [
      `## The problem

      A battery monitor reads a lithium cell through a divider into an ADC. The code prints a voltage that jumps around by
      50 mV, reads 0.1 V low at the bottom of the range, and flattens off before the top. The battery is steady, according to
      a multimeter. Where is the error coming from, and how much of it can be removed?`,

      `## What an ADC does

      An **analog-to-digital converter** compares an input voltage with a **reference voltage** (Vref) and outputs an integer
      saying what fraction of the reference the input is.

      An N-bit converter has 2^N output codes, 0 to 2^N − 1. Each code covers a small range of input voltage, one **LSB**
      (least significant bit) wide:

      **LSB size = Vref / 2^N**

      **code = floor(Vin / Vref × 2^N)**, limited to the maximum code. Going back: **Vin ≈ code × Vref / 2^N**

      | Bits | Codes | LSB at Vref = 3.3 V |
      |---|---|---|
      | 8 | 256 | 12.9 mV |
      | 10 | 1024 | 3.22 mV |
      | 12 | 4096 | 0.806 mV |
      | 16 | 65 536 | 0.050 mV |

      **Quantisation** is the unavoidable rounding: all voltages within one LSB give the same code, so even a perfect converter
      is uncertain by up to one LSB.

      Resolution is not accuracy. A 12-bit converter reports to 1 part in 4096. Whether the report is *right* depends on the
      reference, the linearity of the converter and the noise.`,

      `## The reference is half of every reading

      The converter measures a ratio. Convert the code to volts with a Vref value that is wrong by 2 % and every reading is
      wrong by 2 %.

      - If Vref is the supply rail, the reading inherits the rail's tolerance, its ripple, and its sag when the radio
        transmits.
      - An internal bandgap reference is more stable but varies from chip to chip, which is why manufacturers store
        calibration values in the chip.
      - An external precision reference gives the best absolute accuracy.

      One elegant trick: if the sensor is a divider powered from the *same* voltage as the reference (a thermistor or a
      potentiometer between Vref and ground), the reference cancels out. The code depends only on the resistor ratio. This is
      a **ratiometric** measurement.`,

      `## Sampling and aliasing

      An ADC takes snapshots. The **sample rate** fs is how many it takes per second. Between samples it knows nothing.

      The **Nyquist criterion**: to represent a signal you must sample at more than twice its highest frequency. Half the
      sample rate, fs / 2, is the Nyquist frequency.

      A frequency above fs / 2 does not disappear. It shows up in the samples as a lower frequency that was never in the
      signal: an **alias**. A tone at frequency f sampled at fs appears at |f − k × fs| for the integer k that brings the
      result into the range 0 to fs / 2. Once sampled, an alias cannot be told apart from a real signal, so it must be removed
      *before* the converter with an analog low-pass filter (an anti-aliasing filter).

      This matters even for slow measurements. Sampling a battery voltage ten times a second with 50 Hz mains hum on the wire
      aliases the hum to 0 Hz, a steady offset that depends on when you happened to sample.`,

      { t: 'predict', q: `A 900 Hz sine wave is sampled at 1000 samples per second. What will the sampled data look like?`,
        choices: [
          { t: 'A 900 Hz sine, slightly jagged', why: `There are barely more than one sample per cycle. That is too few to follow the waveform at all.` },
          { t: 'A clean 100 Hz sine', ok: true, why: `Yes. Each sample lands a little earlier in the cycle than the last, tracing out a slow wave at the difference frequency.` },
          { t: 'Random noise', why: `The samples are fully determined by the input and the sample clock. The result is a regular pattern, not noise.` },
        ],
        reveal: `|900 − 1000| = 100 Hz. The data shows a convincing 100 Hz signal that does not exist. Nothing in the numbers reveals the mistake. Try it in the widget below: raise the signal frequency past half the sample rate and watch the reconstructed waveform fold back.` },

      { t: 'widget', name: 'adc-lab', props: { bits: 4, vref: 3.3 }, caption: 'Start at 4 bits so the steps are visible. Increase the resolution, then lower the sample rate until the reconstructed signal is wrong.' },

      `## Source impedance: the input is not free

      Most microcontroller ADCs are the successive-approximation type with a **sample-and-hold** input. For a short
      acquisition time a switch connects the pin to a small internal capacitor, which must charge to the input voltage. Then
      the switch opens and the converter measures the capacitor.`,

      { t: 'figure', svg: figAdcInput, caption: 'What the signal source sees: a capacitor that must be charged through the source resistance during the sampling window.' },

      `That capacitor charges through the resistance of whatever drives the pin: an RC circuit. If the source resistance is
      too high, the capacitor does not finish charging in the time available and the reading is wrong, usually low, and
      dependent on the previous channel sampled.

      Datasheets give a maximum recommended source impedance for a given sampling time. When the source is a high-value
      divider (used to save battery current), the standard fix is a capacitor of 10 nF to 100 nF from the pin to ground. It is
      thousands of times larger than the sampling capacitor, so it supplies the charge almost without changing voltage, and
      the divider only needs to top it up between samples. It also filters noise. The cost is response time: 100 kΩ with
      100 nF has τ = 10 ms.`,

      `## On real hardware: why ESP32 ADC readings disappoint

      The ESP32 family has SAR ADCs that are convenient but need care. What follows is the general picture from Espressif's
      documentation; the numbers for your chip are in its datasheet and the ESP-IDF ADC documentation.

      - **Limited native range, extended by attenuation.** The converter measures against an internal reference that is
        1100 mV by design (ESP-IDF v6.1, ADC calibration guide). To measure larger voltages, an input **attenuation**
        setting is selected in software. Each setting has an *effective measurement range* in which results are reasonably
        accurate. For the original ESP32's 12-bit ADC (datasheet v5.3, Table 4-4) these are 100–950 mV, 100–1250 mV,
        150–1750 mV and 150–2450 mV for attenuation 0 to 3: never down to 0 V and never up to 3.3 V. Other chips in the
        family have different ranges. Choose the smallest attenuation that covers your signal.
      - **Non-linearity near the ends.** Readings close to 0 V and close to the top of the range are compressed or do not
        respond. Design the signal to sit in the middle of the recommended range.
      - **Chip-to-chip reference variation.** The internal reference differs between individual chips. Espressif stores
        calibration data in eFuse at the factory, and ESP-IDF provides calibration functions that convert raw codes to
        millivolts using it. Use them; do not compute code × 3.3 / 4095 yourself.
      - **Noise.** The radio, the switching of the digital core and the supply all couple into the reading. Espressif's own
        guidance is to add a bypass capacitor (100 nF) at the ADC pin and to average multiple samples.
      - **ADC2 and Wi-Fi.** On the original ESP32, the ADC2 unit is also used by the Wi-Fi driver, so ADC2 pins cannot be
        relied on while Wi-Fi is in use. Use ADC1 pins. (The details differ on the S3 and C3; see the ESP-IDF ADC
        documentation.)

      None of this makes the converter unusable. It makes it a converter you design *for*: scale the signal into the good
      part of the range, filter it, calibrate, average. For measurements that must be accurate, an external ADC on I2C or SPI
      with its own reference is a few components.`,

      `## Worked example: reading a lithium cell

      A single lithium cell ranges from 4.2 V (full) to about 3.0 V (empty). Assume, for this example, that the ADC is used
      with a setting whose accurate range extends to 2.4 V; look up the real figure for your chip.

      - Scale: 4.2 V must map to no more than 2.4 V. A divider with equal resistors gives 2.1 V at full and 1.5 V at empty,
        comfortably mid-range.
      - Divider current: with 2 × 100 kΩ the divider draws 4.2 V / 200 kΩ = 21 µA continuously. Acceptable for many devices;
        for very low-power designs, switch the divider with a MOSFET.
      - Source impedance: 100 kΩ ∥ 100 kΩ = 50 kΩ, far too high for direct sampling. Add 100 nF at the pin.
      - Firmware: take 16 or more samples, average, convert with the calibration API to millivolts, multiply by 2.
      - Tolerance: with two equal 1 % resistors the worst case (one high, one low) moves the ratio by 1 %, about 40 mV
        at 4.2 V. A one-point calibration against a multimeter removes most of it.`,

      { t: 'widget', name: 'voltage-divider', props: { challenge: 'adc-battery' }, caption: 'The same design problem with a different battery: a 9 V block that reads up to 9.6 V when fresh, into an idealised 12-bit ADC that measures 0 to 3.3 V. Scale it into range without wasting battery current, and see the code the ADC returns. (A real ESP32 ADC input has a narrower accurate range, as described above.)' },

      { t: 'exercise', prompt: `A 10-bit ADC uses a 3.3 V reference. It returns the code 512. What input voltage does that represent, in volts?`,
        hints: [`One LSB is Vref / 2^N = 3.3 / 1024.`, `Vin ≈ code × LSB.`],
        solution: `LSB = 3.3 / 1024 = 3.223 mV. Vin = 512 × 3.223 mV = **1.65 V**: half the codes, half the reference. More precisely, code 512 covers inputs from 1.650 V up to 1.653 V; the converter cannot distinguish within that step.`,
        answer: { type: 'number', value: 1.65, tol: 0.01, unit: 'V' } },

      { t: 'callout', kind: 'mistake', md: `**Averaging to fix an error that is not noise.** Averaging reduces random noise. It does nothing for an offset, a gain error from a wrong reference value, non-linearity, or an input sagging because of source impedance: you get a very stable wrong answer. Separate the errors first: is the reading *noisy* (varies between samples) or *inaccurate* (steadily off compared with a multimeter)? They have different cures.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: how many bits do you need?', md: `Work backwards from the quantity. A battery gauge with 50 mV steps over a 4.2 V range needs about 84 steps: 7 bits. A temperature reading to 0.1 °C over 100 °C needs 1000 steps: 10 bits, plus margin for noise, so 12. Asking for more resolution than the noise and reference accuracy support only produces more digits of noise. Spend the effort on the reference, filtering and layout before reaching for a higher-resolution part.` },

      `## DACs

      A **digital-to-analog converter** does the reverse: Vout = code / 2^N × Vref. The same LSB arithmetic applies. Its
      output is a staircase, one step per update, which is smoothed by a low-pass filter (a reconstruction filter) for the
      same reason an ADC needs an anti-aliasing filter.

      A DAC output usually cannot drive a load: it is intended to feed a high-impedance input, and needs a buffer amplifier
      for anything else.

      Not every microcontroller has one. The original ESP32 has two 8-bit DAC channels; several later ESP32-family chips
      have none. Check the peripheral list for your chip. Where there is no DAC, or 8 bits is too coarse, the usual
      substitutes are PWM followed by a low-pass filter (next lesson) or an external DAC on I2C or SPI.`,

      `## Harder application`,

      { t: 'exercise', prompt: `A vibration sensor is sampled at 2000 samples per second. A motor nearby adds interference at 1700 Hz, and there is no anti-aliasing filter. At what frequency does the interference appear in the sampled data, in hertz?`,
        hints: [`The Nyquist frequency is 1000 Hz, so 1700 Hz cannot be represented.`, `It folds to |f − fs|.`],
        solution: `|1700 − 2000| = **300 Hz**. The data contains a strong 300 Hz component that looks exactly like a real vibration. It cannot be removed in software, because genuine 300 Hz vibration would look identical. The cure belongs before the ADC: a low-pass filter with a cutoff well below 1000 Hz, steep enough to suppress 1700 Hz, or a higher sample rate so that the interference falls below Nyquist and can be filtered digitally.`,
        answer: { type: 'number', value: 300, tol: 2, unit: 'Hz' } },

      { t: 'refs', items: [
        { title: 'ESP-IDF: ADC oneshot mode driver', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/adc/adc_oneshot.rst', note: 'attenuation settings, ADC2 and Wi-Fi' },
        { title: 'ESP-IDF: ADC calibration driver', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/adc/adc_calibration.rst', note: 'eFuse calibration schemes and raw-to-millivolt conversion' },
        { title: 'Analog Devices MT-001: Taking the Mystery out of the Infamous Formula "SNR = 6.02N + 1.76 dB"', url: 'https://www.analog.com/media/en/training-seminars/tutorials/MT-001.pdf', note: 'quantisation noise' },
        { title: 'Analog Devices MT-002: What the Nyquist Criterion Means to Your Sampled Data System Design', url: 'https://www.analog.com/media/en/training-seminars/tutorials/MT-002.pdf', note: 'sampling and aliasing' },
        { title: 'STMicroelectronics AN2834: How to get the best ADC accuracy', url: 'https://www.st.com/resource/en/application_note/an2834-how-to-get-the-best-adc-accuracy-in-stm32-microcontrollers-stmicroelectronics.pdf', note: 'source impedance, external capacitor, reference and layout effects (general, not STM32-specific)' },
      ] },
    ],
    quiz: [
      { q: 'A 12-bit ADC with a 2.5 V reference has an LSB of approximately:', kind: 'concept', choices: [
        { t: '0.61 mV', ok: true, why: '2.5 V divided into 4096 steps.' },
        { t: '208 mV', why: 'This divides the reference by the number of bits. The number of steps is two to the power of the bits.' },
        { t: '2.5 mV', why: 'This would be a division into 1000 steps, which matches neither 10 nor 12 bits.' },
      ] },
      { q: 'An ADC uses the 3.3 V rail as its reference. When the Wi-Fi radio transmits, the rail dips to 3.2 V. A steady 1.60 V input now reads:', kind: 'circuit', choices: [
        { t: 'Higher than before, because the reference fell', ok: true, why: 'The code is the ratio of input to reference. Lower the reference and the ratio rises, though the input did not move.' },
        { t: 'Lower than before, because the supply dropped', why: 'The input did not drop. Only the reference it is compared against did, which increases the ratio.' },
        { t: 'The same as before, because the input voltage did not change', why: 'An ADC does not measure volts directly. It measures the input relative to the reference, so a reference change alters the code.' },
      ] },
      { q: 'A signal contains components up to 4 kHz. What is the minimum sample rate that avoids aliasing, in principle?', kind: 'concept', choices: [
        { t: 'More than 8 kHz', ok: true, why: 'The sample rate must exceed twice the highest frequency present, and practical filters need margin beyond that.' },
        { t: '4 kHz', why: 'Sampling at the signal frequency takes one sample per cycle, which shows a constant value and no waveform.' },
        { t: '2 kHz', why: 'Halving goes the wrong way. Half the sample rate is the highest frequency that can be represented.' },
      ] },
      { q: 'A 1 MΩ / 1 MΩ divider feeds an ADC pin directly. The reading is low and changes when another channel is sampled first. The best fix is:', kind: 'circuit', choices: [
        { t: 'Add a capacitor of around 100 nF from the pin to ground', ok: true, why: 'The sampling capacitor cannot charge through 500 kΩ in the acquisition time. A local reservoir supplies that charge instantly.' },
        { t: 'Average a larger number of samples in software', why: 'Each sample suffers the same incomplete charging, so the average is just as low. This is a systematic error, not noise.' },
        { t: 'Increase the ADC resolution setting', why: 'Finer steps report the same wrong voltage in more detail. The input is not settling, whatever the resolution.' },
      ] },
      { q: 'Why does ESP-IDF provide ADC calibration functions instead of expecting code × Vref / 4095?', kind: 'arch', choices: [
        { t: 'The reference differs from chip to chip and the response is not perfectly linear', ok: true, why: 'Factory-measured values in eFuse let the driver map raw codes to millivolts for the individual chip.' },
        { t: 'Multiplication and division are too slow on the processor for every ADC sample', why: 'A multiply and divide take well under a microsecond. Calibration exists for accuracy, not speed.' },
        { t: 'To correct the small error between dividing by 4095 and dividing by 4096 in the formula', why: 'That difference is one part in 4096, about a quarter of a millivolt per volt. The errors that calibration corrects are a hundred times larger.' },
      ] },
      { q: 'An 8-bit DAC with a 3.3 V reference is asked for code 128. Its output, unloaded, is about:', kind: 'circuit', choices: [
        { t: '1.65 V', ok: true, why: '128 of 256 steps is half the reference.' },
        { t: '1.28 V', why: 'The code is not in hundredths of a volt. It is a fraction of the reference: code over 256.' },
        { t: '3.3 V', why: 'Full scale needs the maximum code. 128 is the midpoint.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 10 */
  {
    id: 'elec-pwm', title: 'PWM and signal modulation', minutes: 40,
    summary: 'Controlling power and conveying information using nothing but the timing of a digital pin.',
    skills: ['elec-pwm', 'elec-rc-timing'],
    blocks: [
      `## The problem

      A GPIO has two states: 0 V and 3.3 V. You want an LED at 30 % brightness, a motor at half speed, and a servo held at a
      precise angle. There is no "1 V" setting on a digital pin. Dropping voltage in a resistor would work for the LED but
      wastes power as heat, and for a motor the heat would be considerable.`,

      `## Pulse-width modulation

      **PWM** switches the output fully on and fully off, fast, and varies the proportion of time spent on.

      - **Period** T: the time for one on-off cycle. **Frequency** f = 1 / T.
      - **Duty cycle** D: the fraction of each period the output is high, 0 to 100 %.

      The **average** voltage of the waveform is

      **V avg = D × V high**

      Why switching instead of reducing the voltage? Recall the transistor lesson: a switch that is fully on or fully off
      dissipates almost nothing. PWM delivers a variable average power through a switch that is never in the lossy
      in-between state.

      Whether the load responds to the average depends on the load being slow compared with the PWM period:

      | Load | What does the averaging | Suitable PWM frequency |
      |---|---|---|
      | LED | Your eye (the LED itself really is flashing) | Above about 200 Hz to avoid visible flicker; 1 kHz or more for moving objects and cameras |
      | DC motor | The motor's inductance smooths the current; its inertia smooths the speed | A few kHz to about 20 kHz; above 20 kHz it is inaudible |
      | Heater | Thermal mass | A few Hz is enough |
      | Analog voltage | An RC low-pass filter you add | Far above the filter cutoff |`,

      `## On real hardware: a counter and a comparator

      A PWM peripheral is a timer. A counter counts clock ticks from 0 up to a maximum and wraps. A compare register holds a
      threshold. The output is high while the counter is below the threshold.

      - the counter's maximum sets the **period**
      - the compare value sets the **duty**

      The number of distinct duty values is the number of counts in a period. This creates a trade-off between frequency and
      **resolution**:

      **steps per period = timer clock frequency / PWM frequency**, and **bits of resolution = log2(steps)**

      With an 80 MHz timer clock, 5 kHz PWM gives 16 000 counts per period: 13 bits. At 40 kHz there are 2000 counts: just
      under 11 bits. You cannot have both a very high frequency and very fine steps from the same clock. The ESP32 LEDC
      peripheral works this way: you choose a frequency and a duty resolution in bits, and the driver reports an error if the
      clock cannot provide the combination.`,

      { t: 'widget', name: 'pwm-lab', props: { freq: 1000, duty: 30, bits: 10 }, caption: 'Vary duty and frequency. Watch the average voltage and the effect on the LED and motor. Then raise the frequency until the available resolution drops.' },

      { t: 'predict', q: `An LED is dimmed with PWM at 1 kHz. You change the frequency to 10 kHz and keep the duty cycle at 30 %. What happens to the brightness?`,
        choices: [
          { t: 'It becomes ten times brighter', why: `The LED is still on for 30 % of the time. Ten times as many pulses each last a tenth as long.` },
          { t: 'It stays the same', ok: true, why: `Yes. Average power depends on the duty cycle. Frequency only determines how finely the on-time is chopped.` },
          { t: 'It becomes dimmer because the pulses are shorter', why: `Each pulse is shorter, but there are proportionally more of them, so the total on-time per second is unchanged.` },
        ],
        reveal: `Brightness follows duty, not frequency. Frequency is chosen for side effects: flicker, audible whine, switching losses, and available resolution. One caution: perceived brightness is not linear with duty. The eye responds roughly logarithmically, so 50 % duty looks much more than half as bright, and smooth fades need a correction curve in firmware.` },

      `## From PWM to an analog voltage

      An RC low-pass filter passes the DC component of the PWM waveform, which is the average, and attenuates the switching
      frequency. What is left of the switching is **ripple**.

      For an RC filter whose time constant is much longer than the PWM period, the peak-to-peak ripple is approximately

      **ΔV ≈ V high × D × (1 − D) / (f × R × C)**

      worst at 50 % duty. To make the ripple small you need f × R × C to be large: either a higher PWM frequency or a slower
      filter. A slower filter responds more slowly when you change the duty. This is the same noise-against-speed trade as
      every filter.`,

      `## Worked example

      3.3 V PWM at 5 kHz, filtered by R = 10 kΩ and C = 1 µF, at 50 % duty.

      - Average: 0.5 × 3.3 = 1.65 V.
      - R × C = 10 ms, which is 50 PWM periods: the approximation holds.
      - Ripple: 3.3 × 0.5 × 0.5 / (5000 × 0.01) = 0.825 / 50 = **16.5 mV** peak-to-peak.
      - Settling after a duty change: about 5 τ = 50 ms.

      Raising the PWM frequency to 50 kHz would cut the ripple to 1.65 mV with the same settling time, at the cost of
      resolution.

      The filter output has 10 kΩ of source resistance, so it can only feed a high-impedance input. To drive a load, buffer it
      with an op-amp.`,

      { t: 'exercise', prompt: `A 3.3 V PWM output runs at 25 % duty. What is its average voltage?`,
        hints: [`V avg = D × V high, with D as a fraction.`],
        solution: `0.25 × 3.3 = **0.825 V**. A multimeter on the DC range would show about this value on the raw PWM pin, because it averages too.`,
        answer: { type: 'number', value: 0.825, tol: 0.01, unit: 'V' } },

      `## Servo pulses: information in the pulse width

      A hobby servo also takes a pulse train, but uses it differently. It does not average the signal. It **measures the
      width of each pulse** and treats that width as a position command.

      - one pulse about every 20 ms (50 Hz)
      - about 1.0 ms wide for one end of travel, 1.5 ms for centre, 2.0 ms for the other end

      Those are nominal figures; real servos vary, and many accept a wider range. Check the servo's documentation and
      approach the end stops carefully, because a servo driven against its mechanical limit stalls and draws its full stall
      current.`,

      { t: 'figure', svg: figServo, caption: 'The servo reads the width of each pulse. The repetition rate matters much less than the width.' },

      `Two electrical points about servos and motors:

      - The signal wire is logic level and draws almost no current. The power wire draws hundreds of milliamps and up to an
        amp or more when the servo starts or stalls. Power servos from a supply sized for that, not from a microcontroller
        board's 3.3 V pin, and connect the grounds.
      - Because the useful range is 1 to 2 ms out of 20 ms, only 5 % of the duty range carries information. Timer resolution
        matters more than you would expect.`,

      { t: 'exercise', prompt: `A PWM timer is set to 50 Hz with 14-bit resolution (16 384 counts per 20 ms period). What compare value produces a 1.5 ms pulse? Round to the nearest whole count.`,
        hints: [`What fraction of the 20 ms period is 1.5 ms?`, `Multiply that fraction by 16 384.`],
        solution: `1.5 / 20 = 0.075. 0.075 × 16 384 = 1228.8, so **1229**. The whole travel from 1.0 ms to 2.0 ms spans 819 to 1638: about 819 steps. With 8-bit resolution the same travel would span only 13 steps, which is why servo control uses a high-resolution timer setting.`,
        answer: { type: 'number', value: 1229, tol: 1.5 } },

      { t: 'callout', kind: 'mistake', md: `**Driving a motor with PWM and no flyback diode, or a slow one.** With PWM the switch opens thousands of times a second, and every opening produces an inductive kick. The diode conducts on every cycle and must be fast: a Schottky or fast-recovery type, rated for the motor current. The gate pull-down from the transistor lesson matters too, since a PWM pin is undriven until the timer is configured.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: picking a PWM frequency', md: `Too low: visible flicker, audible whine from motors and inductors (the audible band runs to about 20 kHz), large ripple after a filter. Too high: fewer resolution bits from the timer, more energy lost in each switching transition, and gate-drive current from the GPIO becomes significant. Typical choices: 1 to 5 kHz for LEDs with 10 to 13 bits; about 20 kHz for motors; 50 Hz with the highest resolution available for servos; as high as the timer allows for PWM-as-DAC.` },

      `## Modulation in general

      **Modulation** means varying some property of a signal to carry information. PWM varies pulse width. Others you will
      meet:

      | Scheme | What varies | Where you meet it |
      |---|---|---|
      | PWM | Width of each pulse; the receiver uses the average or measures the width | LED and motor power, servos |
      | PFM | Pulse frequency | Light-load mode of switching regulators |
      | OOK / ASK | A carrier wave is switched on and off, or its amplitude changed | Infrared remote controls (a carrier around 38 kHz switched on and off), simple 433 MHz remotes |
      | FSK | The carrier frequency is shifted between values | Bluetooth Low Energy, many sub-GHz radios |
      | PSK / QAM | The carrier phase, or phase and amplitude together | Wi-Fi |

      Infrared remote control shows why a carrier is useful. Sunlight and lamps contain plenty of infrared, mostly steady or
      at mains frequency. A receiver that only responds to infrared flashing at about 38 kHz ignores all of that. The data
      bits are then sent by turning the 38 kHz carrier on and off. An MCU generates the carrier with a PWM timer at 38 kHz
      and gates it under software or peripheral control.`,

      `## Harder application`,

      { t: 'exercise', prompt: `You want PWM-as-DAC with at most 5 mV peak-to-peak ripple at 50 % duty from a 3.3 V output, using a filter with R × C = 2 ms (so it settles in about 10 ms). What minimum PWM frequency is required, in kHz?`,
        hints: [`Rearrange ΔV ≈ V × D × (1 − D) / (f × RC) for f.`, `f = 3.3 × 0.25 / (0.005 × 0.002).`],
        solution: `f = 0.825 / (0.005 × 0.002) = 82 500 Hz = **82.5 kHz**. With an 80 MHz timer clock that leaves 80 000 000 / 82 500 ≈ 970 counts per period, a little under 10 bits. So this "DAC" has about 10-bit resolution, 5 mV ripple and 10 ms settling. To do better on all three at once you need a second filter stage or a real DAC.`,
        answer: { type: 'number', value: 82.5, tol: 1.5, unit: 'kHz' } },

      { t: 'refs', items: [
        { title: 'ESP-IDF: LED Control (LEDC) driver', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/ledc.rst', note: 'frequency and duty-resolution trade-off' },
        { title: 'Texas Instruments: Using PWM Output as a Digital-to-Analog Converter (SPRAA88)', url: 'https://www.ti.com/lit/an/spraa88a/spraa88a.pdf', note: 'ripple and filter design' },
        { title: 'Vishay: Data Formats for IR Remote Control (document 80071)', url: 'https://www.vishay.com/docs/80071/dataform.pdf', note: 'carrier modulation used by infrared remotes' },
      ] },
    ],
    quiz: [
      { q: 'A 5 V PWM signal has a period of 2 ms and is high for 0.5 ms of each period. Its frequency and average voltage are:', kind: 'circuit', choices: [
        { t: '500 Hz and 1.25 V', ok: true, why: 'Frequency is 1 / 2 ms. Duty is 0.5 / 2 = 25 %, and a quarter of 5 V is 1.25 V.' },
        { t: '2 kHz and 1.25 V', why: 'The duty is right, but the frequency comes from the whole period, not from the high time.' },
        { t: '500 Hz and 2.5 V', why: 'The frequency is right, but the output is high for a quarter of the period, not half.' },
      ] },
      { q: 'Why is PWM through a transistor more efficient than a series resistor for running a motor at reduced speed?', kind: 'concept', choices: [
        { t: 'The transistor is always fully on or fully off, wasting little in either', ok: true, why: 'A resistor continuously converts the unwanted share of the power into heat. A switch does not.' },
        { t: 'PWM raises the motor supply voltage, so less current is needed for the same power', why: 'PWM never exceeds the supply. It reduces the average by spending part of the time off.' },
        { t: 'Resistors of any practical size cannot carry motor currents without burning out', why: 'Power resistors can. The objection is the energy they waste, not their ability to carry current.' },
      ] },
      { q: 'With a fixed timer clock, what do you give up by increasing the PWM frequency tenfold?', kind: 'arch', choices: [
        { t: 'Duty-cycle resolution: a tenth as many counter steps per period', ok: true, why: 'Steps per period equal the clock frequency divided by the PWM frequency.' },
        { t: 'Average output voltage: at the same duty it falls to a tenth', why: 'The average depends only on the duty cycle and the high level, not on frequency.' },
        { t: 'Nothing: frequency and resolution are set independently by different registers', why: 'Both come from the same counter. A shorter period contains fewer clock ticks to choose a compare value from.' },
      ] },
      { q: 'A hobby servo receives a 1.5 ms pulse every 20 ms. You change the period to 15 ms and keep the pulse at 1.5 ms. The servo:', kind: 'circuit', choices: [
        { t: 'Stays put, because it responds to pulse width, not duty cycle', ok: true, why: 'The duty changed from 7.5 % to 10 %, but the servo measures the width of each pulse and that is unchanged.' },
        { t: 'Moves towards one end, because the duty cycle increased from 7.5 % to 10 %', why: 'A device that averaged the signal would respond that way. A servo times each pulse instead.' },
        { t: 'Stops working, because only exactly 50 Hz is accepted', why: 'Typical servos accept a range of repetition rates. The pulse width carries the command.' },
      ] },
      { q: 'An RC filter on a PWM pin gives a steady voltage with too much ripple. Which change reduces ripple *without* slowing the response to duty changes?', kind: 'circuit', choices: [
        { t: 'Raise the PWM frequency', ok: true, why: 'Ripple falls as f × RC grows, and the settling time depends only on RC, which is unchanged.' },
        { t: 'Increase the capacitor', why: 'That reduces ripple but lengthens the time constant, so the output follows duty changes more slowly.' },
        { t: 'Increase the duty cycle', why: 'Duty sets the output level you are trying to produce. It is not free to change, and ripple peaks at mid-scale anyway.' },
      ] },
      { q: 'Why do infrared remote controls switch a 38 kHz carrier on and off instead of simply turning the LED on for a 1?', kind: 'concept', choices: [
        { t: 'The receiver can filter for 38 kHz and ignore steady ambient infrared', ok: true, why: 'Putting the information on a carrier moves it away from the frequencies where the interference lies.' },
        { t: 'Infrared LEDs overheat if they stay on continuously for the length of a data bit', why: 'They can. The carrier is there for noise rejection, not to protect the LED.' },
        { t: 'A carrier makes the light travel further for the same LED power', why: 'Range depends on optical power and receiver sensitivity. The carrier helps the receiver separate signal from background.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 11 */
  {
    id: 'elec-breadboard', title: 'Reading circuit diagrams and building on a breadboard', minutes: 45,
    summary: 'A schematic says what is connected to what. A breadboard is one way to make those connections. Translating between them is a skill.',
    skills: ['elec-schematic', 'elec-led-resistor'],
    blocks: [
      `## The problem

      A sensor's datasheet shows a "typical application circuit": eight symbols and some lines. You have the parts and a
      breadboard. Twenty minutes later it does not work, and you cannot tell whether your understanding of the circuit is
      wrong or your construction is. The fix is a method for reading schematics as lists of connections, and a clear picture of
      what is joined inside a breadboard.`,

      `## What a schematic tells you

      A schematic shows **which terminals are electrically connected**. It says nothing about where parts physically sit or
      how long the wires are.

      The central idea is the **net**: a set of points joined by conductors, all at the same voltage. Every line on a
      schematic is part of a net. Building a circuit means reproducing every net: all the terminals on a net are joined to
      each other, and nothing else is.

      Conventions:

      - A **dot** where lines meet means they are joined. Lines that cross with no dot are not connected.
      - **Power and ground symbols** are nets too. Every ground symbol on the page is the same net, although no line joins
        them. The same applies to every "3V3" symbol.
      - A **net label** (a name written on a wire, such as SDA) connects that wire to every other wire with the same name,
        again without a drawn line. Larger schematics rely on this heavily.
      - **Reference designators** name parts: R1, C3, D2, Q1 (transistor), U1 (integrated circuit), J1 (connector), SW1.
      - Values omit unit symbols and use the multiplier as a decimal point: 4k7 = 4.7 kΩ, 2R2 = 2.2 Ω, 100n = 100 nF,
        4u7 = 4.7 µF.
      - By habit, higher voltages are drawn towards the top, ground at the bottom, and signals flow left to right.
      - An IC is drawn as a box with pins arranged for clarity, not as they are on the package. Pin *numbers* are printed by
        each pin; use them with the package drawing in the datasheet.`,

      { t: 'figure', svg: figSymbols, caption: 'Symbols used in this course. Styles vary a little between drawing standards, but these are recognisable everywhere.' },

      `## How to read a schematic

      1. **Find the power.** Where does each supply come in, what voltage, and which parts does it reach?
      2. **Find the ground.** It is the reference for every voltage on the page.
      3. **Identify the blocks.** Regulator, microcontroller, sensor, output driver. Most circuits are a few familiar blocks
         joined together: a divider, an RC, a pull-up, a low-side switch.
      4. **Trace each signal** from its source to its destination, naming every net it passes through.
      5. **Ask what each part is for.** A resistor from a signal to 3V3 is a pull-up. A 100 nF capacitor from a supply pin to
         ground is decoupling. A resistor in series with an LED limits current. If you cannot say why a part is there, you do
         not yet understand the circuit.`,

      `## Inside a breadboard

      A solderless breadboard holds parts in spring clips that are joined in a fixed pattern.`,

      { t: 'figure', svg: figBreadboard, caption: 'Connections inside a typical breadboard. Coloured bars show holes that are joined. Check your own board with a meter.' },

      `- **Terminal strips.** In the main area, each short column of five holes (a to e) is one connected strip. The column on
        the other side of the centre gap (f to j) is a separate strip. Adjacent columns are not connected.
      - **The centre gap** isolates the two halves. A DIP integrated circuit straddles it so that each pin gets its own strip.
      - **Power rails.** The long rows along the edges are joined lengthwise, and are meant for supply and ground. The two
        rails on one side are separate from each other and from the rails on the other side.
      - **Split rails.** On many full-length boards, each power rail is broken in the middle. If the printed red and blue
        lines have a gap, the rail has a gap. Parts in the far half get no power until you bridge the break with a jumper.

      Check a new breadboard once with a multimeter on the continuity range: along a rail, across the middle of a rail, along
      a column, and across the centre gap.

      Two parts placed in the same strip are connected. Two leads of *one* part placed in the same strip are shorted together,
      and the part does nothing: a common slip with resistors and buttons.`,

      { t: 'callout', kind: 'hw', md: `**Tactile push-buttons.** The common four-legged button has its legs joined in pairs internally: each pair is one side of the switch. Placed one way round on a breadboard it works; rotated a quarter turn, the two strips you are using are permanently joined and it reads as always pressed. Use legs that are diagonally opposite and the orientation no longer matters.` },

      `## From schematic to breadboard: a method

      1. Wire the rails first: supply to the red rail, ground to the blue. Bridge split rails. Join the ground rails on both
         sides if you use both.
      2. Place the large parts (the MCU board, ICs) across the centre gap.
      3. Go through the schematic **one net at a time**. For each net, put every terminal on that net into the same strip, or
         join strips with a jumper. Tick the net off on a printed copy.
      4. Use consistent wire colours: red for supply, black for ground, other colours for signals.
      5. Before applying power: check for shorts between supply and ground with the continuity range, and check the polarity
         of every LED, diode, electrolytic capacitor and IC.
      6. Power up with the load disconnected first if you can, and measure the rails before trusting anything else.

      ## Worked example: LED on a GPIO

      Schematic: GPIO → R1 (330 Ω) → LED anode; LED cathode → GND. Three nets:

      | Net | Terminals on it | On the breadboard |
      |---|---|---|
      | GPIO | MCU pin, R1 end A | Jumper from the MCU pin to column 10, top half; R1 end A in column 10 |
      | N1 (unnamed) | R1 end B, LED anode | R1 end B and the LED's long lead both in column 14 |
      | GND | LED cathode, MCU ground | LED's short lead in column 15; jumper from column 15 to the blue rail; blue rail to the MCU GND pin |

      The resistor spans columns 10 to 14. The LED spans columns 14 and 15. No part has both leads in the same column.`,

      { t: 'predict', q: `On a breadboard, a resistor is inserted with both of its leads in the same five-hole column, in holes a and c. An LED is in series with it, correctly placed. What happens when power is applied?`,
        reveal: `Both resistor leads sit on the same strip, so the strip shorts the resistor out: current takes the metal clip, not the resistor. The LED is effectively connected with no current limit and will be overdriven. The board looks right at a glance because all the parts are present. The way to catch this before power is to check each part against the rule "two leads, two different strips", and afterwards to measure the voltage across the resistor: 0 V across a resistor that should be carrying current means it is bypassed or no current is flowing.` },

      { t: 'widget', name: 'breadboard', props: { challenge: 'led' }, caption: 'Build the LED circuit: pin IO0 (the switched supply), current-limiting resistor, LED, ground. The virtual board is drawn a quarter-turn from the figure above: its five-hole strips are the numbered rows (a–e and f–j) and the rails run down the sides. The simulation shows current flow and flags shorts.' },

      { t: 'widget', name: 'breadboard', props: { challenge: 'divider' }, caption: 'Build a voltage divider that produces the requested output, and probe the midpoint.' },

      { t: 'callout', kind: 'mistake', md: `**Assuming the rail is powered along its whole length.** A circuit works at one end of the board and an identical one at the other end is dead. The rail is split in the middle. Measure the rail voltage *at the part that is not working*, not at the point where the supply enters.` },

      `## Limits of a breadboard

      A breadboard is for low-speed, low-current prototypes. Know where it stops being trustworthy:

      - **Contact resistance** of a fraction of an ohm per connection, more on worn boards. It matters once currents approach
        an amp: motors and LED strips should be wired directly, not through the board.
      - **Stray capacitance** of a few picofarads between adjacent strips, and inductance in long jumpers. Circuits above a
        few megahertz, fast SPI and sensitive analog front ends misbehave.
      - **Intermittent contacts.** Thin component leads, bent jumpers and worn clips produce faults that come and go when the
        board is touched. This is the most common breadboard fault of all.
      - **No decoupling by default.** You still need the 100 nF at each IC, placed across its supply pins with short leads.`,

      { t: 'callout', kind: 'decision', title: 'Design choice: when to leave the breadboard', md: `Stay on the breadboard while the circuit is still changing. Move to soldered stripboard, perfboard or a small PCB when: currents exceed roughly half an amp; signals exceed a few megahertz; the device has to be moved or run unattended; or you have spent more than one session chasing a fault that changes when you press on the wires.` },

      `## Harder application`,

      { t: 'widget', name: 'breadboard', props: { challenge: 'two-leds' }, caption: 'Two LEDs from one supply. Decide whether they should share a resistor, and build it.' },

      { t: 'exercise', prompt: `Two red LEDs (Vf = 2.0 V each) are to run at 5 mA each from 5 V. Compare (a) each LED with its own resistor, both branches in parallel, and (b) both LEDs in series with a single resistor. For option (b), what resistor value does the calculation give, in ohms?`,
        hints: [`In series the forward voltages add, and the same current flows through both LEDs.`, `R = (5 − 2.0 − 2.0) / 0.005.`],
        solution: `Option (b): R = (5 − 4.0) V / 5 mA = **200 Ω** (fit 220 Ω). Total current drawn is 5 mA. Option (a): each branch needs (5 − 2.0) / 5 mA = 600 Ω (fit 560 or 680 Ω), and the total current is 10 mA. Series uses half the current but leaves only 1 V across the resistor, so brightness is more sensitive to Vf spread, and it would not work at all from 3.3 V (4 V of LED drop exceeds the supply). What you must not do is put two LEDs in parallel on *one* shared resistor: the LED with the slightly lower Vf takes most of the current.`,
        answer: { type: 'number', value: 200, tol: 4, unit: 'Ω' } },

      { t: 'refs', items: [
        { title: 'IEEE Std 315 / ANSI Y32.2: Graphic Symbols for Electrical and Electronics Diagrams', url: 'https://standards.ieee.org/ieee/315/518/', note: 'the symbol standard; IEC 60617 is the international counterpart' },
        { title: 'Espressif: ESP32-DevKitC V4 getting started guide (schematic linked)', url: 'https://github.com/espressif/esp-idf/blob/v5.1/docs/en/hw-reference/esp32/get-started-devkitc.rst', note: 'a real development-board schematic to practise reading: find the regulator, decoupling, strapping resistors and auto-reset transistors. The link is to the v5.1 tree; later ESP-IDF releases moved the board guides out of the repository' },
      ] },
    ],
    quiz: [
      { q: 'On a schematic, two wires cross with no dot at the crossing. They are:', kind: 'circuit', choices: [
        { t: 'Not connected', ok: true, why: 'A junction is shown explicitly by a dot. A plain crossing is two separate nets that happen to pass on the page.' },
        { t: 'Connected', why: 'A connection needs a junction dot. Without one the drawing only shows two wires passing each other.' },
        { t: 'Connected only if they are the same colour', why: 'Schematics carry no meaning in line colour. Connection is shown by dots, labels and shared symbols.' },
      ] },
      { q: 'A schematic has five separate ground symbols with no wires between them. On your breadboard you must:', kind: 'circuit', choices: [
        { t: 'Connect all five points together, since every ground symbol is the same net', ok: true, why: 'Power and ground symbols are a drawing shorthand for one shared net.' },
        { t: 'Leave them separate, exactly as they are drawn on the schematic', why: 'The symbols are separate only to keep the page tidy. Electrically they denote one node.' },
        { t: 'Connect only the ones that are close together on the page', why: 'Position on the page says nothing about connection. All symbols with the same name are joined.' },
      ] },
      { q: 'Which pair of breadboard holes is connected internally (standard layout)?', kind: 'circuit', choices: [
        { t: 'Holes a and e of the same column', ok: true, why: 'The five holes of one column on one side of the gap share a single metal strip.' },
        { t: 'Holes e and f of the same column', why: 'These face each other across the centre gap, which isolates the two halves.' },
        { t: 'Hole a of column 10 and hole a of column 11', why: 'Neighbouring columns are separate strips. Only the power rails run lengthwise.' },
      ] },
      { q: 'A capacitor on a schematic is labelled "4u7". Its value is:', kind: 'concept', choices: [
        { t: '4.7 µF', ok: true, why: 'The multiplier letter stands in the place of the decimal point.' },
        { t: '47 µF', why: 'The letter marks where the decimal point goes: 4, point, 7.' },
        { t: '4.7 nF', why: 'The letter u stands for micro. Nano would be written with an n.' },
      ] },
      { q: 'An IC at the far end of a long breadboard gets no supply voltage, though the rail measures 3.3 V near the power input. The first thing to check is:', kind: 'circuit', choices: [
        { t: 'Whether the power rail is split in the middle and needs a bridging jumper', ok: true, why: 'Many boards break the rails halfway. Voltage near the input and none at the far end is the signature.' },
        { t: 'Whether the IC is faulty and should be replaced', why: 'With no voltage arriving at its supply pin, the IC has not yet been tested at all.' },
        { t: 'Whether the supply can deliver enough current for the whole board', why: 'A weak supply would sag everywhere on the rail, including at the input where it measures correctly.' },
      ] },
      { q: 'Why is a breadboard a poor choice for a motor drawing 2 A?', kind: 'concept', choices: [
        { t: 'Its spring contacts add resistance, so they drop voltage and heat up', ok: true, why: 'At 2 A, even a few tenths of an ohm across several contacts costs volts and can soften the plastic.' },
        { t: 'Breadboards only work with digital signals, and a motor is an analog load', why: 'They carry analog and digital alike. The limits are current, frequency and contact reliability.' },
        { t: 'Motors need AC and breadboards carry only DC', why: 'Small hobby motors are DC devices, and a breadboard is just metal contacts, which pass either.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 12 */
  {
    id: 'elec-power', title: 'Power regulation and decoupling', minutes: 55,
    summary: 'Getting a clean, stable supply to every chip, and knowing how much current and heat are involved.',
    skills: ['elec-power-budget', 'elec-cap-select'],
    blocks: [
      `## The problem

      A sensor node runs perfectly while it only reads its sensor. The moment the firmware starts Wi-Fi, it resets. The serial
      log shows a brown-out message, or just the boot banner again and again. The code is not at fault. For a few hundred
      microseconds the supply voltage at the chip dropped below what the chip needs.`,

      `## What a regulator does

      A **voltage regulator** takes a higher or varying input voltage and holds a fixed output voltage as the load current
      changes. There are two families.

      ### Linear regulators and LDOs

      A linear regulator is a transistor in series between input and output, controlled by a feedback loop so that the output
      stays constant. It behaves as an automatically adjusted resistor.

      All the load current flows through that transistor, and the difference between input and output voltage appears across
      it. So it dissipates

      **P heat = (Vin − Vout) × I load**

      as heat, always. Its efficiency is at best Vout / Vin.

      **Dropout voltage** is the minimum difference Vin − Vout at which it can still regulate. Below that the output falls
      with the input. An **LDO** (low-dropout regulator) is a linear regulator designed for a small dropout: a few hundred
      millivolts or less. Older designs need a volt or more. The dropout is given in the datasheet at a stated current and
      rises with load.

      Linear regulators are simple, cheap, and electrically quiet.

      ### Switching regulators

      A switching regulator (a **buck** converter steps down, a **boost** steps up) uses a transistor as a fast on-off switch
      with an inductor and capacitor to transfer energy in packets. Because the switch is always fully on or fully off, little
      power is lost: efficiencies of 85 to 95 % are normal.

      Since power out ≈ power in × efficiency, a buck converter draws *less* input current than it delivers:

      **I in ≈ (Vout × I out) / (Vin × efficiency)**

      The cost: more parts (an inductor), careful layout, and switching ripple and radiated noise at hundreds of kilohertz to
      megahertz, which can disturb ADCs and radios.

      | | Linear / LDO | Switching (buck) |
      |---|---|---|
      | Efficiency | Vout / Vin at best | 85–95 % typical |
      | Heat | (Vin − Vout) × I | Small |
      | Output noise | Very low | Ripple at the switching frequency |
      | Parts | Regulator and two capacitors | Regulator, inductor, capacitors, sometimes a diode |
      | Good for | Small voltage drop, low current, noise-sensitive analog | Large voltage drop, high current, battery life |`,

      { t: 'figure', svg: figLdo, caption: 'A linear regulator with its input and output capacitors, and a decoupling capacitor at the load. The regulator datasheet specifies the capacitor values and types it needs to remain stable.' },

      `## Worked example: the heat in an LDO

      A 3.3 V LDO is fed from USB at 5 V and supplies 300 mA.

      - P heat = (5 − 3.3) × 0.3 = **0.51 W**
      - Useful power delivered: 3.3 × 0.3 = 0.99 W. Efficiency: 66 %.

      Is 0.51 W acceptable? That depends on the package. The datasheet gives the junction-to-ambient **thermal resistance**
      θJA in °C per watt. Temperature rise = P × θJA. For a regulator in a mid-sized surface-mount package on a board with
      modest copper, θJA might be in the region of 60 to 100 °C/W (take the real figure and its conditions from the
      datasheet). At 90 °C/W: a rise of 46 °C above ambient, so about 70 °C in a 25 °C room. Hot to touch, but inside a
      typical junction limit of 125 °C. In a sealed box at 50 °C ambient there is much less margin.

      Feed the same regulator from 12 V: (12 − 3.3) × 0.3 = 2.6 W, a calculated rise of over 230 °C. It will overheat and shut
      down, or fail. That is the case for a switching regulator.`,

      { t: 'predict', q: `A board uses a linear regulator with a dropout of about 1.1 V to produce 3.3 V. You power the board from a single lithium cell (4.2 V full, 3.7 V nominal, 3.0 V empty) connected to the regulator input. What happens over a discharge?`,
        choices: [
          { t: 'It works properly until the cell voltage falls to 3.3 V', why: `The regulator needs its input to exceed the output by the dropout. It stops regulating well before input and output are equal.` },
          { t: 'It never gives a proper 3.3 V: the output is low from the start', ok: true, why: `Yes. 3.3 V plus 1.1 V of dropout needs 4.4 V at the input, more than a full cell provides.` },
          { t: 'It works for the whole discharge, because 3.7 V nominal is above 3.3 V', why: `Being above the output voltage is not enough. The regulator consumes its dropout voltage before anything reaches the output.` },
        ],
        reveal: `The regulator needs Vin ≥ Vout + dropout = 4.4 V. Even a full cell at 4.2 V is short. The output simply tracks the input minus the dropout: roughly 3.1 V at full charge, falling from there. The board may run for a while, with every 3.3 V part under-supplied, the radio marginal and the ADC reference wrong. For battery operation you need a true low-dropout part (a couple of hundred millivolts at your load current), which gets you down to a cell voltage of about 3.5 V, or a buck-boost converter that holds 3.3 V over the whole cell range. Always check the regulator on a development board before assuming it suits a battery.` },

      { t: 'exercise', prompt: `An LDO drops 5 V to 3.3 V for a load that averages 180 mA. How much power does the regulator dissipate, in watts?`,
        hints: [`The regulator carries the full load current and has the voltage difference across it.`, `P = (Vin − Vout) × I.`],
        solution: `P = (5 − 3.3) × 0.18 = **0.306 W**. With a package of θJA = 90 °C/W that is a 28 °C rise: comfortable. Note that it is the *average* current that sets the heating, because the package's thermal mass smooths out millisecond bursts; it is the *peak* current that sets whether the voltage holds up.`,
        answer: { type: 'number', value: 0.306, tol: 0.008, unit: 'W' } },

      `## Current budgets

      Add up what everything draws, in the worst case, and compare with what the source can deliver.

      **USB as a supply.** A standard USB 2.0 port provides 5 V and up to **500 mA** to a configured device (100 mA before
      configuration; USB 3.x ports allow 900 mA; USB-C and charging ports can offer more by negotiation or signalling). A
      simple development board does not negotiate anything, so treat 500 mA as the budget from a computer port, and less from
      an unpowered hub. Many ports protect themselves by cutting off when overloaded.

      **Peak against average.** A radio-equipped microcontroller draws tens of milliamps on average but several hundred
      milliamps in short bursts when transmitting. Espressif's hardware design guidelines state a minimum current the supply must be
      able to deliver for this reason; a figure of 500 mA or more is widely quoted for ESP32-class chips, but that document
      could not be opened while this course was written, so read the requirement there. The peak figure for a given chip
      and mode is in its datasheet's current consumption tables.

      A budget for a small USB-powered node might look like this (illustrative values; use datasheet figures for your parts):

      | Consumer | Peak | Note |
      |---|---|---|
      | Wi-Fi MCU module | several hundred mA | Transmit bursts; see datasheet |
      | Sensor | 2 mA | |
      | Three indicator LEDs | 15 mA | 5 mA each |
      | Small servo | 500 mA and more when starting | Should not share this budget |
      | USB port limit | 500 mA | |

      The servo alone can consume the whole budget. Loads like motors and servos get their own supply, with the grounds
      joined.`,

      `## Brown-out

      When the load current steps up suddenly, three things stand between the source and the chip: the resistance of cables
      and connectors, the inductance of the wiring, and the response time of the regulator, which takes microseconds to react.
      During that time the rail voltage dips.

      A **brown-out** is a temporary dip of the supply below the chip's minimum operating voltage. Logic running below its
      minimum voltage behaves unpredictably: corrupted memory writes, wrong branches. So microcontrollers include a
      **brown-out detector** that holds the chip in reset when the supply falls below a threshold. The reset you see is the
      protection working. The thing to fix is the dip.

      Causes, in rough order of frequency: a thin or long USB cable; a weak port or hub; too little bulk capacitance near the
      module; a motor or servo sharing the logic supply; a regulator that is too small or in dropout; breadboard contact
      resistance.`,

      { t: 'widget', name: 'circuit-debug', props: { scenario: 'brownout' }, caption: 'This board resets under load. Measure the rail at several points while the load switches, and find where the voltage is being lost.' },

      `## Decoupling: why 100 nF at every IC

      Zoom in from milliseconds to nanoseconds. Every time a digital chip's internal logic switches, it draws a spike of
      current lasting a nanosecond or so. That current must come from somewhere.

      The supply path, back through tracks and wires to the regulator, has **inductance**: roughly a nanohenry per millimetre
      of track or wire. Recall V = L × dI/dt. A current step of 100 mA in 1 ns through just 10 nH (a centimetre of track)
      gives 0.01 µH × 0.1 A / 1 ns = 1 V. The supply pin would dip by a volt on every switching edge.

      A **decoupling capacitor** placed right at the supply pin, from the pin to ground, is a local reservoir. It supplies the
      nanosecond spike from its stored charge through a path only millimetres long, with very little inductance. The
      regulator then refills the capacitor at leisure.

      That explains every rule of thumb:

      - **One per supply pin**, because each pin is a separate point of demand.
      - **As close to the pin as possible, with a short path to ground**, because the inductance of the path is the enemy.
        A capacitor 5 cm away on a breadboard jumper is a long way off in these terms.
      - **Ceramic**, because ceramics have low internal inductance and resistance and respond quickly. An electrolytic is too
        slow for this job.
      - **100 nF**, because it holds far more charge than a switching event needs, while being physically small with a high
        self-resonant frequency. It is a convention more than a calculated value; follow the chip's datasheet if it asks for
        something else.

      **Bulk capacitance** handles the slower, larger demands: the hundreds of microseconds of a radio burst, before the
      regulator and the cable catch up. A 10 µF to 100 µF (or larger) capacitor near the module supplies that. The two types
      work together: small and close for fast, large and nearby for slow.

      The other half of decoupling is keeping noise *in*: the capacitor stops one chip's switching spikes from travelling
      along the rail to its neighbours and into your ADC.`,

      { t: 'callout', kind: 'mistake', md: `**Treating decoupling capacitors as optional because "it works without them".** Without them a circuit often does work, on the bench, at room temperature, with this firmware. The failures are intermittent: an occasional corrupted I2C byte, an ADC with unexplained noise, a reset once a day. They are among the hardest faults to trace back, and the capacitors cost almost nothing. Fit them before you have a reason to.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: LDO or buck?', md: `Compute the LDO's heat first: (Vin − Vout) × I. Below about a quarter of a watt and with mains or USB power, use the LDO: fewer parts, no switching noise. From a battery where every milliamp-hour counts, or where the drop is large (12 V to 3.3 V) or the current high, use a buck converter. Where both efficiency and low noise matter, a buck brings the voltage down to just above the target and an LDO finishes the job.` },

      `## Battery life estimate

      Battery capacity is quoted in milliamp-hours (mAh). To a first approximation:

      **run time (hours) = capacity (mAh) / average current (mA)**

      The average current of a device that sleeps most of the time is a weighted average over its duty cycle:

      **I avg = (I active × t active + I sleep × t sleep) / (t active + t sleep)**

      Treat the result as an upper bound: usable capacity is reduced by regulator losses, the cut-off voltage, temperature,
      self-discharge and age. Derating to 70–80 % is a reasonable first allowance.`,

      { t: 'exercise', prompt: `A sensor node wakes every 60 s. It is active for 2 s drawing 80 mA, and sleeps the remaining 58 s drawing 0.5 mA. It is powered from a 2000 mAh battery. Ignoring losses, how many hours does it run?`,
        hints: [`Find the average current over one 60 s cycle first.`, `I avg = (80 × 2 + 0.5 × 58) / 60.`, `Then divide the capacity by the average.`],
        solution: `I avg = (160 + 29) / 60 = 3.15 mA. Run time = 2000 / 3.15 = **635 hours**, about 26 days. Look at where the charge goes: 160 parts to the active burst, 29 to sleep. Halving the active time to 1 s gives (80 + 29.5) / 60 = 1.83 mA and 46 days. And the 0.5 mA sleep current is poor: a board whose regulator and power LED are designed for low power can sleep at tens of microamps, at which point the active burst is all that matters.`,
        answer: { type: 'number', value: 635, tol: 8, unit: 'h' } },

      `## Harder application`,

      { t: 'exercise', prompt: `A device needs 3.3 V at 500 mA and is powered from a 12 V supply. With a buck converter that is 90 % efficient, how much current does it draw from the 12 V supply, in milliamps?`,
        hints: [`Work in power. Output power = 3.3 V × 0.5 A.`, `Input power = output power / 0.9. Then divide by 12 V.`],
        solution: `P out = 1.65 W. P in = 1.65 / 0.9 = 1.833 W. I in = 1.833 / 12 = 0.153 A = **153 mA**. The converter wastes 0.18 W. A linear regulator in the same job would draw the full 500 mA from the 12 V supply and waste (12 − 3.3) × 0.5 = 4.35 W, twenty-four times as much. This is also why a thin cable is less of a problem at 12 V than at 5 V: the same power needs less current, so the cable drops less.`,
        answer: { type: 'number', value: 153, tol: 3, unit: 'mA' } },

      { t: 'refs', items: [
        { title: 'Texas Instruments: Linear and Switching Voltage Regulator Fundamentals (SNVA558)', url: 'https://www.ti.com/lit/an/snva558/snva558.pdf', note: 'dropout, efficiency, topologies' },
        { title: 'Texas Instruments: Understanding the Terms and Definitions of LDO Voltage Regulators (SLVA079)', url: 'https://www.ti.com/lit/an/slva079/slva079.pdf', note: 'dropout, thermal resistance, capacitor requirements' },
        { title: 'Espressif: ESP32 Hardware Design Guidelines', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_hardware_design_guidelines_en.pdf', note: 'power supply current requirement and decoupling recommendations; could not be opened from the authoring environment, so nothing in this lesson is quoted from it as verified' },
        { title: 'Analog Devices MT-101: Decoupling Techniques', url: 'https://www.analog.com/media/en/training-seminars/tutorials/MT-101.pdf', note: 'why local decoupling works and how to place it' },
        { title: 'USB-IF: USB 2.0 Specification', url: 'https://www.usb.org/document-library/usb-20-specification', note: 'chapter 7: bus-powered device current limits' },
      ] },
    ],
    quiz: [
      { q: 'A linear regulator takes 9 V in and supplies 5 V at 200 mA. Its heat dissipation and efficiency are about:', kind: 'circuit', choices: [
        { t: '0.8 W and 56 %', ok: true, why: 'Heat is (9 − 5) × 0.2. Efficiency of a linear regulator is the output voltage over the input voltage.' },
        { t: '1.0 W and 100 %', why: 'One watt is the power delivered to the load. The regulator must also get rid of the voltage difference times the current.' },
        { t: '1.8 W and 44 %', why: '1.8 W is the total input power. The heat in the regulator is only the part that does not reach the load.' },
      ] },
      { q: 'What does "dropout voltage" mean for a regulator?', kind: 'concept', choices: [
        { t: 'The smallest input-to-output difference at which it still regulates', ok: true, why: 'Below that headroom the pass transistor is fully on and the output simply follows the input downward.' },
        { t: 'The amount by which the output voltage drops when the load is connected', why: 'That is load regulation, usually millivolts. Dropout concerns how much input headroom the regulator needs.' },
        { t: 'The input voltage at which the regulator switches off', why: 'A regulator in dropout does not switch off. It keeps conducting with an output that is too low.' },
      ] },
      { q: 'A board resets when its radio transmits, only when powered through a particular 3 m USB cable. Most likely cause:', kind: 'circuit', choices: [
        { t: 'The cable resistance drops enough voltage during the burst to cause dropout', ok: true, why: 'Voltage lost in the cable is current times resistance, and both are at their worst during a transmit burst on a long, thin cable.' },
        { t: 'The long cable corrupts the firmware image as it is uploaded to the board', why: 'Corrupted uploads fail verification. A reset tied to radio activity points at the supply, not the stored program.' },
        { t: 'The radio signal travels back down the cable and confuses the computer\'s USB port', why: 'The symptom is a local reset coinciding with peak current draw, which is a supply dip.' },
      ] },
      { q: 'Why must a decoupling capacitor be a ceramic placed millimetres from the supply pin?', kind: 'concept', choices: [
        { t: 'Extra path length adds inductance, which delays the current it must deliver', ok: true, why: 'The voltage dip is L × dI/dt. Shortening the path reduces L, which is the only term the designer controls.' },
        { t: 'Ceramic capacitors hold more charge than electrolytics of the same value', why: 'Equal capacitance means equal charge per volt. The difference is how quickly that charge can be delivered.' },
        { t: 'It shields the supply pin from radio interference picked up by nearby tracks', why: 'A capacitor is not a shield. It is a local source of charge and a low-impedance path for high-frequency current.' },
      ] },
      { q: 'A device draws 150 mA for 1 s and then sleeps at 50 µA for 9 s, repeatedly. Its average current is about:', kind: 'circuit', choices: [
        { t: '15 mA', ok: true, why: '(150 × 1 + 0.05 × 9) / 10 = 15.05 mA. The active burst dominates completely.' },
        { t: '75 mA', why: 'A plain average of the two currents ignores how long each lasts. The time in each state is the weight.' },
        { t: '50 µA', why: 'The sleep current is the level for most of the time, but the brief active burst carries nearly all of the charge.' },
      ] },
      { q: 'You need 3.3 V at 1 A from a 24 V supply. Which regulator, and why?', kind: 'arch', choices: [
        { t: 'A buck converter, because a linear regulator would have to dissipate over 20 W', ok: true, why: '(24 − 3.3) × 1 A = 20.7 W of heat in a linear part, against a watt or less in a switcher.' },
        { t: 'An LDO, because a low dropout voltage means low heat dissipation', why: 'Low dropout only means it can work with little headroom. The heat still equals the actual voltage difference times the current.' },
        { t: 'A resistor divider from 24 V', why: 'A divider output changes with load current. It cannot hold 3.3 V for a load that varies.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ 13 */
  {
    id: 'elec-faults', title: 'Grounding and common electrical faults', minutes: 45,
    summary: 'Why every circuit needs a shared reference, and the short list of faults behind most dead prototypes.',
    skills: ['elec-fault-find', 'elec-multimeter'],
    blocks: [
      `## The problem

      Two boards, each working on its own. One sends UART data to the other over a single wire from TX to RX. The receiver
      prints garbage, or nothing. Each board is powered from a different source. The wire is intact, the baud rates match, the
      code is right. One connection is missing, and it is not a signal.`,

      `## Ground is a reference and a return path

      Two facts from the first lessons combine here:

      - A voltage exists only *between two points*. "3.3 V on TX" means 3.3 V between TX and the sender's ground.
      - Current flows only in a *closed loop*. Whatever flows out along the signal wire must return to its source.

      The receiver compares the RX voltage with *its own* ground. If the two grounds are not connected, there is no defined
      relationship between them: the boards float relative to each other, the receiver's view of the signal is whatever stray
      capacitance and leakage make it, and no signal current can flow because there is no return path.

      **Every pair of boards that exchange signals must share a ground connection**, in addition to the signal wires. The
      exception is deliberate isolation with optocouplers, transformers or digital isolators, which carry the information
      across by light or magnetic field.`,

      { t: 'figure', svg: figCommonGround, caption: 'A signal is a loop: out on the signal wire, back on ground. Two boards with separate supplies need the ground wire to complete it.' },

      { t: 'predict', q: `Board A (powered from a laptop's USB) drives a low-side MOSFET on board B, which switches a 12 V lamp from its own 12 V adapter. The GPIO goes to the MOSFET gate. There is no wire between the two grounds. What does the lamp do?`,
        reveal: `It is unpredictable. The MOSFET responds to the voltage between its gate and its *source*, and the source is on the 12 V adapter's ground. With no connection between the grounds, the GPIO's 3.3 V is 3.3 V relative to something else entirely. The gate-to-source voltage is set by stray capacitance and leakage through the two power supplies. The lamp may stay off, glow dimly, flicker with mains hum, or switch when you touch the board. Add one wire between the grounds and it works. This was the missing connection in the opening problem too.` },

      { t: 'widget', name: 'circuit-debug', props: { scenario: 'missing-ground' }, caption: 'The same missing connection in its most common breadboard form: an LED whose cathode is plugged into the − rail, and no current flows. Measure what that "ground" rail reads against the board\'s GND pin, in volts and on the continuity range.' },

      `## Ground is not perfectly 0 V

      Ground wires have resistance and inductance like any conductor. When current flows in a ground wire, a voltage appears
      along it (V = I × R). Two points both labelled "ground" can differ by millivolts, or by hundreds of millivolts if a
      motor current shares the path.

      That matters when a large current and a sensitive signal share a ground wire. If a motor's 2 A return current flows
      through 50 mΩ of ground wiring that a sensor also uses as its reference, the sensor's ground shifts by 100 mV whenever
      the motor runs. The ADC sees that as a 100 mV signal.

      The remedy is to control where the current flows:

      - Give heavy loads (motors, LED strips, relays) their own supply *and their own return wire* straight back to the power
        source.
      - Join the grounds at **one point**, near the supply: a **star ground**. The heavy current then does not flow through
        the wires that the logic and sensors use as their reference.
      - Keep the ground wire for a sensor short and run it alongside its signal wire.

      ## Ground loops, briefly

      If two pieces of equipment are connected by more than one ground path (through a signal cable's ground *and* through
      their mains earth connections, for instance), the paths form a loop. Stray magnetic fields induce a current in that loop,
      and differences in earth potential between sockets drive one too. The current flowing in the signal ground adds a
      voltage to the signal: the classic 50 or 60 Hz hum in audio, or offsets and noise in measurements.

      On a single bench with low-voltage boards, ground loops are rarely your problem. They become one with long cables,
      mains-earthed instruments such as oscilloscopes and bench supplies, and audio. The fixes are to break the loop (single
      ground path, isolation) or to make the signal immune to it (differential signalling, as RS-485, CAN and USB use).`,

      { t: 'callout', kind: 'warn', md: `An oscilloscope's probe ground clip is normally connected to mains earth through the instrument. Clipping it to a point in your circuit that is not at earth potential shorts that point to earth through the clip. With a laptop-powered board this is usually harmless, since USB ground is the circuit ground; with mains-powered or earthed supplies it can produce a large current. Clip the ground lead only to the circuit's ground.` },

      `## The common faults

      Most prototype failures are one of a short list. Knowing the signature of each turns debugging from guesswork into
      elimination.

      | Fault | What it is | Signature |
      |---|---|---|
      | **Short circuit** | An unintended low-resistance path, most seriously between supply and ground | Rail voltage collapses to near 0 V; regulator or a wire gets hot; USB port disconnects |
      | **Open circuit** | A connection that should exist does not: loose jumper, split rail, wrong row, broken wire | Supply voltage present on one side of the break and absent on the other; part does nothing |
      | **Reversed polarity** | A polarised part or the whole supply connected backwards | LED dark with full voltage across it; electrolytic capacitor hot; IC hot and often destroyed |
      | **Floating pin** | An input with nothing defining its level | Reading changes with touch or nearby movement; voltage reads mid-range and drifts |
      | **Missing common ground** | Two boards with no shared reference | Garbage or nothing on links; changes when you touch things or connect a scope |
      | **Wrong rail / wrong voltage** | A part on 5 V that should be on 3.3 V, or the reverse | Part hot or dead (too high); marginal, resets or wrong readings (too low) |
      | **Wrong value** | 10 Ω in place of 10 kΩ; 100 pF in place of 100 nF | Current far from the calculated value; timing off by factors of ten |
      | **Wrong pin** | Off by one row, or pin numbering read from the wrong view | A neighbouring signal responds instead |
      | **Insufficient supply** | Source cannot deliver the peak current | Resets under load; voltage dips when a load switches |
      | **Intermittent contact** | Worn breadboard clip, thin lead, cracked joint | Works when pressed or wiggled; fails on a schedule of its own |`,

      `## A method that works on any of them

      **Measure, hypothesise, test.** In that order, and one change at a time.

      1. **State the symptom precisely.** Not "it does not work", but "the LED does not light when GPIO5 is high".
      2. **Measure before touching anything.** Start with power: is the supply voltage correct *at the part*, between its
         supply pin and its ground pin? A large share of faults ends here.
      3. **Follow the signal.** Work from where things are known good towards where they are bad. The fault lies between the
         last correct measurement and the first incorrect one.
      4. **Form one hypothesis** that explains *all* the measurements. "The LED is reversed" explains a dark LED with 3.3 V
         across it. It does not explain a dark LED with 0 V across it.
      5. **Predict what a test will show** if the hypothesis is true, then make that one test or change.
      6. **If the prediction fails, the hypothesis is wrong.** Undo the change. Do not stack a second change on a failed
         first.
      7. **Write down what you found.** The same fault will return in a different circuit.

      Use **half-splitting** on long chains: measure in the middle. If the middle is good, the fault is in the second half;
      if not, the first. Each measurement halves what is left to search.

      ## Reading voltages as evidence

      In a series path carrying no current, there is no voltage across any resistor, so the full supply appears across the
      *break*. That gives a powerful rule for a simple series circuit such as supply → resistor → LED → ground:

      | Measurement | Conclusion |
      |---|---|
      | 0 V across the resistor, full supply across the LED | No current, and the LED is the open element: reversed, dead, or not making contact |
      | Full supply across the resistor, about 0 V across the LED | Current is flowing but bypasses the LED: the LED is shorted, or both of its leads are in the same strip |
      | 0 V across both | No supply is reaching the circuit, or the ground side is open. Measure the supply at the circuit |
      | About Vf across the LED and the remainder across the resistor | The circuit is working. If the LED is dark, the current is too small: check the resistor value |`,

      { t: 'exercise', prompt: `A series circuit runs from 3.3 V through a 330 Ω resistor and a red LED to ground. The LED is dark. You measure 3.3 V between the supply and ground at the circuit, 0.00 V across the resistor and 3.30 V across the LED. Name the most likely fault in one or two words.`,
        hints: [`0 V across the resistor means no current is flowing through it (V = I × R).`, `With no current, all of the supply voltage appears across whichever element is blocking. Which element has 3.3 V across it?`, `What would make an LED block current while still being connected at both ends?`],
        solution: `The **LED is reversed** (or has failed open). No current flows, so the resistor drops nothing, and the entire 3.3 V appears across the element that is blocking. A reversed LED blocks like any reverse-biased diode. A correctly fitted, working LED could never have 3.3 V across it: it would conduct and settle at about 2 V. The test: reverse it, and predict roughly 2.0 V across the LED and 1.3 V across the resistor.`,
        answer: { type: 'text', accept: ['.*revers.*', '.*backward.*', '.*polarity.*', '.*wrong way.*', '.*open.*led.*', '.*led.*open.*'], nudge: 'Think about which part has the whole supply across it, and what state that part must be in to block current.' } },

      { t: 'callout', kind: 'mistake', md: `**Changing several things at once, or swapping parts before measuring.** If you rewire three connections and it starts working, you do not know which one was wrong, and you may have masked a second fault. If it still fails, you may have added a new one. Swapping a "probably dead" chip without finding out why it died gives you two dead chips. Measure first; change one thing; observe.` },

      { t: 'callout', kind: 'hw', md: `**Using a multimeter safely.** *Voltage*: probes across (in parallel with) the part, circuit powered. *Continuity and resistance*: circuit **unpowered**, since the meter supplies its own small test current, and other parts in parallel with the one you measure affect the reading. *Current*: the meter goes in **series**, in a break in the circuit, with the red lead moved to the current socket. On its current range a meter is nearly a short circuit. Leaving the lead in the current socket and then measuring a voltage shorts the supply through the meter and blows its fuse. Move the lead back as soon as you finish.` },

      { t: 'callout', kind: 'decision', title: 'Design choice: build so that faults are easy to find', md: `Build in stages and test each before adding the next: power first, then the microcontroller, then one peripheral at a time. Keep supply wires red and ground black. Add a power LED. Bring important signals to a place where a probe can reach them. Keep the wiring flat and short enough to trace by eye. When a fault appears, it is then almost certainly in the part you just added.` },

      `## Harder application

      A board has a 3.3 V regulator feeding a microcontroller, a sensor on I2C and an LED. On power-up nothing works. The
      regulator is too hot to touch, and its output measures 0.4 V. The input measures 5.0 V.`,

      { t: 'exercise', prompt: `Which class of fault do these three measurements point to: a hot regulator, correct input voltage, and an output near zero? Answer in two or three words.`,
        hints: [`A regulator gets hot when it passes a large current while dropping a large voltage.`, `What kind of load would pull the output down to nearly zero in spite of the regulator trying to hold 3.3 V?`],
        solution: `A **short circuit on the 3.3 V rail** (output to ground, or a very heavy load such as a reversed IC or reversed electrolytic). The regulator is in current limit, delivering its maximum current into a near-short: almost the entire 5 V is across it, hence the heat. To locate it, remove power and use half-splitting: disconnect the loads from the rail one at a time (sensor, LED branch, microcontroller) and measure the resistance from the rail to ground after each. When the resistance jumps from a few ohms to a high value, the last thing removed contains the short. Look there for a solder bridge, a jumper in the wrong row, or a polarised part fitted backwards.`,
        answer: { type: 'text', accept: ['.*short.*', '.*overload.*', '.*over-?current.*'], nudge: 'Something is drawing far more current from the 3.3 V rail than the regulator can supply.' } },

      { t: 'refs', items: [
        { title: 'Analog Devices MT-031: Grounding Data Converters and Solving the Mystery of "AGND" and "DGND"', url: 'https://www.analog.com/media/en/training-seminars/tutorials/MT-031.pdf', note: 'return currents, star grounding' },
        { title: 'Texas Instruments: Analog Engineer\'s Pocket Reference', url: 'https://www.ti.com/seclit/eb/slyw038c/slyw038c.pdf', note: 'conductor resistance and other quick references' },
        { title: 'Fluke: multimeter safety and measurement basics', url: 'https://www.fluke.com/en-us/learn/blog/digital-multimeters/how-to-use-a-multimeter', note: 'correct lead positions for voltage, resistance and current' },
      ] },
    ],
    quiz: [
      { q: 'Two boards are powered from separate batteries and joined only by a TX-to-RX wire. Why does the link fail?', kind: 'circuit', choices: [
        { t: 'The receiver has no shared reference: its ground is unrelated to the sender\'s', ok: true, why: 'A voltage needs two points. Without a shared ground there is neither a common reference nor a return path for the signal current.' },
        { t: 'Batteries cannot supply the brief current pulses that a serial link needs', why: 'The power source is irrelevant to the link. What matters is that both ends share a reference.' },
        { t: 'A second signal wire is needed to carry the inverted data alongside the first', why: 'Single-ended links such as UART need one signal wire plus ground. Paired inverted signals belong to differential links.' },
      ] },
      { q: 'A motor and a temperature sensor share one thin ground wire back to the supply. The temperature reading jumps at the instant the motor starts and jumps back the instant it stops. Why?', kind: 'circuit', choices: [
        { t: 'Motor current in the shared wire shifts the sensor\'s ground', ok: true, why: 'Current times wire resistance appears as a voltage in series with the sensor signal.' },
        { t: 'The running motor heats the sensor, and the reading follows the temperature', why: 'Thermal effects take seconds to minutes. A shift that tracks the motor switching instantly is electrical.' },
        { t: 'The sensor is defective and happens to fail at that moment', why: 'A reading that changes exactly when another load switches points at something they share, here the ground wire.' },
      ] },
      { q: 'A rail that should be 5 V measures 0.3 V and the USB port has disconnected. Which fault class fits best?', kind: 'circuit', choices: [
        { t: 'A short circuit between supply and ground', ok: true, why: 'A collapsed rail together with the source protecting itself means the load is taking far more current than it should.' },
        { t: 'An open circuit in the ground wire', why: 'An open circuit stops current. The rail would then sit at its full voltage, with nothing drawn.' },
        { t: 'A floating input', why: 'A floating input causes erratic logic readings and microamps of extra current, not a collapsed supply.' },
      ] },
      { q: 'In a series circuit of supply, resistor and LED, you measure the full supply across the resistor and nearly 0 V across the LED. The LED is dark. What is happening?', kind: 'circuit', choices: [
        { t: 'Current is flowing, but through a path that bypasses the LED', ok: true, why: 'Voltage across the resistor proves current flows. Zero volts across the LED means the current has an easier path around it.' },
        { t: 'The LED is reversed, so the resistor takes the whole supply instead', why: 'A reversed LED blocks current, so the resistor would show 0 V and the LED the full supply.' },
        { t: 'The supply is disconnected from the circuit', why: 'With no supply there would be no voltage across the resistor either.' },
      ] },
      { q: 'You suspect one of six cascaded modules is faulty. The most efficient first measurement is:', kind: 'concept', choices: [
        { t: 'The signal between modules 3 and 4', ok: true, why: 'Measuring at the midpoint eliminates half of the chain whichever way the result falls.' },
        { t: 'The output of module 1', why: 'Checking from one end can take up to five measurements. A good result here rules out only one module.' },
        { t: 'Replace all six modules', why: 'Replacement without measurement removes the evidence and may leave the real cause, such as a supply fault, in place.' },
      ] },
      { q: 'A multimeter\'s red lead is in the current (A) socket and you touch the probes across a battery to check its voltage. What happens?', kind: 'concept', choices: [
        { t: 'The meter is nearly a short circuit, so a large current flows', ok: true, why: 'A current range has very low resistance so that it does not disturb a series circuit. Across a source, that is a short.' },
        { t: 'The meter shows the battery voltage as usual, perhaps reading slightly low', why: 'The socket determines the internal path. The current socket routes through a low-value shunt, not the high-resistance voltage input.' },
        { t: 'The meter shows zero and nothing else happens', why: 'The display may show little, but the battery is delivering its short-circuit current through the meter.' },
      ] },
    ],
  },
];
