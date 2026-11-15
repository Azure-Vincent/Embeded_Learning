// Foundations, lessons 4-6: toolchains and build systems, supporting tools, measuring before guessing.
// "host-tested" blocks were built and run with gcc 13.3 / GNU Make 4.3 / CMake 3.28 + Ninja on Ubuntu 24.04.
// The pyserial script was run against a pseudo-terminal (Python's pty module), not against a board.
// Nothing here was run on physical hardware.

const BLINK_H = String.raw`#ifndef BLINK_MATH_H
#define BLINK_MATH_H
#include <stdint.h>

/* Half-period of a blink, in timer ticks, for a given blink frequency. */
uint32_t half_period_ticks(uint32_t tick_hz, uint32_t blink_hz);

#endif`;

const BLINK_C = String.raw`#include "blink_math.h"

uint32_t half_period_ticks(uint32_t tick_hz, uint32_t blink_hz)
{
    if (blink_hz == 0) {
        return 0;               /* caller treats 0 as "LED stays off" */
    }
    return tick_hz / (2u * blink_hz);
}`;

const MAIN_C = String.raw`#include <stdio.h>
#include <inttypes.h>
#include "blink_math.h"

int main(void)
{
    uint32_t ticks = half_period_ticks(1000u, 2u);
    printf("half period = %" PRIu32 " ticks\n", ticks);
    return ticks == 250u ? 0 : 1;
}`;

const MAKEFILE = 'CC      := gcc\nCFLAGS  := -Wall -Wextra -std=c11 -O1\nOBJS    := main.o blink_math.o\n\nblink_demo: $(OBJS)\n\t$(CC) $(CFLAGS) -o $@ $^\n\n%.o: %.c blink_math.h\n\t$(CC) $(CFLAGS) -c -o $@ $<\n\n.PHONY: clean\nclean:\n\trm -f blink_demo $(OBJS)';

const CMAKELISTS = String.raw`cmake_minimum_required(VERSION 3.16)
project(blink_demo C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_executable(blink_demo main.c blink_math.c)
target_compile_options(blink_demo PRIVATE -Wall -Wextra)`;

// C lab for the toolchains lesson: the lesson's own function, with a host-side harness that reads its inputs
// from standard input so that every test exercises the function with different numbers.
const HP_HARNESS = String.raw`
/* ---- host-side test harness: do not edit below this line ---- */

/* Read one unsigned decimal number from standard input. */
static uint32_t read_u32(void)
{
    int c = getchar();
    while (c == ' ' || c == '\n') c = getchar();
    uint32_t v = 0;
    while (c >= '0' && c <= '9') {
        v = v * 10u + (uint32_t)(c - '0');
        c = getchar();
    }
    return v;
}

int main(void)
{
    uint32_t tick_hz  = read_u32();
    uint32_t blink_hz = read_u32();
    uint32_t expected = read_u32();
    uint32_t got = half_period_ticks(tick_hz, blink_hz);
    printf("half_period_ticks(%u, %u) = %u\n", tick_hz, blink_hz, got);
    return got == expected ? 0 : 1;
}`;

const HP_STARTER = String.raw`#include <stdint.h>
#include <stdio.h>

/* Half-period of a blink, in timer ticks, for a given blink frequency.
   One blink period is 1 / blink_hz seconds; the LED is on for half of it.
   A result of 0 means "LED stays off". */
uint32_t half_period_ticks(uint32_t tick_hz, uint32_t blink_hz)
{
    return tick_hz / 2u * blink_hz;      /* a teammate's version: two faults */
}
` + HP_HARNESS;

const HP_SOLUTION = String.raw`#include <stdint.h>
#include <stdio.h>

uint32_t half_period_ticks(uint32_t tick_hz, uint32_t blink_hz)
{
    if (blink_hz == 0) {
        return 0;                        /* defined result instead of a division by zero */
    }
    return tick_hz / (2u * blink_hz);    /* parentheses: divide by the whole product */
}
` + HP_HARNESS;

const READ_PORT = String.raw`#!/usr/bin/env python3
"""Print lines arriving on a serial port, with a timestamp on each."""
import sys
import time

import serial  # provided by the "pyserial" package


def main() -> int:
    port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
    baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200
    start = time.monotonic()
    with serial.Serial(port, baud, timeout=1) as ser:
        while True:
            raw = ser.readline()          # returns b"" if 1 s passes with no newline
            if not raw:
                continue
            text = raw.decode("utf-8", errors="replace").rstrip()
            print(f"[{time.monotonic() - start:8.3f}] {text}", flush=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)`;

