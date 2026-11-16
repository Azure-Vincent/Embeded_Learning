// ESP32 section, part 1: lessons, shared skills, glossary, troubleshooting, references.
// ESP-IDF listings: every complete program (a listing with app_main) is `idf-built`: compiled and linked for
// the esp32 target with ESP-IDF v6.1 by tools/idf-check. Fragments are `idf-checked`: compiled inside a scratch
// component against the v6.1 headers. Nothing here was run on a board.
const R = String.raw;

const skills = [
  { id: 'esp-choose-chip', name: 'Choose an ESP32 variant and module for a set of requirements', track: 'programming' },
  { id: 'esp-pin-plan', name: 'Plan a pin assignment that avoids strapping, flash and input-only pins', track: 'programming' },
  { id: 'esp-idf-project', name: 'Create, configure and build an ESP-IDF project with idf.py', track: 'programming' },
  { id: 'esp-flash-layout', name: 'Explain what is written to which flash offset and read a partition table', track: 'programming' },
  { id: 'esp-build-flash', name: 'Flash a board with idf.py or esptool and enter download mode by hand', track: 'programming' },
  { id: 'esp-arduino-map', name: 'Translate an Arduino sketch into the ESP-IDF calls underneath it', track: 'programming' },
  { id: 'esp-error-handling', name: 'Handle esp_err_t results deliberately instead of ignoring or aborting', track: 'programming' },
  { id: 'esp-logging', name: 'Use ESP_LOGx levels and tags to trace firmware behaviour', track: 'programming' },
  { id: 'esp-gpio-config', name: 'Configure GPIO inputs and outputs with gpio_config_t', track: 'programming' },
  { id: 'esp-gpio-isr', name: 'Write a GPIO interrupt handler that defers work to a task', track: 'programming' },
  { id: 'esp-adc-read', name: 'Read a calibrated voltage with the ADC oneshot driver', track: 'programming' },
  { id: 'esp-ledc-pwm', name: 'Generate PWM with LEDC and choose frequency and resolution', track: 'programming' },
  { id: 'esp-timer', name: 'Schedule periodic work with gptimer or esp_timer', track: 'programming' },
  { id: 'esp-uart', name: 'Set up a second UART and exchange bytes with another device', track: 'programming' },
  { id: 'esp-i2c', name: 'Probe an I2C bus and read a device register with the master driver', track: 'programming' },
  { id: 'esp-spi', name: 'Configure an SPI bus and device and run a transaction', track: 'programming' },
  { id: 'esp-freertos-tasks', name: 'Create FreeRTOS tasks with sensible stack sizes and priorities', track: 'programming' },
  { id: 'esp-freertos-sync', name: 'Pass data between tasks with queues and protect shared state with a mutex', track: 'programming' },
  { id: 'esp-wdt', name: 'Configure the task watchdog and diagnose a watchdog reset', track: 'programming' },
  { id: 'esp-nvs', name: 'Store and retrieve settings in NVS', track: 'programming' },
  { id: 'esp-wifi-sta', name: 'Connect to Wi-Fi in station mode with event handlers and reconnection', track: 'programming' },
  { id: 'esp-ble-gatt', name: 'Describe a BLE peripheral in terms of services and characteristics', track: 'programming' },
  { id: 'esp-panic-decode', name: 'Decode a panic backtrace and a reset reason from the serial log', track: 'programming' },
  { id: 'esp-size', name: 'Analyse firmware size and fit an application into its partition', track: 'programming' },
];

const lessons = [];

