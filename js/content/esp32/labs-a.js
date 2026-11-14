// ESP32 projects 1-5 (guided laboratories). Firmware targets ESP-IDF v6.1 and is marked `reviewed`:
// it was written against the ESP-IDF documentation and headers and was NOT compiled or run on a board here.

/* ---------- small schematic-drawing helpers (inline SVG strings) ---------- */
const sch = {
  open: (w, h, label) => `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" font-family="system-ui, sans-serif" font-size="11">`,
  close: '</svg>',
  wire: (pts, attrs = '') => `<polyline points="${pts}" ${attrs}/>`,
  dot: (x, y) => `<circle cx="${x}" cy="${y}" r="2.8" fill="currentColor"/>`,
  txt: (x, y, s, anchor = 'start', attrs = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="currentColor" stroke="none" ${attrs}>${s}</text>`,
  // MCU or module outline with a title; pins are [y, label] on the right edge (side 'r') or left edge (side 'l')
  box(x, y, w, h, title, pins = [], side = 'r') {
    let o = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="var(--surface)"/>` + sch.txt(x + w / 2, y + 16, title, 'middle', 'font-weight="600"');
    for (const [py, label] of pins) {
      o += side === 'r' ? sch.txt(x + w - 6, py + 4, label, 'end') + sch.wire(`${x + w},${py} ${x + w + 12},${py}`)
        : sch.txt(x + 6, py + 4, label) + sch.wire(`${x - 12},${py} ${x},${py}`);
    }
    return o;
  },
  // vertical resistor, terminals at (x,y) and (x,y+50)
  resV: (x, y, label = '', lx = 12) => sch.wire(`${x},${y} ${x},${y + 7} ${x + 6},${y + 10} ${x - 6},${y + 16} ${x + 6},${y + 22} ${x - 6},${y + 28} ${x + 6},${y + 34} ${x - 6},${y + 40} ${x},${y + 43} ${x},${y + 50}`) + (label ? sch.txt(x + lx, y + 29, label, lx < 0 ? 'end' : 'start') : ''),
  // horizontal resistor, terminals at (x,y) and (x+50,y)
  resH: (x, y, label = '') => sch.wire(`${x},${y} ${x + 7},${y} ${x + 10},${y - 6} ${x + 16},${y + 6} ${x + 22},${y - 6} ${x + 28},${y + 6} ${x + 34},${y - 6} ${x + 40},${y + 6} ${x + 43},${y} ${x + 50},${y}`) + (label ? sch.txt(x + 25, y - 12, label, 'middle') : ''),
  // vertical diode, terminals at (x,y) and (x,y+40). dir 'down': anode on top (current flows down). dir 'up': cathode on top.
  diode(x, y, dir = 'down', label = '', led = false) {
    const tri = dir === 'down' ? `${x - 8},${y + 12} ${x + 8},${y + 12} ${x},${y + 26}` : `${x - 8},${y + 26} ${x + 8},${y + 26} ${x},${y + 12}`;
    const bar = dir === 'down' ? y + 26 : y + 12;
    let o = sch.wire(`${x},${y} ${x},${y + 12}`) + `<polygon points="${tri}"/>` + sch.wire(`${x - 8},${bar} ${x + 8},${bar}`) + sch.wire(`${x},${y + 26} ${x},${y + 40}`);
    if (led) o += sch.wire(`${x + 12},${y + 15} ${x + 20},${y + 8} ${x + 16},${y + 9}`) + sch.wire(`${x + 20},${y + 8} ${x + 19},${y + 12}`) + sch.wire(`${x + 13},${y + 23} ${x + 21},${y + 16} ${x + 17},${y + 17}`) + sch.wire(`${x + 21},${y + 16} ${x + 20},${y + 20}`);
    if (label) o += sch.txt(x + (led ? 26 : 14), y + 24, label);
    return o;
  },
  // ground symbol hanging below (x,y)
  gnd: (x, y) => sch.wire(`${x},${y} ${x},${y + 8}`) + sch.wire(`${x - 10},${y + 8} ${x + 10},${y + 8}`) + sch.wire(`${x - 6},${y + 12} ${x + 6},${y + 12}`) + sch.wire(`${x - 2},${y + 16} ${x + 2},${y + 16}`),
  // supply rail marker above (x,y)
  rail: (x, y, label) => sch.wire(`${x},${y} ${x},${y - 8}`) + sch.wire(`${x - 9},${y - 8} ${x + 9},${y - 8}`) + sch.txt(x, y - 13, label, 'middle'),
  // vertical push-button (normally open), terminals at (x,y) and (x,y+40)
  sw: (x, y, label = '') => sch.wire(`${x},${y} ${x},${y + 12}`) + sch.wire(`${x},${y + 28} ${x},${y + 40}`) + sch.wire(`${x + 9},${y + 12} ${x + 9},${y + 28}`) + sch.wire(`${x + 9},${y + 20} ${x + 17},${y + 20}`) + `<circle cx="${x}" cy="${y + 12}" r="2"/><circle cx="${x}" cy="${y + 28}" r="2"/>` + (label ? sch.txt(x + 22, y + 24, label) : ''),
  // vertical capacitor, terminals at (x,y) and (x,y+len)
  capV: (x, y, len, label = '') => sch.wire(`${x},${y} ${x},${y + len / 2 - 3}`) + sch.wire(`${x - 9},${y + len / 2 - 3} ${x + 9},${y + len / 2 - 3}`) + sch.wire(`${x - 9},${y + len / 2 + 3} ${x + 9},${y + len / 2 + 3}`) + sch.wire(`${x},${y + len / 2 + 3} ${x},${y + len}`) + (label ? sch.txt(x + 13, y + len / 2 + 4, label) : ''),
  // N-channel enhancement MOSFET. Gate terminal at (x,y); drain at (x+42,y-26); source at (x+42,y+26)
  nmos: (x, y, label = '') => sch.wire(`${x},${y} ${x + 20},${y}`) + sch.wire(`${x + 20},${y - 12} ${x + 20},${y + 12}`) + sch.wire(`${x + 26},${y - 15} ${x + 26},${y + 15}`)
    + sch.wire(`${x + 26},${y - 10} ${x + 42},${y - 10} ${x + 42},${y - 26}`) + sch.wire(`${x + 26},${y + 10} ${x + 42},${y + 10} ${x + 42},${y + 26}`)
    + sch.wire(`${x + 42},${y + 10} ${x + 42},${y} ${x + 27},${y}`) + `<polygon points="${x + 27},${y} ${x + 34},${y - 3.5} ${x + 34},${y + 3.5}" fill="currentColor"/>`
    + sch.txt(x + 10, y - 6, 'G', 'middle') + sch.txt(x + 48, y - 14, 'D') + sch.txt(x + 48, y + 22, 'S') + (label ? sch.txt(x + 60, y + 4, label) : ''),
  // DC motor, terminals at (x,y) and (x,y+40)
  motor: (x, y, label = '') => sch.wire(`${x},${y} ${x},${y + 6}`) + `<circle cx="${x}" cy="${y + 20}" r="14" fill="var(--surface)"/>` + sch.txt(x, y + 24, 'M', 'middle', 'font-weight="600"') + sch.wire(`${x},${y + 34} ${x},${y + 40}`) + (label ? sch.txt(x - 20, y + 24, label, 'end') : ''),
};

const idfRef = (path, title, note) => ({ title, url: `https://github.com/espressif/esp-idf/blob/v6.1/${path}`, ...(note ? { note } : {}) });

const PORTING = `**Other boards.** The pin numbers here are for the original ESP32 DevKit (ESP32-WROOM-32 module). On an ESP32-S3 or ESP32-C3 board the GPIO numbers that are safe differ: the strapping pins, the pins wired to the module's flash, and the USB D+/D− pins are in different places (USB is GPIO20/19 on the S3 and GPIO19/18 on the C3). Open your board's pinout and the *Strapping pins* and *Pin definitions* sections of the chip datasheet, pick a free GPIO that is none of those, and change the \`#define\` at the top of the file. Nothing else in the code depends on the pin number unless this project says so.`;

const CURRENT_NOTE = `Check the datasheet (*DC characteristics* and *Absolute maximum ratings*) for what one GPIO and the whole chip may source or sink. A conservative design keeps GPIO current to a few mA and uses a transistor for anything heavier.`;

const skills = [
  { id: 'esp-pa-idf-project', name: 'Create, build, flash and monitor an ESP-IDF project from the command line', track: 'programming' },
  { id: 'esp-pa-gpio-out', name: 'Configure and drive a GPIO output and name the registers the driver call ends up writing', track: 'programming' },
  { id: 'esp-pa-led-circuit', name: 'Size an LED series resistor and confirm the current with a multimeter', track: 'hardware' },
  { id: 'esp-pa-debounce', name: 'Read a mechanical button reliably by polling and by interrupt with software debounce', track: 'programming' },
  { id: 'esp-pa-isr-queue', name: 'Hand an event from a GPIO interrupt handler to a task through a FreeRTOS queue', track: 'programming' },
  { id: 'esp-pa-ledc', name: 'Configure LEDC PWM and choose frequency and resolution for a given load', track: 'programming' },
  { id: 'esp-pa-mosfet-driver', name: 'Build a low-side MOSFET driver with flyback diode and separate supply for an inductive load', track: 'hardware' },
  { id: 'esp-pa-adc-measure', name: 'Take calibrated, averaged ADC readings and convert them to a physical quantity', track: 'programming' },
  { id: 'esp-pa-i2c-bringup', name: 'Bring up an I2C device in stages: scan the bus, read an ID register, then read data', track: 'hardware' },
  { id: 'esp-pa-datasheet-driver', name: 'Write a register-level sensor driver from the datasheet register map and test its arithmetic on a PC', track: 'programming' },
];

/* =====================================================================================
 * Project 1: LED control and GPIO fundamentals
 * ===================================================================================== */
const P1_HELLO = String.raw`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"

static const char *TAG = "p1";

void app_main(void)
{
    int n = 0;
    while (1) {
        ESP_LOGI(TAG, "alive %d", n++);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}`;

const P1_CMAKE_TOP = String.raw`# p1_led/CMakeLists.txt  (project level)
cmake_minimum_required(VERSION 3.22)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(p1_led)`;

const P1_CMAKE_MAIN = String.raw`# p1_led/main/CMakeLists.txt  (the "main" component)
idf_component_register(SRCS "main.c"
                       INCLUDE_DIRS ".")`;

const P1_STEADY = String.raw`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#define LED_GPIO GPIO_NUM_18

static const char *TAG = "p1";

void app_main(void)
{
    const gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&led_cfg));

    gpio_dump_io_configuration(stdout, 1ULL << LED_GPIO);   /* print what the pin is now */

    ESP_ERROR_CHECK(gpio_set_level(LED_GPIO, 1));
    ESP_LOGI(TAG, "LED pin driven high");

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}`;

const P1_FINAL = String.raw`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#define LED_GPIO   GPIO_NUM_18
#define HALF_MS    500

static const char *TAG = "p1";

void app_main(void)
{
    const gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << LED_GPIO,
        .mode         = GPIO_MODE_INPUT_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&led_cfg));

    int on = 0;
    while (1) {
        on = !on;
        gpio_set_level(LED_GPIO, on);
        ESP_LOGI(TAG, "wrote %d, pin reads %d", on, gpio_get_level(LED_GPIO));
        vTaskDelay(pdMS_TO_TICKS(HALF_MS));
    }
}`;

const P1_REG = String.raw`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "soc/soc.h"        /* REG_WRITE, REG_READ, BIT */
#include "soc/gpio_reg.h"   /* GPIO_OUT_W1TS_REG, GPIO_OUT_W1TC_REG, GPIO_OUT_REG */

#define LED_GPIO GPIO_NUM_18   /* this register-level version only handles GPIO0..31 */

void app_main(void)
{
    const gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&led_cfg));       /* let the driver do the routing once */

    while (1) {
        REG_WRITE(GPIO_OUT_W1TS_REG, BIT(LED_GPIO));          /* write-1-to-set   */
        printf("GPIO_OUT = 0x%08x\n", (unsigned)REG_READ(GPIO_OUT_REG));
        vTaskDelay(pdMS_TO_TICKS(500));
        REG_WRITE(GPIO_OUT_W1TC_REG, BIT(LED_GPIO));          /* write-1-to-clear */
        printf("GPIO_OUT = 0x%08x\n", (unsigned)REG_READ(GPIO_OUT_REG));
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}`;

const P1_FIG = sch.open(430, 230, 'Schematic: GPIO18 through a 330 ohm resistor to a red LED to ground')
  + sch.box(20, 30, 130, 170, 'ESP32 DevKit', [[80, 'GPIO18'], [180, 'GND']])
  + sch.wire('162,80 200,80', 'stroke="var(--sig1)"') + sch.resH(200, 80, 'R1 330 Ω') + sch.wire('250,80 310,80 310,95', 'stroke="var(--sig1)"')
  + sch.diode(310, 95, 'down', 'D1 red LED', true) + sch.wire('310,135 310,180 162,180') + sch.dot(310, 180) + sch.gnd(310, 180)
  + sch.txt(302, 90, 'anode', 'end', 'font-size="10" opacity=".75"') + sch.txt(302, 148, 'cathode', 'end', 'font-size="10" opacity=".75"')
  + sch.wire('180,100 222,100 216,97', 'stroke-width="1"') + sch.wire('222,100 216,103', 'stroke-width="1"') + sch.txt(200, 114, 'I ≈ 4 mA', 'middle', 'font-size="10"')
  + sch.close;

