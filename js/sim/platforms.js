// Platform facts shared by the architecture widgets and the platform comparison lab.
//
// Rule: every chip-specific value here comes from docs/FACTS.md and carries the `src` URL given there.
// A fact whose value FACTS.md could not confirm has `v: null`; show() then prints UNVERIFIED instead of a number.
// The `generic` platform is not a real chip: it is an illustrative Cortex-M-style layout (the region boundaries are the
// Arm architecture's standard address map; the peripheral addresses inside it are invented for teaching).

export const UNVERIFIED = 'not verified here — see datasheet';

const S = {
  cmsis: 'https://github.com/ARM-software/CMSIS_6',
  riscv: 'https://github.com/riscv/riscv-isa-manual',
  freertos: 'https://github.com/FreeRTOS/FreeRTOS-Kernel',
  openocd: 'https://github.com/openocd-org/openocd',
  // ESP32
  espKconfig: 'https://github.com/espressif/esp-idf/blob/v6.1/Kconfig',
  espCaps: 'https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32/include/soc/Kconfig.soc_caps.in',
  espCpu: 'https://github.com/espressif/esp-idf/blob/v6.1/components/esp_system/port/soc/esp32/Kconfig.cpu',
  espSoc: 'https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32/include/soc/soc.h',
  espRom: 'https://github.com/espressif/esp-idf/blob/v6.1/components/esp_rom/esp32/Kconfig.soc_caps.in',
  espPart: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/partition-tables.rst',
  espGpio: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/gpio/esp32.inc',
  espAdc: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/adc/adc_oneshot.rst',
  espSb1: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v1.rst',
  espSb2: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v2.rst',
  espFe: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/flash-encryption.rst',
  espVuln: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/vulnerabilities.rst',
  espUsb: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/usb-serial-jtag-console.rst',
  espInstall: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/linux-setup.rst',
  espRel: 'https://github.com/espressif/esp-idf/releases/latest',
  espIdf: 'https://github.com/espressif/esp-idf',
  // MAX78000
  maxH: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/max78000.h',
  maxSys: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/system_max78000.h',
  maxLd: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Source/GCC/max78000.ld',
  maxUg: 'https://github.com/analogdevicesinc/msdk/blob/main/USERGUIDE.md',
  maxReadme: 'https://github.com/analogdevicesinc/msdk/blob/main/README.md',
  maxFthr: 'https://github.com/analogdevicesinc/MaximAI_Documentation/blob/main/MAX78000_Feather/README.md',
  maxBoard: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Include/board.h',
  ectf24Ld: 'https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/application_processor/firmware.ld',
  ectf24: 'https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/README.md',
  ectf25: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/README.md',
  ectf25Docker: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/Dockerfile',
  // MSPM0L2228
  mspH: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/mspm0l222x.h',
  mspCmd: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/linker_files/ticlang/mspm0l2228.cmd',
  mspOcd: 'https://github.com/openocd-org/openocd/blob/master/src/flash/nor/mspm0.c',
  mspOcdBoard: 'https://github.com/openocd-org/openocd/blob/master/tcl/board/ti/mspm0-launchpad.cfg',
  mspEx: 'https://github.com/TexasInstruments/mspm0-sdk/tree/main/examples/nortos/LP_MSPM0L2228/driverlib',
  mspBcr: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h',
  mspCsc: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/docs/english/middleware/boot_manager/doc_guide/_sources/doc_guide-srcs/customer_secure_users_guide.rst.txt',
  mspTools: 'https://github.com/TexasInstruments/mspm0-sdk/tree/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs',
  mspDbg: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs/debug_program.rst.txt',
  ectf26Ld: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/firmware.ld',
  ectf26Mk: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/Makefile',
  ectf26Docker: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/Dockerfile',
  ectf26Cfg: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/ti_msp_dl_config.h',
  // Round 2 (primary sources, see docs/FACTS.md "Round 2 verification")
  tiDs: 'https://www.ti.com/lit/ds/symlink/mspm0l2228.pdf',
  tiTrm: 'https://www.ti.com/lit/pdf/slau847',
  tiLp: 'https://www.ti.com/tool/LP-MSPM0L2228',
  ectf26Board: 'https://rules.ectf.mitre.org/2026/getting_started/mspm0l2228.html',
  ectf26Bl: 'https://rules.ectf.mitre.org/2026/system/bootloader.html',
  ectf25Bl: 'https://rules.ectf.mitre.org/2025/system/bootloader.html',
  ectf25Sbl: 'https://rules.ectf.mitre.org/2025/system/remove_SBL.html',
  espDs: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf',
  maxAes: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/PeriphDrivers/Include/MAX78000/aes.h',
  maxAdc: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/PeriphDrivers/Include/MAX78000/adc.h',
};
export const SOURCES = S;

/** A fact: text `v` (null when FACTS.md could not confirm it) plus the URL it came from. */
const f = (v, src, extra) => ({ v, src, ...extra });
const unv = (what, src) => ({ v: null, what, src });
/** Text for a fact; unverified facts never print a value. */
export function show(fact) {
  if (!fact) return UNVERIFIED;
  if (fact.v == null) return (fact.what ? fact.what + ': ' : '') + UNVERIFIED;
  return fact.v;
}

const KB = 1024, MB = 1024 * 1024;
const hx = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
export function fmtSize(n) {
  if (n >= MB && n % MB === 0) return n / MB + ' MB';
  if (n >= KB && n % KB === 0) return n / KB + ' KB';
  if (n >= MB) return (n / MB).toFixed(1) + ' MB';
  if (n >= KB) return (n / KB).toFixed(1) + ' KB';
  return n + ' bytes';
}
export const rangeText = (r) => `${hx(r.base)}–${hx(r.base + r.size - 1)}`;

// Region `holds` roles are used by the memory-map quiz:
// vector, code, rodata, data (initialised globals), bss, heap, stack, periph, system, rom, config
const reg = (id, name, base, size, kind, holds, what, src, extra) => ({ id, name, base, size, kind, holds, what, src, ...extra });

