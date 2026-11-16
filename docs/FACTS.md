# Embedded-systems fact sheet (sourced)

Research date: 2026-11-13.

## READ FIRST: access limits that shape this file

- **Round 2 (2026-11-15):** MITRE rules, TI and Espressif primary sources were opened; see "Round 2 verification (primary sources)" near the end, including "Corrections to round 1". Where round 2 contradicts sections 1-4, round 2 wins. The bullets below describe round 1 only.

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

### Load-tested in round 2
See section R2.5 below for what loads, what the server refused, and what is still untested (UNVERIFIED item 7).

---

## Round 2 verification (primary sources)

Date: 2026-11-15. Method: pages and PDFs were downloaded with `curl` through the session proxy and read as text (`pdftotext` for PDFs; for the eCTF rules site the Sphinx page sources under `https://rules.ectf.mitre.org/_sources/<page>.rst.txt`, which are the same text as the rendered pages). Only what was read on the page is recorded. Section/page numbers are those printed in the document.

**Host status this round:** reachable: `rules.ectf.mitre.org`, `docs.espressif.com`, `www.espressif.com`, `documentation.espressif.com` (PDFs on www.espressif.com redirect there), `www.ti.com`, GitHub. **Refused:** `ectf.mitre.org` (HTTP 403 "Forbidden" from the server) and `www.analog.com` (connection opens, server returns an empty reply / HTTP/2 INTERNAL_ERROR for every URL tried, product page and PDFs alike). Both were dropped after two attempts. Consequently **no Analog Devices datasheet was read**; MAX78000 items below come from MITRE's pages and ADI's MSDK sources on GitHub only.

### R2.1 MITRE eCTF (rules.ectf.mitre.org)

The site hosts three years: 2026 (current), and 2024 and 2025 marked "ARCHIVED PAST COMPETITION, FOR REFERENCE ONLY". No earlier year is hosted there. Index: https://rules.ectf.mitre.org/