const p1 = {
  id: 'esp-p1', title: 'Project 1: LED control and GPIO fundamentals', kind: 'Project', minutes: 120,
  summary: 'Build the toolchain round trip, light one LED with a calculated resistor, and follow gpio_set_level() down to the register that moves the pin.',
  skills: ['esp-pa-idf-project', 'esp-pa-gpio-out', 'esp-pa-led-circuit'],
  objectives: [
    'Create an ESP-IDF project from two CMake files and one C file, then build, flash and monitor it.',
    'Choose a series resistor for an LED from the supply voltage, the LED forward voltage and a target current, and confirm the current by measurement.',
    'Configure a pin as a push-pull output with `gpio_config()` and explain what the call changes in IO_MUX and the GPIO registers.',
    'Explain why `gpio_get_level()` returns 0 on an output-only pin, and why a loop without a delay trips the task watchdog.',
    'Drive the pin by writing the set/clear registers directly, and say why set/clear registers exist.',
  ],
  hardware: [
    'ESP32 DevKit board (ESP32-WROOM-32 module) and a USB data cable. An ESP32-S3 or ESP32-C3 board works with a different pin number.',
    'Solderless breadboard and 3 jumper wires.',
    '1 × red 5 mm LED. Red has the lowest forward voltage (roughly 1.8–2.0 V), which leaves the most headroom from a 3.3 V pin.',
    '1 × 330 Ω resistor (orange-orange-brown). Chosen to give about 4 mA: clearly visible and well inside a conservative GPIO budget.',
    '1 × 1 kΩ and 1 × 100 Ω resistor for the comparison in step 4 (optional).',
    'Multimeter with DC volts and continuity ranges.',
  ],
  software: [
    'ESP-IDF v6.1 installed with the ESP-IDF Installation Manager (`eim install`), and a terminal where `idf.py --version` works.',
    'A serial terminal is not needed: `idf.py monitor` is used throughout.',
    'A text editor.',
  ],
  background: [
    `## What a GPIO output is, electrically

A push-pull output is two transistors inside the chip. One connects the pin to the 3.3 V rail, the other connects it to ground, and the output register decides which one is on. "Set the pin high" means "turn on the top transistor". The pin is then a 3.3 V source with a small internal resistance, and how much current flows is decided entirely by what you connected outside.

That is why an LED needs a series resistor. An LED is a diode: below its forward voltage almost nothing flows, above it the current rises very steeply. Connect it straight from a 3.3 V pin to ground and the only things limiting the current are the pin transistor and the LED itself. The resistor makes the current predictable:

\`I = (V_pin − V_f) / R\`

## What the driver has to configure

On the ESP32 a pad can be connected to many internal signals, so three things must be right before a write to the output register reaches the pin:

1. **IO_MUX** selects which function owns the pad. The driver selects the plain GPIO function.
2. **The GPIO matrix** selects which internal signal drives the pad's output. The driver selects the special "simple GPIO output" signal, which is the bit in \`GPIO_OUT_REG\`.
3. **The output enable** bit for the pin in \`GPIO_ENABLE_REG\` turns the pad driver on. Without it the pin stays high-impedance whatever the output register says.

\`gpio_config()\` does all three. \`gpio_set_level()\` then only writes one bit.`,
    { t: 'callout', kind: 'why', md: `Why not write the output register directly from the start? You will, in step 7. But the routing in points 1–3 differs between chips, and the driver hides exactly that part. Knowing which half is portable and which is not is the point of this project.` },
    { t: 'callout', kind: 'warn', title: 'Current limits', md: CURRENT_NOTE },
    `## Why GPIO18

The original ESP32 has pins you should not pick for a first experiment: GPIO0, 2, 5, 12 and 15 are strapping pins sampled at reset, GPIO6–11 are wired to the module's flash, GPIO34–39 are input-only, and GPIO1/3 carry the serial console on most DevKits. GPIO18 is none of these.

${PORTING}`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Wiring, pin by pin. Unplug USB while you wire.', text: String.raw`
From                      To                         Why
------------------------  -------------------------  ----------------------------------
DevKit GPIO18 (D18)       R1 330 ohm, lead A         current-limited output
R1 330 ohm, lead B        LED anode (longer leg)     series path, order does not matter
LED cathode (shorter leg, DevKit GND                 return path
  flat side of the rim)
` },
    { t: 'figure', svg: P1_FIG, caption: 'GPIO18 sources current through R1 and D1 to ground. The LED is on when the pin is high ("active high").' },
    { t: 'widget', name: 'led-resistor', props: { vsupply: 3.3, vf: 1.9, challenge: 'gpio-3v3-red' }, caption: 'Try resistor values before you build. Watch what happens to the current as you go below about 100 Ω.' },
    { t: 'widget', name: 'breadboard', props: { challenge: 'led' }, caption: 'Place the resistor and LED on a simulated breadboard first. The simulation checks the DC circuit; it does not model your particular LED.' },
  ],
  steps: [
    { title: 'Work out the resistor before touching hardware', blocks: [
      `You want an LED that is clearly visible on a desk. A modern red LED is easily visible at 2–5 mA, far below the 20 mA printed on many kit bags. Assume the pin sits at 3.3 V when high and the LED drops 1.9 V.`,
      { t: 'exercise', prompt: 'With a 330 Ω resistor, V_pin = 3.3 V and V_f = 1.9 V, what current flows, in mA?',
        hints: ['The resistor sees only the voltage that is left after the LED has taken its share.', 'I = (3.3 − 1.9) / 330.'],
        answer: { type: 'number', value: 4.24, tol: 0.15, unit: 'mA' },
        solution: `(3.3 − 1.9) V / 330 Ω = 1.4 / 330 ≈ **4.2 mA**. The resistor dissipates 1.4 V × 4.2 mA ≈ 6 mW, far below a ¼ W rating, so any through-hole resistor will do.` },
      { t: 'callout', kind: 'decision', md: `**Why 330 Ω and not 100 Ω or 1 kΩ?** 100 Ω gives about 14 mA: bright, but it uses a large share of what one pin should supply and leaves nothing for other pins. 1 kΩ gives about 1.4 mA: fine in a dim room, hard to see in daylight. 330 Ω is a standard E12 value in the middle. In a product you would also choose by battery life.` },
    ] },
    { title: 'Create the project and prove the round trip', blocks: [
      `Before any hardware is involved, prove that you can build, flash and see output. If a later step fails you will then know it is not the toolchain.

Create a directory \`p1_led\` with this layout:

\`\`\`
p1_led/
  CMakeLists.txt
  main/
    CMakeLists.txt
    main.c
\`\`\``,
      { t: 'code', lang: 'cmake', status: 'reviewed', code: P1_CMAKE_TOP, caption: 'Project-level CMakeLists.txt',
        explain: [{ lines: '3', md: 'Pulls in the ESP-IDF build system. `IDF_PATH` is set by the environment that the installer activates.' }, { lines: '4', md: 'Names the project; the firmware image will be `build/p1_led.bin`.' }] },
      { t: 'code', lang: 'cmake', status: 'reviewed', code: P1_CMAKE_MAIN, caption: 'main/CMakeLists.txt',
        explain: [{ lines: '2-3', md: 'Registers one component called `main` with one source file. With no `REQUIRES` line, the `main` component may use every other ESP-IDF component. If you later add `REQUIRES`, you must list each one you include from, for example `esp_driver_gpio`.' }] },
      { t: 'code', lang: 'c', status: 'reviewed', code: P1_HELLO, caption: 'main/main.c, first version: no hardware yet',
        explain: [{ lines: '8', md: '`app_main` is not the reset vector. The ROM, the second-stage bootloader and the ESP-IDF startup code run first, start FreeRTOS, and call `app_main` from a task called `main`.' }, { lines: '13', md: '`vTaskDelay` blocks this task and lets the scheduler run others, including the idle task.' }] },
      `Then, from the project directory:

\`\`\`
idf.py set-target esp32
idf.py build
idf.py -p PORT flash monitor
\`\`\`

\`PORT\` is something like \`/dev/ttyUSB0\` on Linux or \`COM5\` on Windows. Use \`esp32s3\` or \`esp32c3\` as the target for those chips. Leave the monitor with \`Ctrl+]\`.

**You should see** a boot log (ROM messages, then the bootloader, then lines tagged \`I (…)\`), followed by \`I (…) p1: alive 0\`, \`alive 1\`, … once per second.`,
      { t: 'callout', kind: 'note', md: `If the flash step waits at \`Connecting....\` and fails, hold the board's BOOT button while it connects. BOOT pulls GPIO0 low at reset, which is the strapping condition for the ROM serial bootloader. Most DevKits do this automatically through the USB-serial chip's DTR/RTS lines, but not all.` },
    ] },
    { title: 'Wire the LED and test it without firmware', blocks: [
      `Unplug USB. Build the circuit from the wiring table, **except** leave the resistor's first lead unconnected instead of putting it on GPIO18.

Plug USB back in and touch that free resistor lead to the DevKit's \`3V3\` pin.

**You should see** the LED light. If it does not, the LED is reversed or a breadboard row is not what you think it is. Fix that now: you have just separated "is my circuit right?" from "is my code right?", and that separation is the most useful debugging habit there is.

Now move the lead to GPIO18. The LED should be off (or flicker briefly at reset): after reset the pin is a high-impedance input.`,
      { t: 'callout', kind: 'mistake', md: `**Plugging the LED and resistor into the same breadboard row.** Both leads of a part in one row are shorted together by the row's metal strip, so the part is bypassed. Each junction in the schematic is one row; each part must span two rows.` },
    ] },
    { title: 'Configure the pin and drive it high', blocks: [
      { t: 'predict', q: 'The code below configures GPIO18 as an output and then prints the pin configuration **before** writing a level. Is the LED on or off at the moment of the print?',
        choices: [
          { t: 'Off: the output register bit for the pin is 0 until something sets it', ok: true, why: 'Enabling the output driver connects the pin to whatever the output register says, and that bit is 0 after reset. The pin goes from floating to actively driven low.' },
          { t: 'On: enabling an output drives it high by default', why: 'Output enable only turns the pad driver on. Which level it drives comes from a separate register bit, and nothing has written that bit yet.' },
          { t: 'Undefined: it floats until gpio_set_level is called', why: 'It floated before gpio_config. Once the output is enabled, one of the two pin transistors is always on, so the level is defined.' },
        ],
        reveal: 'This matters in real designs: between reset and your `gpio_config` call the pin floats, and between `gpio_config` and your first write it is low. If the load must never see a wrong level (a motor driver, a relay), you add an external pull resistor for the floating window and you write the level register *before* enabling the output.' },
      { t: 'code', lang: 'c', status: 'reviewed', code: P1_STEADY, caption: 'main/main.c, second version: steady on' },
      `Build, flash and monitor.

**You should see** the LED on, steadily, and in the monitor a block of text about IO 18 printed by \`gpio_dump_io_configuration\`: pull-up and pull-down disabled, output enabled, input disabled, and a function-select line saying the pad is in GPIO mode. The exact wording depends on the IDF version.

**Measure.** Multimeter on DC volts, black probe on GND:
- Red probe on GPIO18: you should see close to 3.3 V (a little lower because the pin transistor has some resistance).
- Red probe on the LED anode: you should see the LED's forward voltage, about 1.8–2.0 V for red.
- The difference is the voltage across R1. Divide by 330 Ω to get the current. You should get roughly 4 mA. Write the three numbers in your notebook.

If you have them, swap R1 for 1 kΩ and then 100 Ω and repeat. Notice that the LED voltage barely moves while the current changes by a factor of ten: that is the steep diode curve.`,
    ] },
    { title: 'Blink, and find out what the delay is for', blocks: [
      `Replace the steady \`while\` loop with one that toggles a variable, writes it with \`gpio_set_level\`, and calls \`vTaskDelay(pdMS_TO_TICKS(500))\`. Keep the log line. Write it yourself before looking at the complete version in the next step.

**You should see** the LED change state twice a second and a log line each time.`,
      { t: 'exercise', prompt: `**Debugging exercise A.** A classmate "simplifies" the loop by replacing \`vTaskDelay\` with a counting loop:

The LED blinks, but every few seconds the monitor prints an error that starts \`task_wdt: Task watchdog got triggered\` and names \`IDLE0\`. Why, and what is the fix?`,
        code: String.raw`while (1) {
    on = !on;
    gpio_set_level(LED_GPIO, on);
    for (volatile int i = 0; i < 3000000; i++) { }   /* "delay" */
}`,
        hints: ['Which task is running during the counting loop, and which tasks are not?', 'The watchdog message names the task that failed to run, not the task that caused it.', 'The idle task has the lowest priority. It runs only when every other task on that core is blocked.'],
        solution: `The \`main\` task never blocks, so it is always ready to run, and it has a higher priority than the idle task on the same core. The idle task therefore never gets the CPU. ESP-IDF's task watchdog expects the idle task to run regularly (it does housekeeping such as freeing deleted tasks' memory) and reports when it has been starved for several seconds.

The fix is to block instead of burning cycles: \`vTaskDelay()\` puts the task in the Blocked state until the tick count is reached, and the scheduler runs the idle task in the meantime. A busy loop is also a bad timer: its duration changes with compiler optimisation and CPU frequency.` },
    ] },
    { title: 'Read the pin back', blocks: [
      `Add \`gpio_get_level(LED_GPIO)\` to the log line so that each line shows the value you wrote and the value read back, but keep \`.mode = GPIO_MODE_OUTPUT\`.`,
      { t: 'exercise', prompt: `**Debugging exercise B.** With \`GPIO_MODE_OUTPUT\`, the log shows \`wrote 1, pin reads 0\` while the LED is visibly on. The multimeter says 3.2 V on the pin. Which is wrong: the pin, the meter or the read? What one-word change fixes the log?`,
        hints: ['Look again at the IO dump from step 4. One of its lines is about the input side of the pad.', 'A pad has an output driver and a separate input buffer, each with its own enable bit.'],
        answer: { type: 'text', accept: ['INPUT_OUTPUT', 'input.?output', 'input (buffer|enable)'], nudge: 'Name the GPIO mode that enables both halves of the pad.' },
        solution: `The read is wrong, and for a mechanical reason: \`gpio_get_level\` reads the input register, and the pad's **input buffer is disabled** in \`GPIO_MODE_OUTPUT\`, so the register bit stays 0. Change the mode to \`GPIO_MODE_INPUT_OUTPUT\`. The pad then drives the pin and also samples it, so you read the real pin level.

That is more useful than reading back the output register: if the pin is shorted to ground, the output register still says 1 but the input register says 0.` },
      { t: 'code', lang: 'c', status: 'reviewed', code: P1_FINAL, caption: 'main/main.c, complete blink with read-back' },
      `**You should see** \`wrote 1, pin reads 1\` and \`wrote 0, pin reads 0\` alternating.

Now a deliberate fault: with the program running, briefly connect GPIO18 to GND **through the 100 Ω resistor** (not a bare wire). Predict the log line first. With the LED path and a 100 Ω path to ground in parallel, the pin is pulled down somewhat while high; whether it reads 0 depends on the pin's output resistance and the input threshold. Record what you see and explain it using the thresholds in the datasheet's DC characteristics table.`,
    ] },
    { title: 'Go underneath the driver: write the registers yourself', blocks: [
      `The driver's \`gpio_set_level\` ends in a single register write. Do that write yourself.

The GPIO peripheral has three registers for the output latch of pins 0–31: \`GPIO_OUT_REG\` (the latch itself), \`GPIO_OUT_W1TS_REG\` (write 1 to set) and \`GPIO_OUT_W1TC_REG\` (write 1 to clear). Writing a 1 bit to W1TS sets that bit of the latch and leaves every other bit alone; 0 bits do nothing.`,
      { t: 'predict', q: 'Why does the hardware provide separate set and clear registers when `GPIO_OUT_REG |= BIT(18)` would also set the bit?',
        choices: [
          { t: 'Because `|=` is a read, a modify and a write, and an interrupt or another core can change the register between the read and the write', ok: true, why: 'The read-modify-write sequence is not atomic. If an ISR or the other core changes a different pin in between, your write puts the old value back and that change is lost. A single write to W1TS cannot lose anything.' },
          { t: 'Because the output register is read-only', why: 'It is readable and writable. The problem with writing it is what happens to the other 31 bits when two pieces of code do so at once.' },
          { t: 'Because set/clear writes are faster for the LED', why: 'An LED cannot tell a few nanoseconds apart. The reason is correctness when several contexts share one register.' },
        ],
        reveal: 'This lost-update race is the same one you will meet with shared variables in the RTOS section. Hardware designers remove it for GPIO by making "set" and "clear" single write operations.' },
      { t: 'code', lang: 'c', status: 'reviewed', code: P1_REG, caption: 'main/main.c, register-level variant (ESP32, ESP32-S3 and ESP32-C3 all have these three registers for GPIO0–31)' },
      `**You should see** the same blink, and \`GPIO_OUT = 0x00040000\` alternating with \`0x00000000\` (other bits may be set if other code drives pins). \`0x00040000\` is bit 18.

Then delete the \`gpio_config\` call, rebuild and flash. **You should see** the printed register value still alternate while the LED stays dark. The latch changes, but nothing connects it to the pad: output enable is off. This is the experiment that shows what the driver call was for.`,
    ] },
    { title: 'Diagnose a wiring variant', blocks: [
      { t: 'exercise', prompt: `**Debugging exercise C.** Another bench has the *same firmware* as your step 6 but the LED is lit when the log says \`wrote 0\` and dark when it says \`wrote 1\`. The read-back agrees with the written value every time. Their wiring is: \`3V3 → LED anode\`, \`LED cathode → 330 Ω → GPIO18\`. Is anything broken? What is this arrangement called and when would you choose it?`,
        hints: ['Trace the current path when the pin is low. Which pin transistor is on?', 'Now trace it when the pin is high: what is the voltage across the LED and resistor together?'],
        solution: `Nothing is broken. The LED is wired **active-low**: when the pin is low, the bottom pin transistor connects the cathode side to ground and current flows from 3V3 through the LED and resistor into the pin (the pin *sinks* current). When the pin is high, both ends of the LED-resistor chain are at 3.3 V and no current flows.

It is chosen when a pin can sink more than it can source (true of some chips; check the datasheet), when the pin is open-drain, or when the LED runs from a different rail than the logic. In firmware, hide the polarity behind one function such as \`led_set(bool on)\` so the rest of the code never needs to know.` },
      { t: 'exercise', prompt: `**Debugging exercise D.** Someone moves the LED to the pin labelled \`D34\` because it was closer, and changes \`LED_GPIO\` to \`GPIO_NUM_34\`. The program builds. What happens at run time on an original ESP32, and where would you have found this out before wiring?`,
        hints: ['Look at the list of pins to avoid in the background section.'],
        solution: `GPIO34–39 on the original ESP32 are **input-only**: the pads have no output driver. \`gpio_config\` reports an error for an output mode on these pins (and \`ESP_ERROR_CHECK\` then aborts and reboots, so you would see a reboot loop with an error line naming the GPIO). The LED never lights. The place to check is the pin table in the datasheet or the ESP-IDF GPIO documentation for your chip, before choosing a pin.` },
    ] },
  ],
  walkthrough: [
    `Follow one call from C to copper, using the complete program from step 6.`,
    { t: 'code', lang: 'c', status: 'reviewed', code: P1_FINAL, caption: 'The final program again, annotated',
      explain: [
        { lines: '14', md: '`pin_bit_mask` is a 64-bit mask, one bit per GPIO number, so one call can configure several pins. `1ULL << 18` is bit 18. Writing `LED_GPIO` here instead of the shift is a classic bug: 18 is binary 10010, which selects GPIO1 and GPIO4.' },
        { lines: '15', md: '`GPIO_MODE_INPUT_OUTPUT` makes the driver set the pin\'s bit in the output-enable register (through `GPIO_ENABLE_W1TS_REG`) and set the input-enable bit in the pad\'s IO_MUX register. Push-pull is the default; open-drain is a separate mode that sets the pad-driver bit in the pin\'s `GPIO_PINn_REG`.' },
        { lines: '16-17', md: 'The pull resistors are bits in the pad\'s IO_MUX register (some pads are also controlled through the RTC IO block; the driver handles that). An actively driven output does not need a pull.' },
        { lines: '18', md: 'No interrupt: the interrupt-type field of `GPIO_PINn_REG` is cleared.' },
        { lines: '20', md: '`gpio_config` also selects the GPIO function in IO_MUX and routes the "simple GPIO output" signal to the pad through the GPIO matrix output-select register for this pin. `ESP_ERROR_CHECK` aborts with a file and line number if the call returns anything but `ESP_OK`.' },
        { lines: '25', md: '`gpio_set_level` writes `1 << 18` to `GPIO_OUT_W1TS_REG` or `GPIO_OUT_W1TC_REG` (for pins 32 and above there is a second register set). One bus write; the pin transistor switches a few nanoseconds later.' },
        { lines: '26', md: '`gpio_get_level` reads `GPIO_IN_REG` and shifts out bit 18. `ESP_LOGI` formats into a buffer and sends it to UART0, which the USB-serial chip forwards to your PC. At 115200 baud a 40-character line takes about 3.5 ms to leave the chip.' },
        { lines: '27', md: '`pdMS_TO_TICKS(500)` converts milliseconds to scheduler ticks. With the default 100 Hz tick that is 50 ticks. The task is moved to the Blocked list; the tick interrupt moves it back when the count is reached.' },
      ] },
    `**What is portable.** The three C calls work unchanged on every ESP32-family chip. The register *names* \`GPIO_OUT_W1TS_REG\` and \`GPIO_OUT_W1TC_REG\` also exist on the S3 and C3, but their addresses, the IO_MUX layout and the number of pins differ. Look them up in the *IO MUX and GPIO Matrix* chapter of the Technical Reference Manual for your chip rather than copying addresses between chips.`,
  ],
  testing: [
    `Work down this list; each line is one observation and how to get it.

| Check | How | You should see |
|---|---|---|
| Toolchain round trip | \`idf.py flash monitor\` with the step 2 program | \`alive N\` once per second |
| LED polarity | Free resistor lead touched to 3V3 | LED lit |
| High level | DC volts, GPIO18 to GND, steady-on program | about 3.2–3.3 V |
| LED forward voltage | DC volts, LED anode to GND | about 1.8–2.0 V (red) |
| LED current | (V_GPIO18 − V_anode) / 330 Ω | about 4 mA |
| Blink period | Count 20 flashes against a clock | 20 s ± 1 s (period 1 s) |
| Read-back | Monitor output, final program | written and read values equal |
| Low level | DC volts on GPIO18 while the LED is off (lengthen the delay to 5 s to catch it) | under 0.1 V |

**With a logic analyser** (any 8-channel USB analyser with PulseView): channel 0 on GPIO18, ground clip on GND, sample at 1 MHz for 5 s. You should see a square wave with 500 ms high and 500 ms low. Measure the period with the cursors. It will be a whole number of 10 ms ticks plus the time the log line takes; note how far it is from exactly 1.000 s and explain the difference.`,
    { t: 'callout', kind: 'hw', md: `A multimeter on DC volts shows the *average* of a fast-changing signal. For this 1 Hz blink it will swing visibly between two values. Remember this in project 3, where the same average becomes useful.` },
  ],
  troubleshooting: [
    { symptom: '`idf.py flash` ends with "Failed to connect" or keeps printing `Connecting.....`', cause: 'The chip did not enter the ROM serial bootloader, the cable is charge-only, or the wrong port was chosen.', fix: 'Hold BOOT while it connects; try another cable; list ports before and after plugging in to find the right one. On Linux, check that your user is in the group that owns the serial device.' },
    { symptom: 'Monitor shows unreadable characters', cause: 'Baud rate mismatch between the monitor and the console UART, or a board with a non-default crystal.', fix: 'Use `idf.py monitor` (it reads the baud rate from the project configuration). If only the very first ROM lines are garbled, the crystal frequency setting in menuconfig does not match the board.' },
    { symptom: 'LED never lights, log looks right', cause: 'LED reversed, wrong breadboard row, or the jumper is on a different DevKit pin than GPIO18.', fix: 'Repeat the step 3 test with the lead on 3V3. Then measure GPIO18 to GND: if it toggles 0/3.3 V the fault is after the pin; if not, you are on the wrong pin.' },
    { symptom: 'LED is on but very dim', cause: 'Resistor is 33 kΩ or 330 kΩ instead of 330 Ω (colour bands misread), or the LED is a high-V_f colour (blue, white) with little headroom from 3.3 V.', fix: 'Measure the resistor with the multimeter out of circuit. For blue/white LEDs, recalculate with V_f ≈ 3 V: very little voltage is left for the resistor.' },
    { symptom: 'Board reboots in a loop; log shows an error naming a GPIO and then `abort()`', cause: '`gpio_config` rejected the pin: input-only pin used as an output, or a pin number that does not exist on this chip.', fix: 'Read the error line; pick a valid output pin for your chip.' },
    { symptom: '`task_wdt: Task watchdog got triggered` every few seconds', cause: 'A loop in your task never blocks, so the idle task is starved.', fix: 'Use `vTaskDelay` (or block on a queue) inside every infinite loop.' },
    { symptom: 'Board will not boot or flash once the LED is connected', cause: 'The LED is on a strapping pin (GPIO0, 2, 5, 12 or 15 on the original ESP32) and its load changes the level sampled at reset.', fix: 'Move the LED to a non-strapping pin such as GPIO18.' },
    { symptom: 'Read-back is always 0', cause: 'Pin configured `GPIO_MODE_OUTPUT`, so its input buffer is off.', fix: 'Use `GPIO_MODE_INPUT_OUTPUT` if you need to read the pin.' },
  ],
  challenge: `**Morse beacon with a measured power budget.** No solution is given.

1. Make the LED send a short text of your choice in Morse code, using a table-driven design: the timing unit and the text are constants, and no \`if\` chain per letter.
2. All timing must come from \`vTaskDelay\`; the task watchdog must stay quiet.
3. Add a second LED of a different colour on another safe pin, lit during the gap between words. Calculate its resistor for the same current as the red LED, using that LED's forward voltage, which you measure yourself.
4. In your notebook: the measured current of each LED, the average current of the red LED over one full message (from your duty cycle), and one paragraph on which part of your code is ESP32-specific and which would survive a move to a different microcontroller.`,
  quiz: [
    { kind: 'circuit', q: 'A blue LED with V_f ≈ 3.0 V is put in place of the red one, keeping the 330 Ω resistor and a 3.3 V pin. What do you expect?',
      choices: [
        { t: 'It lights very dimly: only about 0.3 V is left across the resistor, so under 1 mA flows', ok: true, why: '(3.3 − 3.0) / 330 ≈ 0.9 mA, and the real value moves a lot with small changes in V_f or pin voltage. Driving high-V_f LEDs from 3.3 V leaves almost no headroom to control the current.' },
        { t: 'It is brighter, because blue LEDs are more efficient', why: 'Brightness follows current. Work out the voltage left across the resistor once the LED has taken its forward voltage.' },
        { t: 'It burns out, because 3.0 V is close to the supply', why: 'A high forward voltage reduces the current; it does not raise it. Damage comes from too much current, and here there is very little.' },
      ] },
    { kind: 'code', q: 'What does this configuration do on an original ESP32?', code: String.raw`gpio_config_t c = { .pin_bit_mask = GPIO_NUM_18, .mode = GPIO_MODE_OUTPUT };
gpio_config(&c);`,
      choices: [
        { t: 'It configures GPIO1 and GPIO4 as outputs, because 18 is used as a bit mask (binary 10010)', ok: true, why: 'The field is a mask with one bit per pin. The value 18 has bits 1 and 4 set. GPIO1 is the console TX pin on most DevKits, so the log output may also break.' },
        { t: 'It configures GPIO18, because the driver accepts either a pin number or a mask', why: 'The driver cannot tell the two apart: 18 is a perfectly valid mask. It does what the bits say.' },
        { t: 'It fails to compile, because the types differ', why: 'An enum value converts silently to a 64-bit integer in C. The compiler has no objection, which is what makes this bug common.' },
      ] },
    { kind: 'concept', q: 'You remove `gpio_config()` but keep writing `GPIO_OUT_W1TS_REG`. The register read-back shows bit 18 set, yet the pin measures near 0 V with the LED attached. Why?',
      choices: [
        { t: 'The output latch changed, but the pad driver is not enabled, so the pin is high-impedance and the LED path pulls it to ground', ok: true, why: 'The latch, the output enable and the routing are separate. Only the latch was written.' },
        { t: 'Register writes from application code are ignored without a driver', why: 'The write clearly happened: the read-back shows it. Ask what else lies between that latch bit and the physical pad.' },
        { t: 'The LED has pulled the pin low because 4 mA is too much for it', why: 'A few mA through a properly enabled output moves the level by a fraction of a volt at most. Here the output stage is not on at all.' },
      ] },
    { kind: 'concept', q: 'What would happen if you replaced `vTaskDelay(pdMS_TO_TICKS(500))` with `vTaskDelay(pdMS_TO_TICKS(5))` on a default configuration with a 100 Hz tick?',
      choices: [
        { t: 'The macro yields 0 ticks, so the task never blocks: the LED toggles as fast as the loop runs and the watchdog eventually complains', ok: true, why: 'One tick is 10 ms. 5 ms rounds down to 0 ticks, and a delay of 0 does not block. Delays shorter than a tick need a hardware timer or a higher tick rate.' },
        { t: 'The LED blinks with a 10 ms period, because delays round up to one tick', why: 'The conversion is an integer division, and integer division rounds towards zero.' },
        { t: 'The build fails because 5 ms is below the tick period', why: 'The macro is plain arithmetic on constants. Nothing checks it against the tick rate at build time.' },
      ] },
    { kind: 'circuit', q: 'With the active-high circuit running, you measure 3.25 V on GPIO18 and 1.93 V on the LED anode. What is the LED current?',
      choices: [
        { t: 'About 4.0 mA', ok: true, why: '(3.25 − 1.93) V / 330 Ω = 1.32 / 330 = 4.0 mA. Two voltage readings and a known resistor give a current without breaking the circuit.' },
        { t: 'About 9.8 mA', why: 'That is 3.25 V / 330 Ω, which ignores the voltage the LED keeps for itself.' },
        { t: 'About 5.8 mA', why: 'That is 1.93 V / 330 Ω. The resistor does not have 1.93 V across it; that is the LED voltage.' },
      ] },
    { kind: 'arch', q: 'Two tasks on different cores each control a different pin in GPIO0–31. Task A runs `REG_WRITE(GPIO_OUT_REG, REG_READ(GPIO_OUT_REG) | BIT(4))` while task B runs `gpio_set_level(18, 0)`. What can go wrong?',
      choices: [
        { t: 'Task A can read the register before B clears bit 18 and write it back afterwards, turning pin 18 on again', ok: true, why: 'A does read-modify-write on the whole latch. If B\'s single clear write lands between A\'s read and write, A restores the stale bit. Using the W1TS register in A removes the race.' },
        { t: 'Nothing: each task touches a different bit', why: 'They intend to touch different bits, but one of them writes all 32 bits of the latch.' },
        { t: 'The bus faults, because two cores cannot access one peripheral', why: 'Both cores can access the same peripheral registers; the bus serialises the accesses. The danger is in the order of those accesses.' },
      ] },
  ],
};