const toolchains = {
  id: 'fnd-toolchains',
  title: 'Toolchains and build systems',
  minutes: 60,
  summary: 'What a cross-compiler is, how to read a Makefile and a CMakeLists.txt, how to install ESP-IDF on Ubuntu, and when PlatformIO is the better choice.',
  skills: ['fnd-toolchain', 'fnd-idf-install'],
  blocks: [
    `## The problem

On your laptop, \`gcc main.c -o main\` produces a file you can run. Copy that file to an ESP32 and nothing can
happen: the file contains x86-64 machine instructions for a CPU the ESP32 does not have, it expects Linux to load it
into memory and to provide \`printf\`, and the ESP32 has neither Linux nor a file system to copy it to.

So how does a C file on your laptop become something a microcontroller executes from its first instruction after
reset? Four things have to be different: the instructions, the libraries, where the code is placed in memory, and
how the result gets onto the chip. A **toolchain** supplies the first three and a **build system** drives it. When a
build fails, the error always comes from one specific stage, and knowing the stages tells you where to look.`,

    `## From source to a flashable image

| Stage | Tool | Input → output | What goes wrong here |
|---|---|---|---|
| Preprocess | \`cpp\` (run by the compiler) | \`.c\` + headers → one expanded source text | "No such file or directory" for a header: an include path is missing |
| Compile | compiler | expanded source → assembly for the *target* CPU | Syntax and type errors, warnings |
| Assemble | assembler | assembly → object file (\`.o\`), machine code with unresolved addresses | Rare in C projects |
| Link | linker, guided by a **linker script** | all \`.o\` files + libraries → one [[ELF]] file with every address fixed | "undefined reference to …": a function was declared but no object file or library defines it. "region FLASH overflowed": the program does not fit |
| Convert | \`objcopy\` or a vendor tool | ELF → raw binary or vendor image (\`.bin\`, \`.hex\`) | Wrong image format or offset for the bootloader |
| Flash | flashing tool | image → the chip's flash memory, over a serial bootloader or a debug probe | Connection and permission problems |

Two points matter for everything later in the course.

**The linker script decides where things live.** On a PC the operating system chooses addresses when it loads a
program. A microcontroller has fixed memories at fixed addresses: on a MAX78000, for example, flash starts at
\`0x10000000\` and RAM at \`0x20000000\`. The linker script lists those regions and assigns code to flash and
variables to RAM. You will read real linker scripts in the MCU architecture and eCTF sections.

**The ELF file is for you; the binary is for the chip.** The ELF keeps symbol names, section tables and debug
information. The debugger and the disassembler read it. The \`.bin\` is only the bytes that go into flash.`,

    `## Cross-compilers

A **[[Cross-compiler]]** runs on one kind of machine (the *host*, your laptop) and produces code for another (the
*target*). Its name usually states the target as a *triple*: architecture, vendor or OS, and ABI.

| Toolchain | Compiler command | Target | Where you meet it |
|---|---|---|---|
| Native GCC | \`gcc\` | Your own PC | Host-side unit tests, tools, the examples in this lesson |
| GNU Arm Embedded | \`arm-none-eabi-gcc\` | Arm Cortex-M and other 32-bit Arm, no operating system (\`none\`), embedded ABI (\`eabi\`) | Most Cortex-M projects; the eCTF 2024 and 2025 reference builds (MAX78000, through the Analog Devices MSDK) |
| Espressif Xtensa GCC | \`xtensa-esp32-elf-gcc\` and siblings | Xtensa-based ESP chips: ESP32, ESP32-S3 | Installed and selected for you by ESP-IDF |
| Espressif RISC-V GCC | \`riscv32-esp-elf-gcc\` | RISC-V-based ESP chips: ESP32-C3, ESP32-C6 | Installed and selected for you by ESP-IDF |
| TI Arm Clang | \`tiarmclang\` | Arm Cortex-M; an LLVM/Clang-based compiler from TI | The eCTF 2026 reference build (MSPM0L2228) |

The eCTF 2026 line deserves attention if you come from GCC. That reference design is built with TI Arm Clang
(\`ti-cgt-armllvm\`), not \`arm-none-eabi-gcc\`. Most of your C is unaffected, but compiler flags, linker script
syntax, some attributes and the supporting utilities (\`tiarmobjcopy\` instead of \`arm-none-eabi-objcopy\`) differ.
Do not assume a flag you know from GCC means the same thing; check the compiler's own documentation.

The same family of tools comes with each compiler, with the same prefix: \`arm-none-eabi-objdump\` (disassemble),
\`-size\` (how big is each section), \`-nm\` (list symbols), \`-gdb\` (debugger). On Ubuntu the multi-architecture
debugger is packaged as \`gdb-multiarch\`.`,

    { t: 'callout', kind: 'note', title: 'How to find out which compiler a build really used', md: `Do not guess from the documentation. CMake-based projects, including ESP-IDF, can write a file named \`compile_commands.json\` into the build directory. It contains the exact compiler command line for every source file. Open it and read the first entry: the compiler's full path, every \`-I\` include path and every \`-D\` definition are there. For a Makefile project, \`make V=1\` or \`make -n\` usually prints the commands.` },

    `## Make: rebuild only what changed

A project has many source files, and recompiling all of them after every edit wastes time. **Make** solves one
problem: given which files depend on which, and the commands to produce them, run only the commands whose inputs are
newer than their outputs.

A Makefile is a list of **rules**:

\`\`\`text
target: prerequisites
<TAB>command that builds target from prerequisites
\`\`\`

Here is a complete small project. The function computes how many timer ticks an LED should stay on or off; it is
the kind of pure logic you can and should test on your PC before it goes near a board.`,

    { t: 'code', lang: 'c', status: 'host-tested', caption: 'blink_math.h', code: BLINK_H },
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'blink_math.c', code: BLINK_C, explain: [
      { lines: '5-7', md: `Division by zero is undefined behaviour in C. On a Cortex-M0+ with no divide instruction it would call a library routine; on other cores it may raise a fault. The guard makes the behaviour defined on every target.` },
      { lines: '8', md: `Integer division truncates. The \`u\` suffix keeps the arithmetic unsigned so the result does not depend on the width of \`int\` on the target.` },
    ] },
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'main.c — a host-side check. The exit status is 0 only if the result is right.', code: MAIN_C },
    { t: 'code', lang: 'makefile', status: 'host-tested', caption: 'Makefile. The indented lines must start with a TAB character, not spaces.', code: MAKEFILE, explain: [
      { lines: '1-3', md: `Variables. \`:=\` assigns immediately. \`CC\` is the conventional name for the C compiler: change this one line to \`arm-none-eabi-gcc\` (and add target flags) and the same rules cross-compile. That substitution is the heart of every embedded Makefile.` },
      { lines: '5-6', md: `The first rule is the default goal. It says: \`blink_demo\` depends on the two object files; to make it, run the compiler as a **linker**. \`$@\` expands to the target name (\`blink_demo\`) and \`$^\` to all prerequisites (\`main.o blink_math.o\`).` },
      { lines: '8-9', md: `A **pattern rule**: any \`something.o\` is built from \`something.c\`, and also depends on \`blink_math.h\`. \`-c\` means compile only, do not link. \`$<\` is the first prerequisite (the \`.c\` file). Listing the header as a prerequisite is what makes Make recompile when the header changes.` },
      { lines: '11-13', md: `\`clean\` is not a file, so it is declared \`.PHONY\`; otherwise a file that happened to be called \`clean\` would stop the rule from ever running.` },
    ] },
    { t: 'code', lang: 'bash', status: 'host-tested', caption: 'What you should see. The second make does nothing; after editing only main.c, only main.o is recompiled.', code: `$ make
gcc -Wall -Wextra -std=c11 -O1 -c -o main.o main.c
gcc -Wall -Wextra -std=c11 -O1 -c -o blink_math.o blink_math.c
gcc -Wall -Wextra -std=c11 -O1 -o blink_demo main.o blink_math.o
$ ./blink_demo
half period = 250 ticks
$ make
make: 'blink_demo' is up to date.
$ touch main.c && make
gcc -Wall -Wextra -std=c11 -O1 -c -o main.o main.c
gcc -Wall -Wextra -std=c11 -O1 -o blink_demo main.o blink_math.o` },

    { t: 'callout', kind: 'mistake', title: '"Missing separator" and stale builds', md: `Two classic Makefile faults. **\`Makefile:6: *** missing separator. Stop.\`** means a command line starts with spaces instead of a TAB, usually because an editor converted it. **A change that has no effect** usually means a dependency is not listed: if the pattern rule did not name \`blink_math.h\`, editing the header would rebuild nothing and you would be testing old code. When behaviour does not match the source, run \`make clean\` and rebuild before you believe anything else. Real projects have the compiler generate header dependencies automatically (\`-MMD\`).` },

    { t: 'predict', q: `With the Makefile above and everything already built, you edit only \`blink_math.h\` (say, you fix the comment). You run \`make\`. How many compiler commands run?`, choices: [
      { t: 'None. Only a comment changed, so the output would be identical.', why: `Make does not read file contents. It compares modification times, and the header is now newer than the objects that depend on it.` },
      { t: 'One: only blink_math.o, because the header belongs to blink_math.c.', why: `Check the pattern rule: which object files does it say depend on the header? Remember that \`main.c\` includes it too.` },
      { t: 'Three: both object files are recompiled, then the program is relinked.', ok: true, why: `The pattern rule makes every \`.o\` depend on \`blink_math.h\`, and the executable depends on both objects.` },
    ], reveal: `Make works purely from timestamps and the dependency graph. The header is a prerequisite of both objects, so both are out of date; once they are rebuilt they are newer than \`blink_demo\`, so it is relinked. This was checked on the host: \`touch blink_math.h && make\` runs exactly three commands. It is also why changing a widely included header in a large firmware project triggers a long rebuild.` },

    `## CMake: describe the project, generate the build

Make needs you to write the rules. **CMake** sits one level up: you describe *what* the project is (these sources
make this executable, with these options), and CMake **generates** the build files for an underlying tool, usually
Ninja or Make. ESP-IDF, Zephyr and many vendor SDKs are built on CMake, so you need to be able to read a
\`CMakeLists.txt\`.

The same project as above:`,

    { t: 'code', lang: 'cmake', status: 'host-tested', caption: 'CMakeLists.txt', code: CMAKELISTS, explain: [
      { lines: '1', md: `The oldest CMake version this file is written for. It also selects that version's default behaviours ("policies").` },
      { lines: '2', md: `Names the project and says it contains C. This is the point where CMake finds and tests a C compiler. In a cross-build, a **toolchain file** given on the command line tells it to use the cross-compiler instead of the host \`gcc\`.` },
      { lines: '4-5', md: `Request C11 and make it a hard requirement, not a preference.` },
      { lines: '7', md: `A **target**: an executable named \`blink_demo\` built from these two sources. CMake works out header dependencies itself by asking the compiler, so there is no equivalent of the hand-written header prerequisite in the Makefile.` },
      { lines: '8', md: `Options that apply to this target only. \`PRIVATE\` means "when compiling this target, but not passed on to things that link against it".` },
    ] },
    { t: 'code', lang: 'bash', status: 'host-tested', caption: 'Two steps: configure (generate build files), then build.', code: `$ cmake -S . -B build -G Ninja
$ cmake --build build
[1/3] Building C object CMakeFiles/blink_demo.dir/blink_math.c.o
[2/3] Building C object CMakeFiles/blink_demo.dir/main.c.o
[3/3] Linking C executable blink_demo
$ ./build/blink_demo
half period = 250 ticks`, explain: [
      { lines: '1', md: `\`-S\` is the source directory, \`-B\` the build directory, \`-G\` the generator. All generated files go into \`build/\`, which you never commit and can always delete. This is an *out-of-source* build.` },
      { lines: '2', md: `Runs the underlying tool (here Ninja). Use this form and you do not need to remember which generator was chosen.` },
    ] },

    `### Reading an ESP-IDF project

An ESP-IDF project is a CMake project with two short files. \`idf.py\` is a wrapper that runs CMake and Ninja with
the right toolchain file and then the flashing tool.`,

    { t: 'code', lang: 'cmake', status: 'idf-checked', caption: 'The hello_world example in ESP-IDF v6.1: top-level CMakeLists.txt, then main/CMakeLists.txt (comments shortened). Compared line for line with examples/get-started/hello_world in the v6.1 source tree; not built here.', code: String.raw`# hello_world/CMakeLists.txt
cmake_minimum_required(VERSION 3.22)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
# Include the minimal set of components: main and what it depends on.
idf_build_set_property(MINIMAL_BUILD ON)
project(hello_world)

# hello_world/main/CMakeLists.txt
idf_component_register(SRCS "hello_world_main.c"
                       PRIV_REQUIRES spi_flash
                       INCLUDE_DIRS "")`, explain: [
      { lines: '4', md: `Pulls in ESP-IDF's build logic from wherever the environment variable \`IDF_PATH\` points. If the ESP-IDF environment is not active in this terminal, \`IDF_PATH\` is empty and the configure step fails here. That is the cause of most "it built yesterday" problems.` },
      { lines: '6', md: `Asks the build to compile only the components this project actually uses, which shortens the first build.` },
      { lines: '7', md: `Declares the project. ESP-IDF's version of \`project()\` also collects every *component* (ESP-IDF's unit of code: drivers, FreeRTOS, your \`main\`) and sets up the cross-compiler for the selected chip. The three lines must stay in this order.` },
      { lines: '10-12', md: `Registers the \`main\` component: which source files it compiles (\`SRCS\`), which other components it uses internally (\`PRIV_REQUIRES\`; the example reads the flash size, so it needs \`spi_flash\`), and which directories hold its public headers. Adding a source file to your project means adding it to \`SRCS\`; calling a driver's API means naming its component in the requirements.` },
    ] },

    `## Installing ESP-IDF on Ubuntu

ESP-IDF is Espressif's SDK: the cross-compilers, the build scripts, FreeRTOS, the drivers and the flashing tools.
The steps below are taken from the ESP-IDF v6.1 documentation sources. v6.1 was the release GitHub marked as latest
when this lesson was written; if a newer stable release exists when you read this, follow its get-started guide and
treat the commands here as the pattern. ESP-IDF requires Python 3.10 or newer.

There are two supported routes. Use one, not both.

### Route A: the ESP-IDF Installation Manager (default since v6.0)`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'From docs/en/get-started/linux-setup.rst and eim-install-idf.rst in ESP-IDF v6.1. Not run here: the Espressif download host was not reachable from the environment this course was written in.', code: `echo "deb [trusted=yes] https://dl.espressif.com/dl/eim/apt/ stable main" | sudo tee /etc/apt/sources.list.d/espressif.list
sudo apt update
sudo apt install eim        # GUI and command line; or: sudo apt install eim-cli
eim install                 # latest stable ESP-IDF, non-interactive`, explain: [
      { lines: '1', md: `Adds Espressif's package repository to APT's list of sources. \`tee\` is used because the redirection has to happen with root privileges; \`sudo echo ... > file\` would not work, since the shell, not \`sudo\`, opens the file.` },
      { lines: '2-3', md: `Refresh the package index, then install the installation manager, \`eim\`.` },
      { lines: '4', md: `Downloads ESP-IDF, the toolchains and a Python environment. Alternatives: \`eim wizard\` asks questions interactively; \`eim install -i v5.4.2\` installs a specific version. When it finishes, \`eim\` prints the command that activates the environment: a \`source\` of an activation script in its \`tools\` directory, with the ESP-IDF version in the file name. The exact path depends on your user name and version, so copy it from the installer's output into your notebook. You run it in every new terminal in which you want to use ESP-IDF. Espressif's guide shows the installer ending with the line \`You have successfully installed ESP-IDF\` just above that command; if you do not see it, scroll up for the first error and do not continue.` },
    ] },

    `### Route B: the legacy method (default before v6.0)

You clone the ESP-IDF repository yourself and run its install script. This is still what many tutorials, CI
scripts and older projects assume, and it makes it easy to keep several versions side by side.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'From docs/en/get-started/linux-macos-setup-legacy.rst in ESP-IDF v6.1. Not run here.', code: `sudo apt-get install git wget flex bison gperf python3 python3-pip python3-venv cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0

