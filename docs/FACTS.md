# Embedded-systems fact sheet (sourced)

Research date: 2026-11-13.

## READ FIRST: access limits that shape this file

- Web access was **partial**. This session's network policy only allowed GitHub (`github.com`, `raw.githubusercontent.com`, git clone).
- **Blocked (could not be opened):** `rules.ectf.mitre.org`, `ectf.mitre.org`, `ectfmitre.gitlab.io`, `docs.espressif.com`, `www.espressif.com`, `www.ti.com`, `www.analog.com`, and every other non-GitHub host. To verify the UNVERIFIED items, those hosts must be allowed in the session's network settings.
- Consequence: every fact in sections 1-4 comes from a file I actually opened in an official vendor/MITRE **GitHub repository** (READMEs, SDK headers, linker scripts, doc sources). No datasheet PDF, TRM, product page, or eCTF rules page was opened.
- Facts that normally live only in datasheets / rules pages are listed under **UNVERIFIED** at the end, with what was tried. Search-engine summaries of blocked pages are reported there and labelled as such; they are not verified facts.
- `github.com/ectf` is **not** the MITRE org (it is an unrelated account with one 2016 repo, "attack"). MITRE's repos are under `github.com/mitre-cyber-academy` (2016-2025) and `github.com/ectfmitre` (2026). Source: https://github.com/ectf , https://github.com/orgs/mitre-cyber-academy/repositories?q=ectf

---

## 1. MITRE eCTF year by year

Public reference-design repos found in the `mitre-cyber-academy` org: 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025 insecure examples, plus `2018-ectf-milestones-demo`, `2019-ectf-hardware`, `2019-ectf-vagrant`, `2023-ectf-tools`, `2024-ectf-breakout-board`.
Source: https://github.com/orgs/mitre-cyber-academy/repositories?q=ectf

### 2017
- System: a secure **bootloader** plus host tools ("Before you can work on your bootloader..."); host tools talk to the bootloader over UART1 on the AVR.
- Hardware: MCU `atmega1284p` (bootloader Makefile `MCU = atmega1284p`), on a "Protostack board", programmed with an **AVR Dragon** over the 6-pin ISP header; `avrdude` is used.
- Environment: **Vagrant + VirtualBox** VM (`Vagrantfile`, `Vagrantfile.local`, `Vagrantfile.team`); host tools in Python.
- Repo: https://github.com/mitre-cyber-academy/2017-ectf-insecure-example
- Sources: https://github.com/mitre-cyber-academy/2017-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2017-ectf-insecure-example/blob/master/bootloader/Makefile

### 2018
- System: an **ATM / bank** system: `bank_server`, `atm_backend`, a `CARD` and a `SECURITY_MODULE` (HSM); XML-RPC interfaces (`xmlrpclib.Binary` return types).
- Hardware: Cypress **PSoC 4**, selected device `CY8C4245AXI-483` in both `CARD.cydsn` and `SECURITY_MODULE.cydsn` project files.
- Environment: **Docker** (Docker Toolbox / docker-machine with VirtualBox) for servers; **PSoC Creator** and PSoC Programmer (Windows) for firmware.
- Repo: https://github.com/mitre-cyber-academy/2018-ectf-insecure-example
- Sources: https://github.com/mitre-cyber-academy/2018-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2018-ectf-insecure-example/blob/master/CARD.cydsn/CARD.cyprj

### 2019
- System: a game-console-like system called "MES" in the repo: U-Boot second-stage bootloader with a "Mesh Game Loader", Linux kernel and filesystem; tools provision users/PINs and games (`provisionSystem.py`, `provisionGames.py`, `packageSystem.py`, `deploySystem.py`).
- Hardware: Digilent **Arty Z7** (project directory `Arty-Z7-10`, Xilinx Zynq); boots from SD card (jumper JP4 to "SD").
- Environment: **Vagrant** VM, Xilinx **PetaLinux** (`petalinux-build`), **Vivado** hardware project (separate `2019-ectf-hardware` repo), Xilinx `bootgen`.
- Repos: https://github.com/mitre-cyber-academy/2019-ectf-insecure-example , https://github.com/mitre-cyber-academy/2019-ectf-hardware , https://github.com/mitre-cyber-academy/2019-ectf-vagrant
- Source: https://github.com/mitre-cyber-academy/2019-ectf-insecure-example/blob/master/README.md

### 2020
- System: an audio **DRM** player: `miPod` Linux-side driver plus a DRM module running on a soft-core **MicroBlaze** in the FPGA fabric (`mb/`), with an audio codec in the PL design.
- Hardware: Digilent **Cora Z7-07S** (project name `Cora-Z7-07S`; "Connect the Cora board to the computer"), Xilinx Zynq, boots from SD card.
- Environment: **Vagrant** VM, Xilinx **Vivado** board files (`vivado-boards/`), `bootgen`.
- Repo: https://github.com/mitre-cyber-academy/2020-ectf-insecure-example
- Sources: https://github.com/mitre-cyber-academy/2020-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2020-ectf-insecure-example/blob/master/getting_started.md