/* =====================================================================================
 * Project 2: Button input and debouncing
 * ===================================================================================== */
const P2_RAW = String.raw`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#define BTN_GPIO GPIO_NUM_19

static const char *TAG = "p2";

void app_main(void)
{
    const gpio_config_t btn_cfg = {
        .pin_bit_mask = 1ULL << BTN_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn_cfg));

    int last = -1;
    while (1) {
        int level = gpio_get_level(BTN_GPIO);
        if (level != last) {
            ESP_LOGI(TAG, "level %d", level);
            last = level;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}`;

const P2_COUNT = String.raw`#include <stdio.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#define BTN_GPIO GPIO_NUM_19

static const char *TAG = "p2";
static volatile uint32_t s_edges;      /* written in the ISR, read in the task */

static void btn_isr(void *arg)
{
    (void)arg;
    s_edges++;                         /* nothing else: no logging, no delays */
}

void app_main(void)
{
    const gpio_config_t btn_cfg = {
        .pin_bit_mask = 1ULL << BTN_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_ANYEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn_cfg));
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(BTN_GPIO, btn_isr, NULL));

    uint32_t last = 0;
    while (1) {
        uint32_t now = s_edges;
        if (now != last) {
            ESP_LOGI(TAG, "+%u edges (total %u)", (unsigned)(now - last), (unsigned)now);
            last = now;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}`;

