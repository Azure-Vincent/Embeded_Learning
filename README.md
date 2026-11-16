# Mitre Prep Tool — embedded systems engineering and hardware security

An interactive course that takes a learner from Ohm's law to designing, debugging, analysing and securing a
multi-device embedded system, with a dedicated track for MITRE eCTF-style competition work.

An independent course; not affiliated with or endorsed by The MITRE Corporation. The practice scenarios are original to this course and are not MITRE eCTF material.

It is a static web application: plain ES modules, no build step, no dependencies, no server-side code.
Progress, notes and bookmarks are stored in the learner's browser.

## Run it

```bash
git clone <this repository> && cd Embeded_Learning
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any static file server works; opening `index.html` from the file system
does not, because browsers refuse to load ES modules from `file://`. The cryptography tools need `localhost`
or https (WebCrypto is unavailable on plain http from another host).

### Standalone executables

`dist/` holds single-file builds that contain the whole course. They need no installation:

| Platform | File | Start it |
|---|---|---|
| Linux (64-bit Intel/AMD) | `dist/Mitre_Prep_Tool-x86_64.AppImage` | `chmod +x Mitre_Prep_Tool-x86_64.AppImage`, then double-click it or run `./Mitre_Prep_Tool-x86_64.AppImage` |
| Windows (64-bit Intel/AMD) | `dist/mitre-prep-tool-windows-x86_64.exe` | double-click it |
| Linux, plain binary | `dist/mitre-prep-tool-linux-x86_64` | `chmod +x mitre-prep-tool-linux-x86_64 && ./mitre-prep-tool-linux-x86_64` |

Each one serves the course on `http://localhost:47800/` (this computer only) and opens your default browser; the
course runs in a browser tab, not its own window. To stop it, close its terminal window or press Ctrl+C. It also
stops by itself ten minutes after the last course tab is closed, which is how an AppImage started by double-click
ends. Progress is saved in the browser for that address, so keep using the same port. Options: `--port N`,
`--no-browser`, `--idle-exit 0` (never stop by itself).

- The AppImage needs FUSE 2 (`libfuse2`; on Ubuntu 24.04 the package is `libfuse2t64`). Without it, run
  `./Mitre_Prep_Tool-x86_64.AppImage --appimage-extract-and-run`, or use the plain binary.
- The executables are not code-signed, so Windows SmartScreen may ask for confirmation the first time
  ("More info" → "Run anyway").

To rebuild: install Go 1.22 or newer and run `./desktop/build.sh` (also produces ARM64 variants), then
`./desktop/build-appimage.sh /path/to/runtime-x86_64` to package the AppImage (see the script header).

## What is in it

| Area | Where | Notes |
|---|---|---|
| Curriculum (12 sections) | `js/content/` | Lessons, guided laboratories, projects, scenarios, capstones |
| Interactive tools | `js/widgets/`, models in `js/sim/` | Circuit simulator, virtual breadboard, bus visualisers, logic analyser, CPU and memory visualisers, RTOS scheduler, C interpreter, debugger and firmware-inspection simulations, security simulations |
| App shell | `js/app.js`, `js/core/` | Routing, rendering, mastery tracking, prerequisites, skills matrix, notebook, glossary, search |
| Host-buildable example code | `examples/` | Plain C that was compiled and run with GCC, with Makefiles and tests |
| Synthetic firmware images | `tools/fwimages/` | C sources and build script (clang, lld) for the images used by the debugger, inspector and disassembly tools |
| Author documentation | `docs/` | Content schema, widget contract, the simulated MCU, and the sourced fact sheet |
| Tests | `tests/` | Content validator and unit tests for the simulation models |

Current size: 135 lessons, 35 laboratories and projects (ten ESP32 build projects, five practice scenarios, six
capstones), 972 assessment questions, 81 C exercises that execute in the built-in interpreter, 361 tracked practice
items, 47 interactive tools, and 360 unit tests over the simulation models and core logic.

Sections, in prerequisite order: Foundations, Electronics, Microcontroller Architecture, ESP32 Development,
Embedded C, Communication Protocols, Real-Time Systems, Hardware Debugging, Firmware Engineering,
Embedded Security, eCTF Preparation, Capstone Projects.