// ───────────────────────────────────────────────────────────── 1. Architecture and variants
lessons.push({
  id: 'esp-l-arch', title: 'ESP32 architecture, variants and pins', minutes: 40,
  summary: 'What is inside the metal can, how the family members differ, and which pins will bite you.',
  skills: ['esp-choose-chip', 'esp-pin-plan'],
  blocks: [
    `## A board that stops booting when you add a button

You build a small circuit on a classic ESP32 dev board: a push button from GPIO12 to ground with a 10 kΩ pull-up to 3.3 V, and a light sensor on GPIO35 that relies on the internal pull-up. The code is fine. The board never starts your program, and when you remove the button it boots but the sensor input reads noise.

Neither fault is in your C. Both come from facts about the chip that no compiler checks: some pins are sampled at reset to decide how to boot, and some pins have no output driver and no pull resistors at all. This lesson gives you the map, so that pin choice becomes a design step and not an accident.`,

    `## Chip, module, dev board

Three different things are all called "an ESP32":

| Level | What it is | Example | What it adds |
|---|---|---|---|
| Chip (SoC) | The silicon in a QFN package | ESP32, ESP32-S3, ESP32-C3 | CPU, RAM, ROM, radio, peripherals. **No program flash** on most variants |
| Module | A small PCB under a metal shield | ESP32-WROOM-32E, ESP32-S3-WROOM-1 | SPI flash, crystal, antenna and matching, RF certification |
| Dev board | A module on a larger PCB | ESP32-DevKitC, ESP32-S3-DevKitC-1 | USB connector, 3.3 V regulator, BOOT and EN buttons, auto-reset circuit, pin headers |

The module is why some chip pins are not available to you: the flash chip inside the can is wired to them. The dev board is why flashing "just works": a small circuit lets the PC pull the reset and boot pins through the USB-UART chip's control lines.

To find out which USB-UART chip, which LED pin and which boot button your board has, read the board's schematic or user guide. These are properties of the board, not of the ESP32, and they differ between vendors.`,

    { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'esp32' }, caption: 'Click through the blocks of an ESP32. Notice that program flash sits outside the chip, behind a cache.' },

    `## The family

Espressif reuses the name ESP32 for chips with different CPUs. The differences that matter when choosing one:

| Chip | CPU | Cores | Max CPU clock | Radio | USB |
|---|---|---|---|---|---|
| ESP32 | Xtensa LX6 | 2 | 240 MHz | Wi-Fi + Bluetooth | none (external USB-UART chip) |
| ESP32-S3 | Xtensa LX7 | 2 | 240 MHz | Wi-Fi + Bluetooth LE | USB OTG and USB Serial/JTAG |
| ESP32-C3 | RISC-V | 1 | 160 MHz | Wi-Fi + Bluetooth LE | USB Serial/JTAG |
| ESP32-C6 | RISC-V | 1 | 160 MHz | Wi-Fi + Bluetooth LE + IEEE 802.15.4 | USB Serial/JTAG |

Two more you will meet: the ESP32-S2 (single-core Xtensa, Wi-Fi only, USB OTG) and the ESP32-H2 (RISC-V, Bluetooth LE and 802.15.4, no Wi-Fi). Confirm details for those in their datasheets before designing with them.

What this means in practice:

- **Xtensa vs RISC-V** changes the toolchain (LX6 and LX7 are two generations of the Xtensa core and share one), the register names in a crash dump and the interrupt architecture. Your C source for the ESP-IDF drivers is the same.
- **Two cores** means two tasks really do run at the same instant. Bugs that hide on a single core appear.
- **USB Serial/JTAG** is a fixed-function block that gives you a serial console, flashing and JTAG debugging over one USB cable with no extra chip. Its D+/D- pins are fixed: GPIO19/18 on the C3, GPIO20/19 on the S3, GPIO13/12 on the C6. Using those pins as GPIO disconnects it.
- Only the original ESP32 has Bluetooth Classic as well as LE.`,

    { t: 'widget', name: 'platform-compare', caption: 'Compare the ESP32 with the two eCTF microcontrollers used later in the course.' },

    `## Pins on the original ESP32

These rules are for the ESP32 (for example in an ESP32-WROOM-32E module). Other family members have different lists.

| Pins | Restriction | Why |
|---|---|---|
| GPIO0, 2, 5, 12, 15 | **Strapping pins** | Sampled at reset to choose boot mode, flash voltage and boot log behaviour |
| GPIO6–11 | Do not use | Wired to the module's SPI flash |
| GPIO16, 17 | Unavailable on modules with PSRAM | Used for the PSRAM chip |
| GPIO34–39 | **Input only**, no internal pull-up or pull-down | These pads have no output driver and no pull resistors |
| GPIO12–15 | JTAG | Free unless you attach a JTAG debugger |
| ADC2 pins | Not usable for ADC while Wi-Fi is on | Wi-Fi uses ADC2; use ADC1 (GPIO32–39) |
| GPIO1, 3 | UART0 TX/RX | The console and flashing port on most dev boards |

A strapping pin is an ordinary GPIO after boot. The danger is what your circuit does to it **during reset**. GPIO0 held low at reset puts the chip in download mode, waiting for a flashing tool. GPIO12 (MTDI) selects the flash supply voltage: on a module with 3.3 V flash, pulling it high at reset selects 1.8 V and the flash cannot be read, so boot fails. The full strapping table is in the datasheet's "Strapping pins" section.

That explains the opening problem. The 10 kΩ pull-up on GPIO12 held it high at reset, and GPIO35 has no internal pull-up to enable, so it floated.`,

    { t: 'callout', kind: 'hw', md: `**ESP32-S3 differs.** Its strapping pins are GPIO0, GPIO3, GPIO45 and GPIO46, its flash occupies a different pin range (and more pins with octal flash/PSRAM modules), and it has no input-only pins. Do not carry the ESP32 list across: open the S3 datasheet's pin overview and the module datasheet for the module you actually have.` },

    { t: 'callout', kind: 'mistake', md: `**Using GPIO6–11 because the header exposes them.** Some ESP32 dev boards bring the flash pins out to the headers. Driving them corrupts flash access, and the usual result is an immediate crash or a reset loop the moment \`gpio_config()\` runs. If a pin is labelled CLK, CMD, SD0–SD3 or D0–D3, leave it alone.` },

    `## Where the memory is

The ESP32's address space is fixed by the hardware. A few ranges are worth recognising on sight, because they appear in every crash dump:

| Range | Region | What lives there |
|---|---|---|
| \`0x3F400000–0x3F800000\` | DROM | Read-only data in flash, seen through the cache |
| \`0x3FFAE000–0x40000000\` | DRAM | Globals, heap, task stacks |
| \`0x40000000–0x40070000\` | Mask ROM | First-stage bootloader and ROM functions |
| \`0x40080000–0x400AA000\` | IRAM | Code copied into RAM (interrupt handlers, flash drivers) |
| \`0x400D0000–0x40400000\` | IROM | Your application code, executed from flash through the cache |

Code in IROM is not in RAM. The CPU fetches it from the external flash chip through a cache. Remember this: it is the reason interrupt handlers need special treatment later.`,

    { t: 'widget', name: 'memory-map', props: { platform: 'esp32' }, caption: 'Explore the ESP32 address space. Try the "where does this address live?" questions.' },

    { t: 'predict', q: 'You need a push button that uses the **internal** pull-up on a classic ESP32 module with Wi-Fi running. Which pin is the safest choice?',
      choices: [
        { t: 'GPIO34', why: 'GPIO34–39 are input-only and have no internal pull resistors, so the internal pull-up cannot be enabled and the pin would float when the button is open.' },
        { t: 'GPIO9', why: 'GPIO6–11 are wired to the SPI flash inside the module. Reconfiguring one stops the chip reading its own program.' },
        { t: 'GPIO12', why: 'GPIO12 is a strapping pin that selects flash voltage. A pull-up there is sampled at reset and can stop a 3.3 V-flash module from booting.' },
        { t: 'GPIO27', ok: true, why: 'GPIO27 is an ordinary bidirectional pin with pull resistors, is not a strapping or flash pin, and a digital input is not affected by the ADC2/Wi-Fi restriction.' },
      ],
      reveal: `GPIO27 is on ADC2, but the ADC2 restriction only concerns *analog* reads while Wi-Fi is active. As a digital input it is unaffected. The other three each break one rule from the table: input-only with no pulls, flash pin, strapping pin.` },

    { t: 'exercise', prompt: `Plan pins for a classic ESP32 module (no PSRAM) running Wi-Fi. You need: (a) an analog battery-voltage input, (b) a status LED output, (c) a push button to ground using the internal pull-up, (d) I2C SDA and SCL, (e) the USB console must keep working. Choose one GPIO for each signal and justify each choice against the restriction table.`,
      hints: [
        `Start with the most constrained signal. Which one has a restriction that depends on Wi-Fi?`,
        `Analog with Wi-Fi on means ADC1, which is GPIO32–39. Input-only pins are perfectly good for a signal you only ever read.`,
        `For the outputs and the pulled-up input, cross off 0, 2, 5, 12, 15 (strapping), 6–11 (flash), 34–39 (no output, no pulls) and 1, 3 (console).`,
      ],
      solution: `One good answer:

- **Battery ADC: GPIO34.** ADC1, so Wi-Fi does not block it. Input-only is no drawback for an analog input, and using it here saves a full-featured pin.
- **LED: GPIO4** (or 13, 14, 25–27, 32, 33). Not a strapping or flash pin.
- **Button: GPIO27.** Has an internal pull-up. Not GPIO34–39 (no pulls), not GPIO0 (pressing at reset would enter download mode).
- **I2C: GPIO21 (SDA) and GPIO22 (SCL).** Any free bidirectional pins work because the I2C signals are routed through the GPIO matrix; 21/22 are the conventional choice and avoid every restricted group.
- **Console:** leave GPIO1 and GPIO3 unconnected.

The method matters more than the particular numbers: place the constrained signals first, then spend unrestricted pins on what is left.` },

    { t: 'exercise', prompt: `**Find the faults.** A colleague's pin plan for a classic ESP32-WROOM-32E board with Wi-Fi running is below. Three of the five lines break a rule from the restriction table. Which GPIO numbers are the faulty choices? Answer with the three numbers.`,
      code: R`signal                     pin      configuration
relay driver (output)      GPIO35   push-pull output
pot wiper (analog in)      GPIO33   ADC1 channel 5, 12 dB
mode switch to 3.3 V       GPIO12   input, switch closed at power-up in "service" mode
status LED                 GPIO16   push-pull output
SD card detect             GPIO8    input, internal pull-up`,
      hints: [
        `Take the lines one at a time and ask of each pin: can it do what the configuration column asks, and what does the circuit do to it while the chip is in reset?`,
        `One pin has no output driver. One is wired to something inside the module. One is sampled at reset and the circuit can hold it high there.`,
        `Check 35 against the input-only group, 8 against the flash group, and 12 against the strapping list. Then check that 33 and 16 really are free on this module (it has no PSRAM).`,
      ],
      solution: `**35, 12 and 8.**

- **GPIO35** is input-only: it has no output driver, so it cannot drive a relay. \`gpio_config\` rejects output mode on it with an error.
- **GPIO12** is the MTDI strapping pin. With the switch closed at power-up it is high at reset, the chip selects 1.8 V for the flash supply, and a module with 3.3 V flash does not boot. The fault appears only in "service" mode, which is what makes it nasty.
- **GPIO8** is one of GPIO6–11, wired to the SPI flash inside the module.

GPIO33 is fine: it is an ADC1 pin, so Wi-Fi does not block it. GPIO16 is fine on a module without PSRAM. A corrected plan moves the relay to GPIO25, the switch to GPIO27 and card detect to GPIO26.`,
      answer: { type: 'text', accept: ['^(?=.*\\b35\\b)(?=.*\\b12\\b)(?=.*\\b8\\b)(?!.*\\b33\\b)(?!.*\\b16\\b).*$'], nudge: 'Three pins: one cannot drive, one is sampled at reset, one belongs to the flash.' } },

    `## Harder: choosing a chip

A battery-powered door sensor must join a Thread network (IEEE 802.15.4), be flashed and debugged over one USB cable with no extra chips, and it needs only a few GPIOs. Which family member fits, and what do you give up?

The ESP32-C6 is the one in the table with an 802.15.4 radio and a USB Serial/JTAG controller. You give up the second core and the higher clock of the ESP32 and S3, and you move from Xtensa to RISC-V, which changes what a crash dump looks like but not your driver code. You must also keep GPIO12 and GPIO13 free for USB. Requirements choose the chip; habit should not.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF GPIO reference: ESP32 pin restrictions (source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/gpio/esp32.inc' },
      { title: 'ESP32 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf', note: 'Pin definitions and strapping pins sections' },
      { title: 'ESP32-S3 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf' },
      { title: 'ESP Hardware Design Guidelines', url: 'https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/index.html' },
    ] },
  ],
  quiz: [
    { q: 'A classic ESP32 design reads a potentiometer on GPIO25 with the ADC. It works until Wi-Fi is started, then the reads fail. Why?', kind: 'arch', choices: [
      { t: 'GPIO25 is an ADC2 pin, and ADC2 is used by Wi-Fi', ok: true, why: 'On the ESP32, ADC2 is shared with the Wi-Fi driver, so ADC2 channels cannot be relied on while Wi-Fi is running. Move the signal to an ADC1 pin (GPIO32–39).' },
      { t: 'Wi-Fi raises the supply noise so much that the ADC cannot convert', why: 'Radio activity does add noise, but noise makes readings jitter. It does not make the driver refuse or time out a conversion.' },
      { t: 'GPIO25 is input-only and has no ADC', why: 'The input-only pins are GPIO34–39, and GPIO25 does have an ADC channel. The problem is which ADC unit that channel belongs to.' },
    ] },
    { q: 'What does an ESP32-WROOM module add to the bare ESP32 chip?', kind: 'concept', choices: [
      { t: 'SPI flash, a crystal, an antenna and RF certification', ok: true, why: 'The chip has no program flash of its own on most variants; the module supplies it together with the clock and RF parts.' },
      { t: 'A USB connector, a 3.3 V regulator and the BOOT and EN buttons', why: 'Those belong to the development board that carries the module. The module itself runs from 3.3 V and has no USB connector.' },
      { t: 'A second CPU core and extra RAM, which the bare chip lacks', why: 'The number of cores is a property of the silicon. A module cannot change it.' },
    ] },
    { q: 'A relay driver circuit pulls GPIO0 low through a transistor base whenever the board is unpowered or in reset. What symptom do you expect on a classic ESP32?', kind: 'circuit', choices: [
      { t: 'The chip waits in download mode after every reset', ok: true, why: 'GPIO0 is sampled at reset. Low selects the serial bootloader, so the application never starts until GPIO0 is high at reset.' },
      { t: 'The flash is powered at the wrong voltage, so boot fails with flash read errors', why: 'Flash voltage is selected by a different strapping pin (GPIO12). GPIO0 chooses between normal boot and download mode.' },
      { t: 'Nothing: strapping pins only matter while a flashing tool is attached', why: 'Strapping pins are sampled at every reset, whether or not a flashing tool is attached.' },
    ] },
    { q: 'You port a project from an ESP32 to an ESP32-C3. Which statement is correct?', kind: 'arch', choices: [
      { t: 'The driver calls stay the same; the core count, CPU architecture and pin list change', ok: true, why: 'ESP-IDF drivers present the same API across chips. Core count, the RISC-V toolchain and pin restrictions all change.' },
      { t: 'The same binary runs on both, because the ESP-IDF drivers hide the difference between the chips', why: 'Xtensa and RISC-V have different instruction sets. You must set the target and rebuild; a binary for one will not execute on the other.' },
      { t: 'Tasks pinned to core 1 keep working, because the scheduler emulates the second core', why: 'The C3 has a single core, so there is no core 1 to pin a task to.' },
    ] },
    { q: 'A crash dump shows `PC: 0x400d1a44`. Using the ESP32 memory map, where was the CPU executing?', kind: 'arch', choices: [
      { t: 'Application code in flash (IROM), via the cache', ok: true, why: 'IROM spans 0x400D0000–0x40400000. That is where normal application functions execute from.' },
      { t: 'The first-stage bootloader in the mask ROM', why: 'Mask ROM is 0x40000000–0x40070000. This address is above that range.' },
      { t: 'Interrupt-safe code that was copied into internal RAM (IRAM)', why: 'IRAM is 0x40080000–0x400AA000. The address in the dump is higher than that range.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 2. ESP-IDF environment, build and flash
lessons.push({
  id: 'esp-l-idf', title: 'The ESP-IDF environment: build, flash, monitor', minutes: 50,
  summary: 'Project layout, configuration, the three images in flash, and what idf.py and esptool actually do.',
  skills: ['esp-idf-project', 'esp-flash-layout', 'esp-build-flash', 'esp-size'],
  blocks: [
    `## "It built for the other board"

You have a working project for an ESP32 dev board. A colleague hands you an ESP32-S3 board. You plug it in, run \`idf.py flash\`, the tool reports success, and the board prints nothing useful. What went wrong, and what was actually written to the chip?

To answer that you need to know what an ESP-IDF build produces and where each piece goes. "Flash the firmware" hides three separate images and a table.`,

    `## What ESP-IDF is

ESP-IDF is Espressif's SDK: a CMake build system, a FreeRTOS port, drivers, network stacks and a command-line front end called \`idf.py\`. The current stable release at the time of writing is **v6.1**. From v6.0 the default installer on Linux is the ESP-IDF Installation Manager:

\`\`\`sh
echo "deb [trusted=yes] https://dl.espressif.com/dl/eim/apt/ stable main" | sudo tee /etc/apt/sources.list.d/espressif.list
sudo apt update
sudo apt install eim-cli
eim install
\`\`\`

Older tutorials clone the repository to \`~/esp/esp-idf\`, run \`./install.sh esp32\` and then \`. $HOME/esp/esp-idf/export.sh\` in each terminal. That legacy method still exists. Either way the result is a shell in which \`idf.py\` and the cross-compilers are on the path. ESP-IDF needs Python 3.10 or newer.`,

    `## Project layout

A project is a directory of **components**. A component is a folder with a \`CMakeLists.txt\` that lists its sources, headers and dependencies. Your code lives in a component that must be called \`main\`.`,

    { t: 'ascii', text: `blink/
├── CMakeLists.txt          project file: 3 lines, names the project
├── sdkconfig               generated: every configuration option for this build
├── sdkconfig.defaults      optional, hand-written: the few options you care about
├── partitions.csv          optional: custom partition table
├── main/
│   ├── CMakeLists.txt      component file: lists sources
│   ├── idf_component.yml   optional: dependencies from the component registry
│   └── main.c              contains app_main()
├── components/             optional: your own reusable components
└── build/                  generated: everything the build produces`, caption: 'A minimal ESP-IDF project. Commit sdkconfig.defaults; decide deliberately whether to commit sdkconfig.' },

    { t: 'code', lang: 'cmake', status: 'idf-checked', caption: 'CMakeLists.txt (project root)', code: R`cmake_minimum_required(VERSION 3.22)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(blink)`, explain: [
      { lines: '1', md: 'Minimum CMake version. The number has risen across IDF releases; copy this line from an example shipped with the IDF version you installed.' },
      { lines: '2', md: 'Pulls in the whole ESP-IDF build system. `IDF_PATH` is set by the environment script.' },
      { lines: '3', md: 'Names the project. The application image will be `build/blink.bin` and the debug file `build/blink.elf`.' },
    ] },

    { t: 'code', lang: 'cmake', status: 'idf-checked', caption: 'main/CMakeLists.txt', code: R`idf_component_register(SRCS "main.c"
                       INCLUDE_DIRS ".")`, explain: [
      { lines: '1-2', md: 'Registers the component. `main` is special: it is allowed to use every other component without listing them. Any other component must name what it uses with `REQUIRES` or `PRIV_REQUIRES` (for example `esp_driver_gpio`). A "header not found" build error in your own component almost always means a missing entry there. The v6.1 `hello_world` template also sets `idf_build_set_property(MINIMAL_BUILD ON)` in the project file; with that line even `main` sees only the components it names, so a `main` that includes `driver/gpio.h` needs `PRIV_REQUIRES esp_driver_gpio`.' },
    ] },

    `## The idf.py workflow

| Command | What it does |
|---|---|
| \`idf.py set-target esp32s3\` | Selects the chip. Deletes the build directory and regenerates \`sdkconfig\` for that chip |
| \`idf.py menuconfig\` | Text UI over every Kconfig option; writes \`sdkconfig\` |
| \`idf.py build\` | Configures with CMake, compiles with Ninja, links, and produces the binaries |
| \`idf.py -p PORT flash\` | Builds if needed, resets the chip into download mode, writes the images with esptool |
| \`idf.py -p PORT monitor\` | Serial terminal that also decodes crash addresses. Exit with Ctrl-] |
| \`idf.py size\` | Summary of flash and RAM use from the map file |
| \`idf.py fullclean\` | Deletes the build directory |

Commands chain: \`idf.py -p /dev/ttyUSB0 flash monitor\` is the one you will type most. On Linux the port is typically \`/dev/ttyUSB0\` for an external USB-UART chip and \`/dev/ttyACM0\` for the built-in USB Serial/JTAG; check with \`ls /dev/tty*\` before and after plugging in.

\`sdkconfig\` is the complete configuration of one build: target chip, flash size, log level, FreeRTOS tick rate, which drivers are enabled, hundreds of options. The C code sees it as \`CONFIG_...\` macros in a generated \`sdkconfig.h\`.`,

    { t: 'callout', kind: 'decision', md: `**Keep \`sdkconfig.defaults\` in version control, not only \`sdkconfig\`.** \`sdkconfig\` is hundreds of lines, most of them defaults, and it is regenerated by \`set-target\`. \`sdkconfig.defaults\` holds only the handful of options you deliberately changed, so a reviewer can see your decisions and the project can be rebuilt for another chip. \`idf.py save-defconfig\` writes it for you.` },

    `## What gets flashed where

A build produces three images, and \`idf.py flash\` writes each to a fixed place in the external SPI flash:

| Image | File | Offset on ESP32 | Offset on S3 / C3 / C6 |
|---|---|---|---|
| Second-stage bootloader | \`build/bootloader/bootloader.bin\` | \`0x1000\` | \`0x0\` |
| Partition table | \`build/partition_table/partition-table.bin\` | \`0x8000\` | \`0x8000\` |
| Application | \`build/<project>.bin\` | \`0x10000\` | \`0x10000\` |

The bootloader offset is fixed in each chip's mask ROM, which is why it differs between chips and cannot be changed. The partition table offset \`0x8000\` and the factory app offset \`0x10000\` are defaults. The table occupies one \`0x1000\` sector.

The default table ("Single factory app, no OTA") looks like this:`,

    { t: 'code', lang: 'csv', status: 'idf-checked', caption: 'Default partition table (offsets as the build resolves them)', code: R`# Name,   Type, SubType, Offset,  Size
nvs,      data, nvs,     0x9000,  0x6000
phy_init, data, phy,     0xf000,  0x1000
factory,  app,  factory, 0x10000, 1M`, explain: [
      { lines: '2', md: '`nvs`: key-value storage used by your code and by Wi-Fi to remember credentials. Covered in the NVS lesson.' },
      { lines: '3', md: '`phy_init`: radio calibration data.' },
      { lines: '4', md: '`factory`: the application. Its size is a hard limit: a build larger than the partition fails at the end of `idf.py build` with an "app partition is too small" message.' },
    ] },

    { t: 'widget', name: 'boot-sequence', props: { platform: 'esp32' }, caption: 'Step from reset through the ROM, the second-stage bootloader and the partition table to app_main.' },

    `At reset the mask ROM reads the strapping pins. In normal boot it loads the second-stage bootloader from its fixed offset. That bootloader reads the partition table, picks an application partition, maps its code and data into the address space through the cache, and jumps to it. ESP-IDF's startup code then initialises the heap and FreeRTOS and creates a task that calls your \`app_main()\`.

Now the opening problem has an answer. A project still configured for the ESP32 produces Xtensa code for the ESP32 and writes its bootloader at \`0x1000\`. An S3's ROM looks for a bootloader at \`0x0\`. Recent esptool versions refuse to flash when the image's chip ID does not match the connected chip; if the check is bypassed or the images are written by hand, the ROM finds nothing valid and prints an error in a loop. The fix is \`idf.py set-target esp32s3\`, then a rebuild.`,

    `## esptool and download mode

\`idf.py flash\` is a wrapper. The tool that talks to the chip is **esptool**, and the exact command is recorded in \`build/flash_args\`. Run by hand for an ESP32 it looks like:

\`\`\`sh
esptool --chip esp32 -p /dev/ttyUSB0 -b 460800 write-flash \\
  0x1000 build/bootloader/bootloader.bin \\
  0x8000 build/partition_table/partition-table.bin \\
  0x10000 build/blink.bin
\`\`\`

esptool can only talk to the ROM's serial bootloader, so the chip must be in **download mode**: GPIO0 low while it comes out of reset. Dev boards do this automatically with two transistors driven by the USB-UART chip's DTR and RTS lines. When that fails, do it by hand: hold BOOT, tap EN (reset), release BOOT. You should see the ROM print a line containing \`waiting for download\`.`,

    { t: 'callout', kind: 'note', md: `**Old tutorials.** esptool v5 renamed its commands with hyphens (\`write-flash\`, \`erase-flash\`, \`flash-id\`); older versions and most tutorials use \`esptool.py write_flash\`. ESP-IDF before v4.0 also had a GNU Make build (\`make menuconfig\`, \`make flash\`) that no longer exists. If a tutorial tells you to edit a \`Makefile\` or \`component.mk\`, it predates the CMake build system.` },

    { t: 'callout', kind: 'mistake', md: `**Editing \`sdkconfig\` options and then running \`set-target\`.** \`set-target\` regenerates the configuration from defaults for the new chip. Anything you set in menuconfig that is not in \`sdkconfig.defaults\` is gone (the previous file is kept as \`sdkconfig.old\`). Set the target first, configure second.` },

    { t: 'predict', q: 'A project builds for an ESP32. You then add a large font table and the application binary grows to 1.2 MB. You are using the default partition table. What happens at `idf.py build`?',
      choices: [
        { t: 'The build fails with a message that the app partition is too small', ok: true, why: 'The build system checks the image size against the smallest app partition. 1.2 MB does not fit in the 1 MB factory partition.' },
        { t: 'The build succeeds and the app overflows into whatever follows in flash', why: 'The tools check the binary against the partition size precisely to prevent a silent overflow. The bootloader also only maps what the partition table describes.' },
        { t: 'The build succeeds because the flash chip is larger than 1 MB', why: 'The size of the flash chip is not the limit. The partition table entry is, and the default factory partition is 1 MB.' },
      ],
      reveal: `The partition, not the chip, is the limit. Your options are to shrink the image (\`idf.py size\` and \`idf.py size-components\` show where the bytes are; the failing step prints the overflow in bytes; lowering the log level and compiling for size are the usual first steps) or to give the app more room with a larger partition, via menuconfig's partition table options or a custom \`partitions.csv\`, provided the flash chip is big enough.` },

    { t: 'exercise', prompt: `With the default partition table, at which flash offset does the \`factory\` partition end (the first byte after it)? Give a hexadecimal address.`,
      hints: [
        `The partition starts at \`0x10000\` and its size is 1M.`,
        `In a partition table, 1M means 1024 × 1024 bytes = \`0x100000\`.`,
      ],
      solution: `\`0x10000 + 0x100000 = 0x110000\`. On a 4 MB (\`0x400000\`) flash chip, everything from \`0x110000\` upwards is unused by the default table, which is why a larger app partition or an extra data partition is usually possible.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?0*110000h?\\s*$'], nudge: 'Add the size (1M = 0x100000) to the start offset 0x10000.' } },

    { t: 'exercise', prompt: `**Find the bug.** To make room for a larger application and a data partition, someone wrote this custom \`partitions.csv\` for a 4 MB flash chip. The build stops with a partition table error. Find the faulty line, then give the lowest offset at which \`storage\` may start (hexadecimal).`,
      code: R`# Name,   Type, SubType, Offset,   Size
nvs,      data, nvs,     0x9000,   0x6000
phy_init, data, phy,     0xf000,   0x1000
factory,  app,  factory, 0x10000,  0x180000
storage,  data, spiffs,  0x110000, 0x100000`,
      hints: [
        `For each line work out where the partition ends: offset plus size. What must be true of the next line's offset?`,
        `\`factory\` now ends at \`0x10000 + 0x180000\`. Compare that with where \`storage\` starts.`,
        `The author enlarged \`factory\` from 1 MB to 1.5 MB but left \`storage\` at the offset that followed the old 1 MB partition.`,
      ],
      solution: `\`factory\` occupies \`0x10000\` up to but not including \`0x190000\`. \`storage\` starts at \`0x110000\`, inside it. The partition tool refuses the table ("Partitions overlap"), which is far better than the alternative: writing a file system over the second half of the application. \`storage\` may start at **\`0x190000\`**, and then ends at \`0x290000\`, inside a 4 MB (\`0x400000\`) chip.

A simpler habit removes this class of bug: leave the Offset column **empty**. The tool then places each partition directly after the previous one (aligning app partitions to \`0x10000\`), which is how the default table shipped with ESP-IDF is written.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?0*190000h?\\s*$'], nudge: 'Where does factory end? 0x10000 + 0x180000.' } },

    `## Harder: reading a boot log

Flash any example, open the monitor and press EN. Before your own output you should see lines from two earlier stages. The first lines come from the mask ROM and include the reset reason and boot mode (for example \`rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\` on an ESP32). Then the second-stage bootloader prints its version, the partition table it found and the segments it mapped.

For one boot of your own board, identify: which line is the last one printed by the ROM, which lines list the partitions, and which line is the first from the application. Then hold BOOT while pressing EN and explain the difference in the \`boot:\` value. Being able to tell which stage printed the last line is the fastest way to localise a boot failure.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Get Started', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html' },
      { title: 'ESP-IDF Build System', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/build-system.html' },
      { title: 'Partition Tables', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/partition-tables.html' },
      { title: 'Application Startup Flow', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/startup.html' },
      { title: 'esptool documentation', url: 'https://docs.espressif.com/projects/esptool/en/latest/esp32/' },
    ] },
  ],
  quiz: [
    { q: 'Why is the second-stage bootloader written at `0x1000` on an ESP32 but at `0x0` on an ESP32-C3?', kind: 'arch', choices: [
      { t: 'Each chip\'s mask ROM loads the bootloader from a fixed offset', ok: true, why: 'The first-stage bootloader is in ROM and cannot be changed; the offset it reads from is a fixed property of each chip.' },
      { t: 'It is a menuconfig option whose default differs between the two targets', why: 'The partition table offset is configurable, but the bootloader offset is not: the code that reads it is in ROM, before any configuration exists.' },
      { t: 'RISC-V chips need the reset vector at address zero of the flash', why: 'The offset is a position in external flash, not a CPU address. The CPU starts executing in mask ROM on both chips.' },
    ] },
    { q: 'You changed the log level in menuconfig and rebuilt. Which file recorded your change?', kind: 'concept', choices: [
      { t: '`sdkconfig`', ok: true, why: 'menuconfig writes the full configuration to sdkconfig, and the build generates sdkconfig.h from it.' },
      { t: '`CMakeLists.txt`', why: 'CMakeLists files describe sources and dependencies. Kconfig options are stored separately so they can be changed without editing build scripts.' },
      { t: '`partitions.csv`', why: 'That file only describes the flash layout. It has nothing to do with compile-time options such as log level.' },
    ] },
    { q: 'esptool reports "Failed to connect: No serial data received". What is the most direct manual remedy on a typical dev board?', kind: 'circuit', choices: [
      { t: 'Hold BOOT, tap EN, release BOOT, then retry', ok: true, why: 'That sequence holds GPIO0 low through reset, which puts the ROM in download mode even if the auto-reset circuit did not manage it.' },
      { t: 'Run `idf.py fullclean`, rebuild, then retry the flash', why: 'That deletes build output on the PC. The error is about the chip not answering on the serial port, which no rebuild can affect.' },
      { t: 'Lower the application log level so the port is quiet', why: 'The application is not running when esptool connects. The chip must be in the ROM serial bootloader, which depends on GPIO0 at reset.' },
    ] },
    { q: 'A component you wrote in `components/sensor/` includes `driver/gpio.h` and the build says the header cannot be found, though `main` includes it without trouble. Why?', kind: 'code', choices: [
      { t: 'The component must list the GPIO driver in `REQUIRES` or `PRIV_REQUIRES`', ok: true, why: 'Only `main` gets every component implicitly. Other components see only the include paths of components they declare.' },
      { t: 'Driver headers can only be included from `main`; other components must call through it', why: 'Any component may include driver headers directly. Ask what differs between how `main` and an ordinary component obtain their include paths.' },
      { t: 'The GPIO driver must first be enabled in menuconfig for components other than `main`', why: 'There is no such per-component switch, and `main` is using the driver in the same build without one.' },
    ] },
    { q: '`idf.py size` shows the app is 40 kB over its partition. Which action attacks the cause rather than moving the limit?', kind: 'concept', choices: [
      { t: 'Run `idf.py size-components` and shrink the largest contributors', ok: true, why: 'Per-component size shows where the bytes are (often logging strings, unused protocol stacks or tables), which is where reductions come from.' },
      { t: 'Buy a module with more flash, so that the same partition table has room to spare', why: 'More flash only helps after the partition table is also changed, and it leaves the image as large as before.' },
      { t: 'Erase the whole flash before flashing, to free the space old images occupy', why: 'Erasing does not change the size of the image or the partition; the size check happens at build time on the PC.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 3. Arduino vs ESP-IDF, C and C++
lessons.push({
  id: 'esp-l-frameworks', title: 'Arduino versus ESP-IDF, and writing C and C++ for it', minutes: 45,
  summary: 'What Arduino hides, what app_main really is, and how ESP-IDF code reports errors and logs.',
  skills: ['esp-arduino-map', 'esp-error-handling', 'esp-logging'],
  blocks: [
    `## Two blinks, one chip

Search for "ESP32 blink" and you find two kinds of program. One has \`setup()\` and \`loop()\`. The other has \`app_main()\` and a \`while (1)\` with \`vTaskDelay\`. Both make the same pin toggle on the same silicon. If you can only read one of them, half of the code you find online is closed to you, and you cannot tell which abstraction is responsible when something misbehaves.`,

    { t: 'code', lang: 'cpp', status: 'reviewed', caption: 'Arduino framework', code: R`const int LED = 4;          // choose a pin for your board

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}` },

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'ESP-IDF', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"

#define LED_GPIO GPIO_NUM_4          /* choose a pin for your board */

void app_main(void)
{
    gpio_reset_pin(LED_GPIO);
    gpio_set_direction(LED_GPIO, GPIO_MODE_OUTPUT);

    while (1) {
        gpio_set_level(LED_GPIO, 1);
        vTaskDelay(pdMS_TO_TICKS(500));
        gpio_set_level(LED_GPIO, 0);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}`, explain: [
      { lines: '1-2', md: 'FreeRTOS headers. `FreeRTOS.h` must come before any other FreeRTOS header.' },
      { lines: '9', md: '`gpio_reset_pin` puts the pad in a known state: its IO MUX function is set to plain GPIO, input and output are disabled and the pull-up is enabled. Some pads power up routed to another peripheral (GPIO12–15 to JTAG, for instance), and this undoes that.' },
      { lines: '10', md: 'Enables the output driver for this pad: one bit is written to `GPIO_ENABLE_W1TS`, and the GPIO matrix is told to drive the pad from the `GPIO_OUT` register.' },
      { lines: '13,15', md: 'Writes one bit to `GPIO_OUT_W1TS` (set) or `GPIO_OUT_W1TC` (clear). The pin changes within a few CPU cycles; no driver task or interrupt is involved.' },
      { lines: '14,16', md: '`vTaskDelay` puts this task to sleep for a number of scheduler ticks. The CPU runs other tasks, or idles, until it wakes.' },
    ] },

    `## Same hardware underneath

The Arduino core for ESP32 is a library **built on ESP-IDF**. There is no separate "Arduino firmware". The mapping is direct:

| Arduino | What runs underneath |
|---|---|
| \`setup()\` / \`loop()\` | A FreeRTOS task created by the core calls \`setup()\` once, then \`loop()\` forever |
| \`pinMode\`, \`digitalWrite\` | The GPIO driver and the same registers |
| \`delay(ms)\` | \`vTaskDelay\`: the task sleeps, other tasks run |
| \`Serial.begin\`, \`Serial.print\` | The UART driver (or USB CDC) |
| \`analogRead\` | The ADC driver with a default attenuation and width |
| \`WiFi.begin\` | \`esp_wifi\`, \`esp_netif\` and the event loop |
| Board menu options | A precompiled \`sdkconfig\` you mostly cannot change |

What Arduino hides is choice. The configuration is fixed when the core is compiled, the IDF version is whatever that core release bundles, and drivers are wrapped in defaults. That is helpful for a first prototype and limiting when you need a non-default partition table, security features, precise control of a peripheral or a known library version.`,

    { t: 'callout', kind: 'decision', md: `**This course uses ESP-IDF in C.** The goal is to understand the machine: the scheduler, the drivers, the flash layout, the security features. Those are first-class in ESP-IDF and partly hidden in Arduino. Arduino remains a reasonable choice for a quick experiment or when a library you need exists only there. A middle path exists: the Arduino core can be added to an ESP-IDF project **as a component**, giving you \`menuconfig\` and the IDF build with Arduino libraries on top. It supports specific IDF versions only, so check the Arduino core's documentation for the pairing before you rely on it.` },

    { t: 'callout', kind: 'note', md: `**Arduino core versions differ too.** Arduino-ESP32 core 3.x changed several APIs from 2.x (the LEDC PWM functions, for example, went from \`ledcSetup\` + \`ledcAttachPin\` to \`ledcAttach\`). A sketch that will not compile is often written for the other major version.` },

    `## app_main is a task

On a bare-metal microcontroller, \`main()\` is all there is. On ESP-IDF, by the time \`app_main()\` is called the scheduler is already running, and \`app_main\` is the body of one task, the **main task**, with a modest stack (a few kilobytes, set by \`CONFIG_ESP_MAIN_TASK_STACK_SIZE\`) and a low priority.

Three consequences:

- \`app_main\` **may return**. The main task is deleted; every other task you created keeps running.
- A large local array in \`app_main\` can overflow the main task's stack.
- A loop in \`app_main\` that never blocks starves lower-priority work on that core and will trip the task watchdog. Always sleep with \`vTaskDelay\` or block on a queue.`,

    `## Errors: esp_err_t

Nearly every ESP-IDF function returns \`esp_err_t\`, an integer where \`ESP_OK\` is zero. The compiler does not force you to look at it. There are three things you can do with it, and choosing between them is an engineering decision:`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'Three ways to treat an error', code: R`#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"

static const char *TAG = "cfg";

esp_err_t load_interval(uint32_t *out_ms)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open("settings", NVS_READONLY, &h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "nvs_open failed: %s", esp_err_to_name(err));
        return err;                                   /* 1: propagate */
    }
    err = nvs_get_u32(h, "interval", out_ms);
    nvs_close(h);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        *out_ms = 1000;                               /* 2: recover */
        return ESP_OK;
    }
    return err;
}

void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());                /* 3: abort */
    uint32_t ms;
    if (load_interval(&ms) != ESP_OK) {
        ms = 1000;
    }
    ESP_LOGI(TAG, "interval %u ms", (unsigned)ms);
}`, explain: [
      { lines: '13-14', md: 'Propagate: this function cannot fix the problem, so it reports it and lets the caller decide. `esp_err_to_name` turns the code into text such as `ESP_ERR_NVS_NOT_FOUND`.' },
      { lines: '18-20', md: 'Recover: a missing key on first boot is expected, so substitute a default. Note that `nvs_close` is called before the early return; a leaked handle is a resource leak.' },
      { lines: '27', md: '`ESP_ERROR_CHECK` prints the error, file and line and calls `abort()`, which resets the chip. Appropriate only when continuing is pointless.' },
      { lines: '32', md: 'On a 32-bit ESP target `uint32_t` is `unsigned long` on some toolchains, so `%u` with a cast (or `PRIu32` from `<inttypes.h>`) avoids a format warning.' },
    ] },

    { t: 'callout', kind: 'mistake', md: `**Wrapping everything in \`ESP_ERROR_CHECK\`.** Examples do it to stay short. In a product it converts every transient fault into a reboot: a sensor that fails to acknowledge once, a Wi-Fi network that is briefly absent. The device then appears to "randomly reset". Use it for initialisation that cannot fail in a working device, and handle runtime errors.` },

    `## Logging

\`ESP_LOGE\`, \`ESP_LOGW\`, \`ESP_LOGI\`, \`ESP_LOGD\`, \`ESP_LOGV\` print error, warning, info, debug and verbose messages. Each takes a **tag** (a short string naming the module) and a printf-style format. A line looks like \`I (1234) cfg: interval 1000 ms\`: level, milliseconds since boot, tag, message.

Two filters apply. The **compile-time maximum level** (\`CONFIG_LOG_MAXIMUM_LEVEL\`, Info by default) removes more verbose calls from the binary entirely, format strings included. The **run-time level** can then be lowered per tag with \`esp_log_level_set("wifi", ESP_LOG_WARN)\`. A debug message that does not appear is usually compiled out, not broken.`,

    `## C++ on ESP-IDF

ESP-IDF compiles \`.cpp\` files with a modern C++ compiler and you may write components in C++. The caveats:

- \`app_main\` is called from C startup code, so in a \`.cpp\` file it must be declared \`extern "C" void app_main(void)\`. Without it the linker reports an undefined reference to \`app_main\`, because the C++ compiler has mangled the name.
- **Exceptions and RTTI are disabled by default** to save flash and RAM. \`throw\` aborts, and \`dynamic_cast\`/\`typeid\` are unavailable, until you enable them in menuconfig. Check before pulling in a library that depends on either.
- C-style designated initialisers (\`.mode = GPIO_MODE_OUTPUT\`) are allowed in C++20 only **in declaration order** and without skipping into nested designators freely. Config structs copied from C examples sometimes need their fields reordered.
- Global objects with constructors run before \`app_main\`, when little of the system is ready. Do not touch drivers from a global constructor.`,

    { t: 'predict', q: 'What does this program do after printing `starting`?', code: R`static void blink_task(void *arg)
{
    while (1) {
        gpio_set_level(GPIO_NUM_4, 1);
        vTaskDelay(pdMS_TO_TICKS(250));
        gpio_set_level(GPIO_NUM_4, 0);
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}

void app_main(void)
{
    gpio_set_direction(GPIO_NUM_4, GPIO_MODE_OUTPUT);
    printf("starting\n");
    xTaskCreate(blink_task, "blink", 2048, NULL, 5, NULL);
}`,
      choices: [
        { t: 'The LED blinks forever', ok: true, why: 'Returning from app_main only deletes the main task. The scheduler and blink_task carry on.' },
        { t: 'The chip resets, because main returned', why: 'On a hosted C program returning from main ends the process. Here app_main is one task among several and the system keeps running without it.' },
        { t: 'The LED stays off, because the task is deleted with its creator', why: 'FreeRTOS tasks are independent once created. Deleting the task that called xTaskCreate does not affect the new task.' },
      ],
      reveal: `\`app_main\` is the main task's function. When it returns, ESP-IDF deletes that task and frees its stack. \`blink_task\` was created as its own task with its own 2048-byte stack and continues to be scheduled. This is the normal structure of an ESP-IDF application: \`app_main\` initialises things, creates tasks and leaves.` },

    { t: 'exercise', prompt: `The function below aborts the whole device if the sensor does not answer. Rewrite \`read_sensor\` so that it tries up to three times, 50 ms apart, logs a warning for each failure with the error name, and returns the last error to its caller if all three fail. \`sensor_read_raw\` is some driver call returning \`esp_err_t\`.`,
      code: R`int read_sensor(void)
{
    int value;
    ESP_ERROR_CHECK(sensor_read_raw(&value));
    return value;
}`,
      hints: [
        `The function now has two things to report: a value and a status. Which one should be the return value in ESP-IDF style, and how does the other get out?`,
        `Return \`esp_err_t\` and write the value through a pointer parameter, as \`nvs_get_u32\` does.`,
        `A \`for\` loop with three iterations; return \`ESP_OK\` from inside as soon as a read succeeds; \`vTaskDelay(pdMS_TO_TICKS(50))\` between attempts.`,
      ],
      solution: `\`\`\`c
static const char *TAG = "sensor";

esp_err_t read_sensor(int *out)
{
    esp_err_t err = ESP_FAIL;
    for (int attempt = 1; attempt <= 3; attempt++) {
        err = sensor_read_raw(out);
        if (err == ESP_OK) {
            return ESP_OK;
        }
        ESP_LOGW(TAG, "read failed (attempt %d): %s", attempt, esp_err_to_name(err));
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    return err;
}
\`\`\`

The caller now decides what a dead sensor means: show a fault, use the last good value, or go to a safe state. That decision belongs to the application, not to a driver wrapper, and certainly not to \`abort()\`.` },

    `## Harder: reading an Arduino sketch as IDF

Find an Arduino sketch for a sensor you own (or any I2C sensor library example). For each Arduino call in \`setup()\` and \`loop()\`, write down which ESP-IDF driver it must be using and one configuration decision the library made for you that you could not see: the I2C clock speed, the pull-up setting, the ADC attenuation, the task stack size of \`loop()\`. When a sketch works on the bench and fails in a product, the cause is often one of those invisible defaults.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Error Handling', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/error-handling.html' },
      { title: 'ESP-IDF Logging library', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/log.html' },
      { title: 'ESP-IDF C++ Support', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/cplusplus.html' },
      { title: 'Arduino core for ESP32 (source)', url: 'https://github.com/espressif/arduino-esp32', note: 'See its documentation for use as an ESP-IDF component and supported IDF versions' },
    ] },
  ],
  quiz: [
    { q: 'In an Arduino sketch on an ESP32, what is `delay(1000)` doing to the processor?', kind: 'concept', choices: [
      { t: 'Blocking the calling FreeRTOS task for about a second; other tasks can run', ok: true, why: 'The Arduino core implements delay with vTaskDelay, so the loop task sleeps and the scheduler runs whatever else is ready.' },
      { t: 'Spinning in a calibrated counting loop with interrupts disabled', why: 'That is how delay works on some small 8-bit boards. On the ESP32 the core sits on FreeRTOS, and a busy loop of that length would trip a watchdog.' },
      { t: 'Putting the whole chip into deep sleep and waking it on a timer', why: 'Deep sleep powers down the CPU and loses RAM contents; it must be requested explicitly and the program restarts afterwards.' },
    ] },
    { q: 'A `.cpp` file defines `void app_main() { ... }` and the link fails with "undefined reference to app_main". Why?', kind: 'code', choices: [
      { t: 'The C++ compiler mangled the name; it needs `extern "C"`', ok: true, why: 'Startup code calls the unmangled C symbol app_main. Declaring the function extern "C" makes the C++ compiler emit that exact symbol.' },
      { t: 'C++ projects must define `main()` instead, and the startup code calls that', why: 'The entry point ESP-IDF calls is always app_main, in either language. The problem is the symbol name the compiler produced for it.' },
      { t: 'ESP-IDF does not compile C++ source files unless a menuconfig option is set', why: 'C++ is supported and widely used. The file compiled; it is the link step that failed to match a symbol.' },
    ] },
    { q: 'You add `ESP_LOGD(TAG, "raw=%d", raw);` and nothing is printed, although `ESP_LOGI` lines from the same file appear. Most likely cause?', kind: 'code', choices: [
      { t: 'Debug is above the compile-time maximum log level, so the call was compiled out', ok: true, why: 'The default maximum level is Info. More verbose calls are removed at compile time unless the maximum is raised in menuconfig.' },
      { t: 'The tag string is too long for the debug level, which truncates tags', why: 'Tags are ordinary strings with no practical length limit of that kind, and the Info lines use the same tag successfully.' },
      { t: '`%d` is not supported by the debug and verbose macros, which take strings only', why: 'ESP_LOGx uses the normal printf formatting from the C library, and %d is supported.' },
    ] },
    { q: 'A field device calls `ESP_ERROR_CHECK(i2c_master_transmit(...))` for every sensor read. A connector works loose once a day. What does the user observe?', kind: 'arch', choices: [
      { t: 'The device reboots each time a read fails', ok: true, why: 'ESP_ERROR_CHECK calls abort() on any non-OK result, and abort resets the chip.' },
      { t: 'The read silently returns zero', why: 'Silent failure is what happens when the return value is ignored. This macro does the opposite: it treats any error as fatal.' },
      { t: 'The driver retries until the sensor answers', why: 'No retry is built into the macro or implied by it. Retrying is something your code must do explicitly.' },
    ] },
    { q: 'Which is a genuine reason to choose ESP-IDF over the Arduino framework for a product?', kind: 'concept', choices: [
      { t: 'You need control of sdkconfig, the partition table and secure boot', ok: true, why: 'Those are configured through the IDF build and menuconfig, which the plain Arduino flow fixes in advance.' },
      { t: 'ESP-IDF programs run the CPU at a higher clock frequency than Arduino sketches can', why: 'Both frameworks run on the same chip at the same clock; Arduino is a layer on top of the same SDK.' },
      { t: 'The Arduino core has no Wi-Fi support, so networking needs ESP-IDF', why: 'The Arduino core exposes Wi-Fi through its own library, implemented with the same esp_wifi driver.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 4. GPIO
lessons.push({
  id: 'esp-l-gpio', title: 'GPIO: digital outputs and inputs', minutes: 45,
  summary: 'gpio_config_t field by field, what the registers underneath do, and why a floating input lies.',
  skills: ['esp-gpio-config', 'esp-pin-plan'],
  blocks: [
    `## A button that presses itself

You connect a push button between a GPIO and ground, configure the pin as an input and print its level every 100 ms. With the button released the output is a mixture of 0s and 1s that changes when you wave your hand near the wire. With it pressed you get a steady 0.

The code reads the pin correctly. The pin has nothing to read. When the button is open, nothing connects the pin to any voltage, and a CMOS input with nothing driving it settles wherever stray charge and nearby fields push it. Configuring a GPIO is deciding what the pad does electrically, and that is four separate decisions.`,

    `## What a pad can do

Each GPIO pad has an output driver that can be enabled or not, an input buffer, a weak pull-up resistor to 3.3 V and a weak pull-down to ground, each with its own switch. On the ESP32 the digital signals reach the pad through one of two routes:

- **IO MUX**: a direct, fast connection from a few fixed peripheral signals to particular pads.
- **GPIO matrix**: a large switch that can route almost any peripheral signal to almost any pad, at the cost of a little delay. This is why UART, I2C and PWM pins are your choice on an ESP32.

Plain GPIO uses these registers (names from the ESP32 Technical Reference Manual, "IO MUX and GPIO Matrix" chapter):

| Register | Effect of writing a 1 to bit n |
|---|---|
| \`GPIO_ENABLE_W1TS\` / \`W1TC\` | Enable / disable the output driver of GPIO n |
| \`GPIO_OUT_W1TS\` | Drive GPIO n high |
| \`GPIO_OUT_W1TC\` | Drive GPIO n low |
| \`GPIO_IN\` (read) | Bit n is the level currently seen at the pad |

W1TS means "write 1 to set", W1TC "write 1 to clear". Bits written as 0 are left alone. That makes setting one pin a single write with no read-modify-write sequence, so an interrupt arriving in the middle cannot corrupt another pin's state. GPIO32 and above live in a second set of registers (\`GPIO_OUT1\` and so on), which is why the driver takes a 64-bit pin mask.`,

    { t: 'widget', name: 'register-bits', props: { challenge: 'set-bit' }, caption: 'Practise the bit expression the GPIO driver builds for you.' },

    `## gpio_config_t, field by field`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'LED output and button input', code: R`#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"

#define LED_GPIO    GPIO_NUM_4       /* choose pins for your board */
#define BUTTON_GPIO GPIO_NUM_27

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

    const gpio_config_t btn_cfg = {
        .pin_bit_mask = 1ULL << BUTTON_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn_cfg));

    while (1) {
        int pressed = (gpio_get_level(BUTTON_GPIO) == 0);
        gpio_set_level(LED_GPIO, pressed);
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}`, explain: [
      { lines: '12', md: '`pin_bit_mask` is a 64-bit mask, one bit per GPIO, so one call can configure several pins. `1ULL` matters: `1 << 34` with a 32-bit `int` is undefined behaviour and silently configures the wrong pin or none.' },
      { lines: '13', md: '`mode` controls the output driver and input buffer. `GPIO_MODE_OUTPUT` enables the driver only; reading the pin back then returns 0. Use `GPIO_MODE_INPUT_OUTPUT` if you need to read what you drive, and `GPIO_MODE_OUTPUT_OD` for open-drain.' },
      { lines: '14-15', md: 'The pull resistors. Both off for a push-pull output, which always drives the pin itself.' },
      { lines: '16', md: 'No interrupt. The next lesson uses this field.' },
      { lines: '18', md: 'What `gpio_config` does to the hardware, for each pin in the mask: it selects the plain-GPIO function in that pad\'s IO MUX register and sets or clears the input-enable, pull-up and pull-down bits there; it sets or clears the pin\'s bit in the output-enable register (`GPIO_ENABLE`); and it writes the interrupt type into the pin\'s `GPIO_PINn` register. Nothing is installed: no task, no interrupt handler.' },
      { lines: '23', md: 'Internal pull-up on: with the button open the pad is pulled to 3.3 V and reads 1. Pressing connects it to ground, which easily overpowers the weak pull-up, and it reads 0.' },
      { lines: '30', md: 'The button is **active low**: pressed is 0. Converting to a named boolean here keeps the inversion in one place.' },
      { lines: '31', md: '`gpio_set_level` writes the pin\'s bit to `GPIO_OUT_W1TS` or `GPIO_OUT_W1TC`. `gpio_get_level` on the line above reads the pin\'s bit from `GPIO_IN`.' },
      { lines: '32', md: 'Polling every 10 ms is fast enough for a human and lets other tasks run.' },
    ] },

    { t: 'widget', name: 'gpio-electrical', caption: 'Switch one pin between push-pull, open-drain, floating input and pulled input, and watch the voltage against the logic thresholds.' },

    `## Electrical limits

A GPIO is a small transistor pair, not a power supply. The ESP32 datasheet's DC characteristics table gives the output current at maximum drive strength as typically 40 mA sourcing and 28 mA sinking, and its absolute-maximum table limits the total over all pins. Those figures say what a pad can deliver, not what you should ask of it: the output voltage sags as the current rises, and the datasheet gives no "recommended" per-pin current. Keeping each pin to a few milliamps is conservative practice, and plenty for an LED with a series resistor of a few hundred ohms. A motor, relay or LED strip needs a transistor.

The pins are **3.3 V logic**. An input is guaranteed to read 1 above 0.75 × VDD and 0 below 0.25 × VDD (about 2.5 V and 0.8 V on a 3.3 V supply); in between, the result is undefined. The highest input voltage the datasheet allows is VDD + 0.3 V, and it makes no 5 V-tolerance statement, so treat every pin as **not 5 V tolerant**: a 5 V signal must go through a divider or level shifter.

The internal pull resistors are weak (typically 45 kΩ according to the datasheet). They are adequate for a button on a short wire. For long wires, noisy environments or I2C, fit external resistors.`,

    { t: 'callout', kind: 'mistake', md: `**Enabling the pull-up on GPIO34–39.** \`gpio_config\` on an input-only ESP32 pin with \`GPIO_PULLUP_ENABLE\` does not give you a pull-up, because the pad has none. In ESP-IDF v6.1 the call still returns \`ESP_OK\`: the only sign is one error line in the log from \`gpio_pullup_en\` ("input-only pad has no internal PU"), and the input floats exactly as in the opening problem. On those pins, add an external resistor.` },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** You will see \`gpio_pad_select_gpio(pin)\` followed by \`gpio_set_direction\`. The first function was removed from the public API in ESP-IDF v5; \`gpio_reset_pin\` or \`gpio_config\` replaces it. The \`gpio_config_t\` structure itself is unchanged since v4.` },

    { t: 'predict', q: 'This runs on a classic ESP32 with a button from GPIO34 to ground and nothing else connected to the pin. What is printed while the button is **released**?', code: R`const gpio_config_t cfg = {
    .pin_bit_mask = 1ULL << GPIO_NUM_34,
    .mode         = GPIO_MODE_INPUT,
    .pull_up_en   = GPIO_PULLUP_ENABLE,
};
gpio_config(&cfg);
while (1) {
    printf("%d\n", gpio_get_level(GPIO_NUM_34));
    vTaskDelay(pdMS_TO_TICKS(100));
}`,
      choices: [
        { t: 'A steady 1, because the pull-up was requested', why: 'That would need something pulling the pin to 3.3 V. On this particular pin the requested pull-up does not exist in the silicon.' },
        { t: 'A steady 0, because the button goes to ground', why: 'Nothing connects the pin to ground while the button is open, so there is no reason for it to sit at 0.' },
        { t: 'An unpredictable mix of 0 and 1', ok: true, why: 'GPIO34 has no internal pull resistors, so the request is ineffective and the open input floats.' },
      ],
      reveal: `GPIO34–39 have no pull-up or pull-down. Checking the return value would not have helped here: in v6.1 \`gpio_config\` returns \`ESP_OK\` and the only complaint is one error line in the log saying that an input-only pad has no internal pull-up. Read the log when a pin misbehaves. Two fixes: move the button to a pin with pull resistors, or add an external 10 kΩ from GPIO34 to 3.3 V.` },

    { t: 'exercise', prompt: `Modify the worked example so that each **press** of the button toggles the LED (press once: on; press again: off), instead of the LED following the button. Keep polling every 10 ms; do not use interrupts yet.`,
      hints: [
        `The LED must change on an event, not on a level. What is the event, in terms of two successive samples?`,
        `Keep the previous sample in a variable. A press is "previous was released and current is pressed".`,
        `Because you sample only every 10 ms, most contact bounce (a few milliseconds) falls between samples. That is a crude but effective debounce.`,
      ],
      solution: `\`\`\`c
bool led_on = false;
bool was_pressed = false;

while (1) {
    bool pressed = (gpio_get_level(BUTTON_GPIO) == 0);
    if (pressed && !was_pressed) {        /* falling edge at the pin = new press */
        led_on = !led_on;
        gpio_set_level(LED_GPIO, led_on);
    }
    was_pressed = pressed;
    vTaskDelay(pdMS_TO_TICKS(10));
}
\`\`\`

Add \`#include <stdbool.h>\`. The program keeps its own copy of the LED state instead of reading the pin back, because the pin is configured as output only and \`gpio_get_level\` would return 0.` },

    `## Harder: sharing a line

Two boards must both be able to pull one "fault" line low, and either may do so at any time. If both use push-pull outputs, one driving high while the other drives low is a short circuit from 3.3 V to ground through two transistors. Design the pin configuration and external parts so that no combination of states can cause that.

The answer is open-drain (\`GPIO_MODE_INPUT_OUTPUT_OD\`) on both boards with a single pull-up resistor: each board can only pull low or let go, the resistor supplies the high level, and each reads the line back to learn whether anyone is asserting it. This wired-AND arrangement is exactly how I2C's SDA and SCL work, which you will meet again in that lesson.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF GPIO & RTC GPIO', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html' },
      { title: 'ESP32 Technical Reference Manual', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf', note: 'Chapter "IO MUX and GPIO Matrix"' },
      { title: 'ESP32 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf', note: 'Section 5: absolute maximum ratings and DC characteristics (VIH, VIL, IOH, IOL, pull resistors)' },
    ] },
  ],
  quiz: [
    { q: 'Why does the GPIO driver write to `GPIO_OUT_W1TS` instead of reading `GPIO_OUT`, OR-ing a bit and writing it back?', kind: 'arch', choices: [
      { t: 'One write changes one pin, so no update to another pin can be lost in between', ok: true, why: 'Read-modify-write takes several instructions. If an interrupt or another core changes a different bit in between, the write-back undoes it. W1TS/W1TC avoid the read entirely.' },
      { t: '`GPIO_OUT` is write-only, so there is nothing to read back and OR', why: 'It can be read. The issue is what may happen between the read and the write, not whether the read is possible.' },
      { t: 'Writing through W1TS makes the pad switch faster and drive harder', why: 'Which register is used has no effect on the electrical output level; both end up setting the same output latch.' },
    ] },
    { q: 'A pin is configured with `GPIO_MODE_OUTPUT` and driven high. `gpio_get_level` on it returns 0. Why?', kind: 'code', choices: [
      { t: 'The input buffer is not enabled in output-only mode', ok: true, why: 'Reading needs the input path. GPIO_MODE_INPUT_OUTPUT enables both the driver and the input buffer.' },
      { t: 'The LED is pulling the pin below the logic threshold', why: 'A correctly sized LED and resistor load a push-pull output very little. And the function would return 0 even with nothing connected.' },
      { t: '`gpio_get_level` only works after an interrupt is configured', why: 'Reading a level is independent of interrupts; it simply samples the input register.' },
    ] },
    { q: 'What is wrong with `.pin_bit_mask = 1 << 33`?', kind: 'code', choices: [
      { t: '`1` is a 32-bit int, so the shift is undefined and does not select GPIO33', ok: true, why: 'The shift must be done in a 64-bit type: 1ULL << 33.' },
      { t: 'GPIO33 is input-only, so `gpio_config` rejects it', why: 'GPIO33 is an ordinary pin. The trouble is in how the C expression is evaluated before the driver ever sees it.' },
      { t: 'Pin masks start at bit 1 for GPIO0, so GPIO33 needs `1 << 34`', why: 'Bit n of the mask corresponds to GPIO n. The numbering is not the problem.' },
    ] },
    { q: 'A 5 V sensor output is wired directly to an ESP32 GPIO and "works". What is the right assessment?', kind: 'circuit', choices: [
      { t: 'It exceeds the pin\'s rated input voltage and needs a divider or level shifter', ok: true, why: 'The datasheet limits a pin\'s input to VDD + 0.3 V and makes no 5 V-tolerance statement. Overstress may damage the pad gradually rather than at once.' },
      { t: 'It is fine, because enabling the internal pull-down limits the voltage at the pad', why: 'A weak pull resistor cannot hold down a low-impedance 5 V driver, and it is not a protection device.' },
      { t: 'It is fine as long as the pin stays configured as an input and never drives', why: 'The voltage limit applies to the pad whatever its mode. Configuration does not change what the silicon can withstand.' },
    ] },
    { q: 'For a button wired between a GPIO and **3.3 V**, which configuration gives a defined level when the button is open?', kind: 'circuit', choices: [
      { t: 'Input with pull-down enabled; pressed reads 1', ok: true, why: 'The pull-down holds the open pin at 0, and the button overrides it to 1.' },
      { t: 'Input with pull-up enabled; pressed reads 0', why: 'With the button going to 3.3 V, a pull-up means the pin is high both open and closed, so the press is invisible.' },
      { t: 'Input with both pulls disabled, since the button supplies the level', why: 'Then nothing defines the level when the button is open, and the input floats.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 5. Interrupts
lessons.push({
  id: 'esp-l-interrupts', title: 'Interrupt handling', minutes: 50,
  summary: 'GPIO interrupts, what an ISR may not do, IRAM_ATTR, and handing work to a task.',
  skills: ['esp-gpio-isr'],
  blocks: [
    `## The crash that only happens sometimes

A device counts pulses from a flow meter in a GPIO interrupt and logs each pulse with \`ESP_LOGI\`. On the bench it works for hours. In the field, where it also saves readings to flash, it resets every few days with a panic. Slow the pulses and it survives longer.

Polling could miss short pulses, so an interrupt is the right tool. The faults are in what the handler does and where its code lives. An interrupt service routine (ISR) runs in a restricted world, and on the ESP32 that world has one restriction other microcontrollers do not have.`,

    `## What happens on an interrupt

When the enabled edge occurs, the GPIO peripheral sets a status bit and raises a CPU interrupt. The CPU finishes the current instruction, saves the interrupted context and jumps to the handler. Whatever was running, including a task in the middle of \`printf\` or holding a mutex, is frozen until the handler returns.

From that follow the rules for any ISR on ESP-IDF:

- **Never block.** No \`vTaskDelay\`, no waiting on a queue or mutex. There is no task to put to sleep.
- **Use only the \`FromISR\` FreeRTOS functions**: \`xQueueSendFromISR\`, \`xSemaphoreGiveFromISR\`, \`xTaskNotifyFromISR\`.
- **No \`printf\`, no \`ESP_LOGx\`, no \`malloc\`.** They take locks. If the interrupted task holds the same lock, the handler waits for a task that cannot run.
- **Be short.** While the handler runs, same or lower priority interrupts wait.

The pattern that satisfies all four is **deferral**: the ISR records the minimum (which pin, a timestamp), passes it to a task through a queue, and returns. The task does the slow work in normal context.`,

    { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'isr-defer' }, caption: 'An ISR hands an event to a task. Watch when the handler task actually runs.' },

    `## The ESP32-specific rule: the flash cache

Your application code executes from external flash through a cache. Whenever anything **writes or erases flash** (NVS, OTA, a file system), the cache is disabled for the duration, because the flash chip cannot serve code fetches while it is being programmed. During that window, code and constant data located in flash are unreachable.

ESP-IDF handles this as follows. An interrupt registered normally is simply **postponed** until the cache is back; it is safe, but its latency can be tens of milliseconds during an erase. An interrupt registered with the flag \`ESP_INTR_FLAG_IRAM\` stays enabled during flash operations, and in exchange **everything it touches must be in internal RAM**: the handler itself, every function it calls and every constant it reads.

- \`IRAM_ATTR\` on a function places its code in IRAM (the \`0x4008xxxx\` range).
- \`DRAM_ATTR\` on a constant places it in data RAM instead of flash.

If an IRAM-registered handler reaches code in flash while the cache is off, the result is a panic reporting that the cache is disabled but a cached memory region was accessed. It happens only when an interrupt coincides with a flash write, hence "every few days".`,

    { t: 'callout', kind: 'decision', md: `**Mark ISRs \`IRAM_ATTR\` as a habit, and keep them trivial.** With the default GPIO ISR service (flag 0) a handler in flash works, merely delayed during flash writes. Marking it \`IRAM_ATTR\` costs a few bytes of RAM, removes the cache-miss delay on entry, and means the handler is already correct if someone later installs the service with \`ESP_INTR_FLAG_IRAM\` for lower latency. The alternative, a large handler that calls library functions, cannot be made IRAM-safe at all.` },

    `## Worked example: a button interrupt with a queue`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'GPIO interrupt deferred to a task', code: R`#include <stdio.h>
#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_attr.h"
#include "esp_log.h"

#define BUTTON_GPIO GPIO_NUM_27      /* choose a pin for your board */

static const char *TAG = "button";
static QueueHandle_t s_evt_queue;

static void IRAM_ATTR button_isr(void *arg)
{
    uint32_t gpio_num = (uint32_t)arg;
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(s_evt_queue, &gpio_num, &woken);
    if (woken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

static void button_task(void *arg)
{
    uint32_t gpio_num;
    TickType_t last = 0;
    while (1) {
        if (xQueueReceive(s_evt_queue, &gpio_num, portMAX_DELAY) == pdTRUE) {
            TickType_t now = xTaskGetTickCount();
            if (now - last >= pdMS_TO_TICKS(50)) {
                ESP_LOGI(TAG, "press on GPIO %" PRIu32, gpio_num);
                last = now;
            }
        }
    }
}

void app_main(void)
{
    s_evt_queue = xQueueCreate(10, sizeof(uint32_t));
    xTaskCreate(button_task, "button", 3072, NULL, 10, NULL);

    const gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << BUTTON_GPIO,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .intr_type    = GPIO_INTR_NEGEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&cfg));
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(BUTTON_GPIO, button_isr, (void *)BUTTON_GPIO));
}`, explain: [
      { lines: '15', md: '`IRAM_ATTR` places the handler in internal RAM. It calls only `xQueueSendFromISR`, which ESP-IDF also keeps in IRAM.' },
      { lines: '17', md: 'The argument registered with the handler comes back here. Passing the pin number lets one handler serve several pins.' },
      { lines: '18-19', md: 'Copies four bytes into the queue without blocking. If the queue is full the call fails immediately and the event is dropped. `woken` is set if this unblocked a task of higher priority than the one interrupted.' },
      { lines: '20-22', md: 'Requests a context switch on exit, so the waiting task runs immediately instead of at the next tick. Without it the response can be up to one tick (10 ms by default) late.' },
      { lines: '30', md: 'The task sleeps here, using no CPU, until the ISR posts an event.' },
      { lines: '31-35', md: 'Debounce in the task: ignore events closer than 50 ms to the last accepted one. Logging is safe here because this is task context.' },
      { lines: '42-43', md: 'Create the queue and the task **before** enabling the interrupt. An interrupt that fires first would post to a NULL queue.' },
      { lines: '49', md: 'Falling edge: the pin is pulled up and the button pulls it low.' },
      { lines: '51', md: '`gpio_config` writes the edge type into the pin\'s `GPIO_PINn` register. From now on a falling edge sets the pin\'s bit in `GPIO_STATUS`, but no CPU interrupt is connected to it yet.' },
      { lines: '52', md: '`gpio_install_isr_service` allocates one CPU interrupt (with `esp_intr_alloc`, on the core that calls it) for the GPIO peripheral\'s interrupt source and attaches the driver\'s own dispatcher to it. On each interrupt the dispatcher reads `GPIO_STATUS`, clears the bits it is handling through `GPIO_STATUS_W1TC`, and calls the handler registered for each pin. The argument is the interrupt flags; 0 is the default. Call it once in the whole program.' },
      { lines: '53', md: 'Stores the handler and its argument in the dispatcher\'s table and sets this pin\'s interrupt-enable bits in `GPIO_PINn`, so its status bit now reaches the CPU.' },
    ] },

    `## Debounce

A mechanical switch does not close once. The contacts bounce for a few milliseconds and produce a burst of edges, each of which is a real interrupt. The example filters them by time in the task. Alternatives are an RC filter on the pin, or disabling the pin's interrupt in the ISR (\`gpio_intr_disable\`) and re-enabling it from the task after a delay. Pick one; a product that counts button presses without any debounce counts wrongly.`,

    { t: 'widget', name: 'state-machine', props: { machine: 'debounce' }, caption: 'A debounce state machine stepped by raw edges.' },

    { t: 'callout', kind: 'mistake', md: `**Logging from an ISR "just to see if it fires".** \`ESP_LOGI\` in a handler may appear to work, then deadlock or panic when it interrupts a task that is itself logging. To observe an ISR, toggle a spare GPIO and watch it with a logic analyser, increment a counter that a task prints, or use \`ESP_DRAM_LOGI\`/\`ESP_EARLY_LOGI\`, which are designed for restricted contexts and for debugging only.` },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** Many call \`gpio_isr_register\` to install one global handler and then read the GPIO status registers by hand. The per-pin service shown here (\`gpio_install_isr_service\` + \`gpio_isr_handler_add\`) is simpler and has been stable since v4. The two approaches cannot be mixed.` },

    { t: 'predict', q: 'This handler is attached to a 1 kHz square wave. What do you expect?', code: R`static void pulse_isr(void *arg)
{
    static int count;
    count++;
    ESP_LOGI("pulse", "count=%d", count);
    vTaskDelay(1);
}`,
      choices: [
        { t: 'It prints 100 lines per second, because each call waits one tick', why: 'That would require the logging lock and the scheduler to be usable from interrupt context, which they are not.' },
        { t: 'It crashes or hangs: an ISR must not block or take locks', ok: true, why: 'vTaskDelay needs a task to suspend and there is none in interrupt context; ESP_LOGI takes a lock that the interrupted task may hold.' },
        { t: 'It works but counts only every second pulse', why: 'There is no mechanism here that would skip alternate edges. The failure is more fundamental than a missed count.' },
      ],
      reveal: `Two violations. \`vTaskDelay\` from an ISR is invalid: FreeRTOS has no task context to block, and the usual outcome is an assertion failure or panic. \`ESP_LOGI\` formats text and takes a lock; at 1 kHz it would also keep the CPU in interrupt context most of the time, which trips the interrupt watchdog. The handler should increment the counter and return, and a task should print the count once a second.` },

    { t: 'exercise', prompt: `Change the worked example into a pulse counter for the flow meter: the ISR must count every falling edge with no debounce and no queue traffic per pulse, and a task must log the number of pulses seen in each one-second interval. Describe or write the changed ISR and task.`,
      hints: [
        `Sending one queue item per pulse at kilohertz rates wastes CPU. What is the least the ISR can do per pulse?`,
        `Increment a counter. The task reads it once a second. Which qualifier does a variable shared with an ISR need, and is a 32-bit increment safe here?`,
        `Declare it \`static volatile uint32_t\`. To get pulses-per-interval, keep the previous reading in the task and subtract. A single aligned 32-bit read is one instruction on these CPUs, so the task sees either the old or the new value, never a mixture.`,
      ],
      solution: `\`\`\`c
static volatile uint32_t s_pulses;

static void IRAM_ATTR pulse_isr(void *arg)
{
    s_pulses++;
}

static void report_task(void *arg)
{
    uint32_t prev = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        uint32_t now = s_pulses;            /* one 32-bit read */
        ESP_LOGI(TAG, "%" PRIu32 " pulses/s", now - prev);
        prev = now;
    }
}
\`\`\`

Only the ISR writes \`s_pulses\`, and the task reads it in one access, so no lock is needed. Unsigned subtraction gives the right difference even when the counter wraps. If the task also had to **reset** the counter, that would be a read-modify-write shared with the ISR and would need a critical section (\`portENTER_CRITICAL\`), a topic the RTOS section treats in depth. For serious pulse counting the ESP32 also has a hardware pulse counter peripheral (PCNT) that needs no interrupt per pulse.` },

    `## Harder: latency budget

A rotary encoder produces edges 200 µs apart at full speed. Your design saves a setting to NVS whenever the user stops turning. Explain, using the flash-cache rule, what can go wrong for an encoder ISR registered with default flags, and list two different ways to make the design robust. (Consider: when the save happens relative to movement; the IRAM flag and what it demands of the handler; and whether a hardware peripheral could do the counting.)`,

    { t: 'refs', items: [
      { title: 'ESP-IDF GPIO API: interrupts', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html' },
      { title: 'ESP-IDF Interrupt Allocation', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/intr_alloc.html', note: 'IRAM-safe interrupt handlers' },
      { title: 'SPI Flash API: concurrency constraints', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/spi_flash/spi_flash_concurrency.html' },
    ] },
  ],
  quiz: [
    { q: 'Why can application code not run from flash while NVS is writing a value?', kind: 'arch', choices: [
      { t: 'The flash cache is off during the write, so code stored in flash is unreachable', ok: true, why: 'The flash chip cannot serve reads while programming or erasing, so ESP-IDF turns the cache off for that period.' },
      { t: 'NVS disables all interrupts globally until the write completes', why: 'Interrupts whose handlers are IRAM-safe remain enabled. The limitation is about where code is stored, not a blanket interrupt mask.' },
      { t: 'The CPU clock is lowered during flash writes, stalling code in flash', why: 'No clock change is involved. The issue is access to instructions that live in the chip being written.' },
    ] },
    { q: 'An ISR registered with `ESP_INTR_FLAG_IRAM` calls a helper function that is not marked `IRAM_ATTR`. When does this fail?', kind: 'code', choices: [
      { t: 'Only when the interrupt fires during a flash write or erase', ok: true, why: 'The helper lives in flash. It is reachable most of the time and unreachable exactly while the cache is disabled.' },
      { t: 'Every time the interrupt fires', why: 'While the cache is enabled, calling a function in flash from an ISR works normally. The failure needs a coincidence with a flash operation.' },
      { t: 'Never; the linker moves called functions to IRAM automatically', why: 'Placement is per function and explicit. The linker does not follow call graphs to relocate callees.' },
    ] },
    { q: 'What is the purpose of the `woken` flag and `portYIELD_FROM_ISR()` after `xQueueSendFromISR`?', kind: 'code', choices: [
      { t: 'To switch to the unblocked task on leaving the ISR if it has higher priority', ok: true, why: 'Without the yield, the higher-priority task would wait until the next scheduler tick to run.' },
      { t: 'To acknowledge the interrupt in the GPIO peripheral so that the same pin can fire again', why: 'The GPIO ISR service clears the interrupt status itself. The flag concerns the scheduler, not the peripheral.' },
      { t: 'To re-enable the interrupts that were masked when the handler was entered', why: 'Nothing was disabled by the handler. The flag only tells the scheduler whether a context switch is worthwhile.' },
    ] },
    { q: 'A button interrupt on a falling edge reports 3–6 events per press. The most likely cause?', kind: 'circuit', choices: [
      { t: 'Contact bounce producing several real edges', ok: true, why: 'Mechanical contacts chatter for milliseconds, and each transition through the threshold is a genuine edge.' },
      { t: 'The queue is duplicating items', why: 'A FreeRTOS queue delivers each item exactly once. The extra events were generated before the queue.' },
      { t: 'The internal pull-up is too strong, so the line rings on release', why: 'Pull-up strength affects current and rise time, not the number of times the contacts physically make and break.' },
    ] },
    { q: 'The queue in the worked example is created after `gpio_isr_handler_add`. What can happen?', kind: 'code', choices: [
      { t: 'An early interrupt calls `xQueueSendFromISR` with a NULL handle and crashes', ok: true, why: 'The interrupt is live as soon as the handler is added. Everything the handler uses must exist before that.' },
      { t: 'Nothing; pin interrupts stay disabled until `app_main` returns to the scheduler', why: 'There is no such deferral. A pin interrupt is active from the moment it is enabled.' },
      { t: 'The queue is created with the wrong item size', why: 'Item size is set by the argument to xQueueCreate and does not depend on the order of the calls.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 6. ADC
lessons.push({
  id: 'esp-l-adc', title: 'Analog input and the ADC', minutes: 45,
  summary: 'The oneshot driver, attenuation, calibration, and how to get a number you can trust.',
  skills: ['esp-adc-read'],
  blocks: [
    `## Two boards, two voltages

You measure a battery through a divider. Board A reports 3.71 V, board B reports 3.94 V, and a multimeter says both are at 3.80 V. The code computes \`raw * 3.3 / 4095\`. The last digit also flickers by twenty counts between readings.

That formula assumes an ideal converter with a 3.3 V reference. The ESP32's ADC has neither property. Its reference is an internal voltage that is 1100 mV by design and differs from chip to chip, its input range is set by a programmable attenuator, and its transfer curve bends near the ends. Getting volts out takes the driver's calibration, and getting stable volts takes averaging.`,

    `## How the ESP32 ADC is arranged

- It is a successive-approximation converter. The classic ESP32 gives 12-bit results (0–4095); other chips differ, and \`ADC_BITWIDTH_DEFAULT\` selects the chip's native width.
- There are two units. On the ESP32, **ADC1** is on GPIO32–39 and **ADC2** shares pins with other functions and is used by Wi-Fi. Use ADC1 unless you have a reason not to. On the ESP32-C3, ADC2 oneshot reads are not supported at all.
- The converter itself measures up to roughly its reference voltage. An **attenuator** in front scales larger inputs down:

| Attenuation | Effective measurement range on the ESP32 | Use |
|---|---|---|
| \`ADC_ATTEN_DB_0\` | 100–950 mV | Small signals; finest resolution in mV per count |
| \`ADC_ATTEN_DB_2_5\` | 100–1250 mV | |
| \`ADC_ATTEN_DB_6\` | 150–1750 mV | |
| \`ADC_ATTEN_DB_12\` | 150–2450 mV | Widest range |

These are the ranges over which the ESP32 datasheet (ADC characteristics table) specifies the calibrated error; other chips have their own table. Two things follow. Even at the widest setting the top of the range is **well below 3.3 V** and the response flattens beyond it, and the converter cannot measure down to 0 V either. Design dividers to keep the signal in the middle of the range.

- Each chip's reference error is measured at the factory and stored in eFuse. The **calibration** driver uses it to convert raw codes to millivolts.`,

    { t: 'widget', name: 'adc-lab', props: { bits: 12, vref: 3.3 }, caption: 'An ideal ADC: quantisation steps and aliasing. A real ESP32 adds reference error and non-linearity on top of this model.' },

    `## Worked example: calibrated voltage on one channel`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'Oneshot read with calibration (classic ESP32: line fitting)', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_log.h"

#define ADC_CHAN ADC_CHANNEL_6       /* ADC1 channel 6 is GPIO34 on the ESP32 */
#define ADC_ATTEN ADC_ATTEN_DB_12

static const char *TAG = "adc";

void app_main(void)
{
    adc_oneshot_unit_handle_t adc;
    const adc_oneshot_unit_init_cfg_t unit_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_cfg, &adc));

    const adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc, ADC_CHAN, &chan_cfg));

    adc_cali_handle_t cali = NULL;
#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    const adc_cali_line_fitting_config_t cali_cfg = {
        .unit_id  = ADC_UNIT_1,
        .atten    = ADC_ATTEN,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    if (adc_cali_create_scheme_line_fitting(&cali_cfg, &cali) != ESP_OK) {
        cali = NULL;
    }
#endif

    while (1) {
        int sum = 0;
        for (int i = 0; i < 16; i++) {
            int raw;
            ESP_ERROR_CHECK(adc_oneshot_read(adc, ADC_CHAN, &raw));
            sum += raw;
        }
        int raw_avg = sum / 16;

        int mv = 0;
        if (cali != NULL && adc_cali_raw_to_voltage(cali, raw_avg, &mv) == ESP_OK) {
            ESP_LOGI(TAG, "raw %d  ->  %d mV", raw_avg, mv);
        } else {
            ESP_LOGW(TAG, "raw %d (uncalibrated)", raw_avg);
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}`, explain: [
      { lines: '8', md: 'Channels are numbered per ADC unit, not by GPIO. The mapping is chip-specific; `adc_oneshot_io_to_channel()` converts a GPIO number for you.' },
      { lines: '15-19', md: 'Creates a handle for ADC unit 1 and enables the SAR ADC\'s clock and power. One handle per unit; channels are configured on it. No interrupt or task is installed: a oneshot conversion is started and polled by the calling task.' },
      { lines: '21-25', md: 'Attenuation and width are per channel. Configuring the channel also hands the pad to the analog (RTC IO) side: its digital input and pull resistors are switched off so they cannot load the signal.' },
      { lines: '43', md: '`adc_oneshot_read` takes the driver\'s lock for the unit, writes the channel\'s attenuation, starts one conversion, waits for the done flag and returns the 12-bit code. It blocks for tens of microseconds and must not be called from an ISR.' },
      { lines: '28-37', md: 'Calibration schemes are chip-specific. The ESP32 and S2 use **line fitting**; the S3, C3 and C6 use **curve fitting** (`adc_cali_curve_fitting_config_t` and `adc_cali_create_scheme_curve_fitting`, guarded by `ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED`). Creation can fail if the eFuse values are absent, so the code carries on uncalibrated and says so.' },
      { lines: '40-46', md: 'Sixteen conversions summed and divided. Averaging N readings of random noise reduces it by about the square root of N.' },
      { lines: '49', md: 'Converts a raw code to millivolts **at the pin** using the per-chip reference value. If there is an external divider, scale by its ratio afterwards.' },
    ] },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** Before ESP-IDF v5 the calls were \`adc1_config_width\`, \`adc1_config_channel_atten\`, \`adc1_get_raw\` from \`driver/adc.h\`, with calibration in \`esp_adc_cal.h\`. That legacy driver was deprecated in v5.0 and **removed in v6.0**, so such code no longer builds. Also, \`ADC_ATTEN_DB_11\` was renamed \`ADC_ATTEN_DB_12\` during v5 (the same setting); v6.1 has only the new name.` },

    `## Noise and source impedance

The ADC is a few millimetres from a radio transmitter. Readings jitter, most of all while Wi-Fi transmits. Three measures, in order of cost:

1. **Average** in software, as above.
2. **A small capacitor** (around 100 nF) from the ADC pin to ground. The converter samples by briefly connecting a small internal capacitor to the pin; a high-impedance source such as a 100 kΩ divider cannot recharge it in time, and the external capacitor acts as a local reservoir.
3. **Keep the signal mid-range** and away from the ends of the curve.`,

    { t: 'callout', kind: 'mistake', md: `**Converting with \`raw * 3.3 / 4095\`.** This is the opening problem. It is wrong three ways: the full-scale voltage depends on attenuation and is not 3.3 V, the reference differs per chip, and the curve is not straight. Use \`adc_cali_raw_to_voltage\`. If calibration is unavailable, say so in the output and do not present the number as volts.` },

    { t: 'predict', q: 'On a classic ESP32 this code reads a sensor on GPIO26 and works. Then Wi-Fi station mode is added to the firmware. What is the most likely result?', code: R`adc_oneshot_unit_init_cfg_t cfg = { .unit_id = ADC_UNIT_2 };
adc_oneshot_new_unit(&cfg, &adc2);
/* ... channel for GPIO26 configured ... */
esp_err_t err = adc_oneshot_read(adc2, chan, &raw);`,
      choices: [
        { t: 'Readings continue unchanged, because the ADC and the radio are separate blocks', why: 'That would require ADC2 to be independent of the radio. On this chip the Wi-Fi driver uses that converter.' },
        { t: '`adc_oneshot_read` starts returning errors while Wi-Fi is active', ok: true, why: 'ADC2 is shared with Wi-Fi on the ESP32; the driver arbitrates and the application read loses.' },
        { t: 'Wi-Fi fails to connect because the ADC holds the pin', why: 'The radio has priority over the application in this arbitration, so Wi-Fi is not the side that suffers.' },
      ],
      reveal: `GPIO26 is an ADC2 pin. On the ESP32, S2 and S3, ADC2 is also used by Wi-Fi and \`adc_oneshot_read\` arbitrates between the two, so reads fail with a timeout error when Wi-Fi has the converter. The code above also ignores \`err\`, so \`raw\` would silently keep a stale or uninitialised value. Move the sensor to an ADC1 pin (GPIO32–39) and check the return value.` },

    { t: 'exercise', prompt: `A single lithium cell (up to 4.2 V) is measured through a divider of two equal resistors, so the pin sees half the battery voltage. The calibrated reading at the pin is 1880 mV. What is the battery voltage in millivolts?`,
      hints: [
        `\`adc_cali_raw_to_voltage\` reports the voltage at the pin, after the divider.`,
        `Equal resistors divide by two, so multiply back by two.`,
      ],
      solution: `1880 mV × 2 = **3760 mV**. The divider also keeps the pin at 2.1 V when the cell is full, inside the 150–2450 mV range for 12 dB attenuation. Two practical points: a divider permanently connected across a battery draws current forever (use high values plus the capacitor from this lesson, or switch the divider with a transistor), and resistor tolerance adds directly to the error (two 1 % parts can be nearly 2 % out in ratio).`,
      answer: { type: 'number', value: 3760, tol: 5, unit: 'mV' } },

    { t: 'exercise', prompt: `**Find the bug.** This fragment replaces the set-up in the worked example. It builds and runs with no error, yet 2.00 V at the pin is logged as roughly 0.6 V. One line is wrong. Which configuration field is it, and in which structure?`,
      code: R`const adc_oneshot_chan_cfg_t chan_cfg = {
    .atten    = ADC_ATTEN_DB_12,
    .bitwidth = ADC_BITWIDTH_DEFAULT,
};
ESP_ERROR_CHECK(adc_oneshot_config_channel(adc, ADC_CHANNEL_6, &chan_cfg));

const adc_cali_line_fitting_config_t cali_cfg = {
    .unit_id  = ADC_UNIT_1,
    .atten    = ADC_ATTEN_DB_0,
    .bitwidth = ADC_BITWIDTH_DEFAULT,
};
ESP_ERROR_CHECK(adc_cali_create_scheme_line_fitting(&cali_cfg, &cali));`,
      hints: [
        `Every call succeeds, so the mistake is two settings that disagree, not one that is invalid. Which settings appear twice?`,
        `The raw code is produced by the hardware with one attenuation and converted to millivolts by a formula built for another.`,
        `Compare \`.atten\` in the two structures. A raw code of about 2300 means about 2 V at 12 dB, but only about 0.6 V on the 0 dB line.`,
      ],
      solution: `The **\`.atten\` field of \`cali_cfg\`** says 0 dB while the channel is configured for 12 dB. The attenuator really is at 12 dB, so 2.00 V produces a mid-scale raw code; the calibration handle then converts that code with the 0 dB line, whose full scale is about 1 V. Neither driver knows about the other, so nothing reports an error.

The worked example avoids this by using one \`#define ADC_ATTEN\` in both places. That is the general repair for "two settings that must agree": make them one setting. The same rule gives you the answer to the question below about sharing a calibration handle.`,
      answer: { type: 'text', accept: ['atten'], nudge: 'Which setting is given twice, with two different values?' } },

    `## Harder: choosing attenuation for resolution

A temperature sensor outputs 0.1 V to 0.9 V. You could read it at 12 dB attenuation with everything else, or at 0 dB. Reason about which gives finer resolution in millivolts per count and why, and what you must check in the datasheet before committing to 0 dB (on the ESP32 the specified range at 0 dB is 100–950 mV, so this sensor uses all of it and its lowest readings sit on the edge; allow margin for chip-to-chip variation). Then decide whether one calibration handle can serve both this channel and a battery channel at 12 dB. (It cannot: the calibration scheme is created for a specific attenuation, so each attenuation in use needs its own handle.)`,

    { t: 'refs', items: [
      { title: 'ESP-IDF ADC Oneshot Mode Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/adc_oneshot.html' },
      { title: 'ESP-IDF ADC Calibration Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/adc_calibration.html' },
      { title: 'ADC oneshot source documentation (ADC2 and Wi-Fi)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/adc/adc_oneshot.rst' },
    ] },
  ],
  quiz: [
    { q: 'Two ESP32 boards give different raw codes for the same input voltage. What mainly explains it?', kind: 'arch', choices: [
      { t: 'The internal ADC reference voltage varies from chip to chip', ok: true, why: 'The reference is 1100 mV by design but differs per device; factory-measured values in eFuse let the calibration driver correct for it.' },
      { t: 'The boards have different amounts of flash', why: 'Flash size has no connection to the analog front end or its reference.' },
      { t: 'One board is running the ADC at a different bit width by default', why: 'The same firmware configures the same width on both. The difference is analog, inside the chip.' },
    ] },
    { q: 'Why does a 100 nF capacitor at the ADC pin improve readings from a 100 kΩ + 100 kΩ divider?', kind: 'circuit', choices: [
      { t: 'It supplies the brief charge that the ADC\'s sampling capacitor draws', ok: true, why: 'The sample-and-hold needs charge in a very short time; a local reservoir keeps the pin voltage from dipping during sampling.' },
      { t: 'It raises the ADC reference voltage, widening the input range', why: 'The reference is internal to the chip and is not affected by a capacitor on an input pin.' },
      { t: 'It increases the divider ratio, so the pin sits nearer mid-range', why: 'A capacitor to ground does not change the DC ratio set by the two resistors.' },
    ] },
    { q: 'Firmware written for an ESP32 uses `adc_cali_create_scheme_line_fitting`. On an ESP32-S3 the build fails at that call. Why?', kind: 'code', choices: [
      { t: 'The S3 supports curve-fitting calibration, not line fitting', ok: true, why: 'Calibration schemes are chip-specific, which is why code guards them with the ADC_CALI_SCHEME_..._SUPPORTED macros.' },
      { t: 'The S3 has no ADC calibration data in eFuse at all', why: 'S3 chips carry factory ADC calibration data in eFuse as well. Note that the failure is at build time, before any eFuse is read.' },
      { t: 'Calibration requires Wi-Fi to be initialised first on the S3', why: 'Calibration only reads eFuse values and has no dependency on the radio.' },
    ] },
    { q: 'You average 64 readings instead of 16. Roughly how does random noise in the result change?', kind: 'concept', choices: [
      { t: 'It halves', ok: true, why: 'Averaging N uncorrelated samples reduces noise by √N. √64/√16 = 2.' },
      { t: 'It falls to a quarter', why: 'Noise falls with the square root of the number of samples, not in direct proportion.' },
      { t: 'It is unchanged; averaging only helps with offset', why: 'Averaging does nothing for a constant offset. Random variation is precisely what it reduces.' },
    ] },
    { q: 'A signal that swings up to 3.2 V is read at 12 dB attenuation and the top of the range looks compressed. What is the sound fix?', kind: 'circuit', choices: [
      { t: 'Divide the signal down so it stays in the middle of the ADC range', ok: true, why: 'The usable range ends below the supply and the response flattens near the top. Keeping the signal away from the ends avoids the non-linear region.' },
      { t: 'Switch to 0 dB attenuation to get more headroom at the top of the range', why: 'Lower attenuation gives a smaller input range, so the signal would clip much sooner.' },
      { t: 'Increase the bit width so the top of the range has more codes', why: 'More bits subdivide the same range more finely. They do not extend the range or straighten the curve.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 7. LEDC PWM
lessons.push({
  id: 'esp-l-ledc', title: 'PWM with LEDC', minutes: 40,
  summary: 'A timer plus a channel, the frequency-against-resolution trade-off, and hardware fades.',
  skills: ['esp-ledc-pwm'],
  blocks: [
    `## The dimmer with a whine and a staircase

You dim an LED with PWM at 1 kHz and 8 bits. Two complaints come back: a phone camera shows banding, and at the dim end the brightness visibly jumps between steps. Raising the frequency to 40 kHz cures the banding. Raising the resolution to 16 bits for smoother dimming then makes the driver refuse to start with an error about frequency and resolution.

Frequency and resolution are not independent settings. They are two ways of spending one budget: the timer's input clock.`,

    `## How LEDC makes a waveform

The LED Control peripheral (LEDC) is the ESP32's general PWM generator. It has two layers:

- A **timer** is a counter that counts up from 0 to 2^bits − 1 and wraps. Its clock divider sets how fast it counts, which sets the PWM **frequency**; its width in bits is the **duty resolution**.
- A **channel** drives one GPIO. It compares the timer's count with a **duty** value: the output is high while count < duty and low for the rest of the period.

Several channels can share a timer (same frequency, different duties). Duty is expressed in counts, so at 13 bits the range is 0–8191 and 50 % is 4096.

The budget: in one PWM period the counter must take 2^bits steps, and it cannot step faster than its source clock. So

\`frequency × 2^bits ≤ source clock\`

With an 80 MHz source at 5 kHz, 80 000 000 / 5 000 = 16 000 counts are available per period, enough for 13 bits (8192) but not 14 (16 384). At 40 kHz only 2000 counts fit: 10 bits. That is the error in the opening problem. Which clock sources exist and the maximum timer width are chip-specific; \`LEDC_AUTO_CLK\` lets the driver choose.`,

    { t: 'widget', name: 'pwm-lab', props: { freq: 5000, duty: 50, bits: 13 }, caption: 'Change frequency and resolution and watch which combinations the clock can support.' },

    `## Worked example`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'LEDC: fixed duty, then a hardware fade', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/ledc.h"
#include "esp_err.h"

#define LED_GPIO   4                 /* choose a pin for your board */
#define PWM_MODE   LEDC_LOW_SPEED_MODE
#define PWM_TIMER  LEDC_TIMER_0
#define PWM_CHAN   LEDC_CHANNEL_0
#define PWM_BITS   LEDC_TIMER_13_BIT
#define PWM_MAX    ((1 << 13) - 1)

void app_main(void)
{
    const ledc_timer_config_t timer_cfg = {
        .speed_mode      = PWM_MODE,
        .timer_num       = PWM_TIMER,
        .duty_resolution = PWM_BITS,
        .freq_hz         = 5000,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer_cfg));

    const ledc_channel_config_t chan_cfg = {
        .gpio_num   = LED_GPIO,
        .speed_mode = PWM_MODE,
        .channel    = PWM_CHAN,
        .timer_sel  = PWM_TIMER,
        .duty       = 0,
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&chan_cfg));

    ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, PWM_CHAN, PWM_MAX / 4));
    ESP_ERROR_CHECK(ledc_update_duty(PWM_MODE, PWM_CHAN));
    vTaskDelay(pdMS_TO_TICKS(2000));

    ESP_ERROR_CHECK(ledc_fade_func_install(0));
    while (1) {
        ledc_set_fade_with_time(PWM_MODE, PWM_CHAN, PWM_MAX, 1500);
        ledc_fade_start(PWM_MODE, PWM_CHAN, LEDC_FADE_WAIT_DONE);
        ledc_set_fade_with_time(PWM_MODE, PWM_CHAN, 0, 1500);
        ledc_fade_start(PWM_MODE, PWM_CHAN, LEDC_FADE_WAIT_DONE);
    }
}`, explain: [
      { lines: '7', md: '`LEDC_LOW_SPEED_MODE` exists on every chip. The classic ESP32 also has `LEDC_HIGH_SPEED_MODE`; newer chips do not, so low-speed mode is the portable choice.' },
      { lines: '15-22', md: 'Configures the counter: 13 bits wide, wrapping 5000 times a second. On the ESP32 `LEDC_AUTO_CLK` picks among the 80 MHz APB clock, the 8 MHz RC oscillator and the 1 MHz REF_TICK; the driver then computes a divider with 8 fractional bits and writes it, with the counter width, to this timer\'s configuration register. If the pair cannot be met from any clock source, the call fails with a message telling you to reduce one of them. The ESP32 has 4 timers and 8 channels in each speed mode, and timers up to 20 bits wide.' },
      { lines: '24-32', md: 'Binds a channel to a GPIO and a timer. The GPIO matrix routes the channel output to the pad, so most output-capable pins work. `hpoint` is the count at which the output goes high, normally 0.' },
      { lines: '34-35', md: 'Two steps on purpose: `ledc_set_duty` stores the new value, `ledc_update_duty` latches it into the hardware at a period boundary so no pulse is cut short.' },
      { lines: '38', md: 'Installs the driver\'s handler on the LEDC interrupt, which the hardware raises when a fade finishes. Needed once before any fade function. Until this line the driver used no interrupt at all.' },
      { lines: '40-41', md: 'Asks the hardware to step the duty from its current value to the target over 1500 ms, and blocks this task until done. The stepping is done by the peripheral, not by a software loop.' },
    ] },

    { t: 'callout', kind: 'decision', md: `**Choosing frequency.** For LEDs, a few kilohertz avoids visible flicker; go higher if cameras matter. For a DC motor, above about 20 kHz moves the whine out of hearing, at the cost of resolution and switching loss. A hobby servo wants 50 Hz with a pulse of roughly 1–2 ms, which uses only a small slice of the period, so pick a high resolution to get fine position steps. Choose frequency from the load first, then take the largest resolution the clock allows.` },

    { t: 'callout', kind: 'mistake', md: `**Forgetting \`ledc_update_duty\`.** \`ledc_set_duty\` alone changes nothing on the pin. The symptom is a PWM output stuck at its initial duty with no error anywhere.` },

    { t: 'callout', kind: 'note', md: `**Arduino readers.** \`analogWrite\` and the \`ledc*\` Arduino functions sit on this same peripheral. Their signatures changed between Arduino-ESP32 core 2.x and 3.x, so match example code to your core version.` },

    { t: 'predict', q: 'Human brightness perception is roughly logarithmic. With 8-bit PWM, where will a linear fade from 0 to 255 look worst?',
      choices: [
        { t: 'At the bright end, where steps are large in absolute terms', why: 'Every step is the same absolute size. What the eye responds to is the ratio between neighbouring levels.' },
        { t: 'At the dim end, where one step is a large relative change', ok: true, why: 'Going from duty 1 to 2 doubles the light; from 200 to 201 changes it by half a percent.' },
        { t: 'Evenly across the range', why: 'That would be true for a linear sensor. The eye is sensitive to relative, not absolute, changes.' },
      ],
      reveal: `Low duties are where the staircase shows, because each count is a large fraction of the current brightness. Two remedies combine well: use more bits (13 bits gives 32 times finer steps than 8), and map a linear "brightness" setting through a curve (gamma correction, for example duty ∝ level²) so steps are small where the eye is sensitive.` },

    { t: 'exercise', prompt: `An ESP32 LEDC timer runs from an 80 MHz clock. You need 25 kHz PWM for a fan. What is the largest whole number of bits of duty resolution available?`,
      hints: [
        `How many clock ticks fit in one PWM period?`,
        `80 000 000 / 25 000 = 3200 ticks per period.`,
        `Find the largest power of two that is not more than 3200.`,
      ],
      solution: `3200 counts per period. 2^11 = 2048 fits; 2^12 = 4096 does not. So **11 bits**, a duty range of 0–2047. The driver uses a fractional divider to hit 25 kHz with 2048 counts.`,
      answer: { type: 'number', value: 11, tol: 0, unit: 'bits' } },

    { t: 'exercise', prompt: `**Find the bug, then use the fix.** The worked example was changed to drive a fan at 25 kHz and half speed. It builds and every call returns \`ESP_OK\`, yet the fan runs flat out. Find the wrong line. Then, with the bug fixed, what duty value gives 30 %? (Give the number of counts.)`,
      code: R`#define PWM_BITS   LEDC_TIMER_10_BIT
#define PWM_MAX    ((1 << 13) - 1)

/* timer_cfg as in the worked example, except:
       .duty_resolution = PWM_BITS,
       .freq_hz         = 25000,                                    */

ESP_ERROR_CHECK(ledc_set_duty(PWM_MODE, PWM_CHAN, PWM_MAX / 2));   /* meant: 50 % */
ESP_ERROR_CHECK(ledc_update_duty(PWM_MODE, PWM_CHAN));`,
      hints: [
        `How many counts does one period of this timer have now? What number is actually passed as the duty?`,
        `The timer is 10 bits: it counts 0 to 1023. \`PWM_MAX / 2\` is still computed from 13 bits.`,
        `The output is high while count < duty. If duty is 4095 and the count never exceeds 1023, when does the output go low? For the second part: 30 % of 1024 counts.`,
      ],
      solution: `**\`PWM_MAX\` was left at 13 bits** when the resolution was lowered to 10. \`PWM_MAX / 2\` is 4095, but the counter wraps at 1024, so the count is always below the duty and the output never goes low: 100 %. In v6.1 \`ledc_set_duty\` does not range-check the duty, so nothing reports it.

Derive both constants from one number so they cannot drift apart:

\`\`\`c
#define PWM_BITS_N 10
#define PWM_BITS   ((ledc_timer_bit_t)PWM_BITS_N)   /* LEDC_TIMER_10_BIT has the value 10 */
#define PWM_MAX    ((1 << PWM_BITS_N) - 1)
\`\`\`

With the fix, 30 % is 0.30 × 1024 ≈ **307** counts.`,
      answer: { type: 'number', value: 307, tol: 1, unit: 'counts' } },

    `## Harder: driving a servo

A servo expects a 50 Hz signal whose high time runs from about 1.0 ms to 2.0 ms across its travel (check your servo's datasheet for exact limits). With a 14-bit LEDC timer at 50 Hz, compute the duty counts for 1.0 ms, 1.5 ms and 2.0 ms, and how many distinct positions that gives. (The period is 20 ms and 16 384 counts, so about 819, 1229 and 1638: roughly 820 steps of travel.) Then say what would happen to the step count if you had lazily chosen 8 bits, and why that makes the servo move in visible jerks.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF LED Control (LEDC)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/ledc.html' },
    ] },
  ],
  quiz: [
    { q: 'Two LEDC channels are attached to the same timer. What can differ between them?', kind: 'arch', choices: [
      { t: 'Duty cycle and GPIO, but not frequency', ok: true, why: 'Frequency and resolution belong to the shared counter; each channel only has its own compare value and pin.' },
      { t: 'Frequency, but not duty cycle', why: 'It is the other way round: the counter they share fixes how often the waveform repeats.' },
      { t: 'Everything; channels are fully independent', why: 'Independence stops at the timer. Channels that need different frequencies must use different timers.' },
    ] },
    { q: 'With a 13-bit timer, which duty value gives approximately 10 % high time?', kind: 'code', choices: [
      { t: '819', ok: true, why: '2^13 = 8192 counts per period, and 10 % of that is about 819.' },
      { t: '10', why: 'Duty is in timer counts, not percent. Ten counts out of 8192 is about 0.1 %.' },
      { t: '1638', why: 'That is 10 % of a 14-bit period of 16 384 counts. Work out how many counts this timer has per period.' },
    ] },
    { q: '`ledc_timer_config` fails for 100 kHz at 14 bits from an 80 MHz clock. Which change makes it succeed while keeping the frequency?', kind: 'concept', choices: [
      { t: 'Reduce the resolution to 9 bits', ok: true, why: '80 MHz / 100 kHz = 800 counts per period. 2^9 = 512 fits; 2^10 = 1024 does not.' },
      { t: 'Reduce the resolution to 12 bits', why: 'Twelve bits need 4096 counts per period, but only 800 clock ticks are available at this frequency.' },
      { t: 'Use a different GPIO', why: 'The limit comes from the counter and its clock. Pin routing has no part in it.' },
    ] },
    { q: 'Why is a duty change applied with a separate `ledc_update_duty` call?', kind: 'arch', choices: [
      { t: 'So the new value is latched at a period boundary and no pulse is cut short', ok: true, why: 'Changing the compare value mid-period could produce a glitch pulse. Staging the value and applying it synchronously avoids that.' },
      { t: 'Because writing the duty register needs the flash cache enabled first', why: 'Duty registers are ordinary peripheral registers with no relation to flash or its cache.' },
      { t: 'To give the application a window in which it can still cancel the change', why: 'The split exists for waveform integrity, not as an undo mechanism.' },
    ] },
    { q: 'A motor driven at 1 kHz PWM whines audibly. What is the trade-off in moving to 25 kHz?', kind: 'circuit', choices: [
      { t: 'The whine becomes inaudible, but fewer duty steps fit and switching losses rise', ok: true, why: 'Higher frequency consumes clock budget that would otherwise provide resolution, and each transition of the power transistor dissipates energy.' },
      { t: 'There is none; a higher PWM frequency is better in every respect for a motor', why: 'Every period needs its share of clock ticks, and the transistor switches more often. Both have costs.' },
      { t: 'The motor receives a lower average voltage at the same duty, so it slows down', why: 'Average voltage depends on duty, not on frequency, for an ideal switch.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 8. Hardware timers
lessons.push({
  id: 'esp-l-timers', title: 'Hardware timers: gptimer and esp_timer', minutes: 40,
  summary: 'Counting a known clock to measure and schedule, and what a timer callback is allowed to do.',
  skills: ['esp-timer'],
  blocks: [
    `## Sampling that drifts

A vibration logger must sample every 1 ms. The first version does the sample and then \`vTaskDelay(pdMS_TO_TICKS(1))\`. A spectrum of the recorded data shows the peaks smeared and in the wrong place. Measuring a debug pin shows samples arriving every 10 ms, sometimes 20.

The scheduler tick on ESP-IDF is 10 ms by default (100 Hz). \`vTaskDelay\` counts ticks, so it cannot express 1 ms, and its period also includes however long the work took. Regular timing below the tick, or timing that must not drift, needs a hardware timer.`,

    `## What a hardware timer is

A timer is a counter driven by a clock through a prescaler. If the count advances once per microsecond, then a compare value (an **alarm**) of 1000 fires an interrupt every millisecond, exactly, regardless of what tasks are doing.`,

    { t: 'widget', name: 'timer-lab', props: { mode: 'timer' }, caption: 'Clock, prescaler, counter and compare. Work out the settings for a given period.' },

    `ESP-IDF gives you two ways to use this:

| | \`gptimer\` (\`driver/gptimer.h\`) | \`esp_timer\` (\`esp_timer.h\`) |
|---|---|---|
| What it is | Direct use of one hardware timer | Many software timers multiplexed on one hardware timer |
| Callback runs in | **Interrupt context** | By default a high-priority **task** |
| Resolution | You choose (\`resolution_hz\`) | Microseconds |
| How many | A few per chip (chip-specific) | Limited only by memory |
| Callback may | Do almost nothing: \`FromISR\` calls only | Call normal non-blocking APIs; should still be short |
| Use for | Precise periodic sampling, pulse timing, input capture | Timeouts, periodic housekeeping, one-shot delays |

\`esp_timer_get_time()\` also returns microseconds since boot as a 64-bit integer, which is the easiest way to measure how long something took.`,

    { t: 'callout', kind: 'decision', md: `**Default to \`esp_timer\`; reach for \`gptimer\` when jitter matters.** An \`esp_timer\` callback is dispatched from a task, so it can be delayed by anything of higher priority and by critical sections: tens of microseconds typically, more under load. A \`gptimer\` alarm is a hardware interrupt with far lower jitter, but its callback has all the ISR restrictions from the interrupt lesson. A FreeRTOS software timer (\`xTimerCreate\`) is a third option with tick resolution only.` },

    `## Worked example: a 1 kHz gptimer that wakes a task`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'gptimer alarm deferred to a task with a task notification', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gptimer.h"
#include "esp_attr.h"
#include "esp_log.h"

static const char *TAG = "sample";
static TaskHandle_t s_sample_task;

static bool IRAM_ATTR on_alarm(gptimer_handle_t timer,
                               const gptimer_alarm_event_data_t *edata,
                               void *user_ctx)
{
    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(s_sample_task, &woken);
    return woken == pdTRUE;
}

static void sample_task(void *arg)
{
    uint32_t n = 0;
    while (1) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        /* take one sample here */
        if (++n % 1000 == 0) {
            ESP_LOGI(TAG, "%u samples", (unsigned)n);
        }
    }
}

void app_main(void)
{
    xTaskCreate(sample_task, "sample", 3072, NULL, 10, &s_sample_task);

    gptimer_handle_t timer;
    const gptimer_config_t cfg = {
        .clk_src       = GPTIMER_CLK_SRC_DEFAULT,
        .direction     = GPTIMER_COUNT_UP,
        .resolution_hz = 1000000,
    };
    ESP_ERROR_CHECK(gptimer_new_timer(&cfg, &timer));

    const gptimer_event_callbacks_t cbs = {
        .on_alarm = on_alarm,
    };
    ESP_ERROR_CHECK(gptimer_register_event_callbacks(timer, &cbs, NULL));

    const gptimer_alarm_config_t alarm = {
        .alarm_count  = 1000,
        .reload_count = 0,
        .flags.auto_reload_on_alarm = true,
    };
    ESP_ERROR_CHECK(gptimer_set_alarm_action(timer, &alarm));
    ESP_ERROR_CHECK(gptimer_enable(timer));
    ESP_ERROR_CHECK(gptimer_start(timer));
}`, explain: [
      { lines: '10-17', md: 'The alarm callback runs in interrupt context. It gives a task notification, the lightest way to wake one specific task, and returns `true` if a higher-priority task was woken so the driver requests a context switch.' },
      { lines: '23', md: 'The task blocks until notified. `pdTRUE` clears the count on exit, so if several alarms arrived while the task was busy it wakes once: you can detect overruns by using `pdFALSE` and checking the returned count.' },
      { lines: '33', md: 'The task is created first and its handle stored, because the callback uses it.' },
      { lines: '36-40', md: '`resolution_hz` asks for a 1 MHz count: one tick per microsecond. `gptimer_new_timer` claims a free hardware timer (the ESP32 has four: two timer groups of two, each a 64-bit counter behind a 16-bit prescaler) and writes the prescaler, here 80 for the 80 MHz APB clock.' },
      { lines: '43-46', md: 'Stores the callback and installs the driver\'s interrupt handler on this timer\'s interrupt source. Callbacks must be registered while the timer is still in its initial state, before `gptimer_enable`.' },
      { lines: '48-52', md: 'Alarm at count 1000, then reload the counter to 0 automatically: an exact 1 ms period with no accumulated error.' },
      { lines: '54-55', md: '`enable` arms the interrupt and takes any power-management lock; `start` lets the counter run.' },
    ] },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** Before ESP-IDF v5 the API was \`timer_init(TIMER_GROUP_0, TIMER_0, &config)\` with \`timer_isr_callback_add\`, from \`driver/timer.h\`. That legacy driver was deprecated in v5.0 and removed in v6.0; code using it does not build on v6.1. The concept (group, prescaler, alarm, auto-reload) is the same.` },

    { t: 'callout', kind: 'mistake', md: `**Doing the work in the alarm callback.** Reading a sensor over I2C, logging, or filling a large buffer inside \`on_alarm\` breaks the ISR rules and holds off other interrupts. At 1 kHz a callback that takes 300 µs also consumes 30 % of a core in interrupt context. Wake a task and return.` },

    { t: 'predict', q: 'A task runs this loop with the default 100 Hz tick. Roughly how often does `sample()` run?', code: R`while (1) {
    sample();                       /* takes about 0.2 ms */
    vTaskDelay(pdMS_TO_TICKS(5));
}`,
      choices: [
        { t: 'Every 5.2 ms: the work plus the requested delay', why: 'That assumes the delay has millisecond resolution. Delays are counted in scheduler ticks, and a tick here is 10 ms.' },
        { t: 'Every 10 ms: the delay rounds up to one tick', why: 'That would be a delay of one tick. Work out what pdMS_TO_TICKS(5) evaluates to with integer division.' },
        { t: 'As fast as the loop can spin, with no real delay', ok: true, why: 'pdMS_TO_TICKS(5) is 5 × 100 / 1000 = 0 in integer arithmetic, and a delay of 0 ticks only yields to equal-priority tasks.' },
      ],
      reveal: `\`pdMS_TO_TICKS(5)\` with a 10 ms tick rounds down to **0**. \`vTaskDelay(0)\` does not sleep; the loop runs flat out, starves lower-priority tasks and eventually trips the task watchdog. Any delay shorter than one tick has this trap. Use a hardware timer for sub-tick periods, or accept one tick as the minimum.` },

    { t: 'exercise', prompt: `Rewrite the periodic part of the worked example using \`esp_timer\` instead of \`gptimer\`: a periodic timer with a 1 ms period whose callback takes the sample directly. State one thing you gain and one you lose.`,
      hints: [
        `You need an \`esp_timer_create_args_t\` with at least \`.callback\` and \`.name\`, then \`esp_timer_create\` and a start function.`,
        `The period is given in microseconds: \`esp_timer_start_periodic(handle, 1000)\`.`,
        `The callback signature is \`void cb(void *arg)\`, and by default it runs in the esp_timer task, not in an ISR.`,
      ],
      solution: `\`\`\`c
#include "esp_timer.h"

static void sample_cb(void *arg)
{
    /* take one sample here: task context, keep it short */
}

void app_main(void)
{
    const esp_timer_create_args_t args = {
        .callback = sample_cb,
        .name     = "sample",
    };
    esp_timer_handle_t t;
    ESP_ERROR_CHECK(esp_timer_create(&args, &t));
    ESP_ERROR_CHECK(esp_timer_start_periodic(t, 1000));   /* microseconds */
}
\`\`\`

**Gain:** much less code, no dedicated hardware timer used up, and the callback runs in task context so ordinary non-blocking calls are allowed. **Lose:** timing precision. The callback is dispatched by the esp_timer task, so it is delayed whenever a higher-priority task or a long critical section is running, and a slow callback delays every other esp_timer. For audio or vibration sampling that jitter matters; for blinking an LED or a timeout it does not.` },

    `## Harder: measuring a pulse

An ultrasonic ranger outputs a pulse whose width is proportional to distance, from about 150 µs to 25 ms. Design two ways to measure it: (1) a GPIO interrupt on both edges that records \`esp_timer_get_time()\` at each, and (2) a busy loop that polls the pin. For each, estimate the error sources: interrupt latency (and what a flash write does to it), the cost of blocking a core for 25 ms, and what the task watchdog thinks of it. Which would you ship? Then look up the capture feature of the MCPWM peripheral or the RMT peripheral in the ESP-IDF documentation, which timestamp edges in hardware, and say why that beats both.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF General Purpose Timer (GPTimer)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gptimer.html' },
      { title: 'ESP-IDF ESP Timer (High Resolution Timer)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/esp_timer.html' },
    ] },
  ],
  quiz: [
    { q: 'A gptimer is created with `resolution_hz = 1000000` and an auto-reload alarm at count 250. How often does the alarm fire?', kind: 'code', choices: [
      { t: 'Every 250 µs (4 kHz)', ok: true, why: 'One count is 1 µs at 1 MHz resolution, so 250 counts is 250 µs.' },
      { t: 'Every 250 ms (4 Hz)', why: 'That would be the case at a 1 kHz count rate. The resolution here is a million counts per second.' },
      { t: 'Every 4 µs (250 kHz)', why: 'That divides the wrong way. The alarm period is the count multiplied by the tick time.' },
    ] },
    { q: 'Which is safe inside a gptimer `on_alarm` callback?', kind: 'code', choices: [
      { t: '`xQueueSendFromISR`, then returning whether a task was woken', ok: true, why: 'The callback runs in interrupt context, where only the FromISR family of FreeRTOS calls is permitted.' },
      { t: '`i2c_master_transmit_receive` to read one register from a sensor', why: 'A bus transaction blocks waiting for the transfer to finish, which is impossible in interrupt context.' },
      { t: '`ESP_LOGI` to record the time at which the alarm fired', why: 'Logging takes a lock and formats text. From an interrupt it can deadlock against the task it interrupted.' },
    ] },
    { q: 'Why does a loop of "do work, then `vTaskDelay(period)`" drift relative to a true periodic schedule?', kind: 'concept', choices: [
      { t: 'Each cycle lasts the work time plus the delay, so the period stretches', ok: true, why: 'The delay starts when the work ends. A hardware timer, or vTaskDelayUntil, anchors each cycle to an absolute time instead.' },
      { t: 'The FreeRTOS tick counter loses ticks whenever a task is delayed', why: 'The tick interrupt is reliable. The inaccuracy comes from where the delay is measured from.' },
      { t: '`vTaskDelay` rounds every delay up to a whole second of ticks', why: 'Delays are quantised to the tick period (10 ms by default), not to seconds.' },
    ] },
    { q: 'You need thirty independent timeouts for thirty network sessions. Which facility fits?', kind: 'arch', choices: [
      { t: '`esp_timer`, which multiplexes many software timers onto one hardware timer', ok: true, why: 'Hardware timers are few; esp_timer keeps a sorted list and needs only memory per timer.' },
      { t: 'Thirty `gptimer` instances, one hardware timer per session for the best precision', why: 'A chip has only a handful of hardware timers, so allocation would fail long before thirty.' },
      { t: 'Thirty tasks that each call `vTaskDelay` and then report the timeout', why: 'That works in principle but spends a whole stack per timeout, which is a poor use of RAM.' },
    ] },
    { q: 'What does `esp_timer_get_time()` return?', kind: 'concept', choices: [
      { t: 'Microseconds since boot as a 64-bit signed integer', ok: true, why: 'It is a monotonic microsecond clock, convenient for measuring durations by subtraction.' },
      { t: 'The number of FreeRTOS ticks since boot', why: 'That is xTaskGetTickCount, with 10 ms resolution by default.' },
      { t: 'Wall-clock time in seconds since 1970, set from the network', why: 'Wall-clock time needs to be set from a network or RTC; this function knows only time since start-up.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 9. UART
lessons.push({
  id: 'esp-l-uart', title: 'UART communication', minutes: 40,
  summary: 'Installing the driver on a second port, choosing pins, and leaving the console alone.',
  skills: ['esp-uart'],
  blocks: [
    `## The GPS that broke flashing

You connect a GPS module to the pins labelled TX and RX on the dev board, because those are obviously the UART pins. The module's sentences appear mixed into your log output, your own log lines confuse the module, and \`idf.py flash\` now fails to connect until you unplug it.

Those pins are **UART0**, which the board already uses: the USB-UART chip is wired to them for the console, for the ROM boot messages and for flashing. Two transmitters were driving one wire. The ESP32 has more than one UART and can route them to almost any pin, so there was never a need to share.`,

    `## UART in one paragraph

A UART sends bytes with no clock wire. Each byte is a start bit (low), data bits least-significant first, an optional parity bit and one or more stop bits (high). Both ends must agree on the bit time in advance: the **baud rate**. The line idles high. TX of one device goes to RX of the other, and the grounds must be joined. The protocols section treats framing and errors in depth.`,

    { t: 'widget', name: 'uart-terminal', props: { baud: 115200 }, caption: 'Send bytes and see each frame. Set a mismatched baud rate and look at what arrives.' },

    `## UARTs on the ESP32

The classic ESP32 has three UART controllers (UART0–2); smaller chips have fewer, so check \`SOC_UART_NUM\` or the datasheet for yours. UART0 is the console by default (115200 baud, GPIO1 TX and GPIO3 RX on the ESP32). On chips with USB Serial/JTAG the console may be on USB instead, selected in menuconfig.

Each controller has small hardware FIFOs for transmit and receive. The driver adds an interrupt handler that moves bytes between the hardware FIFO and larger **ring buffers** in RAM, so your task can read and write at its own pace.`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'UART1 on chosen pins: echo with a line counter', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_log.h"

#define PORT    UART_NUM_1
#define TX_GPIO 17                   /* choose free pins for your board */
#define RX_GPIO 16
#define RX_BUF  1024

static const char *TAG = "uart";

void app_main(void)
{
    const uart_config_t cfg = {
        .baud_rate  = 9600,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_ERROR_CHECK(uart_driver_install(PORT, RX_BUF, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(PORT, &cfg));
    ESP_ERROR_CHECK(uart_set_pin(PORT, TX_GPIO, RX_GPIO,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    uint8_t buf[128];
    while (1) {
        int n = uart_read_bytes(PORT, buf, sizeof(buf), pdMS_TO_TICKS(100));
        if (n > 0) {
            uart_write_bytes(PORT, buf, n);
            ESP_LOGI(TAG, "echoed %d bytes", n);
        } else if (n < 0) {
            ESP_LOGE(TAG, "uart_read_bytes failed");
        }
    }
}`, explain: [
      { lines: '15-22', md: 'The frame format: 9600 baud, 8 data bits, no parity, 1 stop bit ("8N1"). It must match the other device exactly.' },
      { lines: '23', md: 'Allocates the ring buffers and installs the driver\'s handler on this UART\'s interrupt, which the hardware raises when the 128-byte receive FIFO passes a threshold or the line goes quiet. Arguments: port, RX ring buffer size (must be larger than the hardware FIFO), TX ring buffer size (0 means writes block until the bytes are in the FIFO), event queue length and handle (none here), interrupt flags.' },
      { lines: '24', md: 'Writes the baud rate divider (source clock ÷ baud, with a fractional part) and the frame settings to this UART\'s clock-divider and configuration registers.' },
      { lines: '25-26', md: 'Routes UART1 TX and RX to the chosen pads through the GPIO matrix. RTS and CTS are not used.' },
      { lines: '30', md: 'Returns as soon as the buffer is full **or** after 100 ms, with however many bytes arrived (possibly 0). It does not wait for a line or a message; UART is a byte stream.' },
      { lines: '32', md: 'Copies bytes to the transmitter. With no TX buffer this returns when the data has been pushed to the hardware FIFO.' },
    ] },

    { t: 'callout', kind: 'hw', md: `**Pin choice.** On an ESP32 module without PSRAM, GPIO16/17 are the conventional UART2 pins and are free; on PSRAM modules they are taken. Avoid strapping pins for TX in particular: a UART idles **high**, and another device holding a strapping pin at reset can change the boot mode. Remember 3.3 V levels: a 5 V device's TX needs a divider before the ESP32's RX.` },

    `## Events and message boundaries

Passing a queue handle to \`uart_driver_install\` makes the driver post \`uart_event_t\` items: \`UART_DATA\` when bytes arrive, \`UART_FIFO_OVF\` and \`UART_BUFFER_FULL\` when your task is not reading fast enough, \`UART_FRAME_ERR\` and \`UART_PARITY_ERR\` for line errors, \`UART_BREAK\` for a break condition. A task that blocks on that queue reacts to data without polling and learns about overruns, which a plain read loop never reports.

Because UART carries bytes and not messages, **you** define where a message ends: a terminator such as a newline, a length prefix, or a gap in time. Never assume one \`uart_read_bytes\` call returns one whole message.`,

    { t: 'callout', kind: 'mistake', md: `**Reusing UART0 casually.** Installing your own driver on \`UART_NUM_0\`, or wiring a device to its pins, fights the console: log output goes to your device, the device's output corrupts the monitor and auto-reset flashing, and the ROM prints its boot messages on those pins at every reset whatever your firmware does. If a design truly needs UART0's pins, move the console (menuconfig, console output options) and accept that the ROM boot log still appears there unless silenced by the relevant strapping pin.` },

    { t: 'predict', q: 'A device sends the 12 bytes `TEMP=23.5C\\r\\n` once a second at 9600 baud. Your loop calls `uart_read_bytes(PORT, buf, 128, pdMS_TO_TICKS(5))` and prints what each call returns. With a 10 ms tick, what do you expect to see for one message?',
      choices: [
        { t: 'One read returning all 12 bytes, since they go together', why: 'That would need the whole message to be in the buffer before the read returns. At this speed 12 bytes take over 12 ms to arrive.' },
        { t: 'Several reads, each returning a fragment of the message', ok: true, why: 'Each byte takes about 1 ms at 9600 baud, and the read returns whatever has arrived when its short timeout expires.' },
        { t: 'Nothing, because the timeout is shorter than a message', why: 'A timeout does not discard data. Bytes that have arrived are returned, and the rest come out on later calls.' },
      ],
      reveal: `At 9600 baud a 10-bit frame takes 1.04 ms, so the message takes about 12.5 ms to arrive. With a 5 ms timeout (which rounds to 0 ticks at a 10 ms tick, returning immediately) the reads slice it into pieces. The fix is not a longer timeout but a parser: accumulate bytes into a line buffer until you see the terminator, and only then treat it as a message.` },

    { t: 'exercise', prompt: `Modify the worked example so that it assembles incoming bytes into lines: accumulate until \`'\\n'\`, then log the complete line (without the line ending) and start again. Lines longer than 80 characters must be dropped without overflowing anything.`,
      hints: [
        `Keep a second buffer and an index that persist across reads. Process the bytes returned by each read one at a time.`,
        `On \`'\\n'\`: terminate the string, log it, reset the index. Ignore \`'\\r'\`.`,
        `For over-long lines you need to remember that you are discarding until the next newline: a boolean \`overflow\` flag.`,
      ],
      solution: `\`\`\`c
char line[81];
size_t len = 0;
bool overflow = false;
uint8_t buf[128];

while (1) {
    int n = uart_read_bytes(PORT, buf, sizeof(buf), pdMS_TO_TICKS(100));
    for (int i = 0; i < n; i++) {
        char c = (char)buf[i];
        if (c == '\\n') {
            if (!overflow) {
                line[len] = '\\0';
                ESP_LOGI(TAG, "line: %s", line);
            } else {
                ESP_LOGW(TAG, "dropped over-long line");
            }
            len = 0;
            overflow = false;
        } else if (c == '\\r') {
            /* ignore */
        } else if (len < sizeof(line) - 1) {
            line[len++] = c;
        } else {
            overflow = true;
        }
    }
}
\`\`\`

The bound check \`len < sizeof(line) - 1\` is what stands between a noisy or malicious serial peer and a stack buffer overflow. Input from a wire is untrusted input; the security section returns to exactly this pattern.` },

    { t: 'exercise', prompt: `**Find the bug.** This loop is meant to log whatever text arrives. It works in every bench test with short messages and corrupts memory in the field. There are two inputs for which the marked line writes outside \`buf\`. Find both, then give the largest length argument (a number) that makes the terminator write safe for every non-negative return value.`,
      code: R`char buf[64];
while (1) {
    int n = uart_read_bytes(PORT, buf, sizeof(buf), pdMS_TO_TICKS(100));
    buf[n] = '\0';                      /* <-- */
    ESP_LOGI(TAG, "got: %s", buf);
}`,
      hints: [
        `List every value \`uart_read_bytes\` can return, not only the ones you saw on the bench.`,
        `It returns the number of bytes read, which can be as large as the length you asked for, or −1 on error.`,
        `If 64 bytes arrive, where does \`buf[64]\` point? If the call fails, where does \`buf[-1]\` point? Leave one byte for the terminator, and test \`n\` before using it as an index.`,
      ],
      solution: `- When a burst fills the buffer, \`n\` is 64 and \`buf[64]\` is one byte **past the end** of the array: a stack overwrite triggered by whoever is on the other end of the wire.
- When the call fails, \`n\` is −1 and \`buf[-1]\` is one byte **before** the array.

Read at most **63** bytes and check the result:

\`\`\`c
int n = uart_read_bytes(PORT, buf, sizeof(buf) - 1, pdMS_TO_TICKS(100));
if (n > 0) {
    buf[n] = '\\0';
    ESP_LOGI(TAG, "got: %s", buf);
}
\`\`\`

Short bench messages never reach 64 bytes in one read, which is why testing did not find it. The data may also contain a zero byte or half a message; that is the parser's job, as in the previous exercise.`,
      answer: { type: 'number', value: 63, tol: 0, unit: 'bytes' } },

    `## Harder: two boards, one link

Connect UART1 of two ESP32 boards (TX to RX both ways, grounds joined). Design a small framed protocol so that one board can send a command with a payload of up to 32 bytes and know whether the other received it intact: choose a start byte, a length field, a check value and an acknowledgement, and decide what the sender does after no reply for 200 ms. Then list what goes wrong if the receiving board's task is busy for 300 ms while a burst arrives at 115200 baud (count the bytes against the ring buffer size) and which UART event would tell you.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF UART driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/uart.html' },
      { title: 'USB Serial/JTAG Controller Console', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/api-guides/usb-serial-jtag-console.html' },
    ] },
  ],
  quiz: [
    { q: 'Why should a peripheral not be wired to the dev board\'s TX0/RX0 pins?', kind: 'circuit', choices: [
      { t: 'They are the console and flashing UART, already driven by the USB-UART chip', ok: true, why: 'A second transmitter on those lines collides with the console and can block auto-reset flashing.' },
      { t: 'UART0 runs at a baud rate fixed by the ROM, which few peripherals match', why: 'Its baud rate is configurable like any other port. The conflict is about who else is already using the wires.' },
      { t: 'The UART0 pins are input-only pads, so the peripheral could never receive', why: 'GPIO1 and GPIO3 on the ESP32 are ordinary bidirectional pads; the input-only group is GPIO34–39.' },
    ] },
    { q: 'What is the role of the RX ring buffer given to `uart_driver_install`?', kind: 'arch', choices: [
      { t: 'The UART interrupt moves bytes from the hardware FIFO into it for the task to read', ok: true, why: 'The hardware FIFO holds only a little data. The driver\'s ISR drains it into RAM so nothing is lost while the task is busy.' },
      { t: 'It stores the baud rate and frame configuration that `uart_param_config` later applies', why: 'Those live in the UART\'s configuration registers. The ring buffer holds received data bytes.' },
      { t: 'It is where log output is formatted before the driver sends it to the console', why: 'Logging has its own path. This buffer belongs to the driver instance for one port\'s received data.' },
    ] },
    { q: 'A receiver configured for 115200 baud is connected to a device sending at 9600. What arrives?', kind: 'concept', choices: [
      { t: 'Garbage bytes and framing errors', ok: true, why: 'The receiver samples twelve times too fast, reading one long transmitted bit as many bits, so start and stop bits fall in the wrong places.' },
      { t: 'The correct bytes, twelve times slower', why: 'There is no clock wire to adapt to. A receiver samples at its own configured bit time, right or wrong.' },
      { t: 'Nothing at all', why: 'The line still toggles, so the receiver still detects start bits. It decodes them wrongly rather than staying silent.' },
    ] },
    { q: '`uart_read_bytes(port, buf, 100, pdMS_TO_TICKS(50))` returns 37. What does that mean?', kind: 'code', choices: [
      { t: '37 bytes had arrived when the 50 ms timeout expired', ok: true, why: 'The call returns early only when the requested length is reached; otherwise it returns what is available at timeout.' },
      { t: 'An error occurred after 37 bytes had been received', why: 'An error is reported by a negative return value. A positive count is a normal partial read.' },
      { t: 'The device\'s message was exactly 37 bytes long', why: 'The driver has no notion of messages. A count only says how many bytes had arrived by then.' },
    ] },
    { q: 'A 5 V Arduino\'s TX is to be connected to an ESP32 RX pin. What is required?', kind: 'circuit', choices: [
      { t: 'A level shifter or divider on that line, plus a common ground', ok: true, why: 'The datasheet limits an input to VDD + 0.3 V. The idle-high UART line would sit at 5 V on the pin.' },
      { t: 'Nothing, because a UART line idles low and so rests at 0 V most of the time', why: 'UART idles high, so the pin would see 5 V almost all the time.' },
      { t: 'Only matching baud rates and frame format on both sides', why: 'Matching baud is necessary for decoding, but it does nothing about the voltage on the pin.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 10. I2C
lessons.push({
  id: 'esp-l-i2c', title: 'I2C with the master driver', minutes: 45,
  summary: 'Bus and device handles, probing, register reads with a repeated start, and pull-ups.',
  skills: ['esp-i2c'],
  blocks: [
    `## "ESP_ERR_TIMEOUT" and nothing else

You wire a temperature sensor: SDA, SCL, 3.3 V, ground. The first transaction fails with a timeout or "not found" error. The address in your code matches the breakout board's silkscreen. Is it the wiring, the address, the pull-ups, the pins or the code?

I2C failures all look alike from software, because the only feedback the bus gives is one bit: acknowledged or not. You need to know what is on the wires to reason backwards from that bit.`,

    `## The bus in brief

Two lines, **SDA** (data) and **SCL** (clock), shared by every device. All outputs are **open-drain**: a device can pull a line low or release it, and **pull-up resistors** take released lines high. Without pull-ups the lines never go high and nothing works.

A transaction: the controller issues a **start**, sends a 7-bit **address** plus a read/write bit, and the addressed device pulls SDA low for one clock to **ACK**. Data bytes follow, each acknowledged by the receiver. A **stop** ends it. If no device has that address, nobody pulls SDA low: a **NACK**.

To read a register, most sensors want: start, address+write, register number, **repeated start**, address+read, data bytes, stop. The repeated start keeps the bus claimed between the two halves.`,

    { t: 'widget', name: 'i2c-visualizer', props: { device: 'tmp102' }, caption: 'A register read from a TMP102-style sensor, bit by bit. Remove the pull-ups and see what the lines do.' },

    `## The ESP-IDF master driver

The driver models the bus and each device on it as separate handles:

- A **bus handle** owns the I2C controller, the two pins and the lock that serialises access.
- A **device handle** records one target's address and clock speed. All transfers are made on a device handle.

On the ESP32 the I2C signals go through the GPIO matrix, so any two free bidirectional pins work. GPIO21/22 are conventional on ESP32 dev boards.`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'Probe, then read a 16-bit register (TMP102-style sensor at 0x48)', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2c_master.h"
#include "esp_log.h"

#define SDA_GPIO    21               /* choose pins for your board */
#define SCL_GPIO    22
#define SENSOR_ADDR 0x48
#define REG_TEMP    0x00

static const char *TAG = "i2c";

void app_main(void)
{
    const i2c_master_bus_config_t bus_cfg = {
        .i2c_port          = I2C_NUM_0,
        .sda_io_num        = SDA_GPIO,
        .scl_io_num        = SCL_GPIO,
        .clk_source        = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t bus;
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &bus));

    esp_err_t err = i2c_master_probe(bus, SENSOR_ADDR, 100);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "no ACK from 0x%02x: %s", SENSOR_ADDR, esp_err_to_name(err));
        return;
    }

    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = SENSOR_ADDR,
        .scl_speed_hz    = 100000,
    };
    i2c_master_dev_handle_t dev;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dev_cfg, &dev));

    while (1) {
        const uint8_t reg = REG_TEMP;
        uint8_t rx[2];
        err = i2c_master_transmit_receive(dev, &reg, 1, rx, 2, 100);
        if (err == ESP_OK) {
            int16_t raw = (int16_t)((rx[0] << 8) | rx[1]) >> 4;
            ESP_LOGI(TAG, "raw %d = %d milli-degC", raw, (raw * 625) / 10);
        } else {
            ESP_LOGW(TAG, "read failed: %s", esp_err_to_name(err));
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}`, explain: [
      { lines: '15-24', md: '`i2c_new_master_bus` claims controller 0 (the ESP32 has two), configures both pads as open-drain with their inputs enabled, routes SDA and SCL to them through the GPIO matrix and installs the driver\'s handler on the controller\'s interrupt. A transfer is then run by the hardware and that interrupt while the calling task blocks.' },
      { lines: '15-22', md: 'The bus settings. `glitch_ignore_cnt` is the width of the input glitch filter (7 is the documented typical value). `enable_internal_pullup` turns on the weak internal pull-ups, which is only a stopgap.' },
      { lines: '26-30', md: '`i2c_master_probe` sends just the address and reports whether anything ACKed. Doing this first separates "nothing is there" from "my register code is wrong". The last argument is a timeout in milliseconds. A NACK gives `ESP_ERR_NOT_FOUND`; `ESP_ERR_TIMEOUT` from a probe usually means the lines cannot go high, so check the pull-ups.' },
      { lines: '32-36', md: 'The device: a 7-bit address (**not** shifted left; the driver adds the R/W bit) and its SCL frequency. 100 kHz is standard mode.' },
      { lines: '43', md: 'One call performs the whole register read: start, address+W, the register byte, repeated start, address+R, two data bytes with the controller NACKing the last, stop. If the device NACKs its address or the register byte, the call returns `ESP_ERR_INVALID_RESPONSE`.' },
      { lines: '45', md: 'The sensor sends the high byte first. Its 12-bit reading is left-justified in 16 bits, so combine and shift right by 4. Casting to `int16_t` before shifting keeps the sign for temperatures below zero.' },
      { lines: '46', md: 'One count is 0.0625 °C, which is 62.5 thousandths of a degree, so `raw * 625 / 10` is the temperature in milli-degrees with no floating point and the right sign: 25 °C is raw 400 and prints 25000.' },
      { lines: '48', md: 'A failed read is reported and retried next second. One NACK should not reboot a product.' },
    ] },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** The previous I2C API (\`driver/i2c.h\`: \`i2c_param_config\`, \`i2c_driver_install\`, \`i2c_cmd_link_create\`, \`i2c_master_write_byte\` ...) built each transaction from commands by hand. \`driver/i2c_master.h\`, shown here, replaced it in ESP-IDF v5.2. The legacy driver still ships in v6.1 but was declared end-of-life in v6.0 and is scheduled for removal in v7.0; the two cannot be used together in one program. Old code also often writes the address as \`(0x48 << 1) | READ_BIT\`. With the new driver you give the plain 7-bit address.` },

    `## Pull-ups

The rising edge on an open-drain line is the pull-up resistor charging the bus capacitance (wires, pins, every device). Too weak a pull-up and the line rises too slowly to reach a valid high in time; too strong and devices cannot pull it low enough. Typical external values are 2.2 kΩ to 10 kΩ to 3.3 V, lower for faster or longer buses; the I2C specification gives the calculation.

The ESP32's internal pull-ups are tens of kilohms. They may get a single sensor on short wires working at 100 kHz and should not be relied on beyond the bench. Many breakout boards already carry pull-ups; several such boards in parallel can add up to a pull-up that is too strong.`,

    { t: 'callout', kind: 'mistake', md: `**Using the 8-bit address from a datasheet.** Some datasheets give "write address 0x90, read address 0x91". Those are the 7-bit address 0x48 shifted left with the R/W bit appended. Putting 0x90 in \`device_address\` addresses a device that does not exist, and every transfer NACKs. If a documented address is above 0x7F, it is in 8-bit form: shift it right by one.` },

    { t: 'predict', q: 'The sensor is wired correctly but SDA and SCL are swapped on the breadboard. `i2c_master_probe` is called. What is the most likely result?',
      choices: [
        { t: 'It succeeds, because both lines are open-drain and electrically equivalent', why: 'Electrically similar is not logically equivalent. The device looks for a specific pattern of one line changing while the other is high.' },
        { t: 'It fails with a NACK or timeout: the device never sees a valid start', ok: true, why: 'The device treats the controller\'s clock as data and vice versa, so it does not recognise its address and never acknowledges.' },
        { t: 'The sensor is damaged, because its clock input is driven as a data line', why: 'Both lines are open-drain at the same voltage, so swapping them stresses nothing. The fault is purely logical.' },
      ],
      reveal: `No damage, no ACK. A swapped pair, a wrong address, a missing ground, an unpowered sensor and a missing pull-up all produce the same software symptom. That is why the troubleshooting order is physical first: power at the sensor's pins, both lines idle **high** on a multimeter (if not: pull-ups or a short), then a probe of every address to see whether anything answers anywhere, and only then the register code.` },

    { t: 'exercise', prompt: `Write a bus scanner: after creating the bus in the worked example, probe every valid 7-bit address and log the ones that acknowledge. Which address range should the loop cover, and what timeout is sensible?`,
      hints: [
        `7-bit addresses run from 0x00 to 0x7F, but a few at each end are reserved by the I2C specification.`,
        `Scan 0x08 to 0x77 inclusive.`,
        `\`i2c_master_probe(bus, addr, timeout_ms)\` returns \`ESP_OK\` on ACK. A short timeout such as 50 ms keeps a scan of 112 addresses reasonable even when something is wrong.`,
      ],
      solution: `\`\`\`c
int found = 0;
for (uint16_t addr = 0x08; addr <= 0x77; addr++) {
    if (i2c_master_probe(bus, addr, 50) == ESP_OK) {
        ESP_LOGI(TAG, "device at 0x%02x", addr);
        found++;
    }
}
ESP_LOGI(TAG, "%d device(s) found", found);
\`\`\`

Interpreting the result is the useful part. **Nothing found:** wiring, power, pull-ups or pins. **Found at an unexpected address:** an address-select pin is strapped differently from what you assumed, or you had the 8-bit form. **Every address "found":** SDA is stuck low (short, or a device holding it), so every address appears acknowledged. **Each probe times out slowly:** SCL is stuck low or there are no pull-ups.` },

    { t: 'exercise', prompt: `**Read the code, then find the bug.** Someone "simplified" the conversion line of the worked example. At 25 °C the sensor returns the bytes \`0x19\` and \`0x00\` (the correct raw value is 400). What value does this line give \`raw\`? Answer in decimal.`,
      code: R`uint8_t rx[2];                               /* rx[0] = 0x19, rx[1] = 0x00 */
int16_t raw = rx[0] << 8 | rx[1] >> 4;`,
      hints: [
        `There are no parentheses. In which order does C apply \`<<\`, \`>>\` and \`|\`?`,
        `Both shifts bind more tightly than \`|\`. So the right shift applies to \`rx[1]\` alone.`,
        `Evaluate \`(0x19 << 8) | (0x00 >> 4)\`, then convert to decimal.`,
      ],
      solution: `Shifts have higher precedence than \`|\`, so the line computes \`(rx[0] << 8) | (rx[1] >> 4)\` = \`0x1900\` = **6400**. Multiplied by 0.0625 that is 400 °C. The intended expression combines first and shifts the 16-bit result:

\`\`\`c
int16_t raw = (int16_t)((rx[0] << 8) | rx[1]) >> 4;      /* 0x1900 >> 4 = 0x190 = 400 */
\`\`\`

The cast matters too: \`rx[0] << 8\` is computed as an \`int\`, so without the cast to \`int16_t\` a reading below zero (top bit of \`rx[0]\` set) would come out as a large positive number. A value that is exactly 16 times too big, or off by 4096 counts below zero, points at this line and not at the bus.`,
      answer: { type: 'number', value: 6400, tol: 0 } },

    `## Harder: two tasks, one bus

A display and a sensor share the bus. One task updates the display every 50 ms with a 1 kB transfer; another reads the sensor every 10 ms. The driver's bus lock makes each transaction atomic, so the data is never corrupted. But work out the timing: at 100 kHz each byte takes 9 clock periods, so a 1 kB transfer occupies the bus for roughly 90 ms. What happens to the sensor task's 10 ms period and its 100 ms timeout? Propose two changes (consider bus speed, splitting the display update, a second I2C controller on other pins) and say which you would choose.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Inter-Integrated Circuit (I2C)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/i2c.html' },
      { title: 'NXP UM10204: I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf', note: 'Pull-up sizing and reserved addresses' },
    ] },
  ],
  quiz: [
    { q: 'Why does an I2C bus need pull-up resistors?', kind: 'circuit', choices: [
      { t: 'Devices only pull the lines low; the resistors provide the high level', ok: true, why: 'Open-drain outputs cannot drive high. Without pull-ups a released line floats or stays low and no valid signalling is possible.' },
      { t: 'To limit the current when two devices drive opposite levels', why: 'Open-drain outputs cannot drive opposite levels in the first place; that is the point of the scheme.' },
      { t: 'To terminate the lines against reflections from the far end of the bus', why: 'Termination matters for fast transmission lines. At I2C speeds the resistors exist to define the high level.' },
    ] },
    { q: 'A datasheet lists "address 0xD0 (write), 0xD1 (read)". What goes in `device_address`?', kind: 'code', choices: [
      { t: '`0x68`', ok: true, why: '0xD0 is the 7-bit address shifted left with R/W = 0. Shifting right by one gives 0x68; the driver appends the R/W bit itself.' },
      { t: '`0xD0`', why: 'That value does not fit in 7 bits, which is the sign that it already includes the read/write bit.' },
      { t: '`0xD1`', why: 'That is the same device with the read bit set. The driver chooses read or write per transfer; you supply the address alone.' },
    ] },
    { q: 'What does `i2c_master_transmit_receive(dev, &reg, 1, rx, 2, 100)` put on the bus between the register byte and the data bytes?', kind: 'arch', choices: [
      { t: 'A repeated start followed by the address with the read bit', ok: true, why: 'The direction must change from write to read, which requires re-addressing the device without releasing the bus.' },
      { t: 'A stop, then a 100 ms delay', why: 'The 100 is a timeout for the whole operation, not a delay inserted on the bus.' },
      { t: 'Nothing; the device starts sending as soon as it has the register number', why: 'A device cannot begin transmitting in a transfer that was addressed as a write. The direction bit must be sent again.' },
    ] },
    { q: 'A bus scan reports a device at every single address. What should you suspect?', kind: 'circuit', choices: [
      { t: 'SDA is stuck low, so every address byte appears to be acknowledged', ok: true, why: 'An ACK is just SDA low during the ninth clock. A line that is always low looks like a permanent ACK.' },
      { t: 'There really are 112 devices on the bus, one per valid address', why: 'Possible in theory, but a stuck line is a far more likely explanation than a full address space.' },
      { t: 'The pull-ups are too weak, so every address looks acknowledged', why: 'Weak pull-ups make lines slow to rise, which tends to cause timeouts and corrupted data, not a clean ACK everywhere.' },
    ] },
    { q: 'Three breakout boards each have 4.7 kΩ pull-ups fitted. What is the effective pull-up on the shared bus?', kind: 'circuit', choices: [
      { t: 'About 1.6 kΩ, because the resistors are in parallel', ok: true, why: 'Three equal resistors in parallel give one third of the value. Stack enough boards and the pull-up becomes stronger than devices are specified to sink.' },
      { t: '14.1 kΩ, because they add up', why: 'Each resistor goes from the line to the supply, side by side. That is a parallel connection, which reduces resistance.' },
      { t: '4.7 kΩ, because only the pull-up nearest the controller matters', why: 'All of them are connected to the same wire, so all conduct at once.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 11. SPI
lessons.push({
  id: 'esp-l-spi', title: 'SPI: bus, device, transaction', minutes: 45,
  summary: 'Clock modes, the three ESP-IDF structures, chip select, and where DMA comes in.',
  skills: ['esp-spi'],
  blocks: [
    `## Every byte is shifted by one bit

You read the ID register of an SPI sensor. The datasheet says it returns 0xD1. You get 0x68, or 0xA2, consistently. Wiring is right, the chip responds, but the data is wrong in a suspiciously regular way: 0xD1 shifted right by one bit is 0x68.

SPI has no start bit, no address and no acknowledge. Both sides shift on clock edges, and if they disagree about **which** edge, every bit is sampled half a cycle early or late. The link "works" and the data is wrong.`,

    `## SPI in brief

Four signals: **SCLK** from the controller, **MOSI** (controller out), **MISO** (controller in) and one **CS** (chip select, active low) per device. While CS is low, each clock cycle moves one bit in each direction at once: SPI is always full duplex, even when you only care about one direction.

The **mode** fixes clock polarity and phase:

| Mode | Clock idle (CPOL) | Data sampled on (CPHA) |
|---|---|---|
| 0 | low | rising edge (first edge) |
| 1 | low | falling edge (second edge) |
| 2 | high | falling edge (first edge) |
| 3 | high | rising edge (second edge) |

The device's datasheet states the mode, often only as a timing diagram. Bits are normally sent most-significant first.`,

    { t: 'widget', name: 'spi-analyzer', props: { mode: 0 }, caption: 'One transaction in each mode. Select the wrong mode for the device and see the shifted data.' },

    `## Three structures

ESP-IDF's SPI master driver separates what is shared from what is per device:

1. **Bus** (\`spi_bus_config_t\`): which SPI controller and which pins for SCLK, MOSI, MISO.
2. **Device** (\`spi_device_interface_config_t\`): one device's CS pin, mode and clock speed. Several devices share one bus.
3. **Transaction** (\`spi_transaction_t\`): one exchange: how many bits, what to send, where to put what comes back.

The general-purpose controllers are \`SPI2_HOST\` and, where present, \`SPI3_HOST\`. (\`SPI0\`/\`SPI1\` serve the flash chip.) Each has a set of **IO MUX** pins with a direct, fast connection; any other pins are routed through the GPIO matrix, which limits the maximum clock. The SPI master documentation tabulates the native pins and speed limits per chip. For a sensor at 1 MHz it makes no difference.`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'Read one register from an SPI sensor (bit 7 of the first byte = read)', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/spi_master.h"
#include "esp_log.h"

#define PIN_SCLK 18                  /* choose pins for your board */
#define PIN_MOSI 23
#define PIN_MISO 19
#define PIN_CS   5

static const char *TAG = "spi";

static esp_err_t read_reg(spi_device_handle_t dev, uint8_t reg, uint8_t *value)
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA | SPI_TRANS_USE_RXDATA,
        .length  = 16,
        .tx_data = { (uint8_t)(reg | 0x80), 0x00 },
    };
    esp_err_t err = spi_device_polling_transmit(dev, &t);
    if (err == ESP_OK) {
        *value = t.rx_data[1];
    }
    return err;
}

void app_main(void)
{
    const spi_bus_config_t bus_cfg = {
        .sclk_io_num   = PIN_SCLK,
        .mosi_io_num   = PIN_MOSI,
        .miso_io_num   = PIN_MISO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus_cfg, SPI_DMA_CH_AUTO));

    const spi_device_interface_config_t dev_cfg = {
        .clock_speed_hz = 1000000,
        .mode           = 0,
        .spics_io_num   = PIN_CS,
        .queue_size     = 1,
    };
    spi_device_handle_t dev;
    ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &dev_cfg, &dev));

    uint8_t id;
    if (read_reg(dev, 0x0F, &id) == ESP_OK) {
        ESP_LOGI(TAG, "ID register = 0x%02x", id);
    }
}`, explain: [
      { lines: '15-19', md: 'A 16-bit transaction: 8 bits of command out, then 8 clocks during which the device answers. `length` is in **bits**. For transfers of up to four bytes the data can live inside the struct (`tx_data`/`rx_data`) with the two flags, avoiding separate buffers.' },
      { lines: '18', md: 'The read/write convention (here: top bit set means read) is the **device\'s**, taken from its datasheet. SPI itself defines no such thing. Register 0x0F is only an example.' },
      { lines: '20', md: 'Asserts CS, clocks 16 bits, releases CS, and waits by polling. `spi_device_transmit` does the same using an interrupt and blocks the task instead: better for long transfers, slower for short ones.' },
      { lines: '22', md: 'Full duplex: byte 0 of the reply was clocked in while the command went out and is meaningless. The answer is byte 1.' },
      { lines: '29-35', md: 'The bus. Unused signals are set to −1. Leaving the quad pins at their zero default would claim GPIO0.' },
      { lines: '36', md: 'Initialises controller SPI2, lets the driver pick a DMA channel and connects the three signals to the pads. On the ESP32 these particular pins are not SPI2\'s IO MUX pins (those are GPIO14, 13 and 12), so the driver routes them through the GPIO matrix: fine at 1 MHz, a limit at tens of megahertz.' },
      { lines: '38-43', md: 'The device: 1 MHz, mode 0, CS on `PIN_CS` driven automatically by the driver around each transaction. `spi_bus_add_device` computes the clock divider for 1 MHz and stores it with the mode; the controller\'s registers are rewritten from that record whenever a transaction addresses a different device. GPIO5 is a strapping pin that must be high at reset; a chip select idles high, so it is compatible, but do not hang anything on it that pulls low.' },
    ] },

    `## DMA and buffers

Without DMA the controller transfers data through a small internal buffer (64 bytes per transaction on these chips). With DMA enabled (\`SPI_DMA_CH_AUTO\`), the hardware reads and writes your buffers directly, so transactions can be kilobytes long: displays, SD cards, flash chips.

DMA imposes a condition: the buffers must be in memory the DMA hardware can reach, and it is best that they are word-aligned. A buffer in external PSRAM or a \`const\` array in flash may not qualify; the driver then allocates a temporary copy, or fails. Allocate large SPI buffers with \`heap_caps_malloc(size, MALLOC_CAP_DMA)\`.`,

    { t: 'callout', kind: 'decision', md: `**Let the driver own CS unless the device forbids it.** Giving \`spics_io_num\` makes CS frame every transaction exactly, and the driver's bus lock keeps two devices from being selected at once. Drive CS yourself as a GPIO (set \`spics_io_num = -1\`) only when a device needs CS held low across several transactions or needs unusual timing; the flag \`SPI_TRANS_CS_KEEP_ACTIVE\` covers some of those cases while keeping the driver in charge (the bus must first be claimed with \`spi_device_acquire_bus\`, or the transaction is rejected).` },

    { t: 'callout', kind: 'mistake', md: `**Setting \`length\` in bytes.** \`.length = 2\` clocks two bits, not two bytes. The device sees a truncated command, and the reply is zeros or nonsense. Write \`8 * n\`.` },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** Older code uses the host names \`HSPI_HOST\` and \`VSPI_HOST\` (now \`SPI2_HOST\` and \`SPI3_HOST\`) and passes a fixed DMA channel number 1 or 2 to \`spi_bus_initialize\` instead of \`SPI_DMA_CH_AUTO\`.` },

    { t: 'predict', q: 'A sensor specified for SPI mode 3 is configured in the driver as mode 0. Its ID register should read 0xD1. What kind of result do you expect?',
      choices: [
        { t: 'A timeout error from the driver, since the device never answers', why: 'SPI has no acknowledgement, so the controller cannot tell that the device disagreed. The transaction completes normally.' },
        { t: 'A wrong but repeatable value, often the right bits shifted by one', ok: true, why: 'Sampling on the wrong edge catches each bit half a cycle off, which usually shows up as a one-bit shift.' },
        { t: '0xD1, because the mode only matters above about 10 MHz', why: 'Mode defines which edge carries valid data at any speed. Lower speed does not make the wrong edge right.' },
      ],
      reveal: `\`spi_device_polling_transmit\` returns \`ESP_OK\` whatever comes back, because the controller generates the clock and simply records MISO. Mode errors therefore appear as plausible-looking wrong data: often shifted by a bit, sometimes correct for some values and wrong for others. A constant 0x00 or 0xFF points elsewhere: MISO not connected, CS not reaching the device, or the device not powered.` },

    { t: 'exercise', prompt: `Add a \`write_reg(dev, reg, value)\` function to the worked example for the same sensor, where a write has bit 7 of the first byte **clear** and the second byte is the value. Then say what \`rx_data\` contains afterwards and whether you need it.`,
      hints: [
        `It is the same 16-bit transaction shape as \`read_reg\`.`,
        `Clear the top bit with \`reg & 0x7F\` so that a caller cannot accidentally turn a write into a read.`,
        `If you do not want the received bytes, you can leave out \`SPI_TRANS_USE_RXDATA\` and leave \`rx_buffer\` NULL: the driver then discards MISO.`,
      ],
      solution: `\`\`\`c
static esp_err_t write_reg(spi_device_handle_t dev, uint8_t reg, uint8_t value)
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA,
        .length  = 16,
        .tx_data = { (uint8_t)(reg & 0x7F), value },
    };
    return spi_device_polling_transmit(dev, &t);
}
\`\`\`

During a write the device drives nothing meaningful on MISO, so the received bytes are ignored by omitting the RX flag. There is no acknowledgement in SPI: a successful return means sixteen clocks were generated, not that the device accepted the value. The only verification is to read the register back.` },

    { t: 'exercise', prompt: `**Find the bug.** This function should read three consecutive registers in one transaction: one command byte out, then three bytes back. It returns \`ESP_OK\` and \`out\` is always zeros or noise. Which field is wrong, and what value should it have?`,
      code: R`static esp_err_t read3(spi_device_handle_t dev, uint8_t reg, uint8_t out[3])
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA | SPI_TRANS_USE_RXDATA,
        .length  = 4,
        .tx_data = { (uint8_t)(reg | 0x80), 0x00, 0x00, 0x00 },
    };
    esp_err_t err = spi_device_polling_transmit(dev, &t);
    if (err == ESP_OK) {
        out[0] = t.rx_data[1];
        out[1] = t.rx_data[2];
        out[2] = t.rx_data[3];
    }
    return err;
}`,
      hints: [
        `How many clock pulses does the device need to see for one command byte and three reply bytes?`,
        `Check the unit of every number in the structure against the driver documentation.`,
        `\`length\` is in bits. Four bytes are 4 × 8 clocks.`,
      ],
      solution: `**\`.length\` must be 32.** As written the controller generates four clock pulses: the device receives half a command byte, CS rises, and it discards the fragment. The controller has no way to know, because SPI has no acknowledge, so the call succeeds and \`rx_data\` holds whatever MISO did during four clocks.

On a logic analyser this is unmistakable: count the SCLK pulses between CS falling and rising. Counting clocks is the first check for any SPI transfer that "returns OK but reads rubbish".`,
      answer: { type: 'number', value: 32, tol: 0, unit: 'bits' } },

    `## Harder: display and touch controller on one bus

A 320×240 display (wants 40 MHz, mode 0) and a touch controller (maximum 2 MHz, mode 0) share SCLK, MOSI and MISO with separate CS pins. Explain how the device structure lets them coexist at different speeds. Then consider a full-screen update of 153 600 bytes: why must it use DMA, what limits the size of a single transaction (\`max_transfer_sz\`), and what happens to touch latency if the update is sent as one transaction versus 16 smaller ones? Finally, decide whether the display pins must be the controller's IO MUX pins and where you would look up the answer.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF SPI Master Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/spi_master.html', note: 'GPIO matrix vs IO MUX pins, DMA notes, transaction flags' },
    ] },
  ],
  quiz: [
    { q: 'What does `spi_transaction_t.length = 24` mean?', kind: 'code', choices: [
      { t: '24 bits (three bytes) are clocked', ok: true, why: 'Transaction lengths are given in bits, which also allows transfers that are not whole bytes.' },
      { t: '24 bytes are clocked', why: 'The unit is bits. Treating it as bytes is the most common cause of truncated transfers.' },
      { t: 'The clock runs at 24 MHz for this transaction', why: 'Clock speed belongs to the device configuration, not to an individual transaction.' },
    ] },
    { q: 'An SPI read returns 0xFF for every register. Which cause fits best?', kind: 'circuit', choices: [
      { t: 'MISO is not connected or the device is not selected', ok: true, why: 'A constant all-ones pattern means nothing is driving MISO low. Check CS, power and the MISO wire.' },
      { t: 'The SPI mode is wrong, so every bit is sampled on the wrong edge', why: 'A wrong mode gives shifted or scrambled data that still varies with the register, not a constant value.' },
      { t: 'The clock is too slow for the device to respond', why: 'SPI devices generally have no minimum clock rate; slow clocks are the safe direction.' },
    ] },
    { q: 'Why can two devices with different clock speeds and modes share one SPI bus in ESP-IDF?', kind: 'arch', choices: [
      { t: 'Speed, mode and CS are per device; the driver switches them per transaction', ok: true, why: 'Only the selected device listens, so the bus can change its timing between transactions.' },
      { t: 'The driver always runs the whole bus at the slowest device\'s speed', why: 'Each device handle carries its own clock setting, and the controller is switched per transaction.' },
      { t: 'They cannot; each device with a different mode needs its own controller', why: 'Sharing a bus with one chip-select per device is the normal SPI arrangement and the reason the driver separates bus from device.' },
    ] },
    { q: 'In the worked example, why is the register value taken from `rx_data[1]` and not `rx_data[0]`?', kind: 'arch', choices: [
      { t: 'It was clocked in while the command byte was still going out', ok: true, why: 'SPI shifts in both directions simultaneously. The reply can only begin after the command byte has been received by the device.' },
      { t: 'SPI sends the least significant byte first, so the reply is the second byte', why: 'Byte order is not the issue; the first byte is simply not a reply to anything yet.' },
      { t: 'The driver stores a status code for the transaction in the first byte', why: 'The driver stores exactly what was on MISO. Nothing is added by software.' },
    ] },
    { q: 'A 4 kB buffer for a DMA-enabled SPI transfer is declared as a `static const` array and the transfer misbehaves or is slow. Why might that be?', kind: 'arch', choices: [
      { t: 'The array lives in flash, outside the memory DMA can read directly', ok: true, why: 'DMA needs buffers in DMA-capable internal RAM. Allocating with MALLOC_CAP_DMA guarantees that.' },
      { t: 'SPI cannot send more than 64 bytes in one transaction, even with DMA enabled', why: 'That limit applies only without DMA. With DMA enabled, much larger transactions are normal.' },
      { t: 'Data declared `const` cannot be passed as a transmit buffer to the driver', why: 'The qualifier is a C-level promise and does not stop transmission. What matters is which memory region the linker placed the array in.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 12. FreeRTOS fundamentals
lessons.push({
  id: 'esp-l-freertos', title: 'FreeRTOS fundamentals on ESP-IDF', minutes: 55,
  summary: 'Tasks, stacks, priorities, blocking, queues and mutexes, and what two cores change.',
  skills: ['esp-freertos-tasks', 'esp-freertos-sync'],
  blocks: [
    `## One loop is not enough

A device must blink a status LED twice a second, read a sensor every 100 ms, and answer commands on a UART whenever they arrive. Written as one loop, each job waits for the others: while the sensor read blocks for 20 ms, command bytes pile up; add a network request that takes two seconds and the LED freezes.

You could write a careful state machine that never blocks. ESP-IDF gives you another tool, and you are already using it whether you asked or not: Wi-Fi, timers and \`app_main\` itself all run as FreeRTOS **tasks**. This lesson covers what you need to use tasks correctly on an ESP32. The theory of scheduling, priority inversion and deadlock is the subject of the RTOS section.`,

    `## Tasks and the scheduler

A task is a function that never returns, with its **own stack** and a **priority**. The scheduler decides which task runs, with one rule: **the highest-priority task that is ready to run, runs.** A task is not ready while it is **blocked**: sleeping in \`vTaskDelay\`, or waiting for a queue, semaphore or notification.

That rule has a sharp consequence. A task that never blocks prevents every lower-priority task on its core from ever running. Well-behaved tasks spend nearly all their time blocked, waiting for something to do.

Tasks of equal priority share the CPU in turns, switching on the **tick** interrupt (100 Hz by default: every 10 ms). When a higher-priority task becomes ready, for example because an ISR posted to its queue, it **preempts** the running task immediately.`,

    { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'preemptive' }, caption: 'Three tasks under a preemptive scheduler. Change priorities and periods and see who runs.' },

    `## What is different on ESP-IDF

ESP-IDF uses its own FreeRTOS port. If you have used FreeRTOS elsewhere, note:

- **Stack sizes are in bytes**, not words. \`xTaskCreate(..., 4096, ...)\` allocates 4096 bytes.
- Priorities run from 0 (lowest, the idle task) to \`configMAX_PRIORITIES − 1\` (24 with the default configuration). A larger number is a higher priority. The main task has priority 1.
- On dual-core chips (ESP32, S3) the scheduler is **SMP**: both cores schedule from one set of tasks. A task either has **no affinity** (may run on either core) or is **pinned** to one with \`xTaskCreatePinnedToCore\`.
- With two cores, two tasks truly run **at the same time**. Disabling interrupts on one core does not stop the other, so critical sections take a spinlock: \`portENTER_CRITICAL(&lock)\`.
- Each core has its own idle task. The idle tasks free the memory of deleted tasks and feed the task watchdog, so they must get to run.`,

    `## Worked example: producer, consumer and a shared counter`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'Two tasks, a queue and a mutex', code: R`#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_log.h"

static const char *TAG = "rtos";

typedef struct {
    uint32_t seq;
    int      value;
} sample_t;

static QueueHandle_t     s_queue;
static SemaphoreHandle_t s_stats_lock;
static uint32_t          s_total;            /* shared: protected by s_stats_lock */

static void producer_task(void *arg)
{
    sample_t s = { 0 };
    TickType_t last = xTaskGetTickCount();
    while (1) {
        s.seq++;
        s.value = (int)(s.seq % 50);         /* stand-in for a sensor read */
        if (xQueueSend(s_queue, &s, pdMS_TO_TICKS(10)) != pdTRUE) {
            ESP_LOGW(TAG, "queue full, sample %" PRIu32 " dropped", s.seq);
        }
        vTaskDelayUntil(&last, pdMS_TO_TICKS(100));
    }
}

static void consumer_task(void *arg)
{
    sample_t s;
    while (1) {
        if (xQueueReceive(s_queue, &s, portMAX_DELAY) == pdTRUE) {
            xSemaphoreTake(s_stats_lock, portMAX_DELAY);
            s_total += (uint32_t)s.value;
            xSemaphoreGive(s_stats_lock);
        }
    }
}

void app_main(void)
{
    s_queue = xQueueCreate(8, sizeof(sample_t));
    s_stats_lock = xSemaphoreCreateMutex();
    configASSERT(s_queue != NULL && s_stats_lock != NULL);

    xTaskCreate(consumer_task, "consumer", 3072, NULL, 6, NULL);
    xTaskCreate(producer_task, "producer", 3072, NULL, 5, NULL);

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(2000));
        xSemaphoreTake(s_stats_lock, portMAX_DELAY);
        uint32_t total = s_total;
        xSemaphoreGive(s_stats_lock);
        ESP_LOGI(TAG, "total %" PRIu32 ", free stack %u bytes", total,
                 (unsigned)uxTaskGetStackHighWaterMark(NULL));
    }
}`, explain: [
      { lines: '10-13', md: 'The message type. A queue **copies** items, so each task has its own copy and nothing is shared by accident. Do not queue pointers to stack variables.' },
      { lines: '26', md: 'Copies the struct into the queue. If the queue is full the task waits up to 10 ms for space, then gives up and reports: a deliberate overload policy.' },
      { lines: '29', md: '`vTaskDelayUntil` sleeps until an absolute tick, 100 ms after the previous wake-up, so the period does not stretch with the time the work took.' },
      { lines: '37', md: 'The consumer is blocked here, using no CPU, until an item arrives. This is what a healthy task looks like.' },
      { lines: '38-40', md: '`s_total += ...` is read, add, write: three steps. A mutex makes them indivisible with respect to other tasks that take the same mutex. The section held under the lock is as short as possible.' },
      { lines: '47-49', md: 'Create every queue and lock **before** the tasks that use them. `configASSERT` stops immediately if the heap could not supply them.' },
      { lines: '51-52', md: '`xTaskCreate` allocates a task control block and the stack from the heap, builds an initial register frame on that stack so the task can be "resumed" into its function, and puts it on the ready list. No hardware is touched; a task exists only as RAM and scheduler bookkeeping. Arguments: function, name (shown in crash dumps), stack size **in bytes**, argument, priority, optional handle. The consumer has the higher priority so it drains the queue as soon as data arrives.' },
      { lines: '56-58', md: 'Copy the shared value out under the lock, then log outside it. Never hold a mutex across something slow such as logging.' },
      { lines: '60', md: 'The high-water mark is the smallest amount of stack that has ever been free for this task, in bytes on ESP-IDF. Near zero means the stack is too small.' },
    ] },

    `## Choosing stack size and priority

**Stack.** Each task's stack holds its local variables, the frames of every function it calls, and the saved context when it is switched out. \`printf\`-style formatting alone uses over a kilobyte. Start at 3072–4096 bytes for a task that logs, measure with \`uxTaskGetStackHighWaterMark\` under the worst case, and keep a margin. Too small is a stack overflow: ESP-IDF detects most of them and panics with a message naming the task.

**Priority.** Assign by urgency of response, not by importance: a task that must react within a millisecond gets a high priority and must do little; long computations get low priority. Stay below the priorities ESP-IDF uses for its own time-critical tasks (the Wi-Fi and timer tasks run high in the range) unless you have measured a reason.

**Queue, semaphore or mutex?**

| Need | Use |
|---|---|
| Pass data from one task or ISR to another | Queue |
| Signal "something happened" with no data | Binary semaphore or task notification |
| Protect shared data between tasks | Mutex (it has priority inheritance) |
| Protect data shared with an ISR | Critical section with a spinlock; a mutex cannot be taken in an ISR |`,

    { t: 'callout', kind: 'mistake', md: `**Waiting with a busy loop.** \`while (!flag) { }\` or a counted delay loop keeps the task permanently ready. Lower-priority tasks on that core, including idle, never run; the task watchdog fires after a few seconds. Block instead: \`vTaskDelay\`, or better, wait on the queue or semaphore that the event will signal.` },

    { t: 'callout', kind: 'decision', md: `**Leave tasks unpinned unless there is a reason.** With no affinity the scheduler uses whichever core is free. Pin a task when it must not share a core with something (keeping a timing-sensitive task off the core that runs the Wi-Fi stack, typically core 0), or when it uses a resource tied to one core, such as an interrupt allocated there. On single-core chips (C3, C6) there is no core 1 and \`xTaskCreatePinnedToCore\` with that core number is an error, so portable code passes \`tskNO_AFFINITY\` or uses \`xTaskCreate\`.` },

    { t: 'predict', q: 'This task is created with `xTaskCreate(report_task, "report", 1024, NULL, 5, NULL)`. What happens?', code: R`static void report_task(void *arg)
{
    char line[512];
    while (1) {
        snprintf(line, sizeof(line), "uptime %lld us", (long long)esp_timer_get_time());
        ESP_LOGI("report", "%s", line);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}`,
      choices: [
        { t: 'It prints the uptime once a second', why: 'That needs enough stack for the local array plus the formatting and logging call chain. Add up what this task puts on its 1024-byte stack.' },
        { t: 'It overflows its stack and the system panics', ok: true, why: 'A 512-byte array leaves about 500 bytes for snprintf, the logging machinery and the saved context, which is not enough.' },
        { t: 'It fails to compile because 512 bytes is too large for a local', why: 'The compiler has no knowledge of the task\'s stack size, which is only a run-time argument to xTaskCreate.' },
      ],
      reveal: `1024 bytes total, 512 gone to \`line\`, and formatted output needs more than the remainder. You should see a panic reporting a stack overflow in task \`report\` (or, if the overflow corrupts memory before it is detected, a less obvious crash). Fixes: give the task 4096 bytes, and make large buffers \`static\` or heap-allocated so they are not on the stack at all.` },

    { t: 'exercise', prompt: `In the worked example, add a third task, \`blink_task\`, that toggles an LED every 250 ms. Then make the LED blink **fast (every 50 ms)** whenever the producer has had to drop a sample in the last second. Decide how the producer tells the blink task, and justify your choice of mechanism and of the blink task's priority.`,
      hints: [
        `What needs to cross between the tasks: a stream of data items, or one small fact?`,
        `One fact: "a drop happened at tick T". A single word written by one task and read by another, in one access each, does not need a queue.`,
        `Store \`xTaskGetTickCount()\` in a \`static volatile TickType_t s_last_drop\` in the producer's failure branch. In the blink task compare \`now - s_last_drop\` with \`pdMS_TO_TICKS(1000)\` to choose the delay. Blinking is the least urgent job: give it a low priority.`,
      ],
      solution: `\`\`\`c
static volatile TickType_t s_last_drop;
static volatile bool s_dropped_once;

/* in producer_task, where the sample is dropped: */
s_last_drop = xTaskGetTickCount();
s_dropped_once = true;

static void blink_task(void *arg)
{
    bool on = false;
    while (1) {
        on = !on;
        gpio_set_level(LED_GPIO, on);
        bool recent = s_dropped_once &&
                      (xTaskGetTickCount() - s_last_drop) < pdMS_TO_TICKS(1000);
        vTaskDelay(pdMS_TO_TICKS(recent ? 50 : 250));
    }
}

/* in app_main, after configuring the LED pin as an output: */
xTaskCreate(blink_task, "blink", 2048, NULL, 2, NULL);
\`\`\`

A single aligned 32-bit value written by one task and read by another is safe without a lock on these CPUs: the reader sees the old value or the new one. A queue would be the wrong tool (the blink task does not want every event, only the latest state) and a mutex would be needless. Priority 2 is below both data tasks, so the indicator can never delay the work it indicates. To test it, shrink the queue to length 1 and add a 300 ms delay in the consumer.` },

    `## Harder: the same bug on one core and two

Remove the mutex from the worked example and let two tasks of **equal** priority each execute \`s_total++\` a million times. On a single-core chip the final total is wrong only when a tick-driven task switch lands between the read and the write, which is rare. On a dual-core chip with the tasks on different cores it is wrong almost every run. Explain why the rate differs so sharply, why "it passed testing on the C3" proves nothing, and why \`volatile\` does not fix it. Then try the idea by hand:`,

    { t: 'widget', name: 'race-condition', props: { scenario: 'counter' }, caption: 'Interleave two tasks\' load, add and store steps to lose an update, then add a critical section.' },

    { t: 'refs', items: [
      { title: 'ESP-IDF FreeRTOS (IDF) and SMP differences', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos_idf.html' },
      { title: 'ESP-IDF FreeRTOS overview and API', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos.html' },
      { title: 'FreeRTOS Kernel (source)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel' },
    ] },
  ],
  quiz: [
    { q: 'On ESP-IDF, `xTaskCreate(fn, "t", 2048, NULL, 5, NULL)` allocates how much stack?', kind: 'code', choices: [
      { t: '2048 bytes', ok: true, why: 'The ESP-IDF port specifies stack depth in bytes, unlike most other FreeRTOS ports.' },
      { t: '2048 words, that is 8192 bytes', why: 'That is the convention in upstream FreeRTOS on 32-bit ports. The ESP-IDF port deliberately differs, which catches out ported code.' },
      { t: '2048 kilobytes', why: 'Task stacks are a few kilobytes; the whole chip has only a few hundred kilobytes of RAM.' },
    ] },
    { q: 'A priority-10 task runs `while (1) { poll_sensor(); }` with no blocking call. What happens to a priority-5 task on the same single-core chip?', kind: 'arch', choices: [
      { t: 'It never runs', ok: true, why: 'The scheduler always runs the highest-priority ready task. A task that is never blocked is always ready.' },
      { t: 'It gets a time slice every tick', why: 'Time slicing happens only between tasks of equal priority. A lower-priority task waits until all higher ones are blocked.' },
      { t: 'It runs at half speed', why: 'Priorities are not shares of CPU time. They are a strict ordering.' },
    ] },
    { q: 'Why is a queue of `sample_t` values safer than a queue of pointers to a `sample_t` local variable?', kind: 'code', choices: [
      { t: 'The queue copies the value, so the receiver\'s data cannot change or vanish', ok: true, why: 'A pointer to a local refers to stack memory the sender will overwrite or leave; a copied value is owned by the queue and then by the receiver.' },
      { t: 'Pointers are larger than the struct, so fewer fit in the same queue', why: 'A pointer is four bytes, smaller than this struct. Size is not the concern; lifetime and sharing are.' },
      { t: 'A FreeRTOS queue cannot hold pointers, only plain values up to 32 bits', why: 'They can hold any fixed-size item, pointers included. Doing so is valid when the pointed-to memory is managed carefully.' },
    ] },
    { q: 'Shared data is updated by a task and by a GPIO ISR. Why can a mutex not protect it?', kind: 'arch', choices: [
      { t: 'An ISR cannot block, and taking a mutex may mean waiting for its holder', ok: true, why: 'The holder cannot run until the ISR returns, so the ISR would wait forever. Data shared with an ISR needs a critical section instead.' },
      { t: 'Mutexes only work between tasks on different cores, and an ISR shares a core', why: 'Mutexes work on any number of cores. Their limitation is that the taker must be able to sleep.' },
      { t: 'Mutexes are slower than interrupts, so the ISR would miss edges', why: 'Speed is not the obstacle. The operation is simply not permitted from interrupt context.' },
    ] },
    { q: 'On a dual-core ESP32, what does disabling interrupts on core 0 guarantee about a task running on core 1?', kind: 'arch', choices: [
      { t: 'Nothing; it keeps running and can touch the same data', ok: true, why: 'Each core has its own interrupt enable state. This is why ESP-IDF critical sections also take a spinlock.' },
      { t: 'It is paused until core 0 re-enables interrupts', why: 'One core has no means of freezing the other merely by masking its own interrupts.' },
      { t: 'It is migrated to core 0', why: 'Masking interrupts does not move tasks. The scheduler on the other core continues independently.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 13. Watchdogs
lessons.push({
  id: 'esp-l-wdt', title: 'Watchdog configuration', minutes: 35,
  summary: 'The interrupt and task watchdogs, what their logs look like, and how to feed one honestly.',
  skills: ['esp-wdt'],
  blocks: [
    `## The device that needed a visit

A remote sensor node stops reporting. Someone drives out, finds it powered with its LED frozen, presses reset, and it works for another month. The firmware had hung in a loop waiting for a sensor that never answered, and nothing in the system was able to notice.

A **watchdog** is a timer that resets the system unless the software keeps proving it is alive. The proof is called feeding (or kicking). Stop feeding, and the timer expires. The design question is what counts as proof.`,

    { t: 'widget', name: 'timer-lab', props: { mode: 'watchdog' }, caption: 'Feed the watchdog on time, then miss the deadline and see the reset.' },

    `## The watchdogs in ESP-IDF

| Watchdog | Watches for | Default behaviour |
|---|---|---|
| **Interrupt watchdog (IWDT)** | Interrupts disabled, or an ISR running, for too long (a few hundred milliseconds by default) | Panic and reset |
| **Task watchdog (TWDT)** | Subscribed tasks that have not reset it within the timeout (5 s by default). By default it watches each core's **idle task** | Prints a warning naming the tasks; resets only if configured to panic |
| **RTC watchdog** | The bootloader and early start-up taking too long | Reset |

These are three separate hardware timers. On the ESP32 the task watchdog uses the watchdog of Timer Group 0, the interrupt watchdog the one of Timer Group 1, and the RTC watchdog a timer in the always-on RTC domain. The interrupt watchdog is fed from the tick interrupt on each core, so it expires when tick interrupts stop being serviced. The task watchdog's hardware timer is restarted only when **every** subscribed task has called \`esp_task_wdt_reset()\` since the last restart, so one silent subscriber is enough to let it expire.

Watching the idle task is a neat trick: idle runs only when nothing else wants the CPU, so if idle has not run for five seconds, some task has been hogging a core without blocking.

A triggered TWDT prints something like this (illustrative):`,

    { t: 'ascii', text: `E (10314) task_wdt: Task watchdog got triggered. The following tasks/users did not reset the watchdog in time:
E (10314) task_wdt:  - IDLE0 (CPU 0)
E (10314) task_wdt: Tasks currently running:
E (10314) task_wdt: CPU 0: crunch
E (10314) task_wdt: CPU 1: IDLE1
E (10314) task_wdt: Print CPU 0 (current core) backtrace`, caption: 'Read it as: idle on CPU 0 was starved, and the task running there was "crunch".' },

    `The first list names the **victims** (who failed to check in). "Tasks currently running" names the **suspects**. An interrupt watchdog failure appears instead as a panic: \`Guru Meditation Error: Core 0 panic'ed (Interrupt wdt timeout on CPU0)\`.

After a watchdog reset, the ROM's first line and \`esp_reset_reason()\` report why the chip restarted (for example \`ESP_RST_TASK_WDT\`, \`ESP_RST_INT_WDT\`, \`ESP_RST_PANIC\`, \`ESP_RST_BROWNOUT\`, \`ESP_RST_POWERON\`). Log it at every boot.`,

    `## Subscribing your own task`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'A task that must complete a cycle every few seconds', code: R`#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_task_wdt.h"
#include "esp_system.h"
#include "esp_log.h"

static const char *TAG = "wdt";

static bool read_sensor_ok(void)
{
    vTaskDelay(pdMS_TO_TICKS(20));   /* stand-in for a real sensor transaction */
    return true;
}

static void control_task(void *arg)
{
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
    while (1) {
        if (read_sensor_ok()) {
            /* compute and drive outputs here */
            esp_task_wdt_reset();
        } else {
            ESP_LOGW(TAG, "sensor read failed; not feeding");
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "reset reason: %d", (int)esp_reset_reason());
    xTaskCreate(control_task, "control", 4096, NULL, 5, NULL);
}`, explain: [
      { lines: '17', md: 'Subscribes the calling task to the task watchdog: the driver adds it to its list of tasks that must check in. From now on this task must call `esp_task_wdt_reset()` within the timeout.' },
      { lines: '21', md: 'Marks this task as having checked in. If all other subscribers (here: the idle tasks) have too, the driver restarts the hardware watchdog timer.' },
      { lines: '19-21', md: 'The feed sits **after** the work that proves the system is functioning: a successful sensor read and a completed control cycle.' },
      { lines: '22-24', md: 'If the sensor fails repeatedly the task is still running, yet it stops feeding. After the timeout the watchdog reports it (and resets, if configured to panic). That is the intended behaviour: the device is alive but not doing its job.' },
      { lines: '31', md: 'Records why the chip last reset. Compare the value with the `esp_reset_reason_t` enumeration. A field device should store or transmit this.' },
    ] },

    `The timeout and the reaction are set in menuconfig (the \`ESP_TASK_WDT\` options, including "Invoke panic handler on Task Watchdog timeout"), or at run time with \`esp_task_wdt_reconfigure()\`, which takes an \`esp_task_wdt_config_t\` holding \`timeout_ms\`, \`idle_core_mask\` and \`trigger_panic\`.`,

    { t: 'callout', kind: 'note', md: `**Old tutorials.** In ESP-IDF v4, \`esp_task_wdt_init(timeout_seconds, panic)\` took two plain arguments. From v5 it takes a pointer to \`esp_task_wdt_config_t\` with the timeout in milliseconds, and because the watchdog is normally already initialised at start-up, changing it at run time uses \`esp_task_wdt_reconfigure\`.` },

    { t: 'callout', kind: 'mistake', md: `**Feeding the watchdog to make the warning go away.** Sprinkling \`esp_task_wdt_reset()\` inside a long loop, or feeding from a timer callback, keeps the watchdog quiet whether or not the system works. A timer that feeds on its own will happily keep a deadlocked application "alive" for ever. Likewise, disabling the watchdog in menuconfig removes the symptom and keeps the bug. Feed from the task being watched, at a point that is reached only when its real work succeeded.` },

    { t: 'callout', kind: 'decision', md: `**For a product, make the task watchdog reset the chip.** The default TWDT action is a warning only, which is right during development (you can read the report) and wrong in the field, where nobody is reading. Enable the panic option so a hung device restarts, and make sure the restart path is safe: outputs go to a defined state at boot, and the reset reason is recorded.` },

    { t: 'predict', q: 'This is the only task you created, at priority 5 on a single-core chip with default watchdog settings. What do you see on the monitor?', code: R`static void crunch_task(void *arg)
{
    uint32_t x = 1;
    while (1) {
        x = x * 1664525u + 1013904223u;   /* compute forever */
    }
}`,
      choices: [
        { t: 'Nothing; the task runs silently and the monitor stays quiet', why: 'Something is watching for exactly this: a core whose idle task has not run for several seconds.' },
        { t: 'An immediate Guru Meditation panic naming `crunch_task`', why: 'The code does nothing illegal, so no CPU exception occurs. The symptom takes several seconds to appear and is a report, not a crash.' },
        { t: 'A task watchdog report about every five seconds, naming IDLE', ok: true, why: 'The task never blocks, the idle task never runs, and the TWDT reports the starved idle task and the task that was running.' },
      ],
      reveal: `The idle task is starved. By default the TWDT prints its report every timeout period and the program continues; with the panic option enabled the chip would reset instead. The repair is not to feed the watchdog inside the loop. It is to let other tasks run: do the computation in chunks with a \`vTaskDelay(1)\` between them, or lower the task's priority to 0 so it shares time with idle.` },

    { t: 'exercise', prompt: `A task downloads a firmware image in a loop that can legitimately take 40 seconds, calling a blocking \`receive_chunk()\` that returns within 2 seconds or fails. The task is subscribed to a TWDT with a 5 s timeout. Where should \`esp_task_wdt_reset()\` go, and what must be true for it to be called? What happens, and should happen, if the server stops sending?`,
      hints: [
        `The watchdog timeout bounds the longest gap between proofs of progress, not the length of the whole job.`,
        `One chunk takes at most 2 s. That is a natural unit of progress.`,
        `Feed only after a chunk was actually received. Count consecutive failures yourself and abandon the download cleanly before the watchdog has to act.`,
      ],
      solution: `Feed once per **successfully received chunk**:

\`\`\`c
int failures = 0;
while (!done) {
    if (receive_chunk(buf, &len) == ESP_OK) {
        failures = 0;
        write_chunk(buf, len);
        esp_task_wdt_reset();          /* progress was made */
    } else if (++failures >= 2) {
        ESP_LOGE(TAG, "download stalled, aborting");
        break;                         /* clean up, report, retry later */
    }
}
\`\`\`

Each iteration takes at most 2 s, so a healthy download feeds well inside 5 s for all 40 s. If the server stalls, the application notices after two failed chunks (4 s) and aborts in an orderly way. The watchdog remains as the backstop for the case the code did not foresee, such as \`receive_chunk\` itself hanging. A watchdog should be the last line of defence, not the error-handling strategy.` },

    `## Harder: who watches the watcher?

Three tasks cooperate: sensor, control and communications. Design a scheme in which a watchdog reset occurs if **any one** of them stops making progress, even though the other two are healthy. Compare two designs: subscribing all three to the TWDT directly, and a supervisor task to which each reports with a heartbeat counter, with only the supervisor feeding. Consider what each design does when the communications task is legitimately blocked for 30 s waiting for a network, and how you would test that the reset really occurs (inject the fault deliberately; a watchdog that has never been seen to fire is unverified).`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Watchdogs', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/wdts.html' },
      { title: 'ESP-IDF Miscellaneous System APIs: reset reason', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/misc_system_api.html' },
    ] },
  ],
  quiz: [
    { q: 'Why does the task watchdog watch the idle tasks by default?', kind: 'arch', choices: [
      { t: 'A starved idle task shows that some task is running without ever blocking', ok: true, why: 'It turns "is any task hogging a core?" into a simple check that needs no cooperation from application tasks.' },
      { t: 'The idle task is the most likely to crash, since it runs at the lowest priority', why: 'The idle task is tiny and robust. It is watched as an indicator of what other tasks are doing.' },
      { t: 'Idle tasks perform the Wi-Fi processing, which must never be starved', why: 'Wi-Fi has its own high-priority task. Idle does housekeeping such as freeing deleted tasks\' memory.' },
    ] },
    { q: 'A TWDT report lists `IDLE0 (CPU 0)` as not reset, and "Tasks currently running: CPU 0: net_task". Where do you look first?', kind: 'code', choices: [
      { t: 'In `net_task`, for a loop that does not block', ok: true, why: 'The running task at the moment of the timeout is the prime suspect for having starved idle on that core.' },
      { t: 'In the idle task\'s source code', why: 'Idle is the victim named in the first list. It could not run because something else held the core.' },
      { t: 'In the watchdog timeout setting, to increase it', why: 'A longer timeout delays the report without changing the fact that a task is monopolising the CPU.' },
    ] },
    { q: 'A periodic `esp_timer` callback calls `esp_task_wdt_reset()` on behalf of the main control task. What is wrong?', kind: 'arch', choices: [
      { t: 'The feed no longer depends on the control task, so a hang there goes undetected', ok: true, why: 'A watchdog is only as meaningful as the condition under which it is fed. A feed that happens unconditionally proves nothing.' },
      { t: 'Timer callbacks are dispatched too slowly and irregularly to feed a 5 s watchdog in time', why: 'A periodic timer can easily meet a multi-second deadline. Timing is not the flaw.' },
      { t: 'Nothing; feeding from a timer is the pattern the documentation recommends', why: 'It defeats the purpose: the application could be deadlocked while the timer keeps reporting that all is well.' },
    ] },
    { q: 'What typically triggers the **interrupt** watchdog?', kind: 'concept', choices: [
      { t: 'A long critical section or an ISR that is slow to return', ok: true, why: 'It detects interrupts being blocked or monopolised for hundreds of milliseconds, which the task watchdog cannot see.' },
      { t: 'A task that loops for seconds without ever calling `vTaskDelay`', why: 'A non-blocking task still allows interrupts to run, so the tick keeps firing. That case belongs to the task watchdog.' },
      { t: 'A GPIO interrupt that is enabled but whose edge never occurs', why: 'The absence of an interrupt is not a fault the system can detect. The watchdog concerns interrupts being prevented from running.' },
    ] },
    { q: 'After an unexplained restart in the field, which piece of information is most valuable and cheapest to collect?', kind: 'concept', choices: [
      { t: 'The value of `esp_reset_reason()` logged or stored at boot', ok: true, why: 'It distinguishes power loss, brownout, panic and watchdog resets, which point to completely different causes.' },
      { t: 'The size of the application binary that was running then', why: 'Image size does not change between restarts and says nothing about why one happened.' },
      { t: 'The Wi-Fi signal strength just before the restart', why: 'It may be relevant to connectivity, but it cannot tell a power problem from a software hang.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 14. Flash storage and NVS
lessons.push({
  id: 'esp-l-nvs', title: 'Flash storage and NVS', minutes: 40,
  summary: 'How flash behaves, what a partition is, and storing settings as keys and values.',
  skills: ['esp-nvs', 'esp-flash-layout'],
  blocks: [
    `## Settings that survive, and a device that wears out

A thermostat must remember its setpoint through a power cut. A first attempt writes the setpoint to flash every time the temperature is sampled, once a second. It works on the bench. Do the arithmetic for the field: 86 400 writes a day. Flash memory wears, and a naive scheme that erases the same sector for each write would reach a typical endurance figure in days.

Storing data in flash is not like assigning to a variable. Flash has physical rules, and the storage library exists to work within them.`,

    `## How NOR flash behaves

- An **erased** flash bit reads 1. Programming can only change bits from 1 to 0.
- Getting a 0 back to 1 requires an **erase**, which works only on a whole **sector** (4 kB on the usual SPI flash parts) and takes tens of milliseconds.
- Each sector survives a limited number of erase cycles. The figure is in the flash chip's datasheet; 100 000 is a common order of magnitude.
- While flash is being programmed or erased, the cache is disabled and code in flash cannot run (the rule from the interrupt lesson).

So you cannot overwrite a value in place. A storage system must append new versions, track which is current, and erase sectors only when they contain nothing but stale data. Spreading erases evenly over many sectors is **wear levelling**.

Flash is divided by the **partition table** into regions with a type and a purpose. The default table gives NVS a 24 kB (\`0x6000\`) partition at \`0x9000\`.`,

    `## NVS: non-volatile storage

NVS is ESP-IDF's key-value store for small items: settings, counters, calibration, credentials. It is a log: each write appends an entry to the current page, the newest entry for a key wins, and full pages of stale entries are erased and reused. That gives wear levelling across the partition for free.

- A **namespace** groups keys so components do not collide (Wi-Fi uses its own). Namespace and key names are limited to 15 characters.
- Values are **typed**: integers of 8 to 64 bits, strings, and blobs (arbitrary bytes). Reading with the wrong type fails.
- Changes are guaranteed to be on flash only after **\`nvs_commit\`**.
- NVS is for small values. For files or large data, use a file-system partition (SPIFFS, LittleFS or FAT with wear levelling).`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'A boot counter in NVS', code: R`#include <inttypes.h>
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"

static const char *TAG = "nvs";

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    nvs_handle_t h;
    ESP_ERROR_CHECK(nvs_open("app", NVS_READWRITE, &h));

    uint32_t boots = 0;
    err = nvs_get_u32(h, "boots", &boots);
    if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGE(TAG, "read failed: %s", esp_err_to_name(err));
    }

    boots++;
    ESP_ERROR_CHECK(nvs_set_u32(h, "boots", boots));
    ESP_ERROR_CHECK(nvs_commit(h));
    nvs_close(h);

    ESP_LOGI(TAG, "boot number %" PRIu32, boots);
}`, explain: [
      { lines: '10', md: 'Mounts the default NVS partition: scans its pages and builds an index in RAM. Must be called once before any other NVS use, and before starting Wi-Fi.' },
      { lines: '11-14', md: 'Two recoverable failures: the partition is full of an old layout, or was written by a newer NVS format. Erasing and retrying is the standard recovery. It **deletes all stored data**, so a product should consider whether that is acceptable.' },
      { lines: '18', md: 'Opens (and, in read-write mode, creates) the namespace `app`. A read-only open of a namespace that does not exist yet fails with a not-found error.' },
      { lines: '20-24', md: 'On the very first boot the key is absent. `ESP_ERR_NVS_NOT_FOUND` is expected, and `boots` keeps its initial 0. Any other error is real.' },
      { lines: '27', md: 'Appends a new entry for the key. The old entry is marked stale; nothing is erased now.' },
      { lines: '28', md: 'Ensures the change is written to flash. Without it, a power cut may lose the update.' },
      { lines: '29', md: 'Releases the handle and its RAM.' },
    ] },

    `## Wear and write frequency

Each \`nvs_set\` of a small value consumes one 32-byte entry; a 4 kB page holds 126 entries before it must be erased. So NVS divides your write rate by a large factor before it reaches erase cycles, and spreads the erases over all its pages. Still, the right design is to **write when the value changes, not periodically**, and for values that change constantly (an energy counter) to save on a schedule of minutes, or on a power-fail warning, not on every sample.

To examine or reset stored data during development: \`idf.py erase-flash\` wipes everything including NVS; \`esptool read-flash\` can dump the partition.`,

    { t: 'callout', kind: 'security', md: `**NVS is not secret by default.** Anyone with physical access can read the flash chip with esptool and see every value in plain bytes, including Wi-Fi credentials and API keys. ESP-IDF provides **NVS encryption**, normally used together with flash encryption. The security section covers how it works and how to verify it; for now, do not assume a value is private because it is "inside the chip".` },

    { t: 'callout', kind: 'mistake', md: `**Flashing new firmware and expecting old settings to be gone.** \`idf.py flash\` writes the bootloader, partition table and app. It does not touch the NVS partition, so stored values from a previous firmware version persist, including ones your new code interprets differently. When behaviour after an update looks haunted, erase the flash once and retest; in a product, store a schema version key and migrate deliberately.` },

    { t: 'predict', q: 'The boot counter program is changed so that the key is `"number_of_boots_total"`. What happens?',
      choices: [
        { t: 'It works as before, since keys are arbitrary strings', why: 'Count the characters in the new key and compare with the limit NVS places on key names.' },
        { t: '`nvs_set_u32` returns an error because the key is too long', ok: true, why: 'Keys are limited to 15 characters. This one has 21, so the call is rejected.' },
        { t: 'The key is silently truncated to 15 characters and stored', why: 'Silent truncation would let two long keys collide. The library rejects the name instead.' },
      ],
      reveal: `NVS keys and namespace names may be at most 15 characters. The call fails with a key-too-long error, and because the example wraps it in \`ESP_ERROR_CHECK\`, the device aborts and reboots, fails again, and so on: a boot loop caused by a string length. It shows both the limit and the hazard of aborting on storage errors.` },

    { t: 'exercise', prompt: `An NVS partition is written by a design that updates one small value every 10 seconds, all day. One page holds 126 such entries. Suppose the default 24 kB partition gives 5 usable pages (the sixth is kept in reserve) and, illustratively, that each page tolerates 100 000 erases. Roughly how many **years** until the erase budget is exhausted? Give a whole number.`,
      hints: [
        `How many writes can be made per page erase, and how many page erases does the whole partition allow?`,
        `Total writes ≈ 126 entries × 5 pages × 100 000 erases = 63 000 000.`,
        `Writes per year at one every 10 s: 6 per minute × 60 × 24 × 365 = 3 153 600.`,
      ],
      solution: `63 000 000 / 3 153 600 ≈ **20 years**. The same write rate with a naive erase-per-write scheme on one sector would last 100 000 × 10 s ≈ 11.6 days. The log structure and wear levelling are worth a factor of several hundred here. The endurance figure is illustrative and the rest is simplified: strings and blobs take several entries each, and endurance depends on the flash part, so check both before promising a lifetime. A larger NVS partition extends life proportionally.`,
      answer: { type: 'number', value: 20, tol: 1, unit: 'years' } },

    { t: 'exercise', prompt: `**Find the bugs.** This is a "tidied" version of the boot counter. On a freshly erased chip it aborts at the first marked line. After that line is repaired by hand it aborts at the second. Explain each abort, then name the error the second call returns.`,
      code: R`nvs_handle_t h;
ESP_ERROR_CHECK(nvs_open("app", NVS_READONLY, &h));     /* 1 */

uint32_t boots = 0;
nvs_get_u32(h, "boots", &boots);
boots++;
ESP_ERROR_CHECK(nvs_set_u32(h, "boots", boots));        /* 2 */
nvs_close(h);`,
      hints: [
        `What does a freshly erased NVS partition contain? What did the worked example say a read-only open does when the namespace is not there?`,
        `Look at the second argument of \`nvs_open\` and then at what the code does with the handle.`,
        `A handle opened read-only cannot be written. Once both are fixed there is still a third defect, which does not abort: compare the end of this fragment with the worked example.`,
      ],
      solution: `1. \`NVS_READONLY\` cannot create a namespace. On an erased chip \`app\` does not exist, \`nvs_open\` returns \`ESP_ERR_NVS_NOT_FOUND\`, and \`ESP_ERROR_CHECK\` aborts: a boot loop on every new device, and on none of the developer's boards, which already had the namespace.
2. With the namespace present, \`nvs_set_u32\` on a read-only handle returns **\`ESP_ERR_NVS_READ_ONLY\`**.

Open with \`NVS_READWRITE\`. Two more defects remain that abort nothing: there is no \`nvs_commit\`, so the new count is not guaranteed to be on flash before power is lost, and the result of \`nvs_get_u32\` is ignored, so a real read error is treated like "first boot". The worked example handles all four.`,
      answer: { type: 'text', accept: ['read.?only'], nudge: 'How was the handle opened, and what is the code then trying to do with it?' } },

    `## Harder: power fails mid-update

A device stores a two-part setting: \`mode\` and \`limit\`, which must always be consistent with each other. The code writes \`mode\`, then \`limit\`, then commits. Power fails between the two writes. What might the device read at next boot, and does one commit at the end protect you? (The documentation promises that a single entry is either written or not; it does not make a group of keys atomic.) Redesign the storage so that the pair is always consistent: consider storing both in one blob, so the pair is a single entry, and adding a checksum and a version field so that a damaged or old-format blob is detected and replaced by safe defaults.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Non-Volatile Storage Library', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_flash.html' },
      { title: 'ESP-IDF NVS Encryption', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_encryption.html' },
      { title: 'Partition Tables', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/partition-tables.html' },
    ] },
  ],
  quiz: [
    { q: 'Why can a flash-based store not simply overwrite an old value with a new one?', kind: 'arch', choices: [
      { t: 'Programming only clears bits to 0; getting 1s back means erasing a whole sector', ok: true, why: 'That asymmetry is why stores append new entries and reclaim space sector by sector.' },
      { t: 'Flash becomes read-only once the firmware has been installed and verified', why: 'Flash can be written at run time. The restriction is on how bits can change, not on whether they can.' },
      { t: 'The CPU cannot address flash for writing, only for reading through the cache', why: 'Writes go through the SPI flash driver. Addressing is not the obstacle.' },
    ] },
    { q: 'After `nvs_set_i32(h, "limit", 42)` the device loses power before `nvs_commit`. What can you rely on at next boot?', kind: 'code', choices: [
      { t: 'Nothing about the new value: only a commit guarantees it reached flash', ok: true, why: 'The API contract is that changes are durable after nvs_commit. Code must not depend on what happens without it.' },
      { t: 'The new value is certainly stored, as every set is written at once', why: 'That assumes every set is flushed synchronously, which the API does not promise.' },
      { t: 'The whole namespace is erased, because the page was left half-written', why: 'An interrupted write does not wipe existing data; the previous value of the key remains valid.' },
    ] },
    { q: 'New firmware is flashed with `idf.py flash` and the device still connects to the old Wi-Fi network without being configured. Why?', kind: 'concept', choices: [
      { t: 'Flashing rewrites the app but leaves the NVS partition, which holds the credentials', ok: true, why: 'Data partitions persist across firmware updates unless explicitly erased.' },
      { t: 'The credentials are compiled into the bootloader, which `idf.py flash` does not rewrite', why: 'The bootloader has no Wi-Fi functionality and was itself rewritten by the flash operation.' },
      { t: 'Wi-Fi credentials are stored in the router, which recognises the device by its MAC', why: 'A station must present the passphrase itself. It had to come from somewhere on the device.' },
    ] },
    { q: '`nvs_get_u16(h, "level", &v)` fails although `nvs_set_u8(h, "level", 3)` succeeded earlier. Why?', kind: 'code', choices: [
      { t: 'NVS values are typed; a key written as u8 must be read as u8', ok: true, why: 'The stored entry records its type, and a read with a different type does not match.' },
      { t: 'A value as small as 3 is treated as "unset" and not stored', why: 'Small values are perfectly valid. The mismatch is between the type written and the type requested.' },
      { t: 'The key was deleted when the earlier write was committed', why: 'Committing makes entries durable. It never removes them.' },
    ] },
    { q: 'An attacker has the device in hand and a USB cable. With default settings, what protects an API key stored in NVS?', kind: 'security', choices: [
      { t: 'Nothing: the flash can be read out and the key found in plain bytes', ok: true, why: 'Without flash and NVS encryption, the contents of external flash are readable with standard tools.' },
      { t: 'The NVS namespace name acts as a password for reading its keys', why: 'A namespace is only a label for grouping keys. It is stored in the clear next to the data.' },
      { t: 'The partition table hides the NVS partition from external tools', why: 'The partition table is itself readable and tells the attacker exactly where NVS is.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 15. Wi-Fi and Bluetooth
lessons.push({
  id: 'esp-l-wireless', title: 'Wi-Fi and Bluetooth', minutes: 55,
  summary: 'Station mode as a set of events, reconnection, power, BLE GATT concepts, and the security basics.',
  skills: ['esp-wifi-sta', 'esp-ble-gatt'],
  blocks: [
    `## It connected on my desk

A sensor connects to Wi-Fi at boot, then publishes a reading every minute. On the desk it runs for days. Installed, it works until the access point restarts for a firmware update at 3 a.m., and never reports again, though it is still powered and its LED still blinks.

The code called \`esp_wifi_connect()\` once, at start-up, and treated the connection as a permanent fact. A wireless link is a state that changes without asking you. The ESP-IDF Wi-Fi API is built around that: you do not "connect and continue", you **react to events**.`,

    `## The pieces

| Component | Role |
|---|---|
| \`esp_wifi\` | The Wi-Fi driver: radio, scanning, association, WPA2/WPA3 |
| \`esp_netif\` | The network interface layer joining the driver to the TCP/IP stack (lwIP); runs the DHCP client |
| \`esp_event\` | The default **event loop**: a task that calls your handlers when something happens |
| \`nvs_flash\` | Wi-Fi stores calibration and, by default, credentials in NVS, so NVS must be initialised first |

In **station** (STA) mode the ESP32 joins an existing access point. (It can also be an access point itself, or both.) The sequence of events for a successful connection is:

1. \`WIFI_EVENT_STA_START\`: the driver is running. Now call \`esp_wifi_connect()\`.
2. \`WIFI_EVENT_STA_CONNECTED\`: associated and authenticated with the access point. There is **no IP address yet**.
3. \`IP_EVENT_STA_GOT_IP\`: DHCP finished. Only now can sockets work.

And at any later time: \`WIFI_EVENT_STA_DISCONNECTED\`, with a reason code. Your handler decides what happens next. If it does nothing, the device stays offline for ever, which is the opening problem.`,

    { t: 'code', lang: 'c', status: 'idf-built', caption: 'Station mode with reconnection', code: R`#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "nvs_flash.h"

#define WIFI_SSID "your-ssid"        /* for a bench test only: see the security note */
#define WIFI_PASS "your-password"

static const char *TAG = "wifi";

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *d = (wifi_event_sta_disconnected_t *)data;
        ESP_LOGW(TAG, "disconnected, reason %d; retrying", (int)d->reason);
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "got ip " IPSTR, IP2STR(&e->ip_info.ip));
    }
}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event, NULL, NULL));

    wifi_config_t cfg = {
        .sta = {
            .ssid     = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
}`, explain: [
      { lines: '15-27', md: 'One handler for all three events. It runs in the event loop task, so it may log and call Wi-Fi functions but must not block for long: every other event waits behind it.' },
      { lines: '19-22', md: 'The line that fixes the opening problem. The reason code says why (wrong password, access point gone, beacon timeout ...). A product should back off between retries; hammering reconnect in a tight loop wastes power and floods the log.' },
      { lines: '23-25', md: 'The interface has an address. This is the earliest moment network code can run.' },
      { lines: '31-36', md: 'NVS first: the Wi-Fi driver needs it.' },
      { lines: '38-40', md: 'Start the TCP/IP stack, create the default event loop, and create a network interface bound to the station.' },
      { lines: '42-43', md: 'Allocates the driver with default buffer sizes taken from sdkconfig and creates the Wi-Fi driver task. This is where tens of kilobytes of RAM go. The radio is still off.' },
      { lines: '45-48', md: 'Subscribe to all Wi-Fi events and to the got-IP event.' },
      { lines: '50-58', md: 'Set station mode and credentials, then start. `esp_wifi_start` powers up the radio and its PHY (calibrating it, with data kept in NVS) and returns at once; everything after it happens through events, beginning with `WIFI_EVENT_STA_START`.' },
    ] },

    { t: 'callout', kind: 'note', md: `**Old tutorials.** Before ESP-IDF v4.1 the network layer was \`tcpip_adapter\` (\`tcpip_adapter_init()\`), the handler was registered with \`esp_event_loop_init(callback, ...)\`, and events were named \`SYSTEM_EVENT_STA_GOT_IP\`. All of that is gone; \`esp_netif\` and \`esp_event\` replaced it. Code in that style will not build.` },

    `## Using the connection

Once you have an IP address, ESP-IDF offers BSD sockets and higher-level clients. An HTTPS GET with \`esp_http_client\` is a few lines: fill an \`esp_http_client_config_t\` with the \`url\`, call \`esp_http_client_init\`, \`esp_http_client_perform\`, read \`esp_http_client_get_status_code\`, then \`esp_http_client_cleanup\`. For telemetry, MQTT (\`esp-mqtt\`) keeps one connection open to a broker and publishes small messages to topics, which suits devices better than repeated HTTP requests.

Network calls block, sometimes for many seconds. Run them in their own task with a generous stack (TLS needs several kilobytes), never in the event handler, and start them only after \`IP_EVENT_STA_GOT_IP\`.`,

    `## Power and the hardware consequences

The radio draws short bursts of high current when transmitting (hundreds of milliamps; see the datasheet's RF power consumption table). Two consequences:

- **Supply.** A weak USB port, a thin cable or an undersized regulator lets the 3.3 V rail dip during a burst, and the brownout detector resets the chip, typically at the moment Wi-Fi starts. Bulk capacitance close to the module and an adequate regulator are part of the design.
- **Energy.** Station mode uses modem power save by default (\`WIFI_PS_MIN_MODEM\`): the radio sleeps between access-point beacons. That saves power at the cost of latency. \`esp_wifi_set_ps()\` changes it. Battery devices usually go further and deep-sleep between reports, reconnecting each time.

And from the pin lesson: on the ESP32, ADC2 is unavailable while Wi-Fi runs.`,

    `## Bluetooth Low Energy in concepts

BLE is not "wireless serial". It is a small database protocol.

- **Roles.** A **peripheral** advertises its presence; a **central** (usually a phone) scans and connects. After connecting, the device that holds the data is the **GATT server** and the one that reads it is the **client**. A sensor is normally peripheral and server.
- **Data model (GATT).** The server exposes **services**, each a group of **characteristics**. A characteristic is one value with a UUID and **properties**: read, write, notify. A heart-rate sensor has a Heart Rate service containing a measurement characteristic the phone subscribes to; with **notify**, the peripheral pushes each new value.
- **Advertising.** Before connection the peripheral broadcasts small packets with its name and services. Advertising data is public.

ESP-IDF offers two BLE host stacks, **NimBLE** (smaller, BLE only) and Bluedroid (larger; also Bluetooth Classic on the original ESP32). For BLE-only products NimBLE is the usual choice, selected in menuconfig. Designing a BLE device means designing its GATT table first: which characteristics, which properties, which require an encrypted link. Only the original ESP32 supports Bluetooth Classic; the S3, C3 and C6 are BLE only.

**Coexistence.** Wi-Fi and Bluetooth share one 2.4 GHz radio and antenna, time-sliced by a coexistence arbiter. Both work together, each with reduced throughput and more latency than alone.`,

    { t: 'callout', kind: 'security', md: `**Three basics.**

1. **Credentials do not belong in source code.** The \`#define\` above ends up in the binary, in version control and in every device. Products obtain credentials at set-up through **provisioning** over BLE or a temporary access point (Espressif's \`network_provisioning\` component from the ESP Component Registry; it was called \`wifi_provisioning\` and shipped inside ESP-IDF until v6.0 removed it from the tree) and store them in NVS, which, as you saw, is itself readable unless encrypted.
2. **TLS without certificate verification is not security.** An HTTPS or MQTT-over-TLS connection that does not verify the server's certificate is encrypted to whoever answers, including an attacker in the middle. Supply a CA certificate, or attach ESP-IDF's certificate bundle (\`.crt_bundle_attach = esp_crt_bundle_attach\`), and never ship an option that skips verification.
3. **BLE characteristics are readable by any nearby device** unless they require pairing and encryption. Mark sensitive characteristics accordingly and test with a generic BLE scanner app on a phone you own.

Experiment only on networks and devices that are yours.` },

    { t: 'callout', kind: 'mistake', md: `**Starting network work right after \`esp_wifi_start()\`.** The call returns immediately; association and DHCP take seconds. A request made at that point fails with a DNS or connection error. Wait for the got-IP event: have the handler set an event-group bit or give a semaphore, and have the network task block on it.` },

    { t: 'predict', q: 'The password in the example is wrong. With the handler as written, what does the serial log show?',
      choices: [
        { t: 'One "disconnected" line, then silence while the driver gives up', why: 'Look at what the handler does on every disconnect event. It does not stop after the first.' },
        { t: 'A repeating stream of "disconnected ... retrying" lines', ok: true, why: 'Each failed authentication produces a disconnected event, and the handler immediately tries again, for ever.' },
        { t: 'A panic, because authentication failure is fatal', why: 'A failed connection is an ordinary event delivered to the handler, not an exception.' },
      ],
      reveal: `Authentication failure arrives as \`WIFI_EVENT_STA_DISCONNECTED\` with a reason code indicating the handshake or authentication failed, and the handler retries without limit or delay. The device never gets an address, the log scrolls, and the radio stays busy. A better policy: count retries, back off (1 s, 2 s, 4 s ... capped), and treat an authentication-type reason differently from "access point not found", for instance by re-entering provisioning after several failures.` },

    { t: 'exercise', prompt: `Modify the example so that a separate task, \`report_task\`, waits until the device has an IP address before doing its (blocking) network work, and waits again after any disconnection. Use an event group. Describe the changes to the handler and write the task's waiting logic.`,
      hints: [
        `An event group is a set of bits that tasks can wait on. You need one bit meaning "connected with an IP address".`,
        `Set the bit on got-IP with \`xEventGroupSetBits\`; clear it on disconnect with \`xEventGroupClearBits\`.`,
        `In the task: \`xEventGroupWaitBits(group, BIT, pdFALSE, pdTRUE, portMAX_DELAY)\`. Pass \`pdFALSE\` for clear-on-exit so the bit continues to reflect the link state.`,
      ],
      solution: `\`\`\`c
#include "freertos/event_groups.h"

#define GOT_IP_BIT BIT0
static EventGroupHandle_t s_net;

/* in on_event: */
/*   on WIFI_EVENT_STA_DISCONNECTED: */  xEventGroupClearBits(s_net, GOT_IP_BIT);
/*   on IP_EVENT_STA_GOT_IP:         */  xEventGroupSetBits(s_net, GOT_IP_BIT);

static void report_task(void *arg)
{
    while (1) {
        xEventGroupWaitBits(s_net, GOT_IP_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
        /* blocking network work: one HTTP request or MQTT publish */
        vTaskDelay(pdMS_TO_TICKS(60000));
    }
}

/* in app_main, before esp_wifi_start(): */
s_net = xEventGroupCreate();
xTaskCreate(report_task, "report", 8192, NULL, 5, NULL);
\`\`\`

The task blocks with no CPU use while offline and resumes by itself when the link returns. The network call can still fail if the link drops mid-request, so its error must be handled too: the bit only says the link was up when you looked. The 8192-byte stack allows for TLS.` },

    { t: 'exercise', prompt: `**Find the bug.** The end of \`app_main\` in the worked example was reordered as below. The firmware builds and starts, and then nothing happens: no "disconnected", no "got ip", no connection. Which event did the handler never receive? Give its name.`,
      code: R`    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    vTaskDelay(pdMS_TO_TICKS(500));          /* "let the driver settle" */

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &on_event, NULL, NULL));`,
      hints: [
        `Which line of the whole program actually asks the driver to join the network? What causes that line to run?`,
        `\`esp_wifi_connect()\` is only ever called from the handler. An event posted while no handler is registered is delivered to nobody; it is not kept for later.`,
        `List the events in order from the "pieces" section and ask which one is posted within the first half second after \`esp_wifi_start()\`.`,
      ],
      solution: `**\`WIFI_EVENT_STA_START\`.** The driver posts it shortly after \`esp_wifi_start()\`. With no handler registered yet, the event loop has nobody to call and drops it. The handler is registered half a second later and waits for an event that has already gone, so \`esp_wifi_connect()\` is never called; and since nothing ever connects, no disconnect event arrives to trigger a retry either.

Register handlers **before** starting whatever produces the events. It is the same ordering rule as creating the queue before enabling the interrupt, and the delay "to let things settle" is what turned a narrow race into a certain failure.`,
      answer: { type: 'text', accept: ['STA_?START'], nudge: 'Which event makes the handler call esp_wifi_connect() the first time?' } },

    `## Harder: a battery budget

A coin-cell-class sensor must report once every 10 minutes for a year. Compare two designs: staying associated in modem sleep, and deep sleep with a full reconnect for each report. For each, list what consumes energy (sleep current, the reconnect and DHCP time at full radio power, TLS handshake) and what you would need from the datasheet to put numbers on it. Then consider BLE advertising of the reading instead of Wi-Fi: which role and GATT design would you use, what receives the data, and what did you give up? There is no universal answer; the exercise is to see that the radio protocol is a system design decision.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Wi-Fi Driver guide', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/wifi.html', note: 'Event sequences and disconnect reason codes' },
      { title: 'ESP-IDF Event Loop Library', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/esp_event.html' },
      { title: 'ESP-IDF ESP HTTP Client', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/protocols/esp_http_client.html' },
      { title: 'ESP-IDF Bluetooth API and NimBLE host', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/index.html' },
      { title: 'ESP-IDF RF Coexistence', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/coexist.html' },
      { title: 'network_provisioning component (ESP Component Registry)', url: 'https://components.espressif.com/component/espressif/network_provisioning', note: 'Successor of wifi_provisioning, which ESP-IDF v6.0 removed from the tree' },
    ] },
  ],
  quiz: [
    { q: 'After `WIFI_EVENT_STA_CONNECTED`, a socket connection attempt fails. Why?', kind: 'arch', choices: [
      { t: 'The station is associated but has no IP address yet', ok: true, why: 'Association and addressing are separate steps. Network traffic is possible only after the got-IP event.' },
      { t: 'Sockets are not supported in station mode', why: 'Station mode is the normal mode for client sockets. The attempt was simply made one step too early.' },
      { t: 'The event loop must be deleted before using sockets', why: 'The event loop keeps running for the life of the connection; it is how you learn about later disconnects.' },
    ] },
    { q: 'An ESP32 resets with a brownout message exactly when Wi-Fi starts. What is the most likely cause?', kind: 'circuit', choices: [
      { t: 'The 3.3 V supply sags during radio transmit current bursts', ok: true, why: 'Transmit bursts draw far more current than idle. A weak source, cable or regulator lets the rail dip below the brownout threshold.' },
      { t: 'The Wi-Fi password is wrong, so the driver resets to retry', why: 'A wrong password yields disconnect events with a reason code. It does not affect the supply voltage.' },
      { t: 'The application binary is too large for the radio to run', why: 'An oversized image is caught at build time and has no connection with supply voltage at run time.' },
    ] },
    { q: 'In BLE terms, a temperature sensor that a phone connects to and subscribes to is normally…', kind: 'concept', choices: [
      { t: 'A peripheral acting as GATT server, sending notifications', ok: true, why: 'It advertises (peripheral), holds the data (server), and pushes new values to the subscribed client.' },
      { t: 'A central acting as GATT client, reading the phone\'s data', why: 'That describes the phone: it scans, initiates the connection and reads the data.' },
      { t: 'A broadcaster with no GATT table, sending only advertisements', why: 'A pure broadcaster cannot be connected to or subscribed to; the scenario describes a connection.' },
    ] },
    { q: 'Firmware makes HTTPS requests with certificate verification skipped "because it works". What is the actual exposure?', kind: 'security', choices: [
      { t: 'Anyone who can intercept the connection can impersonate the server', ok: true, why: 'Encryption without authentication protects the data only from passive observers, not from an active attacker who terminates the TLS session.' },
      { t: 'None; the traffic is still encrypted, so nobody else can read it', why: 'It is encrypted to whoever answered. Without verification the device cannot know that this is the intended server.' },
      { t: 'Only that the connection is slower, as the handshake is repeated', why: 'Skipping verification saves a little time. The cost is the loss of server authentication.' },
    ] },
    { q: 'Why should long work not be done inside a Wi-Fi event handler?', kind: 'arch', choices: [
      { t: 'Handlers share one event loop task, so a slow one delays every other event', ok: true, why: 'Events are dispatched one after another. A handler that blocks for seconds stalls disconnect and IP events behind it.' },
      { t: 'Handlers run in interrupt context, where any blocking call crashes the system', why: 'Default event loop handlers run in a task and may call ordinary APIs. The limitation is that they share one task.' },
      { t: 'Handlers have no access to global variables or to the heap', why: 'They are ordinary C functions with normal access to program state.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── 16. Serial debugging and crash analysis
lessons.push({
  id: 'esp-l-debug', title: 'Serial debugging, panics and crash analysis', minutes: 45,
  summary: 'Reading the boot log, decoding a Guru Meditation backtrace, and knowing why the chip last reset.',
  skills: ['esp-panic-decode', 'esp-logging'],
  blocks: [
    `## A wall of hex

Your firmware runs for a minute and then the monitor fills with \`Guru Meditation Error\`, a table of registers and a line of hexadecimal pairs, and the board reboots. It is tempting to scroll past and start adding print statements.

That dump is the most precise bug report you will ever get: the CPU is telling you which instruction failed, what address it touched, and the chain of calls that led there. Reading it takes five minutes to learn.`,

    `## The serial log, stage by stage

Everything on the console comes from one of three stages, and knowing which stage printed the last line localises a failure:

1. **ROM.** First line after reset: the reset reason and boot mode, for example \`rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\` on an ESP32. A boot value indicating download mode means a strapping pin was low.
2. **Second-stage bootloader.** Lines tagged \`boot:\`: the partition table and the image being loaded.
3. **Application.** ESP-IDF start-up lines, then your \`ESP_LOGx\` output.

\`idf.py monitor\` is more than a terminal. It has the ELF file of your build, so it **decodes code addresses** it sees into function names and source lines, colours log levels, and can reset the chip (Ctrl-T Ctrl-R) or rebuild and flash the application (Ctrl-T Ctrl-A). Exit with Ctrl-]. If the output is unreadable garbage, the baud rate is wrong; if a crash decodes to nonsense, the monitor's ELF does not match the firmware on the chip.`,

    `## Anatomy of a panic

When the CPU hits a fault it cannot handle, ESP-IDF's panic handler prints the state and resets. On an Xtensa chip (ESP32, S3) it looks like this (illustrative values):`,

    { t: 'ascii', text: `Guru Meditation Error: Core  0 panic'ed (LoadProhibited). Exception was unhandled.

Core  0 register dump:
PC      : 0x400d5a3f  PS      : 0x00060630  A0      : 0x800d5b10  A1      : 0x3ffb4f50
...
EXCVADDR: 0x00000004  LBEG    : 0x00000000  LEND    : 0x00000000  LCOUNT  : 0x00000000

Backtrace: 0x400d5a3c:0x3ffb4f50 0x400d5b0d:0x3ffb4f70 0x400d5c21:0x3ffb4f90 0x40088b11:0x3ffb4fb0`, caption: 'An illustrative Xtensa panic. Four facts matter: the cause, PC, EXCVADDR and the backtrace.' },

    `- **Cause** (in parentheses). \`LoadProhibited\` / \`StoreProhibited\`: a read or write through a bad pointer. \`InstrFetchProhibited\`: a jump to a bad address, typically a NULL or corrupted function pointer. \`IllegalInstruction\`: executing data, often after stack corruption. \`IntegerDivideByZero\`. On RISC-V chips (C3, C6) the names differ (\`Load access fault\`, \`Store access fault\`, \`Illegal instruction\`).
- **PC**: the address of the failing instruction.
- **EXCVADDR**: the data address that was accessed. A small value such as \`0x00000004\` is the signature of a **NULL pointer**: a field at offset 4 of a struct whose pointer is NULL.
- **Backtrace**: pairs of \`PC:SP\`, innermost call first. The PCs are the call chain.

Use the memory map from the first lesson to sanity-check addresses: \`0x400Dxxxx\` and above is application code in flash, \`0x4008xxxx\` is IRAM, \`0x3FFBxxxx\` is data RAM. A PC that is not in a code region at all means the CPU jumped into the weeds.

To turn the addresses into source lines, let the monitor do it, or run the toolchain's \`addr2line\` on the ELF by hand:

\`\`\`sh
xtensa-esp32-elf-addr2line -pfiaC -e build/myapp.elf 0x400d5a3c 0x400d5b0d 0x400d5c21
\`\`\`

(For RISC-V targets the tool is \`riscv32-esp-elf-addr2line\`.) The output is a function name, file and line for each address. Read it innermost first: the first line is where it died, the following lines are who called it.

RISC-V chips do not print a \`Backtrace:\` line by default. They print the registers and a dump of stack memory, and \`idf.py monitor\` reconstructs the call chain from that using the ELF. Another reason to use the IDF monitor and not a plain terminal.`,

    { t: 'callout', kind: 'why', md: `**Keep the ELF for every build you ship.** The \`.bin\` on the device has no symbols. The \`.elf\` from the *same build* is the only thing that maps addresses back to source. A crash log from the field is useless without it, and an ELF from a rebuild may not match. Archive \`build/<project>.elf\` alongside each released binary.` },

    `## Other fatal messages

| You see | Meaning |
|---|---|
| \`abort() was called at PC 0x...\` | Software called \`abort()\`: a failed \`ESP_ERROR_CHECK\` (the lines above name the error, file and line), a failed \`assert\`, or heap corruption detected |
| \`***ERROR*** A stack overflow in task NAME has been detected\` | That task's stack is too small |
| \`Interrupt wdt timeout on CPU0\` | Interrupts blocked too long: a long critical section or ISR |
| \`Task watchdog got triggered\` | A task hogged a core (warning or reset, depending on configuration) |
| \`Brownout detector was triggered\` | Supply voltage dipped |
| \`Cache disabled but cached memory region accessed\` | An IRAM-registered ISR touched code or data in flash during a flash operation |

**Core dumps.** For crashes you cannot watch, ESP-IDF can save the state of all tasks to a flash partition (or print it on the UART) at the moment of the panic. Enable it in menuconfig, add a \`coredump\` partition, and after the next crash run \`idf.py coredump-info\` for a summary of every task's backtrace, or \`idf.py coredump-debug\` to open it in GDB. It is the embedded equivalent of a post-mortem debugger session and is how field failures are diagnosed.`,

    { t: 'callout', kind: 'security', md: `**Diagnostics are also disclosures.** A verbose log, a panic dump and a core dump reveal addresses, task names, sometimes buffer contents and keys. Useful to you, and to anyone else with a serial cable. For a product, decide deliberately what the console prints, and whether core dumps are stored encrypted. The security section returns to this.` },

    { t: 'callout', kind: 'mistake', md: `**Debugging by adding prints and reflashing, while ignoring the backtrace.** Each cycle costs minutes and the added logging changes timing and stack use, which can hide the very bug you are chasing. Decode the dump first. In most cases it names the exact line, and the question becomes "why was this pointer NULL", not "where does it crash".` },

    { t: 'predict', q: 'A panic shows cause `InstrFetchProhibited`, `PC: 0x00000000`, and a backtrace whose second entry decodes to `dispatch_command` in your code. What most likely happened?',
      choices: [
        { t: '`dispatch_command` called through a NULL function pointer', ok: true, why: 'The CPU tried to fetch an instruction from address 0. The caller in the backtrace is the function that made the bad call.' },
        { t: '`dispatch_command` read a struct field through a NULL data pointer', why: 'Reading data through a bad pointer is a load fault with a normal PC inside the function. Here the program counter itself is the bad address.' },
        { t: 'The flash chip is faulty and returned zeros for the code', why: 'A flash fault would not produce a clean jump to exactly address zero from one particular function.' },
      ],
      reveal: `\`InstrFetchProhibited\` with PC = 0 means the processor jumped to address 0 and could not fetch code there. The first backtrace entry is the bogus address; the second is the caller. Look in \`dispatch_command\` for a call through a table of function pointers or a callback field, and find which entry was never set. The defence is a check before the call: an unknown command should produce an error reply, not an indirect call.` },

    { t: 'exercise', prompt: `Using the ESP32 memory map (DRAM \`0x3FFAE000–0x40000000\`, IRAM \`0x40080000–0x400AA000\`, IROM \`0x400D0000–0x40400000\`), interpret this illustrative panic: cause \`StoreProhibited\`, \`PC: 0x400d2b14\`, \`EXCVADDR: 0x00000010\`. Which region was executing, what kind of bug is it, and what is the single most likely mistake in the source? Answer the bug type in two words.`,
      hints: [
        `Place the PC in a region first. Is this application code, RAM code, or not code at all?`,
        `\`StoreProhibited\` is a failed **write**. Look at the address being written: is \`0x10\` a plausible address for a variable?`,
        `A write to a small offset from zero is a write to a field of a struct through a pointer whose value is zero.`,
      ],
      solution: `The PC is in **IROM**: ordinary application code in flash, so the program counter is sane and the fault is in what that instruction did. It attempted to **write** to address \`0x10\`, which is not RAM. That is a **NULL pointer** dereference: something like \`cfg->timeout = 5;\` where \`timeout\` is 16 bytes into the struct and \`cfg\` is NULL. The usual origins are an allocation or handle-creation call whose failure was not checked, or a handle used before initialisation (a queue or driver handle that is still NULL because the init order is wrong). Decode \`0x400d2b14\` with addr2line to get the line, then ask where that pointer was supposed to be set.`,
      answer: { type: 'text', accept: ['null\\s*-?\\s*pointer', 'null\\s+deref', 'nullptr'], nudge: 'What does a write to an address just above zero tell you about the pointer that was used?' } },

    { t: 'exercise', prompt: `**Read the code against the dump.** This code panics with \`LoadProhibited\`, \`EXCVADDR: 0x00000008\`, and the innermost backtrace entry decodes to the marked line. (a) Which pointer was NULL, and which field was being read? (b) If the marked line had instead been \`j->timeout_ms = 0;\`, the cause would be \`StoreProhibited\`. What EXCVADDR would be reported? Answer (b) as a number.`,
      code: R`typedef struct {
    int      id;                 /* offset 0 */
    uint32_t timeout_ms;         /* offset 4 */
    void   (*on_done)(int id);   /* offset 8 */
} job_t;

static job_t s_jobs[4];

static job_t *find_job(int id)
{
    for (int i = 0; i < 4; i++) {
        if (s_jobs[i].id == id) {
            return &s_jobs[i];
        }
    }
    return NULL;
}

void job_finish(int id)
{
    job_t *j = find_job(id);
    j->on_done(id);              /* <-- */
}`,
      hints: [
        `EXCVADDR is the address the instruction tried to read. Which field of \`job_t\` sits 8 bytes from the start?`,
        `The address is the pointer's value plus the field's offset. If the sum is 8 and the offset is 8, what was the pointer?`,
        `For part (b) use the same sum with the offset of \`timeout_ms\`.`,
      ],
      solution: `(a) \`j\` was NULL: \`find_job\` found no job with that id and returned NULL, and \`job_finish\` used the result unchecked. The CPU faulted while **loading** the function pointer \`on_done\` from address 0 + 8. It never got as far as calling it, which is why the cause is \`LoadProhibited\` and the PC is still inside \`job_finish\`. (Had \`j\` been valid and \`on_done\` itself NULL, you would see \`InstrFetchProhibited\` with PC = 0, as in the prediction above.)

(b) \`timeout_ms\` is at offset 4, so the failed write is to address **4** (\`0x00000004\`).

The repair is in the caller: \`if (j == NULL) { /* unknown id: report it */ return; }\`. The offset in EXCVADDR tells you which field, and therefore which line, even when two dereferences share a function.`,
      answer: { type: 'number', value: 4, tol: 0 } },

    `## Harder: a crash you plant yourself

In any working project, add a function that writes through a NULL struct pointer, call it three levels deep from a task you created, and trigger it from a button or after ten seconds. Before running it, write down what you expect: the cause, the approximate EXCVADDR (compute the field offset), the order of functions in the backtrace, and the reset reason reported at the next boot. Then flash, capture the dump, decode it with \`addr2line\` by hand without the monitor's help, and compare each prediction with what you see. Repeat with a 2 kB local array in a task with a 2048-byte stack and predict which message appears instead. Planting known faults is how you learn to trust, and to read, the tools before a real crash arrives.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF Fatal Errors', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/fatal-errors.html' },
      { title: 'ESP-IDF Monitor', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-monitor.html' },
      { title: 'ESP-IDF Core Dump', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html' },
      { title: 'ESP-IDF Logging library', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/log.html' },
    ] },
  ],
  quiz: [
    { q: 'A panic reports `LoadProhibited` with `EXCVADDR: 0x00000008`. What is the most likely bug?', kind: 'code', choices: [
      { t: 'Reading a struct field through a NULL pointer', ok: true, why: 'A read from an address a few bytes above zero is a field offset added to a pointer whose value is zero.' },
      { t: 'A stack overflow in the running task', why: 'ESP-IDF reports a detected stack overflow with its own message naming the task. A tiny fault address points at a zero-valued pointer.' },
      { t: 'A wrong baud rate corrupting received data', why: 'A baud mismatch garbles the text you see but cannot cause a CPU exception.' },
    ] },
    { q: 'Why does a crash log from a deployed device need the ELF file from exactly that build?', kind: 'concept', choices: [
      { t: 'Only that ELF maps the dump\'s addresses to the right functions and lines', ok: true, why: 'Any change in code or compiler options moves functions, so a different build decodes the same addresses to the wrong places.' },
      { t: 'The ELF file contains the device\'s log history up to the moment of the crash', why: 'The ELF is a build product on the PC. It holds code, data and symbols, not anything recorded at run time.' },
      { t: 'The device cannot boot again until the matching ELF is flashed', why: 'Only the binary images are flashed. The ELF never leaves the development machine.' },
    ] },
    { q: 'The log ends with `abort() was called at PC ...`, preceded by `ESP_ERROR_CHECK failed: esp_err_t 0x105 (ESP_ERR_NOT_FOUND) ... file "main.c" line 42`. What is the correct reading?', kind: 'code', choices: [
      { t: 'A call on line 42 returned an error and the macro aborted', ok: true, why: 'This is a software-initiated stop with the cause, file and line already printed. Look at what line 42 called and why it could fail.' },
      { t: 'The CPU hit an illegal instruction while executing line 42 of main.c', why: 'An illegal instruction is a hardware exception with its own panic cause. Here the program chose to stop.' },
      { t: 'The flash is corrupted near address 0x105, where the item should be', why: '0x105 is the numeric error code, not an address in memory or flash.' },
    ] },
    { q: 'Monitor output is a stream of unreadable characters from the moment of reset, on an otherwise working board. What do you check first?', kind: 'concept', choices: [
      { t: 'That the monitor baud rate matches the console baud rate', ok: true, why: 'Consistent garbage from the first character is the signature of a bit-time mismatch.' },
      { t: 'That the partition table offset matches the bootloader', why: 'A bad partition table produces readable error text from the bootloader, not unreadable bytes.' },
      { t: 'That every task stack is large enough for logging', why: 'Stack problems appear later, during application execution, and are reported in readable text.' },
    ] },
    { q: 'On an ESP32-C3 the panic output has no `Backtrace:` line. How do you get the call chain?', kind: 'arch', choices: [
      { t: 'Use `idf.py monitor`, which rebuilds it from the stack dump and the ELF', ok: true, why: 'RISC-V targets print registers and stack memory by default; the IDF monitor does the unwinding on the host.' },
      { t: 'It is impossible, because RISC-V chips keep no return addresses on the stack', why: 'The information is in the stack dump. It needs host-side processing, which the IDF tooling provides.' },
      { t: 'Switch the project to the Xtensa toolchain, which emits a backtrace', why: 'The toolchain must match the CPU in the chip. A C3 cannot run Xtensa code.' },
    ] },
  ],
});

// ───────────────────────────────────────────────────────────── Glossary
const glossary = [
  { term: 'ESP-IDF', def: 'Espressif IoT Development Framework: the official SDK for ESP32-family chips, comprising a CMake build system, a FreeRTOS port, drivers and network stacks.' },
  { term: 'idf.py', def: 'The ESP-IDF command-line front end. Wraps CMake, Ninja, esptool and the monitor: `set-target`, `menuconfig`, `build`, `flash`, `monitor`, `size`.' },
  { term: 'sdkconfig', def: 'The generated file holding every Kconfig option for one build. Visible to C code as `CONFIG_...` macros through `sdkconfig.h`.' },
  { term: 'sdkconfig.defaults', def: 'A hand-maintained file of only the options a project deliberately changes. Used to regenerate `sdkconfig`, and the file to keep in version control.' },
  { term: 'menuconfig', def: 'The text-mode configuration editor started by `idf.py menuconfig`. Edits `sdkconfig`.' },
  { term: 'Component', def: 'The unit of code in ESP-IDF: a directory with a `CMakeLists.txt` calling `idf_component_register`. Every driver, the application\'s `main` and third-party libraries are components.' },
  { term: 'Target', def: 'The chip a project is built for (`esp32`, `esp32s3`, `esp32c3` ...), chosen with `idf.py set-target`. Determines the toolchain and default configuration.' },
  { term: 'SoC', def: 'System on chip. Here, the ESP32 silicon itself: CPU cores, RAM, ROM, radio and peripherals in one package, usually without program flash.' },
  { term: 'Module', def: 'A small shielded PCB carrying an ESP32 chip together with SPI flash, crystal and antenna, for example ESP32-WROOM-32E or ESP32-S3-WROOM-1.' },
  { term: 'Dev board', def: 'A development board carrying a module plus USB connection, regulator, buttons and headers. LED pin, USB-UART chip and button wiring are board-specific.' },
  { term: 'Xtensa', def: 'The CPU architecture of the ESP32 (LX6 cores) and the ESP32-S3 (LX7 cores); the ESP32-S2 is also an Xtensa chip.' },
  { term: 'RISC-V', def: 'The open CPU architecture used by the ESP32-C3, C6 and H2.' },
  { term: 'Strapping pin', def: 'A GPIO sampled at reset to select boot behaviour. On the ESP32: GPIO0, 2, 5, 12 and 15. Normal GPIOs afterwards, but external circuits must not disturb them during reset.' },
  { term: 'Download mode', def: 'The ROM serial bootloader state in which esptool can write flash. Entered by holding GPIO0 low at reset.' },
  { term: 'Auto-reset circuit', def: 'Two transistors on a dev board that let the USB-UART chip\'s DTR and RTS lines drive EN and GPIO0, so tools can enter download mode without button presses.' },
  { term: 'EN pin', def: 'The chip-enable (reset) pin. Pulling it low resets the ESP32; the dev board\'s EN or RST button does this.' },
  { term: 'Mask ROM', def: 'Read-only memory in the chip holding the first-stage bootloader and utility functions. It cannot be changed.' },
  { term: 'Second-stage bootloader', def: 'The small program in flash that the ROM loads. It reads the partition table, selects an app, and (when enabled) verifies and decrypts it.' },
  { term: 'Partition table', def: 'A table in flash (default offset `0x8000`) listing named regions with type, subtype, offset and size.' },
  { term: 'Factory app', def: 'The application partition used when there is no OTA data; in the default table, 1 MB at `0x10000`.' },
  { term: 'OTA', def: 'Over-the-air update. Uses two or more app partitions and an `otadata` partition recording which one to boot.' },
  { term: 'esptool', def: 'Espressif\'s tool for talking to the ROM bootloader: writing, reading and erasing flash, reading chip information.' },
  { term: 'ELF file', def: 'The linked executable with symbols and debug information (`build/<project>.elf`). Needed to decode crash addresses; not what is flashed.' },
  { term: 'IRAM', def: 'Instruction RAM: internal RAM holding code that must run when the flash cache is disabled or with minimal latency.' },
  { term: 'IRAM_ATTR', def: 'Function attribute that places the function\'s code in IRAM instead of flash.' },
  { term: 'DRAM', def: 'Data RAM: internal RAM holding globals, the heap and task stacks. `DRAM_ATTR` forces constant data there instead of flash.' },
  { term: 'IROM / DROM', def: 'The address ranges through which code and read-only data stored in flash are seen by the CPU, via the cache.' },
  { term: 'Flash cache', def: 'The mechanism that maps external SPI flash into the address space. Disabled during flash writes and erases, when flash-resident code and data are unreachable.' },
  { term: 'GPIO matrix', def: 'The signal router that connects almost any peripheral signal to almost any pad. Flexible, with a small delay.' },
  { term: 'IO MUX', def: 'The direct pad multiplexer connecting particular peripheral signals to fixed pads with the least delay.' },
  { term: 'Input-only pins', def: 'On the original ESP32, GPIO34–39: no output driver and no internal pull resistors.' },
  { term: 'ADC attenuation', def: 'A programmable divider in front of the ADC that sets its input range. `ADC_ATTEN_DB_12` gives the widest range.' },
  { term: 'ADC calibration', def: 'Conversion of raw ADC codes to millivolts using per-chip reference data from eFuse. Line fitting on ESP32/S2, curve fitting on S3/C3/C6.' },
  { term: 'eFuse', def: 'One-time-programmable bits in the chip holding factory calibration, MAC address, and security configuration and keys.' },
  { term: 'LEDC', def: 'The LED Control peripheral: the ESP32\'s general PWM generator, organised as timers and channels.' },
  { term: 'Duty resolution', def: 'The width in bits of an LEDC timer. Sets the number of duty steps, and trades against the maximum PWM frequency.' },
  { term: 'gptimer', def: 'The ESP-IDF driver for general-purpose hardware timers. Alarm callbacks run in interrupt context.' },
  { term: 'esp_timer', def: 'High-resolution software timers multiplexed onto one hardware timer. Callbacks run in a task by default; `esp_timer_get_time()` gives microseconds since boot.' },
  { term: 'ISR service', def: 'The shared GPIO interrupt dispatcher installed by `gpio_install_isr_service`, which calls per-pin handlers added with `gpio_isr_handler_add`.' },
  { term: 'esp_err_t', def: 'The integer error type returned by most ESP-IDF functions. `ESP_OK` is zero; `esp_err_to_name` gives the text.' },
  { term: 'ESP_ERROR_CHECK', def: 'A macro that logs the error and calls `abort()` if its argument is not `ESP_OK`.' },
  { term: 'app_main', def: 'The application entry point, called from the main task after the scheduler has started. It may return.' },
  { term: 'Main task', def: 'The FreeRTOS task that calls `app_main`. Its stack size is set by `CONFIG_ESP_MAIN_TASK_STACK_SIZE`.' },
  { term: 'Tick', def: 'The periodic scheduler interrupt. 100 Hz (10 ms) by default on ESP-IDF; delays are quantised to it.' },
  { term: 'Core affinity', def: 'Whether a task may run on either core of a dual-core chip or is pinned to one with `xTaskCreatePinnedToCore`.' },
  { term: 'SMP', def: 'Symmetric multiprocessing: one scheduler running tasks on two cores at once, as on the ESP32 and ESP32-S3.' },
  { term: 'Stack high-water mark', def: 'The minimum free stack a task has ever had, from `uxTaskGetStackHighWaterMark`. In bytes on ESP-IDF.' },
  { term: 'Task watchdog (TWDT)', def: 'A watchdog that reports or resets when subscribed tasks, by default the idle tasks, do not check in within the timeout.' },
  { term: 'Interrupt watchdog (IWDT)', def: 'A watchdog that panics when interrupts are blocked, or an ISR runs, for too long.' },
  { term: 'Brownout detector', def: 'A circuit that resets the chip when the supply voltage falls below a threshold, to avoid running with corrupted state.' },
  { term: 'Reset reason', def: 'Why the chip last restarted (power-on, software, panic, watchdog, brownout ...), from the ROM boot line and `esp_reset_reason()`.' },
  { term: 'NVS', def: 'Non-volatile storage: ESP-IDF\'s wear-levelled key-value store in a flash partition, with namespaces and typed values.' },
  { term: 'Namespace (NVS)', def: 'A named group of NVS keys, at most 15 characters, that keeps different components\' keys apart.' },
  { term: 'Wear levelling', def: 'Spreading erase cycles across flash sectors so that no single sector wears out early.' },
  { term: 'esp_netif', def: 'The network interface abstraction between drivers (Wi-Fi, Ethernet) and the TCP/IP stack.' },
  { term: 'Event loop', def: 'The `esp_event` task that delivers system events such as Wi-Fi and IP changes to registered handlers, one at a time.' },
  { term: 'Station mode (STA)', def: 'Wi-Fi mode in which the ESP32 joins an existing access point as a client.' },
  { term: 'Provisioning', def: 'Delivering Wi-Fi credentials to a device at set-up time, over BLE or a temporary access point, instead of compiling them in. Espressif\'s implementation is the `network_provisioning` component (formerly `wifi_provisioning`, removed from the ESP-IDF tree in v6.0).' },
  { term: 'GATT', def: 'Generic Attribute Profile: the BLE data model of services containing characteristics, each a value with properties such as read, write and notify.' },
  { term: 'NimBLE', def: 'The smaller of the two BLE host stacks available in ESP-IDF; BLE only.' },
  { term: 'Coexistence', def: 'Time-sharing of the single 2.4 GHz radio between Wi-Fi, Bluetooth and, on some chips, 802.15.4.' },
  { term: 'USB Serial/JTAG', def: 'A fixed-function USB block on chips such as the S3, C3 and C6 providing a serial console, flashing and JTAG over one cable.' },
  { term: 'Guru Meditation Error', def: 'The heading of an ESP-IDF panic report for an unhandled CPU exception. Followed by the cause, register dump and backtrace.' },
  { term: 'Backtrace', def: 'The chain of return addresses at the time of a crash, printed as `PC:SP` pairs on Xtensa and decoded with the ELF file.' },
  { term: 'EXCVADDR', def: 'The Xtensa register holding the data address whose access caused an exception. Near zero indicates a NULL pointer.' },
  { term: 'addr2line', def: 'A toolchain utility that converts code addresses to function, file and line using an ELF file.' },
  { term: 'Core dump', def: 'A saved snapshot of all tasks\' state at a panic, stored in flash or sent over UART for later analysis with `idf.py coredump-info`.' },
  { term: 'PSRAM', def: 'External pseudo-static RAM on some modules, adding megabytes of slower RAM and occupying extra pins (GPIO16/17 on ESP32 modules that have it).' },
];

// ───────────────────────────────────────────────────────────── Troubleshooting
const troubleshooting = [
  { symptom: 'esptool: "Failed to connect ... No serial data received"', area: 'Flashing',
    causes: 'The chip did not enter download mode: the auto-reset circuit failed or is absent, GPIO0 is held high by external circuitry, the wrong serial port was chosen, or the USB cable is charge-only.',
    fix: 'Hold BOOT, tap EN, release BOOT, then retry. Confirm the port appears and disappears with the cable (`ls /dev/tty*`). Try a known data cable. Disconnect anything wired to GPIO0, GPIO2, EN and the UART0 pins.' },
  { symptom: 'Serial port does not appear, or "Permission denied" opening it on Linux', area: 'Flashing',
    causes: 'Missing driver for the board\'s USB-UART chip, a charge-only cable, or the user is not in the group that owns serial devices.',
    fix: 'Check `dmesg` after plugging in to see whether a device enumerates and which driver binds. Add your user to the group that owns the device node (often `dialout`) and log in again.' },
  { symptom: 'Flashing reports success but the board prints nothing or loops with ROM errors', area: 'Flashing',
    causes: 'The project is built for a different target (for example ESP32 images on an S3: different CPU and bootloader offset), or the flash size, mode or frequency setting does not match the module.',
    fix: 'Run `idf.py set-target` for the actual chip and rebuild. Check the flash settings under "Serial flasher config" in menuconfig against the module datasheet. `esptool flash-id` reports the detected flash.' },
  { symptom: 'Board sits at "waiting for download" after every reset', area: 'Boot',
    causes: 'GPIO0 is low at reset: a stuck BOOT button, or an external circuit pulling the pin down.',
    fix: 'Measure GPIO0 during reset; it must be high for normal boot. Move whatever is connected to it to a non-strapping pin.' },
  { symptom: 'ESP32 fails to boot (flash read errors) only when a part is connected to GPIO12', area: 'Boot',
    causes: 'GPIO12 (MTDI) is a strapping pin selecting the flash supply voltage. Held high at reset on a module with 3.3 V flash, it selects 1.8 V and the flash cannot be read.',
    fix: 'Do not pull GPIO12 high at reset. Use another pin, or make sure the external circuit leaves it low until after boot.' },
  { symptom: 'Continuous reset loop: the same boot messages repeat every second or so', area: 'Boot',
    causes: 'The application crashes or aborts early in every boot: a failed `ESP_ERROR_CHECK` during initialisation, a stack overflow in `app_main`, use of a flash pin, or a brownout as soon as the radio starts.',
    fix: 'Read the lines just before each restart: they name the cause (`abort()`, Guru Meditation, brownout). Check the `rst:` reason in the ROM line. Fix that cause; do not disable the detector that reported it.' },
  { symptom: '"Brownout detector was triggered" and a reset, often when Wi-Fi starts or a motor switches', area: 'Power',
    causes: 'The 3.3 V rail dips under load: weak USB port, long or thin cable, undersized regulator, too little bulk capacitance, or a load powered from the board\'s 3.3 V pin.',
    fix: 'Power from a supply that can deliver the peak current, shorten the cable, add bulk capacitance near the module, and power motors, servos and LED strips from their own supply with a common ground.' },
  { symptom: 'Guru Meditation: LoadProhibited or StoreProhibited with EXCVADDR near zero', area: 'Crash',
    causes: 'A NULL pointer dereference: an unchecked allocation or handle creation, or a handle used before it was initialised.',
    fix: 'Decode the backtrace (monitor or `addr2line` with the matching ELF) to find the line, then trace where the pointer should have been set. Check return values of create and open functions and the initialisation order.' },
  { symptom: 'Guru Meditation: InstrFetchProhibited or IllegalInstruction with a strange PC', area: 'Crash',
    causes: 'A call through a NULL or corrupted function pointer, or a return address overwritten by a buffer overflow on the stack.',
    fix: 'Use the second backtrace entry to find the caller. Check function-pointer tables and callbacks for unset entries, and look for writes past the end of local arrays in the functions involved.' },
  { symptom: '"A stack overflow in task X has been detected"', area: 'Crash',
    causes: 'The task\'s stack is too small for its call depth and locals: large local arrays, `printf`-family formatting, TLS, or deep recursion.',
    fix: 'Increase the stack size given to `xTaskCreate` (bytes on ESP-IDF), move large buffers to static or heap storage, and measure the margin with `uxTaskGetStackHighWaterMark`. For `app_main`, raise the main task stack size in menuconfig.' },
  { symptom: '"Task watchdog got triggered" naming IDLE0 or IDLE1', area: 'Watchdog',
    causes: 'A task is running without ever blocking, starving the idle task on that core: a busy-wait loop, a polling loop with no delay, or a delay shorter than one tick that rounds to zero.',
    fix: 'Look at "Tasks currently running" in the report for the culprit. Make it block (`vTaskDelay` of at least one tick, or wait on a queue or semaphore). Do not silence the report by feeding the watchdog from the loop.' },
  { symptom: 'Guru Meditation: "Interrupt wdt timeout on CPU0/1"', area: 'Watchdog',
    causes: 'Interrupts were disabled or an ISR ran for too long: a long critical section, blocking or heavy work inside an ISR, or logging from an ISR.',
    fix: 'Shorten critical sections to a few instructions. Move ISR work to a task via a queue or notification. Remove `printf`/`ESP_LOGx` from interrupt handlers.' },
  { symptom: 'Rare panic: "Cache disabled but cached memory region accessed"', area: 'Crash',
    causes: 'An interrupt handler registered as IRAM-safe (or a callback with a cache-safe option enabled) reached code or constant data stored in flash while a flash write or erase was in progress.',
    fix: 'Mark the handler and everything it calls `IRAM_ATTR`, and constants it reads `DRAM_ATTR`; or keep the handler trivial; or register it without the IRAM flag and accept delay during flash operations.' },
  { symptom: 'I2C probe returns ESP_ERR_NOT_FOUND, or transfers return ESP_ERR_INVALID_RESPONSE (NACK)', area: 'I2C',
    causes: 'No device acknowledged the address: wrong address (often an 8-bit address used where 7-bit is expected, or address-select pins strapped differently), SDA and SCL swapped, device unpowered, or no common ground.',
    fix: 'Measure the device\'s supply. Scan all addresses with `i2c_master_probe` to see what answers. Convert 8-bit addresses by shifting right one bit. Check the address-select pins against the datasheet.' },
  { symptom: 'I2C transfers fail with ESP_ERR_TIMEOUT, or the bus scan is very slow', area: 'I2C',
    causes: 'A line is stuck low or cannot rise: missing pull-ups, a short, a device holding SDA low after an interrupted transfer, or pull-ups too weak for the bus capacitance and speed.',
    fix: 'With the bus idle, both lines should measure near 3.3 V. Fit external pull-ups (a few kilohms). Power-cycle the device to release a stuck SDA. Lower `scl_speed_hz` or shorten the wiring.' },
  { symptom: 'SPI device returns only 0x00 or 0xFF', area: 'SPI',
    causes: 'The device is not driving MISO: CS is not reaching it or is the wrong pin, MISO is unconnected or swapped with MOSI, the device is unpowered or held in reset.',
    fix: 'Check each of the four signals at the device\'s pins. Confirm `spics_io_num` and that CS goes low during a transaction with a logic analyser or by slowing the clock and probing.' },
  { symptom: 'SPI data is wrong but consistent, often shifted by one bit', area: 'SPI',
    causes: 'Clock mode (CPOL/CPHA) does not match the device, `length` was given in bytes instead of bits, or the clock is too fast for the wiring or the GPIO-matrix routing.',
    fix: 'Take the mode from the device datasheet\'s timing diagram. Set `length` to 8 × bytes. Reduce `clock_speed_hz` to 1 MHz while debugging.' },
  { symptom: 'GPIO input reads random values', area: 'GPIO',
    causes: 'The input is floating: no pull resistor enabled, or the pin is one of GPIO34–39 on the ESP32, which have no internal pulls.',
    fix: 'Enable the internal pull-up or pull-down, or add an external resistor. On GPIO34–39 an external resistor is the only option.' },
  { symptom: 'Board crashes or resets as soon as a GPIO in the range 6–11 is configured (ESP32)', area: 'GPIO',
    causes: 'Those pads are connected to the module\'s SPI flash; reconfiguring them cuts the chip off from its own program.',
    fix: 'Choose different pins. On PSRAM modules also avoid GPIO16 and 17. For other chips consult the module datasheet for the flash and PSRAM pins.' },
  { symptom: 'ADC readings stop working or return errors once Wi-Fi is started', area: 'ADC',
    causes: 'The channel is on ADC2, which Wi-Fi uses on the ESP32 (and S2/S3).',
    fix: 'Move the signal to an ADC1 pin (GPIO32–39 on the ESP32) and check the return value of `adc_oneshot_read`.' },
  { symptom: 'ADC voltage is off by several percent, or differs between boards', area: 'ADC',
    causes: 'Raw codes converted with an assumed 3.3 V reference; no calibration; signal near the ends of the range; high source impedance.',
    fix: 'Use the calibration driver (`adc_cali_raw_to_voltage`). Keep the signal mid-range for the chosen attenuation. Add about 100 nF at the pin for high-impedance sources and average several readings.' },
  { symptom: 'LEDC: error that the requested frequency and duty resolution cannot be achieved', area: 'PWM',
    causes: 'Frequency × 2^resolution exceeds what the timer\'s clock source can provide.',
    fix: 'Reduce `duty_resolution` or `freq_hz`. Compute the available counts per period as source clock ÷ frequency and choose the largest power of two below it.' },
  { symptom: 'Wi-Fi never connects: repeated disconnect events', area: 'Wi-Fi',
    causes: 'Wrong SSID or password, the access point is 5 GHz only (the ESP32 family discussed here is 2.4 GHz for Wi-Fi), an unsupported security mode, weak signal, or the access point rejecting new clients.',
    fix: 'Log the `reason` field of the disconnect event and look it up in the Wi-Fi guide. Confirm a 2.4 GHz network. Test near the access point, and with a phone hotspot to rule out the router.' },
  { symptom: 'Wi-Fi connects but network requests fail immediately', area: 'Wi-Fi',
    causes: 'The request was made before an IP address was assigned, or DNS is unavailable on that network.',
    fix: 'Start network work only after `IP_EVENT_STA_GOT_IP`. Log the assigned address and gateway. Check the return codes of the client library.' },
  { symptom: 'Build fails: app partition is too small for the binary', area: 'Build',
    causes: 'The application image exceeds the size of the app partition in the partition table (1 MB by default).',
    fix: 'Inspect `idf.py size-components`, lower the log level, enable size optimisation, remove unused components; or choose a larger-app partition table or a custom `partitions.csv` that fits the flash chip.' },
  { symptom: 'Build fails with "header not found" in your own component', area: 'Build',
    causes: 'The component does not declare the component that provides that header.',
    fix: 'Add the providing component to `REQUIRES` or `PRIV_REQUIRES` in the component\'s `idf_component_register` call.' },
  { symptom: 'Code from a tutorial does not compile: unknown header or function', area: 'Build',
    causes: 'The tutorial targets an older ESP-IDF (legacy ADC, timer or I2C drivers, `tcpip_adapter`, old event loop) or Arduino APIs.',
    fix: 'Check which IDF version the tutorial used. Port to the current driver using the migration guides in the ESP-IDF documentation, or find the equivalent example in the `examples/` directory of your installed version.' },
  { symptom: 'Settings from an earlier firmware reappear after reflashing', area: 'Storage',
    causes: '`idf.py flash` does not erase the NVS partition, so stored keys persist across firmware versions.',
    fix: 'Run `idf.py erase-flash` and flash again during development. In products, keep a schema version in NVS and migrate or reset on mismatch.' },
  { symptom: 'Monitor shows garbage characters', area: 'Debugging',
    causes: 'Baud rate mismatch between the monitor and the console, or another device driving the UART0 lines.',
    fix: 'Match the monitor baud to the console setting in menuconfig. Disconnect anything on the UART0 pins. Note that the ROM\'s own first lines may use a different rate from the application on some boards.' },
  { symptom: 'ESP_LOGD / ESP_LOGV output never appears', area: 'Debugging',
    causes: 'Those levels are above the compile-time maximum log level, so the calls were removed from the binary; or the run-time level for that tag is lower.',
    fix: 'Raise the maximum (and default) log level in menuconfig and rebuild, or call `esp_log_level_set` for the tag if the level is compiled in.' },
];

// ───────────────────────────────────────────────────────────── References
// docs.espressif.com and www.espressif.com URLs follow Espressif's standard documentation layout but could not be
// load-tested from the authoring environment (see docs/FACTS.md, UNVERIFIED item 9); github.com URLs were reachable.
const refs = [
  { org: 'Espressif', title: 'ESP-IDF Programming Guide (stable, ESP32)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/', note: 'Switch the chip selector at the top left for S3, C3 or C6' },
  { org: 'Espressif', title: 'ESP-IDF source and examples', url: 'https://github.com/espressif/esp-idf', note: 'The examples/ directory matches the API of each release tag' },
  { org: 'Espressif', title: 'ESP-IDF Get Started', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html' },
  { org: 'Espressif', title: 'ESP-IDF Build System', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/build-system.html' },
  { org: 'Espressif', title: 'ESP-IDF Migration Guides', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/migration-guides/index.html', note: 'What changed between major versions, per driver' },
  { org: 'Espressif', title: 'Partition Tables', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/partition-tables.html' },
  { org: 'Espressif', title: 'Application Startup Flow', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/startup.html' },
  { org: 'Espressif', title: 'GPIO & RTC GPIO', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html' },
  { org: 'Espressif', title: 'ADC Oneshot Mode Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/adc_oneshot.html' },
  { org: 'Espressif', title: 'ADC Calibration Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/adc_calibration.html' },
  { org: 'Espressif', title: 'LED Control (LEDC)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/ledc.html' },
  { org: 'Espressif', title: 'General Purpose Timer (GPTimer)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gptimer.html' },
  { org: 'Espressif', title: 'ESP Timer (High Resolution Timer)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/esp_timer.html' },
  { org: 'Espressif', title: 'Universal Asynchronous Receiver/Transmitter (UART)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/uart.html' },
  { org: 'Espressif', title: 'Inter-Integrated Circuit (I2C)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/i2c.html' },
  { org: 'Espressif', title: 'SPI Master Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/spi_master.html' },
  { org: 'Espressif', title: 'Interrupt Allocation', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/intr_alloc.html' },
  { org: 'Espressif', title: 'FreeRTOS (IDF)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/freertos_idf.html' },
  { org: 'Espressif', title: 'Watchdogs', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/wdts.html' },
  { org: 'Espressif', title: 'Non-Volatile Storage Library', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_flash.html' },
  { org: 'Espressif', title: 'Wi-Fi Driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/wifi.html' },
  { org: 'Espressif', title: 'Bluetooth API', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/index.html' },
  { org: 'Espressif', title: 'Error Handling', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/error-handling.html' },
  { org: 'Espressif', title: 'Logging library', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/log.html' },
  { org: 'Espressif', title: 'Fatal Errors', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/fatal-errors.html' },
  { org: 'Espressif', title: 'IDF Monitor', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-monitor.html' },
  { org: 'Espressif', title: 'Core Dump', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html' },
  { org: 'Espressif', title: 'esptool documentation', url: 'https://docs.espressif.com/projects/esptool/en/latest/esp32/' },
  { org: 'Espressif', title: 'esptool source', url: 'https://github.com/espressif/esptool' },
  { org: 'Espressif', title: 'ESP32 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf', note: 'Pin definitions, strapping pins, electrical and ADC characteristics' },
  { org: 'Espressif', title: 'ESP32 Technical Reference Manual', url: 'https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf', note: 'Register-level description of every peripheral' },
  { org: 'Espressif', title: 'ESP32-S3 Series Datasheet', url: 'https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf' },
  { org: 'Espressif', title: 'ESP32-S3 Technical Reference Manual', url: 'https://www.espressif.com/sites/default/files/documentation/esp32-s3_technical_reference_manual_en.pdf' },
  { org: 'Espressif', title: 'ESP Hardware Design Guidelines', url: 'https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/index.html', note: 'Power supply, strapping pins, flash, RF layout' },
  { org: 'Espressif', title: 'Arduino core for ESP32', url: 'https://github.com/espressif/arduino-esp32' },
  { org: 'NXP', title: 'UM10204: I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf' },
  { org: 'FreeRTOS', title: 'FreeRTOS Kernel source', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel' },
];

export default { skills, lessons, labs: [], glossary, troubleshooting, refs };