const generic = {
  id: 'generic', name: 'Generic Cortex-M-style MCU', short: 'Generic', illustrative: true,
  summary: 'Not a real chip. The four region boundaries are the Arm Cortex-M architecture\'s standard address map; the sizes and the peripheral addresses inside the peripheral region are invented for teaching.',
  cores: [f('One 32-bit Arm Cortex-M-style core (illustrative)', S.cmsis)],
  isa: [f('Thumb instruction set: 16-bit instructions, plus 32-bit ones on larger cores', S.cmsis)],
  regions: [
    reg('flash', 'Flash (code)', 0x00000000, 256 * KB, 'flash', ['vector', 'code', 'rodata'],
      'Non-volatile. Holds the vector table at its start, then machine code, then constants (.rodata) and the initial values of initialised globals (the load image of .data). The CPU executes directly from here.', S.cmsis),
    reg('sram', 'SRAM', 0x20000000, 64 * KB, 'ram', ['data', 'bss', 'heap', 'stack'],
      'Volatile read/write memory. From the bottom up: .data (initialised globals, copied from flash at startup), .bss (zeroed globals), then the heap growing upward. The stack starts at the top and grows downward.', S.cmsis),
    reg('periph', 'Peripheral registers', 0x40000000, 512 * MB, 'periph', ['periph'],
      'Not memory at all: each address is a hardware register. A store here changes a pin or starts a conversion; a load reads hardware state. In this illustrative layout GPIO is at 0x40020000 and UART0 at 0x40004000.', S.cmsis),
    reg('ppb', 'System control space (core peripherals)', 0xE0000000, 1 * MB, 'system', ['system'],
      'Registers that belong to the CPU core itself and sit at the same addresses on every Cortex-M: SysTick at 0xE000E010, the NVIC interrupt controller at 0xE000E100, the System Control Block (with VTOR) at 0xE000ED00.', S.cmsis),
  ],
  blocks: {
    cpu: f('One core. Fetches Thumb instructions from flash, keeps working data in registers R0–R12, SP, LR, PC.', S.cmsis),
    flash: f('256 KB at 0x00000000–0x0003FFFF (illustrative size).', S.cmsis, { reach: '0x00000000–0x0003FFFF' }),
    sram: f('64 KB at 0x20000000–0x2000FFFF (illustrative size).', S.cmsis, { reach: '0x20000000–0x2000FFFF' }),
    rom: null,
    clock: f('An internal RC oscillator at reset; firmware may switch to a crystal or PLL. Every peripheral clock is gated: a peripheral whose clock is off ignores register writes.', S.cmsis),
    intc: f('NVIC, part of the core. Registers at 0xE000E100.', S.cmsis, { reach: '0xE000E100 (same on every Cortex-M)' }),
    timers: f('Illustrative timer at 0x40001000; SysTick (in the core) at 0xE000E010.', S.cmsis, { reach: '0x40001000 (illustrative)' }),
    gpio: f('Illustrative GPIO port at 0x40020000: direction, output, input registers.', S.cmsis, { reach: '0x40020000 (illustrative)' }),
    uart: f('Illustrative UART0 at 0x40004000.', S.cmsis, { reach: '0x40004000 (illustrative)' }),
    i2c: f('Illustrative I2C0 at 0x40005000.', S.cmsis, { reach: '0x40005000 (illustrative)' }),
    spi: f('Illustrative SPI0 at 0x40006000.', S.cmsis, { reach: '0x40006000 (illustrative)' }),
    adc: f('Illustrative ADC at 0x40012000.', S.cmsis, { reach: '0x40012000 (illustrative)' }),
    debug: f('Serial Wire Debug (SWDIO + SWCLK). The debugger can halt the core and read or write any address the core can, including flash and RAM.', S.cmsis),
    security: f('None in this illustrative layout. Real parts add some of: debug lock, memory protection unit, AES/TRNG hardware, secure boot ROM.', S.cmsis),
    pins: f('Each pin is shared: GPIO or one of several peripheral functions, selected by a pin-mux register.', S.cmsis),
  },
  peripherals: [f('GPIO, UART, I2C, SPI, timer, ADC (illustrative set)', S.cmsis)],
  debug: [f('SWD: two pins, SWDIO and SWCLK', S.cmsis)],
  security: [f('None modelled', S.cmsis)],
  boot: [
    { id: 'reset', title: 'Reset', where: 'CPU core', storage: 'core',
      does: f('Reset is released. The core does not start at "address 0 and run": it first loads two words from the start of the vector table. Word 0 becomes the initial stack pointer (MSP). Word 1 becomes the program counter — the address of the reset handler, with bit 0 set to mark Thumb code.', S.cmsis),
      verifies: f('Nothing. The core trusts whatever two words are in flash.', S.cmsis) },
    { id: 'vectors', title: 'Vector table in flash', where: 'Flash, 0x00000000', storage: 'flash', firstMutable: true,
      does: f('The table is ordinary data in flash, produced by the linker: [0] initial SP, [1] reset handler, [2] NMI, [3] HardFault, … then one entry per interrupt. Whoever can write flash decides where the CPU goes first.', S.cmsis),
      verifies: f('Nothing.', S.cmsis) },
    { id: 'startup', title: 'Startup code (reset handler)', where: 'Flash', storage: 'flash',
      does: f('Before any C code can rely on its globals: copy the initial values of .data from flash to RAM, write zeros over .bss, optionally configure clocks, then call main(). If this is skipped, initialised globals contain whatever was in RAM.', S.cmsis),
      verifies: f('Nothing.', S.cmsis) },
    { id: 'app', title: 'main()', where: 'Flash', storage: 'flash',
      does: f('Your application. On a bare-metal system main() must never return.', S.cmsis),
      verifies: f('Nothing unless you add a bootloader that checks the application before jumping to it.', S.cmsis) },
  ],
  compare: null,
};

