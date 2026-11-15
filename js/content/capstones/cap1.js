// Capstone 1: smart embedded device.
const lab = {
  id: 'cap-1',
  title: 'Capstone 1: a smart embedded device',
  kind: 'Capstone', minutes: 600,
  summary: 'Specify, budget, build and test one ESP32 device that combines sensors, GPIO, a bus and a display.',
  skills: ['cap-method', 'cap-blockdiagram', 'cap-integrate'],
  requires: ['esp32', 'protocols'],
  objectives: [
    'Turn a one-paragraph brief into a numbered, testable requirements list.',
    'Produce a block diagram, a pin budget and a task/timing budget before writing application code.',
    'Integrate at least one I2C or SPI sensor, one analogue input, buttons, an output actuator and a display on one ESP32.',
    'Structure the firmware as tasks that communicate through queues rather than shared globals.',
    'Run a written test plan and record a pass or fail against every requirement.',
  ],
  hardware: [
    'An ESP32 development board you own (original ESP32, ESP32-S3 or ESP32-C3; the pin rules below differ between them)',
    'One digital sensor on I2C or SPI (for example a temperature/humidity or light sensor) and its datasheet',
    'One analogue source for the ADC (potentiometer, or a thermistor/LDR in a divider)',
    'Two push buttons, two LEDs with series resistors, one actuator (buzzer or small load behind a transistor)',
    'A small display: I2C OLED, SPI TFT or a character LCD — your choice, and you must justify it',
    'Breadboard, jumper wires, multimeter; a logic analyser is strongly recommended',
  ],
  software: [
    'ESP-IDF (install the current stable release; note the exact version in your report)',
    'A serial terminal (`idf.py monitor`)',
    'sigrok/PulseView if you have a logic analyser',
    'Without a board: the Workbench widgets for the design work; the build and test milestones then stay open until you have hardware',
  ],
  background: [
    `Every part of this device is something you have built alone in the ESP32 projects. What is new is that they must share one chip: one set of pins, one 3.3 V rail, one scheduler, one heap. Integration problems are rarely about any single driver. They are about the resources between drivers.

The brief: **build a device that senses its surroundings, shows what it senses, reacts to it, and lets a person configure it with buttons.** A thermostat, a plant monitor, a light-level alarm and a bench power monitor all fit. Choose one and make it specific.`,
    { t: 'callout', kind: 'why', md: 'The brief is vague on purpose. Deciding what the device is, and what "works" means for it, is the first graded deliverable.' },
    `### Pin rules you must design around

On the **original ESP32**: GPIO34–39 are input-only and have no software pull-ups or pull-downs; GPIO0, 2, 5, 12 and 15 are strapping pins sampled at reset; GPIO6–11 are normally wired to the module's SPI flash; and ADC2 pins cannot be used while Wi-Fi is in use, so put analogue inputs on ADC1. The S3 and C3 have different pin maps and strapping pins: look up the GPIO page of the ESP-IDF documentation for *your* chip and the pinout of *your* board before assigning anything.`,
    { t: 'widget', name: 'platform-compare', caption: 'Use this to justify your platform choice in the report: which of its properties does your device actually need?' },
  ],
  diagram: [
    { t: 'ascii', text: String.raw`
                +-----------------------------------+
  buttons ----->| GPIO in (pull-up, interrupt)      |
  pot/divider ->| ADC1 channel                      |-----> LEDs (GPIO out)
                |            ESP32                  |-----> actuator (GPIO/LEDC via transistor)
  sensor <----->| I2C or SPI controller             |<----> display (same bus or a second one)
                |                                   |-----> UART0: log / test console
                +-----------------------------------+
                   3V3 and GND common to everything`, caption: 'Reference block diagram. Redraw it for your device with real part names and bus addresses.' },
    { t: 'ascii', text: String.raw`
Pin budget template (fill in before wiring)

Signal        Pin   Direction  Peripheral    Checked against
------------  ----  ---------  ------------  ---------------------------------
I2C SDA       ?     bidir      I2C0          not strapping, has pull-up to 3V3
I2C SCL       ?     out        I2C0          not strapping, has pull-up to 3V3
ADC input     ?     in         ADC1_CHx      ADC1 (not ADC2 if Wi-Fi is used)
Button A      ?     in         GPIO + IRQ    pull-up available on this pin?
Button B      ?     in         GPIO + IRQ    pull-up available on this pin?
LED 1         ?     out        GPIO          not input-only
Actuator      ?     out        LEDC channel  level at reset is safe for the load
Console TX/RX board default    UART0         left free`, caption: 'A pin is only assigned when the last column has been checked in the documentation for your chip.' },
    { t: 'ascii', text: String.raw`
 sensor_task --(reading)--> [queue] --> control_task --(state)--> [queue] --> display_task
 button ISR --(event)----> [queue] ------^                    actuator <-----'
`, caption: 'One reasonable task structure. Data flows through queues; no task reads another task\'s variables.' },
  ],
  steps: [
    { title: 'Milestone 0: requirements', md: `Write 6–10 numbered functional requirements with a number or a yes/no observation in each, and next to each the test that decides it. Include at least one timing requirement (how stale may the display be, how fast must a button respond) and one fault requirement (what the device does when the sensor is unplugged). Have someone else read the list: if they cannot tell how to test an item, rewrite it.` },
    { title: 'Milestone 1: block diagram and budgets', md: `Redraw the block diagram for your parts. Fill in the pin budget. Add a power budget: sum the worst-case current of every part on the 3.3 V rail from their datasheets and compare it with what your board's regulator can supply (check the regulator's datasheet). Add a task table: name, period or trigger, priority, what it blocks on, deadline.` },
    { title: 'Milestone 2: prove the riskiest link first', md: `Decide which single connection you are least sure of — usually sensor and display sharing a bus — and prove it with the smallest possible program. If both are on I2C, confirm their addresses differ and that a bus scan finds both.`,
      blocks: [{ t: 'widget', name: 'i2c-visualizer', props: { device: 'scan' }, caption: 'Simulation: what a bus scan looks like on the wire, including the missing pull-up fault you are most likely to meet.' }] },
    { title: 'Milestone 3: inputs with defined behaviour', md: `Bring up the buttons with debouncing and the ADC with a conversion to engineering units. Decide and write down: what counts as a press, what a long press does, how many ADC samples you average and why. The ISR should do nothing except post an event.

In the handler below, \`arg\` is whatever pointer you passed when you attached the handler to the pin (\`gpio_install_isr_service(0)\` once, then \`gpio_isr_handler_add(pin, button_isr, (void *)pin)\` per button), so one handler serves both buttons. \`xQueueSendFromISR\` copies the pin number into the queue without ever blocking; if the queue is full the event is dropped, so check its return value in a counter if a lost press matters to your requirements. \`woken\` is set when the post made a higher-priority task ready, and \`portYIELD_FROM_ISR()\` then makes the scheduler switch to that task as the interrupt returns, not at the next tick.`,
      code: String.raw`static QueueHandle_t s_events;   /* created in app_main with xQueueCreate(8, sizeof(uint32_t)) */

static void IRAM_ATTR button_isr(void *arg)
{
    uint32_t pin = (uint32_t)(uintptr_t)arg;
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(s_events, &pin, &woken);   /* never block, never print in an ISR */
    if (woken) portYIELD_FROM_ISR();
}`, lang: 'c', status: 'idf-checked' },
    { title: 'Milestone 4: display and control logic', md: `Bring up the display, then write the control logic as an explicit state machine (for example IDLE, ALARM, CONFIG). Draw the states and transitions before coding them; every button event and sensor threshold should be an arrow on that drawing.`,
      blocks: [{ t: 'widget', name: 'state-machine', props: { machine: 'door-lock' }, caption: 'A different device, same technique: states, events and the C switch statement they become.' }] },
    { title: 'Milestone 5: integrate as tasks', md: `Move each concern into its own task and connect them with queues. Decide priorities from deadlines, not from importance. Add a way to observe the system from outside: a UART console command or a periodic log line that reports state, last reading, queue depths and each task's stack high-water mark.` },
    { title: 'Milestone 6: fault behaviour', md: `Implement what your fault requirement says: a sensor read that fails must produce a visible, defined state (for example "SENSOR?" on the display and the actuator off), not a stale number or a reset. Check every driver return value on the path.` },
    { title: 'Milestone 7: run the test plan and write up', md: `Execute every test, record the result, and fix or explicitly document each failure. The report contains the requirements, diagrams, budgets, the decisions below with your reasoning, and the test table.` },
  ],
  walkthrough: [
    `You owe a written answer to each of these. There is no single correct choice; there is a justified one.

- **Which bus for the display?** Sharing the sensor's I2C bus saves pins but couples the two: a long display update delays a sensor read. A separate SPI display is faster and costs four or more pins.
- **Polling or interrupts for the buttons?** Interrupts respond sooner but bring debouncing and ISR rules; a 10 ms polling task is simpler and is often fast enough. Which requirement decides it?
- **How do tasks share data?** Queues copy data and make ownership obvious. A mutex-protected struct is cheaper for large data but adds a lock every reader must respect.
- **What happens at reset?** Between reset and your GPIO configuration running, pins are in their default state. Is the actuator off during that window? What decides it — a pull-down resistor, or luck?`,
    { t: 'callout', kind: 'decision', md: 'If two choices both satisfy the requirements, pick the one that is easier to test and say so. "Simpler to verify" is a legitimate engineering reason.' },
    { t: 'callout', kind: 'mistake', md: 'Assigning the actuator or an LED to a strapping pin. The external circuit can then pull the pin to the wrong level at reset, and the board boots into the wrong mode or not at all, only when your hardware is attached.' },
  ],
  testing: [
    `Build a table with one row per requirement: ID, test procedure, expected observation, result, evidence (log excerpt, photo, capture). The rows below must appear in some form.

| Test | Procedure | You should see |
|---|---|---|
| Sensor accuracy | Compare against a reference (second sensor, thermometer, known voltage) | Agreement within the tolerance you derived from the datasheet |
| Display staleness | Change the input abruptly, time the screen | Update within your stated limit |
| Button response | Press, long-press, press rapidly 20 times, reading an event counter from the console | Exactly one event per press: the counter equals the number of presses |
| Threshold and hysteresis | Move the input slowly up through the threshold, hold it just above, then bring it slowly down | One actuator change on the way up, none while held, one on the way down at the lower value you stated |
| Sensor fault | Unplug the sensor while running | The defined fault state within your stated time; recovery when reconnected |
| Soak | Run for at least one hour, logging uptime, free heap and stack high-water marks every minute | Uptime never restarts; minimum free heap and every high-water mark are the same at 60 minutes as at 10 minutes |
| Reset safety | Hold reset, release, watch the actuator | The actuator never activates during boot |

If you have no board yet, complete milestones 0, 1 and the design half of 4, and mark the remaining tests "not run" — do not describe expected results as observed ones.`,
  ],
  troubleshooting: [
    { symptom: 'Board will not boot or enter flashing mode once your circuit is attached', cause: 'Your circuit is driving a strapping pin at reset.', fix: 'Disconnect signals one at a time to find it, then move that signal to a non-strapping pin and update the pin budget.' },
    { symptom: 'Sensor works alone, fails when the display is added to the same I2C bus', cause: 'Address clash, two sets of pull-ups making the pull-up too strong or none at all, or two drivers each creating the bus.', fix: 'Scan the bus, measure the idle level of SDA/SCL, and create the bus once and add both devices to it.' },
    { symptom: 'ADC readings jump when Wi-Fi is enabled', cause: 'The input is on an ADC2 pin (original ESP32) or is picking up supply noise.', fix: 'Move it to ADC1, average several samples, and decouple the analogue source close to the pin.' },
    { symptom: 'Occasional reset with a stack overflow or watchdog message in the log', cause: 'A task stack sized by guesswork, or a task that never blocks.', fix: 'Read the stack high-water marks and resize; make sure every task loop blocks on a queue or a delay.' },
    { symptom: 'Display shows the right value but lags by seconds', cause: 'A full-screen redraw on every update, or the display task waiting behind a slow sensor read on a shared bus.', fix: 'Redraw only what changed, and measure how long each bus transaction takes before choosing task periods.' },
  ],
  challenge: `Add a low-power requirement and meet it: state an average-current target, choose a sleep strategy, and measure the result with a meter. Then explain which of your original requirements had to change to make it possible (wake latency, display behaviour, sampling rate) and why that trade is acceptable for your device.`,
  quiz: [
    { q: 'On an original ESP32 you need a button input with the internal pull-up. Which assignment is a design error?', kind: 'circuit', choices: [
      { t: 'GPIO35 with the internal pull-up enabled', ok: true, why: 'Correct: GPIO34–39 are input-only and have no software pull-ups, so the pin would float unless you add an external resistor.' },
      { t: 'GPIO27 with the internal pull-up enabled', why: 'This is an ordinary GPIO with pull-up support and is not a strapping pin, so nothing is wrong with it.' },
      { t: 'GPIO35 with an external 10 kΩ resistor to 3.3 V', why: 'An external pull-up is exactly how an input-only pin is given a defined level, so this works.' },
    ] },
    { q: 'Why should a button ISR only post an event to a queue?', kind: 'arch', choices: [
      { t: `Time spent in an ISR delays every other interrupt and task, and an ISR must not block`, ok: true, why: 'Correct: keeping the ISR to a few instructions bounds its effect on timing and moves the real work to a task where it can block.' },
      { t: `An ISR cannot read GPIO levels reliably, so the pin has to be sampled later by a task`, why: 'An ISR can read a pin perfectly well; the constraint is on how long it runs and what it may call.' },
      { t: `Posting to a queue is what tells the scheduler that the ISR has finished`, why: 'An ISR returns on its own; the queue is a way to hand data to a task, not a requirement for returning.' },
    ] },
    { q: 'Your sensor is unplugged and the display keeps showing the last good reading. Which requirement type did you fail to write?', kind: 'concept', choices: [
      { t: `A fault requirement stating the visible behaviour when a sensor read fails`, ok: true, why: 'Correct: without a stated fault behaviour nobody decided what should happen, so the default — a stale value that looks valid — is what you got.' },
      { t: `A timing requirement stating how quickly a button press must be handled`, why: 'Button timing is unrelated to how sensor failures are presented.' },
      { t: `A power budget showing the sensor's supply current against the regulator's limit`, why: 'The power budget concerns supply current, not how a failed read is handled.' },
    ] },
    { q: 'Sensor and display share one I2C bus. A full display refresh takes longer than the sensor period. What is the cleanest fix?', kind: 'arch', choices: [
      { t: `Measure both transactions, then shorten the refresh or relax the sensor period`, ok: true, why: 'Correct: this is a timing-budget problem, so it is solved with measurements and a budget that adds up.' },
      { t: `Raise the sensor task to the highest priority so that its read pre-empts the display refresh`, why: 'Priority does not let two transactions use one bus at once; the sensor read still waits for the bus to be free.' },
      { t: `Remove the bus mutex so that the sensor read no longer waits for the refresh`, why: 'Interleaving two transactions on one bus corrupts both; the lock is what keeps the bus usable.' },
    ] },
  ],
  requirements: {
    functional: [
      'FR-1: the device measures at least one quantity through a digital bus sensor and one through the ADC, each reported in engineering units.',
      'FR-2: the display shows current readings and device state, and is never staler than a limit you state.',
      'FR-3: two buttons let a user change at least one setting; each press produces exactly one event.',
      'FR-4: an actuator responds to a configurable threshold with hysteresis.',
      'FR-5: a failed sensor read produces a defined, visible fault state and recovers when the sensor returns.',
      'FR-6: the actuator stays inactive from reset until the application has decided otherwise.',
      'FR-7: the device runs for one hour without a reset or stack overflow, and its minimum free heap at 60 minutes equals the value at 10 minutes.',
    ],
  },
  rubric: [
    { criterion: 'Requirements', points: 15, evidence: 'Numbered list written before the build (dated or committed first); every item has a number or yes/no observation and a named test, including one timing and one fault requirement.' },
    { criterion: 'Block diagram and pin budget', points: 15, evidence: 'Diagram with real parts; pin table with each pin checked against chip and board documentation.' },
    { criterion: 'Power and timing budgets', points: 10, evidence: 'Current sum from datasheets vs regulator limit; task table with periods, priorities and deadlines.' },
    { criterion: 'Working integration', points: 25, evidence: 'For each of FR-1 to FR-7: a console log excerpt, photo or capture taken from the board that shows the requirement being met; rows not run on hardware are marked so and score nothing here.' },
    { criterion: 'Firmware structure', points: 10, evidence: 'Source showing tasks, queues, checked return values and an explicit state machine.' },
    { criterion: 'Test results', points: 15, evidence: 'Completed test table with evidence per row, including the fault and soak tests.' },
    { criterion: 'Design reasoning', points: 10, evidence: 'Written answers to the four design questions, with the requirement that decided each.' },
  ],
};

export default { skills: [], lessons: [], labs: [lab], glossary: [], troubleshooting: [], refs: [
  { org: 'Espressif', title: 'ESP-IDF GPIO reference for the original ESP32 (pin restrictions)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/gpio/esp32.inc' },
] };
