// Foundations, lessons 1-3: how the course works, the bench, Linux and serial devices.
// Nothing here was run on physical hardware. Shell transcripts are representative, not captured from a board.

const learning = {
  id: 'fnd-how-to-learn',
  title: 'How this course works and how engineers learn',
  minutes: 35,
  summary: 'Predict, attempt, explain. Why reading is not the same as being able to do it, and how to read the two tables in a datasheet that keep parts alive.',
  skills: ['fnd-learn-loop', 'fnd-datasheet'],
  blocks: [
    `## The problem

You follow a tutorial: an LED and a resistor on a microcontroller pin. It lights. A week later you replace the LED
with a small buzzer you found in a drawer. The board resets every time the buzzer sounds, and after a few tries that
pin never works again.

Nothing in the tutorial was wrong. It told you *what to connect*. It did not tell you *what limits the connection*:
how much current a pin can supply, what happens to the supply rail when you exceed it, and where the manufacturer
writes those limits down. A tutorial transfers a procedure. Engineering needs the model behind the procedure, because
the next circuit is never exactly the one in the tutorial.

This lesson is about how to build that model on purpose, and how this course checks that you have it.`,

    `## Why reading feels like learning and is not

When you read a clear explanation, each sentence makes sense, so you feel you understand. That feeling measures how
fluent the *text* is, not what you can *do*. The test of understanding is whether you can produce the answer with the
page closed, in a situation the page did not cover.

Three habits close that gap. The course is built around them.

1. **Predict.** Before you run code, power a circuit or open an explanation, write down what you expect and why. A
   prediction forces you to use your current model. If it is wrong, you find out exactly where.
2. **Attempt.** Do the exercise before looking at the solution, even badly. A failed attempt tells you which step you
   could not do, which is the only part of the solution you actually need to study.
3. **Explain.** Afterwards, say in your own words why the result came out as it did, at the level of voltage, current,
   registers or bytes. If you can only say "because that is how the example did it", you have a procedure and no model.

Experienced engineers work the same way. Before a measurement they say "I expect about 1.6 V here". If the meter
reads 3.3 V they have learned something in one second. Without the expectation, 3.3 V is just a number.`,

    { t: 'callout', kind: 'why', title: 'Why the course hides solutions until you try', md: `Every exercise keeps its solution locked until you have submitted an answer or used the hints. This is deliberate. If the solution is visible, your eyes go to it, it looks reasonable, and you never discover that you could not have produced it.` },

    `## How progress is earned here

The app records evidence, not page views.

- **Lessons** end with an assessment. A wrong answer shows why it is wrong and lets you try again, but only your
  **first attempt** at each question counts. You master a lesson when at least **80%** of its questions were right
  first time. Retaking is allowed; the best score is kept.
- **Sections** unlock when 80% of the lessons in each prerequisite section are mastered, or when you pass that
  section's checkpoint test. If you already know the material, take the checkpoint and move on.
- **Labs** are recorded in one of two ways once every step is ticked and the lab assessment is passed: *built and
  tested on real hardware*, or *completed without hardware*. You choose, and only you know which is true.
- The **skills matrix** shows, for each skill, the strongest evidence you have: explained (you passed a lesson that
  teaches it), practised (you mastered every lesson for it and completed their exercises), built in a lab, or
  verified on hardware.

The distinction between the last two levels matters. A simulation that behaves correctly proves your reasoning matches
the model. It does not prove your wiring, your power supply or your solder joints.`,

    { t: 'callout', kind: 'sim', title: 'Simulated results and physical results are different kinds of evidence', md: `The interactive tools in this course are **models**. A simulated multimeter never has a flat battery, a simulated wire never has a broken strand inside its insulation, and a simulated pin does not die when you overload it. Each tool states what it leaves out. When you write up a result, say which kind it is: "simulated in the Workbench" or "measured on my board with my meter". Nothing in this course's own material was run on physical hardware, so where a lesson says "you should see", treat it as a prediction to check, not as a measurement someone made.` },

    `## Keep a lab notebook

Memory is unreliable about exactly the details that matter in hardware: which pin, which cable, which firmware
build, what the meter read *before* you changed something. Engineers write these down as they go.

A useful entry has five parts:

| Part | What you write | Example |
|---|---|---|
| Goal | What you are trying to find out | "Does the pull-up hold GPIO4 high with the button open?" |
| Setup | Enough to rebuild it: wiring, supply, firmware version, tool versions | "ESP32 dev board, 10 kΩ from GPIO4 to 3V3, firmware commit a1b2c3d" |
| Prediction | What you expect, with a number if possible | "About 3.3 V open, about 0 V pressed" |
| Observation | What actually happened, including the surprising parts | "3.28 V open; 0.02 V pressed; flickers when I touch the wire" |
| Conclusion and next step | What you now believe and what you will test next | "Works. Flicker suggests a loose jumper; replace and re-measure" |

Write the observation even when it matches the prediction, and especially when it does not. The app has a notebook
(left menu, **Lab notebook**) stored in your browser; you can download it as Markdown. A paper notebook or a text file
in your project's Git repository works just as well. The tool does not matter. The habit does.`,

    { t: 'callout', kind: 'mistake', title: 'Changing three things and noting none', md: `The board does not work, so you swap the cable, move a wire and re-flash, all at once. Now it works. You do not know which change fixed it, so the fault will come back and you will be no faster at finding it. Change one thing, write it down, test.` },

    `## Reading a datasheet: the two tables that keep parts alive

A [[Datasheet]] is the manufacturer's contract for a part. It is long, and most of it you will not need on a given
day. Two tables near the front decide whether your circuit survives, and beginners regularly confuse them.

**[[Absolute maximum ratings]]** are stress limits. Beyond them the part may be permanently damaged. The table almost
always carries a note saying that operation at these limits is *not* implied: the manufacturer promises nothing
about behaviour there, only that going further may destroy the part.

**[[Recommended operating conditions]]** are the range in which every other number in the datasheet is guaranteed.
You design inside this table.

A third table, usually called **DC characteristics** or **electrical characteristics**, tells you what the part does
inside the recommended range: what voltage counts as a logic 1 on an input, how far an output voltage sags when you
draw current from it.`,

    { t: 'ascii', caption: 'Illustrative excerpt. The part is invented and so are the numbers; the layout and wording are what you will find in most microcontroller datasheets.', text: `EXAMPLE-MCU (fictional)

Table 5. Absolute maximum ratings
 Symbol  Parameter                               Min    Max        Unit
 VDD     Supply voltage                          -0.3   3.9        V
 VIN     Voltage on any I/O pin                  -0.3   VDD + 0.3  V
 IIO     Current sourced or sunk by one I/O pin   -     40         mA
 SIIO    Total current, all I/O pins together     -     200        mA
 Note: Stresses beyond those listed may cause permanent damage.
       Functional operation at these conditions is not implied.

Table 6. Recommended operating conditions
 Symbol  Parameter                               Min    Typ   Max  Unit
 VDD     Supply voltage                          3.0    3.3   3.6  V
 TA      Ambient temperature                     -40     -    85   C

Table 9. DC characteristics (VDD = 3.3 V, TA = 25 C)
 Symbol  Parameter               Condition       Min        Max        Unit
 VIH     Input high voltage                      0.75*VDD   -          V
 VIL     Input low voltage                       -          0.25*VDD   V
 VOH     Output high voltage     IOH = 8 mA      VDD - 0.4  -          V
 VOL     Output low voltage      IOL = 8 mA      -          0.4        V` },

    `### Worked example: may I drive this LED?

You want a bright indicator and plan to run an LED at 20 mA straight from an output pin of the fictional part above.

1. **Find the per-pin limit.** Table 5 says 40 mA. 20 mA is below it.
2. **Ask which table that came from.** Table 5 is absolute maximum. It answers "what destroys the pin", not "what may
   I design for".
3. **Find the designed-for current.** Table 9 specifies the output voltage at 8 mA. That condition is the
   manufacturer telling you the load the output stage was characterised with. At 8 mA the high level is guaranteed to
   be at least 3.3 V − 0.4 V = 2.9 V.
4. **Ask what happens at 20 mA.** The datasheet does not say. The output transistor has resistance, so the pin
   voltage will sag further, by an amount nobody has promised. The LED will be dimmer than your calculation, the pin
   will dissipate more heat, and you are relying on behaviour outside the contract.
5. **Decide.** Run the LED at 8 mA or less from the pin, or switch the LED with a transistor so the pin supplies only
   a small control current. Both are designs inside the guaranteed range.

The same reasoning applies to the buzzer in the opening problem: its current exceeded what the pin and the supply
were specified for.`,

    { t: 'predict', q: `Using the excerpt above: the supply is 3.3 V. A sensor module powered from 5 V drives its output to 5 V when active. You connect that output directly to an input pin of the example part. What happens, according to the datasheet?`, choices: [
      { t: 'It reads as logic 1 and nothing else happens: 5 V is well above VIH.', why: `It is above VIH, so it would read as 1, but you have checked only the table that describes behaviour. Look at what Table 5 allows on a pin.` },
      { t: 'It exceeds the absolute maximum pin voltage, so damage is possible even though it would read as logic 1.', ok: true, why: `VIN max is VDD + 0.3 V = 3.6 V. 5 V is 1.4 V beyond the stress limit.` },
      { t: 'It reads as logic 0 because 5 V is outside the valid input range.', why: `Logic thresholds do not work that way. Anything above VIH is a 1. The question is whether the pin survives being held there.` },
    ], reveal: `The limit is written relative to VDD because of how the pin is built: a protection diode runs from the pin to the supply rail. Raise the pin more than a diode drop above VDD and that diode conducts, pushing current into the supply rail through a structure that was never meant to carry it continuously. The part may work for a while and fail later, which is the worst kind of fault to debug. You will design the fix, a voltage divider or level shifter, in the Electronics section.` },

    { t: 'exercise', prompt: `Still using the fictional excerpt. You want eight LEDs lit at the same time, each from its own output pin, each at the 8 mA for which VOH is specified. What total current do the I/O pins supply, in mA? Then decide whether it respects the *total* limit in Table 5.`, hints: [
      `The LEDs are on separate pins, so the currents add.`,
      `Compare your total against the row for all I/O pins together, not the per-pin row.`,
    ], answer: { type: 'number', value: 64, tol: 0.5, unit: 'mA', why: '64 mA is under the 200 mA total, so both the per-pin and total limits are respected.' }, solution: `8 pins × 8 mA = **64 mA**. The per-pin figure (8 mA) is inside the specified condition, and the total (64 mA) is far below the 200 mA absolute maximum for all pins together.

The total limit exists because all the pin currents flow through the same supply and ground pins and bond wires of the chip. A design can respect every per-pin limit and still exceed the total, for example 30 LEDs at 8 mA each (240 mA). Always check both rows.` },

    { t: 'callout', kind: 'mistake', title: 'Designing to "typical"', md: `Datasheet tables have Min, Typ and Max columns. *Typical* describes an average part at room temperature and is not guaranteed. If your circuit only works when a parameter is at its typical value, some of the parts you buy will not work. Design so the circuit works at the guaranteed Min and Max.` },

    `## Harder application: a real datasheet

Do this now with the microcontroller you will use first. For an ESP32 board, find the *ESP32 Series Datasheet* on
Espressif's documentation site (the References page links to it). Do not search for a blog post that quotes the
numbers. Open the PDF and find:

1. The absolute maximum ratings table. Record its section number and the supply-voltage limits.
2. The recommended operating conditions table. Record the supply range.
3. The DC characteristics table. Record the conditions under which the output high and low voltages are specified,
   and any per-pin or cumulative current figures and their footnotes.

Write the section numbers and values in a notebook entry titled "ESP32 electrical limits". This course does not
quote those numbers for you. Finding them is the skill, and a number copied from a course is one more thing that
could be out of date.`,

    { t: 'refs', items: [
      { title: 'Espressif: ESP32 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf', note: 'Candidate URL; not load-tested when this lesson was written. If it has moved, search Espressif\'s documentation page for "ESP32 Series Datasheet".' },
    ] },
  ],
  quiz: [
    { kind: 'concept', q: `You answer a quiz question wrongly, read the explanation, and answer it correctly on the second try. How does this count toward mastering the lesson?`, choices: [
      { t: 'It counts as correct, because you got there in the end.', why: `After the feedback you are recognising the answer, not producing it. The score is meant to measure what you knew before the explanation.` },
      { t: 'It does not count for this attempt; only first-try answers are scored, and you can retake the assessment later.', ok: true, why: `The score is the fraction right first time. Retaking after review is the intended route.` },
      { t: 'It locks the lesson permanently.', why: `Nothing is locked by a wrong answer. The best score across retakes is kept.` },
    ] },
    { kind: 'concept', q: `You finish a lab using only the simulator and record it as "completed without hardware". What does the skills matrix show for the skills in that lab?`, choices: [
      { t: '"Built in a lab", one level below "Verified on hardware".', ok: true, why: `The matrix separates evidence from a model and evidence from a physical board.` },
      { t: '"Verified on hardware", because the simulation produced the correct output.', why: `A model agreeing with your reasoning says nothing about wiring, supply or parts. The matrix keeps those apart for that reason.` },
      { t: 'Nothing; labs done in simulation are not recorded.', why: `Simulation is real evidence of reasoning and is recorded. It is just labelled for what it is.` },
    ] },
    { kind: 'circuit', q: `A part's absolute maximum supply voltage is 3.9 V and its recommended maximum is 3.6 V. Your regulator's output can be anywhere from 3.5 V to 3.8 V depending on load. Is this acceptable?`, choices: [
      { t: 'Yes: 3.8 V is below 3.9 V, so the part is never damaged and therefore works.', why: `"Not damaged" and "works as specified" are different promises. Between the two limits the manufacturer guarantees neither behaviour nor lifetime.` },
      { t: 'No: above 3.6 V the part is outside the range in which its specifications are guaranteed.', ok: true, why: `You design inside the recommended operating conditions. The absolute maximum is a stress limit, not a target.` },
      { t: 'Yes, as long as the typical output of the regulator is 3.6 V or less.', why: `A design has to hold at the extremes the regulator is allowed to reach, not only at its typical value.` },
    ] },
    { kind: 'concept', q: `Which notebook entry will be most useful when the same fault returns in a month?`, choices: [
      { t: '"Fixed the serial problem."', why: `It records that something happened but not what the symptom was, what you changed, or how you knew it was fixed.` },
      { t: '"No output on /dev/ttyUSB0 at 115200. Expected boot log. Swapped USB cable (old one from a power bank): port now appears in dmesg, boot log visible. Old cable has no data lines; labelled it."', ok: true, why: `It has the symptom, the expectation, the single change, the observation and the conclusion.` },
      { t: 'A photo of the working board with no text.', why: `A photo helps with wiring, but it cannot say what was wrong before or which change mattered.` },
    ] },
    { kind: 'circuit', q: `A datasheet specifies VOL ≤ 0.4 V "at IOL = 4 mA". You sink 15 mA through that pin, which is below the absolute maximum pin current. What can you say about the pin's low-level voltage?`, choices: [
      { t: 'It is still at most 0.4 V, because the pin is within its ratings.', why: `The 0.4 V figure is tied to its test condition. At nearly four times that current the output transistor drops more voltage.` },
      { t: 'It is not specified; it will be higher than at 4 mA by an amount the datasheet does not promise.', ok: true, why: `A guarantee applies only under its stated condition. Outside it you are relying on unspecified behaviour.` },
      { t: 'It is exactly 1.5 V, scaling linearly with current.', why: `Scaling linearly assumes a fixed output resistance. The datasheet gives a limit at one condition, not a resistance you can extrapolate from with confidence.` },
    ] },
    { kind: 'concept', q: `Before powering a new circuit you write "expect about 1.65 V at the divider midpoint". The meter reads 3.3 V. What is the value of having written the prediction?`, choices: [
      { t: 'None; the measurement is what matters.', why: `Without an expectation, 3.3 V would look like a perfectly ordinary number and you would move on.` },
      { t: 'It turns the reading into evidence: something in the lower half of the divider is not connected the way you think.', ok: true, why: `The mismatch localises the fault before you have touched anything.` },
      { t: 'It proves the meter is faulty.', why: `That is one hypothesis, but the reading equals the supply voltage, which is exactly what an open lower resistor would give. Test the simplest explanation first.` },
    ] },
  ],
};

