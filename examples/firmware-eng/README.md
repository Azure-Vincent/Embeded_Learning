# firmware-eng examples: a portable, tested firmware module

A small door-lock controller written the way the *Firmware engineering* section of the course
recommends: hardware-independent logic behind a five-function HAL, unit-tested on a PC.

Nothing here has been run on physical hardware. The host build and tests were run with
GCC 13.3 on x86-64 Linux.

## Layout

| Path | What it is |
|---|---|
| `include/ringbuf.h`, `src/ringbuf.c` | Single-producer/single-consumer byte FIFO |
| `include/line_rx.h`, `src/line_rx.c` | Bytes to lines, with over-long lines discarded |
| `include/lock.h`, `src/lock.c` | Door-lock state machine: auto-relock timeout, lockout after 3 wrong PINs |
| `include/app.h`, `src/app.c` | Application: command lines in, replies and pin levels out |
| `include/hal.h` | The only hardware interface the application uses |
| `port/hal_fake.c`, `port/hal_fake.h` | HAL for unit tests: scripted input, recorded output, settable clock |
| `port/hal_posix.c`, `port/main_posix.c` | HAL and main loop for running as a PC program |
| `port/hal_benchmcu.c` | HAL for Bench-MCU, the course's simulated MCU (compile-checked on the host) |
| `port/hal_esp32.c`, `port/main_esp32.c` | HAL and entry point for ESP-IDF. **Reviewed only: not compiled or run here** |
| `tests/` | Unit tests and the tiny `test.h` harness |
| `bugs/line_rx_oob.c` | A deliberately buggy line receiver for the sanitizer demonstration |
| `bugs/stack_hog.c` | Functions with large, recursive and dynamic stack frames for `-fstack-usage` |

## Commands

```
make test        # build all unit tests with ASan + UBSan and run them
make demo        # build build/doorlock; run it and type commands
make port-check  # compile the Bench-MCU HAL against hal.h
make su          # print per-function stack usage for bugs/stack_hog.c
make inspect     # size / nm / readelf on the demo, and write build/doorlock.map
make bug-demo    # run the buggy line receiver under the sanitizers (reports an error on purpose)
make analyze     # gcc -fanalyzer over the sources
make clean
```

Requirements: GCC (10 or later for `-fanalyzer`), GNU Make, binutils. Clang also works for
`make test` with `make CC=clang test`; `-fanalyzer` is GCC-only.

## Protocol

Text lines terminated by `\n` (a preceding `\r` is ignored), at most 24 characters.

| Command | Reply | Effect |
|---|---|---|
| `PIN dddd` | `OK`, `DENIED` or `LOCKOUT` | Correct PIN (`4921` in this demo) opens the latch for 5 s |
| `LOCK` | `OK` | Closes the latch now |
| `STATUS` | `LOCKED`, `UNLOCKED` or `LOCKOUT` | |
| `VERSION` | `1.0.0` | |
| anything else | `ERR` | |

Three consecutive wrong PINs cause a 30 s lockout during which every PIN, including the
correct one, is answered with `LOCKOUT`.

The PIN is a compile-time constant for demonstration only. A real product would not ship a
shared secret in its image; see the course's security section.