### 2021
- System: **Secure Common Embedded Wireless Link (SCEWL)**: a SCEWL Bus Controller, a CPU running user code, an SSS (`sss/`), and a Radio Waves Emulator.
- Hardware: **emulated** only in the reference design: the controller "runs on a Stellaris lm3s6965 chip, which will be emulated using qemu-system-arm" (`qemu-system-arm -M lm3s6965evb`).
- Environment: **Docker** (`dockerfiles/`), **QEMU**, root `Makefile`.
- Repo: https://github.com/mitre-cyber-academy/2021-ectf-insecure-example
- Sources: https://github.com/mitre-cyber-academy/2021-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2021-ectf-insecure-example/blob/master/controller/README.md , https://github.com/mitre-cyber-academy/2021-ectf-insecure-example/blob/master/tools/launch_sed.sh

### 2022
- System: **Secure Avionics Flight Firmware Installation Routine (SAFFIRe)**: a bootloader that installs protected firmware and configuration images, plus host tools.
- Hardware: TI Tiva C, `PART=TM4C123GH6PM` in the bootloader Makefile. Both **emulated** (custom QEMU image `docker pull ectf/ectf-qemu:tiva`) and **physical** (`--physical` flag) modes; physical hardware was "not supported in the initial code release".
- Environment: **Docker**, custom **QEMU**, TI **Code Composer Studio** for debugging the physical MCU, PySerial.
- Repo: https://github.com/mitre-cyber-academy/2022-ectf-insecure-example
- Sources: https://github.com/mitre-cyber-academy/2022-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2022-ectf-insecure-example/blob/master/getting_started.md , https://github.com/mitre-cyber-academy/2022-ectf-insecure-example/blob/master/bootloader/Makefile

### 2023
- System: **Protected Automotive Remote Entry Device (PARED)**: `car` and key `fob` firmware, `deployment` secrets, `host_tools`.
- Hardware: "Texas Instruments TM4C123G LaunchPad Evaluation Kit"; `PART=TM4C123GH6PM`; OpenOCD config `board/ti_ek-tm4c123gxl.cfg` with `interface/ti-icdi.cfg`. Secrets are placed in EEPROM by the build (`EEPROM_PATH`).
- Environment: required software is Git, **Docker**, Python (3.7+), Stellaris ICDI drivers, TI **UniFlash**; recommended: VS Code, **OpenOCD**, ARM GNU Toolchain.
- Repos: https://github.com/mitre-cyber-academy/2023-ectf-insecure-example , https://github.com/mitre-cyber-academy/2023-ectf-tools
- Sources: https://github.com/mitre-cyber-academy/2023-ectf-insecure-example/blob/main/README.md , https://github.com/mitre-cyber-academy/2023-ectf-tools/blob/main/README.md , https://github.com/mitre-cyber-academy/2023-ectf-insecure-example/blob/main/car/Makefile

### 2024 (MAX78000FTHR): "MISC" system
- Repo: https://github.com/mitre-cyber-academy/2024-ectf-insecure-example (README: "insecure example design for an eCTF MISC system"; host tool help strings call it "the medical device"). Breakout board design files: https://github.com/mitre-cyber-academy/2024-ectf-breakout-board
- Components: one **Application Processor** (`application_processor/`) and **Components** (`component/`). The example AP is provisioned for `COMPONENT_CNT 2` with IDs `0x11111124, 0x11111125`.
- Bus: AP is the **I2C controller** (`simple_i2c_controller.c`, `I2C_INTERFACE MXC_I2C1`, `I2C_FREQ 100000`, `MAX_I2C_MESSAGE_LEN 256`); components are I2C peripherals (`simple_i2c_peripheral.c`).
- Board selection: `override BOARD=FTHR_RevA` in `project.mk` (the MSDK BSP for the MAX78000FTHR).
- Functions exposed by host tools: **list** components (`ectf_list`), **boot** (`ectf_boot`), **replace** a component using a token (`ectf_replace`), **attestation** read using a PIN (`ectf_attestation`). Example PIN `123456` (6 chars), example token `0123456789abcdef` (16 chars). Attestation data fields: location, date, customer. AP and components each have a boot message. Source comments reference "POST_BOOT functionality" with secure send/receive over I2C.
- Build tools: **Nix** (`shell.nix`: gnumake, python39, gcc-arm-embedded, poetry, minicom, custom Analog Devices OpenOCD fork package) + **Poetry** (`ectf_tools` package, v1.0). MSDK pinned to tag `v2023_06` (fetched from `Analog-Devices-MSDK/msdk`). Build entry points: `ectf_build_depl`, `ectf_build_ap`, `ectf_build_comp`; parameters are injected into `ectf_params.h`. wolfSSL is the optional crypto example library.
- Flashing: via the **eCTF Bootloader**. Initial install by drag-and-drop of the provided bootloader (`insecure.bin` for the design phase) onto the **DAPLink** mass-storage drive; a flashing blue LED indicates success. Then `ectf_update --infile <img> --port <serial>`.
- Flash layout (firmware.ld): BOOTLOADER `0x10000000` len `0xE000`; team FLASH `0x1000E000` len `0x38000`; RESERVED `0x10046000` len `0x38000`; ROM_BL_PAGE `0x1007E000` len `0x2000`; SRAM `0x20000000` len `0x20000`.
- Docs site referenced by the README (not load-tested): https://ectfmitre.gitlab.io/ectf-website/2024/components/bootloader.html
- Sources: https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/shell.nix , https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/pyproject.toml , https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/application_processor/firmware.ld , https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/application_processor/inc/simple_i2c_controller.h , https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/application_processor/src/application_processor.c

