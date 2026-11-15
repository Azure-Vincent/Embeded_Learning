# idf-check: compile the course's ESP-IDF programs

This tool extracts every complete ESP-IDF program from `js/content/` and builds it for the `esp32`
target with ESP-IDF v6.1. It is what backs the `idf-built` code status in `docs/CONTENT_GUIDE.md`.
The latest full run is recorded in [RESULTS.md](RESULTS.md).

| File | Purpose |
|---|---|
| `extract.mjs` | Walks every lesson and lab, writes one ESP-IDF project per program to `build/<id>/`, and writes `build/manifest.json` |
| `build-all.sh` | Runs `extract.mjs`, builds each project, prints a pass/fail table, rewrites `RESULTS.md` after a full run |
| `report.mjs` | Formats `RESULTS.md` (called by `build-all.sh`) |
| `overrides/<id>/` | Optional. Files copied over the extracted project, for example an `sdkconfig.defaults` that the lesson prose asks for |
| `build/` | Generated, git-ignored |

## Run it

```bash
tools/idf-check/build-all.sh                  # everything; rewrites RESULTS.md (about 30 s per program)
tools/idf-check/build-all.sh esp-p8-5         # one program (or several ids); RESULTS.md is left alone
tools/idf-check/build-all.sh --clean esp-p8-5 # delete that project's build output first
node tools/idf-check/extract.mjs              # only extract and list ids
```

`build-all.sh` sources `$IDF_PATH/export.sh` itself if `idf.py` is not already on the `PATH`
(`IDF_PATH` defaults to `/home/user/espressif/esp-idf`). A second build of an unchanged program takes a
few seconds, because each project keeps its own `build/<id>/build/` directory. The full compiler output of
a program is in `build/<id>/build.log`.

To use the toolchain by hand:

```bash
export IDF_PYTHON_CHECK_CONSTRAINTS=no
. /home/user/espressif/esp-idf/export.sh
cd tools/idf-check/build/esp-p8-5 && idf.py -B build -DIDF_TARGET=esp32 build
```

## What "pass" means

`idf.py build` exited 0: CMake configured the project, every source file compiled with the default
ESP-IDF warning flags (several warnings are errors there), and the app image linked for the ESP32.

It does **not** mean the program was run. Nothing here is flashed to a board, so a pass says nothing
about pin choices, timing, or run-time behaviour. A listing that passes may be marked `idf-built`,
never `hw`. The `WARN` column counts compiler warnings in the course's own files (`main/`), not in ESP-IDF.

## What gets extracted

- A listing is a **program** if it is C or C++, defines `void app_main(`, and includes at least one
  ESP-IDF header. Code blocks, lab step code, `predict` and `exercise` code, and fenced code inside any
  Markdown string (including exercise solutions) are all searched.
- The **id** is `<lesson or lab id>-<n>`. `n` is the position of the listing among *all* code listings of
  that lesson or lab in document order, counting from 0. Adding or removing a listing earlier in the same
  lesson shifts the ids after it; `build/manifest.json` and RESULTS.md give the content path
  (for example `.steps[2].blocks[2]`) and the caption for every id.
- A listing that defines `app_main` but has no `#include` lines is treated as the last part of a program
  built up over several steps: the C listings of the same kind directly before it are prepended, back to
  the one that has the includes (`joinedFrom` in the manifest). If there is nothing to join, it is a
  fragment and is listed as "not built".
- A listing whose text is identical to an earlier program (an annotated copy in a walkthrough) is not
  built twice; it is reported as "same as `<id>`".
- **Other files from the same lesson or lab** are added to the project:
  - a listing containing `idf_component_register(` becomes `main/CMakeLists.txt`, and one containing
    `include($ENV{IDF_PATH}/…)` becomes the top-level `CMakeLists.txt` (a listing showing both is split);
  - a listing captioned `Kconfig…`, `idf_component.yml`, `sdkconfig.defaults` or `partitions.csv`;
  - C sources and headers whose caption starts with a file name (`frame.h`, `net_util.c`). They are all
    written to `main/`; only the ones named in `SRCS` are compiled.
  The nearest such listing before the program is used, otherwise the nearest after it.