mkdir -p ~/esp
cd ~/esp
git clone -b v6.1 --recursive https://github.com/espressif/esp-idf.git

cd ~/esp/esp-idf
./install.sh esp32          # or: ./install.sh all

. $HOME/esp/esp-idf/export.sh`, explain: [
      { lines: '1', md: `Host prerequisites. \`cmake\` and \`ninja-build\` drive the build, \`python3-venv\` lets the installer create an isolated Python environment, \`git\` fetches the source.` },
      { lines: '5', md: `\`-b v6.1\` checks out the release tag instead of the development branch. \`--recursive\` also fetches the submodules; without it the build later fails on missing files inside \`components/\`.` },
      { lines: '8', md: `Downloads the cross-compiler and tools for the named chip family into \`~/.espressif\` and creates the Python environment. \Name the chip on **your** board: \`esp32\`, \`esp32s3\`, \`esp32c3\`, \`esp32c6\`, or several separated by commas (\`./install.sh esp32,esp32c3\`); \`all\` covers every supported chip at the cost of a larger download. The script finishes by printing \`All done! You can now run:\` followed by the export command. If it stops earlier, the last lines say why (most often a network failure part-way through a download: run it again, it resumes).` },
      { lines: '10', md: `Activates the environment **in this shell**: puts the toolchain and \`idf.py\` on \`PATH\` and sets \`IDF_PATH\`. Note the leading dot. It ends with \`Done! You can now compile ESP-IDF projects.\` You run this line in every new terminal in which you want to use ESP-IDF. Espressif's guide suggests an alias so that it is one word, added to \`~/.bashrc\`: \`alias get_idf='. $HOME/esp/esp-idf/export.sh'\`. Do not put the export line itself in \`~/.bashrc\`: that would activate ESP-IDF's Python environment in every terminal, including ones where it gets in the way.` },
    ] },

    `### Verify, build, flash

Whichever route you used, activate the environment, then:`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Build and flash the hello_world example. Replace /dev/ttyUSB0 with your port and esp32 with your chip.', code: `idf.py --version