const P2_POLL = String.raw`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#define LED_GPIO      GPIO_NUM_18
#define BTN_GPIO      GPIO_NUM_19
#define POLL_MS       10
#define STABLE_POLLS  3            /* 3 equal samples in a row = 30 ms of agreement */

static const char *TAG = "p2";

void app_main(void)
{
    const gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&led_cfg));

    const gpio_config_t btn_cfg = {
        .pin_bit_mask = 1ULL << BTN_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn_cfg));

    int stable = 1;        /* debounced level; 1 = released (pull-up) */
    int candidate = 1;     /* most recent raw level                   */
    int count = 0;         /* how many polls in a row it has held     */
    int presses = 0;
    int led = 0;

    while (1) {
        int raw = gpio_get_level(BTN_GPIO);
        if (raw != candidate) {
            candidate = raw;
            count = 0;
        } else if (count < STABLE_POLLS) {
            count++;
        }
        if (count == STABLE_POLLS && candidate != stable) {
            stable = candidate;
            if (stable == 0) {                       /* a debounced press */
                presses++;
                led = !led;
                gpio_set_level(LED_GPIO, led);
                ESP_LOGI(TAG, "press %d", presses);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
    }
}`;

const P2_FINAL = String.raw`#include <stdio.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#define LED_GPIO     GPIO_NUM_18
#define BTN_GPIO     GPIO_NUM_19
#define DEBOUNCE_MS  30

static const char *TAG = "p2";
static QueueHandle_t s_edge_q;

static void btn_isr(void *arg)
{
    (void)arg;
    int64_t t_us = esp_timer_get_time();
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(s_edge_q, &t_us, &woken);
    if (woken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

static void button_task(void *arg)
{
    (void)arg;
    int stable = 1, led = 0, presses = 0;
    int64_t first_us, t_us;

    while (1) {
        /* 1. Sleep, using no CPU, until the first edge arrives. */
        xQueueReceive(s_edge_q, &first_us, portMAX_DELAY);
        int edges = 1;
        t_us = first_us;

        /* 2. Keep absorbing edges until the line has been quiet for DEBOUNCE_MS. */
        while (xQueueReceive(s_edge_q, &t_us, pdMS_TO_TICKS(DEBOUNCE_MS)) == pdTRUE) {
            edges++;
        }

        /* 3. Only now look at the level: this is the settled state. */
        int level = gpio_get_level(BTN_GPIO);
        if (level != stable) {
            stable = level;
            if (level == 0) {
                presses++;
                led = !led;
                gpio_set_level(LED_GPIO, led);
            }
            ESP_LOGI(TAG, "%s: %d edge(s) over %d us, presses=%d",
                     level ? "released" : "pressed", edges, (int)(t_us - first_us), presses);
        }
    }
}

void app_main(void)
{
    s_edge_q = xQueueCreate(32, sizeof(int64_t));
    configASSERT(s_edge_q != NULL);

    const gpio_config_t led_cfg = {
        .pin_bit_mask = 1ULL << LED_GPIO,
        .mode         = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&led_cfg));

    const gpio_config_t btn_cfg = {
        .pin_bit_mask = 1ULL << BTN_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_ANYEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn_cfg));

    xTaskCreate(button_task, "button", 4096, NULL, 5, NULL);

    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(BTN_GPIO, btn_isr, NULL));
}`;

const P2_FIG = sch.open(470, 250, 'Schematic: push-button from GPIO19 to ground with the internal pull-up, optional series resistor and capacitor')
  + sch.box(20, 30, 130, 190, 'ESP32 DevKit', [[110, 'GPIO19'], [200, 'GND']])
  + sch.rail(210, 50, '3V3 (inside the chip)') + sch.wire('210,50 210,55') + `<g stroke-dasharray="4 3">` + sch.resV(210, 55, '', 12) + `</g>` + sch.txt(222, 78, 'internal pull-up', 'start', 'font-size="10"') + sch.txt(222, 90, 'enabled in software', 'start', 'font-size="10"')
  + sch.wire('210,105 210,110') + sch.dot(210, 110)
  + sch.wire('162,110 300,110', 'stroke="var(--sig2)"') + sch.dot(300, 110)
  + sch.wire('300,110 300,115') + sch.sw(300, 115, 'SW1') + sch.wire('300,155 300,200')
  + sch.wire('300,110 390,110', 'stroke="var(--sig2)" stroke-dasharray="4 3"') + `<g stroke-dasharray="4 3">` + sch.capV(390, 110, 90, 'C1 100 nF') + `</g>` + sch.txt(403, 172, '(optional, step 6)', 'start', 'font-size="10"')
  + sch.wire('162,200 390,200') + sch.dot(300, 200) + sch.gnd(300, 200)
  + sch.close;

