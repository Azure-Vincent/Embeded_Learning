// Debugging, part A: bench instruments and the debug UART.
// Nothing here was run on physical hardware. Host programs marked host-tested were compiled and run with gcc.

const skills = [
  { id: 'dbg-dmm-use', name: 'Choose the right multimeter mode and interpret what the reading does and does not prove', track: 'hardware' },
  { id: 'dbg-scope-setup', name: 'Set up probe, timebase and trigger on an oscilloscope to capture an analog fault', track: 'hardware' },
  { id: 'dbg-la-capture', name: 'Choose sample rate, threshold and trigger for a logic-analyser capture and decode it', track: 'hardware' },
  { id: 'dbg-uart-find', name: 'Find and safely connect to the debug UART of an unfamiliar board', track: 'hardware' },
];

const lessons = [
  // ------------------------------------------------------------------ 1
  {
    id: 'dbg-multimeter', title: 'Measure before you guess: method and the multimeter', minutes: 35,
    summary: 'A debugging method that converges, and what each multimeter mode actually tells you.',
    skills: ['dbg-dmm-use'],
    blocks: [
      `## The problem

You solder a board, plug it in, and nothing happens. No LED, no serial output. There are a few hundred things that could be wrong: a regulator, a solder bridge, a reversed part, the firmware, the cable, the USB port.

Changing things at random does not converge. Each change you make without a measurement adds a second unknown to the first. The method that does converge is the same one used for software, applied to voltages:

1. **State what should be true.** "The 3V3 net should be at 3.3 V. The reset pin should be high. The crystal should be oscillating."
2. **Measure the cheapest, most dividing fact first.** A fact is dividing if either answer removes about half the possibilities. "Is there 3.3 V on the MCU's supply pin?" is dividing. "Does it work if I reflash?" is not.
3. **Write down what you measured**, with the probe points. Memory is a poor instrument.
4. **Change one thing**, and predict the result before you look.

The order that pays off on a dead board is: **power, reset, clock, then code.** A processor with a bad rail, held in reset or with no clock does not run any instruction, so nothing you do in firmware can matter yet.`,
      { t: 'callout', kind: 'why', md: `Each instrument in this section answers a different kind of question. A multimeter answers "what is the *average* level here?". An oscilloscope answers "what is the *shape* of this voltage over time?". A logic analyser answers "what *bits* went past?". A debug probe answers "what is the *processor* doing?". Most wasted bench time comes from asking one instrument a question that belongs to another.` },
      `## Theory: what a multimeter is

A digital multimeter (DMM) is a slow, accurate voltmeter with circuits in front of it that turn other quantities into a voltage. It takes a few readings per second and shows you an average over each one. The mode you select decides what is connected to your circuit, and that is the part people get wrong.

| Mode | What the meter does to your circuit | Circuit powered? | What the reading tells you |
|---|---|---|---|
| DC volts | Connects a very high resistance (typically around 10 MΩ) between the probes | Yes | Average voltage between the two points |
| Continuity | Sources a small test current and beeps when resistance is below a few tens of ohms | **No** | Two points are the same net, or shorted |
| Resistance | Sources a known small current, measures the voltage it produces | **No** | Resistance of *everything* between the probes, including parallel paths |
| Diode | Sources about a milliamp and shows the voltage drop | **No** | Forward voltage of a junction (roughly 0.5–0.7 V silicon, about 0.2–0.4 V Schottky, higher for LEDs); "OL" in reverse |
| DC current | Puts a small **shunt resistor** between the probes and measures the drop across it | Yes, with the meter in *series* | Average current through the meter |

Three consequences follow directly.

**Voltage is measured in parallel, current in series.** In volts mode the meter is nearly an open circuit, so touching it across a part changes almost nothing. In current mode it is nearly a short circuit, so it must replace a piece of wire. If you put a meter in current mode across a power rail, you have shorted the rail through the meter's fuse.

**Resistance and continuity need the power off.** Both work by injecting the meter's own current. A powered circuit adds its own, and the reading means nothing. You can also push current into a pin that did not expect it.

**In-circuit resistance is never just one part.** The meter measures every path between the probes. A 10 kΩ pull-up measured on the board has the rest of the circuit in parallel with it, so it reads 10 kΩ *or less*.`,
      { t: 'ascii', text: `   VOLTS: meter in parallel            CURRENT: meter in series
                                         (break the circuit, meter bridges the gap)
   3V3 ----+--------[ load ]---+         3V3 ----(A)-----[ load ]---+
           |                   |              shunt inside           |
          (V) ~10 Mohm         |              the meter              |
           |                   |                                     |
   GND ----+-------------------+         GND ------------------------+`, caption: 'The two ways a meter joins a circuit. Volts mode barely disturbs it. Current mode becomes part of it.' },
      `## On real hardware

**Finding ground.** Continuity mode with one probe on a known ground (the USB connector shell, a mounting hole ring, the negative terminal of a large capacitor) finds every other ground point in seconds. You will use this in the UART lesson to identify an unlabelled header.

**Shorts before power.** Before the first power-up of a board you built, measure resistance from each supply rail to ground with the power off. A reading near 0 Ω is a solder bridge or a reversed part. A reading of a few hundred ohms or more is usually fine. The reading often climbs for a second: that is the meter charging the rail's capacitors, and it is a good sign.

**Rails at the pin, not at the regulator.** Measure the supply voltage at the microcontroller's own supply pin or its decoupling capacitor. The voltage at the regulator output proves the regulator works. It does not prove the trace, the ferrite bead or the solder joint between there and the chip.

**Diode mode on an unpowered pin.** Red probe on ground and black probe on an I/O pin usually reads around 0.5–0.7 V, because you are forward-biasing the pin's protection diode to ground. A pin that reads 0 V is shorted to ground. A pin that reads open when its neighbours read 0.6 V may have lost its bond or its solder joint. This is a quick comparative test, not a specification.

**Current tells you whether the chip is alive.** A microcontroller in reset, or with no clock, draws a different current from one that is running. Compare the total board current with the typical figures in the datasheet's electrical characteristics table. A bench supply with a current limit and a current display does the same job without breaking the circuit.`,
      { t: 'callout', kind: 'mistake', title: 'Leads left in the current jack', md: `Most meters have a separate socket for current. You measure a current, then move on to measuring the 5 V rail **without moving the red lead back**. The meter is still a near-short, and you have just connected it across the supply. At best the meter's fuse blows. At worst the rail collapses, the regulator overheats, or a USB port shuts down.\n\nMake it a habit: the red lead goes back to the V jack the moment a current measurement ends.` },
      `## Worked example: a rail that is "fine"

A sensor board resets whenever its radio transmits. You measure the 3V3 rail: **3.29 V**. Does that clear the power supply?

It does not. The meter averages over a few hundred milliseconds. Suppose the rail really drops to 2.6 V for 300 µs at the start of each transmission, once per second. The average of 3.30 V for 999.7 ms and 2.60 V for 0.3 ms is

\`(3.30 × 999.7 + 2.60 × 0.3) / 1000 = 3.2998 V\`

The meter displays 3.30 V and is telling the truth about the average. The brown-out detector, which reacts in microseconds, resets the chip anyway. A multimeter can prove a rail is **wrong**. It cannot prove a rail is **always right**. That needs an oscilloscope, which is the next lesson.`,
      { t: 'predict', q: 'A 10 kΩ pull-up resistor connects an I2C line to 3V3. With the board unpowered, you put the meter in resistance mode across the resistor, in circuit. The board also has two other devices on that line. What do you expect to read?',
        choices: [
          { t: 'Exactly 10 kΩ, because that is the resistor between the probes', why: 'The meter cannot tell which path its test current took. It measures every route from one probe to the other, and the resistor is only one of them.' },
          { t: '10 kΩ or less', ok: true, why: 'Other paths between the two nets (through the unpowered chips\' protection structures and the supply network) are in parallel with the resistor, and parallel paths can only lower the total.' },
          { t: 'More than 10 kΩ, because the chips add resistance in series', why: 'For the chips to be in series they would have to sit between a probe and the resistor. The probes are directly on the resistor\'s two pads, so everything else is alongside it.' },
        ],
        reveal: `Parallel resistance is always lower than the smallest branch. A reading clearly below 10 kΩ does not mean the resistor is faulty. To measure one part with certainty, lift one of its legs so that only one path remains. The useful in-circuit conclusions are the extreme ones: about 0 Ω means a short, and a reading far *above* the marked value means the part or a joint is open.` },
      { t: 'callout', kind: 'decision', title: 'Why not start with the oscilloscope?', md: `A scope shows more, but it takes longer to set up and is easier to misread. On a dead board the first questions are DC ones: is there a short, is the rail present, is reset released? A meter answers each in five seconds with no settings to get wrong. Reach for the scope when the meter says everything is fine and the board still misbehaves, because that means the fault is in the *time* dimension the meter averages away.` },
      { t: 'widget', name: 'circuit-debug', props: { scenario: 'missing-ground' }, caption: 'Use the virtual probes as you would a real meter: state what each node should read, then measure it.' },
      { t: 'exercise', prompt: `You want to know how much current a board draws from a 3.30 V supply. You put a meter in series on its mA range. The meter's manual gives the **burden voltage** on that range as 1.0 mV per mA. The board draws 180 mA.\n\nWhat voltage does the board actually receive while you are measuring? Answer in volts.`,
        hints: [
          'The shunt inside the meter is in series with the board, so it drops some of the supply voltage.',
          'Burden voltage = current × (mV per mA). Here that is 180 mA × 1.0 mV/mA.',
          'Subtract the burden voltage from 3.30 V.',
        ],
        answer: { type: 'number', value: 3.12, tol: 0.011, unit: 'V' },
        solution: `The shunt drops 180 mA × 1.0 mV/mA = 180 mV. The board sees 3.30 − 0.18 = **3.12 V**.\n\nThat is close to the brown-out threshold of some 3.3 V parts, so the act of measuring can make a marginal board fail. Use the highest current range that still gives enough resolution (its shunt is smaller), or measure the drop across a small resistor you place yourself.` },
      `## Harder application: a plan for a dead board

A custom board with a USB connector, a 3.3 V regulator and a microcontroller shows no sign of life. The USB port's current is limited, so nothing is hot. Write the first six measurements you would make, in order, with the reading you expect and what a wrong reading would mean.

One reasonable plan:

1. **Power off: resistance 3V3 to GND.** Expect well above 100 Ω, rising. Near zero means a short: inspect for bridges, reversed capacitors, a chip rotated by 180°.
2. **Power off: resistance VBUS (5 V) to GND.** Same reasoning for the input side.
3. **Power on: DC volts on VBUS at the regulator input.** Expect about 5 V. Missing means the connector, cable or a fuse.
4. **DC volts on the regulator output.** Expect 3.3 V. Low means overload or a bad regulator. Zero with a good input means the enable pin or the part.
5. **DC volts at the MCU supply pin and at its reset pin.** Expect 3.3 V on both for a part with an active-low reset. A low reset pin means the chip is being held in reset: look at the reset circuit and the debug connector.
6. **Board current.** Compare with the datasheet's typical run-mode figure. Far too low suggests the core is not running (reset or clock). The clock itself needs a scope, and probing a crystal can stop it, which the next lesson explains.

Only after power, reset and clock check out is it worth suspecting the firmware.`,
      { t: 'refs', items: [
        { title: 'sigrok project (open-source test and measurement software)', url: 'https://github.com/sigrokproject/libsigrok', note: 'Supports many multimeters with a data interface as well as logic analysers.' },
      ] },
    ],
    quiz: [
      { q: 'A meter in DC volts mode reads 3.30 V on a rail. The board still browns out once a second. What can you conclude about the rail?', kind: 'circuit', choices: [
        { t: 'Its average is 3.30 V, and nothing about short dips', ok: true, why: 'The meter integrates over a large fraction of a second, so sub-millisecond droops barely move the reading.' },
        { t: 'The rail is good, so the resets must come from firmware', why: 'This treats an average as if it were a record of every instant. A dip lasting microseconds can trip a brown-out detector and leave the average unchanged.' },
        { t: 'The meter is faulty, because a browning-out rail must read low', why: 'A brown-out needs the rail to be low only briefly. A correct meter will still show the long-term average, which stays near nominal.' },
      ] },
      { q: 'Why must the circuit be unpowered for a resistance or continuity measurement?', kind: 'concept', choices: [
        { t: 'The meter injects its own test current, and other sources in the circuit corrupt the result', ok: true, why: 'Resistance is computed from the meter\'s known current and the voltage it sees. Any other source in the loop makes the calculation meaningless and may drive current into parts.' },
        { t: 'Resistors change value while current flows, so only an unpowered reading matches the marking', why: 'Ordinary resistors are essentially constant over their working range. The issue is what the meter assumes about where the measured voltage came from.' },
        { t: 'A powered circuit makes the continuity beep too quiet to hear, so a short is easy to miss', why: 'The buzzer has nothing to do with the circuit under test. The limitation is in how the measurement itself is made.' },
      ] },
      { q: 'You measure 4.1 kΩ across a 10 kΩ pull-up in circuit, power off. What is the most defensible conclusion?', kind: 'circuit', choices: [
        { t: 'Nothing is proven wrong: other paths are in parallel with it', ok: true, why: 'In-circuit readings below the marked value are expected. Only a reading well above it, or near zero, points at a fault.' },
        { t: 'The resistor is damaged and its value has drifted down to 4.1 kΩ', why: 'Resistors that fail usually go open or far out of range, and a meter cannot isolate one part while other paths join the same two nets.' },
        { t: 'A 4.7 kΩ resistor was fitted by mistake and reads slightly low', why: 'That is possible, but the reading cannot show it, because a correct 10 kΩ part with parallel paths gives the same kind of number. Read the marking or lift a leg.' },
      ] },
      { q: 'In diode mode, red probe on GND and black probe on an unpowered GPIO pin reads 0.58 V. The same test on the next pin reads 0.00 V. What does that suggest?', kind: 'circuit', choices: [
        { t: 'The second pin is shorted to ground', ok: true, why: 'A healthy pin shows a diode drop from its protection structure. Zero volts at the test current means a direct low-resistance path to ground.' },
        { t: 'The second pin is the healthy one, since no voltage is lost', why: 'In this test a diode drop is the normal signature of an intact pin. A zero reading means the meter\'s current is not passing through a junction at all.' },
        { t: 'The second pin is an output and the first an input', why: 'With the chip unpowered its direction registers do not exist in any meaningful sense. The test sees only the passive structures on the pad.' },
      ] },
      { q: 'A dead board has correct rails. Which check comes next, and why?', kind: 'concept', choices: [
        { t: 'The reset pin: a processor held in reset executes nothing', ok: true, why: 'Power, reset, clock, then code: each is a precondition for the next, and reset is a five-second DC measurement.' },
        { t: 'Reflash the firmware, because that is the most common cause', why: 'If the chip is in reset or has no clock, flashing may fail or change nothing, and you will have added an unknown without removing one.' },
        { t: 'Replace the microcontroller, since correct rails are all a working chip needs', why: 'This is the most expensive action and the least informative. Nothing measured so far points at the chip rather than at its reset or clock circuit.' },
      ] },
      { q: 'Why does a current measurement on the lowest range that fits sometimes make a marginal board fail?', kind: 'circuit', choices: [
        { t: 'The low range uses a larger shunt, which drops more of the supply', ok: true, why: 'Burden voltage is current times shunt resistance. Sensitive ranges use bigger shunts and can take a tenth of a volt or more from the rail.' },
        { t: 'The meter injects switching noise into the rail on its low ranges', why: 'A shunt is a passive resistor. The effect is a steady voltage drop that scales with the current.' },
        { t: 'Low ranges measure more slowly, so the board times out waiting', why: 'The reading rate does not affect the circuit. What affects it is the resistance the meter adds in series.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 2
  {
    id: 'dbg-scope', title: 'The oscilloscope: seeing voltage against time', minutes: 45,
    summary: 'Bandwidth, sample rate, probes, grounding and triggering, and which faults only a scope can show.',
    skills: ['dbg-scope-setup'],
    blocks: [
      `## The problem

An ESP32 board works on the bench and resets at random in the field, always near a Wi-Fi transmission. The multimeter says 3.30 V. A logic analyser on the UART shows a clean boot log, then another boot log. Neither instrument shows *why*.

The fault lives in the shape of an analog voltage over a few hundred microseconds. Three families of fault look like this, and all of them are invisible to a meter and to a logic analyser:

- **Rail droop**: the supply sags briefly when the load steps up.
- **Slow edges**: a signal takes too long to cross the logic threshold, typically an open-drain bus with too weak a pull-up.
- **Ringing and overshoot**: a fast edge on a long wire bounces above the supply and below ground.

An oscilloscope plots voltage against time. Using it well is mostly a matter of knowing where it lies to you.`,
      `## Theory

### Bandwidth

The scope's input amplifier is a low-pass filter. **Bandwidth** is the frequency at which a sine wave is displayed at about 70 % of its true amplitude (−3 dB). It is not the highest frequency you can usefully view.

A square wave is a fundamental plus odd harmonics, and the harmonics are what make the edges sharp. To see the shape of a digital signal you want bandwidth of at least **five times** its fundamental frequency. A 100 MHz scope therefore shows a 20 MHz clock with honest edges and a 100 MHz clock as a reduced sine wave.

For edges, the useful relation is

\`rise time ≈ 0.35 / bandwidth\`

A 100 MHz scope has its own rise time of about 3.5 ns. Rise times combine as the root of the sum of squares, so a real 2 ns edge is displayed as \`sqrt(2² + 3.5²) ≈ 4.0 ns\`. You are measuring the scope.

### Sample rate and memory

A digital scope samples the filtered signal. To reconstruct it, the sample rate should be several times the bandwidth, commonly 2.5× to 5× or more. Sampling too slowly causes **aliasing**: a fast signal appears as a slower one that is not there.

The catch is that the sample rate you get depends on the timebase:

\`sample rate = memory depth / time on screen\`

With 1,000,000 points of memory and 100 ms on screen you are sampling at 10 MS/s, whatever the front panel says the maximum is. Check the sample-rate readout every time you change the timebase.

### Probes: ×1 and ×10

A probe is part of the circuit you are measuring.

| | ×1 | ×10 |
|---|---|---|
| Resistance seen by the circuit | about 1 MΩ | about 10 MΩ |
| Capacitance seen by the circuit | roughly 50–100 pF or more (the whole cable) | roughly 10–15 pF |
| Usable bandwidth | a few MHz | the probe's rated bandwidth |
| Signal at the scope | full size | one tenth (the scope scales the display) |

The ×1 setting hangs the cable's capacitance directly on your node. That is enough to slow an I2C edge visibly or to stop a crystal oscillator. The ×10 setting puts a 9 MΩ resistor with a small compensating capacitor in series, which reduces the loading tenfold at the cost of signal amplitude. **Use ×10 for nearly everything.** Use ×1 only for small, slow signals such as millivolts of ripple on a rail.

Two settings have to agree: the switch on the probe and the attenuation setting of the scope channel. If they disagree, every voltage you read is wrong by a factor of ten.

A ×10 probe must also be **compensated** to the scope's input. Clip it to the scope's calibration square-wave terminal and turn the trimmer in the probe until the tops are flat. Rounded corners mean under-compensated, peaked corners mean over-compensated.

### The ground lead

The 15 cm ground lead with the crocodile clip is an inductor. With the probe's input capacitance it forms a resonant circuit, and a fast edge makes it ring at tens to hundreds of MHz. The ringing appears on screen and is **not on your board**.

For anything fast, remove the clip lead and use the short ground spring that fits over the probe tip, touching a ground point right next to the signal.`,
      { t: 'callout', kind: 'warn', title: 'The scope ground is mains earth', md: `On a mains-powered bench scope, the probe ground clips are connected to each other and to the protective earth of the wall socket. Clipping one to any node that is not ground shorts that node to earth through the scope. On a USB-powered board this usually means shorting a rail through your computer's ground.\n\nClip ground only to the circuit's ground. To measure across a part that has neither end at ground, use two channels and the scope's subtract function, or a differential probe. Never work on mains-referenced circuits with ordinary probes.` },
      `### Triggering

Without a trigger the scope starts each sweep at a random moment and repeating signals smear across the screen. The **trigger** defines the event that pins time zero.

- **Edge trigger**: fires when a channel crosses a level in a chosen direction. This is the default and covers most work. Set the level in the middle of the signal's swing.
- **Auto mode** sweeps even if no trigger arrives, so you always see something. **Normal mode** waits for the trigger and keeps the last capture on screen. **Single** captures once and stops.
- **Pulse-width, runt and timeout triggers** fire on abnormal events: a pulse shorter than expected, an edge that never reaches the high level, a line that stays low too long.

For a rare event the recipe is: Normal or Single mode, a trigger condition that only the fault satisfies, and the trigger point placed mid-screen so you see what happened **before** it.

### AC coupling

To look at 50 mV of ripple riding on 3.3 V, switch the channel to **AC coupling**. A series capacitor removes the DC level so you can zoom in on the variation. Switch back to DC coupling afterwards, or every logic signal will appear centred on zero.`,
      `## On real hardware

**Rail droop.** Probe at the microcontroller's decoupling capacitor with the ground spring. DC coupling, trigger on a *falling* edge of the rail itself at a level slightly below nominal (say 3.1 V for a 3.3 V rail), Normal mode. If the scope triggers, you have caught a droop and can read its depth and duration. Compare the depth with the brown-out threshold in the chip's datasheet.

**Slow I2C edges.** An I2C line is pulled high only by a resistor, so its rising edge is an RC charge curve with \`τ = R × C\`, where C is the total bus capacitance. The I2C specification (NXP UM10204) measures rise time between 30 % and 70 % of the supply, which for an RC curve is \`0.847 × R × C\`, and limits it to 1000 ns in standard mode (100 kHz) and 300 ns in fast mode (400 kHz).

**Clock and reset.** A scope shows whether a crystal is oscillating, at what amplitude, and how long it takes to start. Probe the oscillator *output* pin with a ×10 probe; the probe's capacitance still shifts the frequency slightly and can stop a marginal oscillator.`,
      `## Worked example: is this pull-up strong enough?

A bus has 10 kΩ pull-ups and you estimate 200 pF of total capacitance (several devices and a 30 cm cable). The firmware runs I2C at 400 kHz.

- \`τ = 10 kΩ × 200 pF = 2.0 µs\`
- Rise time 30 %→70 % = \`0.847 × 2.0 µs ≈ 1.7 µs\` = 1700 ns
- Fast-mode limit: 300 ns. The edge is more than five times too slow.

At 400 kHz the whole clock period is 2.5 µs. The line barely reaches the high threshold before it is pulled low again. A logic analyser would show bits that are sometimes right and sometimes not, with no clue why. The scope shows shark-fin edges at a glance.

To meet 300 ns you need \`R ≤ 300 ns / (0.847 × 200 pF) ≈ 1.77 kΩ\`. A 1.5 kΩ pull-up would do it on rise time, and then you check the other limit: the pull-up must not demand more sink current than the devices guarantee (3 mA for standard and fast mode in UM10204), which at 3.3 V gives a minimum of roughly \`(3.3 − 0.4) / 3 mA ≈ 970 Ω\`. So 1.5 kΩ sits inside the window.`,
      { t: 'predict', q: 'You probe a 3.3 V, 10 MHz clock with a ×10 probe and the long ground clip. The screen shows each edge overshooting to 4.4 V and ringing for 20 ns. You swap the clip for the short ground spring and probe the same point. What do you expect?',
        choices: [
          { t: 'The same picture, because the signal has not changed', why: 'The signal on the board is the same, but the picture is the signal plus the response of the probe circuit, and you have just changed that circuit.' },
          { t: 'Much less overshoot and ringing', ok: true, why: 'Most of the ringing came from the ground lead\'s inductance resonating with the probe capacitance. A shorter return path raises that resonance and reduces its amplitude.' },
          { t: 'More ringing, because the spring is a worse ground', why: 'A shorter conductor has less inductance, not more. Less inductance in the return path means the probe follows the edge more faithfully.' },
        ],
        reveal: `If the overshoot shrinks when you shorten the ground, it was a measurement artefact. If it stays, it is really on the board, and the usual fix is a small series resistor (tens of ohms) at the driver to damp the trace. Always make this check before "fixing" ringing you saw with a long ground lead.` },
      { t: 'callout', kind: 'mistake', title: 'Trusting the maximum sample rate on the label', md: `A scope advertised at 1 GS/s only samples that fast at short timebases. Zoom out to capture a whole 200 ms boot sequence and the sample rate may fall to a few MS/s. A 2 µs glitch then gets two or three samples, or none. If you need both a long window and fine detail, capture the long window to find *when* the event happens, then trigger on the event itself at a fast timebase.` },
      { t: 'callout', kind: 'decision', title: 'Scope or logic analyser?', md: `Ask what kind of question you have.\n\n- "Is the *voltage* right?" (levels, edges, noise, droop, ringing, an oscillator) → **scope**. A logic analyser reduces every sample to 0 or 1 and hides exactly these.\n- "Are the *bits* right?" (protocol content, ordering across many lines, long captures) → **logic analyser**. A two- or four-channel scope runs out of channels and memory.\n\nWhen a logic analyser shows data that is intermittently wrong with no pattern, look at one of those lines with a scope before blaming the firmware.` },
      { t: 'exercise', prompt: `Your scope has 10,000,000 points of memory. You want to capture a complete 50 ms power-up sequence in one shot. What sample rate will the scope use? Answer in MS/s (million samples per second).`,
        hints: [
          'Sample rate = memory depth / time captured.',
          '10,000,000 points spread over 0.050 s.',
        ],
        answer: { type: 'number', value: 200, tol: 1, unit: 'MS/s' },
        solution: `10,000,000 / 0.050 s = 200,000,000 samples per second = **200 MS/s**, one sample every 5 ns.\n\nThat is enough to resolve events down to a few tens of nanoseconds across the whole 50 ms. With only 10,000 points the same window would give 200 kS/s, one sample every 5 µs, and a 1 µs glitch would usually be missed.` },
      `## Harder application: the random reset

Back to the ESP32 board that resets near Wi-Fi transmissions. Design the measurement.

1. **Hypothesis**: the 3V3 rail droops below the brown-out threshold when the radio's power amplifier turns on.
2. **Probe**: ×10, ground spring, at the module's supply pin or nearest capacitor. Not at the regulator.
3. **Coupling and scale**: DC coupling, 500 mV/div, so both 3.3 V and a dip toward 2.5 V are on screen.
4. **Trigger**: falling edge on that channel at about 3.0 V, Normal mode, trigger point at mid-screen.
5. **Timebase**: start at 200 µs/div.
6. **Prediction**: if the hypothesis is right, the scope triggers when the board resets and shows a dip lasting tens to hundreds of microseconds. If it never triggers while the board keeps resetting, the hypothesis is wrong and you have saved yourself from adding capacitors that would not have helped.

If the dip is there, the cure is a supply question: more bulk capacitance close to the module, a regulator that can respond to the load step, thicker or shorter supply traces. Espressif's hardware design guidelines for each module state the supply current capability to design for. After the change, repeat the same capture: the trigger should no longer fire.`,
      { t: 'refs', items: [
        { title: 'NXP UM10204, I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf', note: 'Rise-time limits and pull-up sizing. URL not load-tested from this project.' },
      ] },
    ],
    quiz: [
      { q: 'A 50 MHz oscilloscope displays a 50 MHz, 3.3 V square-wave clock. What will it look like?', kind: 'concept', choices: [
        { t: 'Roughly a sine wave of reduced amplitude', ok: true, why: 'The harmonics that make the edges square lie far above the bandwidth, and even the fundamental is attenuated to about 70 %.' },
        { t: 'A clean square wave, because 50 MHz is within the rating', why: 'The rating is the −3 dB point for a sine wave. A square wave needs several times its fundamental frequency to keep its shape.' },
        { t: 'Nothing, because signals at the bandwidth limit are filtered out', why: 'The roll-off is gradual. At the rated bandwidth the fundamental still gets through at roughly 70 % amplitude.' },
      ] },
      { q: 'Why does switching a probe from ×1 to ×10 usually make the displayed edges of an I2C line sharper?', kind: 'circuit', choices: [
        { t: 'The ×10 probe loads the bus with much less capacitance', ok: true, why: 'In ×1 the cable capacitance is added directly to the bus. In ×10 the circuit sees only around a tenth of it.' },
        { t: 'The ×10 probe amplifies the signal tenfold, which steepens the edges', why: 'It does the opposite: it divides the signal by ten, and the scope rescales the display. The benefit is in loading, not gain.' },
        { t: 'The scope applies digital sharpening in ×10 mode', why: 'The scope setting only multiplies the numbers on the display. The change in edge shape is a physical change in what the probe does to the node.' },
      ] },
      { q: 'You see 1.2 V of ringing on a clock edge. Which check distinguishes a real signal-integrity problem from a probing artefact?', kind: 'circuit', choices: [
        { t: 'Repeat with a short ground spring and see whether it changes', ok: true, why: 'Ringing that depends on the ground-lead length is made by the probe loop. Ringing that persists belongs to the board.' },
        { t: 'Increase the vertical scale so the ringing is smaller on screen', why: 'That changes how large it is drawn, not whether it exists or where it comes from.' },
        { t: 'Switch the channel to AC coupling and see whether it goes away', why: 'AC coupling removes the DC level. It does not affect high-frequency ringing or tell you its source.' },
      ] },
      { q: 'A fault happens about once a minute and lasts 50 µs. Which setup gives the best chance of seeing its cause?', kind: 'concept', choices: [
        { t: 'Normal mode, a trigger only the fault meets, trigger point mid-screen', ok: true, why: 'Normal mode holds the capture, a specific trigger ignores the healthy traffic, and pre-trigger memory shows what led up to the event.' },
        { t: 'Auto mode at a slow timebase, watching the screen for the event', why: 'Auto mode redraws continuously, so a 50 µs event at a slow timebase is one pixel shown for one sweep and then overwritten.' },
        { t: 'Trigger point at the left edge so the whole screen shows what follows', why: 'The cause of a fault comes before it. With no pre-trigger time you capture only the consequences.' },
      ] },
      { q: 'A probe is switched to ×10 but the scope channel is set to ×1. You measure a 3.3 V rail. What does the scope display?', kind: 'circuit', choices: [
        { t: 'About 0.33 V', ok: true, why: 'The probe divides by ten and the scope, told there is no division, does not multiply back.' },
        { t: 'About 33 V', why: 'That would be the result of the opposite mismatch, a ×1 probe with the channel set to ×10.' },
        { t: '3.3 V, because modern probes report their setting', why: 'Some probes have a sense pin, many do not, and a manual switch is not reported. The two settings must be checked by hand.' },
      ] },
      { q: 'Which symptom most strongly calls for a scope and not a logic analyser?', kind: 'concept', choices: [
        { t: 'SPI data is corrupted only on boards with a longer sensor cable', ok: true, why: 'Dependence on cable length points at edges, reflections or loading: analog properties that a 1-bit sampler cannot show.' },
        { t: 'You need to see which of eight chip-select lines goes low first', why: 'That is an ordering question across many digital lines, which is what a multi-channel logic analyser is for.' },
        { t: 'You want to read 4,000 bytes of UART log from a boot', why: 'That is a long protocol capture. A logic analyser with a UART decoder, or simply a serial adapter, handles it.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 3
  {
    id: 'dbg-logic-analyser', title: 'Logic analysers and protocol decoding', minutes: 40,
    summary: 'Channels, sample rate against bit rate, thresholds, triggers and decoders with sigrok and PulseView.',
    skills: ['dbg-la-capture'],
    blocks: [
      `## The problem

A microcontroller talks to a flash chip over SPI and to a sensor over I2C. Once in a few hundred transactions the sensor value is nonsense. You need to see chip select, clock, both data lines, SDA and SCL at the same moment, for long enough to catch the bad transaction, and you need the bytes decoded. That is six channels and several seconds. A scope has two or four channels and decodes awkwardly.

A **logic analyser** is the instrument for this. It gives up all information about voltage in exchange for many channels, long captures and automatic decoding.`,
      `## Theory

### What it records

Each channel has a comparator. At every sample instant it records one bit: is the input above the **threshold** or below it? Everything else about the signal is discarded. A 3.3 V square wave, a 5 V square wave and a horribly ringing edge all become the same row of ones and zeros.

That is the instrument's strength and its blind spot. In the capture every edge is drawn perfectly vertical, because the instrument has no way to draw anything else.

### Sample rate against bit rate

A logic analyser samples on its own clock, unrelated to your signal. An edge is therefore recorded up to one sample period late. To place edges well enough to decode:

- **Asynchronous signals (UART)**: at least **4 samples per bit**, and 8–10 is comfortable. At 115200 baud a bit lasts 8.68 µs, so 1 MS/s gives 8.7 samples per bit.
- **Clocked buses (SPI, I2C)**: at least **4 times the clock frequency**, so that both halves of the clock are seen and data is sampled near the right edge. An 8 MHz SPI bus needs 32 MS/s or more.

If the sample rate is too low, the decoder still produces output. It produces *wrong* bytes and framing errors, which look exactly like a firmware bug.

### How long you can capture

Inexpensive analysers stream samples to the computer over USB, so capture length is limited by the PC's memory and the USB link, and the maximum rate falls as you enable more channels. Analysers with on-board memory capture faster but for a fixed depth. Either way: \`capture time = samples / sample rate\`. Lowering the rate to the minimum that decodes reliably is how you get a long capture.

### Thresholds

Many low-cost analysers have a fixed threshold somewhere around 1.4–1.5 V with 5 V-tolerant inputs. That reads 3.3 V and 5 V logic correctly. It is marginal or wrong for 1.8 V logic, where a "high" is only 1.8 V and noise margins shrink, and useless for 1.2 V. For low-voltage buses you need an analyser with an adjustable threshold. Check your analyser's documentation for its threshold and maximum input voltage before connecting it.

### Triggers and pre-trigger

A trigger marks the interesting instant: a falling edge on chip select, a pattern across several lines, or (in software) a decoded value. A **pre-trigger** buffer keeps the samples before it. For a rare fault, a simple and robust approach is to have the firmware raise a spare GPIO when it detects the bad value and trigger on that pin.

### Protocol decoders

A decoder turns edges into meaning. You tell it which channel is which and the parameters the wires do not carry: baud rate, parity and bit order for UART; clock polarity and phase for SPI; nothing for I2C, which is self-describing. Decoders can be **stacked**: an I2C decoder feeds an EEPROM decoder, an SPI decoder feeds a flash-command decoder.`,
      `## On real hardware: sigrok and PulseView

**sigrok** is an open-source signal-analysis suite. **PulseView** is its graphical front end and **sigrok-cli** its command line. It supports many analysers, including the common 8-channel, 24 MS/s USB devices built on the Cypress FX2 chip, through the open \`fx2lafw\` firmware.

A typical PulseView session:

1. Connect the analyser's **ground** to the target's ground. Then connect signal channels.
2. Select the device, the channels, the sample rate and the number of samples.
3. Add a decoder, assign channels to its inputs and set its parameters.
4. Set a trigger on a channel if you want one, and run.
5. Zoom in on a suspicious byte and use the cursors to measure timing.

The same capture from the command line, which is useful in test scripts:`,
      { t: 'code', lang: 'sh', status: 'reviewed', caption: 'sigrok-cli: capture two seconds of a 115200-baud UART on channel D0 and print the decoded bytes. Written against the sigrok-cli manual; not run against an analyser here. Check option spelling with `sigrok-cli --help` for your version.',
        code: String.raw`# List the analysers sigrok can see
sigrok-cli --scan

# 1 MS/s for 2 s on channel D0, decoded as UART, annotations printed as text
sigrok-cli -d fx2lafw --config samplerate=1m --time 2s --channels D0 \
           -P uart:rx=D0:baudrate=115200 -A uart=rx-data

# Save a raw capture for PulseView instead
sigrok-cli -d fx2lafw --config samplerate=1m --time 2s -o boot.sr`,
        explain: [
          { lines: '2', md: 'Scans USB for supported hardware and prints the driver name to use with `-d`.' },
          { lines: '5-6', md: '`samplerate=1m` gives 8.7 samples per bit at 115200 baud. `-P` attaches a protocol decoder and maps its `rx` input to channel D0. `-A` selects which annotation rows to print.' },
          { lines: '9', md: 'A `.sr` file holds the raw samples, so you can try different decoders and baud rates later without recapturing.' },
        ] },
      `## Worked example: choosing the settings

You want to capture the SPI traffic between an MCU and a flash chip during boot. The firmware clocks SPI at 2 MHz, and the boot takes about 300 ms. Your analyser does 24 MS/s on up to 8 channels.

- Minimum rate: 4 × 2 MHz = 8 MS/s. Choose 12 or 16 MS/s for margin.
- Channels: CS, SCLK, MOSI, MISO = 4.
- Samples: 0.3 s × 16 MS/s = 4.8 million. Capture 0.5 s, 8 million samples, to be safe.
- Trigger: falling edge on CS, so the capture starts at the first transaction and does not record idle time.
- Decoder: SPI with the mode the flash chip uses (most SPI flash accepts modes 0 and 3), then stack a flash-command decoder on top.

If the firmware later raises the SPI clock to 20 MHz, this analyser can no longer capture it: 4 × 20 MHz = 80 MS/s. Either slow the bus down for debugging, which is a legitimate technique, or use a faster instrument.`,
      { t: 'predict', q: 'A UART runs at 115200 baud. You capture it at 200 kS/s and attach a UART decoder set to 115200. What does the decoder show?',
        choices: [
          { t: 'Correct bytes, because 200 kS/s is above the 115.2 kHz bit rate', why: 'Being above the bit rate gives fewer than two samples per bit. Edge positions are then uncertain by more than half a bit, and the decoder cannot find the centre of each bit.' },
          { t: 'A mix of wrong bytes and framing errors', ok: true, why: 'With 1.7 samples per bit, each edge can be misplaced by up to one sample, which is 58 % of a bit. Some bits are read from their neighbour and stop bits are missed.' },
          { t: 'Nothing at all, because the decoder refuses a low sample rate', why: 'Decoders generally run on whatever samples they are given. They do not know the capture is inadequate, which is why the output is misleading and not empty.' },
        ],
        reveal: `The signal on the wire is perfect and the firmware is correct. The errors were manufactured by the capture. Before believing a decode error, check the samples per bit, and zoom in: if single bits in the raw trace have visibly different widths, the sample rate is too low.` },
      { t: 'callout', kind: 'mistake', title: 'No ground, or ground connected last', md: `A logic analyser measures each channel against its own ground pin. With no ground wire, the inputs float relative to the target and you capture noise that looks like fast random data. Connect ground **first**. If the target and the PC are powered from different supplies, the ground wire also equalises them, which is another reason to connect it before any signal line.` },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'i2c-read' }, caption: 'Decode the transaction by hand before turning the decoder on: find the start condition, the seven address bits, the R/W bit and each ACK.' },
      { t: 'exercise', prompt: `An SPI bus runs with an 8 MHz clock. Using the rule of at least four samples per clock period, what is the minimum sample rate you need? Answer in MS/s.`,
        hints: [
          'Four samples per clock period means four times the clock frequency.',
          '4 × 8 MHz.',
        ],
        answer: { type: 'number', value: 32, tol: 0.5, unit: 'MS/s' },
        solution: `4 × 8 MHz = **32 MS/s**. A 24 MS/s analyser gives three samples per period, which is not enough to place data relative to the clock edge reliably. Reduce the SPI clock in a debug build or use a faster analyser.` },
      { t: 'callout', kind: 'decision', title: 'Why slow the bus down for debugging?', md: `Lowering the SPI or I2C clock in a debug build lets a cheap analyser capture it and often makes an analog problem disappear. That second effect is information. If the bug goes away at a tenth of the speed, it is probably electrical (edges, capacitance, timing margins). If it remains, it is probably logical (wrong command, wrong order, wrong data), and now you can capture it cleanly.` },
      `## Harder application: a decode that lies

You capture I2C at 2 MS/s on a 100 kHz bus, which is 20 samples per clock: plenty. The decoder reports that about one address byte in fifty is NACKed, and the firmware agrees that reads sometimes fail. The capture shows textbook-square SDA and SCL.

Think before reading on: what can the capture not tell you, and what would you measure next?

The capture reports only whether each line was above about 1.4 V at each sample. Two different realities produce this same picture:

- The sensor really does not acknowledge sometimes: it is busy, or in reset, or the address is contested. That is a logic problem.
- The edges are slow. SDA rises so lazily that when the controller samples it, the level is near the threshold. The controller's input and the analyser's comparator, having different thresholds, can disagree about what the bit was. That is an analog problem.

The next measurement is a scope on SDA and SCL with a ×10 probe, looking at rise time, exactly as in the previous lesson. If the edges are sharp and levels are solid, go back to the logic explanation and capture the transaction *before* each NACK to see what the sensor was asked to do.`,
      { t: 'refs', items: [
        { title: 'PulseView source and documentation', url: 'https://github.com/sigrokproject/pulseview' },
        { title: 'libsigrok (hardware drivers)', url: 'https://github.com/sigrokproject/libsigrok' },
      ] },
    ],
    quiz: [
      { q: 'What does a logic analyser store for each channel at each sample?', kind: 'concept', choices: [
        { t: 'One bit: whether the input was above the threshold', ok: true, why: 'Reducing each sample to one bit is what allows many channels and long captures, and why analog detail is lost.' },
        { t: 'The voltage, at a lower resolution than a scope would record', why: 'There is no voltage resolution at all on a plain logic channel. Instruments that also record voltage are mixed-signal scopes.' },
        { t: 'The decoded protocol byte that was on the bus at that moment', why: 'Decoding is done afterwards in software from the stored samples. The hardware knows nothing about protocols.' },
      ] },
      { q: 'You need to capture a 1 Mbit/s UART. Which sample rate is the lowest sensible choice?', kind: 'concept', choices: [
        { t: '4 MS/s', ok: true, why: 'Four samples per bit is the practical minimum for an asynchronous signal, and more is better if the analyser allows it.' },
        { t: '1 MS/s, one sample per bit', why: 'With one sample per bit the sample can land on an edge every time, and any difference between the two clocks slides it from bit to bit.' },
        { t: '2 MS/s, twice the bit rate', why: 'Two samples per bit satisfies a sampling theorem for sine waves, but leaves edge positions uncertain by half a bit, which a UART decoder cannot tolerate.' },
      ] },
      { q: 'An analyser with a fixed threshold of about 1.5 V is connected to a 1.8 V I2C bus. What is the risk?', kind: 'circuit', choices: [
        { t: 'A valid high is barely above the threshold, so noise flips bits', ok: true, why: 'The margin between a 1.8 V high and a 1.5 V threshold is a few hundred millivolts, far less than the analyser was designed around.' },
        { t: 'The analyser\'s inputs will be damaged by the low bus voltage', why: 'Low voltages do not damage inputs. The hazard with voltage is on the high side, exceeding the stated maximum.' },
        { t: 'There is none, since a 1.8 V high is still above a 1.5 V threshold', why: 'Being nominally above the threshold ignores noise, ringing and the time the edge spends near that level.' },
      ] },
      { q: 'A decoder shows framing errors on a UART capture. The device itself prints correctly to a serial terminal. What should you check first?', kind: 'concept', choices: [
        { t: 'Samples per bit and the decoder\'s baud setting', ok: true, why: 'A working terminal proves the wire is fine, so the error is in how the capture was taken or decoded.' },
        { t: 'The accuracy of the device\'s crystal oscillator', why: 'If the clock were far enough off to cause framing errors, the serial terminal would show garbage too.' },
        { t: 'The firmware\'s UART driver and its baud-rate divisor', why: 'A driver bug would affect what the terminal receives as well. Here only the capture disagrees.' },
      ] },
      { q: 'Why is "raise a spare GPIO when the firmware detects the bad value" a good trigger for a rare fault?', kind: 'concept', choices: [
        { t: 'It marks the exact moment, and pre-trigger memory shows what led to it', ok: true, why: 'The firmware knows what "bad" means better than any trigger pattern, and an edge trigger is available on every analyser.' },
        { t: 'GPIO edges are faster than protocol signals, so the capture is more precise', why: 'Edge speed is not the point. The value is in letting the firmware classify the event.' },
        { t: 'It stops the firmware so the bus stays frozen for inspection', why: 'Setting a pin does not halt anything. The analyser records history; it does not hold the bus.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 4
  {
    id: 'dbg-uart-recon', title: 'The debug UART: finding it and listening', minutes: 45,
    summary: 'Locate ground, identify TX, measure the voltage, work out the baud rate and read the boot log without damaging anything.',
    skills: ['dbg-uart-find'],
    blocks: [
      `## The problem

You have a board you own: a router, a smart plug, an old development kit with no documentation. There is a row of four unlabelled holes near the processor. Almost every embedded product has a serial console somewhere, because the people who built it needed one. If you can find it, the device will often tell you its bootloader, its memory layout and its firmware version, and may offer a prompt.

You have no schematic. You need to work out which hole is which without connecting anything that could do damage.`,
      { t: 'callout', kind: 'security', md: `Work only on hardware you own or have written permission to examine. A debug console is one of the most common ways into an embedded device, which is why this lesson is paired with defences: at the end you will list what a product should do about its own console.` },
      `## Theory: what a UART looks like electrically

Recall from the protocols section that a UART line **idles high**. Each byte is a start bit (low), data bits least-significant first, an optional parity bit, and one or more stop bits (high). There is no clock wire: both ends agree on the bit time in advance.

Four facts identify the pins:

| Pin | Unpowered | Powered, idle | During boot |
|---|---|---|---|
| **GND** | Continuity to ground plane, shields, connector shells | 0 V | 0 V |
| **VCC** | Continuity to a supply rail | Steady at the rail voltage | Steady |
| **TX** (device output) | No continuity to ground or supply | High (near the rail voltage), driven | Pulses low: activity |
| **RX** (device input) | No continuity to ground or supply | Often high through a pull-up, sometimes floating | No activity |

TX and VCC both read "high" on a meter at idle. The difference is that TX **moves** when the device prints, and VCC never does.`,
      `## On real hardware: the procedure

### 1. Look

Candidates are 3- to 6-pin headers or unpopulated rows of pads near the main processor, test points labelled \`TX\`, \`RX\`, \`TP\`, \`J\` or \`CON\`, and traces that run from the processor to a header through small series resistors. Search for the board markings and the processor's datasheet: the UART pins of the chip are a fact you can look up.

### 2. Power off: find ground

Meter in continuity mode, one probe on a known ground (USB shell, the metal can over the radio, the negative pad of a large capacitor). Touch each candidate pin. The one that beeps is GND. A pin that beeps to a known supply net is VCC.

### 3. Power on: measure every pin's voltage

Meter in DC volts, black probe on the GND you found. Record each pin. You now know the **logic level** of the port (3.3 V, 1.8 V, occasionally 5 V), which decides what adapter you may use. Do not skip this.

### 4. Find TX by its activity

Power-cycle the board while watching each high pin on the meter. VCC stays put. TX dips or flickers for a moment during boot, because for a while the line spends part of its time low and the meter shows the average. A scope or logic analyser makes it obvious: bursts of pulses for a few seconds after power-up.

### 5. Work out the baud rate

Capture the TX line and measure the **shortest pulse**. It is one bit, so

\`baud ≈ 1 / (shortest pulse width)\`

Snap the result to a standard rate. The most common by far are 115200 and 9600; others include 19200, 38400, 57600, 230400, 460800 and 921600. Then check: with the right rate the text becomes readable. The usual frame is 8 data bits, no parity, 1 stop bit ("8N1").

### 6. Connect, listening only

Use a USB-to-UART adapter set to the target's voltage.

- adapter **GND** → board GND
- adapter **RX** → board **TX**
- leave adapter TX and VCC unconnected

Open a terminal at the rate you found and power-cycle the board. Connect adapter TX → board RX only when you have something to send, and only after confirming the adapter's TX voltage matches the board.`,
      { t: 'ascii', text: `  Board header          USB-to-UART adapter (set to the BOARD's voltage)
  ------------          -------------------
   GND  o-------------------o GND        always, and first
   TX   o-------------------o RX         board talks, adapter listens
   RX   o- - - - - - - - - -o TX         only when you need to type
   VCC  o        (nothing)  o VCC/3V3    do not connect`, caption: 'TX goes to RX. The board has its own power supply, so the adapter does not need to feed it.' },
      { t: 'callout', kind: 'warn', title: 'Never connect VCC unless you mean to power the board from the adapter', md: `The board is already powered by its own supply. Joining the adapter's VCC to the board's VCC connects two regulators with slightly different output voltages directly together, and each tries to drag the other to its own level. If the adapter's pin is 5 V and the board is 3.3 V, you put 5 V on a 3.3 V rail and can destroy every chip on it. A UART link needs a common ground and signal wires. It does not need a shared supply.` },
      `### 3.3 V and 5 V adapters

A USB-to-UART adapter is a bridge chip (FTDI FT232, Silicon Labs CP210x, WCH CH340 and others) that appears to the computer as a serial port. What matters electrically is the voltage of its TX output and what its RX input tolerates.

- Many adapters have a jumper or switch for 3.3 V or 5 V I/O. Some are fixed. Some have a "3V3" pin that is only a small regulator output while the signals remain 5 V.
- **Measure the adapter's TX pin with a meter before first use.** It idles high, so the reading is its logic level.
- A 5 V TX into a 3.3 V input that is not 5 V-tolerant drives current through the input's protection diode into the rail. It may work for a while and may damage the pin.
- A 1.8 V target needs a 1.8 V adapter or a level shifter. A 3.3 V adapter is too high for its input, and the target's 1.8 V high may not reach the adapter's input threshold.

On Linux the adapter shows up as \`/dev/ttyUSB0\` or \`/dev/ttyACM0\`. Run \`dmesg | tail\` just after plugging it in to see the name. Any terminal program works:`,
      { t: 'code', lang: 'sh', status: 'hw', caption: 'Opening the port. Only meaningful with an adapter attached.', code: String.raw`picocom -b 115200 /dev/ttyUSB0            # exit with Ctrl-A Ctrl-X
python3 -m serial.tools.miniterm /dev/ttyUSB0 115200
screen /dev/ttyUSB0 115200                # exit with Ctrl-A k`,
        explain: [
          { lines: '1-3', md: 'All three open the serial device at the given baud rate with 8N1 framing. If you get "permission denied", your user needs access to the device node, commonly by membership of the `dialout` group.' },
        ] },
      `## Worked example: four unlabelled pads

A board you own has a row of four pads, P1 to P4, next to the processor. Follow the procedure and fill in a table as you go.

| Pad | Step 2: continuity, power off | Step 3: DC volts, powered and idle | Step 4: during a power-cycle |
|---|---|---|---|
| P1 | no beep to ground or to the 3V3 rail | 3.28 V | dips to about 2.6 V for two seconds, then returns |
| P2 | beeps to the USB shell | 0.00 V | 0.00 V |
| P3 | no beep to ground or to the 3V3 rail | 3.30 V | steady |
| P4 | beeps to the 3V3 rail | 3.30 V | follows the rail up and stays |

Reasoning, one pad at a time:

- **P2** is ground: continuity to the shell, and 0 V always.
- **P4** is the supply: continuity to the rail. Never connect it to the adapter.
- **P1 and P3** both idle high, which is what both UART lines do. They are told apart by step 4. P1's average falls during boot because the line spends part of that time low: it is being **driven with data**, so it is the board's **TX**.
- **P3** is high but never moves and has no continuity to the rail: an input held high by a pull-up, the board's **RX**.
- The logic level is 3.3 V, so a 3.3 V adapter is safe. A 5 V adapter is not.

Connection for listening: adapter GND to P2, adapter RX to P1, nothing else. Had step 4 shown **no** pad moving, the conclusion would not be "pick one and try". It would be that the console is silent, disabled or elsewhere, and the next measurement is a logic analyser on both candidates for a longer time.

## Worked example: from pulse width to baud rate

With cursors on a capture you measure pulses of 8.7 µs, 17.4 µs and 26 µs. The shortest is 8.7 µs:

\`1 / 8.7 µs = 114,943 bit/s\`

The nearest standard rate is 115200, 0.2 % away. The other pulses are 2.00 and 3.00 bit times, which is what a real UART produces: every pulse is a whole number of bits. That consistency check matters. If the pulses were 1.0, 1.5 and 2.3 bit times, the "shortest pulse" was not one bit, or the signal is not a UART.

The program below does this arithmetic. It was compiled and run on the host with the inputs shown.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/debugging/baud_guess.c (core of the calculation). Output for `./baud_guess 8.7 17.4 26`: "shortest pulse 8.70 us -> 114943 bit/s raw", "nearest standard rate 115200 baud (0.2% away)".',
        code: String.raw`static const long standard[] = { 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880,
                                 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000 };

double raw = 1e6 / shortest;                 /* shortest pulse in microseconds */
long best = standard[0];
double best_err = 1e9;
for (size_t i = 0; i < sizeof standard / sizeof standard[0]; i++) {
    double err = (raw - (double)standard[i]) / (double)standard[i];
    if (err < 0) err = -err;
    if (err < best_err) { best_err = err; best = standard[i]; }
}`,
        explain: [
          { lines: '1-2', md: 'Standard rates. 74880 is included because some boot ROMs use it; it is not a rate most terminal programs offer in their menus.' },
          { lines: '4', md: 'One bit per shortest pulse: a pulse of `shortest` microseconds means `1e6 / shortest` bits per second.' },
          { lines: '7-10', md: 'Relative error against each standard rate. UART receivers tolerate a few percent of mismatch in total, so a best match more than about 5 % away deserves suspicion.' },
        ] },
      { t: 'predict', q: 'A capture of the first byte after reset shows the line going low, and the shortest pulse you can find anywhere in the first 200 ms is 208 µs. The text decodes as garbage at 4800 baud (1/208 µs ≈ 4808). What is the most likely explanation?',
        choices: [
          { t: 'The device uses a non-standard rate close to 4800, which no terminal offers', why: 'A rate within 0.2 % of a standard one is not the problem. Being that close is evidence the arithmetic was right for the pulse you measured.' },
          { t: 'The capture held no isolated bit: 208 µs is two bits at 9600', ok: true, why: 'The shortest pulse equals one bit only if the data happens to include an isolated 0 or 1. Two equal bits side by side look like one pulse of twice the width.' },
          { t: 'The device uses 7 data bits and even parity instead of 8N1', why: 'A framing mismatch garbles some characters, but the bit time measured from pulse widths would still decode into mostly recognisable text.' },
        ],
        reveal: `Measure across more data, or try the next rates up. Bytes such as \`U\` (0x55) alternate every bit and give you a true one-bit pulse. If doubling the rate turns garbage into text, you had measured two bits.` },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'uart-unknown-baud' }, caption: 'Find the shortest pulse with the cursors, convert it to a standard baud rate, then decode.' },
      `## Boot logs as an information source

Once the text is readable, read all of it. A boot log commonly gives away:

- the bootloader's name and version, and often its build date;
- the amount of RAM and flash, and the flash chip's identity;
- a partition or memory map with offsets and sizes;
- the firmware or kernel version and its command line;
- a message such as "press any key to stop autoboot", which is an invitation to a bootloader prompt;
- error messages that name files, addresses and functions.

On Espressif chips the ROM bootloader itself prints a reset reason and boot mode on UART0 before any of your code runs. On the original ESP32 that output is at 115200 baud with the usual 40 MHz crystal (a board with a different crystal frequency prints its ROM messages at a different rate, which is one reason 74880 is in the table above). ESP-IDF's second-stage bootloader then logs the partition table. This is why \`idf.py monitor\` shows text even when your application crashes immediately.`,
      { t: 'callout', kind: 'mistake', title: 'TX to TX', md: `Connecting the board's TX to the adapter's TX gives you two outputs driving one wire and no data. It is the single most common serial wiring error, and labels make it worse: some boards label a pin by what it *is* and some by what you should *connect to it*. Trust the measurement: the pin that shows activity at boot is the device's output, and it goes to the adapter's **RX**.` },
      { t: 'callout', kind: 'decision', title: 'Why listen before you talk?', md: `A receive-only connection cannot change the device's behaviour and exposes your adapter's input only to the board's known output voltage. Connecting your TX is the step that can inject current, interrupt a boot, or type into a bootloader. Do it second, on purpose, after the voltage check.` },
      { t: 'exercise', prompt: `On an unknown board's serial line, the shortest pulse you measure is 26.0 µs, and other pulses are 52 µs and 104 µs. Which standard baud rate is this?`,
        hints: [
          'Which of the three pulses can be a single bit, and what would the other two then be in bit times? Check that they come out as whole numbers.',
          'One bit lasts the shortest pulse width. How many of those fit in one second? Mind the unit: the width is in microseconds.',
          'Method: baud ≈ 1 / (shortest pulse in seconds), then pick the nearest rate from the list of standard rates in step 5 and check it is within a few percent.',
        ],
        answer: { type: 'number', value: 38400, tol: 1, unit: 'baud' },
        solution: `1 / 26.0 µs = 38,462 bit/s. The nearest standard rate is **38400** (bit time 26.04 µs), 0.2 % away. The other pulses are 2 and 4 bit times, which is consistent.` },
      `## Harder application: defending your own console

You are now on the other side: you are shipping a product with a UART console on a header. An attacker who owns one unit will do everything in this lesson within ten minutes. List what the console should and should not do in production, and how you would verify each point.

| Risk | Defence | How to verify |
|---|---|---|
| Boot log reveals memory layout, versions and paths | Reduce production log level; do not print secrets or key material at any level | Capture the full boot log of a production build and read every line |
| Bootloader prompt reachable by keypress | Disable the interactive prompt or the autoboot delay in production builds | Hold a key down during power-up on a production unit |
| Shell or command interface with no authentication | Remove it, or require authentication that is unique per device | Try every documented and undocumented command on a production unit |
| ROM bootloader download mode reachable over the same UART | Use the chip's mechanism for restricting it (on Espressif chips, see the security guide for the UART download-mode eFuses) | Attempt to enter download mode and read flash |
| Removing the header as a "fix" | It is not one: the pads and the chip pins remain | Probe the processor pins directly |

Physical obscurity, such as leaving a header unpopulated or removing silkscreen, costs an attacker minutes. The real control is what the firmware and the chip's configuration do when someone connects.`,
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'tx-rx-swapped' }, caption: 'A serial link with no data. Diagnose it from the symptoms before changing any wire.' },
      { t: 'exercise', prompt: `A 4-pad header on a board you own measures as follows. Pad A: beeps to the USB shell with power off. Pad B: no continuity to ground or supply; 1.79 V when powered; steady during a power-cycle. Pad C: no continuity to ground or supply; 1.80 V idle; the meter reading sags to about 1.4 V for a second after power-up. Pad D: continuity to a rail that measures 1.80 V.\n\nWhich pad do you connect to your adapter's **RX** pin? Answer with the pad letter. Then decide whether your 3.3 V adapter may be used.`,
        hints: [
          'Sort the pads first: which one is ground, and which one is a supply? Those two are identified with the power off.',
          'Two pads remain and both idle high. What does a transmitting line do to a meter\'s average reading that a quiet input does not?',
          'The pad whose reading moves during boot is the board\'s output. An output goes to the adapter\'s input. Separately: compare the measured logic level with the adapter\'s.',
        ],
        answer: { type: 'text', accept: ['^\\s*(pad\\s*)?[cC]\\b'], nudge: 'Which pad shows activity during boot? That is the board\'s TX, and TX goes to the adapter\'s RX.' },
        solution: `Pad A is ground and pad D is the supply. Of the two that idle high, **pad C** sags during boot, so it is the board's TX, and it goes to the adapter's RX. Pad B is the board's RX.\n\nThe port runs at **1.8 V**, so a 3.3 V adapter must not be connected as it is. Its TX would drive 3.3 V into a 1.8 V input, and the board's 1.8 V high may not reach a 3.3 V adapter's input threshold reliably. Use a 1.8 V adapter or a level shifter. Listening only (adapter RX on pad C, grounds joined) does not over-voltage the board, but whether the adapter reads 1.8 V as a high is something to check in its datasheet, not to assume.` },
      { t: 'refs', items: [
        { title: 'ESP-IDF: USB Serial/JTAG controller console', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/usb-serial-jtag-console.rst', note: 'On ESP32-S3/C3/C6 the console can be a USB CDC port with no external adapter.' },
        { title: 'esptool (serial bootloader utility)', url: 'https://github.com/espressif/esptool' },
      ] },
    ],
    quiz: [
      { q: 'On a powered 4-pin header, two pins read 3.3 V on a meter. How do you tell TX from VCC without a scope?', kind: 'circuit', choices: [
        { t: 'Power-cycle and watch both: TX dips during boot, VCC stays', ok: true, why: 'TX spends part of the boot time low, which pulls the meter\'s average down. A supply rail does not move.' },
        { t: 'VCC is always the pin at the end of the header, next to ground', why: 'There is no standard pin order for debug headers. Position is a guess, and a wrong guess here connects a supply rail to an adapter input.' },
        { t: 'Short each to ground briefly and see which one resets the board', why: 'Shorting a supply rail to ground is destructive, and shorting an output can damage the driver. Identification should never require a short.' },
      ] },
      { q: 'Why measure the pin voltages before choosing an adapter?', kind: 'circuit', choices: [
        { t: 'The port\'s logic level decides which adapter is safe to connect', ok: true, why: 'A 5 V adapter output can over-voltage a 3.3 V or 1.8 V input, and a low-voltage target may not drive a higher-voltage adapter\'s input high enough.' },
        { t: 'The voltage tells you the baud rate, since faster ports run lower', why: 'Bit time and signal level are independent. Baud rate comes from pulse widths, not from amplitude.' },
        { t: 'Adapters only work if the voltage is exactly 3.30 V', why: 'Logic thresholds are ranges, not exact values. The concern is the absolute maximum on the receiving pin and the thresholds on both sides.' },
      ] },
      { q: 'The shortest pulse on a serial line is 104 µs and others are 208 µs and 312 µs. Which setting should you try first?', kind: 'concept', choices: [
        { t: '9600 baud, 8N1', ok: true, why: '1/104 µs is about 9615 bit/s, 0.2 % from 9600, and the other pulses are whole multiples of that bit time.' },
        { t: '115200 baud, 8N1', why: 'At 115200 a bit lasts about 8.7 µs. A 104 µs pulse would be twelve bits, longer than a whole frame can hold one level.' },
        { t: '4800 baud, 8N1', why: 'At 4800 a bit lasts about 208 µs, so a 104 µs pulse would be half a bit, which a UART never produces.' },
      ] },
      { q: 'You connect adapter RX to board TX and adapter GND to board GND, and see readable text. You then also connect the adapter\'s 5 V pin to the board\'s VCC pin, which measured 3.3 V. What happens?', kind: 'circuit', choices: [
        { t: '5 V is forced onto the 3.3 V rail, which can destroy parts on it', ok: true, why: 'The adapter\'s supply and the board\'s regulator are now joined, and the higher one pushes the rail above what 3.3 V parts tolerate.' },
        { t: 'Nothing, because the board\'s regulator blocks reverse current', why: 'Even if the regulator survives, the rail itself is raised to the higher voltage, and every chip powered from it sees that.' },
        { t: 'The serial data becomes more reliable because the supplies are shared', why: 'A serial link needs a shared ground reference only. Sharing supplies adds no signal integrity and creates a fight between two sources.' },
      ] },
      { q: 'Which change gives the strongest protection for a production device\'s console?', kind: 'security', choices: [
        { t: 'Authenticate or remove the console commands and restrict ROM download mode', ok: true, why: 'These change what the device will do for someone who connects, which is the only thing that matters once they have found the pins.' },
        { t: 'Leaving the header unpopulated so there is nothing to plug into', why: 'The pads, vias and chip pins are still there and can be probed or soldered to in minutes.' },
        { t: 'Using an unusual baud rate that terminal programs do not offer', why: 'The rate is recovered from one pulse-width measurement, as you did in this lesson.' },
        { t: 'Covering the processor and its pads in hard epoxy so the pins cannot be reached', why: 'It raises the effort to reach the pins but leaves the console fully functional for anyone who gets to the traces or removes the epoxy.' },
      ] },
      { q: 'You see no output at all on the adapter. The board\'s TX pin shows activity on a logic analyser. Which cause fits?', kind: 'circuit', choices: [
        { t: 'The board\'s TX is wired to the adapter\'s TX, not its RX', ok: true, why: 'The adapter never receives on its TX pin, so the terminal stays empty even though the board is transmitting.' },
        { t: 'The baud rate is wrong, so the adapter discards every character', why: 'A wrong rate produces garbage characters, not silence. Something arrives at the receiver either way.' },
        { t: 'The board uses 8E1 framing and the terminal is set to 8N1', why: 'A parity mismatch corrupts or flags characters but still delivers them. Complete silence points at wiring.' },
      ] },
    ],
  },
];

const glossary = [
  { term: 'Burden voltage', def: 'The voltage dropped across a multimeter\'s internal shunt when it measures current. It is subtracted from what the circuit under test receives.' },
  { term: 'Bandwidth (oscilloscope)', def: 'The frequency at which a sine wave is displayed at about 70 % (−3 dB) of its true amplitude. Digital edges need several times the signal\'s fundamental.' },
  { term: 'Probe compensation', def: 'Adjusting the trimmer of a ×10 probe against the scope\'s calibration square wave so that the divider is flat across frequency.' },
  { term: 'Trigger', def: 'The condition that defines time zero for a capture, such as an edge crossing a level. Pre-trigger memory keeps what happened before it.' },
  { term: 'Logic analyser', def: 'An instrument that records many digital channels as one bit per sample and decodes protocols from them. It shows no analog detail.' },
  { term: 'Protocol decoder', def: 'Software that turns captured edges into protocol events (bytes, addresses, ACKs). Decoders can be stacked, for example I2C then an EEPROM decoder.' },
  { term: 'sigrok', def: 'An open-source signal analysis suite. **PulseView** is its GUI and **sigrok-cli** its command line.' },
  { term: 'USB-to-UART adapter', def: 'A bridge chip on a small board that presents a serial port to a computer and logic-level TX/RX pins to a target. Its I/O voltage must match the target.' },
  { term: 'Boot log', def: 'Text printed by the ROM, bootloader and firmware on a console during start-up. A primary source of information about an unfamiliar device.' },
];

const troubleshooting = [
  { symptom: 'Multimeter reads a correct rail voltage but the board resets under load', area: 'Power', causes: 'The meter shows an average. A droop lasting microseconds to milliseconds trips the brown-out detector without moving the reading.', fix: 'Capture the rail at the MCU supply pin with a scope: DC coupling, falling-edge trigger just below nominal, Normal mode.' },
  { symptom: 'Scope shows heavy ringing on every digital edge', area: 'Measurement', causes: 'Usually the long ground clip resonating with the probe capacitance, not the board.', fix: 'Repeat with the short ground spring next to the signal. Only ringing that remains is real.' },
  { symptom: 'Scope voltages are ten times too small or too large', area: 'Measurement', causes: 'Probe attenuation switch and channel attenuation setting disagree.', fix: 'Set both to ×10. Verify on the calibration terminal, whose amplitude is printed next to it.' },
  { symptom: 'Logic analyser shows fast random toggling on all channels', area: 'Measurement', causes: 'No ground connection between analyser and target, or unconnected channels left enabled.', fix: 'Connect ground first. Disable unused channels.' },
  { symptom: 'Protocol decoder reports errors but the device works', area: 'Measurement', causes: 'Sample rate too low for the bit rate, wrong decoder parameters (baud, SPI mode), or a threshold unsuited to the logic level.', fix: 'Use at least 4 samples per bit or clock period, check parameters, and check the analyser\'s threshold against the bus voltage.' },
  { symptom: 'Serial terminal shows garbage characters', area: 'UART', causes: 'Wrong baud rate, or a ROM stage printing at a different rate from the application.', fix: 'Measure the shortest pulse and compute the rate. Try the neighbouring standard rates.' },
  { symptom: 'Serial terminal shows nothing', area: 'UART', causes: 'TX wired to TX, no common ground, wrong port selected, or the console is on a different UART or on USB.', fix: 'Confirm activity on the board\'s TX with a scope or analyser, then check that it reaches the adapter\'s RX and that grounds are joined.' },
];

const refs = [
  { org: 'sigrok', title: 'PulseView (logic analyser and scope GUI)', url: 'https://github.com/sigrokproject/pulseview' },
  { org: 'sigrok', title: 'libsigrok (instrument drivers)', url: 'https://github.com/sigrokproject/libsigrok' },
  { org: 'NXP', title: 'UM10204 I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf', note: 'Rise-time and pull-up limits. Not load-tested from this project.' },
];

export default { skills, lessons, labs: [], glossary, troubleshooting, refs };