mkdir -p ~/esp
cp -r $IDF_PATH/examples/get-started/hello_world ~/esp/
cd ~/esp/hello_world
idf.py set-target esp32
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor`, explain: [
      { lines: '1', md: `Should print the ESP-IDF version. "command not found" means the environment is not active in this terminal.` },
      { lines: '3-4', md: `Work on a copy outside the ESP-IDF tree so that updating ESP-IDF never touches your project. The \`mkdir\` matters if you used Route A, which does not create \`~/esp\` for you. The ESP-IDF build system does not accept spaces in the path of a project, so keep directory names plain.` },
      { lines: '6', md: `Selects the chip: \`esp32\`, \`esp32s3\`, \`esp32c3\`, \`esp32c6\` and so on. This picks the cross-compiler (Xtensa or RISC-V) and regenerates the configuration, and it creates a file named \`sdkconfig\` in the project. If the target does not match the chip on the board, the image is for the wrong CPU and the wrong flash layout; the flashing tool reads the chip type when it connects and should stop with a fatal error naming the chip it found, before writing anything.` },
      { lines: '7', md: `Configures with CMake and builds with Ninja. The first build compiles every SDK component the example needs and takes minutes; later builds only recompile what changed. It should end with \`Project build complete. To flash, run:\` and the flashing command.` },
      { lines: '8', md: `Writes the bootloader, partition table and application to flash over the serial port, then opens the serial monitor. Exit the monitor with **Ctrl+]**. You should see the boot log, then \`Hello world!\`, chip information and a countdown to restart.` },
    ] },

    `## PlatformIO as an alternative

**PlatformIO** is a build and package manager that wraps many vendor SDKs, including ESP-IDF and Arduino for
ESP32, behind one command (\`pio\`) and one configuration file (\`platformio.ini\`). It downloads toolchains on
demand and integrates closely with VS Code.

\`\`\`ini
; platformio.ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = espidf
monitor_speed = 115200
\`\`\`

\`pio run\` builds, \`pio run -t upload\` flashes, \`pio device monitor\` opens the serial monitor.`,

    { t: 'callout', kind: 'decision', title: 'ESP-IDF directly, or PlatformIO?', md: `**This course uses ESP-IDF directly.** Reasons: it is the vendor's primary, documented path; new chips and security features (secure boot, flash encryption, eFuse tools) appear there first; what you see in \`build/\` is exactly what Espressif's documentation describes; and the eCTF-style workflow you are heading for is "a vendor SDK, a Makefile or CMake, a container", which ESP-IDF resembles and a wrapper hides.

**Prefer PlatformIO when** you want one tool across boards from several vendors, you want library dependency management, you are working mainly in the Arduino framework, or you need a quick start on a machine where installing ESP-IDF is awkward.

**The cost of PlatformIO:** its platform packages pin their own ESP-IDF version, which can lag the current release, so an API or configuration option described in the current ESP-IDF documentation may be missing. When something fails you have one more layer to see through. Check which framework version a platform release ships before relying on a feature.

Either way, the concepts in this lesson are the same underneath: a cross-compiler, CMake, a linker script and a flashing tool.` },

    { t: 'exercise', prompt: `A firmware Makefile for a Cortex-M0+ board contains this rule and nothing else that mentions headers:

\`\`\`makefile
%.o: %.c
\t$(CC) $(CFLAGS) -c -o $@ $<
\`\`\`

A teammate changes a \`#define UART_BAUD 115200\` to \`9600\` in \`config.h\`, runs \`make\`, flashes, and the board still talks at 115200. Which single command should they run before rebuilding to be sure every object file is regenerated?`, hints: [
      `According to this rule, what does each object file depend on? Is \`config.h\` in that list?`,
      `Make believed everything was up to date. You need the conventional target that deletes build outputs.`,
    ], answer: { type: 'text', accept: ['make clean', 'make clean ?(&&|;) ?make( all)?', 'make -B', 'make --always-make'], placeholder: 'command' }, solution: `\`make clean\` (then \`make\`). \`make -B\` also works: it forces every target to be rebuilt.

The rule says an object depends only on its \`.c\` file. \`config.h\` changed, no \`.c\` file did, so Make ran nothing and the old objects, with 115200 compiled in, were linked and flashed. The board was running old code.

The durable fix is to give Make the header dependencies: add \`-MMD -MP\` to \`CFLAGS\` so the compiler writes a \`.d\` file listing each object's headers, and add \`-include $(OBJS:.o=.d)\` to the Makefile.

The general lesson: when the device's behaviour contradicts the source, first prove the device is running the source you are looking at.` },

    `### Practise: a host-side test catches the fault before a board does

\`main.c\` earlier in this lesson was a host-side check: it called the function and turned the result into an exit status. The lab below is the same idea with one refinement. Its test harness reads the two inputs and the expected result from standard input, so the same program is run five times with five sets of numbers. That is how unit tests for firmware logic are usually driven: one build, many cases.

The code runs in this app's C interpreter, a simulated 32-bit machine, not on your PC's \`gcc\`. Division by zero stops the simulated program with a fault, as it would on many real cores.`,

    { t: 'widget', name: 'c-lab', title: 'Fix a function using its host-side tests', props: {
      title: 'half_period_ticks: make every case pass',
      prompt: `A teammate rewrote \`half_period_ticks\` from memory. It compiles without a warning, and two of the five test cases even pass.

Fix the function so that all five pass. The intended behaviour:

- the result is \`tick_hz / (2 × blink_hz)\`, truncated toward zero as C integer division does;
- a \`blink_hz\` of 0 means "LED off": return 0, and do not divide.

Do not edit the harness below the marked line. Before you change anything, press **Run tests** and read which cases fail and what was printed: predict from the output what the faulty expression is actually computing.`,
      starter: HP_STARTER,
      solution: HP_SOLUTION,
      tests: [
        { name: '1 kHz tick, 2 Hz blink: 250 ticks', stdin: '1000 2 250\n', stdout: 'half_period_ticks(1000, 2) = 250\n', exit: 0 },
        { name: '1 kHz tick, 1 Hz blink: 500 ticks', stdin: '1000 1 500\n', stdout: 'half_period_ticks(1000, 1) = 500\n', exit: 0 },
        { name: '32768 Hz tick, 3 Hz blink: truncates to 5461', stdin: '32768 3 5461\n', stdout: 'half_period_ticks(32768, 3) = 5461\n', exit: 0 },
        { name: 'blink_hz of 0 means off: returns 0 and does not fault', stdin: '1000 0 0\n', stdout: 'half_period_ticks(1000, 0) = 0\n', exit: 0 },
        { name: 'blink faster than the tick can time: 100 Hz tick, 60 Hz blink gives 0', stdin: '100 60 0\n', stdout: 'half_period_ticks(100, 60) = 0\n', exit: 0 },
      ],
      hints: [
        `The 1 Hz case passes and the 2 Hz case prints 1000. What would make the result grow when the blink frequency grows, when it should shrink?`,
        `\`/\` and \`*\` have the same precedence and group left to right, so \`a / 2u * b\` is \`(a / 2u) * b\`. With \`b\` equal to 1 the two readings happen to agree, which is why one case passed.`,
        `Divide by the whole product: \`tick_hz / (2u * blink_hz)\`. Now run the tests again and look at the \`blink_hz\` of 0 case: it used to "pass" by accident (anything times 0 is 0) and now divides by zero. Return 0 before the division when \`blink_hz == 0\`.`,
      ],
      explain: `Two things to take from this.

**A passing test is evidence only for the inputs it used.** The faulty version passed the 1 Hz case and the zero case for reasons that had nothing to do with being right. One test case would have let it through; five with different shapes of input (ordinary, a non-exact division, zero, a result that truncates to 0) did not.

**Fixing one fault exposed another.** With the precedence corrected, the zero case stopped being an accidental pass and became a division by zero. That is normal, and it is why you rerun every test after every change, not only the one you were working on.

None of this needed a board, a cable or a flashing step, and each run took well under a second. Logic that does not touch hardware should be tested this way first; the board is for the parts that only a board can show. One limit of this function is left for you to find later: for a \`blink_hz\` above about 2.1 billion, \`2u * blink_hz\` no longer fits in 32 bits. The Embedded C section covers that kind of wraparound.`,
    } },

    `## Harder application: read a build you did not write

The eCTF 2026 reference firmware is compiled with flags that include:

\`\`\`text
tiarmclang -D__MSPM0L2228__ -mcpu=cortex-m0plus -march=thumbv6m -mfloat-abi=soft ...
\`\`\`

Without running anything, write in your notebook what each of the four flags tells you about the target, and one
consequence for the C code you would write. Then compare with the notes below.

- \`-D__MSPM0L2228__\` defines a preprocessor macro. Vendor headers use it to select the register definitions for
  this exact chip. Consequence: a missing or wrong \`-D\` gives you another chip's register addresses and code that
  compiles but writes to the wrong places.
- \`-mcpu=cortex-m0plus\` names the CPU core. The compiler may only emit instructions that core implements.
- \`-march=thumbv6m\` names the instruction set. ARMv6-M is the small Thumb subset; it has no hardware divide
  instruction, so every \`/\` and \`%\` on variables becomes a call to a library routine. Consequence: division is
  slow and its timing depends on the operands, which matters later for timing side channels.
- \`-mfloat-abi=soft\` says there is no floating-point unit: all \`float\` arithmetic is done by library code.
  Consequence: avoid floating point in firmware for this target unless you have measured its cost.

You have just extracted four hardware facts from a command line. This is why being able to read the build matters.`,

    { t: 'refs', items: [
      { title: 'Espressif: Linux setup with the ESP-IDF Installation Manager (v6.1 docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/linux-setup.rst' },
      { title: 'Espressif: legacy Linux and macOS setup (v6.1 docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/get-started/linux-macos-setup-legacy.rst' },
      { title: 'GNU Make manual', url: 'https://www.gnu.org/software/make/manual/' },
      { title: 'CMake tutorial and reference', url: 'https://cmake.org/cmake/help/latest/' },
      { title: 'PlatformIO documentation', url: 'https://docs.platformio.org/', note: 'Candidate URL; not load-tested when this lesson was written.' },
      { title: 'MITRE eCTF 2026 reference design: firmware Makefile and Dockerfile', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/tree/release/firmware' },
    ] },
  ],
  quiz: [
    { kind: 'concept', q: `Why can the output of your laptop's ordinary \`gcc\` not run on an ESP32-C3?`, choices: [
      { t: `A PC executable carries debug information and libraries that make it too large for the ESP32-C3's flash.`, why: `Size is not the obstacle. Even a tiny program compiled this way would not run.` },
      { t: `It holds instructions for the laptop's CPU and expects an operating system to load it.`, ok: true, why: `Different instruction set, different libraries, different memory layout: all three need a cross-toolchain.` },
      { t: `The ESP32-C3 executes only interpreted languages, so C must first be translated to MicroPython bytecode.`, why: `Microcontrollers execute machine code from flash. Interpreters are themselves compiled firmware.` },
    ] },
    { kind: 'code', q: `A build ends with \`undefined reference to 'uart_send'\`. Which stage reported this, and what does it mean?`, choices: [
      { t: `The compiler: the function's prototype is missing from every header that the calling file includes.`, why: `A missing prototype produces a compile-time diagnostic about an implicit declaration, at the line of the call.` },
      { t: `The linker: the call compiled, but no object file or library given to the linker defines the function.`, ok: true, why: `"Undefined reference" is the linker failing to resolve a symbol. Usually a source file is missing from the build's source list.` },
      { t: `The flashing tool: the function was built, but did not fit in the flash region assigned to it.`, why: `Flashing happens after a successful link, and a size problem is reported as a memory region overflowing.` },
    ] },
    { kind: 'code', q: `In the rule \`%.o: %.c blink_math.h\` with command \`$(CC) $(CFLAGS) -c -o $@ $<\`, what do \`$@\` and \`$<\` expand to when building \`main.o\`?`, choices: [
      { t: '`$@` is `main.o`; `$<` is `main.c`.', ok: true, why: `\`$@\` is the target; \`$<\` is the first prerequisite.` },
      { t: '`$@` is `main.c`; `$<` is `main.o`.', why: `That has them reversed. Think of \`@\` as "the thing being aimed at".` },
      { t: '`$@` is `main.o`; `$<` is `main.c blink_math.h`.', why: `All prerequisites together is a different automatic variable. Passing a header to \`-c\` as an input would also be wrong.` },
    ] },
    { kind: 'concept', q: `You open a new terminal, go to your ESP-IDF project and run \`idf.py build\`. The shell answers \`idf.py: command not found\`. Yesterday it worked. What is the most likely cause?`, choices: [
      { t: `An overnight system update removed ESP-IDF, so it has to be installed again from the start.`, why: `Nothing removes it by itself. Consider what differs between yesterday's terminal and this one.` },
      { t: `The ESP-IDF environment has not been activated in this shell, so PATH lacks the tools.`, ok: true, why: `Activation changes the environment of one shell only. Each new terminal needs it again.` },
      { t: `The project directory is owned by another user, so the command must be run with \`sudo\`.`, why: `Root privileges do not put a command on PATH, and building as root damages file ownership in the project.` },
    ] },
    { kind: 'arch', q: `The eCTF 2026 reference design builds with TI Arm Clang, while the 2025 design used arm-none-eabi-gcc. A teammate wants to paste a GCC-specific linker option into the 2026 build. What is the sound approach?`, choices: [
      { t: `Paste it: both compilers target Arm and follow the same EABI, so their linker options are interchangeable.`, why: `The two are different compiler families with their own drivers, linkers and option sets. Some options overlap; many do not.` },
      { t: `Check the option in the TI Arm Clang documentation, then confirm its effect in the map file or disassembly.`, ok: true, why: `Treat a different toolchain as a different tool: confirm, then verify the output.` },
      { t: `Switch the Dockerfile back to GCC so the option works, since the two compilers produce equivalent code.`, why: `Swapping the toolchain changes code generation, libraries and startup code for the whole team. It is a design decision that has to be made openly and against the rules for that year.` },
    ] },
    { kind: 'concept', q: `Which situation favours PlatformIO over using ESP-IDF directly?`, choices: [
      { t: `You need a security feature that appeared in the newest ESP-IDF release and want it on the day it ships.`, why: `A wrapper pins its own framework version and may not yet include the newest release.` },
      { t: `You maintain small projects on boards from several vendors and want one build command.`, ok: true, why: `A uniform front end across vendors is what PlatformIO is for.` },
      { t: 'You want the build directory to match Espressif\'s documentation exactly.', why: `An extra layer changes paths and invocation. The vendor's own tool is the one its documentation describes.` },
    ] },
  ],
};