### 2025 (MAX78000FTHR): Satellite TV System
- Repo: https://github.com/mitre-cyber-academy/2025-ectf-insecure-example (README: "insecure example design for an eCTF Satellite TV System").
- Components: **Decoder** firmware (`decoder/`, C, on the MAX78000; `override BOARD=FTHR_RevA`); host **design** package `ectf25_design` (`encoder.py`, `gen_secrets.py`, `gen_subscription.py`); MITRE host **tools** package `ectf25` (uplink, satellite, tv, flash, tester; "DO NOT MODIFY").
- Data flow: uplink encodes frames with the team's encoder and sends them to the satellite; the satellite broadcasts to all listening TVs on the host; each TV forwards encoded frames to a Decoder over serial and returns the decoded result.
- Functional constants in the reference decoder: `MAX_CHANNEL_COUNT 8`, `EMERGENCY_CHANNEL 0` (always decodable in the reference design; the decoder refuses to subscribe to it), `FRAME_SIZE 64` bytes, `timestamp_t uint64_t`, `channel_id_t uint32_t`, `decoder_id_t uint32_t`. Subscriptions carry device ID, start timestamp, end timestamp, channel. Decoder commands: list channels, update subscription, decode frame.
- Secrets/subscriptions: `python -m ectf25_design.gen_secrets secrets/secrets.json 1 3 4`; `python -m ectf25_design.gen_subscription <secrets> <out.bin> <device_id> <start> <end> <channel>`.
- Build environment: **Docker** (`decoder/Dockerfile`, `FROM ubuntu:24.04`, apt `gcc-arm-none-eabi`, `gdb-multiarch`, make; MSDK tag `v2024_02` downloaded from `analogdevicesinc/msdk`; `MAXIM_PATH=/root/msdk-2024_02`). Build: `docker build -t decoder .` then `docker run --rm -v ./build_out:/out -v ./:/decoder -v ./../secrets:/secrets -e DECODER_ID=0xdeadbeef decoder`. Outputs `max78000.elf` / `max78000.bin`.
- Host Python: plain `venv` + `pip install ./tools/` and `pip install -e ./design/` (packages `ectf25` 2025.01.15, deps loguru/pyserial/tqdm/psutil; `ectf25_design`). Python >= 3.11.
- Flashing: "through the eCTF Bootloader" (MITRE bootloader flashed first; device must be in update mode, flashing blue LED). `python -m ectf25.utils.flash <infile> <port>`; serial 115200 baud; flasher constants `PAGE_SIZE = 8192`, `APP_PAGES = 28`, 16-byte blocks. Flash layout in `firmware.ld` is identical to 2024 (bootloader at `0x10000000`, team firmware at `0x1000E000`).
- **Tooling differences vs 2024 (all from the two repos):** Nix + Poetry replaced by Docker + pip/venv; MSDK `v2023_06` -> `v2024_02`; console-script host tools (`ectf_*`) replaced by `python -m ectf25.*` modules; system changed from multi-board I2C (AP + Components) to a single Decoder board talking to host over UART; a secrets JSON generated by team Python code replaces the `deployment/` Makefile.
- Rules URL referenced in tool help (not load-tested): https://rules.ectf.mitre.org/2025/getting_started/boot_reference
- Sources: https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/README.md , https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/Dockerfile , https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/src/decoder.c , https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/firmware.ld , https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/tools/pyproject.toml , https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/tools/ectf25/utils/flash.py

