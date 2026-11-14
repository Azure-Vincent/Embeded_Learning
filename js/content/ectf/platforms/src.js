// Source URLs for the platforms track. Every URL here is taken from docs/FACTS.md.
// GitHub URLs were opened during research; anything in NOT_LOADED was not load-tested (host blocked).
const MCA = 'https://github.com/mitre-cyber-academy';
const E24 = `${MCA}/2024-ectf-insecure-example`;
const E25 = `${MCA}/2025-ectf-insecure-example`;
const E26 = 'https://github.com/ectfmitre/2026-ectf-insecure-example';
const MSDK = 'https://github.com/analogdevicesinc/msdk';
const TI = 'https://github.com/TexasInstruments/mspm0-sdk';
const IDF = 'https://github.com/espressif/esp-idf/blob/v6.1';
const OOCD = 'https://github.com/openocd-org/openocd';

export const S = {
  mcaOrg: `${MCA}`,
  mcaRepos: 'https://github.com/orgs/mitre-cyber-academy/repositories?q=ectf',
  notEctf: 'https://github.com/ectf',
  y2017: `${MCA}/2017-ectf-insecure-example`,
  y2017readme: `${MCA}/2017-ectf-insecure-example/blob/master/README.md`,
  y2017make: `${MCA}/2017-ectf-insecure-example/blob/master/bootloader/Makefile`,
  y2018: `${MCA}/2018-ectf-insecure-example`,
  y2018readme: `${MCA}/2018-ectf-insecure-example/blob/master/README.md`,
  y2018proj: `${MCA}/2018-ectf-insecure-example/blob/master/CARD.cydsn/CARD.cyprj`,
  y2019: `${MCA}/2019-ectf-insecure-example`,
  y2019readme: `${MCA}/2019-ectf-insecure-example/blob/master/README.md`,
  y2019hw: `${MCA}/2019-ectf-hardware`,
  y2020: `${MCA}/2020-ectf-insecure-example`,
  y2020readme: `${MCA}/2020-ectf-insecure-example/blob/master/README.md`,
  y2021: `${MCA}/2021-ectf-insecure-example`,
  y2021readme: `${MCA}/2021-ectf-insecure-example/blob/master/README.md`,
  y2021ctrl: `${MCA}/2021-ectf-insecure-example/blob/master/controller/README.md`,
  y2022: `${MCA}/2022-ectf-insecure-example`,
  y2022readme: `${MCA}/2022-ectf-insecure-example/blob/master/README.md`,
  y2022make: `${MCA}/2022-ectf-insecure-example/blob/master/bootloader/Makefile`,
  y2023: `${MCA}/2023-ectf-insecure-example`,
  y2023readme: `${MCA}/2023-ectf-insecure-example/blob/main/README.md`,
  y2023tools: `${MCA}/2023-ectf-tools/blob/main/README.md`,
  y2023make: `${MCA}/2023-ectf-insecure-example/blob/main/car/Makefile`,
  y2024: E24,
  y2024readme: `${E24}/blob/master/README.md`,
  y2024nix: `${E24}/blob/master/shell.nix`,
  y2024py: `${E24}/blob/master/pyproject.toml`,
  y2024ld: `${E24}/blob/master/application_processor/firmware.ld`,
  y2024i2c: `${E24}/blob/master/application_processor/inc/simple_i2c_controller.h`,
  y2024ap: `${E24}/blob/master/application_processor/src/application_processor.c`,
  y2024breakout: `${MCA}/2024-ectf-breakout-board`,
  y2025: E25,
  y2025readme: `${E25}/blob/master/README.md`,
  y2025docker: `${E25}/blob/master/decoder/Dockerfile`,
  y2025dec: `${E25}/blob/master/decoder/src/decoder.c`,
  y2025ld: `${E25}/blob/master/decoder/firmware.ld`,
  y2025py: `${E25}/blob/master/tools/pyproject.toml`,
  y2025flash: `${E25}/blob/master/tools/ectf25/utils/flash.py`,
  y2026: E26,
  y2026readme: `${E26}/blob/release/README.md`,
  y2026docker: `${E26}/blob/release/firmware/Dockerfile`,
  y2026make: `${E26}/blob/release/firmware/Makefile`,
  y2026rootmake: `${E26}/blob/release/Makefile`,
  y2026ld: `${E26}/blob/release/firmware/firmware.ld`,
  y2026cmds: `${E26}/blob/release/firmware/inc/commands.h`,
  y2026fs: `${E26}/blob/release/firmware/inc/filesystem.h`,
  y2026sec: `${E26}/blob/release/firmware/inc/security.h`,
  y2026msg: `${E26}/blob/release/firmware/inc/host_messaging.h`,
  y2026dl: `${E26}/blob/release/firmware/inc/ti_msp_dl_config.h`,
  y2026uart: `${E26}/blob/release/firmware/inc/simple_uart.h`,

  msdk: MSDK,
  msdkReadme: `${MSDK}/blob/main/README.md`,
  msdkGuide: `${MSDK}/blob/main/USERGUIDE.md`,
  maxHdr: `${MSDK}/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/max78000.h`,
  maxSys: `${MSDK}/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/system_max78000.h`,
  maxLd: `${MSDK}/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Source/GCC/max78000.ld`,
  maxBoardH: `${MSDK}/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Include/board.h`,
  maxBoardC: `${MSDK}/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Source/board.c`,
  maxAiDocs: 'https://github.com/analogdevicesinc/MaximAI_Documentation',
  maxFthr: 'https://github.com/analogdevicesinc/MaximAI_Documentation/blob/main/MAX78000_Feather/README.md',

  ti: TI,
  tiReadme: `${TI}/blob/main/README.md`,
  tiHdr: `${TI}/blob/main/source/ti/devices/msp/m0p/mspm0l222x.h`,
  tiCmd: `${TI}/blob/main/source/ti/devices/msp/m0p/linker_files/ticlang/mspm0l2228.cmd`,
  tiExamples: `${TI}/tree/main/examples/nortos/LP_MSPM0L2228/driverlib`,
  tiBootCfg: `${TI}/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h`,
  tiCsc: `${TI}/blob/main/docs/english/middleware/boot_manager/doc_guide/_sources/doc_guide-srcs/customer_secure_users_guide.rst.txt`,
  tiTools: `${TI}/tree/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs`,
  tiDebug: `${TI}/blob/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs/debug_program.rst.txt`,
  oocd: OOCD,
  oocdMspm0: `${OOCD}/blob/master/src/flash/nor/mspm0.c`,
  oocdLp: `${OOCD}/blob/master/tcl/board/ti/mspm0-launchpad.cfg`,

  idf: 'https://github.com/espressif/esp-idf',
  idfRelease: 'https://github.com/espressif/esp-idf/releases/latest',
  idfKconfig: `${IDF}/Kconfig`,
  idfCaps32: `${IDF}/components/soc/esp32/include/soc/Kconfig.soc_caps.in`,
  idfCapsS3: `${IDF}/components/soc/esp32s3/include/soc/Kconfig.soc_caps.in`,
  idfCapsC3: `${IDF}/components/soc/esp32c3/include/soc/Kconfig.soc_caps.in`,
  idfCapsC6: `${IDF}/components/soc/esp32c6/include/soc/Kconfig.soc_caps.in`,
  idfSoc: `${IDF}/components/soc/esp32/include/soc/soc.h`,
  idfRom32: `${IDF}/components/esp_rom/esp32/Kconfig.soc_caps.in`,
  idfRomC3: `${IDF}/components/esp_rom/esp32c3/Kconfig.soc_caps.in`,
  idfPart: `${IDF}/docs/en/api-guides/partition-tables.rst`,
  idfGpio: `${IDF}/docs/en/api-reference/peripherals/gpio/esp32.inc`,
  idfUsbJtag: `${IDF}/docs/en/api-guides/usb-serial-jtag-console.rst`,
  idfSb1: `${IDF}/docs/en/security/secure-boot-v1.rst`,
  idfSb2: `${IDF}/docs/en/security/secure-boot-v2.rst`,
  idfFe: `${IDF}/docs/en/security/flash-encryption.rst`,
  idfVuln: `${IDF}/docs/en/security/vulnerabilities.rst`,
  idfLinux: `${IDF}/docs/en/get-started/linux-setup.rst`,
  esptool: 'https://github.com/espressif/esptool',
};