const p2 = {
  id: 'esp-p2', title: 'Project 2: Button input and debouncing', kind: 'Project', minutes: 150,
  summary: 'Read a push-button three ways: raw, polled with a debounce filter, and by interrupt with a queue. Count the contact bounces yourself before you remove them.',
  skills: ['esp-pa-debounce', 'esp-pa-isr-queue'],
  objectives: [
    'Explain why an unconnected input reads random values and how a pull-up resistor defines the level.',
    'Observe and count contact bounce on your own button.',
    'Implement a polling debounce filter and state its response time.',
    'Implement an interrupt-driven design in which the ISR only queues an event and a task does the work.',
    'List what may and may not be done inside an interrupt handler, and why.',
    'Decide between polling and interrupts for a given requirement.',
  ],
  hardware: [
    'The ESP32 DevKit, breadboard and LED circuit from project 1 (LED and 330 Ω on GPIO18).',
    '1 × 6 mm tactile push-button (4 pins; the two pins on each long side are joined internally).',
    '2 jumper wires.',
    'Optional, step 6: 1 × 100 nF ceramic capacitor (marked 104) and 1 × 1 kΩ resistor. With the internal pull-up of a few tens of kΩ this gives a time constant of a few milliseconds, the same order as the bounce.',
    'Multimeter. A logic analyser is useful but not required.',
  ],
  software: ['ESP-IDF v6.1 and the project skeleton from project 1 (copy the directory, rename the project to `p2_button`).'],
  background: [
    `## A switch is not a logic signal

A push-button is two pieces of metal. Pressed, it connects two wires; released, it connects nothing. "Nothing" is the problem: a CMOS input draws almost no current, so an unconnected pin sits at whatever voltage stray charge and nearby signals leave on it. It may read 0, 1, or follow your hand as you wave it past the board.

A **pull-up resistor** fixes the released level: it connects the pin weakly to 3.3 V. The button connects the pin strongly to ground. Released, the pin reads 1. Pressed, it reads 0 and a small current flows through the resistor. This is "active-low" wiring, and it is the usual choice because the ESP32 has an internal pull-up on most pins that you can enable in software (check the datasheet's DC characteristics for its value; it is tens of kΩ, weak but enough for a short wire).

## Contacts bounce

When the metal contacts meet, they hit, rebound and hit again several times before resting. Electrically that is a burst of edges lasting somewhere between a fraction of a millisecond and several milliseconds, sometimes longer on worn or large switches. A microcontroller that can react in microseconds sees every one of them. Code that counts "presses" by counting falling edges will count one physical press as several.

Debouncing means deciding the button's state only when the input has stopped changing. There are two families:

- **Sample slowly and require agreement** (polling). Read the pin every 5–10 ms; accept a new state after N equal readings.
- **React to an edge, then wait for quiet** (interrupt). The first edge wakes you; you ignore further edges until none has arrived for a set time, then read the level.

Either can also be helped by an RC filter in hardware.`,
    { t: 'callout', kind: 'decision', md: `**Polling or interrupts?** Polling is simple, bounded and easy to reason about, and a 10 ms poll is far faster than a finger. It costs a wake-up every 10 ms forever, which matters on a battery. An interrupt costs nothing while the button is idle and can wake the chip from sleep, but it brings concurrency: code that runs between any two instructions of your program. Use polling unless you need low idle power, wake-from-sleep, or a timestamp more precise than the poll period.` },
    `## Rules inside an interrupt handler

An ISR runs with the interrupted task frozen mid-instruction. It must be short and must not block. In ESP-IDF that means: no \`ESP_LOGx\`/\`printf\`, no \`vTaskDelay\`, no mutexes, no FreeRTOS call whose name does not end in \`FromISR\`. The standard pattern is: record the minimum (a timestamp, a pin number), hand it to a task through a queue, return.

${PORTING}`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Wiring. The LED from project 1 stays on GPIO18.', text: String.raw`
From                         To                      Why
---------------------------  ----------------------  ---------------------------------------
DevKit GPIO19 (D19)          SW1, pin on side A      input; internal pull-up holds it high
SW1, pin on side B           DevKit GND              pressing connects GPIO19 to ground
(project 1) GPIO18 -> 330R -> LED -> GND             unchanged

Tactile switch: place it across the centre gap of the breadboard. The pins on the same
side of the gap as each other are the two contacts; use one pin from each side of the gap.
Check with the multimeter's continuity range: no beep released, beep when pressed.

Optional (step 6):  C1 100 nF from GPIO19 to GND, and R2 1 kohm between SW1 and GND.
` },
    { t: 'figure', svg: P2_FIG, caption: 'Released: the internal pull-up holds GPIO19 at 3.3 V. Pressed: SW1 pulls it to ground. C1 is the optional hardware filter.' },
    { t: 'widget', name: 'breadboard', props: { challenge: 'button-pullup' }, caption: 'Build the button and pull-up in simulation first (here with an external resistor, so you can see it).' },
    { t: 'widget', name: 'gpio-electrical', caption: 'Set the pin to input and switch between floating, pull-up and pull-down to see what defines the level.' },
  ],
  steps: [
    { title: 'Check the switch with a meter, then wire it', blocks: [
      `Before the switch goes near the board, put the multimeter on continuity and find which pin pairs are joined permanently and which pair closes when pressed. Wire it per the table.`,
      { t: 'predict', q: 'With the internal pull-up enabled and the button wired from GPIO19 to GND, what does `gpio_get_level(19)` return while you are **not** touching the button?',
        choices: [
          { t: '1', ok: true, why: 'Released, the only connection to the pin is the pull-up to 3.3 V, so it reads high. Pressed reads 0. The logic is inverted relative to "pressed = true", and your code must say so in one clear place.' },
          { t: '0', why: 'The pin would be low only if something connected it to ground. Released, the switch is an open circuit.' },
          { t: 'It varies', why: 'It would vary with no pull resistor at all. Here the pull-up provides a defined path to 3.3 V.' },
        ],
        reveal: 'Active-low inputs are normal. Name variables for meaning (`pressed`) rather than for voltage (`level`) as soon as you leave the driver layer.' },
    ] },
    { title: 'Read the raw level', blocks: [
      { t: 'code', lang: 'c', status: 'reviewed', code: P2_RAW, caption: 'main/main.c, version 1: log every change seen at a 10 ms poll' },
      `Flash and monitor. **You should see** \`level 1\` at start, \`level 0\` when you press, \`level 1\` when you release. Press 20 times and check for 40 lines. Most buttons give exactly 40 here, because a 10 ms poll rarely lands inside a bounce burst. Do not conclude that the button is clean; the next step looks properly.

**Measure.** DC volts from GPIO19 to GND: about 3.3 V released, about 0 V pressed.

Now change \`GPIO_PULLUP_ENABLE\` to \`GPIO_PULLUP_DISABLE\`, flash, and release the button. Touch the GPIO19 jumper's insulation, or bring your hand near it. **You should see** the level change with nothing pressed. That is a floating input. Put the pull-up back.`,
      { t: 'exercise', prompt: `**Debugging exercise A.** This version never detects the button reliably. The wiring is correct (continuity checked), but with the button released the multimeter shows a small, drifting voltage on GPIO19 instead of 3.3 V. Why?`,
        code: String.raw`const gpio_config_t btn_cfg = {
    .pin_bit_mask = BTN_GPIO,              /* BTN_GPIO is GPIO_NUM_19 */
    .mode         = GPIO_MODE_INPUT,
    .pull_up_en   = GPIO_PULLUP_ENABLE,
};
ESP_ERROR_CHECK(gpio_config(&btn_cfg));`,
        hints: ['A drifting voltage on a released pin means nothing is pulling it up. Was the pull-up really applied to GPIO19?', 'Write 19 in binary. Which bits are set?'],
        answer: { type: 'text', accept: ['mask', '1ULL', '<<', 'shift', 'bit ?mask'], nudge: 'Look at what kind of value pin_bit_mask expects.' },
        solution: `\`pin_bit_mask\` is a mask, and 19 is binary 10011: this configures GPIO0, GPIO1 and GPIO4 as inputs with pull-ups, and leaves GPIO19 untouched: no pull-up, so it floats when the button is released and reads whatever stray charge leaves on it. The fix is \`1ULL << BTN_GPIO\`.

Note the side effects: GPIO0 is a strapping pin and GPIO1 is the console's TX pin. Reconfiguring TX as an input can silence the log, which makes this bug look like a crash.` },
    ] },
    { title: 'Count the bounces', blocks: [
      `To see bounce you need something faster than a 10 ms poll. Let the hardware watch the pin: enable an interrupt on **any edge** and count how many times it fires.`,
      { t: 'predict', q: 'You press and release the button once, firmly. An ideal switch produces exactly 2 edges. What do you expect the counter to show for a real one?',
        reveal: `Typically more than 2, and a different number each time: 2, 4, 7, 3… Some presses are clean. Small tactile switches often bounce for well under a millisecond, larger or older switches for longer. The number also depends on how you press. Record ten presses in your notebook; that record is your evidence for choosing a debounce time.` },
      { t: 'code', lang: 'c', status: 'reviewed', code: P2_COUNT, caption: 'main/main.c, version 2: count edges in an ISR' },
      `**You should see**, every half second in which something happened, a line such as \`+5 edges (total 23)\`. Press slowly, quickly, and at an angle. If you never see more than 2 per press-and-release, your switch is unusually clean or the edges are faster than the pin can follow; try a different switch, or tap two bare jumper wires together as a very bouncy "switch".`,
      { t: 'callout', kind: 'note', md: `\`s_edges++\` in the ISR and the read in the task are safe here only because the task never writes the variable and a 32-bit read is a single instruction on this CPU. The moment both sides modify a variable you need a critical section or a queue. \`volatile\` tells the compiler the value can change behind its back; it does **not** make an operation atomic.` },
    ] },
    { title: 'Debounce by polling', blocks: [
      `Now build the first real solution. Sample every 10 ms and accept a new state only after three equal samples. Keep the LED: each debounced press toggles it, so a double-count is visible as "press did nothing".

Try to write the filter yourself first. You need three variables: the accepted state, the candidate state and a counter.`,
      { t: 'widget', name: 'state-machine', props: { machine: 'debounce' }, caption: 'Step a debounce state machine by hand before reading the C.' },
      { t: 'code', lang: 'c', status: 'reviewed', code: P2_POLL, caption: 'main/main.c, version 3: polling with a counting filter' },
      `**You should see** exactly one \`press N\` line and one LED toggle per press, for 50 presses in a row. If you get that, compute the response time: a press is accepted between 30 and 40 ms after contact. Nobody can feel that.`,
      { t: 'exercise', prompt: 'With `POLL_MS = 10` and `STABLE_POLLS = 3`, a noise spike pulls the line low for 12 ms. Can it be accepted as a press? Answer yes or no and explain.',
        hints: ['How many consecutive polls can fall inside a 12 ms window?'],
        answer: { type: 'text', accept: ['^\\s*no'], nudge: 'Count the polls that can land inside 12 ms and compare with what the filter needs.' },
        solution: `**No.** At most two polls (10 ms apart) can fall inside a 12 ms low pulse. The first low sample changes the candidate and sets the count to 0; the second raises it to 1; the next sample is high again and resets the candidate. The count never reaches 3. A pulse must be low at four consecutive sampling instants, that is for more than 30 ms, to be accepted.` },
    ] },
    { title: 'Debounce with an interrupt and a queue', blocks: [
      `The polling task wakes 100 times a second for a button pressed a few times an hour. The interrupt design sleeps until an edge arrives.

The plan: the ISR puts a timestamp in a queue. A task blocks on the queue with no timeout. When the first edge arrives it keeps receiving with a 30 ms timeout; each bounce edge restarts that wait. When the receive finally times out, the line has been quiet for 30 ms, and the task reads the settled level.`,
      { t: 'predict', q: 'The ISR sends to a queue of 32 entries. Suppose a faulty switch produces 100 edges in 2 ms. What happens to edges 33 to 100?',
        choices: [
          { t: '`xQueueSendFromISR` returns failure and those timestamps are dropped; the design still works because the task only needs to know that edges happened', ok: true, why: 'A full queue cannot block an ISR, so the call fails immediately. The task drains the queue, waits for quiet and reads the level, which is the only thing that decides the state.' },
          { t: 'The ISR blocks until the task makes room', why: 'An ISR cannot block: there is no task context to suspend. That is why the FromISR variants exist and return at once.' },
          { t: 'The queue grows to hold them', why: 'A FreeRTOS queue has the fixed length given at creation. Its storage is allocated once.' },
        ],
        reveal: 'Design ISR-to-task paths so that losing an event under overload degrades gracefully. Here the level read after the quiet period is the source of truth and the queue is only a wake-up signal.' },
      { t: 'code', lang: 'c', status: 'reviewed', code: P2_FINAL, caption: 'main/main.c, version 4: interrupt, queue and wait-for-quiet debounce' },
      `**You should see** lines such as \`pressed: 4 edge(s) over 380 us, presses=7\` and \`released: 2 edge(s) over 95 us, presses=7\`. The edge count and duration are your switch's bounce, now measured rather than assumed. One LED toggle per press, 50 presses in a row.

Compare with the polling version: between presses this task uses no CPU time at all.`,
      { t: 'exercise', prompt: `**Debugging exercise B.** To "see what the ISR is doing", someone adds a log line to it. On the first press the board prints a backtrace and reboots. Why?`,
        code: String.raw`static void btn_isr(void *arg)
{
    int64_t t_us = esp_timer_get_time();
    ESP_LOGI(TAG, "edge at %lld", (long long)t_us);     /* added for debugging */
    xQueueSendFromISR(s_edge_q, &t_us, NULL);
}`,
        hints: ['What does a log call need to do if another task is in the middle of printing?', 'What can an ISR not do when a lock is held by someone else?'],
        solution: `\`ESP_LOGI\` formats text and writes it to the console through the C library's stdio, which protects the output stream with a lock. Taking a lock may need to block, and an ISR cannot block: there is no task to suspend. ESP-IDF detects the attempt and aborts. Formatting also takes far too long and too much stack for interrupt context.

Debug an ISR by recording into a variable or queue and printing from a task (as the final program does with the timestamps), by toggling a spare GPIO and watching it on a logic analyser, or with \`ESP_EARLY_LOGI\`/\`ESP_DRAM_LOGE\`, which exist for this purpose (read their documentation for the restrictions).` },
    ] },
    { title: 'Optional: filter in hardware with an RC', blocks: [
      { t: 'widget', name: 'rc-circuit', props: { r: 47000, c: 1e-7, mode: 'debounce' }, caption: 'A bouncing switch through an RC filter. Change R and C and watch when the filtered line crosses the logic threshold.' },
      `Add C1 (100 nF) from GPIO19 to GND. On release the capacitor charges through the pull-up: with a pull-up of a few tens of kΩ the time constant τ = R·C is a few milliseconds, so short bounces no longer reach the logic threshold.

On press, the switch shorts the charged capacitor directly. That works, but the discharge current is limited only by the contact resistance. Adding R2 (1 kΩ) in series with the switch limits it and gives a controlled 0.1 ms fall. Check that the pressed level is still a solid low: R2 and the pull-up form a divider, and 1 kΩ against tens of kΩ leaves the pin at a few percent of 3.3 V.

Re-flash **version 2** (the edge counter). **You should see** the edge counts per press drop, typically to exactly 2.`,
      { t: 'callout', kind: 'warn', md: `An RC filter turns fast edges into slow ramps. A digital input that spends a long time near its threshold can produce several transitions of its own unless it has hysteresis (a Schmitt trigger). Check whether your chip's pins have hysteresis and whether it must be enabled (datasheet, DC characteristics and the IO_MUX chapter). This is why hardware filtering is normally used **together with** software debounce, not instead of it.` },
    ] },
    { title: 'Diagnose two more broken variants', blocks: [
      { t: 'exercise', prompt: `**Debugging exercise C.** The polling version is changed to sample faster, "for a snappier button". After flashing, presses are still detected but the monitor shows \`task_wdt: Task watchdog got triggered\` naming an idle task, and the debounce seems to have stopped working (double toggles). The only change is below. Explain both symptoms.`,
        code: String.raw`#define POLL_MS       2
#define STABLE_POLLS  3`,
        hints: ['What is the tick period in a default ESP-IDF configuration?', '`pdMS_TO_TICKS(2)` is integer arithmetic.'],
        solution: `The default tick rate is 100 Hz, so one tick is 10 ms and \`pdMS_TO_TICKS(2)\` is **0**. \`vTaskDelay(0)\` does not block, so the loop spins at full speed: the idle task starves (watchdog), and three "consecutive polls" now span a few microseconds, far shorter than a bounce, so the filter passes every bounce.

Fixes: keep the poll at one tick or more; or express the stable time in milliseconds using \`esp_timer_get_time()\` instead of counting polls; or raise the tick rate in menuconfig, accepting more scheduler overhead. A guard such as \`_Static_assert(pdMS_TO_TICKS(POLL_MS) > 0, "poll shorter than a tick")\` turns the mistake into a build error.` },
      { t: 'exercise', prompt: `**Debugging exercise D.** In version 4, someone moves the two ISR-installation lines to the top of \`app_main\`, before \`xQueueCreate\`. The board usually works, but occasionally crashes at power-up when the button happens to be held. Why?`,
        hints: ['What is the value of `s_edge_q` before `xQueueCreate` returns?', 'When can the first interrupt fire?'],
        solution: `An interrupt can fire the instant the handler is added. If an edge arrives before \`xQueueCreate\` has run, the ISR calls \`xQueueSendFromISR\` with a NULL handle and the kernel dereferences it. The rule is general: **create everything an ISR uses before enabling the interrupt**. The final program creates the queue first, then the task, and installs the handler last.` },
    ] },
  ],
  walkthrough: [
    { t: 'code', lang: 'c', status: 'reviewed', code: P2_FINAL, caption: 'Version 4, annotated',
      explain: [
        { lines: '18-27', md: 'The handler runs in interrupt context, called by the GPIO driver\'s shared ISR. That shared ISR reads the GPIO interrupt status register, finds which pins are pending, clears their status bits through the write-1-to-clear register and calls each registered handler.' },
        { lines: '21', md: '`esp_timer_get_time()` returns microseconds since boot from a 64-bit hardware timer. It is safe to call from an ISR.' },
        { lines: '23', md: 'Copies 8 bytes into the queue\'s storage. If that makes a higher-priority task ready, `woken` is set.' },
        { lines: '24-26', md: 'Requests a context switch on the way out of the interrupt, so `button_task` runs immediately instead of at the next tick. Without it, the response is delayed by up to one tick (10 ms).' },
        { lines: '37', md: '`portMAX_DELAY` blocks indefinitely. The task is on the queue\'s wait list and consumes no CPU time.' },
        { lines: '42-44', md: 'Each received edge restarts the 30 ms wait. `pdMS_TO_TICKS(30)` is 3 ticks, so the actual quiet period is between 20 and 30 ms depending on where in a tick the last edge fell.' },
        { lines: '47', md: 'Reads `GPIO_IN_REG` bit 19 (pins 32 and above are in a second register). This is the debounced value: the line has not moved for at least 20 ms.' },
        { lines: '77', md: '`GPIO_INTR_ANYEDGE` sets the interrupt-type field of GPIO19\'s pin register so that both rising and falling edges set its bit in the interrupt status register.' },
        { lines: '81', md: 'In ESP-IDF the stack depth is given in **bytes**. 4096 leaves room for the log formatting. Priority 5 is above `main` (1), so the button is handled promptly.' },
        { lines: '83', md: 'Allocates one CPU interrupt for the whole GPIO peripheral and attaches the driver\'s dispatcher to it. The argument is a set of interrupt allocation flags; 0 is the default.' },
        { lines: '84', md: 'Registers the handler in the dispatcher\'s table and enables the interrupt for this pin.' },
      ] },
    `**About \`IRAM_ATTR\`.** You will see ISRs in other code marked \`IRAM_ATTR\`. It places the function in internal RAM so that it can run while the flash cache is disabled (during flash writes). It is required when the interrupt is allocated with the \`ESP_INTR_FLAG_IRAM\` flag, and then everything the handler calls and reads must also be in RAM. With the default flags used here, the interrupt is simply postponed during flash operations, and the handler may live in flash.`,
  ],
  testing: [
    `| Check | How | You should see |
|---|---|---|
| Idle level | DC volts GPIO19 to GND, released | about 3.3 V |
| Pressed level | Same, button held | under 0.1 V (a few tens of mV more with R2 fitted) |
| Pull-up current | Multimeter on a mA/µA range **in place of** the button (probes on GPIO19 and GND) | some tens of µA; from it, compute the pull-up resistance as 3.3 V / I and compare with the datasheet |
| Bounce exists | Version 2, ten presses | at least some presses reporting more than 2 edges |
| Polling debounce | Version 3, 50 presses | \`press 50\` on the 50th; LED toggles each time |
| Interrupt debounce | Version 4, 50 presses | \`presses=50\`; edge counts vary, press count does not |
| Held button | Hold for 5 s | exactly one press event, one release event |
| Fast double tap | Two taps as fast as you can | two presses (if not, your debounce time is too long for your fingers; measure the gap from the log) |

**With a logic analyser:** channel 0 on GPIO19, channel 1 on GPIO18 (LED). Trigger on a falling edge of channel 0, sample at 1 MHz or more. You should see the bounce burst on channel 0 and, 20–30 ms after its last edge, a single transition on channel 1. Measure that delay with the cursors and compare it with \`DEBOUNCE_MS\` and the tick period.`,
  ],
  troubleshooting: [
    { symptom: 'Level changes when nothing is pressed, or when you move your hand', cause: 'Floating input: pull-up not enabled, or the configuration was applied to a different pin (mask bug).', fix: 'Check `pull_up_en` and that `pin_bit_mask` is `1ULL << pin`. Measure the released pin: it must be near 3.3 V.' },
    { symptom: 'Always reads 0', cause: 'Switch inserted rotated by 90°, so the permanently joined pins bridge GPIO19 to GND.', fix: 'Continuity-test the switch out of circuit; use one pin from each side of the breadboard gap.' },
    { symptom: 'Always reads 1; meter shows 3.3 V even when pressed', cause: 'Switch wired to two pins that are the same contact, or the ground jumper is in the wrong row.', fix: 'Continuity from GPIO19 to GND while holding the button must beep.' },
    { symptom: 'One press toggles the LED twice or not at all', cause: 'Bounce is getting through: debounce time shorter than the bounce, or the delay evaluates to 0 ticks.', fix: 'Print the edge durations from version 4 and set the debounce time above the longest one. Check `pdMS_TO_TICKS()` is not 0.' },
    { symptom: 'Crash with a backtrace on the first press', cause: 'Blocking or logging call inside the ISR, or the queue is still NULL when the ISR runs.', fix: 'Keep only `...FromISR` calls in the handler; create the queue before adding the handler.' },
    { symptom: '`gpio_install_isr_service` returns an error about an invalid state', cause: 'The service was installed twice (for example by another component).', fix: 'Install it once at start-up; treat the "already installed" result as acceptable if a library you use installs it too.' },
    { symptom: 'Interrupt never fires on a pin in GPIO34–39', cause: 'Those pins on the original ESP32 have no internal pull resistors, so the pin floats or stays low.', fix: 'Add an external 10 kΩ pull-up to 3.3 V, or use a pin that has internal pulls.' },
    { symptom: 'Presses are detected up to 10 ms late in the interrupt version', cause: 'The ISR does not request a context switch, so the task runs at the next tick.', fix: 'Pass a `BaseType_t` to `xQueueSendFromISR` and call `portYIELD_FROM_ISR()` when it is set.' },
  ],
  challenge: `**Short press, long press, double press.** No solution is given.

Extend version 4 so that the button produces three distinct events: a short press (under 400 ms), a long press (held 1 s or more, reported *while still held*, at the 1 s mark), and a double press (two short presses with under 300 ms between them). Show each on the LED differently.

Requirements: the ISR stays as it is; all timing uses the timestamps and queue timeouts, with no polling loop; a long press must not also produce a short press on release; and a double press must not also produce two short presses.

Before coding, draw the state machine on paper with every state, event and timeout. In your notebook, state the cost of supporting double presses: how long after a single short press must the system wait before it can report it, and why is that unavoidable?`,
  quiz: [
    { kind: 'circuit', q: 'The button is rewired from GPIO19 to **3V3** instead of to GND, with the internal pull-up still enabled. What does the firmware see?',
      choices: [
        { t: 'The pin reads 1 whether the button is pressed or not', ok: true, why: 'Released, the pull-up holds it high. Pressed, the switch also connects it to 3.3 V. There is no state in which anything pulls it low. For a button to 3V3 you need a pull-down.' },
        { t: 'The logic is simply inverted: pressed reads 1, released reads 0', why: 'For released to read 0, something must pull the pin to ground when the switch is open. With a pull-up, nothing does.' },
        { t: 'Pressing it shorts the supply', why: 'A short needs a path from 3.3 V to ground. Pressing connects 3.3 V to a pin that is already pulled to 3.3 V; no current flows.' },
      ] },
    { kind: 'code', q: 'In the polling filter, `STABLE_POLLS` is 3 and the poll period is 10 ms. A user reports that very quick taps are sometimes missed. Which change addresses that without letting bounce through, given that the measured bounce never exceeds 2 ms?',
      choices: [
        { t: 'Reduce `STABLE_POLLS` to 2', ok: true, why: 'Two equal samples 10 ms apart still span far more than a 2 ms bounce burst, and the minimum press length that can be accepted drops from just over 30 ms to just over 20 ms.' },
        { t: 'Reduce the poll period to 1 ms and keep `STABLE_POLLS` at 3', why: 'With a 10 ms tick, a 1 ms delay becomes 0 ticks: the loop no longer blocks and three samples span microseconds, which is shorter than a bounce.' },
        { t: 'Increase `STABLE_POLLS` to 6', why: 'That makes the filter demand a longer steady press, so quick taps are rejected more often, not less.' },
      ] },
    { kind: 'concept', q: 'Why does the ISR send to a queue instead of toggling the LED and incrementing `presses` itself?',
      choices: [
        { t: 'Because the ISR fires on every bounce edge and cannot wait to see whether the line settles; waiting is a task\'s job', ok: true, why: 'Debouncing needs time to pass, and an ISR must return quickly. The task can block on the queue with a timeout, which is the "wait for quiet" operation.' },
        { t: 'Because `gpio_set_level` is forbidden in an ISR', why: 'It is a single register write and is allowed in interrupt context. The reason lies in what debouncing requires, not in that call.' },
        { t: 'Because ISRs cannot access global variables', why: 'They can, and the edge-counting version does. Sharing needs care, but it is not prohibited.' },
      ] },
    { kind: 'concept', q: 'What would happen if `portYIELD_FROM_ISR()` were removed from the handler?',
      choices: [
        { t: 'It still works, but the button task may start up to one tick later, when the scheduler next runs', ok: true, why: 'The queue send makes the task ready. Without the yield request, the interrupted task resumes and the switch happens at the next tick interrupt or blocking call.' },
        { t: 'The queue send fails', why: 'The item is copied into the queue before the yield is considered. The yield affects only when the receiver runs.' },
        { t: 'The interrupt is never cleared and fires forever', why: 'The GPIO driver clears the interrupt status before calling your handler. Yielding has nothing to do with acknowledging the interrupt.' },
      ] },
    { kind: 'circuit', q: 'You add a 100 nF capacitor from the input to ground and rely on a 45 kΩ pull-up (a value you measured). Roughly how long after release does the pin take to rise to about 63% of 3.3 V?',
      choices: [
        { t: 'About 4.5 ms', ok: true, why: 'τ = R·C = 45 000 Ω × 100 × 10⁻⁹ F = 4.5 ms, and one time constant is the 63% point.' },
        { t: 'About 0.45 ms', why: 'Check the powers of ten: 45 kΩ is 4.5 × 10⁴ Ω and 100 nF is 10⁻⁷ F.' },
        { t: 'About 45 ms', why: 'That would need 1 µF. 100 nF is ten times smaller.' },
      ] },
    { kind: 'arch', q: 'A battery sensor wakes once a day or when its button is pressed. Which input design fits, and why?',
      choices: [
        { t: 'Interrupt-driven, because the CPU can stay asleep until an edge occurs', ok: true, why: 'A polling loop must wake every few milliseconds for ever, which dominates the energy budget of a device that otherwise sleeps all day.' },
        { t: 'Polling at 10 ms, because it is simpler and equally efficient', why: 'It is simpler, but 8.6 million wake-ups a day to catch a handful of presses is not equally efficient.' },
        { t: 'Polling at 1 s to save power', why: 'A press shorter than a second would be missed entirely, and the device still wakes 86 400 times a day.' },
      ] },
  ],
};