### 2026 (TI MSPM0L2228): Hardware Security Module (HSM)
- Repo: https://github.com/ectfmitre/2026-ectf-insecure-example (branches `release` and `master`; README: "insecure example design for an eCTF Hardware Security Module"; rules at https://rules.ectf.mitre.org/ per the README, not load-tested). Teams are told NOT to fork; clone and push to a private repo.
- MCU: build flag `-D__MSPM0L2228__`, `-mcpu=cortex-m0plus -march=thumbv6m -mfloat-abi=soft`; links TI driverlib for `mspm0l122x_l222x`.
- Functional model (from firmware headers): the HSM stores **files** in slots. `MAX_FILE_COUNT 8`, `MAX_NAME_SIZE 32`, `MAX_CONTENTS_SIZE 8192`, `UUID_SIZE 16`. Files belong to a 16-bit **group ID**. Permissions per group: `R` read, `W` write, `C` receive (`MAX_PERMS 8`). **PIN**: 6 hex characters (`PIN_LENGTH 6`).
- Commands (message opcodes): LIST `L`, READ `R`, WRITE `W`, RECEIVE `C`, INTERROGATE `I`, LISTEN `N`; plus ACK `A`, DEBUG `D`, ERROR `E`. Packet header: magic `%`, 1-byte cmd, `uint16_t` length.
- Two UARTs at 115200: `CONTROL_INTERFACE` = UART0 (PA10 TX / PA11 RX), `TRANSFER_INTERFACE` = UART1 (PA8 TX / PA9 RX) for HSM-to-HSM transfer. Status LED on PB14, button S2 on PB21. `CPUCLK_FREQ 32000000`.
- Flash layout (firmware.ld): BOOTLOADER `0x00000000` len `0x6000` ("Bootloader flash - unusable"); team FLASH `0x00006000` len `0x34000`; FAT `0x0003A000` len `0x400`; APP2 `0x0003A400` len `0x5C00`; SRAM `0x20200000` len `0x8000`; BCR_CONFIG `0x41C00000`; BSL_CONFIG `0x41C00100`. Stack size 256.
- The file allocation table location (`_FLASH_FAT_START 0x0003a000`) is fixed by the functional spec because "the data structure location must be known by the secure bootloader". Reference design stores each file in 9 flash pages (`FLASH_PAGE_SIZE` = 1024) starting at `0x10000`.
- Toolchain: **Docker** (`firmware/Dockerfile`, `FROM ubuntu:24.04`) with **TI MSPM0 SDK** `mspm0_sdk_2_06_00_05` (from `TexasInstruments/mspm0-sdk` GitHub tag) and **TI Arm Clang** `ti-cgt-armllvm_4.0.3.LTS` (`tiarmclang`, `tiarmobjcopy`). It is **not** arm-none-eabi-gcc in the reference design.
- Build flow: `make docker` (`docker build -t build-hsm ./firmware/`); secrets via `uvx --with-editable ./ectf26_design --from ectf26_design secrets global.secrets <groups>` (uses **uv**); build an HSM with `docker run ... -e HSM_PIN=<pin> -e PERMISSIONS='<group>=RWC' build-hsm`. `build.sh` runs `secrets_to_c_header.py` then `make`, emitting `hsm.elf` and `hsm.bin`. Python package `ectf26_design` requires Python >= 3.12. wolfSSL is the optional crypto example.
- Sources: https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/README.md , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/Dockerfile , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/Makefile , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/firmware.ld , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/Makefile , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/commands.h , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/filesystem.h , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/security.h , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/host_messaging.h , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/ti_msp_dl_config.h , https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/inc/simple_uart.h

---

## 2. MAX78000 / MAX78000FTHR (from Analog Devices MSDK and MaximAI_Documentation on GitHub)

- Device description used by ADI: "MAX78000: Artificial Intelligence Microcontroller with Ultra-Low-Power Convolutional Neural Network Accelerator"; supported boards MAX78000EVKIT, MAX78000FTHR, MAXREFDES178. Source: https://github.com/analogdevicesinc/msdk/blob/main/USERGUIDE.md
- Cores: Arm **Cortex-M4 with FPU and MPU** (`__CM4_REV 0x0100`, `__FPU_PRESENT 1`, `__MPU_PRESENT 1`) plus a **RISC-V** core (header has a separate `__riscv` / `RV32` interrupt map; the RISC-V core needs setup and handoff from the Arm core, and is debugged over a separate JTAG port). Sources: https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/max78000.h , https://github.com/analogdevicesinc/msdk/blob/main/USERGUIDE.md
- Oscillators (nominal): IPO **100 MHz**, ISO **60 MHz**, IBRO 7.3728 MHz, ERTCO 32.768 kHz, INRO ~30 kHz. Source: https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Include/system_max78000.h
- Flash: base **`0x10000000`**, size `0x00080000` (**512 KB**), page size `0x2000` (8 KB). SRAM: base **`0x20000000`**, size `0x00020000` (**128 KB**). ROM at `0x00000000`. Sources: `max78000.h` (above) and https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Source/GCC/max78000.ld
- Peripheral instance counts from the device header: UART x4 (UART3 is the low-power UART), I2C x3, SPI x2 on the Arm core (SPI1 and SPI0), timers x6 (TMR4/TMR5 low-power), GPIO ports x4, watchdog x2, pulse train x4, ADC, DMA, RTC, wake-up timer, 1-Wire master (OWM), I2S, parallel camera interface (PCIF), low-power comparator, semaphores x8 (inter-core). Source: `max78000.h` (above)
- Security-relevant peripherals present in the header: **AES** engine (`MXC_AES` at `0x40007400`) with AES key registers (`MXC_AESKEYS` at `0x40007800`), **TRNG** (`0x4004D000`), **CRC** (`0x4000F000`). Source: `max78000.h` (above)
- MAX78000FTHR on-board debugger: "The MAX78000FTHR has an integrated **MAX32625PICO** ('PICO') debug adapter", which presents as a **DAPLINK** drive; holding SW5 while plugging in enters MAINTENANCE mode for debugger firmware update; dropping an `erase.act` file on the DAPLINK drive mass-erases the target. Source: https://github.com/analogdevicesinc/MaximAI_Documentation/blob/main/MAX78000_Feather/README.md
- FTHR BSP (`FTHR_RevA`): console on UART0 at 115200; RGB LED = 3 LEDs on P2.0 (red), P2.1 (green), P2.2 (blue), active low; 2 push-buttons on P0.2 and P1.7; BSP has power control functions for Microphone, Camera and SD card, and camera SCCB on P0.30/P0.31. Sources: https://github.com/analogdevicesinc/msdk/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Include/board.h , https://github.com/analogdevicesinc/msdk/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Source/board.c
- SDK: "Maxim Microcontrollers SDK (**MSDK**), now a part of Analog Devices"; repo https://github.com/analogdevicesinc/msdk ; User Guide https://analogdevicesinc.github.io/msdk//USERGUIDE/ (URL taken from README; github.io not load-tested). Toolchain components: GNU Arm Embedded, RISC-V GCC (xPack), OpenOCD (ADI build), Make. Source: https://github.com/analogdevicesinc/msdk/blob/main/README.md