## How progress works

- A lesson is **mastered** by scoring 80% on its assessment counting first attempts only. A wrong answer shows
  why it is wrong and lets the learner retry, but does not count.
- **Review**: questions from mastered lessons return at growing intervals (1, 3, 7, 16, 35 days). A miss sends the
  question back to tomorrow and links the lesson. The dashboard shows what is due.
- A section **unlocks** when 80% of the lessons in each prerequisite section are mastered, or when the learner
  passes that section's checkpoint test, which draws at least one question from every lesson. Capstones and
  scenarios also lock behind their own prerequisites. Settings has a review mode that opens everything.
- **Practice** lists every exercise and tool challenge in the course with its done state and a direct link, and
  can be filtered to C programming.
- A laboratory is recorded as either **built and tested on real hardware** or **completed without hardware**.
  The skills matrix keeps those apart; only the learner can attest to the first.
- The dashboard shows demonstrated proficiency per track, first-attempt accuracy by question type (concepts, code
  reading, circuit analysis, architecture, security reasoning), competition readiness and a prerequisite map.

## What is real and what is simulated

Read this before trusting any number in the app. Every code listing carries a label saying how it was checked.

- **Nothing in this repository was run on physical hardware.** Lab results are phrased as what you should see.
- **ESP-IDF code.** 41 listings are complete programs that were compiled for the `esp32` target with ESP-IDF v6.1
  (*idf-built*), including every program in the ESP32 lessons and all ten projects. Another 39 fragments had every
  call checked against the v6.1 headers (*idf-checked*). `tools/idf-check/` holds the extraction and build scripts
  and the results table, so the check can be repeated. Compiling is not running: none of it was flashed.
- **Plain C.** 117 listings were compiled with `gcc -Wall -Wextra -std=c11` and run on Linux (*host-tested*); the
  larger ones live in `examples/` with Makefiles and tests.
- **Still only reviewed against documentation** (55 listings): mostly shell commands, MSDK and TI SDK fragments, and
  Cortex-M code that needs a toolchain not available here.
- Every interactive tool is a model and says what it leaves out. The C lab runs a C subset on **Bench-MCU**, a
  fictional microcontroller documented in `docs/BENCH_MCU.md`; its register map matches no real chip. Its
  electrical tools use typical teaching values, not the limits of a particular part.
- **Hardware and eCTF facts** are in `docs/FACTS.md` with their sources. Round 1 used the official MITRE and
  vendor repositories on GitHub; round 2 read the TI datasheet and technical reference manual, the Espressif
  datasheets and advisories, and the MITRE eCTF rules site for 2024 to 2026. Analog Devices' website could not be
  reached, so several MAX78000 datasheet items remain on the fact sheet's **UNVERIFIED** list and the lessons
  flag them. Many reference links to other sites (Arm, FreeRTOS, NXP, USB-IF and others) were not load-tested.
  Before buying hardware or relying on a specification, check the manufacturer's datasheet and that year's rules.
- The practice scenarios are original to this course. They follow the shape of eCTF work (a specification,
  security requirements, an insecure reference design, then review and hardening) and are **not** official
  MITRE challenges.
- Security material is taught against fictional devices simulated in the page, with detection, defence and
  verification beside every weakness. Only test real equipment that you own or are authorised to assess.

## Develop

```bash
node tests/validate.mjs            # schema, quiz rules, widget names, answer-length bias; runs every C exercise
node tests/validate.mjs esp32      # one section
node --test tests/*.test.mjs       # unit tests for the simulation models and core logic
node tests/quiz-bias.mjs           # how often the keyed answer is the longest option, per section
tools/idf-check/build-all.sh       # compile every ESP-IDF program in the course (needs ESP-IDF v6.1; see its README)
```

- Adding or editing lessons: `docs/CONTENT_GUIDE.md`.
- Adding or editing tools: `docs/WIDGET_GUIDE.md`.

## Primary sources

The in-app "Primary sources" page lists the manufacturer, standards and competition documents the course is
written against. When the app and a datasheet disagree, the datasheet is right.