**2026: Hardware Security Module ("permissioned file storage and transfer system" for the fictional ChipCorp)**
- Board: "This years development platform is the Texas Instruments **MSP-LITO-L2228**." Custom board "designed, manufactured, and donated" by TI; **not commercially available**; the page says the **LP-MSPM0L2228 LaunchPad is "largely interchangeable"** for teams buying extra boards. The downloadable user manual is for the near-identical MSP-LITO-G3507. MCU: MSPM0L2228 (Cortex-M0+, up to 256 KB flash, 32 KB SRAM). Source: https://rules.ectf.mitre.org/2026/getting_started/mspm0l2228.html
- Debug probe: an **external TI XDS110**, wired to the board with **8 female-to-female jumper wires** (match silkscreen labels); it enumerates as a serial device. Same source, "Connecting A Debugger".
- Board-to-board link: UART1, PA9 (RX) / PA8 (TX), crossed TX-RX, shared ground. Same source.
- Bootloader: development boards ship **without** the bootloader. The MITRE **insecure bootloader** (`insecure.out`; a separate `launchpad.out` for LaunchPad boards, which uses S1/PA18 as the button and a blue LED) is flashed with **TI UniFlash**, device "MSPM0L2228", connection "Texas Instruments XDS110 USB Debug Probe", erase setting "Erase MAIN and NONMAIN necessary sectors only". **Update mode:** reset while holding **S2 (PB21)**; LED **D1 (PB14) flashes red**. Firmware is then loaded with the eCTF tools: `uvx ectf hw <PORT> erase`, `uvx ectf hw <PORT> flash ./build/hsm.bin -n hsm`, `uvx ectf hw <PORT> start`. Sources: https://rules.ectf.mitre.org/2026/system/bootloader.html , https://rules.ectf.mitre.org/2026/getting_started/boot_reference.html
- Attack boards carry a keyed **secure bootloader** that loads encrypted `.prot` images, "functions as a CSC and issues INITDONE", can report a cryptographic digest of a stored file, and can be removed by a UniFlash factory reset (irreversible). Source: https://rules.ectf.mitre.org/2026/system/bootloader.html
- OpenOCD: used for **debugging** with `-f interface/xds110.cfg -f target/ti/mspm0.cfg` (GDB on port 3333); needs the latest OpenOCD pre-release. The paragraph describing flashing with OpenOCD is commented out in the page source, so OpenOCD is **not** the documented flashing path. Source: https://rules.ectf.mitre.org/2026/getting_started/openocd.html
- Required host software: Git, Docker, **uv** (the tools run as `uvx ectf ...`). Firmware builds happen in Docker (`docker build -t build-hsm .`; then `docker run ... -e HSM_PIN='1a2b3c' -e PERMISSIONS='1234=R--:4321=RWC' build-hsm`, output `/out/hsm.bin`). Pre-approved languages: C, C++, Rust. Sources: https://rules.ectf.mitre.org/2026/getting_started/machine_setup.html , https://rules.ectf.mitre.org/2026/specs/functional_reqs.html , https://rules.ectf.mitre.org/2026/specs/detailed_specs.html
- Functional requirements (summary): build environment / build deployment (`gen_secrets` produces read-only Global Secrets) / build HSM; then six commands: **List** (PIN), **Read** (PIN + read permission for the file's group), **Write** (PIN + write permission; overwrites the slot; must persist across power loss), **Listen** (no PIN; serves exactly one request from a neighbour HSM), **Interrogate** (PIN; lists neighbour's files for which the local HSM has receive permission), **Receive** (PIN + receive permission; copies name, UUID, group, contents). Source: https://rules.ectf.mitre.org/2026/specs/functional_reqs.html
- Detailed limits: PIN = exactly 6 lowercase hex characters; permission string like `1234=RW-:aabb=RWC`; group ID 16 bits; UUID 16 bytes; name max 32 bytes; contents max 8192 bytes; 8 file slots; at least 32 groups per deployment and 8 per HSM. Timing maxima: wake 1 s, list 500 ms, read/write/receive 3000 ms, interrogate 1000 ms, **any operation with an invalid PIN 5 s**. Flash layout: bootloader 0x0 len 0x6000; APP1 0x6000 len 0x34000; FAT 0x3A000 len 0x400 (8 x 24-byte entries: UUID, length, padding, address); APP2 0x3A400 len **0x5800**; RESERVED 0x3FC00 len 0x400. Source: https://rules.ectf.mitre.org/2026/specs/detailed_specs.html
- **Security requirements (three, named "Security Requirement 1-3"; paraphrased):**
  - SR1: no file action without a validly provisioned HSM holding the matching permission for that file's group (read / write / receive; receive permission also gates interrogate).
  - SR2: no PIN-protected action without prior knowledge of the PIN, and the PIN itself must not leak.
  - SR3: an HSM must only accept (receive) files generated by a valid HSM with write permission for that group, i.e. file integrity/authenticity.
  - Source: https://rules.ectf.mitre.org/2026/specs/security_reqs.html
- Attack-phase flags: Steal Design, Read Update, Read Design, Compromise Machine, Backdoored Design (attacker is an insider Technician with one HSM and its PIN). Source: https://rules.ectf.mitre.org/2026/flags/attack_flags.html