---

## 3. TI MSPM0L2228 (from TI MSPM0 SDK on GitHub and upstream OpenOCD)

- Core: Arm **Cortex-M0+** r0p1, MPU present, VTOR present, 2 NVIC priority bits. Source: https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/mspm0l222x.h
- Main flash: origin **`0x00000000`**, length `0x00040000` (**256 KB**). SRAM: origin **`0x20200000`** (NOT `0x20000000`), length `0x00008000` (**32 KB**). NONMAIN configuration memory: BCR_CONFIG at `0x41C00000`, BSL_CONFIG at `0x41C00100`. Source: https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/linker_files/ticlang/mspm0l2228.cmd
- MSPM0 family memory regions per OpenOCD's driver: MAIN flash base `0x0`, NONMAIN `0x41C00000`-`0x41C00400`, DATA flash base `0x41D00000`, FACTORYREGION `0x41C40000`. (Family-level constants; whether the L2228 has a data-flash bank is not confirmed here.) Source: https://github.com/openocd-org/openocd/blob/master/src/flash/nor/mspm0.c
- Peripherals listed in the device header: UART0-4 (5), I2C0-2 (3), SPI0-1 (2), ADC0, COMP0, VREF, timers TIMG0/TIMG4/TIMG5/TIMG8/TIMG12 and TIMA0, GPIOA/B/C, DMA, **LCD**, RTC_A, WWDT0, **LFSS**, plus security modules **AESADV**, **TRNG**, **KEYSTORECTL**, **CRCP0**. Source: `mspm0l222x.h` (above)
- SDK examples for LP_MSPM0L2228 confirm: AES (CBC/CTR/ECB/CMAC/GCM, 128 and 256-bit), tamper I/O (`tamperio_heartbeat`, `rtc_a_tamper_timestamp_event`, `scratchpad_erase_on_tamper`), flash ECC and dynamic memory protection, NONMAIN writes (`flashctl_nonmain_memory_write`). Source: https://github.com/TexasInstruments/mspm0-sdk/tree/main/examples/nortos/LP_MSPM0L2228/driverlib
- NONMAIN Boot Configuration (BCR) options exposed in the L2228 `boot_config.h`: debug access (enabled / enabled with password / disabled), SWD port enable/disable, TI failure analysis enable, CSC-exists flag, bank-swap policy, BSL pin invoke, fast boot, bootloader mode, mass erase and factory reset (enabled / password / disabled), NONMAIN static write protection, secure-boot app check (CRC / hash / disabled). Source: https://github.com/TexasInstruments/mspm0-sdk/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h
- **Customer Secure Code (CSC)**: TI's MCUboot-based secure-boot stage for "device family MSPM0L122x_MSPM0L222x or MSPM0G351x". Verifies images with ECDSA P-256 + SHA-256; under 18 kB of flash per bank ("allowing for two 110kB images on a 256kB device"); sets up write/read/IP-protect firewalls, the KEYSTORE and bank-swapping policy; rollback protection; optional CMAC fast-boot check. The guide's example uses "the MSPM0L2228 LaunchPad". TI states it "does not guarantee a full secure boot implementation on a device". Source: https://github.com/TexasInstruments/mspm0-sdk/blob/main/docs/english/middleware/boot_manager/doc_guide/_sources/doc_guide-srcs/customer_secure_users_guide.rst.txt
- Evaluation board name: **LP-MSPM0L2228** ("MSPM0L2228 EVM - LP-MSPM0L2228"). Source: https://github.com/TexasInstruments/mspm0-sdk/blob/main/README.md
- SDK and tools named in SDK docs: **MSPM0 SDK** (latest tag at research time `mspm0_sdk_2_11_00_07`), **Code Composer Studio** (the Theia-based CCS is now just "Code Composer Studio"; the older one is "CCS v12 Eclipse"), **SysConfig**, **UniFlash**, TI Arm Clang, GCC, IAR, Keil; debug probes XDS110, SEGGER, PEmicro, Lauterbach; BSL host tooling. Source: https://github.com/TexasInstruments/mspm0-sdk/tree/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs
- Debug probe: **XDS110** (supports IEEE 1149.1, 1149.7 and SWD; USB 2.0 HS; auxiliary port with EnergyTrace and UART). Source: https://github.com/TexasInstruments/mspm0-sdk/blob/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs/debug_program.rst.txt
- **OpenOCD: supported upstream.** `src/flash/nor/mspm0.c` (TI copyright 2023-2025, "NOR flash driver for MSPM0L and MSPM0G class") has part-table entries for `MSPM0L2228SRGZR/SPTR/SPMR/SPNAR/SPNR` (part number `0x2C38`), and `tcl/board/ti/mspm0-launchpad.cfg` uses `interface/xds110.cfg` + `target/ti/mspm0.cfg`. Sources: https://github.com/openocd-org/openocd/blob/master/src/flash/nor/mspm0.c , https://github.com/openocd-org/openocd/blob/master/tcl/board/ti/mspm0-launchpad.cfg