const esp32 = {
  id: 'esp32', name: 'ESP32 (original)', short: 'ESP32',
  summary: 'Dual-core Xtensa SoC with Wi-Fi and Bluetooth. Program flash is an external SPI chip mapped into the address space, not an on-chip array.',
  cores: [f('2 Xtensa cores; CPU frequency options up to 240 MHz', S.espCaps), f('Core name: Xtensa 32-bit LX6 (ESP32 Series Datasheet v5.3, Product Overview). The ESP32-S3 datasheet names its cores LX7.', S.espDs)],
  isa: [f('Xtensa (ESP32, ESP32-S3). The ESP32-C3 and ESP32-C6 are RISC-V instead, so "ESP32" does not name one instruction set.', S.espKconfig)],
  regions: [
    reg('drom', 'DROM (flash-mapped data)', 0x3F400000, 0x3F800000 - 0x3F400000, 'flash', ['rodata'],
      'A window onto the external SPI flash for read-only data: constants and string literals are read from here through the flash cache.', S.espSoc),
    reg('extram', 'External RAM data', 0x3F800000, 0x3FC00000 - 0x3F800000, 'ram', [],
      'Address range for external (SPI) RAM, when a module has it.', S.espSoc),
    reg('rtcdram', 'RTC DRAM', 0x3FF80000, 0x2000, 'ram', [],
      'Small RAM in the RTC power domain.', S.espSoc),
    reg('dram', 'DRAM (internal data RAM)', 0x3FFAE000, 0x40000000 - 0x3FFAE000, 'ram', ['data', 'bss', 'heap', 'stack'],
      'Internal data RAM: initialised and zeroed globals, the heap, and task stacks.', S.espSoc),
    reg('rom', 'Mask ROM', 0x40000000, 0x70000, 'rom', ['rom'],
      'Code fixed at manufacture, including the first-stage (ROM) bootloader. It cannot be reflashed.', S.espSoc),
    reg('cache', 'PRO / APP cache', 0x40070000, 0x10000, 'ram', [],
      'Cache memory for the two CPUs (PRO 0x40070000–0x40078000, APP 0x40078000–0x40080000).', S.espSoc),
    reg('iram', 'IRAM (internal instruction RAM)', 0x40080000, 0x400AA000 - 0x40080000, 'ram', ['ramcode'],
      'RAM that holds executable code: routines that must run while the flash cache is unavailable are placed here.', S.espSoc),
    reg('rtciram', 'RTC IRAM', 0x400C0000, 0x2000, 'ram', [],
      'Small executable RAM in the RTC power domain.', S.espSoc),
    reg('irom', 'IROM (flash-mapped code)', 0x400D0000, 0x40400000 - 0x400D0000, 'flash', ['code'],
      'A window onto the external SPI flash for instructions: most application code executes from here through the flash cache.', S.espSoc),
    reg('rtcdata', 'RTC data', 0x50000000, 0x2000, 'ram', [],
      'RTC-domain data memory.', S.espSoc),
  ],
  regionNotes: [unv('Peripheral register address range', S.espSoc), unv('Reset vector address', S.espSoc)],
  blocks: {
    cpu: f('2 Xtensa cores (called PRO and APP in the memory map), frequency options up to 240 MHz.', S.espCaps),
    flash: f('External SPI flash, usually wired to GPIO6–11 on the module, seen by the CPU through two mapped windows.', S.espGpio, { reach: 'DROM 0x3F400000–0x3F7FFFFF (data), IROM 0x400D0000–0x403FFFFF (code)' }),
    sram: f('Internal RAM split by use: DRAM for data, IRAM for code that must run from RAM.', S.espSoc, { reach: 'DRAM 0x3FFAE000–0x3FFFFFFF, IRAM 0x40080000–0x400A9FFF' }),
    rom: f('Mask ROM holding the first-stage bootloader.', S.espSoc, { reach: '0x40000000–0x4006FFFF' }),
    clock: f('CPU frequency is selectable, up to 240 MHz.', S.espCpu),
    intc: unv('Interrupt controller structure and addresses', S.espSoc),
    timers: unv('Timer instances and addresses', S.espSoc),
    gpio: f('GPIO34–39 are input-only with no software pull-up or pull-down. GPIO0, 2, 5, 12 and 15 are strapping pins sampled at reset. GPIO6–11 (and usually 16–17) belong to the module\'s flash/PSRAM.', S.espGpio, { reach: null }),
    uart: unv('UART instance count and addresses', S.espSoc),
    i2c: unv('I2C instance count and addresses', S.espSoc),
    spi: unv('SPI instance count and addresses', S.espSoc),
    adc: f('ADC2 pins cannot be used while Wi-Fi is in use; use ADC1. The one-shot driver arbitrates ADC2 with Wi-Fi.', S.espAdc, { reach: null }),
    debug: f('JTAG on GPIO12–15. (ESP32-S3, -C3 and -C6 instead have a built-in USB Serial/JTAG controller.)', S.espGpio),
    security: f('eFuse-held keys; Secure Boot (V1 before chip revision v3.0, V2 from v3.0); flash encryption with AES-256 and a per-block key tweak (not XTS on this chip).', S.espFe),
    pins: f('Many pins have restrictions (strapping, input-only, flash, JTAG, ADC2/Wi-Fi), so pin choice is a design decision, not a detail.', S.espGpio),
  },
  peripherals: [
    f('Wi-Fi and Bluetooth radios on chip', S.espCaps),
    f('GPIO34–39 input-only; strapping pins GPIO0, 2, 5, 12, 15', S.espGpio),
    f('ADC2 unusable while Wi-Fi is in use', S.espAdc),
    unv('UART / I2C / SPI / timer instance counts', S.espSoc),
  ],
  debug: [
    f('JTAG on GPIO12–15 (original ESP32)', S.espGpio),
    f('ESP32-S3/C3/C6: built-in USB Serial/JTAG controller giving a serial console, esptool flashing and JTAG at once', S.espUsb),
  ],
  security: [
    f('Secure Boot V1: ESP32 only, before chip revision v3.0; AES-based, 256-bit key in eFuse BLOCK2', S.espSb1),
    f('Secure Boot V2: RSA-PSS with RSA-3072 by default; on ESP32 from chip revision v3.0. The ROM verifies the second-stage bootloader, which verifies the app', S.espSb2),
    f('Flash encryption (original ESP32): AES-256, key in eFuse BLOCK1, key tweaked by flash offset per 32-byte block; not XTS. Newer chips use XTS-AES', S.espFe),
    f('Published fault-injection advisory: CVE-2023-35818 (EMFI bypass of Secure Boot and flash encryption), applicable to chip revisions v3.0/v3.1', S.espVuln),
  ],
  boot: [
    { id: 'reset', title: 'Reset', where: 'CPU', storage: 'core',
      does: f('Reset is released and the CPU begins executing code in the mask ROM. The strapping pins (GPIO0, GPIO2, GPIO5, GPIO12, GPIO15) are sampled; what each one selects is in the datasheet (not verified here).', S.espGpio),
      verifies: f('Nothing.', S.espGpio) },
    { id: 'rom', title: 'ROM bootloader (first stage)', where: 'Mask ROM, 0x40000000–0x4006FFFF', storage: 'rom',
      does: f('Fixed at manufacture. It loads the second-stage bootloader from a flash offset that the ROM hard-codes: 0x1000 on the ESP32, 0x0 on the ESP32-S3, -C3 and -C6.', S.espRom),
      verifies: f('With Secure Boot V2 enabled: the signature of the second-stage bootloader (RSA-PSS, RSA-3072 by default; ESP32 chip revision v3.0 or later). Without secure boot: no authenticity check.', S.espSb2) },
    { id: 'bl2', title: 'Second-stage bootloader', where: 'Flash offset 0x1000 (ESP32)', storage: 'flash', firstMutable: true,
      does: f('Built from ESP-IDF source with your project. Reads the partition table at its default offset 0x8000 (up to 95 entries, with an MD5 appended) and chooses which application partition to boot; the default factory app is at 0x10000.', S.espPart),
      verifies: f('With Secure Boot V2 enabled: the signature of the application image. Without secure boot: no authenticity check.', S.espSb2) },
    { id: 'app', title: 'Application', where: 'Flash, app partition (default 0x10000), mapped at IROM/DROM', storage: 'flash',
      does: f('Your firmware. ESP-IDF start-up code runs first and starts FreeRTOS; your entry point is app_main(), which runs in a task rather than being the reset handler.', S.espIdf),
      verifies: f('Whatever your application checks itself.', S.espIdf) },
  ],
};