/* =====================================================================================
 * Project 3: PWM-controlled LED and motor
 * ===================================================================================== */
const P3_STATIC = String.raw`#include <stdio.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/ledc.h"
#include "esp_err.h"
#include "esp_log.h"

#define LED_GPIO      18
#define PWM_MODE      LEDC_LOW_SPEED_MODE
#define LED_TIMER     LEDC_TIMER_0
#define LED_CHANNEL   LEDC_CHANNEL_0
#define LED_RES_BITS  13
#define LED_FREQ_HZ   5000
#define LED_DUTY_MAX  ((1U << LED_RES_BITS) - 1U)        /* 8191 */

static const char *TAG = "p3";

void app_main(void)
{
    const ledc_timer_config_t timer_cfg = {
        .speed_mode      = PWM_MODE,
        .duty_resolution = LEDC_TIMER_13_BIT,
        .timer_num       = LED_TIMER,
        .freq_hz         = LED_FREQ_HZ,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer_cfg));

    const ledc_channel_config_t ch_cfg = {
        .gpio_num   = LED_GPIO,
        .speed_mode = PWM_MODE,
        .channel    = LED_CHANNEL,
        .timer_sel  = LED_TIMER,
        .duty       = 0,
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&ch_cfg));

    uint32_t duty = LED_DUTY_MAX / 4;                     /* 25 % */
    ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, LED_CHANNEL, duty));
    ESP_ERROR_CHECK(ledc_update_duty(PWM_MODE, LED_CHANNEL));
    ESP_LOGI(TAG, "duty %u of %u", (unsigned)duty, (unsigned)LED_DUTY_MAX);

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}`;

const P3_RAMP = String.raw`    /* replaces everything from "uint32_t duty = ..." to the end of app_main */
    while (1) {
        for (int pct = 0; pct <= 100; pct++) {
            uint32_t duty = (LED_DUTY_MAX * (uint32_t)pct) / 100U;
            ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, LED_CHANNEL, duty));
            ESP_ERROR_CHECK(ledc_update_duty(PWM_MODE, LED_CHANNEL));
            vTaskDelay(pdMS_TO_TICKS(20));
        }
        for (int pct = 100; pct >= 0; pct--) {
            uint32_t duty = (LED_DUTY_MAX * (uint32_t)pct) / 100U;
            ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, LED_CHANNEL, duty));
            ESP_ERROR_CHECK(ledc_update_duty(PWM_MODE, LED_CHANNEL));
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }`;

const P3_FADE = String.raw`    /* replaces the software ramp loop */
    ESP_ERROR_CHECK(ledc_fade_func_install(0));
    while (1) {
        ESP_ERROR_CHECK(ledc_set_fade_time_and_start(PWM_MODE, LED_CHANNEL, LED_DUTY_MAX, 2000, LEDC_FADE_WAIT_DONE));
        ESP_ERROR_CHECK(ledc_set_fade_time_and_start(PWM_MODE, LED_CHANNEL, 0, 2000, LEDC_FADE_WAIT_DONE));
    }`;

const P3_MOTOR = String.raw`#include <stdio.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/ledc.h"
#include "esp_err.h"
#include "esp_log.h"

#define MOTOR_GPIO      23
#define PWM_MODE        LEDC_LOW_SPEED_MODE
#define MOTOR_TIMER     LEDC_TIMER_1
#define MOTOR_CHANNEL   LEDC_CHANNEL_1
#define MOTOR_RES_BITS  10
#define MOTOR_FREQ_HZ   20000
#define MOTOR_DUTY_MAX  ((1U << MOTOR_RES_BITS) - 1U)     /* 1023 */

static const char *TAG = "p3";

static void motor_set_percent(int pct)
{
    if (pct < 0)   pct = 0;
    if (pct > 100) pct = 100;
    uint32_t duty = (MOTOR_DUTY_MAX * (uint32_t)pct) / 100U;
    ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, MOTOR_CHANNEL, duty));
    ESP_ERROR_CHECK(ledc_update_duty(PWM_MODE, MOTOR_CHANNEL));
}

void app_main(void)
{
    const ledc_timer_config_t timer_cfg = {
        .speed_mode      = PWM_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num       = MOTOR_TIMER,
        .freq_hz         = MOTOR_FREQ_HZ,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer_cfg));

    const ledc_channel_config_t ch_cfg = {
        .gpio_num   = MOTOR_GPIO,
        .speed_mode = PWM_MODE,
        .channel    = MOTOR_CHANNEL,
        .timer_sel  = MOTOR_TIMER,
        .duty       = 0,                 /* start stopped */
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&ch_cfg));

    while (1) {
        for (int pct = 0; pct <= 100; pct += 5) {         /* soft start */
            motor_set_percent(pct);
            ESP_LOGI(TAG, "motor %d %%", pct);
            vTaskDelay(pdMS_TO_TICKS(400));
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
        for (int pct = 100; pct >= 0; pct -= 5) {
            motor_set_percent(pct);
            vTaskDelay(pdMS_TO_TICKS(200));
        }
        ESP_LOGI(TAG, "stopped");
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}`;

const P3_FIG = sch.open(540, 260, 'Schematic: GPIO23 drives the gate of an N-channel MOSFET that switches a DC motor on its own supply, with a flyback diode across the motor')
  + sch.box(20, 30, 130, 200, 'ESP32 DevKit', [[130, 'GPIO23'], [210, 'GND']])
  + sch.wire('162,130 175,130', 'stroke="var(--sig1)"') + sch.resH(175, 130, 'R1 220 Ω') + sch.wire('225,130 262,130', 'stroke="var(--sig1)"')
  + sch.dot(240, 130) + sch.wire('240,130 240,150') + sch.resV(240, 150, 'R2 100 kΩ', -12) + sch.wire('240,200 240,210') + sch.dot(240, 210)
  + sch.nmos(262, 130, 'Q1') + sch.wire('304,156 304,210') + sch.dot(304, 210)
  + sch.wire('304,104 304,85') + sch.dot(304, 85) + sch.motor(304, 40, 'M1') + sch.wire('304,85 304,80') + sch.wire('304,40 304,30') + sch.dot(304, 30)
  + sch.wire('304,85 380,85 380,78') + sch.diode(380, 38, 'up', 'D1') + sch.wire('380,38 380,30') + sch.dot(380, 30)
  + sch.txt(394, 76, 'flyback', 'start', 'font-size="10"')
  + sch.wire('304,30 500,30', 'stroke="var(--sig3)"') + sch.dot(440, 30) + sch.capV(440, 30, 180, 'C1 220 µF') + sch.dot(440, 210)
  + sch.wire('500,30 500,112') + sch.wire('488,112 512,112') + sch.wire('494,120 506,120', 'stroke-width="3"') + sch.wire('488,128 512,128') + sch.wire('494,136 506,136', 'stroke-width="3"') + sch.wire('500,136 500,210')
  + sch.txt(516, 108, '+', 'start') + sch.txt(455, 150, 'BT1', 'start') + sch.txt(455, 163, 'motor supply', 'start', 'font-size="10"')
  + sch.wire('162,210 500,210') + sch.gnd(304, 210) + sch.txt(170, 226, 'common ground: logic GND and motor supply −', 'start', 'font-size="10"')
  + sch.close;