---

## 4. ESP32 family (from ESP-IDF v6.1 sources on GitHub)

- **Current stable ESP-IDF:** GitHub marks **v6.1** as "Latest" (released 27 Aug); a `v6.1.1` tag also exists in the repo. Clone command on the release page: `git clone -b v6.1 --recursive https://github.com/espressif/esp-idf.git esp-idf-v6.1`. Source: https://github.com/espressif/esp-idf/releases/latest
- **Linux install (default method since v6.0, ESP-IDF Installation Manager "EIM"):**
  - `echo "deb [trusted=yes] https://dl.espressif.com/dl/eim/apt/ stable main" | sudo tee /etc/apt/sources.list.d/espressif.list`
  - `sudo apt update`
  - `sudo apt install eim` (GUI + CLI) or `sudo apt install eim-cli`
  - `eim install` (latest stable, non-interactive); `eim wizard` (interactive); `eim install -i v5.4.2` (specific version)
  - Python 3.10 is the minimum supported version for ESP-IDF.
  - Sources: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/linux-setup.rst , https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/eim-install-idf.rst
- **Linux install (legacy method, default before v6.0):**
  - `sudo apt-get install git wget flex bison gperf python3 python3-pip python3-venv cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0`
  - clone into `~/esp/esp-idf`, then `cd ~/esp/esp-idf && ./install.sh esp32` (or `all`), then `. $HOME/esp/esp-idf/export.sh`
  - Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/linux-macos-setup-legacy.rst
- **Architectures / cores (Kconfig):** ESP32 = Xtensa, 2 cores, CPU frequency options up to 240 MHz, Wi-Fi + BT. ESP32-S3 = Xtensa, 2 cores, up to 240 MHz, **USB OTG** and **USB Serial/JTAG** both supported. ESP32-C3 = RISC-V, 1 core, up to 160 MHz, USB Serial/JTAG. ESP32-C6 = RISC-V, 1 core (for FreeRTOS), up to 160 MHz, Wi-Fi + BT + IEEE 802.15.4, USB Serial/JTAG. Sources: https://github.com/espressif/esp-idf/blob/v6.1/Kconfig , https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32/include/soc/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32s3/include/soc/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32c3/include/soc/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32c6/include/soc/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/esp_system/port/soc/esp32/Kconfig.cpu
- **USB Serial/JTAG controller:** fixed-function hardware providing a CDC-ACM serial console, flashing with esptool, and JTAG debugging at the same time; D+/D- pins: ESP32-C3 GPIO19/18, ESP32-S3 GPIO20/19, ESP32-C6 GPIO13/12. Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/usb-serial-jtag-console.rst
- **ESP32 memory map (soc.h):** DROM `0x3F400000-0x3F800000`; external RAM data `0x3F800000-0x3FC00000`; RTC DRAM `0x3FF80000-0x3FF82000`; DRAM `0x3FFAE000-0x40000000`; mask ROM `0x40000000-0x40070000`; PRO cache `0x40070000-0x40078000`; APP cache `0x40078000-0x40080000`; IRAM `0x40080000-0x400AA000`; RTC IRAM `0x400C0000-0x400C2000`; IROM `0x400D0000-0x40400000`; RTC data `0x50000000-0x50002000`. Source: https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32/include/soc/soc.h
- **Flash offsets:** second-stage bootloader offset is fixed by ROM: **`0x1000` on ESP32**, **`0x0` on ESP32-S3, ESP32-C3, ESP32-C6**. Partition table default offset **`0x8000`** (table length 0xC00, max 95 entries, MD5 appended, occupies one 0x1000 sector). Factory app default at `0x10000`. Sources: https://github.com/espressif/esp-idf/blob/v6.1/components/esp_rom/esp32/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/esp_rom/esp32s3/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/esp_rom/esp32c3/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/components/esp_rom/esp32c6/Kconfig.soc_caps.in , https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/partition-tables.rst
- **Original ESP32 pins:** strapping pins are GPIO0, GPIO2, GPIO5, GPIO12 (MTDI), GPIO15 (MTDO). **GPIO34-39 are input-only** and have no software pull-up/pull-down. GPIO6-11 and GPIO16-17 are usually connected to the module's SPI flash/PSRAM. GPIO12-15 are JTAG. **ADC2 pins cannot be used when Wi-Fi is used** (use ADC1 instead). Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/gpio/esp32.inc
- ADC2 and Wi-Fi in the oneshot driver: on ESP32/S2/S3 "ADC2 is also used by Wi-Fi"; `adc_oneshot_read` arbitrates between them. On ESP32-C3, ADC2 oneshot is no longer supported due to hardware limitations. Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/adc/adc_oneshot.rst
- **Secure Boot V1** (ESP32 only, before chip revision v3.0): "the AES-based Secure Boot Scheme". A 256-bit AES secure-bootloader key is stored in eFuse BLOCK2; eFuse `ABS_DONE_0` permanently enables it; app images are signed with an ECDSA key pair. For ESP32 v3.0 onwards V2 is preferred. Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v1.rst
- **Secure Boot V2:** default scheme **RSA-PSS with RSA-3072** keys. Available on ESP32 from chip revision **v3.0** onwards and on ESP32-C3 from v0.3 (ECO3). ECDSA-only on ESP32-C2/C61; RSA-3072 or ECDSA-256 on ESP32-C6/H2/P4. The ROM bootloader verifies the second-stage bootloader, which verifies the app. Only one signature block on ESP32 v3.0. Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v2.rst
- **Flash encryption, original ESP32:** NOT XTS. AES-256, key in the `flash_encryption` eFuse (BLOCK1); each 32-byte block (two AES blocks) is encrypted with a key derived by XORing the main key with the block's flash offset ("key tweak", controlled by `FLASH_CRYPT_CONFIG`, recommended `0xF`); AES is used "inverted" (encrypt = AES decrypt). Enable counter eFuse is `FLASH_CRYPT_CNT` (7 bits; odd number of set bits = encrypted). With 3/4 coding scheme the key block is 192 bits.
- **Flash encryption, newer chips:** **XTS-AES** (IEEE Std 1619-2007). 256-bit or 512-bit key (XTS_AES_128 / XTS_AES_256) on chips such as ESP32-S3; 256-bit key only (XTS_AES_128) on chips such as ESP32-C3 and ESP32-C6. Key in `BLOCK_KEYN` eFuses with a key-purpose eFuse; counter eFuse is `SPI_BOOT_CRYPT_CNT`.
  - Source for both bullets: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/flash-encryption.rst (per-chip XTS capability from the `Kconfig.soc_caps.in` files above)