const max78000 = {
  id: 'max78000', name: 'MAX78000 (MAX78000FTHR board)', short: 'MAX78000',
  summary: 'Analog Devices microcontroller with an Arm Cortex-M4 core, a second RISC-V core and a neural-network accelerator. Used in eCTF 2024 and 2025.',
  cores: [
    f('Arm Cortex-M4 with FPU and MPU', S.maxH),
    f('Plus a RISC-V core (RV32 interrupt map in the header); it is set up and handed work by the Arm core and debugged over a separate JTAG port', S.maxUg),
    unv('Maximum CPU frequency and RISC-V core variant', S.maxH),
  ],
  isa: [f('Arm core: Thumb-2 (Cortex-M4 with FPU). Second core: RISC-V RV32.', S.maxH)],
  regions: [
    reg('rom', 'ROM', 0x00000000, null, 'rom', ['rom'],
      'On-chip ROM starts at address 0. Its size and what its code does at reset are not verified here — see the datasheet.', S.maxH),
    reg('flash', 'Flash', 0x10000000, 512 * KB, 'flash', ['vector', 'code', 'rodata'],
      'On-chip program flash, 512 KB in 8 KB pages. An application\'s vector table, code and constants are linked here. In eCTF 2024/2025 the first 0xE000 bytes held the MITRE bootloader and team firmware started at 0x1000E000.', S.maxLd),
    reg('sram', 'SRAM', 0x20000000, 128 * KB, 'ram', ['data', 'bss', 'heap', 'stack'],
      '128 KB of RAM: .data, .bss, heap and stack.', S.maxLd),
    reg('periph', 'Peripheral registers', 0x40000000, 512 * MB, 'periph', ['periph'],
      'The Cortex-M peripheral region. Instances confirmed from the device header: CRC at 0x4000F000, AES at 0x40007400, AES keys at 0x40007800, TRNG at 0x4004D000. Other peripheral base addresses: read them from max78000.h.', S.maxH),
    reg('ppb', 'System control space (core peripherals)', 0xE0000000, 1 * MB, 'system', ['system'],
      'Defined by Arm, not by the chip vendor: SysTick at 0xE000E010, NVIC at 0xE000E100, System Control Block at 0xE000ED00.', S.cmsis),
  ],
  blocks: {
    cpu: f('Arm Cortex-M4 with FPU and MPU, plus a RISC-V core that the Arm core must set up and hand off to.', S.maxH),
    flash: f('512 KB on-chip flash, 8 KB pages.', S.maxLd, { reach: '0x10000000–0x1007FFFF' }),
    sram: f('128 KB SRAM.', S.maxLd, { reach: '0x20000000–0x2001FFFF' }),
    rom: f('ROM at address 0. Its contents and boot behaviour are not verified here — see datasheet.', S.maxH, { reach: 'starts at 0x00000000; size ' + UNVERIFIED }),
    clock: f('Oscillators (nominal): IPO 100 MHz, ISO 60 MHz, IBRO 7.3728 MHz, ERTCO 32.768 kHz, INRO about 30 kHz.', S.maxSys),
    intc: f('NVIC for the Arm core (0xE000E100, defined by Arm). The RISC-V core has its own interrupt map.', S.maxH, { reach: '0xE000E100 (Arm core)' }),
    timers: f('6 timers (TMR4 and TMR5 are low-power), 2 watchdogs, an RTC and a wake-up timer.', S.maxH, { reach: null }),
    gpio: f('4 GPIO ports. On the FTHR board the RGB LED is on P2.0/P2.1/P2.2 (active low) and the buttons on P0.2 and P1.7.', S.maxBoard, { reach: null }),
    uart: f('4 UARTs (UART3 is the low-power one). The FTHR console is UART0 at 115200 baud.', S.maxH, { reach: null }),
    i2c: f('3 I2C controllers.', S.maxH, { reach: null }),
    spi: f('2 SPI controllers available to the Arm core (SPI0 and SPI1).', S.maxH, { reach: null }),
    adc: f('An ADC with 4 external inputs AIN0–AIN3 plus internal supply-monitor selections (MSDK driver). Resolution is not verified here — see datasheet.', S.maxAdc, { reach: null }),
    debug: f('The MAX78000FTHR carries a MAX32625PICO debug adapter that appears as a DAPLINK drive. Dropping a file named erase.act on that drive mass-erases the target. The RISC-V core uses a separate JTAG port.', S.maxFthr),
    security: f('AES engine at 0x40007400 with key registers at 0x40007800; TRNG at 0x4004D000; CRC at 0x4000F000. Secure-boot and ROM bootloader details are not verified here — see datasheet.', S.maxH, { reach: 'AES 0x40007400, AES keys 0x40007800, TRNG 0x4004D000, CRC 0x4000F000' }),
    pins: f('Also on chip: I2S, 1-Wire master, parallel camera interface, pulse train outputs, low-power comparator.', S.maxH),
  },
  peripherals: [
    f('UART ×4, I2C ×3, SPI ×2 (Arm core), timers ×6, GPIO ports ×4, watchdog ×2', S.maxH),
    f('ADC, DMA, RTC, wake-up timer, 1-Wire master, I2S, parallel camera interface, low-power comparator, 8 inter-core semaphores', S.maxH),
    f('Convolutional neural network accelerator (the reason the part exists)', S.maxUg),
    f('ADC external inputs AIN0–AIN3 (MSDK driver)', S.maxAdc),
    unv('ADC resolution', S.maxH),
  ],
  debug: [
    f('On-board MAX32625PICO adapter presenting a DAPLINK drive; erase.act mass-erases the target', S.maxFthr),
    f('RISC-V core debugged over a separate JTAG port', S.maxUg),
    f('OpenOCD: the Analog Devices build shipped with the MSDK', S.maxReadme),
  ],
  security: [
    f('AES engine with dedicated key registers, TRNG, CRC', S.maxH),
    f('MPU on the Cortex-M4', S.maxH),
    f('AES key sizes 128, 192 and 256 bits (MSDK AES driver)', S.maxAes),
    unv('Secure boot and ROM bootloader variants', S.maxH),
  ],
  boot: [
    { id: 'reset', title: 'Reset', where: 'CPU (Arm core)', storage: 'core',
      does: f('Reset is released on the Arm Cortex-M4. The RISC-V core does not start by itself: the Arm core has to set it up and hand off to it later.', S.maxUg),
      verifies: f('Nothing.', S.maxUg) },
    { id: 'rom', title: 'ROM', where: 'ROM, from 0x00000000', storage: 'rom',
      does: unv('What the ROM code does before flash runs', S.maxH),
      verifies: unv('Whether and how the ROM authenticates flash contents', S.maxH) },
    { id: 'bl2', title: 'Bootloader in flash (eCTF 2024/2025: the MITRE eCTF bootloader)', where: 'Flash 0x10000000, length 0xE000', storage: 'flash', firstMutable: true,
      does: f('In the eCTF 2024 and 2025 designs the first 0xE000 bytes of flash were reserved for the MITRE-provided bootloader, which installs team firmware sent over serial and then starts it. A stand-alone MSDK project has no such stage: its own vector table sits at 0x10000000.', S.ectf24Ld),
      verifies: f('Design-phase boards use an unprotected "insecure" bootloader (entered by holding SW1 at reset; LED blinks blue). Attack-phase boards carry a keyed secure bootloader that disables debug. What it checks internally is not published.', S.ectf25Sbl) },
    { id: 'startup', title: 'Startup code', where: 'Flash (team firmware from 0x1000E000 in eCTF)', storage: 'flash',
      does: f('Standard Cortex-M startup: the stack pointer and reset handler come from the firmware\'s vector table, .data is copied to SRAM at 0x20000000, .bss is zeroed, then main() is called.', S.maxLd),
      verifies: f('Nothing.', S.maxLd) },
    { id: 'app', title: 'main()', where: 'Flash', storage: 'flash',
      does: f('Your firmware, linked against the MSDK.', S.maxReadme),
      verifies: f('Whatever your firmware checks itself.', S.maxReadme) },
  ],
};

