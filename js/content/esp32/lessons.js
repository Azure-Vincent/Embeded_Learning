// ESP32 section, part 1: lessons, shared skills, glossary, troubleshooting, references.
// All ESP-IDF code here is status `reviewed`: written against the ESP-IDF v6.1 documentation,
// not compiled or run on a board in this repository.
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
| ESP32 | Xtensa | 2 | 240 MHz | Wi-Fi + Bluetooth | none (external USB-UART chip) |
| ESP32-S3 | Xtensa | 2 | 240 MHz | Wi-Fi + Bluetooth LE | USB OTG and USB Serial/JTAG |
| ESP32-C3 | RISC-V | 1 | 160 MHz | Wi-Fi + Bluetooth LE | USB Serial/JTAG |
| ESP32-C6 | RISC-V | 1 | 160 MHz | Wi-Fi + Bluetooth LE + IEEE 802.15.4 | USB Serial/JTAG |

Two more you will meet: the ESP32-S2 (single-core Xtensa, Wi-Fi only, USB OTG) and the ESP32-H2 (RISC-V, Bluetooth LE and 802.15.4, no Wi-Fi). Confirm details for those in their datasheets before designing with them.

What this means in practice:

- **Xtensa vs RISC-V** changes the toolchain, the register names in a crash dump and the interrupt architecture. Your C source for the ESP-IDF drivers is the same.
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
      { t: 'A USB connector and voltage regulator', why: 'Those belong to the development board that carries the module. The module itself runs from 3.3 V and has no USB connector.' },
      { t: 'A second CPU core', why: 'The number of cores is a property of the silicon. A module cannot change it.' },
    ] },
    { q: 'A relay driver circuit pulls GPIO0 low through a transistor base whenever the board is unpowered or in reset. What symptom do you expect on a classic ESP32?', kind: 'circuit', choices: [
      { t: 'The chip waits in download mode after every reset instead of running the application', ok: true, why: 'GPIO0 is sampled at reset. Low selects the serial bootloader, so the application never starts until GPIO0 is high at reset.' },
      { t: 'The flash is powered at the wrong voltage', why: 'Flash voltage is selected by a different strapping pin (GPIO12). GPIO0 chooses between normal boot and download mode.' },
      { t: 'Nothing: strapping pins only matter while flashing', why: 'Strapping pins are sampled at every reset, whether or not a flashing tool is attached.' },
    ] },
    { q: 'You port a project from an ESP32 to an ESP32-C3. Which statement is correct?', kind: 'arch', choices: [
      { t: 'Driver-level C code is largely unchanged, but there is one core, a different CPU architecture and a different pin list', ok: true, why: 'ESP-IDF drivers present the same API across chips. Core count, the RISC-V toolchain and pin restrictions all change.' },
      { t: 'The same binary runs, because both are called ESP32', why: 'Xtensa and RISC-V have different instruction sets. You must set the target and rebuild; a binary for one will not execute on the other.' },
      { t: 'Tasks pinned to core 1 keep working', why: 'The C3 has a single core, so there is no core 1 to pin a task to.' },
    ] },
    { q: 'A crash dump shows `PC: 0x400d1a44`. Using the ESP32 memory map, where was the CPU executing?', kind: 'arch', choices: [
      { t: 'Application code in flash (IROM), fetched through the cache', ok: true, why: 'IROM spans 0x400D0000–0x40400000. That is where normal application functions execute from.' },
      { t: 'The mask ROM bootloader', why: 'Mask ROM is 0x40000000–0x40070000. This address is above that range.' },
      { t: 'Code placed in internal RAM (IRAM)', why: 'IRAM is 0x40080000–0x400AA000. The address in the dump is higher than that range.' },
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

    { t: 'code', lang: 'cmake', status: 'reviewed', caption: 'CMakeLists.txt (project root)', code: R`cmake_minimum_required(VERSION 3.22)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(blink)`, explain: [
      { lines: '1', md: 'Minimum CMake version. The number has risen across IDF releases; copy this line from an example shipped with the IDF version you installed.' },
      { lines: '2', md: 'Pulls in the whole ESP-IDF build system. `IDF_PATH` is set by the environment script.' },
      { lines: '3', md: 'Names the project. The application image will be `build/blink.bin` and the debug file `build/blink.elf`.' },
    ] },

    { t: 'code', lang: 'cmake', status: 'reviewed', caption: 'main/CMakeLists.txt', code: R`idf_component_register(SRCS "main.c"
                       INCLUDE_DIRS ".")`, explain: [
      { lines: '1-2', md: 'Registers the component. `main` is special: it is allowed to use every other component without listing them. Any other component must name what it uses with `REQUIRES` or `PRIV_REQUIRES` (for example `esp_driver_gpio`). A "header not found" build error in your own component almost always means a missing entry there.' },
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

    { t: 'code', lang: 'csv', status: 'reviewed', caption: 'Default partition table', code: R`# Name,   Type, SubType, Offset,  Size
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
      reveal: `The partition, not the chip, is the limit. Your options are to shrink the image (\`idf.py size\` and \`idf.py size-components\` show where the bytes are; lowering the log level and compiling for size are the usual first steps) or to give the app more room with a larger partition, via menuconfig's partition table options or a custom \`partitions.csv\`, provided the flash chip is big enough.` },

    { t: 'exercise', prompt: `With the default partition table, at which flash offset does the \`factory\` partition end (the first byte after it)? Give a hexadecimal address.`,
      hints: [
        `The partition starts at \`0x10000\` and its size is 1M.`,
        `In a partition table, 1M means 1024 × 1024 bytes = \`0x100000\`.`,
      ],
      solution: `\`0x10000 + 0x100000 = 0x110000\`. On a 4 MB (\`0x400000\`) flash chip, everything from \`0x110000\` upwards is unused by the default table, which is why a larger app partition or an extra data partition is usually possible.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?0*110000h?\\s*$'], nudge: 'Add the size (1M = 0x100000) to the start offset 0x10000.' } },

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
      { t: 'Each chip\'s mask ROM is hard-wired to load the bootloader from that offset', ok: true, why: 'The first-stage bootloader is in ROM and cannot be changed; the offset it reads from is a fixed property of each chip.' },
      { t: 'It is a menuconfig option with different defaults', why: 'The partition table offset is configurable, but the bootloader offset is not: the code that reads it is in ROM, before any configuration exists.' },
      { t: 'RISC-V chips need the reset vector at address zero', why: 'The offset is a position in external flash, not a CPU address. The CPU starts executing in mask ROM on both chips.' },
    ] },
    { q: 'You changed the log level in menuconfig and rebuilt. Which file recorded your change?', kind: 'concept', choices: [
      { t: '`sdkconfig`', ok: true, why: 'menuconfig writes the full configuration to sdkconfig, and the build generates sdkconfig.h from it.' },
      { t: '`CMakeLists.txt`', why: 'CMakeLists files describe sources and dependencies. Kconfig options are stored separately so they can be changed without editing build scripts.' },
      { t: '`partitions.csv`', why: 'That file only describes the flash layout. It has nothing to do with compile-time options such as log level.' },
    ] },
    { q: 'esptool reports "Failed to connect: No serial data received". What is the most direct manual remedy on a typical dev board?', kind: 'circuit', choices: [
      { t: 'Hold BOOT, tap EN, release BOOT, then retry', ok: true, why: 'That sequence holds GPIO0 low through reset, which puts the ROM in download mode even if the auto-reset circuit did not manage it.' },
      { t: 'Run `idf.py fullclean`', why: 'That deletes build output on the PC. The error is about the chip not answering on the serial port, which no rebuild can affect.' },
      { t: 'Lower the application log level', why: 'The application is not running when esptool connects. The chip must be in the ROM serial bootloader, which depends on GPIO0 at reset.' },
    ] },
    { q: 'A component you wrote in `components/sensor/` includes `driver/gpio.h` and the build says the header cannot be found, though `main` includes it without trouble. Why?', kind: 'code', choices: [
      { t: 'The component must declare the GPIO driver component in `REQUIRES` or `PRIV_REQUIRES`', ok: true, why: 'Only `main` gets every component implicitly. Other components see only the include paths of components they declare.' },
      { t: 'Headers can only be included from `main`', why: 'Any component can use any driver. What is missing is the declared dependency that puts the driver\'s include directory on this component\'s path.' },
      { t: 'The GPIO driver was removed from ESP-IDF', why: 'The driver exists and `main` is using it in the same build. The difference between the two components is their declared dependencies.' },
    ] },
    { q: '`idf.py size` shows the app is 40 kB over its partition. Which action attacks the cause rather than moving the limit?', kind: 'concept', choices: [
      { t: 'Run `idf.py size-components` to find the largest contributors and remove or shrink them', ok: true, why: 'Per-component size shows where the bytes are (often logging strings, unused protocol stacks or tables), which is where reductions come from.' },
      { t: 'Buy a module with more flash', why: 'More flash only helps after the partition table is also changed, and it leaves the image as large as before.' },
      { t: 'Erase the flash before flashing', why: 'Erasing does not change the size of the image or the partition; the size check happens at build time on the PC.' },
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

    { t: 'code', lang: 'c', status: 'reviewed', caption: 'ESP-IDF', code: R`#include "freertos/FreeRTOS.h"
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
      { lines: '9', md: '`gpio_reset_pin` returns the pad to plain GPIO function. Some pads power up routed to another peripheral (JTAG, for instance), and this undoes that.' },
      { lines: '10', md: 'Enables the output driver for this pad. Underneath, one bit is set in the GPIO output-enable register.' },
      { lines: '13,15', md: 'Writes one bit to the "set" or "clear" output register. The pin changes within a few CPU cycles.' },
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

    { t: 'code', lang: 'c', status: 'reviewed', caption: 'Three ways to treat an error', code: R`#include "esp_err.h"
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
      { t: 'Blocking the calling FreeRTOS task for about a second while other tasks may run', ok: true, why: 'The Arduino core implements delay with vTaskDelay, so the loop task sleeps and the scheduler runs whatever else is ready.' },
      { t: 'Spinning in a counting loop with interrupts disabled', why: 'That is how delay works on some small 8-bit boards. On the ESP32 the core sits on FreeRTOS, and a busy loop of that length would trip a watchdog.' },
      { t: 'Putting the whole chip into deep sleep', why: 'Deep sleep powers down the CPU and loses RAM contents; it must be requested explicitly and the program restarts afterwards.' },
    ] },
    { q: 'A `.cpp` file defines `void app_main() { ... }` and the link fails with "undefined reference to app_main". Why?', kind: 'code', choices: [
      { t: 'The C++ compiler mangled the name, so the C startup code cannot find it; it needs `extern "C"`', ok: true, why: 'Startup code calls the unmangled C symbol app_main. Declaring the function extern "C" makes the C++ compiler emit that exact symbol.' },
      { t: 'C++ projects must use `main()` instead', why: 'The entry point ESP-IDF calls is always app_main, in either language. The problem is the symbol name the compiler produced for it.' },
      { t: 'ESP-IDF does not support C++ source files', why: 'C++ is supported and widely used. The file compiled; it is the link step that failed to match a symbol.' },
    ] },
    { q: 'You add `ESP_LOGD(TAG, "raw=%d", raw);` and nothing is printed, although `ESP_LOGI` lines from the same file appear. Most likely cause?', kind: 'code', choices: [
      { t: 'Debug level is above the compile-time maximum log level, so the call was compiled out', ok: true, why: 'The default maximum level is Info. More verbose calls are removed at compile time unless the maximum is raised in menuconfig.' },
      { t: 'The tag string is too long', why: 'Tags are ordinary strings with no practical length limit of that kind, and the Info lines use the same tag successfully.' },
      { t: '`%d` is not supported by the logging library', why: 'ESP_LOGx uses the normal printf formatting from the C library, and %d is supported.' },
    ] },
    { q: 'A field device calls `ESP_ERROR_CHECK(i2c_master_transmit(...))` for every sensor read. A connector works loose once a day. What does the user observe?', kind: 'arch', choices: [
      { t: 'The device reboots each time a read fails', ok: true, why: 'ESP_ERROR_CHECK calls abort() on any non-OK result, and abort resets the chip.' },
      { t: 'The read silently returns zero', why: 'Silent failure is what happens when the return value is ignored. This macro does the opposite: it treats any error as fatal.' },
      { t: 'The driver retries until the sensor answers', why: 'No retry is built into the macro or implied by it. Retrying is something your code must do explicitly.' },
    ] },
    { q: 'Which is a genuine reason to choose ESP-IDF over the Arduino framework for a product?', kind: 'concept', choices: [
      { t: 'You need control of sdkconfig, the partition table and security features such as secure boot', ok: true, why: 'Those are configured through the IDF build and menuconfig, which the plain Arduino flow fixes in advance.' },
      { t: 'ESP-IDF programs run on a faster CPU', why: 'Both frameworks run on the same chip at the same clock; Arduino is a layer on top of the same SDK.' },
      { t: 'Arduino cannot use Wi-Fi', why: 'The Arduino core exposes Wi-Fi through its own library, implemented with the same esp_wifi driver.' },
    ] },
  ],
});

// @@NEXT@@

export default { skills, lessons, labs: [], glossary: [], troubleshooting: [], refs: [] };