const p3 = {
  id: 'esp-p3', title: 'Project 3: PWM-controlled LED and motor', kind: 'Project', minutes: 180,
  summary: 'Use the LEDC peripheral to dim an LED, then drive a small DC motor through a MOSFET with a flyback diode and its own supply. Learn why frequency and resolution trade against each other.',
  skills: ['esp-pa-ledc', 'esp-pa-mosfet-driver'],
  objectives: [
    'Explain how PWM produces an adjustable average from a pin that can only be fully on or fully off.',
    'Configure an LEDC timer and channel, and compute the highest duty resolution available at a given frequency.',
    'Choose a PWM frequency for an LED and for a motor, with reasons.',
    'Build a low-side N-MOSFET switch, and explain the purpose of the gate resistor, the gate pull-down, the flyback diode, the bulk capacitor and the common ground.',
    'Explain why a motor must not be powered from the 3.3 V pin or a GPIO.',
  ],
  hardware: [
    'ESP32 DevKit, breadboard, and the LED with 330 Ω on GPIO18 from project 1.',
    '1 × small brushed DC motor rated 3–6 V (a "130-size" hobby motor is typical). Find or measure its stall current: you need it to choose the transistor and diode.',
    '1 × logic-level N-channel MOSFET. The requirement is that the datasheet specifies R_DS(on) at V_GS = 2.5 V (or lower), with a drain current rating above the motor stall current. Parts sold as "logic level" but specified only at V_GS = 4.5 V or 5 V are marginal from a 3.3 V pin. Read the *R_DS(on) versus V_GS* table before buying.',
    '1 × Schottky diode rated at least the motor stall current and the supply voltage (a 1 A, 40 V part such as 1N5819 is a common choice). Schottky because it turns on fast and drops little voltage; a slow rectifier works less well at 20 kHz.',
    '1 × 220 Ω resistor (gate series): limits the current pulse that charges the gate capacitance and damps ringing.',
    '1 × 100 kΩ resistor (gate pull-down): keeps the MOSFET off while the GPIO is floating at reset. 10 kΩ also works.',
    '1 × 220 µF electrolytic capacitor, 16 V or more (motor supply bulk capacitor) and 1 × 100 nF ceramic soldered or clipped directly across the motor terminals (suppresses brush noise).',
    'Separate motor supply: a 2 × AA or 4 × AA battery holder matched to the motor voltage, or a bench supply with a current limit.',
    'Multimeter. A logic analyser or oscilloscope helps for the frequency measurements.',
  ],
  software: ['ESP-IDF v6.1; copy the project skeleton to `p3_pwm`.'],
  background: [
    `## An average from a switch

A GPIO has two output states. To make an LED half as bright or a motor run at half speed you switch it on and off faster than the load can follow, and vary the fraction of time it is on. That fraction is the **duty cycle**; the repetition rate is the **PWM frequency**. An LED flickering at 5 kHz looks steadily dim because your eye averages it. A motor's inductance and inertia average the current and speed.

## How LEDC generates it

LEDC is a counter and a comparator. A **timer** counts from 0 to 2ⁿ − 1 at a rate derived from a source clock, then wraps. n is the duty resolution in bits. A **channel** drives its pin high when the counter passes \`hpoint\` and low when it has been high for \`duty\` counts. Several channels can share one timer and therefore one frequency.

The counter must make 2ⁿ steps per PWM period, so

\`f_pwm × 2ⁿ ≤ f_clock\`

With an 80 MHz source clock (the APB clock on the original ESP32; other chips and clock sources differ, see the LEDC page of the ESP-IDF docs for your chip), 5 kHz allows up to 13 bits (80 000 000 / 5000 = 16 000 ≥ 8192) and 20 kHz allows up to 11 bits (4000 ≥ 2048). Ask for more and \`ledc_timer_config\` returns an error.`,
    { t: 'widget', name: 'pwm-lab', props: { freq: 5000, duty: 25, bits: 13 }, caption: 'Change frequency and resolution and watch the limit appear.' },
    { t: 'callout', kind: 'decision', md: `**Which frequency?** *LED:* anything above a few hundred Hz hides flicker from the eye, but cameras and moving eyes still catch it; 1–5 kHz is a common choice and still leaves 13 bits of resolution. *Motor:* below about 20 kHz the windings act as a loudspeaker and the motor whines at the PWM frequency. 20 kHz is just above hearing. Higher still wastes energy: every switching edge spends time with the MOSFET half-on, and those losses grow with frequency.` },
    `## Why a transistor, and why these extra parts

A small motor draws hundreds of milliamps running and often more than an amp stalled or starting. A GPIO supplies a few. So the GPIO only *controls* a switch that carries the motor current. An N-channel MOSFET between the motor and ground (a **low-side switch**) turns on when its gate is a few volts above its source, and the source is at ground, so a 3.3 V pin can drive it directly if the MOSFET is a logic-level type.

- **Flyback diode.** A motor winding is an inductor, and an inductor's current cannot stop instantly. When the MOSFET turns off, the winding raises the drain voltage as high as it must to keep the current flowing, easily tens of volts, which destroys the MOSFET. A diode across the motor, cathode to the positive supply, gives that current a path: it circulates through the diode and decays. With PWM this happens on every cycle.
- **Gate pull-down.** From reset until your code configures the pin, the GPIO floats. A floating gate can sit at any voltage, so the motor may run at power-up. 100 kΩ to ground holds it off.
- **Gate resistor.** The gate is a capacitor. Charging it from a pin is a brief current spike; 220 Ω limits it to about 15 mA peak and damps ringing on the gate wire.
- **Separate supply, common ground.** Motor current spikes on the 3.3 V rail make the ESP32 brown out and reset. Give the motor its own supply. The grounds must still be joined: the gate voltage is measured relative to the MOSFET's source, so without a common ground the pin has no defined effect on the gate.
- **Bulk capacitor.** Supplies the current peaks locally so that the battery leads' resistance and inductance do not turn them into voltage dips.`,
    { t: 'callout', kind: 'warn', title: 'Current limits and safety', md: `${CURRENT_NOTE} Never connect a motor to a GPIO or to the DevKit's 3V3 pin. Secure the motor before it runs, keep fingers and hair away from the shaft, and unplug the motor supply while rewiring.` },
    `${PORTING} LEDC exists on all three chips. \`LEDC_LOW_SPEED_MODE\` is used here because it is the only mode the S3 and C3 have.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Wiring for the motor stage. Hold the MOSFET with its markings facing you and read the pin order from ITS datasheet: it differs between parts.', text: String.raw`
From                          To                            Why
----------------------------  ----------------------------  ---------------------------------------
DevKit GPIO23                 R1 220 ohm, lead A            PWM signal
R1 220 ohm, lead B            Q1 gate                       limits the gate charging current
Q1 gate                       R2 100 kohm -> GND            holds Q1 off while GPIO23 floats
Q1 source                     GND rail                      low-side switch: source at ground
Q1 drain                      motor terminal B              Q1 completes the motor's path to ground
Motor terminal A              motor supply +                motor gets the full supply voltage
D1 cathode (striped end)      motor supply + (terminal A)   flyback path; cathode to +, or it shorts
D1 anode                      Q1 drain (terminal B)
C1 220 uF +                   motor supply +                local reservoir; observe polarity
C1 220 uF -                   GND rail
C2 100 nF                     across the motor terminals    brush-noise suppression
Motor supply -                GND rail                      COMMON GROUND with the DevKit
DevKit GND                    GND rail

Do NOT connect motor supply + to any DevKit pin.
` },
    { t: 'figure', svg: P3_FIG, caption: 'Low-side MOSFET switch. When Q1 turns off, the motor current continues through D1 instead of forcing the drain voltage up.' },
    { t: 'widget', name: 'transistor-switch', props: { type: 'nmos', challenge: 'motor' }, caption: 'Build the same stage in simulation. Remove the flyback diode there, not on your bench.' },
  ],
  steps: [
    { title: 'A fixed 25 % duty on the LED', blocks: [
      `Start with the LED from project 1: it is a safe load and you can see the result.`,
      { t: 'predict', q: 'The pin will be high 25 % of the time at 5 kHz. A multimeter on DC volts is connected from GPIO18 to GND. What will it read?',
        choices: [
          { t: 'About 0.8 V', ok: true, why: 'A DC meter averages over many cycles: 25 % of 3.3 V is about 0.83 V. The pin itself is never at 0.8 V; it is at 3.3 V a quarter of the time and 0 V otherwise.' },
          { t: 'About 3.3 V, because the meter catches the peaks', why: 'A DC voltmeter integrates over a fraction of a second, thousands of PWM cycles. It cannot follow a 5 kHz signal.' },
          { t: 'It jumps between 0 V and 3.3 V', why: 'That is what you saw at 1 Hz in project 1. At 5 kHz the changes are far faster than the meter updates.' },
        ],
        reveal: 'This gives you a way to check a duty cycle with nothing but a multimeter: V_avg / 3.3 V. It works on the pin. Across the LED it does not scale linearly, because the LED voltage is roughly constant whenever it conducts.' },
      { t: 'code', lang: 'c', status: 'reviewed', code: P3_STATIC, caption: 'main/main.c, version 1: fixed duty' },
      `**You should see** the LED clearly dimmer than full on, with no visible flicker, and \`duty 2047 of 8191\` in the log. **Measure** GPIO18 to GND on DC volts: about 0.8 V. Change the duty to one half and three quarters, re-flash, and record the meter reading each time. Plot the three points; they should lie on a straight line through zero.

Wave the board quickly from side to side in a dim room. You should see a dotted trail rather than a continuous streak: that is the PWM, made visible by movement.`,
      { t: 'exercise', prompt: `**Debugging exercise A.** This program is meant to set 50 % duty but the LED stays off, with no error in the log. What is missing?`,
        code: String.raw`ESP_ERROR_CHECK(ledc_timer_config(&timer_cfg));
ESP_ERROR_CHECK(ledc_channel_config(&ch_cfg));          /* .duty = 0 */
ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, LED_CHANNEL, LED_DUTY_MAX / 2));
ESP_LOGI(TAG, "duty set");`,
        hints: ['Compare with version 1, line by line, after the channel configuration.', 'Why might hardware want a new duty value to take effect only at a chosen moment?'],
        answer: { type: 'text', accept: ['update', 'ledc_update_duty'], nudge: 'One call from version 1 is absent.' },
        solution: `\`ledc_update_duty()\` is missing. \`ledc_set_duty\` only stores the new value; \`ledc_update_duty\` tells the hardware to load it. The peripheral applies the new duty at the start of a PWM period, so the output never contains a truncated or stretched pulse. The two-step design also lets you prepare several channels and update them together.` },
    ] },
    { title: 'Fade in software, then let the hardware do it', blocks: [
      `Replace the fixed duty with a ramp from 0 to 100 % and back, one percent every 20 ms.`,
      { t: 'code', lang: 'c', status: 'reviewed', code: P3_RAMP, caption: 'Version 2: software ramp (fragment; the configuration above it is unchanged)' },
      `**You should see** the LED breathe with a 4 s period. Look closely at the dim end: brightness seems to rise quickly at first and then hardly change over the upper half. Your eye responds roughly logarithmically, so equal duty steps are not equal brightness steps. The challenge at the end returns to this.

LEDC can also ramp the duty itself, in hardware, so the CPU is not involved between the start and end points:`,
      { t: 'code', lang: 'c', status: 'reviewed', code: P3_FADE, caption: 'Version 3: hardware fade (fragment)' },
      `**You should see** a smoother fade: the hardware steps through every duty value its resolution allows instead of 100 coarse steps.`,
      { t: 'exercise', prompt: 'The LED timer runs at 5 kHz from an 80 MHz clock. What is the largest whole number of bits of duty resolution it can have?',
        hints: ['The counter needs 2ⁿ clock ticks per PWM period.', '80 000 000 / 5000 = 16 000. Which power of two fits?'],
        answer: { type: 'number', value: 13, tol: 0 },
        solution: `80 000 000 / 5000 = 16 000 clock ticks per period. 2¹³ = 8192 fits; 2¹⁴ = 16 384 does not. So **13 bits**. The driver gets the exact frequency by using a fractional clock divider (here 16 000 / 8192 ≈ 1.95).` },
    ] },
    { title: 'Build the MOSFET stage and test it without PWM', blocks: [
      `Unplug USB and the motor supply. Build the motor stage from the wiring table. Before connecting the motor supply, check with the multimeter:

- Continuity between DevKit GND and motor-supply negative: **beep** (common ground).
- Resistance from Q1 gate to GND: about 100 kΩ.
- Diode range across D1: one direction shows a few hundred mV, the other shows open. The striped end goes to motor supply +.

Now a test with no firmware involved. Leave the R1 lead that goes to GPIO23 unconnected. Connect the motor supply. The motor must be **off** (the pull-down holds the gate low). Touch the free R1 lead to the DevKit's 3V3 pin: the motor must **run**. Remove it: the motor stops.`,
      { t: 'predict', q: 'During that test, with the gate at 3.3 V and the motor running, you measure the voltage from Q1 drain to ground. What tells you the MOSFET is properly on?',
        choices: [
          { t: 'A small drain voltage, typically well under 0.2 V', ok: true, why: 'A fully enhanced MOSFET looks like a small resistance, so V_DS = I × R_DS(on) is small and almost all the supply voltage is across the motor. If you measure half a volt or more, the gate drive is too low for this part and it will run hot.' },
          { t: 'A drain voltage equal to the supply voltage', why: 'That is what you see when the MOSFET is off: no current, so no drop across the motor, and the drain sits at the supply.' },
          { t: 'A drain voltage of exactly 3.3 V, matching the gate', why: 'The gate controls the channel; it does not set the drain voltage. The drain voltage is whatever the motor current drops across the channel resistance.' },
        ],
        reveal: 'Measure it and write it down. From V_DS and the motor current you can estimate R_DS(on) and compare it with the datasheet figure at V_GS near 3.3 V. Touch the MOSFET after 30 s: it should be barely warm.' },
      { t: 'exercise', prompt: `**Debugging exercise B.** On another bench the same test fails in a specific way: with the gate lead on 3V3 the motor does not move, and the multimeter reads 0 V between the Q1 gate and the Q1 source. Yet it reads 3.3 V between the gate and the DevKit's GND pin. What is wrong?`,
        hints: ['The MOSFET responds to gate voltage measured relative to its own source.', 'What connects the DevKit GND pin to the Q1 source?'],
        answer: { type: 'text', accept: ['ground', 'gnd', 'common'], nudge: 'Two measurements with different reference points disagree. What should join those reference points?' },
        solution: `There is **no common ground**. The Q1 source is on the motor supply's negative terminal, and nothing connects that to the DevKit's GND. The two supplies float relative to each other, so "3.3 V on the gate" has no defined meaning at the MOSFET. Connect motor-supply negative to DevKit GND. (The meter reads 0 V gate-to-source because its own input resistance and R2 pull the two floating circuits together.)` },
    ] },
    { title: 'Drive the motor with 20 kHz PWM', blocks: [
      `Connect the R1 lead to GPIO23. The motor uses its own LEDC timer and channel so that it can run at a different frequency from the LED.`,
      { t: 'code', lang: 'c', status: 'reviewed', code: P3_MOTOR, caption: 'main/main.c, version 4: motor soft start and stop' },
      `**You should see** the log count up in 5 % steps. The motor will not move for the first few steps, then start and speed up to full speed, hold, slow down and stop. Note the percentage at which it first turns: below that the average current cannot overcome static friction. Note also that it keeps turning at a *lower* percentage on the way down than it needed to start. Record both.

**Measure:**
- DC volts across the motor terminals at 25, 50 and 75 %. You should see it rise with duty, though not exactly in proportion (the motor generates its own voltage while coasting).
- DC volts from the DevKit 3V3 pin to GND while the motor starts. It should stay steady. If it dips, your grounds share a thin wire with the motor current: move the motor-supply ground connection close to the MOSFET source.`,
      { t: 'exercise', prompt: `**Debugging exercise C.** To get finer speed control, someone changes the motor timer to 13 bits and keeps 20 kHz. The board now reboots in a loop, printing an LEDC error and then \`abort()\`. Explain, and give the largest resolution that works at 20 kHz from an 80 MHz clock.`,
        code: String.raw`.duty_resolution = LEDC_TIMER_13_BIT,
.freq_hz         = 20000,`,
        hints: ['Apply f_pwm × 2ⁿ ≤ f_clock.'],
        answer: { type: 'number', value: 11, tol: 0, unit: 'bits' },
        solution: `20 000 × 8192 = 163.84 MHz, which is more than the 80 MHz source clock: the counter cannot count 8192 steps in 50 µs. \`ledc_timer_config\` returns an error saying the requested frequency and resolution cannot be achieved, and \`ESP_ERROR_CHECK\` aborts. 80 000 000 / 20 000 = 4000 ticks per period, so 2¹¹ = 2048 fits and 2¹² does not: **11 bits** at most. For a motor, 10 bits (0.1 % steps) is already far finer than the mechanics can resolve.` },
    ] },
    { title: 'See why the supply is separate and the diode is there', blocks: [
      `Two reasoning exercises about faults you should **not** create on your bench.`,
      { t: 'exercise', prompt: `**Debugging exercise D.** A learner has no battery holder and powers a 3 V motor from the DevKit's 3V3 pin "just to try". The MOSFET stage is otherwise correct. Each time the motor starts, the monitor shows a line containing \`Brownout detector was triggered\` and the boot log repeats. Explain the chain of cause and effect.`,
        hints: ['What is the motor current at the instant it starts from rest, compared with running?', 'What supplies the 3.3 V rail on a DevKit, and how much current can it deliver?'],
        solution: `A stationary motor generates no back-EMF, so at start it draws its stall current, often several times its running current. The DevKit's 3.3 V rail comes from a small regulator fed by USB that also has to supply the ESP32 (check the regulator's datasheet for its limit). The motor's start-up surge pulls the rail down; the ESP32's brownout detector sees the supply fall below its threshold and resets the chip. Reset turns the PWM off, the rail recovers, the program starts, the motor starts, and the cycle repeats.

The fix is the separate motor supply with a bulk capacitor and a common ground. The brownout detector is doing its job; do not disable it.` },
      { t: 'widget', name: 'circuit-debug', props: { scenario: 'brownout' }, caption: 'The same fault in simulation, with meter probes.' },
      { t: 'predict', q: 'Suppose D1 were left out and the motor is carrying 300 mA when Q1 turns off. What happens at the drain in the next microsecond?',
        choices: [
          { t: 'The drain voltage shoots far above the supply voltage until something breaks down and conducts', ok: true, why: 'The winding\'s inductance keeps the 300 mA flowing. With the MOSFET off and no diode there is no path, so the voltage rises (V = L·di/dt) until the MOSFET avalanches. Repeated 20 000 times a second, that heats and eventually destroys it, and couples noise into everything nearby.' },
          { t: 'The current stops instantly and the drain rests at the supply voltage', why: 'That would be true for a resistor. An inductor stores energy in its magnetic field, and that energy has to go somewhere.' },
          { t: 'The drain is pulled below ground', why: 'The winding acts to keep current flowing in the same direction, into the drain node. That pushes the node up, not down.' },
        ],
        reveal: 'With D1 fitted, the drain rises only one diode drop above the supply, and the current circulates through the motor and diode. If you have an oscilloscope, look at the drain with D1 in place: you should see a square wave from near 0 V to slightly above the supply voltage.' },
    ] },
  ],
  walkthrough: [
    { t: 'code', lang: 'c', status: 'reviewed', code: P3_MOTOR, caption: 'Version 4, annotated',
      explain: [
        { lines: '10', md: 'Low-speed mode is available on every ESP32-family chip. In this mode register changes are latched by an explicit update, which the driver performs for you.' },
        { lines: '20-27', md: 'Converts a percentage to a compare value. `ledc_set_duty` stores it in the driver; `ledc_update_duty` writes the channel\'s duty register and sets the bit that loads it at the next counter overflow, so every PWM period is complete.' },
        { lines: '31-37', md: '`ledc_timer_config` selects the source clock, computes the fractional divider that gives 20 kHz with a 1024-step counter (80 MHz / (20 000 × 1024) ≈ 3.9) and writes the timer\'s configuration register. `LEDC_AUTO_CLK` lets the driver pick a source clock that can reach the request.' },
        { lines: '40-47', md: '`ledc_channel_config` binds channel 1 to timer 1, writes `hpoint` (the counter value at which the output goes high) and the initial duty, and routes the channel\'s output signal to GPIO23 through the GPIO matrix. From here on the pin is driven by the LEDC peripheral, not by `GPIO_OUT_REG`.' },
        { lines: '45', md: 'Starting at duty 0 matters: the motor must not jump when the channel is first connected to the pin.' },
        { lines: '50-54', md: 'The soft start limits the start-up current surge. The 400 ms per step is slow enough to observe; a product would ramp in a few hundred milliseconds in total.' },
      ] },
    `**What changed on the pin.** In projects 1 and 2 the pad's output came from the GPIO output register. \`ledc_channel_config\` changed the GPIO matrix output selection for the pad to the LEDC channel's signal. If you later call \`gpio_set_level\` on that pin it has no effect until you route the pin back with \`gpio_config\` (or stop the channel).

**Duty limits.** With n bits, duty values 0 to 2ⁿ − 1 are always valid. The value 2ⁿ − 1 leaves the output low for one count per period (99.9 % at 10 bits). Whether writing 2ⁿ for a true 100 % is accepted depends on the chip; the LEDC documentation for your target says. For a motor the difference is irrelevant.`,
  ],
  testing: [
    `| Check | How | You should see |
|---|---|---|
| LED duty | DC volts GPIO18–GND at 25/50/75 % | about 0.8 / 1.65 / 2.5 V |
| PWM frequency | Multimeter Hz range, or logic analyser, on GPIO18 | 5.00 kHz |
| Gate held off | Motor supply on, ESP32 held in reset (press and hold EN) | motor stationary |
| MOSFET fully on | DC volts drain–source, gate at 3.3 V, motor running | well under 0.2 V |
| Motor PWM | Logic analyser on GPIO23, 1 MHz sampling or more | 50 µs period; high time = duty × 50 µs |
| Motor ramp | Watch and listen | smooth rise in speed, no audible whine at 20 kHz |
| Rail integrity | DC volts 3V3–GND while the motor starts | no dip; no brownout resets in the log |
| Thermal | Finger on Q1 and D1 after 2 minutes at 50 % | warm at most. Hot means the wrong MOSFET, a reversed or slow diode, or a stalled motor |

**Frequency experiment.** Change \`MOTOR_FREQ_HZ\` to 1000 and re-flash. You should hear the motor whine at 1 kHz. That is the reason for 20 kHz. Put it back.

**With a logic analyser on GPIO23:** at the 50 % step you should measure 25 µs high and 25 µs low. Never connect a logic analyser input to the MOSFET drain or the motor terminals: they exceed logic levels.`,
    { t: 'callout', kind: 'hw', md: `A multimeter's Hz range and a cheap logic analyser both lose accuracy near their limits. A 24 MHz analyser sampling a 20 kHz signal has about 0.2 % timing resolution per edge, which is adequate. The meter's DC reading of a PWM signal is trustworthy only if the meter averages properly at that frequency; cross-check one point with the analyser.` },
  ],
  troubleshooting: [
    { symptom: 'ESP32 resets or logs a brownout when the motor starts', cause: 'Motor current is drawn from the DevKit rail, or the motor supply shares a thin ground wire with the logic.', fix: 'Separate motor supply; bulk capacitor at the motor stage; join the grounds at one point near the MOSFET source.' },
    { symptom: 'Motor never runs; gate measures 3.3 V relative to DevKit GND', cause: 'No common ground, or drain and source swapped (pinout read from the wrong datasheet).', fix: 'Continuity-check motor-supply negative to DevKit GND. Re-read the MOSFET pinout for your exact part and package.' },
    { symptom: 'Motor runs at power-up or when the ESP32 is in reset', cause: 'Gate pull-down missing, or on the wrong side of R1 so it is not connected to the gate.', fix: 'Fit 10–100 kΩ from the gate itself to ground.' },
    { symptom: 'Motor runs weakly and the MOSFET gets hot', cause: 'MOSFET is not fully on at V_GS = 3.3 V (not a true logic-level part), so it drops volts and dissipates power.', fix: 'Measure V_DS while on. Use a part whose R_DS(on) is specified at V_GS = 2.5 V.' },
    { symptom: 'Motor runs at full speed regardless of duty; the diode gets hot', cause: 'Flyback diode fitted backwards: it conducts from supply to drain and bypasses nothing, or shorts the supply through the MOSFET when on.', fix: 'Disconnect power at once. Striped (cathode) end to motor supply +.' },
    { symptom: 'Reboot loop with an LEDC error about frequency and resolution', cause: 'Requested f × 2ⁿ exceeds the source clock.', fix: 'Lower the resolution or the frequency so that f × 2ⁿ ≤ f_clock.' },
    { symptom: 'Duty changes in code have no effect', cause: '`ledc_update_duty` not called, or the wrong speed mode or channel is passed.', fix: 'Call set then update with the same mode and channel that were configured.' },
    { symptom: 'Audible whine from the motor', cause: 'PWM frequency in the audible range.', fix: 'Use about 20 kHz or more and reduce the resolution to suit.' },
    { symptom: 'Serial output or other circuits glitch while the motor runs', cause: 'Brush noise radiated and conducted from the motor.', fix: '100 nF ceramic directly across the motor terminals; twist the motor leads together; keep them away from signal wires.' },
  ],
  challenge: `**A speed control with a perceptually even dimmer.** No solution is given.

1. Combine this project with project 2: each short press of the button steps the motor through off, 40 %, 70 % and 100 %. A change of speed must ramp over about half a second and never jump.
2. If the motor is commanded from standstill to a speed below your measured starting threshold, give it a brief "kick" at a higher duty first. Decide the kick's duty and duration by experiment and justify them from your notes.
3. Make the LED on GPIO18 show the speed, with brightness steps that *look* evenly spaced. Design the mapping yourself: a lookup table computed from a power law is the usual approach. Explain in your notebook why a 13-bit resolution matters at the dim end.
4. Decide what the motor should do if the button task stops responding, and what in your design guarantees that. Which component keeps the motor off if the ESP32 itself resets?`,
  quiz: [
    { kind: 'concept', q: 'You need a 40 kHz PWM from an 80 MHz source clock. What is the highest duty resolution available?',
      choices: [
        { t: '10 bits', ok: true, why: '80 000 000 / 40 000 = 2000 ticks per period. 2¹⁰ = 1024 fits and 2¹¹ = 2048 does not.' },
        { t: '11 bits', why: '2¹¹ is 2048, and only 2000 clock ticks fit in one 25 µs period.' },
        { t: '13 bits, the same as at 5 kHz', why: 'Resolution is not fixed. A faster PWM leaves fewer clock ticks per period, so fewer distinct duty values.' },
      ] },
    { kind: 'circuit', q: 'The flyback diode is installed with its cathode on the MOSFET drain and its anode on the positive supply. What happens when the MOSFET turns on?',
      choices: [
        { t: 'The diode is forward biased from supply to drain, so the supply is shorted to ground through the diode and the MOSFET', ok: true, why: 'Anode at the supply and cathode at a drain pulled to ground is the conducting direction. The motor is bypassed and the current is limited only by the supply, the diode and the MOSFET.' },
        { t: 'Nothing unusual; a diode across a motor works in either direction', why: 'A diode conducts one way only. In the correct orientation it is reverse biased while the MOSFET is on. Consider which way it is biased here.' },
        { t: 'The motor runs backwards', why: 'Direction depends on the polarity of the voltage across the motor. A diode in parallel does not reverse it.' },
      ] },
    { kind: 'circuit', q: 'Why is R2 (100 kΩ, gate to ground) needed if the firmware sets the duty to 0 at start-up?',
      choices: [
        { t: 'Because between power-on and the firmware configuring the pin, the GPIO is high-impedance and the gate would float', ok: true, why: 'Boot ROM, bootloader and start-up code run for a noticeable time before `app_main`. A floating gate holds whatever charge it picks up and can turn the MOSFET partly or fully on.' },
        { t: 'Because the gate needs a DC current to stay on', why: 'A MOSFET gate is insulated; it draws current only while its capacitance charges or discharges.' },
        { t: 'To protect the GPIO from the motor voltage', why: 'The gate is insulated from the drain, and R2 goes to ground. It offers no protection against a drain-side fault.' },
      ] },
    { kind: 'code', q: 'What does this fragment do to the motor?', code: String.raw`ledc_set_duty(PWM_MODE, MOTOR_CHANNEL, 512);
ledc_set_duty(PWM_MODE, MOTOR_CHANNEL, 256);
ledc_update_duty(PWM_MODE, MOTOR_CHANNEL);`,
      choices: [
        { t: 'It goes to about 25 %; the 50 % value was never applied', ok: true, why: 'Each set call overwrites the pending value. Only the update call loads a value into the hardware, and by then the pending value is 256 of 1023.' },
        { t: 'It runs briefly at 50 % and then at 25 %', why: 'Nothing reaches the PWM hardware until the update call, so the first value is never output.' },
        { t: 'It stays at its previous speed, because two sets cancel', why: 'Nothing cancels. The update call applies whichever value was stored last.' },
      ] },
    { kind: 'concept', q: 'What would happen if you raised the motor PWM frequency from 20 kHz to 300 kHz, keeping everything else?',
      choices: [
        { t: 'Resolution falls to 8 bits, and the MOSFET spends a larger share of each period switching, so it runs hotter', ok: true, why: '80 MHz / 300 kHz ≈ 266 ticks, so 8 bits at most. The gate, charged through 220 Ω from a GPIO, takes a fixed time to switch; at 300 kHz that time is a significant part of the 3.3 µs period.' },
        { t: 'The motor spins proportionally faster', why: 'Speed follows the average voltage, which is set by duty, not by how often the switching repeats.' },
        { t: 'Nothing changes except that the whine becomes inaudible', why: 'It is already inaudible at 20 kHz. Going higher has costs in resolution and switching loss.' },
      ] },
    { kind: 'circuit', q: 'A motor has a stall current of 1.2 A at 6 V. The MOSFET\'s datasheet gives R_DS(on) = 0.05 Ω at V_GS = 2.5 V. Roughly how much power does the MOSFET dissipate while the motor is stalled and the MOSFET is fully on?',
      choices: [
        { t: 'About 72 mW', ok: true, why: 'P = I² × R = 1.2² × 0.05 = 0.072 W. That is why a fully-on MOSFET stays cool, and why a partly-on one, with a much larger effective resistance, does not.' },
        { t: 'About 7.2 W', why: 'That is 1.2 A × 6 V, the power drawn from the supply. Nearly all of it is dissipated in the motor, not in the switch.' },
        { t: 'About 60 mW', why: 'That is I × R, which is the voltage drop in volts (0.06 V), not a power. Multiply by the current once more.' },
      ] },
  ],
};

