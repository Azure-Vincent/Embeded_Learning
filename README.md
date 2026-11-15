# Bench — embedded systems engineering and hardware security

An interactive course that takes a learner from Ohm's law to designing, debugging, analysing and securing a
multi-device embedded system, with a dedicated track for MITRE eCTF-style competition work.

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

`dist/` holds single-file launchers that contain the whole course. They need no installation:

| Platform | File | Start it |
|---|---|---|
| Windows (64-bit Intel/AMD) | `dist/bench-windows-x86_64.exe` | double-click it |
| Linux (64-bit Intel/AMD) | `dist/bench-linux-x86_64` | `chmod +x bench-linux-x86_64 && ./bench-linux-x86_64` |

The launcher serves the course on `http://localhost:47800/` (this computer only) and opens your default browser.
Close its window, or press Ctrl+C, to stop. Progress is saved in the browser for that address, so keep using the
same port; `--port N` changes it and `--no-browser` suppresses opening the browser. The executables are not
code-signed, so Windows SmartScreen may ask for confirmation the first time ("More info" → "Run anyway").

To rebuild them, including ARM64 variants, install Go 1.22 or newer and run `./desktop/build.sh`.

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

Current size: 135 lessons, 35 laboratories and projects (including ten ESP32 build projects, five practice
scenarios and six capstones), 956 assessment questions, 73 C exercises that execute in the built-in interpreter,
46 interactive tools, and 339 unit tests over the simulation models.

Sections, in prerequisite order: Foundations, Electronics, Microcontroller Architecture, ESP32 Development,
Embedded C, Communication Protocols, Real-Time Systems, Hardware Debugging, Firmware Engineering,
Embedded Security, eCTF Preparation, Capstone Projects.

## How progress works

- A lesson is **mastered** by scoring 80% on its assessment counting first attempts only. A wrong answer shows
  why it is wrong and lets the learner retry, but does not count.
- A section **unlocks** when 80% of the lessons in each prerequisite section are mastered, or when the learner
  passes that section's checkpoint test. Settings has a review mode that opens everything for instructors.
- A laboratory is recorded as either **built and tested on real hardware** or **completed without hardware**.
  The skills matrix keeps those apart; only the learner can attest to the first.
- The dashboard's proficiency and competition-readiness figures are computed from demonstrated skill levels,
  not from pages visited.

## What is real and what is simulated

Read this before trusting any number in the app.

- **Nothing in this repository was run on physical hardware.** ESP-IDF, MSDK and TI SDK code is written against
  vendor documentation and labelled as such next to every listing. Build it and trust your own result.
- Code labelled *host-tested* was compiled with `gcc -Wall -Wextra -std=c11` and run on Linux.
- Every interactive tool is a model and says what it leaves out. The C lab runs a C subset on **Bench-MCU**, a
  fictional microcontroller documented in `docs/BENCH_MCU.md`; its register map matches no real chip.
- Chip-specific facts and every statement about which hardware a given eCTF year used come from
  `docs/FACTS.md`, which was compiled from the official MITRE and vendor repositories on GitHub. Vendor
  websites, datasheet PDFs and the eCTF rules site could not be reached from the environment this was built in,
  so the fact sheet has an explicit **UNVERIFIED** list. The course text flags those items instead of guessing.
  Before buying hardware or relying on a specification, check the manufacturer's datasheet and that year's
  official eCTF rules.
- The practice scenarios are original to this course. They follow the shape of eCTF work (a specification,
  security requirements, an insecure reference design, then review and hardening) and are **not** official
  MITRE challenges.
- Security material is taught against fictional devices simulated in the page, with detection, defence and
  verification beside every weakness. Only test real equipment that you own or are authorised to assess.

## Develop

```bash
node tests/validate.mjs            # schema, quiz rules, widget names; runs every C-lab solution against its tests
node tests/validate.mjs esp32      # one section
node --test tests/*.test.mjs       # unit tests for the simulation models
```

- Adding or editing lessons: `docs/CONTENT_GUIDE.md`.
- Adding or editing tools: `docs/WIDGET_GUIDE.md`.

## Primary sources

The in-app "Primary sources" page lists the manufacturer, standards and competition documents the course is
written against. When the app and a datasheet disagree, the datasheet is right.