- **Published fault-injection item verified in Espressif's own docs:** CVE-2023-35818, "Security Advisory Concerning Bypassing Secure Boot and Flash Encryption Using EMFI", Espressif advisory AR2023-005, "Applicable for ESP32 Chip Revision v3.0/v3.1". Advisory PDF URL as given in the doc (not load-tested): https://www.espressif.com/sites/default/files/advisory_downloads/AR2023-005%20Security%20Advisory%20Concerning%20Bypassing%20Secure%20Boot%20and%20Flash%20Encryption%20Using%20EMFI%20EN.pdf . Source: https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/vulnerabilities.rst

---

## 5. Canonical documentation URLs

### Verified to exist (GitHub; repo resolved via git or page opened)
- ESP-IDF: https://github.com/espressif/esp-idf (docs sources under `docs/en/`)
- esptool: https://github.com/espressif/esptool
- FreeRTOS kernel: https://github.com/FreeRTOS/FreeRTOS-Kernel
- OpenOCD: https://github.com/openocd-org/openocd
- Ghidra: https://github.com/NationalSecurityAgency/ghidra
- Renode: https://github.com/renode/renode and docs source https://github.com/renode/renode-docs
- PlatformIO: https://github.com/platformio/platformio-core and docs source https://github.com/platformio/platformio-docs
- RISC-V ISA manual (spec source): https://github.com/riscv/riscv-isa-manual
- sigrok / PulseView: https://github.com/sigrokproject/pulseview , https://github.com/sigrokproject/libsigrok
- Arm CMSIS (Cortex-M core headers): https://github.com/ARM-software/CMSIS_6
- Analog Devices MSDK: https://github.com/analogdevicesinc/msdk ; MAX78000 docs https://github.com/analogdevicesinc/MaximAI_Documentation
- TI MSPM0 SDK: https://github.com/TexasInstruments/mspm0-sdk
- MITRE eCTF: https://github.com/mitre-cyber-academy (2016-2025 repos), https://github.com/ectfmitre/2026-ectf-insecure-example

### NOT verified to load (hosts blocked by this session's network policy)
See UNVERIFIED item 9.

---

## UNVERIFIED

Nothing below was confirmed from a primary page I opened. Hosts were blocked; I did not retry other hosts after two different hosts failed the same way.