const bench = {
  id: 'fnd-bench',
  title: 'Your hardware bench in three tiers',
  minutes: 45,
  summary: 'What to buy first, what to add later, what each instrument is for, which boards are for learning and which are competition hardware, and how to stay safe.',
  skills: ['fnd-bench-plan', 'fnd-safety'],
  blocks: [
    `## The problem

Your first program is flashed. The board should print a line every second. The terminal is empty.

The fault could be in the code, the baud rate, the USB cable, the wrong serial port, a wire in the wrong breadboard
row, or the supply. With only a board and a laptop you can do one thing: change the code and try again. That tests
one of six hypotheses, slowly. Each instrument on a bench exists to let you test a different class of hypothesis
directly. Buying equipment is deciding which questions you want to be able to answer.

This lesson sorts the equipment into three tiers by *the questions it answers*, so you buy the next tool when you
meet the question, not before.`,

    `## Tier 1: beginner

Enough to build and debug every circuit in the Electronics and ESP32 sections.

| Item | What it is for | What to look for |
|---|---|---|
| ESP32 development board | The computer you program. A dev board adds a regulator, a USB connection and buttons around the bare module | A board with pin headers that fit a breadboard, a USB connector, and clearly labelled **EN** (reset) and **BOOT** buttons. Note which chip it carries: ESP32, ESP32-S3, ESP32-C3 and ESP32-C6 differ in CPU architecture and pins |
| Solderless breadboard | Build circuits without soldering | Full-size (about 830 tie points) with power rails. On many boards the rails are split in the middle: check with the meter |
| Jumper wires | Connections | Male-to-male for the breadboard, some male-to-female for modules. Pre-formed solid-core wire keeps a board tidy |
| Resistor assortment | Limit current, set voltages, pull lines up or down | A kit covering 100 Ω to 1 MΩ. Quarter-watt through-hole |
| LEDs and push buttons | The simplest output and input | Standard 5 mm or 3 mm LEDs in a few colours; 6 mm tactile switches |
| Digital multimeter | Measure voltage, resistance, continuity, current | **Continuity mode with a beeper** is the feature you will use most. Auto-ranging saves mistakes. Fused current inputs. Brand is unimportant at these voltages |
| USB **data** cable | Power, flashing and serial console | Must carry data. See the warning below |`,

    { t: 'callout', kind: 'warn', title: 'Charge-only USB cables', md: `Many cables shipped with power banks, lamps and headphones have only the two power wires. The board's power LED lights, so everything looks fine, but the computer never sees a device: nothing appears in \`lsusb\`, no \`/dev/ttyUSB0\`, and flashing fails with "port not found". This is one of the most common first-day faults. Test a new cable once with a device you know enumerates, then label it.` },

    `### A first taste: reading a resistor

Resistor kits arrive in paper strips, and loose resistors end up mixed on the desk. The value is printed as coloured
bands. Try a few in the tool below, then check a real resistor from your kit against your multimeter. The meter is the
authority; band colours are easy to misread under warm light (red, orange and brown especially).`,

    { t: 'widget', name: 'resistor-code', props: { mode: 'explore' }, caption: 'Set the bands of a resistor from your kit and compare the value with your meter reading. Expect the reading to be within the tolerance band, not exactly equal.' },

    `## Tier 2: intermediate

Add these when you start the Protocols, RTOS and Debugging sections. Each answers a question the multimeter cannot.

| Item | Question it answers | What to look for |
|---|---|---|
| Logic analyser | "What bits actually went over this wire, and when?" Records several digital signals and decodes UART, I2C, SPI | **Sample rate** at least four times the fastest signal's bit rate, more for comfort. Eight channels is plenty. Supported by sigrok/PulseView. Input voltage range that includes 3.3 V and 5 V logic |
| USB-to-UART adapter | "What is this other device saying on its serial pins?" A second, independent serial port | **3.3 V logic levels**, or a jumper to select them. A 5 V-only adapter can overstress a 3.3 V pin. Exposes TX, RX and GND; some also expose DTR/RTS |
| I2C and SPI sensor modules | Real peripherals to talk to | Breakout boards that state their supply voltage and logic level. Download the sensor's datasheet before buying |
| Small OLED display | Output that does not depend on the serial port | Check which controller and which bus (I2C or SPI) the module uses, and its I2C address if applicable |
| Hobby servo or small DC motor | Loads that draw real current and inject electrical noise | A motor needs a driver (transistor or driver IC) and usually its own supply |
| External power supply | "Is my problem the supply?" Power that does not come from a USB port | A bench supply with an adjustable **current limit** is the most useful kind: set the limit low and a wiring mistake becomes a reading instead of smoke. A regulated plug-in supply of the right voltage is the minimum |
| Additional ESP32 boards | Two-device experiments: one sends, one receives; one attacks, one defends | Any second board. A different chip variant (for example one Xtensa, one RISC-V) lets you compare |`,

    `## Tier 3: advanced

For the Debugging, Security and eCTF sections.

| Item | Question it answers | What to look for |
|---|---|---|
| Oscilloscope | "What is the *voltage* doing over time?" Shows edges, ringing, noise, supply dips, analogue levels | **Bandwidth** several times the highest frequency you care about, and a sample rate several times the bandwidth. Two channels minimum. Know the probe's ×1/×10 setting |
| JTAG/SWD debug probe | "Where is the CPU, and what is in memory right now?" Halt, step, inspect, flash | Supported by OpenOCD for your target. Check the voltage levels it supports. Many dev boards include a probe on board, in which case you do not need a separate one |
| An ARM Cortex-M development board | Most of the embedded industry and recent eCTF targets use Cortex-M. Learn its debug and interrupt model on a general-purpose board | A vendor evaluation board with an **on-board debugger** and good documentation |
| MAX78000FTHR | Competition hardware; see below | |
| TI MSPM0L2228 development hardware | Competition hardware; see below | |`,

    `## General-purpose learning hardware and official competition hardware are different things

Keep these two categories apart when you plan purchases.

**General-purpose learning hardware** is anything you choose because it is cheap, well documented and widely used.
The ESP32 family is this course's main teaching platform for that reason. Nothing about it is tied to a competition.

**Official competition hardware** is whatever the MITRE eCTF organisers specify for a given year. It changes, and
teams normally receive or are told exactly what to obtain. What the public reference designs show:

| Competition year | Microcontroller | Board | Source |
|---|---|---|---|
| eCTF 2024 | Analog Devices MAX78000 (Arm Cortex-M4 with FPU, plus a RISC-V core) | MAX78000FTHR: the reference design builds for the \`FTHR_RevA\` board support package | [2024 reference design](https://github.com/mitre-cyber-academy/2024-ectf-insecure-example) |
| eCTF 2025 | MAX78000 | MAX78000FTHR, same board support package | [2025 reference design](https://github.com/mitre-cyber-academy/2025-ectf-insecure-example) |
| eCTF 2026 | Texas Instruments MSPM0L2228 (Arm Cortex-M0+) | **Confirm the exact board in that year's rules.** The reference design proves only the microcontroller. TI's evaluation board for the chip is the LP-MSPM0L2228 LaunchPad, but this course could not confirm from a primary source that it is the board the competition uses | [2026 reference design](https://github.com/ectfmitre/2026-ectf-insecure-example) |

Earlier years used entirely different hardware (AVR, PSoC, Zynq FPGA boards, TI Tiva C) and some years were emulated
only. The eCTF section covers that history.`,

    { t: 'callout', kind: 'decision', title: 'Do not buy competition boards to start learning', md: `**Choice:** learn on an ESP32 and a general Cortex-M board first; buy competition hardware only once you have read that year's official rules.

**Why:** the competition target changes between years, the organisers may supply boards or require a specific revision, and the skills that transfer (reading a datasheet, a debugger, a bus capture, a threat model) are not specific to one chip. A MAX78000FTHR bought today is useful for studying the 2024 and 2025 designs, not for a future season on different silicon.

**When the other choice is right:** if you are on a team for a specific year, or you want to reproduce a past year's reference design exactly, get that year's board, and check the rules site for that year before paying.` },

    `## Electrical safety for low-voltage work

Everything in this course runs from USB (5 V) or a low-voltage supply, with logic at 3.3 V. At those voltages the
risk is to the *parts*, to your laptop's USB port, and occasionally to your fingers from something hot. Follow these
rules from the first day.

- **Never work on mains.** No project in this course connects to a wall socket except through a sealed, certified
  power adapter or your computer. Do not open power adapters. Do not build mains circuits on a breadboard. Mains
  voltage can kill, and a breadboard has no isolation at all.
- **Power off before you rewire.** Unplug USB, move the wires, look at the result, then plug in again. Most dead pins
  are killed by a wire brushing a neighbouring row while the board is live.
- **Avoid shorts.** A direct connection from a supply rail to ground carries as much current as the supply can give.
  A USB port will usually shut down to protect itself; a battery will not. Keep the desk clear of loose wire offcuts,
  screws and tools, and never rest a powered board on anything metal.
- **Check the supply rails before connecting a new part.** Measure that the rail really is 3.3 V and not 5 V. Many
  dev boards have both pins next to each other.
- **Mind polarity.** Electrolytic capacitors, LEDs, diodes and most ICs have a correct orientation. A reversed
  electrolytic capacitor can vent or burst.
- **Motors and servos get their own supply**, with its ground joined to the board's ground. Their current and noise
  will reset a microcontroller that shares a USB port's supply with them.
- **Lithium cells deserve respect.** Never short, puncture or charge them with an improvised circuit. This course
  does not require them.
- **Something hot or a smell means power off first**, then investigate. A regulator or chip too hot to touch has
  something wrong connected to it.

### Static electricity

Your body can carry thousands of volts of static charge without you noticing, and a chip input can be damaged by far
less than you can feel. Damage from electrostatic discharge ([[ESD]]) is often partial: the part works but is
weakened. Sensible habits are enough for dev-board work: touch a grounded metal object (the unpainted case of a
plugged-in desktop PC, a grounded bench supply) before handling boards, hold boards by their edges, keep them in
their antistatic bags when stored, and avoid working on carpet in synthetic clothing in dry weather.`,

    { t: 'predict', q: `You plug a new ESP32 board into your Ubuntu machine with a cable that came with a power bank. The board's red power LED lights. You run \`lsusb\` before and after plugging in. What do you expect to see, and what does each outcome tell you?`, reveal: `If the cable is charge-only, \`lsusb\` shows **exactly the same list** before and after. The power LED proves only that the two power wires are intact. The absence of a new USB device localises the fault to everything *before* the operating system's drivers: cable, connector, or the board's USB bridge chip. It cannot be a permissions problem or a wrong baud rate, because those only matter once a device exists.

If a new line does appear (for example a "CP210x UART Bridge" or "CH340 serial converter" entry), the cable carries data and the next thing to check is the device node, which is the subject of the next lesson.

This is the pattern for the whole course: choose the observation that splits the possible causes in half.` },

    { t: 'exercise', prompt: `You want to capture an SPI bus running at 8 MHz with a logic analyser. Using the rule of thumb from the table (sample at least four times the bit rate), what is the minimum sample rate in MS/s? Then decide whether a common low-cost analyser advertised at 24 MS/s is adequate for this bus.`, hints: [
      `One megasample per second (MS/s) is one million samples per second. The bit rate here is 8 million bits per second.`,
      `Four samples per bit: multiply the bit rate by four.`,
    ], answer: { type: 'number', value: 32, tol: 0.5, unit: 'MS/s', why: 'A 24 MS/s analyser gives only three samples per bit here, so it is not adequate for this bus.' }, solution: `4 × 8 MHz = **32 MS/s** minimum. A 24 MS/s analyser takes three samples per clock period. It will show activity, but with so few samples per bit the measured edge positions are wrong by up to a third of a bit, and the SPI decoder will sometimes sample data on the wrong side of a clock edge and report wrong bytes.

Your options: slow the bus down while debugging (most SPI devices are happy at 1 MHz, where 24 MS/s gives 24 samples per bit), or use a faster analyser. Slowing the bus is free and is what engineers usually do first.

The same 24 MS/s analyser is more than enough for UART at 115200 baud (about 208 samples per bit) and I2C at 100 kHz or 400 kHz.

A logic analyser also only records whether each sample was above or below its threshold. If the *shape* of the edge is the problem, you need the oscilloscope.` },

    `## Harder application: plan a purchase

You have finished the beginner tier. Your next project has an ESP32 reading a temperature sensor over I2C and
sending the reading to a second ESP32 over UART. The second board sometimes shows a wrong value.

Write a notebook entry answering:

1. List three different hypotheses for the wrong value (one on the I2C side, one on the UART side, one about power).
2. For each, name the instrument from the tables that would confirm or eliminate it, and the one specification of
   that instrument that matters for this measurement.
3. Which single purchase eliminates the most hypotheses? Justify it.

There is no single correct answer. A good answer names the observation each tool would give you, not just the tool.`,
  ],
  quiz: [
    { kind: 'circuit', q: `A board's power LED is on, but the computer shows no new USB device at all. Which cause fits this observation best?`, choices: [
      { t: 'Your user is not in the dialout group.', why: `Group membership controls who may open a device node. Here no device has been detected at all, so there is nothing to be denied access to.` },
      { t: 'The cable has power wires but no data wires.', ok: true, why: `Power present and no enumeration is the signature of a charge-only cable (or a damaged data line).` },
      { t: 'The baud rate in the terminal is wrong.', why: `Baud rate affects the bytes on an open port. The computer has not even created a port.` },
    ] },
    { kind: 'concept', q: `You are buying a USB-to-UART adapter to listen to the serial pins of a 3.3 V microcontroller. Which property matters most?`, choices: [
      { t: 'It supports very high baud rates.', why: `Nearly every adapter exceeds the rates used for consoles. Speed will not protect the pin you connect it to.` },
      { t: 'Its logic level is 3.3 V, or can be set to 3.3 V.', ok: true, why: `An adapter that drives 5 V onto its TX line can exceed the absolute maximum input voltage of a 3.3 V pin.` },
      { t: 'It has a long cable.', why: `Convenient, but unrelated to whether the electrical levels suit the target.` },
    ] },
    { kind: 'concept', q: `A teammate says: "eCTF uses the MAX78000FTHR, so let's all buy one to prepare for next season." What is the accurate response?`, choices: [
      { t: 'Correct; eCTF hardware is fixed.', why: `The public reference designs show the target changing across years, including a change of vendor and CPU core between 2025 and 2026.` },
      { t: 'The MAX78000FTHR was the target for eCTF 2024 and 2025; 2026 uses a TI MSPM0L2228. Confirm the hardware in the rules for the season you are entering before buying.', ok: true, why: `Competition hardware is specified per year, and the official rules for that year are the authority.` },
      { t: 'eCTF is run entirely in emulation, so no hardware is needed.', why: `Some past years were emulated, but recent years use physical microcontroller boards.` },
    ] },
    { kind: 'circuit', q: `Why does a bench supply with an adjustable current limit protect a first prototype better than powering it straight from a battery pack?`, choices: [
      { t: 'It provides a more accurate voltage.', why: `Accuracy is helpful but does not limit the damage from a wiring mistake.` },
      { t: 'With the limit set just above the expected current, a short becomes a limited current and a visible reading instead of the full current the source can deliver.', ok: true, why: `Limiting fault current limits heating, which is what destroys parts and tracks.` },
      { t: 'It isolates the circuit from static electricity.', why: `A supply's current limit acts on current drawn from its output. It does nothing about static discharge from your hand.` },
    ] },
    { kind: 'circuit', q: `You need to move a jumper on a powered breadboard to a neighbouring row. What is the right procedure, and why?`, choices: [
      { t: 'Move it quickly; brief contact is harmless.', why: `A wire that touches the wrong row for a few milliseconds can still put a supply rail on a pin or short two outputs. Damage does not need long.` },
      { t: 'Disconnect power, move the wire, check the wiring, reconnect.', ok: true, why: `With no power there is no fault current, whatever the wire touches on its way.` },
      { t: 'Hold the reset button while moving it.', why: `Reset stops the program but the supply rails and pin protection structures are still live.` },
    ] },
    { kind: 'concept', q: `An I2C bus shows correct bytes on the logic analyser, yet the device sometimes misses its address. A colleague suspects slow, rounded rising edges. Which instrument tests that hypothesis?`, choices: [
      { t: 'The logic analyser, at a higher sample rate.', why: `It reports only above or below a threshold at each sample. A slow edge and a fast edge look the same once they have crossed it.` },
      { t: 'An oscilloscope, which shows the voltage of the edge over time.', ok: true, why: `Edge shape is an analogue property. Only an instrument that records voltage can show it.` },
      { t: 'A multimeter on DC volts.', why: `A multimeter averages over a time far longer than one bus edge, so it cannot show an event lasting microseconds.` },
    ] },
  ],
};