- **If the lab gives no `main/CMakeLists.txt`**, one is generated, with `PRIV_REQUIRES` inferred from the
  `#include` lines by looking the headers up under `$IDF_PATH/components`. RESULTS.md shows the inferred
  list; it is the list a learner would have to write. **If the lab gives no top-level `CMakeLists.txt`**,
  the tool writes the v6.1 `hello_world` one, which sets `MINIMAL_BUILD ON`. With that property the
  `main` component sees only the components it names, so a course `main/CMakeLists.txt` with a missing
  component fails here exactly as it would for a learner who started from `hello_world`.
- No `sdkconfig.defaults` is invented. A program that needs a menuconfig option (Bluetooth, a FreeRTOS
  trace option) fails until the lab supplies the file or a reviewer adds `overrides/<id>/sdkconfig.defaults`.

## Checking a fragment that is not a complete program

Most listings in the course are fragments: one function, or "add these lines". To check one, compile it
inside a scratch component. Keep the scratch project outside the repo, or under `build/`.

```bash
export IDF_PYTHON_CHECK_CONSTRAINTS=no
. /home/user/espressif/esp-idf/export.sh
mkdir -p /home/user/espressif/work/scratch/main && cd /home/user/espressif/work/scratch
cat > CMakeLists.txt <<'EOF'
cmake_minimum_required(VERSION 3.22)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(scratch)
EOF
cat > main/CMakeLists.txt <<'EOF'
idf_component_register(SRCS "main.c" "fragment.c" INCLUDE_DIRS "."
                       PRIV_REQUIRES esp_driver_gpio esp_timer)   # the components the fragment uses
EOF
printf '#include "freertos/FreeRTOS.h"\nvoid app_main(void) { }\n' > main/main.c
```

Then write `main/fragment.c`:

1. the `#include` lines the lesson says the fragment needs;
2. declarations for anything the fragment says is "your own code" (`extern int read_adc(void);`), so the
   compiler can type-check the calls without you inventing a body;
3. the fragment itself, pasted unchanged. If it is statements rather than functions, wrap it in
   `void fragment_check(void) { … }`.

Build with `idf.py -B build -DIDF_TARGET=esp32 build`. To compile only the fragment, without linking, run
`ninja -C build esp-idf/main/CMakeFiles/__idf_main.dir/fragment.c.obj` after the first configure.
A fragment checked this way, with nothing but declarations added, has had every call, type and constant
checked by the compiler, which is at least `idf-checked`. Do not mark it `idf-built`: that status is for
complete programs built by this tool.

## Installing the toolchain (as done on this machine, 2026-11-15)

Everything lives outside the repo: the ESP-IDF tree in `/home/user/espressif/esp-idf`, tools and the
Python environment in `~/.espressif` (about 2.6 GB together).

```bash
git clone --depth 1 -b v6.1 https://github.com/espressif/esp-idf.git /home/user/espressif/esp-idf
cd /home/user/espressif/esp-idf
git submodule update --init --depth 1 --recursive     # all 24 submodules, under a minute
./install.sh esp32                                    # tools download from github.com release assets
# If the last step of install.sh fails on espidf.constraints.v6.1.txt (see below):
export IDF_PYTHON_CHECK_CONSTRAINTS=no
python3 tools/idf_tools.py install-python-env
. ./export.sh
```

Obstacles met, and what was done about them:

- **`dl.espressif.com` is blocked by the network policy here (HTTP 403 from the proxy).** The tool
  archives (xtensa-esp-elf gcc 15.2.0, gdb, openocd, ULP toolchain, ROM ELFs) are unaffected:
  `idf_tools.py` took all of them from `github.com/espressif/*/releases`. The one file that only exists on
  `dl.espressif.com` is the pip constraints file `espidf.constraints.v6.1.txt`, so `install.sh` stopped
  when creating the Python environment. Setting `IDF_PYTHON_CHECK_CONSTRAINTS=no` skips that file;
  `install-python-env` then installed the packages from PyPI at their current versions
  (esptool 5.6.0, esp-idf-kconfig 3.14.0, …). The variable must also be set before `export.sh`, which
  otherwise tries to download the same file. Consequence: Python tool versions are not pinned to
  Espressif's tested set. The compiler and ESP-IDF sources are exactly v6.1.
- `ccache` could not be installed with apt here. It is not needed; ESP-IDF uses it automatically if present.
- Host prerequisites that were already present: git, cmake 3.28, ninja 1.11, Python 3.13, node 22.

Sanity check of the installation: `examples/get-started/hello_world`, copied to
`/home/user/espressif/work/hello_world`, builds with `idf.py set-target esp32 build` in under a minute.