1. **eCTF named Security Requirements, 2024, 2025, 2026** and the full functional-requirement text. They live on `rules.ectf.mitre.org` / `ectfmitre.gitlab.io` (blocked). Tried: WebFetch of https://rules.ectf.mitre.org/ (DNS-blocked), curl (proxy 403), and searching GitHub repos (requirements text is not in the repos).
   - Search-engine summary only, 2025 (pages https://rules.ectf.mitre.org/2025/specs/security_reqs.html , https://rules.ectf.mitre.org/2025/specs/functional_reqs.html): SR1 an attacker should not be able to decode TV frames without a Decoder that has a valid, active subscription to that channel; SR2 the Decoder should only decode valid TV frames generated by the Satellite System it was provisioned for; SR3 the Decoder should only decode frames with strictly monotonically increasing timestamps.
   - Search-engine summary only, 2026 (pages https://rules.ectf.mitre.org/2026/specs/security_reqs.html , https://rules.ectf.mitre.org/2026/specs/functional_reqs.html , https://rules.ectf.mitre.org/2026/specs/detailed_specs.html): PIN is exactly 6 lowercase hex characters; permissions written like `RWC`, `RW-`, `--C`; reads/writes require the HSM to hold the right permission for the file's group; operations with an invalid PIN have a 5 second maximum completion time; a requirement that PIN-protected actions cannot be completed without the PIN. The search tool noted two differing wordings of SR1, so do not quote it.
   - 2024: no requirement text obtained at all.
2. **2026 exact board name.** Search snippets (not opened) say the 2026 getting-started page lists an "**MSP-LITO-L2228**" board and an insecure eCTF bootloader, which conflicts with the assumed "LP-MSPM0L2228 LaunchPad". The repo only proves the MCU is MSPM0L2228. A MITRE news release (https://www.mitre.org/news-insights/news-release/registration-opens-2026-mitre-embedded-capture-flag-competition, not opened) is summarized as saying Cortex-M0+, 256 kB flash, 32 kB SRAM. Also unverified: 2026 debugger (XDS110 vs other), how the MITRE bootloader is installed/entered, and whether OpenOCD is the official flashing path.
3. **2024/2025 MITRE bootloader internals** (secure vs insecure variant, attack-phase behaviour) and the claim that boards are MAX78000FTHR specifically: the repos show `BOARD=FTHR_RevA` and "MAX78000" only.
4. **Rules/docs site URLs per year** (ectf.mitre.org, rules.ectf.mitre.org/2024..2026, ectfmitre.gitlab.io/ectf-website/2024): taken from READMEs/search results, none loaded. No rules site found for 2017-2022 (READMEs point to http://mitrecyberacademy.org/competitions/embedded/ and https://ectf.mitre.org/).
5. **2019 "MES" expansion and 2017/2018 official theme names**: READMEs do not state them.
6. **MAX78000 datasheet items**: exact max CPU frequencies stated as core specs (header only shows 100 MHz IPO and 60 MHz ISO oscillators), RISC-V core designation (RV32 variant), AES key sizes, secure boot / ROM bootloader variants, ADC resolution and channel count, CNN accelerator details. MAX78000FTHR board parts (camera and microphone part numbers, PMIC, SD slot) are only implied by BSP function names. Tried: analog.com (blocked); MSDK has no FTHR board README.
7. **MSPM0L2228 datasheet / TRM / LP user guide items**: max CPU frequency (reference design configures 32 MHz; not confirmed as the maximum), dual-bank flash specifics, presence and size of data flash, ADC resolution, tamper pin count, ROM BSL interfaces and invocation, static write protection semantics, operating voltage, and what debugger the LP-MSPM0L2228 carries on board. Tried: ti.com (blocked).
8. **ESP32 items not in ESP-IDF sources I opened**: "Xtensa LX6" / "LX7" core names (Kconfig only says Xtensa), ESP32-WROOM-32E flash size options, ESP32 datasheet and TRM contents, and the **LimitedResults 2019** research plus Espressif's 2019 advisories (CVE-2019-15894 secure-boot fault injection; CVE-2019-17391 eFuse key readout) and the statement that ESP32 ECO3/V3 fixes them. Search snippets (not opened) describe CVE-2019-15894 as fault injection bypassing Secure Boot digest verification, and LimitedResults extracting Secure Boot and Flash Encryption keys via voltage glitching; candidate pages https://nvd.nist.gov/vuln/detail/CVE-2019-15894 and limitedresults.com were not opened. Note the verified counterpoint: AR2023-005 (EMFI) applies to ESP32 v3.0/v3.1.
9. **Canonical URLs not load-tested** (hosts blocked; listed from prior knowledge or from links inside files I opened, so treat as candidates and check before publishing):
   - ESP-IDF Programming Guide https://docs.espressif.com/projects/esp-idf/en/stable/esp32/
   - ESP32 datasheet https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf ; ESP32 TRM https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf
   - FreeRTOS kernel docs https://www.freertos.org/Documentation/
   - Arm developer docs (Cortex-M4 / Cortex-M0+ generic user guides, ARMv7-M and ARMv6-M architecture reference manuals) https://developer.arm.com/documentation
   - RISC-V specifications https://riscv.org/specifications/
   - OpenOCD docs https://openocd.org/doc/ ; GDB docs https://sourceware.org/gdb/documentation/ (the GitHub mirror `bminor/binutils-gdb` did not resolve)
   - Ghidra https://ghidra-sre.org/ ; Renode docs https://renode.readthedocs.io/ ; PlatformIO docs https://docs.platformio.org/
   - I2C spec NXP UM10204 https://www.nxp.com/docs/en/user-guide/UM10204.pdf
   - Bosch CAN 2.0 specification (no URL confirmed)
   - USB-IF document library https://www.usb.org/documents
   - sigrok https://sigrok.org/wiki/PulseView
   - MSDK User Guide https://analogdevicesinc.github.io/msdk//USERGUIDE/ ; MAX78000 product page https://www.analog.com/en/products/max78000.html
   - TI: https://www.ti.com/product/MSPM0L2228 , https://www.ti.com/tool/LP-MSPM0L2228 , https://www.ti.com/tool/MSPM0-SDK , XDS110 guide https://www.ti.com/lit/sprui94 , UniFlash docs https://software-dl.ti.com/ccs/esd/uniflash/docs/uniflash.html
   - MITRE eCTF https://ectf.mitre.org/ and https://rules.ectf.mitre.org/