const mspm0l2228 = {
  id: 'mspm0l2228', name: 'TI MSPM0L2228', short: 'MSPM0L2228',
  summary: 'Low-power Arm Cortex-M0+ microcontroller with AES, TRNG, a keystore and tamper inputs. Used in eCTF 2026.',
  cores: [
    f('One Arm Cortex-M0+ (r0p1) with MPU and VTOR; 2 NVIC priority bits, so 4 interrupt priority levels', S.mspH),
    f('The eCTF 2026 reference design runs the CPU clock at 32 MHz and builds with soft-float', S.ectf26Cfg),
    f('Maximum CPU frequency 32 MHz (datasheet SLASF94A, Features)', S.tiDs),
  ],
  isa: [f('Thumb (ARMv6-M: -mcpu=cortex-m0plus -march=thumbv6m), no hardware floating point', S.ectf26Mk)],
  regions: [
    reg('flash', 'Main flash', 0x00000000, 256 * KB, 'flash', ['vector', 'code', 'rodata'],
      '256 KB of program flash starting at address 0: vector table, code and constants. In the eCTF 2026 design the first 0x6000 bytes are the bootloader and team firmware starts at 0x00006000.', S.mspCmd),
    reg('sram_ecc', 'SRAM, ECC-checked view', 0x20000000, 32 * KB, 'ram', ['data', 'bss', 'heap', 'stack'],
      'View 1 of 3 onto the one 32 KB SRAM. Accesses through this address range are checked with an error-correcting code (ECC). It is the same physical memory as the views at 0x20100000 and 0x20200000, not extra RAM: the chip has 32 KB in total. Datasheet SLASF94A, Table 8-4.', S.tiDs, { aliasOf: 'sram', check: 'ECC-checked' }),
    reg('sram_par', 'SRAM, parity-checked view', 0x20100000, 32 * KB, 'ram', ['data', 'bss', 'heap', 'stack'],
      'View 2 of 3 onto the same 32 KB SRAM. Accesses through this address range are parity-checked: an error is detected but cannot be corrected. Datasheet SLASF94A, Table 8-4.', S.tiDs, { aliasOf: 'sram', check: 'parity-checked' }),
    reg('sram', 'SRAM, unchecked view (used by the linker files)', 0x20200000, 32 * KB, 'ram', ['data', 'bss', 'heap', 'stack'],
      'View 3 of 3 onto the same 32 KB SRAM, with no error checking on the access. TI\'s linker file and the eCTF 2026 firmware.ld place .data, .bss, heap and stack through this view, so these are the addresses you see in a map file or debugger. A fourth range at 0x20300000 exposes the ECC/parity code bits themselves. Datasheet SLASF94A, Table 8-4.', S.tiDs, { check: 'unchecked' }),
    reg('periphgap', 'Peripheral registers', 0x40000000, null, 'periph', ['periph'],
      'Peripheral registers are in the Cortex-M peripheral region, but their base addresses were not confirmed for this fact sheet — read them from the device header mspm0l222x.h.', S.mspH),
    reg('nonmain', 'NONMAIN configuration flash', 0x41C00000, 0x400, 'config', ['config'],
      'A small flash region that holds boot configuration instead of code: BCR_CONFIG at 0x41C00000 (debug access policy, SWD enable, mass-erase policy, application integrity check) and BSL_CONFIG at 0x41C00100.', S.mspCmd),
    reg('factory', 'FACTORY region', 0x41C40000, null, 'config', [],
      'Factory-programmed device information (MSPM0 family-level address from the OpenOCD driver). Size not verified here — see the datasheet.', S.mspOcd),
    reg('ppb', 'System control space (core peripherals)', 0xE0000000, 1 * MB, 'system', ['system'],
      'Defined by Arm, not by TI: SysTick at 0xE000E010, NVIC at 0xE000E100, System Control Block (with VTOR) at 0xE000ED00.', S.cmsis),
  ],
  blocks: {
    cpu: f('One Arm Cortex-M0+ with MPU and VTOR. Only 4 interrupt priority levels (2 NVIC priority bits).', S.mspH),
    flash: f('256 KB main flash with ECC in two 128 KB banks (bank 1 starts at 0x00020000) with address swap; 1 KB sectors. No data-flash region is listed for this part.', S.tiDs, { reach: '0x00000000–0x0003FFFF' }),
    sram: f('One 32 KB SRAM seen through three address ranges: 0x20000000 (ECC-checked), 0x20100000 (parity-checked) and 0x20200000 (unchecked; the one the linker files use).', S.tiDs, { reach: '0x20200000–0x20207FFF as linked; same memory at 0x20000000 and 0x20100000' }),
    rom: f('Boot configuration lives in NONMAIN flash. The ROM bootstrap loader (BSL) works over UART or I2C, always requires a 256-bit password, is enabled by default and can be disabled; it starts on the BSL_invoke pin, on a blank device, or on request from software.', S.tiDs, { reach: 'NONMAIN 0x41C00000–0x41C003FF (BCR_CONFIG 0x41C00000, BSL_CONFIG 0x41C00100)' }),
    clock: f('Internal 4–32 MHz oscillator (SYSOSC) and 32 kHz LFOSC; 32 MHz is the maximum CPU frequency, and the eCTF 2026 reference design runs at it.', S.tiDs),
    intc: f('NVIC with 2 priority bits (4 levels), at 0xE000E100 as defined by Arm.', S.mspH, { reach: '0xE000E100' }),
    timers: f('Timers TIMG0, TIMG4, TIMG5, TIMG8, TIMG12 and TIMA0; RTC_A; a window watchdog WWDT0.', S.mspH, { reach: null }),
    gpio: f('Ports GPIOA, GPIOB, GPIOC. In the eCTF 2026 reference design the status LED is PB14 and button S2 is PB21.', S.mspH, { reach: null }),
    uart: f('5 UARTs (UART0–4). The eCTF 2026 design uses UART0 (PA10 TX / PA11 RX) and UART1 (PA8 TX / PA9 RX) at 115200 baud.', S.mspH, { reach: null }),
    i2c: f('3 I2C controllers (I2C0–2).', S.mspH, { reach: null }),
    spi: f('2 SPI controllers (SPI0–1).', S.mspH, { reach: null }),
    adc: f('12-bit 1.68 Msps ADC with up to 26 external channels, a comparator with 8-bit DAC, and a 1.4 V / 2.5 V internal reference.', S.tiDs, { reach: null }),
    debug: f('2-pin SWD through a TI XDS110 probe: on board on the LP-MSPM0L2228 LaunchPad, external on jumper wires for the eCTF 2026 MSP-LITO-L2228 board. NONMAIN sets one of three SWD security levels: 0 open (factory default), 1 custom (debug, mass erase, factory reset each enabled / password / disabled), 2 debug port disabled.', S.tiTrm),
    security: f('AESADV, TRNG, KEYSTORECTL (key store) and CRCP0 modules; tamper I/O in the LFSS block; flash write protection options.', S.mspH, { reach: null }),
    pins: f('Also on chip: a segment LCD controller and DMA.', S.mspH),
  },
  peripherals: [
    f('UART ×5, I2C ×3, SPI ×2, ADC0, COMP0, VREF', S.mspH),
    f('Timers TIMG0/4/5/8/12 and TIMA0, RTC_A, window watchdog WWDT0, GPIOA/B/C, DMA, LCD, LFSS', S.mspH),
    f('Tamper I/O and tamper-event timestamping (SDK examples)', S.mspEx),
    f('12-bit ADC, up to 26 external channels; up to 3 tamper inputs TIO0–TIO2 depending on package (SLASF94A)', S.tiDs),
  ],
  debug: [
    f('SWD; TI XDS110 probe (supports JTAG and SWD, with an auxiliary UART)', S.mspDbg),
    f('OpenOCD upstream has an MSPM0 flash driver listing MSPM0L2228 parts and a LaunchPad board config using the XDS110', S.mspOcd),
    f('Debug access is a boot-configuration choice: enabled, password-protected or disabled', S.mspBcr),
    f('The LP-MSPM0L2228 LaunchPad has an on-board XDS110 with back-channel UART', S.tiLp),
    f('eCTF 2026 board is the custom MSP-LITO-L2228 (not sold commercially; the LaunchPad is "largely interchangeable"); its XDS110 is external, on 8 jumper wires', S.ectf26Board),
  ],
  security: [
    f('AESADV: 128- and 256-bit keys only (no 192); GCM/GMAC, CCM/CBC-MAC, CBC, CTR. Keystore holds up to four AES keys. TRNG, CRC-16/32. PSA Level 1 certified (SLASF94A)', S.tiDs),
    f('Static write protection: per sector for the first 32 flash sectors, per 8 sectors after; NONMAIN can be locked too. An SWD mass erase or factory reset overrides it unless those commands are password-protected or disabled (SLAU847F 1.4.2.3)', S.tiTrm),
    f('Boot configuration (BCR) options: debug access, SWD enable, mass erase and factory reset policy, NONMAIN static write protection, application check by CRC or hash', S.mspBcr),
    f('Customer Secure Code: TI\'s MCUboot-based secure boot stage; ECDSA P-256 + SHA-256 image verification, rollback protection, firewalls, keystore set-up. TI states it "does not guarantee a full secure boot implementation on a device"', S.mspCsc),
    f('Tamper I/O, flash ECC and dynamic memory protection (SDK examples)', S.mspEx),
  ],
  boot: [
    { id: 'reset', title: 'Reset', where: 'CPU core', storage: 'core',
      does: f('Reset is released on the Cortex-M0+.', S.mspH),
      verifies: f('Nothing.', S.mspH) },
    { id: 'bcr', title: 'Boot configuration (NONMAIN)', where: 'NONMAIN flash, BCR_CONFIG at 0x41C00000', storage: 'config',
      does: f('Before application code runs, the device applies the boot configuration stored in NONMAIN: whether debug access is enabled, password-protected or disabled; whether the SWD port is enabled; mass-erase and factory-reset policy; whether the bootstrap loader may be invoked by a pin. The ROM boot configuration routine is the first code after reset (SLAU847F 1.4.2).', S.tiTrm),
      verifies: f('Optionally the integrity of some or all of the application, by a 32-bit CRC, if configured. A CRC or hash detects corruption; without a secret or signature it does not prove who wrote the image.', S.mspBcr) },
    { id: 'bl2', title: 'Bootloader in main flash (TI Customer Secure Code, or the eCTF bootloader)', where: 'Main flash from 0x00000000 (eCTF 2026: length 0x6000)', storage: 'flash', firstMutable: true,
      does: f('Optional. TI\'s Customer Secure Code is an MCUboot-based stage that sets up write/read firewalls, the keystore and bank-swap policy, then starts the application. In the eCTF 2026 design the first 0x6000 bytes of flash are a MITRE bootloader and team firmware is linked at 0x00006000.', S.mspCsc),
      verifies: f('Customer Secure Code verifies the application image with ECDSA P-256 over SHA-256 and enforces rollback protection. In eCTF 2026 the design-phase bootloader is unprotected (update mode: hold S2/PB21 at reset, LED D1 flashes red); the attack-phase secure bootloader loads encrypted images and acts as the CSC. Its internal checks are not published.', S.ectf26Bl) },
    { id: 'startup', title: 'Startup code', where: 'Main flash', storage: 'flash',
      does: f('Standard Cortex-M startup: initial SP and reset handler from the vector table, copy .data to SRAM at 0x20200000, zero .bss, call main().', S.mspCmd),
      verifies: f('Nothing.', S.mspCmd) },
    { id: 'app', title: 'main()', where: 'Main flash', storage: 'flash',
      does: f('Your firmware, linked against the MSPM0 SDK driverlib.', S.ectf26Mk),
      verifies: f('Whatever your firmware checks itself.', S.ectf26Mk) },
  ],
};