const LABS = [p1, p2, p3];

/* ---------- section-level material contributed by these projects ---------- */
const glossary = [
  { term: 'Push-pull output', def: 'An output stage with one transistor to the supply and one to ground, so the pin is actively driven both high and low.' },
  { term: 'Strapping pin', def: 'A pin whose level is sampled at reset to choose a boot option (for example GPIO0 on the original ESP32 selects the serial bootloader). Loads on such pins can stop the board booting.' },
  { term: 'Contact bounce', def: 'The burst of make-and-break transitions a mechanical switch produces for a short time when it is pressed or released.' },
  { term: 'Debounce', def: 'Deciding a switch state only after its signal has stopped changing, in software (sampling or waiting for quiet), in hardware (RC filter), or both.' },
  { term: 'Duty cycle', def: 'The fraction of each PWM period for which the output is high, usually given as a percentage.' },
  { term: 'LEDC', def: 'The ESP32 family\'s PWM peripheral ("LED control"): timers that set frequency and resolution, and channels that set duty and drive pins.' },
  { term: 'Low-side switch', def: 'A transistor placed between the load and ground. For an N-channel MOSFET this keeps the source at ground so a logic-level signal can drive the gate.' },
  { term: 'Flyback diode', def: 'A diode across an inductive load (motor, relay, solenoid) that carries the load current when the switch opens, preventing a destructive voltage spike.' },
  { term: 'Logic-level MOSFET', def: 'A MOSFET that is fully on at a logic voltage. Check that its datasheet specifies R_DS(on) at a gate voltage at or below the one you will apply; the threshold voltage alone does not tell you.' },
  { term: 'ADC attenuation', def: 'An input attenuator in the ESP32 ADC that extends the measurable voltage range. Higher attenuation gives a wider range and coarser steps.' },
  { term: 'Oversampling', def: 'Taking several ADC samples and averaging them to reduce random noise, at the cost of time.' },
  { term: 'Register map', def: 'The table in a device datasheet listing each register address, its bit fields, reset value and access type. It is the specification a driver is written from.' },
  { term: 'Compensation', def: 'Converting a sensor\'s raw reading into a physical unit using per-device calibration constants stored in the sensor.' },
];

const troubleshooting = [
  { symptom: 'Board will not flash or boot once a circuit is attached', area: 'GPIO', causes: 'The circuit loads a strapping pin (GPIO0, 2, 5, 12 or 15 on the original ESP32) or a pin wired to the module\'s flash (GPIO6–11).', fix: 'Move the circuit to a free, non-strapping pin; consult the pin table for your chip.' },
  { symptom: '`task_wdt: Task watchdog got triggered` naming an idle task', area: 'FreeRTOS', causes: 'A task loops without blocking; often a delay shorter than one tick, which `pdMS_TO_TICKS` rounds to 0.', fix: 'Block in every loop (`vTaskDelay` of at least one tick, or a queue receive).' },
  { symptom: 'A configured pin does nothing while two unrelated pins misbehave', area: 'GPIO', causes: '`pin_bit_mask` was given a pin number instead of a bit mask.', fix: 'Write `1ULL << pin`.' },
  { symptom: 'Brownout reset when a motor, relay or radio switches on', area: 'Power', causes: 'Load current drawn from the DevKit regulator or through a shared thin ground wire.', fix: 'Separate supply for the load, bulk capacitor at the load, common ground joined at one point.' },
  { symptom: 'ADC reading saturates below the real input voltage, or is non-linear near the ends', area: 'ADC', causes: 'Input outside the range of the chosen attenuation; the ESP32 ADC is not accurate close to 0 V or to the top of its range.', fix: 'Keep the signal within the range the ESP-IDF ADC documentation gives for that attenuation; use calibration; scale with a divider if necessary.' },
  { symptom: 'I2C scan finds no device', area: 'I2C', causes: 'SDA and SCL swapped, no pull-ups, sensor not powered, or no common ground.', fix: 'Measure both lines idle at 3.3 V; check power at the sensor pins; swap SDA/SCL; add 4.7 kΩ pull-ups.' },
];

const refs = [
  idfRef('docs/en/api-reference/peripherals/gpio/esp32.inc', 'ESP-IDF: GPIO summary for the original ESP32', 'Strapping pins, input-only pins, flash pins, ADC2 and Wi-Fi.'),
  idfRef('docs/en/api-reference/peripherals/gpio.rst', 'ESP-IDF: GPIO driver reference'),
  idfRef('docs/en/api-reference/peripherals/ledc.rst', 'ESP-IDF: LED control (LEDC) reference', 'Frequency and resolution ranges per chip, fade functions.'),
  idfRef('docs/en/api-reference/peripherals/adc/adc_oneshot.rst', 'ESP-IDF: ADC oneshot mode driver'),
  idfRef('docs/en/api-reference/peripherals/i2c.rst', 'ESP-IDF: I2C driver (i2c_master.h)'),
  { org: 'Espressif', title: 'ESP-IDF peripheral examples (v6.1)', url: 'https://github.com/espressif/esp-idf/tree/v6.1/examples/peripherals', note: 'Reference programs for gpio, ledc, adc and i2c to compare your code against.' },
  { org: 'Bosch Sensortec', title: 'BME280 sensor API (reference driver source)', url: 'https://github.com/boschsensortec/BME280_SensorAPI', note: 'The manufacturer\'s own driver. Use it to check your register addresses and compensation code; the datasheet is linked from its README.' },
  { org: 'NXP', title: 'UM10204: I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf', note: 'URL not load-tested from this environment.' },
  { org: 'Analog Devices', title: 'TMP35/TMP36/TMP37 datasheet (product page)', url: 'https://www.analog.com/en/products/tmp36.html', note: 'URL not load-tested from this environment. Pinout, output scale, supply range and load limits.' },
].map((r) => ({ org: 'Espressif', ...r }));

export default { skills, lessons: [], labs: LABS, glossary, troubleshooting, refs };
