# Widget guide

Interactive tools live in `js/widgets/<name>.js`, one file per name registered in `js/widgets/registry.js`.

```js
import { h, s, clear, fmtSI, hex } from '../core/dom.js';
export default function mount(el, props, ctx) { /* build DOM inside el */ }
```

- `h(tag, attrs, ...kids)` builds HTML, `s(tag, attrs, ...kids)` builds SVG. `attrs.class`, `attrs.onclick`, `attrs.html`.
- `props` — every prop is optional; with `{}` the widget must work as a free-play tool (the Workbench mounts it that way).
- `ctx.complete()` — call when the learner solves the challenge the widget poses. `ctx.isDone()` tells you if it was solved before.
- No dependencies, no network, no global state, no timers left running after the element is removed
  (check `el.isConnected` in animation loops).
- Must work at 360 px width, by keyboard, in light and dark themes. Use CSS variables only — never hard-code colours:
  `--ink --muted --line --surface --sunk --mask --copper --ok --bad --warn --link` and signal colours `--sig1…--sig6`.
- Shared classes in `css/app.css`: `.w-grid .w-controls .w-field .w-readout(.k/.v) .w-svg .w-note .w-msg(.ok/.bad/.warn)
  .w-task .w-tabs/.w-tab(.on) .w-term .w-term-in .w-mono .w-kv .w-bits/.w-bit(.on) .btn(.small/.ghost) .row`.
  Group-specific styles go in `css/w-<group>.css`, prefixed with the widget name.
- Label what is modelled and what is not. A widget is a *model*; add a `.w-note` naming its important simplifications
  (e.g. "ideal op-amp", "no bus capacitance", "timing not to scale").
- When a widget poses a task, show it in a `.w-task` box, give specific feedback on wrong attempts (what the learner's
  answer would do on real hardware), and never reveal the answer before an attempt.
- Pure logic (solvers, encoders, decoders, simulators) should be exported as named functions so `tests/*.test.mjs`
  can test them under `node --test` without a DOM.

## Catalogue and props contract

Content authors rely on these names and props. Implementations may add props but must honour these.
`challenge`/`scenario`/`device` props select a built-in task; each widget exports `CHALLENGES` (or `SCENARIOS`/`DEVICES`),
an object keyed by id with at least `{ title }`, so content can be validated.

### Electronics (`css/w-electronics.css`)
| name | props | behaviour |
|---|---|---|
| `ohms-law` | `{v, r}` | V/I/R/P explorer with a drawn circuit; shows power vs a resistor's rating |
| `resistor-code` | `{mode:'explore'|'quiz'}` | 4- and 5-band colour code ↔ value/tolerance, E12/E24 nearest value; quiz mode poses values |
| `series-parallel` | `{}` | build a small series/parallel network, see equivalent R, each branch current and drop |
| `voltage-divider` | `{vin, r1, r2, load, challenge}` | divider with optional load and ADC reading; challenges: `level-shift-5v-3v3`, `adc-battery`, `loaded` |
| `rc-circuit` | `{r, c, mode:'charge'|'debounce'}` | RC step response, τ, threshold crossing; debounce mode shows a bouncing switch filtered |
| `led-resistor` | `{vsupply, vf, challenge}` | choose a resistor for an LED from a GPIO; shows current vs pin limit; challenge `gpio-3v3-red` |
| `transistor-switch` | `{type:'nmos'|'npn', challenge}` | low-side switch driving a load from a GPIO; gate threshold, base resistor, flyback diode; challenge `motor` |
| `breadboard` | `{challenge}` | place parts on a breadboard, wire them, simulate DC behaviour, diagnose faults. Challenges: `led`, `button-pullup`, `divider`, `two-leds`, `free` |
| `circuit-debug` | `{scenario}` | a faulty circuit with virtual multimeter probes; learner finds the fault. Scenarios: `led-reversed`, `missing-ground`, `floating-input`, `no-current-limit`, `brownout`, `wrong-rail` |
| `gpio-electrical` | `{}` | one GPIO pin: output push-pull/open-drain, input with pull-up/pull-down/floating, external circuit, logic thresholds |
| `pwm-lab` | `{freq, duty, bits}` | PWM waveform, average voltage, LED/motor effect, LEDC-style resolution-vs-frequency trade-off |
| `adc-lab` | `{bits, vref}` | sampling, quantisation steps, code↔voltage, aliasing when sample rate is too low |