export const PLATFORMS = { generic, esp32, max78000, mspm0l2228 };
export const PLATFORM_IDS = Object.keys(PLATFORMS);
export const getPlatform = (id) => PLATFORMS[id] || PLATFORMS.generic;

/** Region of a platform that contains `addr`, or null. Regions with unknown size match only their base. */
export function regionAt(platformId, addr) {
  const p = getPlatform(platformId);
  addr = addr >>> 0;
  for (const r of p.regions) {
    if (r.size == null) { if (addr === r.base) return r; continue; }
    if (addr >= r.base && addr - r.base < r.size) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison axes for the platform comparison lab. Each cell is a list of facts.
export const AXES = [
  { id: 'cpu', title: 'CPU architecture' },
  { id: 'isa', title: 'Instruction set' },
  { id: 'memory', title: 'Memory organisation' },
  { id: 'peripherals', title: 'Peripherals' },
  { id: 'debug', title: 'Debug interface' },
  { id: 'devenv', title: 'Development environment' },
  { id: 'rtos', title: 'RTOS support' },
  { id: 'security', title: 'Security features' },
  { id: 'boot', title: 'Boot process' },
  { id: 'attack', title: 'Attack surface' },
];

const regionFacts = (p) => p.regions.filter((r) => ['flash', 'sram', 'dram', 'drom', 'irom', 'iram', 'rom', 'nonmain'].includes(r.id))
  .map((r) => f(`${r.name}: ${r.size == null ? 'from ' + hx(r.base) + ', size ' + UNVERIFIED : rangeText(r) + ' (' + fmtSize(r.size) + ')'}`, r.src));
const bootFacts = (p) => p.boot.filter((b) => b.id !== 'reset').map((b) => f(`${b.title} — verifies: ${show(b.verifies)}`, b.verifies.src));

export const COMPARE = {
  esp32: {
    cpu: esp32.cores, isa: esp32.isa,
    memory: [...regionFacts(esp32), f('Program flash is a separate SPI chip on the module, mapped into the address space through a cache; code and constants appear at different addresses (IROM vs DROM)', S.espSoc)],
    peripherals: esp32.peripherals, debug: esp32.debug,
    devenv: [
      f('ESP-IDF (v6.1 marked latest stable at research time), installed on Linux with the ESP-IDF Installation Manager: `eim install`', S.espInstall),
      f('Flashing with esptool over the serial port', S.espUsb),
      f('GCC-based toolchains for Xtensa and RISC-V, installed by ESP-IDF; Python 3.10 minimum', S.espInstall),
    ],
    rtos: [
      f('ESP-IDF is built on FreeRTOS: your app_main() already runs inside a task, and both cores are scheduled', S.espIdf),
      f('FreeRTOS kernel source', S.freertos),
    ],
    security: esp32.security, boot: bootFacts(esp32),
    attack: [
      f('External SPI flash: anyone with a clip and a programmer can read or rewrite it unless flash encryption is enabled', S.espFe),
      f('Serial flashing path through the ROM and esptool', S.espUsb),
      f('JTAG on GPIO12–15', S.espGpio),
      f('Radio interfaces (Wi-Fi, Bluetooth) reachable without physical contact', S.espCaps),
      f('Strapping pins sampled at reset change boot behaviour', S.espGpio),
      f('Electromagnetic fault injection against Secure Boot and flash encryption on chip revisions v3.0/v3.1 (CVE-2023-35818)', S.espVuln),
    ],
  },
  max78000: {
    cpu: max78000.cores, isa: max78000.isa,
    memory: [...regionFacts(max78000), f('Flash is on chip, in 8 KB pages; Cortex-M layout with flash at 0x10000000 rather than 0x00000000 or 0x08000000', S.maxLd)],
    peripherals: max78000.peripherals, debug: max78000.debug,
    devenv: [
      f('Analog Devices MSDK: GNU Arm Embedded toolchain, RISC-V GCC, an ADI build of OpenOCD, Make', S.maxReadme),
      f('eCTF 2024 wrapped this in Nix + Poetry with MSDK v2023_06; eCTF 2025 used Docker with MSDK v2024_02 and arm-none-eabi-gcc', S.ectf25Docker),
      f('eCTF firmware was installed through a MITRE bootloader, itself installed by dropping a file on the DAPLINK drive', S.ectf24),
    ],
    rtos: [
      unv('RTOS examples shipped in the MSDK for this part', S.maxReadme),
      f('The FreeRTOS kernel has Cortex-M4F ports; the eCTF reference designs do not need an RTOS', S.freertos),
    ],
    security: max78000.security, boot: bootFacts(max78000),
    attack: [
      f('On-board debug adapter: debugger access to the Arm core and a one-file mass erase (erase.act) unless debug is locked', S.maxFthr),
      f('Second (RISC-V) core with its own JTAG port and shared memory', S.maxUg),
      f('UART, I2C and SPI buses on header pins: everything on them can be observed and injected (eCTF 2024 used I2C between boards, 2025 used UART to a host)', S.ectf24),
      f('A serial boot ROM interface is entered by holding the UART0 RX and SWDCLK pads low at power-up (115200 baud); MITRE used it to unlock attack boards', S.ectf25Sbl),
      unv('ROM bootloader commands and debug-lock mechanism', S.maxH),
    ],
  },
  mspm0l2228: {
    cpu: mspm0l2228.cores, isa: mspm0l2228.isa,
    memory: [...regionFacts(mspm0l2228), f('One 32 KB SRAM, three views: 0x20000000 ECC-checked, 0x20100000 parity-checked, 0x20200000 unchecked (the view TI\'s linker file and the eCTF design use). Boot configuration lives in a separate NONMAIN flash region', S.tiDs)],
    peripherals: mspm0l2228.peripherals, debug: mspm0l2228.debug,
    devenv: [
      f('TI MSPM0 SDK with driverlib; Code Composer Studio, SysConfig (pin and clock configuration generator), UniFlash; compilers TI Arm Clang, GCC, IAR, Keil', S.mspTools),
      f('eCTF 2026 reference design: Docker image with MSPM0 SDK 2_06_00_05 and TI Arm Clang (tiarmclang) — not arm-none-eabi-gcc', S.ectf26Docker),
    ],
    rtos: [
      f('The SDK examples confirmed for this fact sheet are under examples/nortos (no RTOS)', S.mspEx),
      unv('RTOS examples shipped in the MSPM0 SDK for this part', S.mspEx),
      f('The FreeRTOS kernel has Cortex-M0 ports; with 32 KB of RAM every task stack is a budget decision', S.freertos),
    ],
    security: mspm0l2228.security, boot: bootFacts(mspm0l2228),
    attack: [
      f('SWD, unless the boot configuration disables it or sets a password', S.mspBcr),
      f('Bootstrap loader, mass erase and factory reset: each is a policy in NONMAIN that can be left open by mistake', S.mspBcr),
      f('NONMAIN itself: writable by firmware unless static write protection is set', S.mspBcr),
      f('UART links (eCTF 2026: a control UART and an HSM-to-HSM transfer UART) are observable and injectable', S.ectf26Cfg),
      f('Physical tampering: the chip offers tamper I/O, which only helps if the firmware uses it', S.mspEx),
    ],
  },
};