**2025: Satellite TV System (Decoder)**
- Board: "Analog Devices **MAX78000FTHR**"; the page lists Cortex-M4 core, RISC-V core, 512 KB flash, 128 KB SRAM, 16 KB cache, neural network accelerator, camera, audio interface, **DAPLink debugger**. Source: https://rules.ectf.mitre.org/2025/getting_started/max78000_fthr.html
- Bootloader: boards ship without it; `insecure.bin` is dragged onto the DAPLink drive (blue LED flash = success). **Update mode:** reset while holding the "Bootloader Button" or **SW1**; LED blinks blue. Source: https://rules.ectf.mitre.org/2025/system/bootloader.html
- DAPLink firmware is updated by holding **SW5** while re-plugging USB (drive named MAINTENANCE); MITRE supplied a no-reset DAPLink build for macOS. Source: https://rules.ectf.mitre.org/2025/getting_started/daplink.html
- Attack boards: "secure bootloader preinstalled, which disables debug functionality". MITRE's unlock procedure enters the MAX78000 **boot ROM serial interface** by grounding the UART0 RX and SWDCLK pads at power-up, then talks at 115200 baud (CRLF line endings) and runs `unlock.py` with a per-year secrets file; irreversible. Source: https://rules.ectf.mitre.org/2025/system/remove_SBL.html
- OpenOCD: Analog Devices' fork (via the MaximSDK installer); the page says it can also flash without the eCTF bootloader. Source: https://rules.ectf.mitre.org/2025/getting_started/openocd.html
- Build environment: Docker (`docker run ... -e DECODER_ID=0xdeadbeef build-decoder`, output `/out/max78000.bin`); Python package `ectf25_design` (gen_secrets, gen_subscription, Encoder). Functional requirements: List Channels, Update Subscription (persists across power loss; channel 0 is the emergency channel, always decoded, no subscription), Decode Frame. Limits read: throughput requirement "1,000 64B frames per second". Sources: https://rules.ectf.mitre.org/2025/specs/functional_reqs.html , https://rules.ectf.mitre.org/2025/specs/detailed_specs.html
- **Security requirements (three; paraphrased):** SR1 frames must not be decodable without a Decoder holding a valid, currently active subscription for that channel (known plaintext of one frame must not help with others); SR2 a Decoder decodes only genuine frames from the Satellite System it was provisioned for; SR3 a Decoder decodes only frames with strictly increasing timestamps (need not hold across power cycles). Source: https://rules.ectf.mitre.org/2025/specs/security_reqs.html
- Attack flags: Expired Subscription, Pirated Subscription, No Subscription, Recording Playback, Pesky Neighbor. Source: https://rules.ectf.mitre.org/2025/flags/attack_flags.html

