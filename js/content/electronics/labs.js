// Electronics labs: first circuits, and a fault-finding lab.
import { figButtonPullup } from './figures.js';

export default [
  /* ------------------------------------------------------------------ A */
  {
    id: 'elec-lab-first-circuits', title: 'Lab A: First circuits on the virtual and real breadboard', kind: 'Guided lab', minutes: 120,
    summary: 'Build an LED circuit and a button with a pull-up, first in simulation and then with real parts, and compare every prediction with a measurement.',
    skills: ['elec-led-resistor', 'elec-pullup', 'elec-schematic', 'elec-multimeter', 'elec-ohm-calc'],
    objectives: [
      'Translate a schematic into breadboard connections net by net',
      'Calculate and select a current-limiting resistor, then confirm the current by measurement',
      'Build a button input with a pull-up and verify both logic levels with a meter',
      'Use a multimeter correctly for voltage, continuity, resistance and current',
      'Keep a predicted-against-measured table and explain every difference larger than the tolerances allow',
    ],
    hardware: [
      'Solderless breadboard and jumper wires',
      'A 3.3 V source: the 3V3 and GND pins of a development board powered over USB, or two AA cells in a holder (about 3 V)',
      'Resistors: 220 Ω, 330 Ω, 1 kΩ, 10 kΩ (two of each)',
      'One red and one green or blue 5 mm LED',
      'One tactile push-button',
      'A digital multimeter with spare fuse',
    ],
    software: [
      'This course: the breadboard and LED-resistor widgets',
      'The course notebook, or paper, for the results table',
    ],
    background: [
      `This lab uses no firmware. The "GPIO" is simply the 3.3 V rail, so that everything you observe is explained by the
      electronics alone. You will do each circuit twice: in the simulated breadboard, where mistakes are free, and then with
      real parts, where the numbers will differ slightly from the ideal ones. Explaining those differences is the point.

      Before you start, re-read the breadboard figure in the lesson on reading circuit diagrams, and the multimeter callout in
      the lesson on grounding and faults.`,
      { t: 'callout', kind: 'sim', md: `The widgets in this lab are simulations with ideal parts. The measurements in the hardware steps are yours to make: this course has not been run on physical hardware, so the "you should see" values are calculated expectations, not recorded results.` },
      { t: 'callout', kind: 'warn', md: `Use only the low-voltage source listed. Before connecting power to any real circuit: check for a short between the supply rail and ground with the continuity range, and check LED polarity. If anything gets warm, disconnect power first and investigate second.` },
    ],
    diagram: [
      { t: 'ascii', text: `
Circuit 1: LED with current-limiting resistor

  3V3 ──[ R1 330 Ω ]──▶|── GND          ▶| = LED, anode on the left
                      LED1

  Net        Terminals
  3V3        supply +, R1 end A
  N1         R1 end B, LED1 anode (long lead)
  GND        LED1 cathode (short lead), supply −

Circuit 2: button with pull-up

  3V3 ──[ R2 10 kΩ ]──┬── node "IN"  (measure here)
                      │
                    [ SW1 ]
                      │
                     GND

  Net        Terminals
  3V3        supply +, R2 end A
  IN         R2 end B, SW1 side 1, meter red probe
  GND        SW1 side 2, supply −, meter black probe`, caption: 'Both circuits as schematics and as net lists. Build from the net lists.' },
      { t: 'figure', svg: figButtonPullup, caption: 'Circuit 2 drawn with standard symbols. In this lab the "GPIO input" is your multimeter.' },
    ],
    steps: [
      { title: 'Predict circuit 1', md: `Take the red LED's forward voltage as 2.0 V and the supply as 3.3 V. In your notebook, calculate for R1 = 330 Ω: the voltage across R1, the current, and the power in R1. Then repeat for R1 = 220 Ω and R1 = 1 kΩ. Start the results table below with your predictions in the first column. Do not build anything yet.`,
        blocks: [
          { t: 'ascii', text: `
Quantity                     | Predicted | Simulated | Measured | Difference explained by
-----------------------------+-----------+-----------+----------+------------------------
Supply voltage               |  3.30 V   |           |          |
V across R1 (330 Ω)          |           |           |          |
V across LED1                |  2.0 V    |           |          |
Current (from V_R1 / R1)     |           |           |          |
Current (meter in series)    |           |           |          |
R1 actual resistance         |  330 Ω    |    —      |          |
Circuit 2: V(IN) released    |           |           |          |
Circuit 2: V(IN) pressed     |           |           |          |
Circuit 2: current pressed   |           |           |          |`, caption: 'Results table. Copy it into the notebook.' },
          { t: 'exercise', prompt: `What current do you predict for R1 = 330 Ω, in milliamps?`, hints: [`The resistor has the supply minus the LED forward voltage across it.`, `I = (3.3 − 2.0) / 330.`], solution: `(3.3 − 2.0) V / 330 Ω = **3.9 mA**. For 220 Ω: 5.9 mA. For 1 kΩ: 1.3 mA. Power in the 330 Ω resistor: 1.3 V × 3.9 mA ≈ 5 mW.`, answer: { type: 'number', value: 3.94, tol: 0.1, unit: 'mA' } },
        ] },
      { title: 'Build circuit 1 on the virtual breadboard', md: `Build the LED circuit in the simulator. Place each part so that its two leads are in different strips, and complete the path to ground. In the simulator, feed R1 from pin IO0 set to "Output HIGH" instead of from the 3V3 pin: the task checks that a pin controls the LED. IO0 driven high stands in for the 3.3 V rail, with one difference that the model includes: the pin has about 30 Ω of output resistance (a typical order of magnitude, not a datasheet figure). The virtual board is also drawn a quarter-turn from the lesson figure, so its five-hole strips are numbered *rows* (a–e and f–j) and the rails run down the sides. Record the simulated current in the table, and account for any difference from your prediction: the simulator has its own value for the red LED's forward voltage. Then deliberately break it in three ways and note what the simulator shows each time: reverse the LED; put both resistor leads in the same column; move the ground jumper to the wrong rail.`,
        blocks: [ { t: 'widget', name: 'breadboard', props: { challenge: 'led' }, caption: 'Circuit 1 in simulation.' } ] },
      { title: 'Check your parts and your breadboard', md: `With the real parts, and **no power connected**:

- Measure each resistor on the resistance range and write down the actual values. Confirm you have not mistaken 330 Ω (orange, orange, brown) for 33 kΩ (orange, orange, orange).
- On the continuity range, confirm how your breadboard is connected: along a column of five, across the centre gap (should be open), along a power rail, and **across the middle of the power rail**. Note whether your rails are split.
- On the diode-test range, touch the red probe to the LED's long lead and the black to the short lead. A red LED should glow faintly and the meter should show its forward voltage. Reverse the probes: it should show open circuit. Record the forward voltage.` },
      { title: 'Build and measure circuit 1 for real', md: `Build circuit 1 from the net list with R1 = 330 Ω. Before connecting the supply, check continuity between the supply rail and the ground rail: there must be no beep. Connect power. The LED should light.

Measure, with the meter on DC volts and the circuit powered:

1. The supply, between the 3V3 rail and the GND rail, *at the breadboard*.
2. The voltage across R1 (one probe on each lead of the resistor).
3. The voltage across the LED.

Check Kirchhoff's voltage law: readings 2 and 3 should add up to reading 1 within a few millivolts.

Calculate the current as (voltage across R1) / (measured resistance of R1). Enter everything in the table.` },
      { title: 'Measure the current directly', md: `Disconnect power. Move the meter's red lead to the mA socket and select the mA DC range. Open the circuit between R1 and the LED: lift the resistor lead out of the shared column and put it in an empty column. Connect the meter probes between that lead and the LED anode, so the meter completes the circuit. Reconnect power and read the current.

Compare with the value calculated from the resistor voltage. They should agree within a few percent. The directly measured value may be slightly lower, because the meter adds a little resistance of its own (its "burden").

**Disconnect power and move the red lead back to the V socket now**, before you do anything else.` },
      { title: 'Change the resistor and the LED', md: `Repeat the voltage measurements with R1 = 220 Ω and with R1 = 1 kΩ. Compare the brightness. Notice how little the LED voltage changes while the current changes by a factor of four: that is the steep diode curve from the lesson.

Now swap the red LED for the green or blue one with R1 = 330 Ω. Measure the voltage across the LED and the resistor again. If the LED is a blue or modern green type with a forward voltage near 3 V, the resistor will have only a few tenths of a volt across it and the LED will be dim or dark. Explain the result in the table using the numbers.`,
        blocks: [ { t: 'widget', name: 'led-resistor', props: { vsupply: 3.3, vf: 3.0 }, caption: 'Explore what happens to the current when the forward voltage is close to the supply.' } ] },
      { title: 'Predict and simulate circuit 2', md: `For circuit 2, predict the voltage at node IN with the button released and pressed, and the current through R2 in each state. Then build it in the simulator.

The simulated task uses the pin's **internal** pull-up (about 45 kΩ in this model) in the place of R2, so you select the pin mode "Input, pull-up" instead of fitting a resistor. The circuit is otherwise the same. Before you build, predict the pressed current for 45 kΩ as well as for your 10 kΩ, and note which of the two the simulator reports.`,
        blocks: [ { t: 'widget', name: 'breadboard', props: { challenge: 'button-pullup' }, caption: 'Circuit 2 in simulation.' } ] },
      { title: 'Build and measure circuit 2 for real', md: `With power off, find which legs of your tactile button are the switch contacts: on the continuity range, find a pair of legs that beep only while the button is pressed. Use that pair.

Build circuit 2. Put the black probe on ground and the red probe on node IN.

- Released: you should see the supply voltage, about 3.3 V.
- Pressed: you should see about 0 V.

Then remove R2 entirely, leaving node IN connected only to the button and the meter probe. Read the voltage with the button released. Touch the node with a finger. Record what you see. (The meter itself has an input resistance of about 10 MΩ, which acts as a very weak pull-down, so a floating node measured with a meter often reads near 0 V and drifts. A microcontroller input is far higher impedance and floats more freely.)` },
      { title: 'Complete the table and write three sentences', md: `Fill in the last column of the table for every row where predicted and measured differ. Acceptable explanations are specific: "resistor measured 326 Ω", "supply measured 3.27 V at the board", "LED forward voltage measured 1.87 V, not 2.0 V". "Measurement error" is not an explanation.

Finish with three sentences in the notebook: what set the LED current; what set the voltage at IN in each button state; and which measurement surprised you most.` },
    ],
    walkthrough: [
      `**Circuit 1.** The supply, R1 and the LED form one loop, so one current flows through all of them. The LED fixes its own voltage at about its forward voltage. Kirchhoff's voltage law then leaves the rest of the supply across R1, and Ohm's law applied to R1 gives the current. The resistor is the only part of the loop where voltage and current are proportional, which is why it is the part that sets the current.

      **Why the measured values differ from the ideal ones.** A real 3.3 V rail is a few tens of millivolts off nominal and sags slightly under load. A 5 % resistor may be 15 Ω away from 330 Ω. The LED's forward voltage depends on the individual part, its current and its temperature. Each of these moves the current by a few percent. None is a fault.

      **Circuit 2.** With the button released, no current flows in R2 because nothing is connected to node IN except a high-impedance input (the meter). No current means no voltage across R2, so IN is at the rail. Pressing the button connects IN to ground through a path of nearly zero resistance; the whole supply is now across R2, and 0.33 mA flows through it. Removing R2 leaves IN with no path to either rail when the button is open: it floats.`,
    ],
    testing: [
      `You have finished when all of these hold:

      - Circuit 1: the voltages across R1 and the LED add up to the measured supply within about 10 mV.
      - The current calculated from the resistor voltage and the current measured directly agree within about 5 %.
      - Your measured current is within about 15 % of your prediction, or you have written down which measured quantity explains the gap.
      - Circuit 2: you should see within 0.05 V of the supply when released and within 0.05 V of ground when pressed.
      - With R2 removed, you observed and recorded an undefined or drifting level.
      - The results table has no empty cells.`,
    ],
    troubleshooting: [
      { symptom: 'LED does not light; 0 V across the resistor and full supply across the LED', cause: 'No current is flowing and the LED is the blocking element: it is reversed or not making contact.', fix: 'Reverse the LED so the long lead is towards the resistor. If still dark, check it on the diode-test range.' },
      { symptom: 'LED does not light; 0 V across both the resistor and the LED', cause: 'No supply at the circuit: split power rail, jumper in the wrong rail, or the ground return missing.', fix: 'Measure rail-to-rail voltage right at the circuit. Bridge the rail split or correct the jumper.' },
      { symptom: 'LED very bright; resistor shows 0 V across it', cause: 'Both resistor leads are in the same breadboard strip, shorting it out.', fix: 'Disconnect power at once. Move one resistor lead to a different column.' },
      { symptom: 'LED very dim', cause: 'Resistor is a much higher value than intended (33 kΩ for 330 Ω), or the LED forward voltage is close to the supply.', fix: 'Measure the resistor out of circuit. Measure the voltage across the LED; if it is near 3 V, use a red LED or a higher supply.' },
      { symptom: 'Node IN reads 0 V whether or not the button is pressed', cause: 'The button is rotated so that its internally joined legs bridge the two strips, or R2 goes to ground instead of to 3V3.', fix: 'Find the switching pair of legs with the continuity range. Check which rail R2 is in.' },
      { symptom: 'Node IN reads 3.3 V whether or not the button is pressed', cause: 'The button is not in the circuit: both of its used legs are on the same side internally, or its ground jumper is missing.', fix: 'Check continuity across the button while pressing, measured from node IN to the ground rail.' },
      { symptom: 'Meter shows nothing on the mA range and the LED goes out when the meter is inserted', cause: 'The meter fuse is blown, usually from an earlier voltage measurement with the lead in the current socket.', fix: 'Test the fuse (continuity across the meter\'s own mA and COM sockets using a second meter, or follow the manual) and replace with the same rating.' },
      { symptom: 'Readings change when the breadboard is pressed or wires are moved', cause: 'Intermittent contact: a thin lead, a worn clip or a damaged jumper.', fix: 'Move the part to different holes, replace the jumper, and re-measure.' },
    ],
    challenge: [
      `Without a worked solution:

      1. Run two LEDs of different colours from the same 3.3 V supply at about the same brightness to your eye. Decide between series and parallel, justify the resistor values with measurements, and record the total current.
      2. Convert circuit 2 to a pull-down arrangement, so that IN reads 0 V when released and 3.3 V when pressed. Draw the schematic first.
      3. Add a 1 µF capacitor from node IN to ground in the original pull-up circuit. Predict the time for IN to recover to 63 % of the supply after you release the button, and explain why a multimeter cannot show it. Say what instrument would.`,
      { t: 'widget', name: 'breadboard', props: { challenge: 'free' }, caption: 'Free-build area for trying the challenge circuits before you wire them.' },
    ],
    quiz: [
      { q: 'In circuit 1 you measure 1.38 V across a resistor whose measured value is 326 Ω. What current is flowing?', kind: 'circuit', choices: [
        { t: '4.2 mA', ok: true, why: 'I = V / R = 1.38 / 326. Using measured values for both gives the actual current.' },
        { t: '10.1 mA', why: 'This uses the full 3.3 V supply. Only the voltage across the resistor itself determines its current.' },
        { t: '0.45 mA', why: 'This multiplies instead of dividing. Ohm\'s law for current is voltage over resistance.' },
      ] },
      { q: 'To measure the LED current directly, the meter must be connected:', kind: 'circuit', choices: [
        { t: 'In series, replacing a section of the loop, on the mA range', ok: true, why: 'A current meter must have the circuit current flow through it, so it is inserted into a break in the path.' },
        { t: 'Across the LED, on the mA range', why: 'On a current range the meter is almost a short. Across the LED it would bypass the LED and carry the current itself.' },
        { t: 'Across the resistor, on the volts range', why: 'That measures voltage, from which current can be calculated, but it is not a direct current measurement.' },
      ] },
      { q: 'With the 330 Ω resistor, the red LED is bright and the blue LED is barely lit, on the same 3.3 V supply. Why?', kind: 'circuit', choices: [
        { t: 'The blue LED\'s forward voltage is close to 3.3 V, leaving almost nothing across the resistor to drive current', ok: true, why: 'Current is the leftover voltage divided by the resistance. A forward voltage near the supply leaves very little.' },
        { t: 'Blue LEDs need a larger resistor', why: 'A larger resistor reduces current further. The limitation here is the supply voltage relative to the forward voltage.' },
        { t: 'The blue LED is in backwards', why: 'A reversed LED would be completely dark with the full supply across it. A dim glow means it is conducting a little.' },
      ] },
      { q: 'In circuit 2 with the button released, why is there no voltage across the 10 kΩ pull-up?', kind: 'concept', choices: [
        { t: 'Nothing draws current through it, and a resistor with no current has no voltage across it', ok: true, why: 'V = I × R. The input is high-impedance and the switch is open, so the current is essentially zero.' },
        { t: 'The resistor blocks the voltage until the button is pressed', why: 'A resistor never blocks voltage. It drops voltage in proportion to the current, which here is zero.' },
        { t: '10 kΩ is too large for 3.3 V to pass', why: 'Any resistor passes the full voltage to an unloaded node. Its size only matters once current flows.' },
      ] },
      { q: 'Your predicted current was 3.94 mA and you measured 4.25 mA. Which is the best next step?', kind: 'concept', choices: [
        { t: 'Compare the measured supply, resistor value and LED forward voltage with the assumed ones to find which accounts for the gap', ok: true, why: 'An 8 % difference is within what component tolerances explain. Identifying the specific cause is the skill being practised.' },
        { t: 'Conclude that Ohm\'s law is only approximate', why: 'The law held. The inputs to the calculation were nominal values, not the actual ones.' },
        { t: 'Repeat the measurement until it matches the prediction', why: 'A stable, repeatable reading is information about the real circuit. The prediction is what needs revising.' },
      ] },
    ],
  },

  /* ------------------------------------------------------------------ B */
  {
    id: 'elec-lab-find-fault', title: 'Lab B: Find the fault', kind: 'Troubleshooting lab', minutes: 150,
    summary: 'Six faulty circuits in simulation, then the same faults built by a partner (or by you, blind) on a real breadboard. Measure, hypothesise, test.',
    skills: ['elec-fault-find', 'elec-multimeter', 'elec-schematic', 'elec-level-compat', 'elec-power-budget', 'elec-pullup'],
    objectives: [
      'Apply the measure → hypothesise → test method to an unfamiliar faulty circuit',
      'Recognise the voltage signature of six common faults',
      'Keep a fault log that records the evidence for each conclusion',
      'Locate a fault with the fewest measurements by half-splitting',
      'Verify a repair by measurement instead of by "it seems to work"',
    ],
    hardware: [
      'Everything from Lab A',
      'A second colour of LED and a few extra resistors (100 Ω, 1 kΩ, 10 kΩ)',
      'Optional: a development board to act as the 3.3 V / 5 V source and, later, to read the button and sensor',
      'Optional: a small DC motor or a 100 Ω resistor as a "heavy load", and a 100 µF electrolytic capacitor',
      'A partner to build the faults, or six sealed envelopes with fault cards if you work alone',
    ],
    software: [
      'This course: the circuit-debug widget',
      'The course notebook for the fault log',
    ],
    background: [
      `The board under test in every part of this lab is the same small circuit, shown below: a power input, an indicator LED with its resistor, a button with a pull-up, and a resistive "sensor" (a divider) feeding an analog input. It is deliberately simple. The skill is in the method, and the method does not change when the circuit gets bigger.

      **The method**

      1. Write the symptom down precisely.
      2. Measure the supply at the circuit. Then measure along the signal path.
      3. Write one hypothesis that explains *every* measurement so far.
      4. Write what a specific test would show if the hypothesis is true.
      5. Do that one test. If the prediction fails, discard the hypothesis and return to step 2.
      6. Repair, then re-measure to confirm the circuit now matches its design values.

      **Rules for this lab**

      - No part may be moved, swapped or re-seated before at least three measurements are written in the log.
      - One change at a time.
      - "I just tried things until it worked" scores zero, even if it works.`,
      { t: 'callout', kind: 'sim', md: `The circuit-debug scenarios are simulations with a virtual multimeter. The hardware half of the lab is yours to run; expected readings are calculated, not recorded from a real board.` },
      { t: 'callout', kind: 'warn', md: `Two of the faults (missing current limit, heavy load) involve currents higher than the others. On real hardware, use the substitutions given in the steps, which keep every current within safe limits for the parts and for a USB port. Do not reproduce a dead short across a supply.` },
    ],
    diagram: [
      { t: 'ascii', text: `
Board under test (design values, 3.3 V supply)

  3V3 ──┬──[ R1 330 Ω ]──▶|── GND               indicator LED (red, Vf ≈ 2.0 V)
        │                LED1
        │
        ├──[ R2 10 kΩ ]──┬── BTN  (to GPIO)     button, active low
        │                │
        │              [ SW1 ]
        │                │
        │               GND
        │
        └──[ R3 10 kΩ ]──┬── SENSE (to ADC)     "sensor": divider
                         │
                       [ R4 10 kΩ ]
                         │
                        GND

Design values to compare against
  V(3V3–GND) at the board ............ 3.30 V
  V across R1 ........................ 1.30 V   (I ≈ 3.9 mA)
  V across LED1 ...................... 2.00 V
  V(BTN) released / pressed .......... 3.30 V / 0.00 V
  V(SENSE) ........................... 1.65 V`, caption: 'The board under test, with the values a healthy board should show.' },
    ],
    steps: [
      { title: 'Record the healthy board', md: `Build the board under test correctly on a real breadboard, as in Lab A, and measure every design value listed in the diagram. Write your own "known good" column next to the design values. Without a known-good reference, you cannot tell a fault from a tolerance.

Set up a fault log with these columns: **symptom · measurements (where, value) · hypothesis · predicted result of test · actual result · fault found · how the repair was verified**.` },
      { title: 'Simulated fault 1: the LED that will not light', md: `Work through the scenario. Log at least three measurements before you state a hypothesis. Which single pair of readings distinguishes "LED reversed" from "no power reaching the LED"?`,
        blocks: [ { t: 'widget', name: 'circuit-debug', props: { scenario: 'led-reversed' } } ] },
      { title: 'Simulated fault 2: the LED that is too bright', md: `Something is missing or bypassed. Before probing, write down what voltage you expect across the resistor in a healthy circuit and what you would see if the resistor were not limiting the current.`,
        blocks: [ { t: 'widget', name: 'circuit-debug', props: { scenario: 'no-current-limit' } } ] },
      { title: 'Simulated fault 3: the button with a mind of its own', md: `The input changes without the button being pressed. Measure the node in both button states. With the button released, measure it twice: against GND, and then with the probes between 3V3 and the node. Can both readings be true of a node that something is holding? Remember that the meter itself is a 10 MΩ resistor between its probes.`,
        blocks: [ { t: 'widget', name: 'circuit-debug', props: { scenario: 'floating-input' } } ] },
      { title: 'Simulated fault 4: everything is connected, nothing happens', md: `The LED's cathode is plugged into the breadboard's − rail, and still no current flows. Do not assume a rail is ground because of its colour. Measure the "ground" end of the circuit against the board's GND pin, first in volts and then on the continuity range, and write down what a real ground would have read. The two-board version of this fault is card D in the hardware half.`,
        blocks: [ { t: 'widget', name: 'circuit-debug', props: { scenario: 'missing-ground' } } ] },
      { title: 'Simulated fault 5: the wrong rail', md: `A part is being supplied or driven at a voltage it was not designed for. Start by measuring every supply pin against ground and comparing with the design values.`,
        blocks: [ { t: 'widget', name: 'circuit-debug', props: { scenario: 'wrong-rail' } } ] },
      { title: 'Simulated fault 6: resets under load', md: `The circuit works until a load switches on. Measure the rail at the source and at the chip, with the load off and on. Where does the voltage go missing?`,
        blocks: [ { t: 'widget', name: 'circuit-debug', props: { scenario: 'brownout' } } ] },
      { title: 'Recreate the faults on the real breadboard', md: `Now the same six faults on hardware. A partner introduces **one** fault from the list while you look away, or you draw a card, apply the fault and come back after a break. Diagnose each using only the meter and the log. Power off while faults are being inserted.

| Card | How to introduce it on the real board | Safe substitution |
|---|---|---|
| A. Reversed LED | Turn LED1 round | none needed |
| B. No current limit | Do **not** remove R1 altogether. Replace R1 (330 Ω) with 100 Ω | Current stays near 13 mA: clearly "too bright" and measurably wrong, without overdriving the LED |
| C. Floating input | Remove R2, or move its top lead to an unused column | none needed |
| D. Missing ground | Power the "sensor" divider (R3, R4) from a second source such as two AA cells, and leave the two grounds unconnected. Measure SENSE relative to the main board's ground | Battery-powered second source only |
| E. Wrong rail | Move the top of R3 from 3V3 to the board's 5 V pin, so SENSE sits above its design value | Keeps SENSE at 2.5 V: wrong, but harmless to a meter. Do not connect SENSE to a microcontroller pin during this card unless you have confirmed 2.5 V is within its limits |
| F. Sagging supply | Feed the whole board through a 100 Ω resistor in series with the 3V3 lead to imitate a resistive cable, then switch a second LED-and-220 Ω branch on and off as the "load" | Currents stay below 15 mA |

For each card: log three or more measurements, state the hypothesis and the predicted test result, test, repair, and verify against your known-good column.` },
      { title: 'Two faults at once', md: `Ask your partner to insert two different faults in different parts of the board. Diagnose and repair them one at a time, re-measuring after the first repair before starting on the second. Note in the log how the first fault's symptoms could have hidden the second.` },
      { title: 'Review the log', md: `For each fault, count the measurements you made before the correct hypothesis. Mark any measurement that, looking back, could not have changed your conclusion. Write down which single first measurement would have been most informative for each fault. This is how the method gets faster.` },
    ],
    walkthrough: [
      `What each fault looks like on the meter, and why. Read this only after attempting the scenarios.

      **Reversed LED.** No current flows, so R1 drops 0 V and the whole 3.3 V appears across the LED. A healthy LED can never show more than about its forward voltage, so "3.3 V across a red LED" is conclusive.

      **Missing or reduced current limit.** The voltage across the LED is slightly higher than normal (the forward voltage rises a little with current) and the voltage across the limiting element is small or zero for its supposed value. Calculating current from the resistor voltage and the *measured* resistance shows a current well above the design value. If a GPIO or weak source is driving it, the source voltage is pulled below nominal, which is a clue in itself.

      **Floating input.** With the button pressed the node reads a solid 0 V. Released, nothing holds it, so the reading is whatever the meter makes it: a 10 MΩ meter pulls a floating node towards whichever point its other probe is on, so you can read about 0 V from the node to ground *and* about 0 V from the rail to the node. Two readings that cannot both be true of a driven node are the signature. On real hardware you may instead see a drifting value that changes when touched. Either way, the asymmetry tells you that the path to ground exists and the path to the rail does not.

      **Missing ground.** In the simulated scenario the "ground" rail was never joined to the board's GND: it has no continuity to GND and reads well above 0 V, because the meter completes a tiny loop through the LED. A ground that is not at 0 V is not connected to ground. In the two-source version (card D), each module's own supply measures correctly with respect to its own ground. The signal measured against the *other* module's ground is unstable or meaningless, and the voltage between the two grounds is not zero and not steady. Adding one ground wire fixes everything at once.

      **Wrong rail.** One node sits at a clean, stable, wrong voltage. Unlike a floating node it does not drift, and unlike a loading problem it does not change with the load. Tracing back from that node to its supply finds the misplaced connection. For card E, SENSE reads 2.5 V instead of 1.65 V: exactly half of 5 V, which identifies the rail.

      **Sagging supply / brown-out.** The rail is correct at the source and low at the board, and the difference grows when the load switches on. Voltage is being lost in a series resistance between the two measurement points: here the 100 Ω stand-in for a cable. Ohm's law gives the size of the drop: load current times series resistance. Bulk capacitance at the board shortens and softens the dip for brief loads but cannot remove a steady drop.`,
    ],
    testing: [
      `The lab is complete when:

      - All six simulated scenarios are solved, each with a log entry that has at least three measurements made before the hypothesis.
      - All six hardware cards have been diagnosed. For each, the log names the fault, the evidence, and the verifying measurement after repair.
      - After every repair, the board's measurements match your known-good column: you should see about 1.3 V across R1, about 2.0 V across LED1, 3.3 V and 0 V at BTN, and 1.65 V at SENSE.
      - The two-fault exercise was solved with one change at a time.
      - For card F, you measured the rail at the source and at the board with the load off and on, and your calculated drop (load current × 100 Ω) agrees with the measured drop within about 10 %.`,
    ],
    troubleshooting: [
      { symptom: 'Every node reads 0 V', cause: 'The supply is not reaching the board, or the meter\'s black probe is not on the circuit\'s ground.', fix: 'Measure directly across the supply terminals first. Then put the black probe on the board\'s ground rail and repeat.' },
      { symptom: 'Readings are unstable on every node', cause: 'The black probe is on a ground that is not connected to the circuit being measured, or a probe is not making contact.', fix: 'Clip the black probe to the board\'s own ground rail. Check the probes by measuring a battery.' },
      { symptom: 'The fault card was applied but the board still measures as healthy', cause: 'The fault did not take effect: for example the LED was reversed twice, or a removed pull-up is duplicated by a development board\'s on-board resistor.', fix: 'Have the partner confirm the change. Disconnect the development board\'s signal pin while measuring the passive circuit.' },
      { symptom: 'After a repair the values still differ from the known-good column', cause: 'A second fault is present, or the repair introduced a new one (a lead in the wrong column).', fix: 'Treat it as a new fault. Start again from the supply measurement; do not assume the first diagnosis was wrong.' },
      { symptom: 'Card D shows a steady, sensible voltage even without the ground wire', cause: 'The two sources share a ground by another route, for example both powered from the same computer.', fix: 'Use a battery for the second source so that it is truly separate.' },
      { symptom: 'In card F the drop is much larger than calculated', cause: 'Additional series resistance: worn breadboard contacts or a thin jumper, or the load current is higher than assumed.', fix: 'Measure the voltage across the 100 Ω resistor itself to get the true current, then look for where the rest of the drop occurs.' },
      { symptom: 'You find the fault immediately by looking', cause: 'The board is small enough to inspect visually.', fix: 'Good, but still log the measurements that would have found it. Larger boards and soldered joints cannot be debugged by eye.' },
    ],
    challenge: [
      `No solutions are given for these.

      1. **Write a fault for someone else.** Design a seventh fault for the board under test that is not on the list (for example a wrong resistor value in the divider, or a button rotated so that it is permanently closed). Write its expected meter signature first, then have a partner diagnose it. Was your predicted signature right?
      2. **Shortest path.** For each of the six faults, find the smallest set of measurements that identifies it uniquely among all six. Draw the result as a decision tree starting from "measure the supply at the board".
      3. **With a microcontroller.** If you have a development board, connect BTN to a GPIO and SENSE to an ADC pin, and print both. Repeat cards C and F and describe how each fault appears in the *firmware's* view. This is the form in which you will usually first meet them.`,
    ],
    quiz: [
      { q: 'A dark LED has 0 V across it and 0 V across its series resistor. The supply measures 3.3 V at the power input. What is the best next measurement?', kind: 'circuit', choices: [
        { t: 'The supply voltage at the LED circuit itself, between its top node and its ground node', ok: true, why: 'Zero volts across both parts means no voltage is arriving across the pair. The break is between the input and this circuit, on the supply side or the ground side.' },
        { t: 'The LED on the diode-test range', why: 'The LED has not yet been shown to be at fault. With no voltage across the branch, the problem is upstream of it.' },
        { t: 'The resistance of the series resistor', why: 'Even a wrong resistor value would leave some voltage across the LED and resistor together. None is reaching them.' },
      ] },
      { q: 'Which observation separates a floating input from an input connected to the wrong rail?', kind: 'concept', choices: [
        { t: 'A floating node drifts and responds to touch; a wrong-rail node sits at a steady, repeatable wrong voltage', ok: true, why: 'A node tied to a rail has a low-impedance path that holds it firmly. A floating node has none.' },
        { t: 'A floating node always reads exactly half the supply', why: 'A floating node has no defined value at all. It can read anything, and a meter\'s own input resistance often pulls it towards zero.' },
        { t: 'They cannot be distinguished with a multimeter', why: 'Stability, sensitivity to touch and the exact value read are all visible on a meter and differ between the two.' },
      ] },
      { q: 'In card F, the rail reads 3.30 V at the source and 2.10 V at the board with the load on. The series resistance between them is 100 Ω. What current is the board drawing?', kind: 'circuit', choices: [
        { t: '12 mA', ok: true, why: 'The 1.2 V lost across 100 Ω gives I = 1.2 / 100.' },
        { t: '33 mA', why: 'This uses the source voltage. Only the voltage across the series resistance determines the current through it.' },
        { t: '21 mA', why: 'This uses the voltage at the board. The current through the series element comes from the difference between its two ends.' },
      ] },
      { q: 'You form a hypothesis, make the change it suggests, and the symptom is unchanged. What should you do?', kind: 'concept', choices: [
        { t: 'Undo the change, discard the hypothesis, and return to measuring', ok: true, why: 'A failed prediction means the hypothesis is wrong. Leaving the change in place adds an unknown to the next round.' },
        { t: 'Keep the change and try a second one on top', why: 'Stacked changes make it impossible to know which one mattered, and each may add a new fault.' },
        { t: 'Make the same change again, more carefully, in case it did not take', why: 'Whether a change took effect is settled by one measurement, not by repetition. If it did take effect and nothing improved, the hypothesis behind it has failed.' },
      ] },
      { q: 'After repairing a reversed LED, how do you verify the repair?', kind: 'circuit', choices: [
        { t: 'Measure the voltages across the LED and resistor and compare them with the known-good values', ok: true, why: 'Matching design values shows the whole branch is behaving as designed, including the current.' },
        { t: 'See that the LED lights', why: 'A lit LED shows current flows, but not that it is the right current. A second fault such as a wrong resistor would be missed.' },
        { t: 'Leave it running for an hour', why: 'Survival is not verification. The correct current can be confirmed in seconds by measurement.' },
      ] },
    ],
  },
];