const tools = {
  id: 'fnd-tools',
  title: 'Supporting tools: Git, Docker, Python and serial terminals',
  minutes: 55,
  summary: 'Know exactly what is on the board, build it the same way on every machine, talk to it from a script, and know where the debugging and analysis tools fit.',
  skills: ['fnd-git', 'fnd-repro', 'fnd-serial-tools'],
  blocks: [
    `## The problem

Three weeks into a project, the board on your desk misbehaves and your teammate's does not. You both say you are
running "the latest code". Yours was built on your laptop on Tuesday with some local edits you may or may not have
reverted; theirs was built in a container on Thursday. Nobody can say which source produced the bytes in either
chip.

In software, the running program and its source are usually on the same machine. In embedded work they are
separated the moment you flash, and the device carries no memory of where its firmware came from unless you put it
there. The tools in this lesson exist to answer three questions at any time: **what exactly is on the board, could
anyone rebuild it bit for bit, and what is the board saying?**`,

    `## Git for a hardware project

You need a small part of Git, used consistently.

**Commit small, working steps.** A commit is a snapshot of the tracked files with a message. Commit when something
works, before you start changing it.

\`\`\`bash
git config --global user.name  "Your Name"        # once per computer; Git refuses to
git config --global user.email "you@example.com"  # commit until both are set
git init                      # once, in the project directory
git status                    # what changed?
git add main/app_main.c       # choose what goes into the snapshot
git commit -m "Blink LED on GPIO2 at 1 Hz"
git log --oneline             # history
git diff                      # what have I changed since the last commit?
\`\`\`

**Branch for experiments.** A branch is a movable name for a line of commits. Trying a risky change on a branch
keeps \`main\` flashable.

\`\`\`bash
git switch -c try-faster-i2c  # create and move to a branch
git switch main               # back to the known-good line
git merge try-faster-i2c      # bring the experiment in, if it worked
\`\`\`

**Ignore what the build produces.** Build output is large, different on every machine, and can always be
regenerated. Committing it causes pointless conflicts. A \`.gitignore\` file lists patterns Git should not track:

\`\`\`text
# .gitignore for an ESP-IDF project
build/
sdkconfig.old
managed_components/
.venv/
__pycache__/
*.pyc
\`\`\`

Whether to commit \`sdkconfig\` (the full generated configuration) is a real choice. Committing it pins every
option, so everyone builds the same thing. The alternative is to commit only \`sdkconfig.defaults\`, a short file of
the options you deliberately changed, and let the rest be regenerated. Pick one and write it in the README.`,

    { t: 'callout', kind: 'security', title: 'Secrets do not belong in the repository', md: `Keys, PINs, Wi-Fi passwords and generated secret files must be in \`.gitignore\` before the first commit. Once a secret is in a commit, deleting the file later does not remove it from history, and anyone with a copy of the repository has it. eCTF reference designs generate secrets at build time into a separate file for this reason. You will design that flow in the Security section.` },

    `### Record what you flashed

This is the habit that solves the opening problem. Before flashing a build you intend to keep or test seriously:

\`\`\`bash
git status --short                 # must print nothing: no uncommitted changes
git tag -a bench-2026-11-14 -m "Flashed to board A; I2C at 100 kHz"
git describe --tags --always --dirty
\`\`\`

\`git describe\` prints a short identifier such as \`bench-2026-11-14\`, or \`bench-2026-11-14-3-g1a2b3c4\` if you
are three commits past the tag. With \`--dirty\`, it appends \`-dirty\` when the working tree has uncommitted
changes, which is exactly the situation in which nobody can reproduce your build. Write that string in the
notebook entry for every test.

Better still, have the firmware say it. ESP-IDF embeds a version string derived from \`git describe\` in the
application image and prints it in the boot log as the app version. Look for it the first time you see your board
boot. A board that announces \`-dirty\` at boot is telling you its source cannot be recovered.`,

    { t: 'callout', kind: 'mistake', title: 'Flashing from a dirty tree, then committing something else', md: `You flash, it works, you tidy the code "without changing anything", then commit. The commit is not what is on the board. If the tidy-up introduced a fault you will hunt for it in hardware that is running different code. Commit first, flash second, and flash again after any edit.` },

    `## Docker: the same build on every machine

A firmware image depends on more than your source: the compiler version, the SDK version, the Python packages used
by build scripts. Two laptops with slightly different versions can produce different binaries from the same commit,
one of which has a bug.

A **container** packages a file system containing exactly the tools a build needs. A \`Dockerfile\` is the recipe;
\`docker build\` turns it into an **image**; \`docker run\` starts a **container** from the image. Everyone who builds
from the same Dockerfile gets the same compiler and SDK.

Install and check it once. Ubuntu packages Docker as \`docker.io\`; Docker's own documentation describes installing the newer upstream packages instead, and either works for this course.

\`\`\`bash
sudo apt install docker.io
sudo docker run --rm hello-world     # should print "Hello from Docker!"
\`\`\`

Docker commands need root, or membership of the \`docker\` group (\`sudo usermod -aG docker "$USER"\`, then log out and in, exactly as for \`dialout\`). Be aware that membership of \`docker\` is equivalent to root access on that machine, because a container can be started with any host directory mounted. On your own laptop that is a reasonable trade; on a shared machine it is not yours to make.

This is how recent eCTF reference designs are built, which is why you need it:

| Year | Reference build environment | Detail |
|---|---|---|
| eCTF 2024 | Nix and Poetry | A \`shell.nix\` provides make, Python, the Arm GCC toolchain and OpenOCD; Poetry manages the Python host tools |
| eCTF 2025 | Docker | Image based on \`ubuntu:24.04\` with \`gcc-arm-none-eabi\` and a pinned MSDK release |
| eCTF 2026 | Docker | Image based on \`ubuntu:24.04\` with the TI MSPM0 SDK and TI Arm Clang |

The reason is the same in each case: organisers must be able to build every team's design themselves and get the
firmware the team intended, and an attacking team must be able to build a target's source too.

The 2025 reference design's build command shows the pieces:`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'From the eCTF 2025 reference design README. Not run here.', code: String.raw`cd decoder
docker build -t decoder .
docker run --rm -v ./build_out:/out -v ./:/decoder -v ./../secrets:/secrets -e DECODER_ID=0xdeadbeef decoder`, explain: [
      { lines: '2', md: `Build an image from the \`Dockerfile\` in this directory and name it \`decoder\`. This step downloads the compiler and SDK; it is slow once and cached afterwards.` },
      { lines: '3', md: `\`--rm\` deletes the container when it exits; the image stays. Each \`-v host:container\` **mounts** a host directory inside the container: the source goes in at \`/decoder\`, the secrets at \`/secrets\`, and the results come out through \`/out\`. \`-e\` sets an environment variable that the build reads, here the ID to compile into this particular device. Nothing else on your machine is visible to the build.` },
    ] },

    `### A container and a serial port

A container has its own \`/dev\`. To flash or monitor from inside one, pass the device in:

\`\`\`bash
docker run --rm -it --device=/dev/ttyUSB0 -v "$PWD":/project -w /project espressif/idf idf.py -p /dev/ttyUSB0 flash monitor
\`\`\`

\`--device\` makes that one node available inside the container. \`-it\` gives you an interactive terminal so the
monitor can read your keystrokes. \`-w\` sets the working directory. \`espressif/idf\` is Espressif's published
ESP-IDF image; add a tag such as \`:v6.1\` to pin the version, which is the point of using a container.

Two limits to remember. The device is passed in **as it exists when the container starts**: if the board
re-enumerates or you replug it, the node inside the container is stale and you must restart the container. And the
user inside the container needs permission on the node; images that run as root have it, others need a matching
group. Many teams therefore build in the container and flash from the host.`,

    { t: 'callout', kind: 'decision', title: 'Build in a container, flash from the host', md: `**Choice:** produce the firmware image inside the container, write it to a mounted output directory, and run the flashing tool and serial monitor on the host.

**Why:** the part that must be reproducible is the *build*. Flashing depends on USB devices that come and go, which containers handle poorly. The eCTF reference designs follow the same split: the container emits \`.bin\` and \`.elf\` files, and a host-side Python tool sends them to the board.

**Alternative:** flashing from the container with \`--device\` is fine for a single board that stays plugged in, and avoids installing anything on the host.` },

    `## Python for tooling

Embedded projects use Python on the host for everything around the firmware: flashing, generating secrets and
headers, test scripts that talk to the board. Two habits prevent most problems.

**One virtual environment per project.** A [[Virtual environment]] is a private directory of Python packages.
Installing into the system Python is blocked on current Ubuntu (pip reports \`externally-managed-environment\`), and
for good reason: system tools depend on those packages.

\`\`\`bash
python3 -m venv .venv            # create it once, inside the project
. .venv/bin/activate             # activate in this shell; the prompt shows (.venv)
python -m pip install pyserial   # installs into .venv only
python -m pip freeze > requirements.txt
deactivate
\`\`\`

Note the package is called \`pyserial\` but is imported as \`serial\`. Installing a package named \`serial\` gives
you a different, unrelated library and confusing errors.

**Do not mix environments.** ESP-IDF has its own Python environment, activated by its export script. If you
activate your project's \`.venv\` and then run \`idf.py\`, it may run under the wrong Python and complain about
missing packages. Use separate terminals, or \`deactivate\` first.

### Reading a serial port from a script

A terminal program is for looking. A script is for recording, timestamping and checking. This one prints each line
the board sends with the time it arrived.`,

    { t: 'code', lang: 'python', status: 'reviewed', caption: 'read_port.py. Tested here with pyserial 3.5 on Python 3.13 against a pseudo-terminal created with Python\'s pty module: three lines were written to the pty, including two invalid UTF-8 bytes, and the script printed all three with timestamps and exited cleanly on Ctrl-C. Not tested against a physical serial port, where baud rate and USB behaviour also matter.', code: READ_PORT, explain: [
      { lines: '6', md: `The import name is \`serial\`; the package you install is \`pyserial\`.` },
      { lines: '10-11', md: `Port and baud rate come from the command line, with defaults. 115200 is the default console speed of ESP-IDF and of the recent eCTF reference designs.` },
      { lines: '13', md: `Opens the port. The kernel's serial driver tells the USB bridge chip to use this baud rate; if it does not match the rate the microcontroller's UART is using, you still get bytes, but the wrong ones. \`timeout=1\` makes reads return after one second even if nothing arrived, so the loop cannot hang for ever. The \`with\` block closes the port even on error. Opening a port can also toggle the DTR and RTS lines, which on many ESP32 dev boards resets the chip.` },
      { lines: '15-17', md: `\`readline()\` returns bytes up to and including a newline, or whatever arrived before the timeout, possibly nothing.` },
      { lines: '18', md: `Serial data is **bytes**, not text. A board that has just reset, or a wrong baud rate, produces byte values that are not valid UTF-8. \`errors="replace"\` substitutes a marker character instead of raising an exception and killing your logger at the moment something interesting happens.` },
      { lines: '19', md: `A monotonic clock never jumps backwards, unlike wall-clock time. \`flush=True\` makes each line appear immediately when output is piped to a file or to \`tee\`.` },
    ] },

    `Run it as \`python read_port.py /dev/ttyUSB0 115200 | tee boot.log\` to watch and save at the same time.`,

    `## Serial terminals, and how to get out of them

Everyone gets stuck inside a serial terminal once. Learn the exit keys now.

| Program | Start | Exit | Notes |
|---|---|---|---|
| \`idf.py monitor\` | \`idf.py -p /dev/ttyUSB0 monitor\` | **Ctrl+]** | Understands ESP-IDF output: decodes crash addresses into function names and line numbers using the project's ELF file. Prefer it for ESP32 work |
| \`picocom\` | \`picocom -b 115200 /dev/ttyUSB0\` | **Ctrl+A** then **Ctrl+X** | Small and predictable. Good default for non-ESP boards |
| \`minicom\` | \`minicom -D /dev/ttyUSB0 -b 115200\` | **Ctrl+A** then **X** | Menu-driven (Ctrl+A then Z for help). Check that hardware flow control is off in its settings if nothing can be typed |
| \`screen\` | \`screen /dev/ttyUSB0 115200\` | **Ctrl+A** then **K**, then **y** | Often already installed. Detaching with Ctrl+A D leaves it running and holding the port |

A serial console setting is usually written like \`115200 8N1\`: 115200 baud, 8 data bits, no parity, 1 stop bit.
You will decode exactly what that means on the wire in the Protocols section.`,

    { t: 'predict', q: `\`idf.py monitor\` is running in one terminal and showing the board's output. In a second terminal you start \`python read_port.py /dev/ttyUSB0\` on the same port. What do you expect each program to show?`, reveal: `Each byte the board sends is delivered **once**, to whichever program asks the kernel for it first. With two readers, each gets an unpredictable share: both displays show fragments with missing characters, and neither has a complete log. Nothing reports an error, because Linux allows a serial device to be opened more than once unless a program requests an exclusive lock. (Some terminal programs do take a lock and will refuse to start, reporting the port as busy or locked. That is the helpful case.)

The same thing happens when a forgotten \`screen\` session, a detached monitor or an IDE's serial panel still holds the port: garbled or missing output that looks like a baud-rate or wiring fault. Before suspecting hardware, check who has the port open with \`sudo fuser -v /dev/ttyUSB0\`.

One port, one reader. If two tools need the data, have one read and \`tee\` it to a file the other follows.` },

    `## Where the other tools fit

You will learn each of these in a later section. For now, know what question each answers and how to check it is
installed. On Ubuntu, \`apt\` versions can be older than a vendor requires; where a later lesson needs a specific
build it will say so.

**OpenOCD** (Open On-Chip Debugger) is the program that talks to a JTAG or SWD debug probe. It translates between
the probe's USB protocol and the target's debug port, and offers a network port that GDB connects to. It can also
program flash. Chip vendors often maintain their own builds: Espressif ships one with ESP-IDF, and Analog Devices
ships one with the MSDK for the MAX78000. Upstream OpenOCD includes a flash driver and board configuration for TI
MSPM0 parts. Verify: \`openocd --version\`.

**GDB** is the debugger: it stops the program, single-steps, shows registers, variables and memory, and maps
addresses back to source lines using the ELF file. For embedded targets it connects to OpenOCD instead of running
the program itself. You need a GDB that understands the target's architecture; Ubuntu's \`gdb-multiarch\` package
covers Arm and RISC-V, and each cross-toolchain ships its own (\`arm-none-eabi-gdb\`, \`xtensa-esp32-elf-gdb\`).
Verify: \`gdb-multiarch --version\`.

**Ghidra** is a reverse-engineering suite published by the NSA. Given a binary with no source, it disassembles the
machine code, recovers functions and produces approximate C (decompilation). In this course you use it on firmware
you built yourself and on intentionally vulnerable training images, to see what an attacker would see in yours. It
needs a Java Development Kit; the required version is stated in the installation guide of the release you download.
Verify: \`java -version\`, then start it with \`./ghidraRun\` from the extracted directory.

**Renode** is a simulator for whole embedded systems: CPU, memory and peripheral models, able to run unmodified
firmware binaries for the platforms it supports and to connect several simulated devices together. It lets you test
firmware with no board and reproduce a fault deterministically. A simulated peripheral is a model, so timing and
analogue behaviour are not those of the real chip. Verify: \`renode --version\`.

**sigrok and PulseView** are the open-source software for logic analysers (and some oscilloscopes and
multimeters). \`sigrok-cli\` captures and decodes from the command line; PulseView is the graphical front end with
protocol decoders for UART, I2C, SPI and many more. Install with \`sudo apt install sigrok-cli pulseview\`. Verify:
\`sigrok-cli --version\`, and with an analyser plugged in, \`sigrok-cli --scan\` should list it.`,

    { t: 'exercise', prompt: `You are about to flash a build for an important test. Write the single Git command that prints an identifier for the exact source state, including a marker if there are uncommitted changes, to copy into your notebook.`, hints: [
      `The command names a commit relative to the nearest tag.`,
      `It is \`git describe\`. Which option adds a suffix when the working tree has modifications? Add \`--always\` so it still prints something in a repository with no tags.`,
    ], answer: { type: 'text', accept: ['git describe( --(tags|always|long|all|abbrev=\\d+))* --dirty( --(tags|always|long|all|abbrev=\\d+))*'], placeholder: 'git …', nudge: 'You need git describe with the option that reports uncommitted changes.' }, solution: `\`git describe --tags --always --dirty\`

- \`--tags\` allows lightweight tags as well as annotated ones.
- \`--always\` falls back to the abbreviated commit hash when no tag is reachable.
- \`--dirty\` appends \`-dirty\` when tracked files have uncommitted modifications.

If the output ends in \`-dirty\`, stop: commit (or stash) first, rebuild, then flash. Otherwise the identifier you write down does not describe the image on the board.` },

    `### Practise: what a wrong setting looks like

Before you meet it on a real board, see the two faults a serial terminal shows most often. In the simulated terminal below, connect with the terminal and the device both at 115200 8N1 and exchange a few characters. Then change only the terminal's baud rate and send again, and after that put the baud rate back and change only the parity. Write down what each mismatch looks like on screen and in the frame waveform. The pattern to remember: a wrong baud rate gives a steady stream of wrong characters from the first byte, with nothing missing, whereas the "two readers on one port" fault above gives correct characters with gaps.`,

    { t: 'widget', name: 'uart-terminal', props: { baud: 115200, format: '8N1' }, caption: 'A model of a UART link only: it has no USB layer, no device node and no permissions, so it cannot show the faults from lesson 3.' },

    `## Harder application: flashing from inside the build container

Your team decides everything, including flashing, must happen inside the container so that no one needs tools on
their host. You start the container with \`--device=/dev/ttyUSB0\`. Flashing works once. The board resets at the end
of flashing; on this particular board that makes its native USB port disconnect and reconnect. The next flash
attempt inside the same container fails with "No such device".

Write down:

1. Why the node inside the container stopped working although \`/dev/ttyUSB0\` (or \`ttyACM0\`) exists again on the
   host.
2. Two different ways to make the workflow reliable, with the cost of each.
3. Which you would choose for a team of four with two boards each, and why.

Points a good answer covers: the container received a device node tied to the device as it existed at start-up,
and a re-enumerated device is a new device to the kernel; restarting the container per flash works and is slow;
running the container with broad access to \`/dev\` works but removes isolation you might want; splitting build
(container) from flash (host) avoids the problem; a udev symlink gives each board a stable name on the host either
way.`,

    { t: 'refs', items: [
      { title: 'Pro Git book (Chacon and Straub)', url: 'https://git-scm.com/book/en/v2' },
      { title: 'Docker documentation: docker run reference', url: 'https://docs.docker.com/reference/cli/docker/container/run/' },
      { title: 'MITRE eCTF 2025 reference design (Docker build)', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example' },
      { title: 'MITRE eCTF 2024 reference design (Nix and Poetry)', url: 'https://github.com/mitre-cyber-academy/2024-ectf-insecure-example' },
      { title: 'pySerial documentation', url: 'https://pyserial.readthedocs.io/' },
      { title: 'OpenOCD source and documentation', url: 'https://github.com/openocd-org/openocd' },
      { title: 'Ghidra', url: 'https://github.com/NationalSecurityAgency/ghidra' },
      { title: 'Renode', url: 'https://github.com/renode/renode' },
      { title: 'sigrok and PulseView', url: 'https://sigrok.org/wiki/Main_Page', note: 'Candidate URL; not load-tested when this lesson was written. Source: github.com/sigrokproject.' },
    ] },
  ],
  quiz: [
    { kind: 'concept', q: `A board's boot log shows the app version \`v1.2-4-g9f3c2ab-dirty\`. What does the suffix \`-dirty\` tell you?`, choices: [
      { t: `The flash memory had bad blocks at the time the image was written, and the bootloader recorded it.`, why: `The string describes the source tree at build time. It says nothing about the chip's memory.` },
      { t: `The image was built from a working tree that contained uncommitted changes.`, ok: true, why: `The build cannot be reproduced from the repository alone.` },
      { t: `The build used debug settings: optimisation off and assertions enabled.`, why: `Optimisation level is a build configuration choice. It is not what this suffix records.` },
    ] },
    { kind: 'concept', q: `Why do the eCTF 2025 and 2026 reference designs build firmware inside a Docker container?`, choices: [
      { t: `A container build applies optimisations that make the firmware run faster on the microcontroller.`, why: `The container exists only on the build machine. The microcontroller runs the same kind of binary either way.` },
      { t: `So that every team, and the organisers, build with the same compiler and SDK versions and get the same firmware.`, ok: true, why: `Reproducibility across machines is the purpose.` },
      { t: `Because the boards' bootloader only accepts images that were packaged and signed inside the container.`, why: `Flashing in those designs is done by host-side tools talking to a bootloader. Docker is not involved in that step.` },
    ] },
    { kind: 'code', q: `Your logging script dies with \`UnicodeDecodeError\` exactly when the board resets. What is the most appropriate fix?`, choices: [
      { t: `Lower the baud rate on both ends, so that fewer bytes are corrupted during the reset.`, why: `The bytes around a reset are not text at any speed. The script must tolerate arbitrary byte values.` },
      { t: `Decode with \`errors="replace"\`, or log the raw bytes.`, ok: true, why: `A logger must survive the moments when the data is garbage, since those are the moments you most want recorded.` },
      { t: `Wrap the whole read loop in \`try: ... except: pass\` so that no exception can stop the logger.`, why: `That would hide every other error as well, including the port disappearing, and you would log nothing without knowing why.` },
    ] },
    { kind: 'concept', q: `\`pip install pyserial\` on Ubuntu 24.04 fails with \`error: externally-managed-environment\`. What should you do?`, choices: [
      { t: `Run it with \`sudo\`, because installing packages needs administrator rights.`, why: `Root does not bypass this protection, and installing into the system Python is what the message is warning against.` },
      { t: `Create and activate a virtual environment in the project, then install there.`, ok: true, why: `A venv is a private package directory that cannot interfere with the system's Python.` },
      { t: `Add \`--break-system-packages\`, which is the documented way to tell pip you accept the risk.`, why: `The flag exists, but it does what it says: it risks breaking tools the operating system depends on.` },
    ] },
    { kind: 'concept', q: `You started \`picocom\` and now want your shell back. Which keys?`, choices: [
      { t: 'Ctrl+C', why: `In a serial terminal Ctrl+C is sent to the device as byte 0x03. The terminal program itself keeps running.` },
      { t: 'Ctrl+A then Ctrl+X', ok: true, why: `picocom uses Ctrl+A as its escape key, followed by Ctrl+X to exit.` },
      { t: 'Ctrl+]', why: `That is the exit key of ESP-IDF's monitor, a different program.` },
    ] },
    { kind: 'arch', q: `You have a firmware binary and no source, and you want to read approximate C for its functions. Which tool is designed for that?`, choices: [
      { t: 'OpenOCD', why: `It connects a debugger to a chip's debug port. It does not analyse or decompile a file.` },
      { t: 'Ghidra', ok: true, why: `It disassembles and decompiles binaries.` },
      { t: 'PulseView', why: `It displays and decodes captured signals from a logic analyser, not program code.` },
    ] },
  ],
};

