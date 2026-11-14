# Debugging examples (host-buildable)

Small programs used by the "Hardware debugging and reverse engineering" section. Everything here builds and runs
on an x86-64 Linux host with `gcc` and GNU binutils. None of it is microcontroller firmware, and none of it was run
on a board: the point is to learn the tools on a machine you already have, then use the same commands with a
cross-toolchain prefix (`arm-none-eabi-`, `xtensa-esp32-elf-`, `riscv32-esp-elf-`) on real firmware.

| Path | What it is | Build |
|---|---|---|
| `elfdemo/` | `fw.c`, a freestanding program shaped like firmware (no libc, entry at `_start`, one item in each of `.text`, `.rodata`, `.data`, `.bss`). `make` produces `fw.elf`, `fw.bin`, `fw.hex`, `fw.srec` and `fw.map`. | `make -C elfdemo` |
| `cfsr_decode.c` | Decodes an ARMv7-M CFSR value and an eight-word exception stack frame. | `gcc -Wall -Wextra -std=c11 -o cfsr_decode cfsr_decode.c` |
| `ihex_check.c` | Verifies Intel HEX record checksums and prints the address ranges a file programs. | `gcc -Wall -Wextra -std=c11 -o ihex_check ihex_check.c` |
| `baud_guess.c` | Turns measured pulse widths (µs) into a UART baud-rate estimate. | `gcc -Wall -Wextra -std=c11 -o baud_guess baud_guess.c` |
| `gdb_practice.c` | A hosted program with one memory-corruption bug, for practising GDB. | `gcc -Wall -Wextra -std=c11 -g -O0 -fno-stack-protector -o gdb_practice gdb_practice.c` |

## Things to try

```sh
make -C elfdemo && ./elfdemo/fw.elf; echo "exit=$?"     # prints the banner, exits with 4
readelf -h -S -l -W elfdemo/fw.elf                       # header, sections, segments
size elfdemo/fw.elf && nm -n elfdemo/fw.elf              # how big, and what lives where
strings -t x -n 6 elfdemo/fw.bin                         # the "secret" survives objcopy -O binary
./ihex_check elfdemo/fw.hex                              # three data ranges and an entry point
./cfsr_decode 00008200 20000100 4 40001000 0 0 08000431 0800026a 61000000
./baud_guess 8.7 17.4 26
```

A GDB session on `gdb_practice` that finds the bug with a watchpoint:

```
gdb -q ./gdb_practice
(gdb) break set_name
(gdb) run
(gdb) print *s
(gdb) watch state.armed
(gdb) continue          # stops inside memcpy, when the write lands on state.armed
(gdb) bt                # ...called from set_name, called from main
(gdb) x/16xb &state     # the name has run over its 8-byte field
```

`fw.elf` is an x86-64 Linux executable. Its addresses (`0x401000`…) and its page-aligned gaps come from the host
linker's defaults, not from any microcontroller memory map.