const linux = {
  id: 'fnd-linux',
  title: 'Linux command line and Ubuntu setup for embedded work',
  minutes: 50,
  summary: 'The shell commands you actually need, how a USB board becomes /dev/ttyUSB0, why you need the dialout group, and what quietly steals serial ports.',
  skills: ['fnd-linux-serial'],
  blocks: [
    `## The problem

You plug in the board and run the flash command. It answers:

\`\`\`text
Could not open /dev/ttyUSB0, the port is busy or doesn't exist.
([Errno 13] could not open port /dev/ttyUSB0: [Errno 13] Permission denied: '/dev/ttyUSB0')
\`\`\`

Or, worse, the port is not there at all. Or it is there for two seconds and vanishes.

The tempting fix is \`sudo\` in front of everything. That creates root-owned files in your project, breaks the next
build, and hides the cause. Each of those three symptoms has a specific cause that Linux will tell you about if you
know where to look. This lesson is about where to look.`,

    `## Shell essentials

You do not need to be a Linux administrator. You need about twenty commands. If you already use a terminal daily,
skim the table and move on.

| Task | Command | Note |
|---|---|---|
| Where am I, what is here | \`pwd\`, \`ls -l\`, \`ls -la\` | \`-a\` shows hidden files such as \`.gitignore\` |
| Move around | \`cd dir\`, \`cd ..\`, \`cd ~\`, \`cd -\` | \`cd -\` returns to the previous directory |
| Make, copy, move, delete | \`mkdir -p a/b\`, \`cp -r src dst\`, \`mv old new\`, \`rm file\`, \`rm -r dir\` | \`rm\` has no undo |
| Look at a file | \`less file\`, \`head -n 20 file\`, \`tail -f log\` | \`q\` quits \`less\`; \`tail -f\` follows a growing file |
| Search text | \`grep -rn "text" dir\` | \`-r\` recursive, \`-n\` line numbers |
| Find a file | \`find . -name "*.bin"\` | |
| Which program runs | \`which idf.py\`, \`command -v gcc\` | Tells you which copy is on your PATH |
| Environment variables | \`echo $PATH\`, \`export NAME=value\`, \`env\` | Set for the current shell only |
| Run a script *in* this shell | \`. ./export.sh\` (same as \`source ./export.sh\`) | Needed when the script must change your current shell's environment |
| Save output to a file | \`cmd > out.txt\`, \`cmd >> out.txt\` | \`>\` overwrites, \`>>\` appends |
| Become administrator for one command | \`sudo cmd\` | For installing packages and editing system files only |
| Install software | \`sudo apt update\`, \`sudo apt install pkg\` | |
| Who am I, which groups | \`whoami\`, \`id\`, \`groups\` | |
| Processes | \`ps aux\`, \`pgrep -a name\`, \`kill PID\` | |
| Manual | \`man cmd\`, \`cmd --help\` | |

A **pipe** connects the output of one command to the input of the next. You will use two forms constantly:

\`\`\`bash
dmesg | grep -i tty            # keep only the lines that mention tty
idf.py build 2>&1 | tee build.log   # show the output and save it; 2>&1 includes error messages
\`\`\`

Two shell behaviours cause most beginner confusion:

- **Environment changes are per shell.** Setting a variable or activating a tool environment affects that terminal
  window only. A new terminal starts clean. That is why a build that worked a minute ago fails in a new tab with
  "command not found".
- **\`./script.sh\` and \`. ./script.sh\` are different.** The first starts a child shell, runs the script, and
  throws the child's environment away. The second runs the lines in your current shell so the changes stay. Tool
  environment scripts such as ESP-IDF's \`export.sh\` must be run the second way.`,

    `## How a board becomes a file

Most development boards do not connect the microcontroller's serial pins straight to USB. A small **USB-to-UART
bridge** chip sits between them.`,

    { t: 'figure', caption: 'The path from your terminal program to the microcontroller. Each arrow is a place where the chain can break, and each has its own way to check.', svg: `<svg viewBox="0 0 720 190" xmlns="http://www.w3.org/2000/svg" font-family="inherit" font-size="12" fill="currentColor">
<g fill="var(--surface)" stroke="var(--line)" stroke-width="1.5">
<rect x="8" y="40" width="120" height="60" rx="6"/><rect x="160" y="40" width="120" height="60" rx="6"/><rect x="312" y="40" width="110" height="60" rx="6"/><rect x="454" y="40" width="120" height="60" rx="6"/><rect x="606" y="40" width="106" height="60" rx="6"/>
</g>
<g text-anchor="middle">
<text x="68" y="66">Terminal or</text><text x="68" y="82">flashing tool</text>
<text x="220" y="60">Device node</text><text x="220" y="76" font-family="monospace">/dev/ttyUSB0</text><text x="220" y="92">(permissions)</text>
<text x="367" y="66">Kernel driver</text><text x="367" y="82">+ USB cable</text>
<text x="514" y="66">USB-to-UART</text><text x="514" y="82">bridge chip</text>
<text x="659" y="66">MCU UART</text><text x="659" y="82">TX / RX pins</text>
</g>
<g stroke="var(--sig1)" stroke-width="2" fill="none"><path d="M128 70h32M280 70h32M422 70h32M574 70h32"/></g>
<g fill="var(--sig1)"><path d="M160 70l-7-4v8zM312 70l-7-4v8zM454 70l-7-4v8zM606 70l-7-4v8z"/></g>
<g text-anchor="middle" fill="var(--muted)" font-size="11">
<text x="144" y="130">open()</text><text x="144" y="144">ls -l, id</text>
<text x="296" y="130">driver bound?</text><text x="296" y="144">dmesg</text>
<text x="438" y="130">enumerated?</text><text x="438" y="144">lsusb</text>
<text x="590" y="130">bytes on the wire?</text><text x="590" y="144">logic analyser</text>
</g>
<text x="8" y="176" fill="var(--muted)" font-size="11">On boards with native USB (for example the USB Serial/JTAG controller in ESP32-S3, C3 and C6) the bridge is inside the chip.</text>
</svg>` },

    `When you plug the cable in, this happens in order:

1. **Enumeration.** The USB host asks the new device what it is. The device answers with a vendor ID, a product ID
   and descriptors. \`lsusb\` lists every device that got this far.
2. **Driver binding.** The kernel matches the IDs or the device class to a driver. Common bridge chips (Silicon Labs
   CP210x, WCH CH340/CH341, FTDI) each have their own driver. Devices that implement the standard USB serial class
   (CDC-ACM) use the generic \`cdc_acm\` driver.
3. **Device node.** The driver registers a serial port and \`udev\` creates a file for it in \`/dev\`.

The name of that file tells you which kind of driver bound:

| Node | Driver type | Typical devices |
|---|---|---|
| \`/dev/ttyUSB0\` | Vendor-specific USB-serial bridge driver | Boards with a CP210x, CH340 or FTDI bridge chip: most classic ESP32 dev boards |
| \`/dev/ttyACM0\` | USB CDC-ACM class driver | Native-USB microcontrollers and on-board debug probes: the ESP32-S3/C3/C6 USB Serial/JTAG port, DAPLink-style probes |

The number is assigned in order of arrival. Unplug and replug while a program still has the old node open, and the
board may come back as \`ttyUSB1\`.

### Watching it happen

\`dmesg\` prints the kernel's log. With \`-w\` it keeps running and shows new lines as they arrive. Start it, then
plug in the board.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Representative output for a board with a CP2102 bridge. Your timestamps, bus numbers and chip will differ. On some systems dmesg needs sudo.', code: `$ sudo dmesg -w
[ 1042.118] usb 1-2: new full-speed USB device number 7 using xhci_hcd
[ 1042.267] usb 1-2: New USB device found, idVendor=10c4, idProduct=ea60
[ 1042.267] usb 1-2: Product: CP2102 USB to UART Bridge Controller
[ 1042.301] cp210x 1-2:1.0: cp210x converter detected
[ 1042.303] usb 1-2: cp210x converter now attached to ttyUSB0
^C
$ lsusb
Bus 001 Device 007: ID 10c4:ea60 Silicon Labs CP210x UART Bridge
$ ls -l /dev/ttyUSB0
crw-rw---- 1 root dialout 188, 0 Nov 13 10:02 /dev/ttyUSB0`, explain: [
      { lines: '2', md: `The host controller saw a device connect. If you plug in and **no line appears at all**, the fault is electrical: cable, connector or board.` },
      { lines: '3-4', md: `Enumeration succeeded: the device reported its vendor ID (\`10c4\`) and product ID (\`ea60\`). These two numbers are what drivers and udev rules match on.` },
      { lines: '5-6', md: `The \`cp210x\` driver claimed the device and created \`ttyUSB0\`. This last line is the one that tells you which node to use.` },
      { lines: '9', md: `\`lsusb\` shows the same IDs. Use it for a quick before-and-after comparison.` },
      { lines: '11', md: `The node is a character device (\`c\`), owned by user \`root\` and group \`dialout\`. The mode \`rw-rw----\` gives read and write to the owner and the group, and **nothing** to everyone else.` },
    ] },

    `## Permissions: the dialout group

Line 11 above explains the "Permission denied" in the opening problem. A device node is a file, and Linux applies
ordinary file permissions to it. On Ubuntu, serial ports belong to the group \`dialout\` (the name is a leftover
from dial-up modems). A normal user is not in that group, so falls under "everyone else" and gets no access.

The fix is to add your user to the group once:`,

    { t: 'code', lang: 'bash', status: 'reviewed', code: `sudo usermod -aG dialout "$USER"
# log out of the desktop session and back in (or reboot), then:
id -nG`, explain: [
      { lines: '1', md: `\`-G dialout\` names the group; \`-a\` means *append*. Without \`-a\`, \`usermod -G\` **replaces** your supplementary groups with just this one, which on a desktop system removes you from \`sudo\` among others. Always type \`-aG\`.` },
      { lines: '2', md: `Group membership is read when a login session starts. Terminals you already have open keep the old list.` },
      { lines: '3', md: `Prints the groups of the *current* session. \`dialout\` must appear here. If it appears in \`getent group dialout\` but not here, you have not started a new session yet.` },
    ] },

    { t: 'callout', kind: 'mistake', title: 'Fixing permissions with sudo or chmod 666', md: `\`sudo idf.py flash\` appears to work, but it runs the whole build as root: files in your \`build\` directory become root-owned and the next ordinary build fails with permission errors of its own. \`sudo chmod 666 /dev/ttyUSB0\` works until you unplug the board, because the node is created fresh each time. Both treat the symptom. Group membership fixes the cause once.` },

    { t: 'predict', q: `You run \`sudo usermod -aG dialout "$USER"\`. It prints nothing, which means it succeeded. Without closing the terminal, you immediately run the flash command again. What happens?`, choices: [
      { t: 'It works: the group was added.', why: `The group database was updated, but a running session does not re-read it. Check what \`id -nG\` prints in that same terminal.` },
      { t: 'Permission denied again, until you start a new login session.', ok: true, why: `A process inherits its group list from the session that started it, and that list was fixed at login.` },
      { t: 'It fails because usermod needs the board unplugged.', why: `\`usermod\` edits the account database. It has no connection to any device.` },
    ], reveal: `Every process carries a list of group IDs, copied from its parent. Your terminal got its list from the desktop session, which got it at login. Editing \`/etc/group\` changes what the *next* login will receive. Logging out of the desktop and back in is the reliable fix; a reboot always works. \`newgrp dialout\` starts a sub-shell with the new group for a quick test, but only that one shell is affected.` },

    `## udev rules: stable names and special cases

\`udev\` is the service that creates device nodes and sets their owner and mode, following rule files in
\`/etc/udev/rules.d/\` and \`/usr/lib/udev/rules.d/\`. You need to know it exists for three reasons.

**A stable name.** With two boards connected, which is \`ttyUSB0\` depends on which you plugged in first. A rule can
create a symbolic link with a name you choose:`,

    { t: 'code', lang: 'text', status: 'reviewed', caption: '/etc/udev/rules.d/99-bench.rules — one rule per line. Use the IDs your own board reports in lsusb.', code: `SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="bench_esp32", GROUP="dialout", MODE="0660"`, explain: [
      { lines: '1', md: `Comparisons use \`==\`; assignments use \`=\` or \`+=\`. This reads: for any \`tty\` device whose USB parent has vendor \`10c4\` and product \`ea60\`, also create \`/dev/bench_esp32\` pointing at it, and set group and mode. Two identical boards share the same IDs; to tell them apart, add a match on \`ATTRS{serial}\` if the bridge chip has a unique serial number (\`udevadm info -a /dev/ttyUSB0\` lists what is available).` },
    ] },

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Apply new rules without rebooting, then replug the board.', code: `sudo udevadm control --reload-rules
sudo udevadm trigger
ls -l /dev/bench_esp32` },

    `**Debug probes.** JTAG/SWD probes are not serial ports. Tools such as OpenOCD talk to them as raw USB devices, and
