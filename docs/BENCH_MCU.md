# Bench-MCU: the simulated microcontroller behind the C lab

Bench-MCU is a **fictional teaching target**. It is not an ESP32, a MAX78000 or an MSPM0, and no register here
matches a real chip. It exists so that pointer, bit-manipulation and driver exercises can run in the browser with
honest, inspectable memory. The habits transfer; the addresses do not.

## Machine model
- 32-bit, little-endian, ILP32: `char` 1, `short` 2, `int` 4, `long` 4, `long long` 8, pointers 4 bytes.
- Natural alignment (a 4-byte type is aligned to 4), structs padded as a typical 32-bit ABI does.
- Byte-addressable memory. Reading or writing an unmapped address stops the program with a **bus fault** naming
  the address and source line. Writes to flash (`.text`/`.rodata`) fault too.
- The stack grows downward. Locals live in real stack memory, next to the saved frame pointer and return address,
  so writing past the end of a local array corrupts them exactly as on hardware. A corrupted return address is
  reported when the function returns (and, if it now holds the address of another function, execution continues there).
- Execution is bounded (default 2,000,000 steps) so an infinite loop ends with a clear message.

| Region | Start | Size | Contents |
|---|---|---|---|
| Flash | `0x0800_0000` | 64 KiB | code (function addresses), `const` data, string literals |
| SRAM | `0x2000_0000` | 64 KiB | `.data`, `.bss`, heap (grows up), stack (grows down from `0x2001_0000`) |
| Peripherals | `0x4000_0000` | — | memory-mapped registers below |

## Peripheral registers
All registers are 32 bits wide. The header below is predefined; exercises can also define their own pointers to these addresses.

### GPIO — base `0x4000_0000` (16 pins, bits 0–15)
| Offset | Name | Access | Meaning |
|---|---|---|---|
| `0x00` | `GPIO_DIR` | RW | 1 = pin is an output |
| `0x04` | `GPIO_OUT` | RW | output latch |
| `0x08` | `GPIO_IN` | RO | pin levels: outputs read back the latch, inputs read the test bench's `gpioIn` value (pulled-up pins read 1 when undriven) |
| `0x0C` | `GPIO_SET` | WO | write 1 to set bits of `GPIO_OUT` |
| `0x10` | `GPIO_CLR` | WO | write 1 to clear bits of `GPIO_OUT` |
| `0x14` | `GPIO_TOGGLE` | WO | write 1 to toggle bits of `GPIO_OUT` |
| `0x18` | `GPIO_PULLUP` | RW | 1 = enable pull-up on an input pin |

### UART0 — base `0x4000_1000`
| Offset | Name | Access | Meaning |
|---|---|---|---|
| `0x00` | `UART_DATA` | RW | write: transmit a byte. read: pop the next received byte (0 if none) |
| `0x04` | `UART_STATUS` | RO | bit 0 `TX_READY`, bit 1 `RX_AVAIL`, bit 2 `RX_OVERRUN` |
| `0x08` | `UART_CTRL` | RW | bit 0 `ENABLE` (transmit is dropped while 0), bit 1 `RX_IRQ_EN` |
| `0x0C` | `UART_BAUD` | RW | divisor; not timing-accurate, stored only |

`TX_READY` goes low for a few simulated ticks after each write, so code that does not poll it loses bytes.

### TIMER0 — base `0x4000_2000`
| Offset | Name | Access | Meaning |
|---|---|---|---|
| `0x00` | `TIM_CTRL` | RW | bit 0 `ENABLE`, bit 1 `AUTO_RELOAD`, bit 2 `IRQ_EN` |
| `0x04` | `TIM_LOAD` | RW | reload value |
| `0x08` | `TIM_COUNT` | RO | current count; decrements once per simulated tick while enabled |
| `0x0C` | `TIM_STATUS` | RW | bit 0 `EXPIRED`; write 1 to clear |

One simulated tick elapses per executed statement, so polling loops make progress.

### ADC — base `0x4000_3000` (12-bit)
| Offset | Name | Access | Meaning |
|---|---|---|---|
| `0x00` | `ADC_CTRL` | RW | bit 0 `START` (self-clearing), bits 4–7 channel |
| `0x04` | `ADC_STATUS` | RO | bit 0 `DONE` |
| `0x08` | `ADC_DATA` | RO | last conversion, 0–4095; values come from the test bench's `adc` list in order |

### Interrupts
`void __attribute__((interrupt)) name(void)` or any function registered with `irq_attach(int irq, void (*fn)(void))`
runs between statements when its source is pending and enabled (`IRQ_UART_RX` = 0, `IRQ_TIMER` = 1).
`irq_disable()` / `irq_enable()` mask and unmask globally. This models *preemption between statements*, which is
enough to demonstrate lost updates on shared variables; it is not cycle-accurate.

## Predefined header (always included)
```c
#define REG32(addr) (*(volatile uint32_t *)(addr))
#define GPIO_BASE 0x40000000u
#define GPIO_DIR REG32(GPIO_BASE + 0x00) /* …and so on for every register above */
#define UART_TX_READY (1u << 0)
#define UART_RX_AVAIL (1u << 1)
```
Standard headers `<stdint.h> <stdbool.h> <stddef.h> <stdio.h> <string.h> <stdlib.h>` are accepted and built in.

## Supported C
Integer types and `<stdint.h>` typedefs, `bool`, pointers (including pointer-to-pointer and function pointers),
arrays, strings, `struct`, `union`, `enum`, `typedef`, bit-fields are **not** supported; `const`, `volatile`, `static`,
`extern`; all integer operators with C's promotion and wraparound rules for fixed widths; casts; `sizeof`;
`if/else`, `for`, `while`, `do`, `switch`, `break`, `continue`, `return`, `goto` is not supported; functions and
recursion; object-like and function-like `#define`, `#include` (ignored), `#if 0/#endif`, `#ifdef/#ifndef`.
Library: `printf` (`%d %i %u %x %X %c %s %p %%`, with width, zero-pad and `l`/`ll`/`hh`/`h`), `putchar`, `puts`, `getchar`,
`memcpy`, `memmove`, `memset`, `memcmp`, `strlen`, `strcpy`, `strncpy`, `strcmp`, `strncmp`, `malloc`, `free`, `abs`,
`exit`. Floating point is not supported.

Undefined behaviour is surfaced where it teaches something: out-of-bounds writes really corrupt neighbouring memory,
use-after-free reads stale data and is flagged, signed overflow wraps and is flagged with a warning, uninitialised
locals contain leftover stack bytes.