### Architecture (`css/w-architecture.css`)
| name | props | behaviour |
|---|---|---|
| `mcu-block-diagram` | `{platform:'generic'|'esp32'|'max78000'|'mspm0l2228'}` | clickable CPU/memory/bus/peripheral diagram; each block explains its role |
| `memory-map` | `{platform}` | address-space explorer with regions, sizes, what lives there; "where does this address live?" quiz |
| `cpu-stepper` | `{program}` | tiny load/store CPU: step fetch–decode–execute, watch PC, registers, flags, memory, a memory-mapped LED port |
| `interrupt-flow` | `{arch:'cortex-m'|'riscv'}` | step through an interrupt: pending, stacking/CSR save, vector fetch, ISR, return; nested priority case |
| `stack-heap` | `{program}` | step a small C program and watch .data/.bss, stack frames and heap allocations, including stack overflow |
| `endianness` | `{value}` | a 32-bit value laid out in memory little vs big endian; cast-to-bytes and network-order tasks |
| `boot-sequence` | `{platform:'generic'|'esp32'|'max78000'|'mspm0l2228'}` | reset → ROM → bootloader → app steps, with what is verified at each stage |
| `timer-lab` | `{mode:'timer'|'watchdog'}` | clock → prescaler → counter → compare/overflow; compute a period; watchdog feed/timeout timeline |
| `register-bits` | `{challenge}` | 32-bit register with clickable bits and C expression input (`reg |= 1 << 5`); challenges: `set-bit`, `clear-bit`, `toggle`, `field-write`, `field-read` |

### Real-time (`css/w-architecture.css`)
| name | props | behaviour |
|---|---|---|
| `rtos-scheduler` | `{scenario}` | Gantt-style scheduler simulation. Scenarios: `preemptive`, `cooperative`, `round-robin`, `priority-inversion`, `priority-inheritance`, `deadlock`, `isr-defer`, `starvation`; editable priorities/periods |
| `race-condition` | `{scenario:'counter'|'check-then-act'}` | interleave two tasks' load/add/store steps by hand to make an update disappear, then fix with a critical section |

### Firmware (`css/w-firmware.css`)
| name | props | behaviour |
|---|---|---|
| `c-lab` | see below | C editor + interpreter with a simulated MCU |
| `struct-layout` | `{source}` | struct definition → field offsets, padding, sizeof on a 32-bit ABI; reorder challenge; packed toggle |
| `state-machine` | `{machine:'debounce'|'uart-parser'|'door-lock'}` | step a firmware state machine with input events; shows the C `switch` it corresponds to |

#### `c-lab` props
```js
{ title, prompt: 'markdown task', starter: 'C source', solution: 'C source',
  tests: [ { name, stdin?, gpioIn?, uartRx?, adc?: [..], ticks?,           // inputs
             stdout?, stdoutIncludes?, exit?, regs?: {GPIO_OUT: 0x20}, uartTx?, mem?: [{sym|addr, size, value}] } ],  // expectations
  hints: ['md'], explain?: 'md shown after passing', readOnly?: false }
```
The interpreter (`js/sim/cinterp.js`) runs a C subset on a simulated 32-bit little-endian machine (ILP32) with
byte-addressable memory, so pointer casts, unions, struct layout and out-of-bounds writes behave as on a real MCU.
It is a teaching simulator named **Bench-MCU**; its register map is documented in `docs/BENCH_MCU.md`.
Supported C is listed there too. No floating point is required by the course exercises.