raw USB devices are root-only by default. Probe vendors and OpenOCD ship udev rule files that grant access. You will
install one in the Debugging section; for now, recognise the symptom: OpenOCD reports a USB access or permission
error while the probe is visible in \`lsusb\`.

**Telling other services to keep away**, which is the next topic.`,

    `## Things that steal your serial port

Two services on a desktop Ubuntu installation react to new serial devices.

**brltty** is a driver for Braille displays. Some Braille displays use the same USB bridge chips as dev boards, so
on affected Ubuntu releases brltty claims a newly attached CH340 or CP210x device, and the serial driver is
disconnected moments after attaching. In \`dmesg -w\` you should see the converter attach to \`ttyUSB0\` and then a
line saying it is **now disconnected**, often next to a line mentioning \`brltty\`. The port appears and vanishes. If
you do not use a Braille display, remove the package:

\`\`\`bash
sudo apt remove brltty
\`\`\`

**ModemManager** manages mobile-broadband modems. When any new serial port appears it may open the port and send
modem "AT" commands to see whether a modem answers. For a few seconds the port is busy, and your board receives
bytes it did not expect, which can confuse a bootloader that is waiting for a flashing tool. Symptoms: the first
flash attempt after plugging in fails and the second works, or stray characters arrive at boot. If you have no
mobile-broadband modem, you can stop and disable the service with \`sudo systemctl disable --now ModemManager\`. A
narrower fix is a udev rule that adds \`ENV{ID_MM_DEVICE_IGNORE}="1"\` for your board's vendor and product IDs.

To see what has a port open right now:

\`\`\`bash
sudo fuser -v /dev/ttyUSB0
\`\`\``,

    { t: 'callout', kind: 'warn', title: 'Virtual machines and WSL add another link to the chain', md: `A USB device belongs to the host operating system until you hand it to the guest.

- **Virtual machines (VirtualBox, VMware, UTM and similar):** attach the device to the VM through the hypervisor's USB menu or a USB filter. Many boards **reset and re-enumerate** when flashing starts, sometimes with a different product ID in bootloader mode; without a filter that matches both, the device silently returns to the host in the middle of flashing. USB passthrough also adds latency, which can cause flashing timeouts at high baud rates.
- **WSL 2 on Windows:** WSL does not see USB devices by default. Microsoft documents attaching them with the \`usbipd-win\` tool, which forwards a device from Windows into WSL. You must re-attach after each replug or board reset that re-enumerates.
- **Docker:** a container sees only the device nodes you pass in, as they existed when the container started. Lesson 5 covers this.

For the least friction while learning, use Ubuntu installed directly on the machine (dual boot is fine). If you use a VM or WSL, add "is the device attached to the guest?" as the first check in every serial problem.` },

    { t: 'exercise', prompt: `You plug in an ESP32-C3 board by its native USB port. \`dmesg -w\` shows:

\`\`\`text
usb 1-3: New USB device found, idVendor=303a, idProduct=1001
usb 1-3: Product: USB JTAG/serial debug unit
cdc_acm 1-3:1.0: ttyACM0: USB ACM device
\`\`\`

Which device path do you give the flashing tool?`, hints: [
      `Look for the driver name at the start of the last line and the node name it reports.`,
      `Nodes live in \`/dev\`. The driver here is the CDC-ACM class driver, not a vendor bridge driver.`,
    ], answer: { type: 'text', accept: ['/dev/ttyACM0'], placeholder: '/dev/…', nudge: 'Give the full path, starting with /dev/.' }, solution: `\`/dev/ttyACM0\`. The \`cdc_acm\` driver bound, so the node is an ACM device, not \`ttyUSB\`. This board has no separate bridge chip: the ESP32-C3's built-in USB Serial/JTAG controller presents a standard CDC-ACM serial port (and a JTAG interface) directly.

If you had typed \`/dev/ttyUSB0\` from habit, the tool would report that the port does not exist, and you might have gone looking for a cable fault. Read the last \`dmesg\` line rather than assuming.` },

    `## Harder application: diagnose from the log

A classmate using Ubuntu sends you this and says "my cable must be broken, the port keeps disappearing":

\`\`\`text
usb 1-2: new full-speed USB device number 9 using xhci_hcd
usb 1-2: New USB device found, idVendor=1a86, idProduct=7523
usb 1-2: Product: USB Serial
ch341 1-2:1.0: ch341-uart converter detected
usb 1-2: ch341-uart converter now attached to ttyUSB0
input: BRLTTY 6.4 Linux Screen Driver Keyboard as /devices/virtual/input/input31
usb 1-2: usbfs: interface 0 claimed by ch341 while 'brltty' sets config #1
ch341-uart ttyUSB0: ch341-uart converter now disconnected from ttyUSB0
\`\`\`

Before reading on, write down: (1) Is the cable broken? Which lines prove your answer? (2) What is the cause?
(3) What is the fix, and how will you verify it?`,

    { t: 'exercise', prompt: `Answer part (2): which program is responsible for the port disappearing? Give its name.`, hints: [
      `The cable carried enough data for the device to report a vendor ID, a product ID and a product string.`,
      `Read the two lines after "now attached to ttyUSB0". Another program is named.`,
    ], answer: { type: 'text', accept: ['brltty', 'the brltty (service|daemon|package)', 'brltty (service|daemon|package)'], placeholder: 'program name' }, solution: `**brltty.**

1. The cable is fine. Lines 2 to 5 show full enumeration and the \`ch341\` driver attaching to \`ttyUSB0\`. A charge-only cable would produce no lines at all.
2. brltty reconfigured the device ("\`'brltty' sets config #1\`"), which made the kernel detach the serial driver ("now disconnected from ttyUSB0").
3. Fix: \`sudo apt remove brltty\` (if no Braille display is in use), then unplug and replug. Verify by watching \`dmesg -w\`: the "now attached to ttyUSB0" line should be the last one, and \`ls -l /dev/ttyUSB0\` should show the node still present ten seconds later.

Notice what made this quick: the log was read line by line, and each line eliminated a hypothesis.` },

    { t: 'refs', items: [
      { title: 'Espressif: Establish serial connection with ESP32 (ESP-IDF docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/establish-serial-connection.rst', note: 'Includes the dialout group step for Linux.' },
      { title: 'Espressif: USB Serial/JTAG controller console', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/usb-serial-jtag-console.rst' },
      { title: 'Microsoft: Connect USB devices to WSL', url: 'https://learn.microsoft.com/en-us/windows/wsl/connect-usb' },
      { title: 'udev(7) manual page', url: 'https://www.freedesktop.org/software/systemd/man/latest/udev.html' },
    ] },
  ],
  quiz: [
    { kind: 'concept', q: `\`ls -l /dev/ttyUSB0\` prints \`crw-rw---- 1 root dialout ...\`. Your user is in the groups \`sudo\` and \`plugdev\` only. What happens when a program you run tries to open the port?`, choices: [
      { t: 'It opens, because you are in the sudo group.', why: `Membership of \`sudo\` lets you *run commands with sudo*. It does not give your ordinary processes any extra file access.` },
      { t: 'Permission denied: you are neither the owner nor in the owning group, and "others" have no access.', ok: true, why: `The last three permission characters are \`---\`. Your process falls into that class.` },
      { t: 'It opens read-only.', why: `Read access for others would show as \`r--\` in the last three characters. Here they are all dashes.` },
    ] },
    { kind: 'concept', q: `Why must ESP-IDF's environment script be run as \`. ./export.sh\` and not \`./export.sh\`?`, choices: [
      { t: 'The leading dot makes it run as root.', why: `The dot has nothing to do with privileges. It is the shell's "read and execute in this shell" command.` },
      { t: 'It sets PATH and other variables, and those must be set in your current shell, not in a child shell that exits.', ok: true, why: `A child process cannot change its parent's environment. Sourcing runs the lines in the current shell.` },
      { t: 'The script has no execute permission, and the dot works around that.', why: `Even with execute permission, running it as a program would set the variables in a child shell and then discard them.` },
    ] },
    { kind: 'circuit', q: `A board appears as \`/dev/ttyACM0\` instead of \`/dev/ttyUSB0\`. What does that tell you about its hardware?`, choices: [
      { t: 'It is faulty; serial devices should be ttyUSB.', why: `Both names are normal. They reflect which kernel driver is in use.` },
      { t: 'Its USB interface presents the standard CDC-ACM serial class, as native-USB microcontrollers and many on-board debug probes do, not a vendor-specific bridge chip.', ok: true, why: `The \`cdc_acm\` driver creates \`ttyACM\` nodes; bridge-chip drivers create \`ttyUSB\` nodes.` },
      { t: 'It runs at a fixed baud rate of 9600.', why: `The node name says nothing about speed. It reflects the driver that bound.` },
    ] },
    { kind: 'concept', q: `After plugging in a board, the first flashing attempt fails with "port is busy" and a second attempt ten seconds later succeeds. \`dmesg\` shows the port attached and staying attached. Which explanation fits?`, choices: [
      { t: 'A charge-only cable.', why: `With no data wires the port would never appear and the second attempt could not succeed.` },
      { t: 'ModemManager probing the new serial port for a few seconds.', ok: true, why: `It opens new ports briefly to look for a modem, then lets go. That matches "busy at first, fine later".` },
      { t: 'Your user is missing from the dialout group.', why: `A missing group gives "permission denied" every time. It would not clear up by itself after ten seconds.` },
    ] },
    { kind: 'concept', q: `You type \`sudo usermod -G dialout $USER\`, leaving out \`-a\`. What is the consequence?`, choices: [
      { t: 'Nothing different; -a is optional.', why: `The flag changes the meaning of \`-G\` from "add to" to "set to exactly".` },
      { t: 'Your supplementary groups are replaced by dialout alone, so at next login you are no longer in groups such as sudo.', ok: true, why: `Without \`-a\`, \`-G\` sets the complete list. Recovering can require a rescue boot.` },
      { t: 'The command fails with an error.', why: `It succeeds silently, which is what makes this mistake dangerous.` },
    ] },
    { kind: 'concept', q: `In a virtual machine, flashing starts, then fails halfway with "device disconnected". On the host OS a new USB device notification appears at the same moment. What most likely happened?`, choices: [
      { t: 'The board re-enumerated during flashing and the hypervisor returned the new device to the host instead of the guest.', ok: true, why: `Passthrough is per device. A reset that changes how the board identifies itself needs a filter that matches the new identity too.` },
      { t: 'The dialout group membership expired.', why: `Group membership does not expire during a session, and it would not make a device show up on the host.` },
      { t: 'The baud rate was too low.', why: `A low baud rate makes flashing slow. It does not make a USB device move from guest to host.` },
    ] },
  ],
};

export default [learning, bench, linux];