**2024: MISC, protecting a "Medical Device" from supply-chain attacks**
- Hardware: one Application Processor and two Components, "each ... an Analog Device **MAX78000FTHR** development board", joined over a shared I2C bus by the custom **eCTF Breakout Board** (3 Feather sockets, a Bootloader Button, pin headers). Teams received 3 un-keyed development boards, 3 keyed attack boards, the breakout board and a USB hub. Sources: https://rules.ectf.mitre.org/2024/specs/system_architecture.html , https://rules.ectf.mitre.org/2024/getting_started/ectf_breakout.html , https://rules.ectf.mitre.org/2024/getting_started/max78000_fthr.html
- Bootloader: same procedure as 2025 (`insecure.bin` onto the DAPLink drive; update mode by holding the breakout board's Bootloader Button or SW1 at reset; LED blinks blue). Source: https://rules.ectf.mitre.org/2024/components/bootloader.html
- Build environment: **Nix** (`nix-shell` with `shell.nix`), Poetry host tools. Functional requirements: List Components (unauthenticated), Attest (needs Attestation PIN), Replace (needs Replacement Token and an authentic new Component), Boot (integrity check first, then boot message and hand-off), post-boot Secure Send & Receive. Limits: wake 1 s, attest/list/boot 3 s, replace 5 s; token 16 bytes, PIN 6 bytes, Component ID 4 bytes (last byte a valid I2C address). Sources: https://rules.ectf.mitre.org/2024/specs/functional_reqs.html , https://rules.ectf.mitre.org/2024/specs/detailed_specs.html
- **Security requirements (five; paraphrased):** SR1 the AP boots only if every expected Component is present and valid; SR2 Components boot only when commanded by a valid AP that has confirmed integrity; SR3 the Attestation PIN and Replacement Token stay confidential; SR4 Component Attestation Data stays confidential; SR5 integrity and authenticity (confidentiality not required) of post-boot secure messages. Source: https://rules.ectf.mitre.org/2024/specs/security_reqs.html
- Attack flags read: Operational Pin Extract, Operational Pump Swap, Damaged Boot, Supply Chain Boot, Supply Chain Extract, Black Box Boot, Black Box Extract. Source: https://rules.ectf.mitre.org/2024/flags/attack_flags.html

### R2.2 TI MSPM0L2228

Documents: datasheet **SLASF94A** "MSPM0L222x, MSPM0L122x Mixed-Signal Microcontrollers" (May 2024, revised October 2024), https://www.ti.com/lit/ds/symlink/mspm0l2228.pdf ; TRM **SLAU847F** "MSPM0 L-Series 32MHz Microcontrollers Technical Reference Manual" (revised March 2026), https://www.ti.com/lit/pdf/slau847 ; product page https://www.ti.com/product/MSPM0L2228 ; LaunchPad page https://www.ti.com/tool/LP-MSPM0L2228 .

- CPU: Cortex-M0+ with MPU, **"frequency up to 32MHz"**; supply 1.62 V to 3.6 V; PSA-L1 certified. (SLASF94A section 1 Features, p.1; product page "Frequency (MHz) 32".)
- Flash: "Up to 256KB of flash memory with ECC", **dual-bank with address swap**; L2228 = 256 KB. Table 8-4 (p.73): Bank 0 `0x0000.0000-0x0001.FFFF`, Bank 1 `0x0002.0000-0x0003.FFFF` (128 KB each), plus ECC-uncorrected aliases at `0x0040.0000`/`0x0042.0000` and ECC code at `0x0080.0000`/`0x0082.0000`. Sector size 1 KB; 100 000 program/erase cycles on the lower 32 KB, 10 000 on the rest (section 8.10, p.76).
- SRAM: 32 KB "with ECC or parity". Table 8-4 (p.73) maps the same 32 KB at **four aliases**: ECC-checked `0x2000.0000-0x2000.7FFF`, parity-checked `0x2010.0000-0x2010.7FFF`, **un-checked `0x2020.0000-0x2020.7FFF`**, ECC/parity code `0x2030.0000-0x2030.7FFF`. SRAM has a write-execute mutual-exclusion partition (section 8.11, p.77).
- NONMAIN configuration memory `0x41C0.0000-0x41C0.03FF` (1 KB), FACTORY `0x41C4.0000-0x41C4.01FF` (Table 8-4, p.74).
- Data flash: Table 8-4 lists **no DATA region** for these parts; the TRM says "Not all devices support a DATA bank. Refer to the device-specific data sheet" (SLAU847F section 4.4.5). So no data-flash bank is documented for the L2228.
- Security (SLASF94A section 8.4, pp.70-71): debug security, device identity, crypto acceleration, TRNG, flash write-erase / read-execute / IP protection, SRAM write-execute mutual exclusion, secure boot, secure firmware update, secure key storage, customer secure code.
  - **AESADV** (section 8.20, p.80): 128-bit blocks with **128-bit or 256-bit keys** (no 192); feature list p.1: GCM/GMAC, CCM/CBC-MAC, CBC, CTR.
  - **Keystore** (section 8.21, p.80; p.1): "Secure Key Storage for up to four AES keys"; 128- and 256-bit keys; intended to be loaded during customer secure code so the AES engine uses keys without exposing them.
  - **TRNG** (section 8.19): 32-bit outputs, intended as an entropy source for a DRNG.
  - **Tamper / LFSS** (LFSS description, p.78; Table 6-16): VBAT-powered LFSS with RTC, tamper I/O with timestamp, independent watchdog, 32-byte scratchpad memory; **up to three tamper inputs TIO0-TIO2** (package dependent).
  - ADC: 12-bit, 1.68 Msps, up to 26 external channels (p.1).
- **Debug lock via NONMAIN** (SLAU847F section 1.4.2.1, Table 1-4): three SWD security levels: 0 no restrictions (factory default), 1 custom (app debug, mass erase and factory reset each enabled / password / disabled; TI failure analysis on/off), 2 SW-DP fully disabled. SWD mass-erase and factory-reset passwords are 128-bit (section 1.4.2.2). Critical fields use 16-bit pattern matching so a single bit flip falls to the most secure state (section 1.4.1.2).
- **BSL** (SLASF94A section 8.34, p.88; SLAU847F section 1.4.3): ROM bootstrap loader over **UART or I2C**, always protected by a **256-bit password**, can be disabled in NONMAIN, enabled by default; invoked by the BSL_invoke pin at boot, automatically on a blank device, or from software.
- **Static write protection** (SLAU847F section 1.4.2.3): per-sector for the first 32 sectors of MAIN and per 8 sectors after that (NONMAIN fields FLASHSWP0/1); NONMAIN itself can be locked. Application code and the BSL cannot modify protected sectors, but an SWD mass erase / factory reset **overrides** it unless those commands are password-protected or disabled.
- **CSC** (SLAU847F section 4.1.2 and BOOTCFG fields): NONMAIN declares whether Customer Secure Code exists; the CSC ends by writing `SYSCTL.SECCFG.INITDONE`, after which its protections take effect; debug access can be held until INITDONE.
- BCR (SLAU847F section 1.4.2): first code after BOOTRST; applies debug policy, optional mass erase / factory reset, static write protection, optional **32-bit CRC** check of application flash, optional BSL start.
- LaunchPad: LP-MSPM0L2228 has an **on-board XDS110 debug probe** with back-channel UART over USB (LP product page "Features"; SLASF94A section 10.3).

### R2.3 MAX78000 / MAX78000FTHR

analog.com refused every request, so the MAX78000 datasheet, the MAX78000FTHR data sheet and the user guide were **not read**. Verified this round from other primary sources:
- MITRE's 2024 and 2025 pages name the board **MAX78000FTHR** and list: Cortex-M4 core, RISC-V core, 512 KB flash, 128 KB SRAM, 16 KB cache, CNN accelerator, camera, audio interface, DAPLink debugger. Source: https://rules.ectf.mitre.org/2025/getting_started/max78000_fthr.html
- AES key sizes selectable in ADI's driver: **128, 192 and 256 bits** (`mxc_aes_keys_t`). Source: https://github.com/analogdevicesinc/msdk/blob/main/Libraries/PeriphDrivers/Include/MAX78000/aes.h
- ADC inputs in ADI's driver: external AIN0-AIN3, plus AIN0/5, AIN1/5, VDDB/4 and VDD18 internal selections. Resolution not stated there. Source: https://github.com/analogdevicesinc/msdk/blob/main/Libraries/PeriphDrivers/Include/MAX78000/adc.h
- FTHR board support package builds drivers for: **OV7692** camera (`-DCAMERA_OV7692`), **MAX20303** PMIC (controls camera, microphone and SD power), **MAX9867** audio codec, N01S830HA serial SRAM. The microphone part number is not named. Sources: https://github.com/analogdevicesinc/msdk/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/board.mk , https://github.com/analogdevicesinc/msdk/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Source/board.c
- A serial boot ROM interface exists and is entered by holding UART0 RX and SWDCLK low at power-up (MITRE procedure, see R2.1 2025).

### R2.4 Espressif

- **Core names:** ESP32 = "single-/dual-core 32-bit **LX6** microprocessor(s)" (ESP32 Series Datasheet v5.3, Product Overview and Features); TRM v5.9 chapter "System and Memory": "two Harvard Architecture Xtensa LX6 CPUs". ESP32-S3 = "Xtensa 32-bit **LX7** dual-core microprocessor" (ESP32-S3 Series Datasheet v2.2, p.1-2). Sources: https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf , https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_manual_en.pdf , https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf
- **ESP32-WROOM-32E flash:** "4/8/16 MB flash available"; ordering codes N4/N8/N16, H4/H8 (105 C), N4R2/N8R2/N16R2 (with 2 MB PSRAM); chip inside is ESP32-D0WD-V3 or ESP32-D0WDR2-V3. Source: ESP32-WROOM-32E / 32UE Datasheet v2.1, section 1 and Table 1, https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32e_esp32-wroom-32ue_datasheet_en.pdf
- **GPIO electrical (ESP32 datasheet v5.3, section 5, pp.51-52):**
  - Table 5-1 Absolute Maximum Ratings: allowed input voltage on the supply pins -0.3 V to **3.6 V**; cumulative IO output current 1200 mA.
  - Table 5-3 DC Characteristics (3.3 V, 25 C): **VIH min 0.75 x VDD, max VDD + 0.3 V; VIL min -0.3 V, max 0.25 x VDD**; VOH min 0.8 x VDD; VOL max 0.1 x VDD; **IOH typ 40 mA** (VDD3P3_CPU and VDD3P3_RTC domains; 20 mA for VDD_SDIO) and **IOL typ 28 mA**, both "output drive strength set to the maximum"; internal pull-up / pull-down typ 45 kOhm.
  - The datasheet contains **no 5 V tolerance statement**; the only limit given is VIH max = VDD + 0.3 V. It also gives **no "recommended maximum" per-pin current** below the typ figures above (the commonly quoted 12 mA / 20 mA numbers are not in this document).
- **ADC (ESP32 datasheet v5.3, section 4.9.1, pp.43-44):** two 12-bit SAR ADCs, 18 channels. Table 4-4 effective measurement ranges after calibration: atten 0: 100-950 mV; atten 1: 100-1250 mV; atten 2: 150-1750 mV; atten 3: 150-2450 mV. Default chip-to-chip spread +-6 %. **Reference:** "By design, the ADC reference voltage for ESP32 is 1100 mV", true value varies per chip (ESP-IDF v6.1 `docs/en/api-reference/peripherals/adc/adc_calibration.rst`, read in the local checkout; https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/adc/adc_calibration.rst).
- **Fault-injection advisories:**
  - **CVE-2019-15894** "Espressif Security Advisory Concerning Fault Injection and Secure Boot": fault injection can bypass the Secure Boot digest check at startup and boot unverified flash code; reported by Riscure and independently by LimitedResults; mitigation was software that permanently enables flash encryption (ESP-IDF 3.0.9 / 3.1.6 / 3.2.3 / 3.3.1 and v4.0+); says a revision with updated ROM is coming. https://www.espressif.com/en/news/Espressif_Security_Advisory_Concerning_Fault_Injection_and_Secure_Boot
  - **CVE-2019-17391** "fault injection and eFuse protections": faulting just after reset can defeat eFuse read protection and expose the Flash Encryption and Secure Boot keys; reported by LimitedResults; affected: "ESP32-D0WD, ESP32-D2WD, ESP32-S0WD, ESP32-PICO-D4, and related modules"; "no software mitigation" for deployed parts; **ESP32-D0WD-V3** "has checks in ROM which prevent this attack" and adds Secure Boot V2. https://www.espressif.com/en/news/Security_Advisory_Concerning_Fault_Injection_and_eFuse_Protections
  - **AR2020-001** (2020-07-20) "fault injection and ESP32 Flash Encryption & Secure Boot V1": listed as similar to the two CVEs above; "revision 0 and revision 1 of the ESP32 silicon". Only the index entry was read. https://www.espressif.com/en/support/documents/advisories
  - **AR2023-005 / CVE-2023-35818** (2023-07-11, V1.0, 3 pages): EMFI on ESP32 chip revision v3.0 lets an attacker steer the PC into ROM UART download mode even with Secure Boot V2 and Flash Encryption in release mode; "applicable to ESP32 Chip Revision v3.0 and v3.1"; earlier revisions "were already vulnerable"; "no immediate mitigation"; ESP32-S2, ESP32-C3, ESP32-S3 have ROM countermeasures; reported by Raelize and TII. PDF: https://www.espressif.com/sites/default/files/advisory_downloads/AR2023-005%20Security%20Advisory%20Concerning%20Bypassing%20Secure%20Boot%20and%20Flash%20Encryption%20Using%20EMFI%20EN.pdf
  - The advisories index also lists (titles only read): AR2022-003 "Breaking the Hardware AES Core and Firmware Encryption of ESP32 Chip Revision v3.0"; AR2023-007 CPA + FI on ESP32-C3 and ESP32-C6; AR2026-005 AES key recovery by voltage fault injection on ESP32-S3.
- **Docs pages load** (ESP-IDF Programming Guide, "stable" currently renders as **v6.1.1**): https://docs.espressif.com/projects/esp-idf/en/stable/esp32/ ; Secure Boot v2 https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/secure-boot-v2.html (mentions RSA-PSS, RSA-3072, chip revision v3.0, consistent with section 4); Flash Encryption https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/flash-encryption.html (AES-256 for ESP32); https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/vulnerabilities.html .

### R2.5 URL load test (HTTP status via curl, 2026-11-15)

- **Load (200):** https://rules.ectf.mitre.org/ ; https://rules.ectf.mitre.org/2025/getting_started/boot_reference ; https://docs.espressif.com/projects/esp-idf/en/stable/esp32/ ; ESP32 datasheet and TRM URLs (redirect to documentation.espressif.com) ; https://www.ti.com/product/MSPM0L2228 ; https://www.ti.com/tool/LP-MSPM0L2228 ; https://www.ti.com/tool/MSPM0-SDK ; https://www.ti.com/lit/sprui94 (XDS110 guide PDF) ; https://www.ti.com/tool/UNIFLASH .
- **Refused by the server:** https://ectf.mitre.org/ (403) ; https://www.analog.com/en/products/max78000.html (empty reply).
- **Still untested (host not reachable from this session):** freertos.org, developer.arm.com, riscv.org, openocd.org, sourceware.org, ghidra-sre.org, renode.readthedocs.io, docs.platformio.org, nxp.com, usb.org, sigrok.org, analogdevicesinc.github.io, software-dl.ti.com, ectfmitre.gitlab.io, nvd.nist.gov.

### Corrections to round 1

1. **2026 board.** Round 1 assumed the LP-MSPM0L2228 LaunchPad (section 3 "Evaluation board name"). The 2026 competition board is the custom **MSP-LITO-L2228**; the LaunchPad is only described as "largely interchangeable". The probe is an **external** XDS110 on jumper wires, not an on-board one (the LaunchPad does have one on board).
2. **MSPM0L2228 SRAM address.** Round 1 wrote "SRAM origin 0x20200000 (NOT 0x20000000)". The datasheet maps the same 32 KB at 0x2000.0000 (ECC-checked), 0x2010.0000 (parity-checked) and 0x2020.0000 (un-checked). TI's linker file and the eCTF design use the un-checked alias 0x20200000; 0x20000000 is also valid SRAM on this chip. Saying code using 0x20000000 "is wrong on this chip" is incorrect.
3. **2026 flash layout.** Round 1 (from `firmware.ld`) gave APP2 as `0x3A400` len `0x5C00`. The rules give APP2 len **0x5800** and a bootloader-reserved page at `0x3FC00` len `0x400`. The rules are the specification.
4. **2026 flashing.** Round 1 left "whether OpenOCD is the official flashing path" open and section 3 could be read as implying it. The documented path is UniFlash (bootloader) then `uvx ectf hw ... flash`; OpenOCD is documented for debugging only.
5. **2024/2025 bootloader entry.** Round 1 said only "device must be in update mode". The entry method is: hold SW1 (or the breakout board's Bootloader Button) during reset.
6. **Search-engine summaries in the old UNVERIFIED item 1** were accurate for 2025 SR1-SR3 and for the 2026 PIN / permission / 5 s facts; they are now replaced by the verified text above.
7. **ESP-IDF stable.** Round 1 reported v6.1 as latest with a v6.1.1 tag existing; docs.espressif.com "stable" now renders v6.1.1.

---

## UNVERIFIED

Updated 2026-11-15 after round 2. Items verified in round 2 were removed (old items 1, 2, 4 for 2024-2026, 7, most of 8).

1. **MAX78000 datasheet items** (analog.com refused: empty reply / HTTP/2 INTERNAL_ERROR on the product page and on `/media/en/technical-documentation/data-sheets/MAX78000.pdf`, `MAX78000FTHR.pdf`, `user-guides/max78000-user-guide.pdf`; tried HTTP/2 and HTTP/1.1): maximum core frequencies as datasheet specs (only the 100 MHz IPO / 60 MHz ISO oscillator constants are verified), RISC-V core designation (RV32 variant), TRNG details, secure boot / ROM bootloader variants (only the existence of a serial boot ROM is verified, via MITRE), ADC resolution, CNN accelerator details, FTHR microphone part number, datasheet document numbers and pages.
2. **MITRE bootloader internals** (2024/2025/2026): what the secure bootloader verifies and how images are protected is not published; only its externally visible behaviour is verified.
3. **eCTF 2017-2023 rules/docs sites and official theme names** ("MES" expansion for 2019, 2017/2018 names): rules.ectf.mitre.org hosts only 2024-2026; `ectf.mitre.org` returned 403; `ectfmitre.gitlab.io` unreachable.
4. **MSP-LITO-L2228 board details** (schematic, on-board parts): schematics are "on Zulip"; the linked user manual is for the MSP-LITO-G3507 and was not read.
5. **MSPM0L2228 remaining:** exact BCR boot sequence timing and the full NONMAIN register layout were not transcribed; TI's errata sheet was not read.
6. **ESP32 remaining:** the LimitedResults write-ups themselves (limitedresults.com not reachable); NVD entries (nvd.nist.gov not reachable); AR2020-001 and AR2022-003 PDFs (index entries only); per-strapping-pin functions were not re-read this round; the widely quoted "12 mA recommended / 40 mA absolute max per pin" figures do not appear in datasheet v5.3 and remain unsourced.
7. **Canonical URLs still not load-tested** (hosts not reachable): https://www.freertos.org/Documentation/ ; https://developer.arm.com/documentation ; https://riscv.org/specifications/ ; https://openocd.org/doc/ ; https://sourceware.org/gdb/documentation/ ; https://ghidra-sre.org/ ; https://renode.readthedocs.io/ ; https://docs.platformio.org/ ; https://www.nxp.com/docs/en/user-guide/UM10204.pdf ; https://www.usb.org/documents ; https://sigrok.org/wiki/PulseView ; https://analogdevicesinc.github.io/msdk//USERGUIDE/ ; https://software-dl.ti.com/ccs/esd/uniflash/docs/uniflash.html ; https://ectfmitre.gitlab.io/ectf-website/2024/components/bootloader.html . Bosch CAN 2.0 specification: no URL confirmed. Refused by server: https://ectf.mitre.org/ , https://www.analog.com/en/products/max78000.html .

## Sources read during the content review that are cited in lessons but not itemised above
During the review of the eCTF hardware lessons, the following primary sources were read directly and are cited in
`js/content/ectf/platforms/`. Their details are stated in those lessons with the citation, not repeated here:
TI SLAU847F §1.3.2 (rules for the three SRAM views: do not mix views, initialise before a checked read); the 2026
reference design's `firmware.ld` and `ti_msp_dl_config.c`; the OpenOCD commands on the 2025 and 2026 MITRE rules
pages; Analog Devices MSDK `gpio.h` and `uart.h` (main branch, not the tags pinned by the 2024/2025 designs); and
the ESP-IDF v6.1 source tree, which was cloned and built (see `tools/idf-check/RESULTS.md`).