### Protocols (`css/w-protocols.css`)
| name | props | behaviour |
|---|---|---|
| `uart-terminal` | `{baud, format, peer}` | terminal to a simulated device plus the frame waveform of each byte; mismatched baud/parity produce realistic garbage/framing errors |
| `i2c-visualizer` | `{device:'tmp102'|'eeprom'|'scan'}` | SDA/SCL waveform for start, address, R/W, ACK/NACK, data, repeated start, stop; clock stretching; missing pull-up fault |
| `spi-analyzer` | `{mode}` | CS/SCLK/MOSI/MISO for a transaction in modes 0–3, bit order; wrong-mode fault shows shifted data |
| `can-arbitration` | `{}` | two or three nodes transmit IDs bit by bit on a wired-AND bus; shows who backs off and why |
| `packet-explorer` | `{challenge}` | byte-level frame: preamble, length, type, payload, CRC; live checksum/CRC-8/CRC-16; corrupt a bit and see detection; challenges `fix-crc`, `find-length-bug` |
| `logic-analyzer` | `{capture}` | multi-channel capture with cursors and decoders; learner decodes it. Captures: `uart-9600-hello`, `uart-unknown-baud`, `i2c-read`, `spi-mode0`, `spi-mode3`, `mystery` |
| `protocol-debug` | `{scenario}` | diagnose a broken link from symptoms and captures. Scenarios: `tx-rx-swapped`, `baud-mismatch`, `no-pullups`, `wrong-address`, `spi-mode`, `no-common-ground`, `level-mismatch` |

### Debugging (`css/w-security.css`)
| name | props | behaviour |
|---|---|---|
| `debug-session` | `{scenario:'hardfault'|'stuck-loop'|'bad-pointer'|'tour'}` | scripted GDB+OpenOCD console against a simulated Cortex-M target: break, step, info registers, x/, bt; find the bug |
| `firmware-inspector` | `{image:'demo'|'lockbox'|'updater'}` | hex view, strings, section/vector-table decode of bundled synthetic firmware images; find-the-secret tasks |
| `disasm-lab` | `{arch:'thumb'|'riscv', challenge}` | annotated disassembly of small functions; identify what the function does, find the compare, the loop, the call |

### Security (`css/w-security.css`)
| name | props | behaviour |
|---|---|---|
| `stack-smash` | `{mitigation:'none'|'canary'|'bounds'}` | type input into a fixed buffer; watch saved registers and return address get overwritten; redirect to `unlock()` |
| `integer-overflow` | `{challenge:'length-check'|'alloc-size'}` | fixed-width arithmetic explorer and a length-check bypass via wraparound |
| `timing-attack` | `{defence:'none'|'constant-time'}` | recover a PIN byte by byte from simulated comparison time; then see constant-time compare remove the signal |
| `glitch-sim` | `{defence:'none'|'double-check'|'random-delay'}` | sweep glitch offset/width against a simulated signature check; statistical success map; defences change it |
| `secure-boot-chain` | `{platform:'generic'|'esp32'}` | ROM → bootloader → app chain; tamper with a stage, swap a key, roll back a version, and see where boot stops |
| `replay-attack` | `{defence:'none'|'counter'|'nonce'}` | capture and replay an unlock message between two devices; add counter or challenge–response and retry |
| `crypto-lab` | `{tab:'hash'|'hmac'|'sign'|'aead'}` | real WebCrypto: SHA-256 avalanche, HMAC verify, ECDSA P-256 sign/verify with tamper, AES-GCM with nonce reuse demo |
| `threat-model` | `{template:'smart-lock'|'hsm'|'blank'}` | worksheet: assets, adversaries, entry points, STRIDE-style threats, mitigations; export to the notebook as Markdown |
| `vuln-device` | `{device}` | UART console of an intentionally vulnerable simulated device; find the flag. Devices: `debug-backdoor`, `hardcoded-pin`, `format-leak`, `overflow-auth`, `replay-fob`, `rollback-updater`, `weak-prng` |
| `platform-compare` | `{}` | side-by-side ESP32 / MAX78000 / MSPM0L2228 on selectable axes, with source links; facts from `docs/FACTS.md` only |