// Not load-tested during research (hosts were blocked). Treat as candidates and check before relying on them.
export const NOT_LOADED = {
  rules: 'https://rules.ectf.mitre.org/',
  ectf: 'https://ectf.mitre.org/',
  rules2025boot: 'https://rules.ectf.mitre.org/2025/getting_started/boot_reference',
  docs2024boot: 'https://ectfmitre.gitlab.io/ectf-website/2024/components/bootloader.html',
  msdkGuideSite: 'https://analogdevicesinc.github.io/msdk//USERGUIDE/',
  max78000: 'https://www.analog.com/en/products/max78000.html',
  tiProduct: 'https://www.ti.com/product/MSPM0L2228',
  tiLp: 'https://www.ti.com/tool/LP-MSPM0L2228',
  tiSdk: 'https://www.ti.com/tool/MSPM0-SDK',
  xds110: 'https://www.ti.com/lit/sprui94',
  uniflash: 'https://software-dl.ti.com/ccs/esd/uniflash/docs/uniflash.html',
  idfGuide: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/',
  esp32ds: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf',
  esp32trm: 'https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf',
  armDocs: 'https://developer.arm.com/documentation',
  openocdDocs: 'https://openocd.org/doc/',
};

/** Inline source link(s): src('linker script', url) -> " ([linker script](url))". */
export const src = (...pairs) => {
  const out = [];
  for (let i = 0; i < pairs.length; i += 2) out.push(`[${pairs[i]}](${pairs[i + 1]})`);
  return ` (source: ${out.join(', ')})`;
};