const measuring = {
  id: 'fnd-measure',
  title: 'Measuring before guessing',
  minutes: 45,
  summary: 'Use a multimeter correctly, know what a logic analyser and an oscilloscope add, and debug with a method instead of by changing things until it works.',
  skills: ['fnd-multimeter', 'fnd-debug-method'],
  blocks: [
    `## The problem

An LED on a breadboard should blink. It stays dark.

Most beginners open the editor. They change the pin number, add a delay, re-flash, and repeat for an hour. The fault
is a jumper wire one row too far to the left, and no edit to the code could ever have found it.

The code is where you are comfortable, so it is where you look. The discipline this lesson teaches is to ask first
"what can I *measure* that would tell me which half of the system the fault is in?" A ten-second voltage measurement
at the pin answers whether to look at firmware or at wiring.`,

    `## The multimeter: four measurements

A [[Multimeter]] has two leads: black in the socket marked **COM**, red in the socket marked **V/Ω** for everything
except current.

### Voltage: the meter goes *across*

Voltage is a difference between two points, so you touch the two points while the circuit is **powered**. Set the
dial to DC volts: the position marked **V** with a straight line (often a solid line over a dashed one), not the
**V** with a wavy line, which is AC and will read close to zero on a steady rail. On a meter without auto-ranging,
choose the lowest range that is above what you expect: the 20 V range for 3.3 V and 5 V work. For "the voltage at a
pin", black goes on ground and red on the pin.

Three things make the reading trustworthy:

- **Probe the metal that matters.** Touch the pin header or the component leg itself, not the plastic of a jumper
  or a breadboard hole you believe is connected to it. Half of all "0 V" readings are a probe not making contact.
- **Find a solid ground.** The board's GND header pin or the metal shell of its USB connector. Check it once by
  measuring the 3V3 pin against it.
- **Read the sign.** A negative number means the probes are the other way round from what you assumed, which is a
  fact about your circuit or your assumption, not an error to ignore.

In voltage mode the meter has a very high resistance (megohms), so it draws almost no current and barely disturbs
the circuit. This makes voltage the safest and most useful measurement. Use it first.

What you learn: is the supply rail what it should be, is a pin high or low, is there a voltage across a component
(which means current is flowing through it, or it is blocking).

### Continuity: are these two points joined?

Continuity mode, marked with a sound-wave or diode symbol, beeps when the resistance between the leads is very low.
Use it with the circuit **unpowered** to answer wiring questions without looking: is this breadboard rail split in
the middle, does this jumper actually conduct, is this pin connected to that one, are two adjacent pins shorted by
a solder bridge.

Touch the leads together first. No beep means the meter is in the wrong mode or its battery is flat.

### Resistance: unpowered, and ideally out of circuit

To measure resistance the meter pushes a small known current through the leads and measures the voltage that
results. Two consequences:

- **Never measure resistance in a powered circuit.** The circuit's own voltages add to or fight the meter's test
  current. The reading is meaningless, and on some meters the input can be damaged.
- **In-circuit readings are of everything in parallel.** The meter's current takes every available path, so a
  resistor still wired into a circuit reads lower than its value. Lift one end out of the breadboard to measure the
  part itself.

### Current: the meter goes *in series*

Current is a flow through a path, so the meter must become part of the path. Power off, break the circuit at one
point, connect the meter across the break, power on. On most meters you must also **move the red lead to a
separate socket** marked mA or A.

In current mode the meter is nearly a short circuit, by design, so that it does not reduce the current it is
measuring. This is what makes the mode hazardous.`,

    { t: 'callout', kind: 'warn', title: 'The lead left in the current socket', md: `You measure a current, then go to measure the 5 V rail without moving the red lead back to V/Ω. Touching the probes across the supply now connects a near-short across it. With a USB port, the port shuts down; with a battery or bench supply, the meter's internal fuse blows (after which the current ranges read zero for ever, until someone replaces the fuse). **Move the red lead back to V/Ω as soon as you finish a current measurement**, every time. Often you can avoid current mode entirely: measure the voltage across a known resistor in the path and calculate I = V / R.` },

    { t: 'ascii', caption: 'Where the meter goes. V: across, circuit powered. A: in series, in the opened path.', text: `Voltage across the resistor            Current through the LED

 3V3 ----[ R ]----+---->|---- GND       3V3 ----[ R ]----( A )---->|---- GND
        |       |      LED                               meter in the
        +--(V)--+                                        opened path
       red     black` },

    `## Worked example: expected values for an LED circuit

A red LED with a forward voltage of about 2.0 V and a 330 Ω resistor in series, from a pin driven to 3.3 V.

Before measuring, calculate what a healthy circuit shows:

- Voltage across the resistor: 3.3 V − 2.0 V = 1.3 V
- Current: 1.3 V / 330 Ω ≈ 3.9 mA
- Voltage across the LED: about 2.0 V
- Voltage from pin to ground: about 3.3 V

Now each possible fault predicts a *different* set of readings. All four columns are taken with the black probe
or both probes where the heading says; "GND" means the board's own ground pin.

| Fault | Pin to GND | Across resistor | Across LED | LED anode to GND |
|---|---|---|---|---|
| None (working) | 3.3 V | 1.3 V | 2.0 V | 2.0 V |
| Firmware never drives the pin high | 0 V | 0 V | 0 V | 0 V |
| LED inserted backwards | 3.3 V | 0 V | 3.3 V | 3.3 V |
| Resistor not connected (wrong row) | 3.3 V | 0 V or drifting | 0 V | about 0 V, or drifting |
| Ground wire missing | 3.3 V | 0 V | 0 V | 3.3 V |

The first measurement, pin to ground, splits the table: 0 V means look at firmware or pin choice; 3.3 V means the
firmware is doing its job and the fault is in the wiring. One reading has removed half of the possibilities.

The last two rows show why the choice of measurement matters. With an open resistor and with a missing ground, no
current flows, so the first three columns read the same for both. They differ in *where the break is*, and the
fourth column finds it. With the ground wire missing, the path from the pin through the resistor to the LED is
intact and carries no current, so there is no voltage drop along it and the whole 3.3 V appears at the LED's anode.
With the resistor open, the anode is cut off from the pin and has nothing to pull it up. The general rule: when no
current flows, walk one probe along the path from the supply end; the voltage stays at the supply value until you
pass the break.

Use the tool below to set the values and see the expected current.`,

    { t: 'widget', name: 'ohms-law', props: { v: 1.3, r: 330 }, caption: 'The resistor sees 1.3 V. Change the resistance and watch the current and the power dissipated.' },

    { t: 'predict', q: `A 10 kΩ resistor is wired from 3.3 V to a pin, with the board powered. Curious about its exact value, you switch the meter to resistance and put the probes across it without unplugging anything. What will the meter show, and why?`, choices: [
      { t: 'Close to 10 kΩ; the meter measures the component between its probes.', why: `The meter does not sense the component. It injects a test current and reads a voltage, and here the circuit is supplying voltages and current paths of its own.` },
      { t: 'An unreliable number: possibly negative, unstable or "OL".', ok: true, why: `The resistance function assumes the meter is the only source driving the thing between its probes.` },
      { t: 'Exactly 0 Ω, because the current already flowing cancels the meter\'s own test current.', why: `A reading of zero would mean no voltage between the probes. With a live circuit there generally is one, and it is not the one the meter created.` },
    ], reveal: `The meter computes R = V / I using the current *it* supplies. In a powered circuit the voltage between the probes is set mostly by the circuit, so the division produces nonsense. Even unpowered, the resistor is in parallel with whatever else connects those two nodes: here the pin's internal circuitry and anything else on the 3.3 V rail. The trustworthy procedure is: power off, lift one leg of the resistor, measure.` },

    `## What the other instruments add

A multimeter gives one number, averaged over a fraction of a second. That is the right tool for anything steady:
rails, logic levels held constant, continuity. It is blind to anything that changes quickly.

| Question | Instrument | Why |
|---|---|---|
| Is the rail 3.3 V? Is this wire connected? | Multimeter | A steady quantity |
| Which bytes went over UART, I2C or SPI, and in what order relative to another signal? | Logic analyser | Records many digital channels over time and decodes protocols. It reduces each sample to 0 or 1 |
| Does the rail dip when the radio transmits? Is this edge slow, ringing or noisy? What is this analogue sensor output doing? | Oscilloscope | Records the actual voltage waveform |

A pin toggling quickly between 0 V and 3.3 V reads on a multimeter as some value in between, close to the average.
A reading of about 1.6 V on a pin you expected to be "blinking fast" is therefore consistent with a square wave at
50% duty, and equally consistent with a pin stuck at half supply because two outputs are fighting. The meter cannot
tell these apart. Knowing what your instrument *cannot* see is part of using it.`,

    `## A method: observe, hypothesise, predict, test one change

1. **Observe.** State the symptom precisely and write it down: what you expected, what happened, and under what
   conditions. "It doesn't work" is not an observation. "No output on the serial port after reset; power LED on;
   port present in \`/dev\`" is.
2. **Hypothesise.** List the possible causes, more than one. Order them by how likely they are and how cheap they
   are to check. Cables, power and wiring come before compiler bugs.
3. **Predict.** For the hypothesis you will test, say what a measurement would show if it is true and what it would
   show if it is false. Prefer the measurement that separates the most hypotheses.
4. **Test one change.** Make the measurement, or change exactly one thing. Record the result. If you changed
   something and it did not help, put it back before the next change.
5. **Repeat** until a prediction is confirmed, then verify the fix by removing it: if undoing the fix brings the
   fault back, you have found the cause and not a coincidence.

The same loop is used on a breadboard, in a debugger and in a security analysis. Only the instruments change.`,

    { t: 'callout', kind: 'mistake', title: 'Stopping when it starts working', md: `You wiggle a wire and the circuit comes to life. The temptation is to move on. You have learned that *something* near that wire is intermittent, not what. Intermittent faults return at the worst time. Find the specific cause (a jumper with a broken strand, a pin not fully seated, a worn breadboard contact), replace it, and confirm with the continuity tester.` },

    `### Practise on a faulty circuit

The circuit below has one fault. Use the virtual probes as you would real ones: decide what a healthy circuit would
read at each point, then measure and compare. Resist changing parts until a measurement tells you which part.`,

    { t: 'widget', name: 'circuit-debug', props: { scenario: 'missing-ground' }, caption: 'Find the fault by measurement. State your hypothesis and the reading that would confirm it before you probe.' },

    `## Common first-week faults

Nearly every beginner meets most of these. Each has a one-measurement test.

| Fault | How it shows | Quick test |
|---|---|---|
| Charge-only USB cable | Board powers; no serial port | \`lsusb\` before and after plugging in |
| Breadboard power rail split in the middle | Half the board has no supply | Continuity along the rail |
| Component in the wrong row, or both legs in the same row | Part has no effect, or is shorted out | Continuity from the part's leg to where it should connect |
| LED or diode reversed | Dark; full voltage across it | Voltage across the LED; swap orientation |
| No common ground between two boards or a board and a module | Garbage or nothing on a signal that looks wired correctly | Continuity between the two ground pins |
| No current-limiting resistor | LED very bright, then dead; pin damaged | Look; measure the resistor's presence with power off |
| TX wired to TX | Nothing received in either direction | Check that each TX goes to the other side's RX |
| Module powered from 5 V driving a 3.3 V input | Works, then pins fail | Measure the signal's high level before connecting it |
| Wrong pin: board label differs from GPIO number | Code toggles a pin; nothing happens on the one you probed | Voltage on the pin the code names, located from the board's pinout diagram |
| Using a pin with a special role | Board fails to boot or flash with the circuit attached | Disconnect the circuit and retry; check the chip's strapping pins. On the original ESP32 they are GPIO0, 2, 5, 12 and 15, and GPIO34 to 39 are input-only. Other ESP chips use different pins: look them up for yours |
| Supply sagging under load | Random resets when a motor, servo or radio starts | Measure the rail under load; an oscilloscope shows the dip |
| Old firmware on the board | Behaviour does not match the code | Change a printed message, rebuild, flash, look for the new message |`,

    { t: 'exercise', prompt: `The LED circuit from the worked example (3.3 V pin, 330 Ω, red LED with about 2.0 V forward voltage) is built and working. Instead of using the meter's current range, you measure the voltage across the resistor and read 1.32 V. What current is flowing through the LED, in mA?`, hints: [
      `The resistor and LED are in series, so the same current flows through both.`,
      `Ohm's law on the resistor alone: I = V / R, with V the voltage across the resistor and R = 330 Ω.`,
    ], answer: { type: 'number', value: 4.0, tol: 0.1, unit: 'mA', why: 'You measured current without breaking the circuit or using the fused current input.' }, solution: `I = 1.32 V / 330 Ω = 0.0040 A = **4.0 mA**.

This indirect method is how current is usually measured on a bench: the meter stays in its safe, high-resistance voltage mode, the circuit is not disturbed, and there is no lead to forget in the current socket. Its accuracy is limited by the resistor's tolerance (typically 5% or 1%); measure the resistor out of circuit first if that matters.

It also confirms the model: 3.3 V − 1.32 V leaves 1.98 V across the LED, matching its expected forward voltage.` },

    `## Harder application: a fault that is not where the symptom is

An ESP32 board runs a program that prints a line every second and switches a small DC motor through a transistor
every ten seconds. Observed: the serial output stops and the boot log appears again each time the motor starts. The
board and the motor are both powered from the laptop's USB port through the board's 5 V pin.

Work through the method in your notebook before reading the notes:

1. State the observation precisely.
2. List at least three hypotheses, covering firmware, wiring and power.
3. For each, give one measurement or one single change, and what result would confirm it and what would refute it.
4. Which test do you run first, and why that one?

Notes for comparison. The boot log reappearing means the chip **reset**; it did not hang. Candidate causes: a
firmware crash in the motor code (the boot log's reset reason line and any crash dump would say so); the supply
dipping below the chip's minimum when the motor's start-up current flows (a multimeter is probably too slow to see
it, an oscilloscope on the 3.3 V rail would show it; the reset reason may report a brownout); electrical noise from
the motor coupling into the reset line. The cheapest decisive test changes one thing: disconnect the motor but
leave the code unchanged. If the resets stop, firmware is cleared and the cause is electrical. Then power the motor
from a separate supply with grounds joined; if the resets stay away, it was the shared supply. You will meet this
exact fault, and the diode and capacitors that go with the fix, in the Electronics section.`,
  ],
  quiz: [
    { kind: 'circuit', q: `You want to know how much current a sensor module draws from the 3.3 V rail. How must the multimeter be connected in its current range?`, choices: [
      { t: 'Red probe on 3.3 V, black probe on ground, with the module connected as normal.', why: `That places the meter, which is nearly a short circuit in this mode, directly across the supply.` },
      { t: `In series: open the module's supply wire and bridge the gap with the meter.`, ok: true, why: `The current to be measured must pass through the meter.` },
      { t: 'Across the module\'s supply and ground pins with the power off.', why: `With the power off no current flows, and across the pins is where a voltage measurement goes.` },
    ] },
    { kind: 'circuit', q: `Why is it wrong to measure a resistor's value while the circuit is powered?`, choices: [
      { t: `A resistor carrying current warms up, and its value while warm differs from the value printed on it.`, why: `The effect of temperature on an ordinary resistor at these power levels is tiny. The problem is how the meter obtains its reading.` },
      { t: `The meter derives resistance from its own small test current, and voltages already in the circuit corrupt that.`, ok: true, why: `The resistance function assumes the meter is the only source.` },
      { t: `The meter's test current will discharge the board's capacitors and reset the microcontroller.`, why: `The meter's test current is very small. The concern is the validity of the reading and the meter's input.` },
    ] },
    { kind: 'circuit', q: `An LED circuit is dark. You measure 3.3 V from the pin to ground, 0 V across the series resistor and 3.3 V across the LED. Which fault fits all three readings?`, choices: [
      { t: `The firmware is driving the pin low, so nothing reaches the LED.`, why: `The pin measured 3.3 V to ground, so it is being driven high.` },
      { t: `The LED is reversed or open: it blocks, so it takes the whole voltage.`, ok: true, why: `Zero volts across the resistor means zero current. The element that has the full voltage across it is the one blocking.` },
      { t: `The resistor value is far too high, so it leaves too little current to light the LED.`, why: `A resistor that was merely too large would still carry some current and would show a voltage across it.` },
    ] },
    { kind: 'concept', q: `A pin is supposed to output a 1 kHz square wave between 0 V and 3.3 V. Your multimeter on DC volts reads a steady 1.65 V. What can you conclude?`, choices: [
      { t: `The pin is faulty and stuck at half supply, because a working square wave would make the reading flicker.`, why: `That is one possibility, but a meter that averages would show the same number for a healthy 50% square wave.` },
      { t: `The reading fits a 50% square wave, but the meter cannot tell that from a steady 1.65 V; use an oscilloscope.`, ok: true, why: `A multimeter reports an average. Different waveforms with the same average look identical to it.` },
      { t: `The output is working, and the steady reading shows that its frequency is stable at 1 kHz.`, why: `A DC voltage reading carries no information about frequency.` },
    ] },
    { kind: 'concept', q: `Your board prints garbage on the serial port. You simultaneously change the baud rate in the terminal, swap the USB cable and re-flash. The output is now clean. What is wrong with this as a debugging step?`, choices: [
      { t: `Nothing: the output is clean, and the aim of debugging is a working board, not an explanation.`, why: `The symptom has gone, but you cannot say why, so you cannot prevent or quickly fix it next time.` },
      { t: `You cannot tell which of the three changes mattered.`, ok: true, why: `One change per test is what lets a result confirm or refute a specific hypothesis.` },
      { t: `The order was wrong: re-flashing should always come before any change to cables or settings.`, why: `No fixed ordering of changes makes up for making several of them together.` },
    ] },
    { kind: 'concept', q: `After the last measurement of the day, a current reading, you leave the red lead in the mA socket. Next morning you put the probes on the 5 V and ground pins of a board powered from a battery pack to check the supply. What happens?`, choices: [
      { t: `The meter shows 5 V as usual, because the dial position decides what is measured, not the socket.`, why: `Which socket the lead is in determines the path inside the meter, regardless of the dial. Through the current socket that path has almost no resistance.` },
      { t: `The meter is nearly a short across the supply; a large current flows until its fuse blows.`, ok: true, why: `In the current input the meter is deliberately close to a short circuit.` },
      { t: `The meter shows the current the board is drawing, since it is now set up for current.`, why: `To read the board's current the meter would have to be in series with the board. Here it is in parallel with it, across the source.` },
    ] },
  ],
};

export default [toolchains, tools, measuring];
