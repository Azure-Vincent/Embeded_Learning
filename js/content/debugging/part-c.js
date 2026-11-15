// Debugging, part C: firmware files, extraction, static analysis and bootloader analysis.
// Tool output marked host-tested comes from examples/debugging/elfdemo, an x86-64 host ELF.
// Thumb and RISC-V listings are from this app's bundled synthetic images (tools/fwimages), built with clang.

const skills = [
  { id: 'dbg-elf-inspect', name: 'Inspect an ELF with readelf, objdump, nm and size, and convert it to bin, hex and S-record', track: 'hardware' },
  { id: 'dbg-fw-extract', name: 'Read firmware back from a board you own, identify an unknown chip, and state what locks that path in production', track: 'hardware' },
  { id: 'dbg-fw-triage', name: 'Triage a raw firmware image: load address, vector table, strings, constants and the reset handler', track: 'hardware' },
  { id: 'dbg-disasm-read', name: 'Read short Thumb and RISC-V disassembly well enough to find a compare, a loop and a register write', track: 'hardware' },
  { id: 'dbg-boot-analyse', name: 'Analyse a boot chain by stating what each stage checks, with what key, and what it does on failure', track: 'hardware' },
];

const lessons = [
  // ------------------------------------------------------------------ 10
  {
    id: 'dbg-formats-elf', title: 'Firmware files: ELF, bin, hex and what is inside them', minutes: 60,
    summary: 'What a build really produces, and the binutils commands that take it apart, demonstrated on an ELF you build yourself.',
    skills: ['dbg-elf-inspect'],
    blocks: [
      `## The problem

A build finishes and leaves \`firmware.elf\` (200 kB), \`firmware.bin\` (31 kB) and \`firmware.hex\` (88 kB). The flashing tool wants one of them. The debugger wants another. The chip has 32 kB of flash: does it fit? And the linker says a global you declared is "at 0x20000010", yet its initial value must have come from somewhere in flash.

These files are different views of the same program. Knowing what each contains tells you which to hand to which tool, how much memory you are really using, and later, how to read a file whose source you do not have.`,
      `## Theory

### The formats

| Format | Contains | Addresses? | Used for |
|---|---|---|---|
| **ELF** (\`.elf\`, \`.out\`, \`.axf\`) | Code and data in named sections, where each must be loaded, entry point, symbol table, debug information | Yes | Debugging; the source of every other format |
| **Raw binary** (\`.bin\`) | Only the bytes that go into memory, in address order | **No** | Flashing at an address you supply; bootloader update images |
| **Intel HEX** (\`.hex\`) | The same bytes as text records, each with its address and a checksum | Yes | Programmers and vendor tools |
| **Motorola S-record** (\`.srec\`, \`.s19\`) | As Intel HEX, in a different text syntax | Yes | Programmers, especially in automotive |
| **Vendor containers** | A header understood by one boot ROM or bootloader, then segments, often a checksum or signature | Yes, in their own header | The ESP32 app image, signed update packages |

A \`.bin\` carries no address. You must know where it belongs. Flash a correct \`.bin\` at the wrong offset and every absolute address inside it is wrong, so it crashes at once.

### Inside an ELF: two tables for two audiences

An ELF file has a small header and then two different indexes into its contents.

- **Section headers** describe the file for the **linker and debugger**: \`.text\`, \`.rodata\`, \`.data\`, \`.bss\`, \`.symtab\`, \`.debug_info\` and so on, by name.
- **Program headers** (segments) describe it for a **loader**: "copy this many bytes from this file offset to this memory address". A segment usually covers several sections. A flashing tool that accepts ELF uses these.

The sections you will meet in every firmware:

| Section | Holds | In flash? | In RAM? |
|---|---|---|---|
| \`.text\` | Machine code | Yes | No |
| \`.rodata\` | Constants and string literals | Yes | No |
| \`.data\` | Initialised writable variables | Yes, as initial values | Yes, as the live copy |
| \`.bss\` | Zero-initialised writable variables | **No** | Yes |
| \`.isr_vector\` or similar | The vector table | Yes, at the start | No |

\`.data\` is the one with two homes. Each \`.data\` variable has a **run address** in RAM (its VMA, where the code expects it) and its initial value sits at a **load address** in flash (its LMA). The startup code copies one to the other before \`main\`. \`.bss\` has a size but no bytes in the file, because zeros need not be stored: the startup code clears that RAM.

So:

- **flash used** = \`.text\` + \`.rodata\` + \`.data\` (+ vector table)
- **RAM used** = \`.data\` + \`.bss\` (+ stack and heap, which the ELF does not size for you)

### Symbols and DWARF

The **symbol table** (\`.symtab\`) maps names to addresses and sizes. **DWARF** debug sections (\`.debug_info\`, \`.debug_line\` and others) map addresses to source lines and describe types and variable locations. Neither is loaded onto the chip. They make the ELF large, and they are what makes debugging possible. They also make reverse engineering easy, which is why a release ELF should be kept private and why the image on the device has neither.`,
      `## On real hardware: the toolchain prefixes

The commands below are GNU binutils. Each cross-toolchain provides the same set with a prefix:

| Target | Prefix | Example |
|---|---|---|
| Arm Cortex-M (MAX78000, MSPM0 with GCC) | \`arm-none-eabi-\` | \`arm-none-eabi-objdump\` |
| ESP32, ESP32-S3 (Xtensa) | \`xtensa-esp32-elf-\`, \`xtensa-esp32s3-elf-\` | \`xtensa-esp32-elf-readelf\` |
| ESP32-C3, C6 (RISC-V) | \`riscv32-esp-elf-\` | \`riscv32-esp-elf-nm\` |
| LLVM-based toolchains | \`llvm-\` | \`llvm-objdump\`, \`llvm-readelf\`; TI Arm Clang ships \`tiarmobjcopy\` and relatives |

\`readelf\` does not interpret machine code, so the host's plain \`readelf\` reads any ELF. \`objdump -d\` must understand the instruction set, so use the prefixed one (or \`llvm-objdump\`, which handles many architectures in one binary).

The 2026 eCTF reference design builds with TI Arm Clang, not arm-none-eabi-gcc, and the 2025 one with arm-none-eabi-gcc in a Docker image. The file formats and the ideas here are the same for both.`,
      { t: 'callout', kind: 'note', title: 'About the demonstration file', md: `The transcripts in this lesson are **real output** from \`examples/debugging/elfdemo/fw.elf\`, built in this project's environment with the host \`gcc\`. It is an **x86-64 Linux executable**, not microcontroller firmware: it is freestanding (no C library, entry at \`_start\`) so that it is as small and as firmware-shaped as a host program can be. Its addresses (\`0x401000\`…) and page-sized gaps come from the host linker's defaults. Use it to learn the tools; then run the same commands, with the right prefix, on a real firmware ELF.` },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/debugging/elfdemo/fw.c: the data definitions. One object for each section. Built with gcc -std=c11 -Wall -Wextra -Og -g -ffreestanding -nostdlib -static (see the Makefile); running it prints the banner and exits with status 4.',
        code: String.raw`const char banner[] = FW_VERSION " (elf demo)\n";   /* .rodata */
static const uint8_t crc_seed = 0x5A;                /* folded into an instruction: no storage */

uint32_t boot_count = 3;                             /* .data  */
char device_key[] = "K3Y-0f-th3-d3m0";               /* .data  (demo secret) */

uint8_t rx_buffer[256];                              /* .bss   */
static uint32_t ticks;                               /* .bss   */`,
        explain: [
          { lines: '1', md: 'A `const` array with external linkage is placed in `.rodata`. On a microcontroller it stays in flash and costs no RAM.' },
          { lines: '2', md: 'A `static const` scalar that is only read never gets an address. The compiler emits `mov $0x5a` where it is used, as the disassembly below shows.' },
          { lines: '4-5', md: 'Initialised and writable: `.data`. These 20 bytes of initial values must be stored in the image.' },
          { lines: '7-8', md: 'No initialiser: `.bss`. 260 bytes of RAM, zero bytes in the file.' },
        ] },
      `## Worked example: taking the ELF apart

### The header`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'readelf -h fw.elf (trimmed). For firmware: arm-none-eabi-readelf -h firmware.elf.',
        code: String.raw`  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF64
  Data:                              2's complement, little endian
  Type:                              EXEC (Executable file)
  Machine:                           Advanced Micro Devices X86-64
  Entry point address:               0x401087
  Number of program headers:         5
  Number of section headers:         17`,
        explain: [
          { lines: '1', md: 'Every ELF starts with `7f 45 4c 46`, which is 0x7F followed by the letters E, L, F. The next bytes say 64-bit (`02`) and little-endian (`01`).' },
          { lines: '2-5', md: 'A Cortex-M ELF shows `ELF32`, `little endian` and `Machine: ARM`. An ESP32 ELF shows `Tensilica Xtensa Processor`; an ESP32-C3 one shows `RISC-V`. This is the quickest way to learn what an unknown ELF is for.' },
          { lines: '6', md: 'The entry point is the address of `_start`. In Cortex-M firmware it is the reset handler.' },
        ] },
      `### Sections and sizes`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'readelf -S -W fw.elf (the loadable sections only) and size fw.elf.',
        code: String.raw`  [Nr] Name              Type            Address          Off    Size   ES Flg Lk Inf Al
  [ 1] .text             PROGBITS        0000000000401000 001000 0000f4 00  AX  0   0  1
  [ 2] .rodata           PROGBITS        0000000000402000 002000 00002b 00   A  0   0 16
  [ 3] .data             PROGBITS        0000000000403030 002030 000014 00  WA  0   0 16
  [ 4] .bss              NOBITS          0000000000403060 002044 000108 00  WA  0   0 32

   text	   data	    bss	    dec	    hex	filename
    287	     20	    264	    571	    23b	fw.elf`,
        explain: [
          { lines: '2', md: '`.text`: 0xF4 = 244 bytes of code. Flags `AX`: allocated in memory and executable.' },
          { lines: '3', md: '`.rodata`: 0x2B = 43 bytes. Flag `A` only: read-only data.' },
          { lines: '4', md: '`.data`: 0x14 = 20 bytes (16 for the key string, 4 for `boot_count`). Flags `WA`: writable.' },
          { lines: '5', md: '`.bss` has type `NOBITS`. It has a size (0x108 = 264) and an address, but the next section starts at the same file offset: it occupies nothing in the file.' },
          { lines: '7-8', md: '`size` adds them up the way a firmware engineer wants. Its `text` column is code plus read-only data (244 + 43 = 287). Flash needed = text + data = 307 bytes. RAM needed = data + bss = 284 bytes.' },
        ] },
      `### Segments: what a loader sees`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'readelf -l -W fw.elf (trimmed).',
        code: String.raw`  Type           Offset   VirtAddr           PhysAddr           FileSiz  MemSiz   Flg Align
  LOAD           0x001000 0x0000000000401000 0x0000000000401000 0x0000f4 0x0000f4 R E 0x1000
  LOAD           0x002000 0x0000000000402000 0x0000000000402000 0x00002b 0x00002b R   0x1000
  LOAD           0x002030 0x0000000000403030 0x0000000000403030 0x000014 0x000138 RW  0x1000

 Section to Segment mapping:
   01     .text
   02     .rodata
   03     .data .bss`,
        explain: [
          { lines: '4', md: 'The writable segment has `FileSiz` 0x14 but `MemSiz` 0x138. The loader copies 20 bytes from the file and zero-fills the rest: that difference is `.bss`.' },
          { lines: '1', md: '`VirtAddr` is the run address (VMA) and `PhysAddr` the load address (LMA). Here they are equal because the host OS loads data straight to where it runs. In microcontroller firmware the `.data` segment shows a RAM `VirtAddr` and a flash `PhysAddr`: the bundled `demo` image in the inspector below has `.data` at VMA `0x20000000` and LMA in flash.' },
        ] },
      `### Symbols`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'nm -n fw.elf (sorted by address) and the largest objects from nm -S --size-sort fw.elf.',
        code: String.raw`0000000000401000 t sys3
000000000040100f t str_len
0000000000401021 T uart_puts
0000000000401041 T check_key
000000000040106d T checksum
0000000000401087 T _start
0000000000402010 R banner
0000000000403030 D device_key
0000000000403040 D boot_count
0000000000403060 B rx_buffer
0000000000403160 b ticks

0000000000401087 000000000000006d T _start
0000000000403060 0000000000000100 B rx_buffer`,
        explain: [
          { lines: '1-11', md: 'The letter is the section: `T` text, `R` read-only data, `D` data, `B` bss. Upper case is a global symbol, lower case a file-local (`static`) one. `crc_seed` is absent: it has no storage.' },
          { lines: '13-14', md: '`--size-sort` puts the biggest last. On a real project this is how you find what is eating flash or RAM. Here `rx_buffer` is 0x100 = 256 bytes of RAM.' },
        ] },
      `### Disassembly`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'objdump -d -S fw.elf, the checksum function. x86-64 instructions, since this is a host ELF; on firmware you would see Thumb, Xtensa or RISC-V.',
        code: String.raw`000000000040106d <checksum>:
    uint8_t c = crc_seed;
  40106d:	b8 5a 00 00 00       	mov    $0x5a,%eax
    while (n--) c ^= *p++;
  401072:	eb 09                	jmp    40107d <checksum+0x10>
  401074:	32 07                	xor    (%rdi),%al
  401076:	48 89 d6             	mov    %rdx,%rsi
  401079:	48 8d 7f 01          	lea    0x1(%rdi),%rdi
  40107d:	48 8d 56 ff          	lea    -0x1(%rsi),%rdx
  401081:	48 85 f6             	test   %rsi,%rsi
  401084:	75 ee                	jne    401074 <checksum+0x7>`,
        explain: [
          { lines: '2-3', md: '`-S` interleaves source, using the DWARF line table. The constant 0x5A appears inside the instruction: this is where `crc_seed` went.' },
          { lines: '5-11', md: 'Three columns: address, the instruction\'s bytes, and its mnemonic. The loop is the backward `jne` at 401084 to 401074.' },
        ] },
      `### Conversions and strings`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'objcopy to the three flat formats, then what is in them. Real output; file sizes from ls -l.',
        code: String.raw`$ objcopy -O binary fw.elf fw.bin      # 8260 bytes
$ objcopy -O ihex   fw.elf fw.hex
$ objcopy -O srec   fw.elf fw.srec
$ strip -o fw.stripped fw.elf           # about 12.8 kB -> 8.8 kB; nm: no symbols

$ strings -t x -n 6 fw.bin
   1010 bench-fw 1.4.2 (elf demo)
   2030 K3Y-0f-th3-d3m0

$ head -3 fw.hex ; grep 3040 fw.hex ; tail -2 fw.hex
:020000040040BA
:101000004889F84889F74889D64889CA0F05C3B87E
:1010100000000000EB044883C001803C070075F627
:043040000300000089
:040000050040108720
:00000001FF`,
        explain: [
          { lines: '1', md: 'The image runs from the first loadable byte (0x401000) to the end of `.data` (0x403044): 0x2044 = 8260 bytes, although only 307 are real content. `objcopy -O binary` fills the gaps between sections, by default with zeros; `--gap-fill 0xff` makes them look like erased flash. A firmware linker script packs sections together, so a real `.bin` has little padding.' },
          { lines: '4', md: 'Stripping removes symbols and debug sections. The program still runs. This is the state of anything you read off a device.' },
          { lines: '6-8', md: '`strings` prints runs of printable bytes with their file offset. The demo "secret" is in plain view at offset 0x2030, which is address 0x401000 + 0x2030 = 0x403030, the address `nm` gave for `device_key`.' },
          { lines: '11', md: 'Intel HEX record type 04: upper 16 bits of the address are 0x0040. Bytes: length 02, address 0000, type 04, data 0040, checksum BA.' },
          { lines: '12', md: 'Type 00, data: 0x10 bytes at offset 0x1000, so address 0x00401000. The data begins 48 89 F8, the first bytes of `.text`.' },
          { lines: '14', md: 'Four bytes at 0x00403040: `03 00 00 00`. That is `boot_count = 3`, little-endian.' },
          { lines: '15-16', md: 'Type 05 records the entry point 0x00401087. Type 01 ends the file.' },
        ] },
      `### Checking a HEX record by hand

Every Intel HEX record ends in a checksum chosen so that **all the bytes of the record sum to zero modulo 256**. For \`:020000040040BA\`:

\`0x02 + 0x00 + 0x00 + 0x04 + 0x00 + 0x40 = 0x46\`, and \`0x46 + 0xBA = 0x100\`, whose low byte is 0. The record is good.

\`examples/debugging/ihex_check.c\` does this for every record. Run on the file above it prints:`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'Output of ./ihex_check elfdemo/fw.hex.',
        code: String.raw`data 0x00401000..0x004010F3 (244 bytes)
data 0x00402000..0x0040202A (43 bytes)
entry point 0x00401087
data 0x00403030..0x00403043 (20 bytes)
307 data bytes, 0 bad record(s)` },
      `### The map file

The linker can write a fourth view, the **map file** (\`-Wl,-Map=fw.map\` with GCC; the demo's Makefile does this). It is the linker's own account of what it placed where, and it answers questions the ELF tools cannot: *which object file* contributed these bytes, where padding went, and what was thrown away. This excerpt is from the demo build (the object file's temporary name is shortened):

\`\`\`
.rodata         0x0000000000402000       0x2b
 .rodata.str1.1 0x0000000000402000        0x6 fw.o
 *fill*         0x0000000000402006        0xa
 .rodata        0x0000000000402010       0x1b fw.o
                0x0000000000402010                banner

.data           0x0000000000403030       0x14
 .data          0x0000000000403030       0x14 fw.o
                0x0000000000403030                device_key
                0x0000000000403040                boot_count
                0x0000000000403044                _edata = .
                0x0000000000403060                __bss_start = .

.bss            0x0000000000403060      0x108
 .bss           0x0000000000403060      0x104 fw.o
                0x0000000000403060                rx_buffer
 *fill*         0x0000000000403164        0x4
\`\`\`

Read it from the left margin inwards. A line starting in column 0 is an **output section** with its address and total size. Indented lines are the **input sections** that went into it, each with the object file it came from. Further-indented lines are **global symbols**. \`*fill*\` is alignment padding: ten bytes were spent so that \`banner\` could start on a 16-byte boundary. \`_edata\` and \`__bss_start\` are symbols the linker script itself defines; in firmware, the startup code uses exactly such symbols as the limits of its copy and zero loops. Static symbols such as \`ticks\` do not appear: for those use \`nm\`.

On a firmware project the map also begins with a **memory configuration** table (the \`FLASH\` and \`RAM\` regions from the linker script) and a list of **discarded input sections**, which is where you look when a function you expected is missing or when you want proof that \`--gc-sections\` removed dead code.

### The order of work on any ELF

1. \`readelf -h\`: what machine is it for, and what is the entry point?
2. \`size\`: does it fit? Flash = text + data, RAM = data + bss + stack.
3. \`readelf -S\`: which sections exist, at which run addresses, and which are \`NOBITS\`?
4. \`readelf -l\` (or \`objdump -h\`): for each loadable piece, compare the run address (VirtAddr/VMA) with the load address (PhysAddr/LMA). Where they differ, startup code must copy.
5. \`nm -n\` and \`nm -S --size-sort\`: what is at an address, and what is big?
6. The map file: which object file is responsible, where is padding, what was discarded?
7. \`objdump -d -S\` only for the one function you now know you care about.

### LMA and VMA, step by step

This is the idea people most often get wrong, so here it is with numbers. The figures are illustrative, for a Cortex-M part with flash at \`0x1000_0000\`:

\`\`\`
  Type  Offset   VirtAddr   PhysAddr   FileSiz MemSiz  Flg
  LOAD  0x010000 0x10000000 0x10000000 0x04a30 0x04a30 R E
  LOAD  0x020000 0x20000000 0x10004a30 0x00200 0x01400 RW
\`\`\`

- The second segment is \`.data\` plus \`.bss\`. Its **VirtAddr** \`0x20000000\` is in RAM: that is the address compiled code uses for these variables, and the address \`nm\` and the debugger show.
- Its **PhysAddr** \`0x10004a30\` is in flash, directly after the code: that is where a flashing tool writes the \`0x200\` bytes of initial values.
- A variable that \`nm\` puts at \`0x20000010\` is \`0x10\` bytes into the segment, so its initial value is stored at \`0x10004a30 + 0x10 = 0x10004a40\`, which is offset \`0x4a40\` in a \`.bin\` whose first byte is \`0x10000000\`.
- \`MemSiz − FileSiz = 0x1200\` bytes have no stored value at all: that is \`.bss\`, zeroed at run time.
- Nothing connects the two addresses except the startup code's copy loop. Halt at the reset vector and read \`0x20000010\`, and you see whatever was in RAM, not the initial value.

A HEX file stores only the 307 real bytes and says where each run goes. That is the practical difference from a \`.bin\`: no padding, addresses included, and a per-record integrity check. That check catches file corruption. It is not a security feature: anyone can recompute it.`,
      `### The ESP32 application image

Espressif chips do not boot a raw binary. The build converts the ELF into an **image** the ROM and second-stage bootloader understand. ESP-IDF v6.1 defines it in \`esp_app_format.h\`:

| File offset | Field | Meaning |
|---|---|---|
| 0 | \`magic\` | Always \`0xE9\` |
| 1 | \`segment_count\` | Number of segments that follow (at most 16) |
| 2 | \`spi_mode\` | Flash read mode |
| 3 | \`spi_speed\` (low 4 bits), \`spi_size\` (high 4 bits) | Flash frequency and chip size codes |
| 4–7 | \`entry_addr\` | Entry address, little-endian |
| 8–23 | extended header | WP pin, pin drive settings, chip ID, chip revision limits, and \`hash_appended\` in the last byte |

The header is 24 bytes. Each segment then has an 8-byte header (\`load_addr\`, \`data_len\`) followed by its data, so the first segment's data begins at file offset \`0x18 + 8\`. After the last segment comes a single checksum byte, placed so the image is padded to a 16-byte boundary, and, if \`hash_appended\` is 1, a 32-byte SHA-256 of everything before it. Both detect corruption only. With secure boot, a signature block follows.

For real work use the tool that defines the format: \`esptool --chip esp32 image-info build/app.bin\` prints the header fields and the segment table. That is the spelling of esptool v5, which ESP-IDF v6.1 documents; esptool v4 and earlier were invoked as \`esptool.py image_info\`. Check \`esptool --help\` on your installation.`,
      { t: 'predict', q: 'You add `static uint8_t log_buffer[4096];` (no initialiser) to a firmware project and rebuild. How do the sizes of `firmware.bin` and of RAM usage change?',
        choices: [
          { t: 'Both grow by about 4096 bytes', why: 'This assumes every variable needs bytes in the image. Zero-initialised storage is described by a size only.' },
          { t: 'The .bin is essentially unchanged; RAM use grows by 4096 bytes', ok: true, why: 'The array goes to .bss, which has no file contents. The startup code zeroes that RAM at boot.' },
          { t: 'The .bin grows by 4096 bytes; RAM use is unchanged', why: 'That would be the behaviour of a large `const` table, which lives in flash. A writable array lives in RAM.' },
        ],
        reveal: `Now change it to \`static uint8_t log_buffer[4096] = {1};\`. A single nonzero initialiser moves the whole array to \`.data\`, and the image grows by 4096 bytes of initial values that are copied to RAM at every boot. On a part with 32 kB of flash that is a costly typo. \`size\` before and after shows it immediately.` },
      { t: 'callout', kind: 'mistake', title: 'Reading flash usage from the ELF\'s file size', md: `An ELF's size on disk is dominated by debug information and says nothing about what goes on the chip. The demo ELF is about 12.8 kB (the exact size varies by a few dozen bytes with the build directory, which the debug information records) and contains 307 bytes of loadable content. Use \`size\` (or \`size -A\` for a per-section list), and compare \`text + data\` with the flash region and \`data + bss\` plus stack with the RAM region in the linker script.` },
      { t: 'callout', kind: 'decision', title: 'Which file do I give to which tool?', md: `- **Debugger**: the ELF, always. It is the only file with symbols and line numbers.\n- **Flashing through a debug probe**: ELF or HEX, because they carry addresses and the tool cannot put them in the wrong place.\n- **A bootloader's update protocol**: whatever that bootloader defines, usually a \`.bin\` or a vendor image, at an address the protocol fixes. The eCTF flows for 2024–2026 produce a \`.bin\` for the competition bootloader.\n- **Release archive**: keep the ELF that matches every shipped binary. Without it you cannot decode a crash address from the field.` },
      { t: 'widget', name: 'firmware-inspector', props: { image: 'demo' }, caption: 'A synthetic Cortex-M0+ firmware with its ELF available. Find where the initial value of a .data variable is stored in flash, and how many bytes of the .bin belong to .bss.' },
      { t: 'exercise', prompt: `In a firmware ELF, \`size\` reports \`text 18432, data 512, bss 3072\`. The linker script reserves 1024 bytes for the stack and there is no heap. (a) How many bytes of flash does the image need? (b) How many bytes of RAM? Enter the **RAM** figure.`,
        hints: [
          'Which of the three columns describe bytes that must exist in the image, and which describe memory that only needs to exist at run time?',
          'One column is counted in both memories. Which one has an initial value that must be stored and a live copy that must be writable?',
          'Method: flash = text + data. RAM = data + bss, plus anything the linker script reserves that `size` does not report.',
        ],
        answer: { type: 'number', value: 4608, tol: 0, unit: 'bytes' },
        solution: `(a) Flash = text + data = 18432 + 512 = 18,944 bytes. (b) RAM = data + bss + stack = 512 + 3072 + 1024 = **4608 bytes**. \`.data\` is counted in both because it exists twice: initial values in flash, working copy in RAM.` },
      `## Harder application: what a stranger learns from each file

You are about to publish a firmware update on a website. For each artefact, list what someone who downloads it can learn. Then decide what you would publish.

| Artefact | What it reveals |
|---|---|
| Unstripped ELF with DWARF | Everything short of comments: function and variable names, types, structure layouts, file names and line numbers |
| Stripped ELF | Section layout, load addresses, entry point, all code and data. No names |
| \`.bin\` or \`.hex\` | All code and data. The load address must be inferred, which the next lessons show takes minutes |
| Encrypted update package | Nothing directly, *if* the key is not in an earlier unencrypted release and cannot be read from a device |

The conclusion to draw is uncomfortable and correct: **stripping and raw formats are not protection**. They remove convenience, not information. Every string and constant in \`fw.bin\` was found above with one command. If something must stay secret, it must not be in the image in recoverable form, or the image must be encrypted with a key that is itself protected by hardware. Verification is the same exercise from the other side: run \`strings\` and a hex viewer over your own release file and look for anything you would not want read.`,
      { t: 'refs', items: [
        { title: 'esptool (image format, image-info, elf2image)', url: 'https://github.com/espressif/esptool' },
        { title: 'ESP-IDF v6.1: esp_app_format.h (image and segment headers)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/components/bootloader_support/include/esp_app_format.h' },
        { title: 'eCTF 2025 reference design Dockerfile (arm-none-eabi-gcc, gdb-multiarch)', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/Dockerfile' },
        { title: 'eCTF 2026 reference design Dockerfile (TI Arm Clang)', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/Dockerfile' },
      ] },
    ],
    quiz: [
      { q: 'A .bin file is flashed 0x1000 bytes later than the address it was linked for. Why does it crash immediately?', kind: 'arch', choices: [
        { t: 'Absolute addresses inside it (vectors, pointers, branch targets) still refer to the linked location', ok: true, why: 'A raw binary carries no relocation information, so nothing can adjust those addresses for the new position.' },
        { t: 'The checksum in the .bin no longer matches', why: 'A raw binary has no checksum of its own. Any integrity check comes from a container or bootloader around it.' },
        { t: 'Flash cannot be written at offsets that are not sector boundaries', why: '0x1000 is commonly a sector boundary, and the write itself succeeds. The failure is in executing code that believes it is elsewhere.' },
      ] },
      { q: 'Which ELF table does a flashing tool use to decide which bytes go where?', kind: 'concept', choices: [
        { t: 'The program headers (segments)', ok: true, why: 'Each LOAD segment gives a file offset, a size and a load address, which is exactly what a loader needs.' },
        { t: 'The symbol table', why: 'Symbols name addresses for humans and debuggers. A stripped ELF with no symbols still loads correctly.' },
        { t: 'The DWARF line table', why: 'That maps addresses to source lines for the debugger and plays no part in loading.' },
      ] },
      { q: '`size` reports text 40000, data 1000, bss 6000 for a chip with 64 kB flash and 8 kB RAM, with a 2 kB stack. Does it fit?', kind: 'arch', choices: [
        { t: 'Flash yes (41,000 bytes), RAM no (9,000 bytes needed)', ok: true, why: 'RAM must hold data, bss and the stack: 1000 + 6000 + 2000 exceeds 8192.' },
        { t: 'Both fit, because 40000 + 1000 + 6000 is under 64 kB', why: 'This adds everything into one pool. Flash and RAM are separate memories with separate limits.' },
        { t: 'Flash no, RAM yes', why: 'Flash holds text plus data, 41,000 bytes, well inside 64 kB. bss does not occupy flash at all.' },
      ] },
      { q: 'In `nm` output a symbol is listed as `b ticks`. What does that tell you?', kind: 'code', choices: [
        { t: 'It is a file-local (static) variable in .bss', ok: true, why: 'B/b means the bss section and lower case means local binding.' },
        { t: 'It is a function in a boot section', why: 'Functions appear with T or t, for the text section. The letter b refers to zero-initialised data.' },
        { t: 'It is a byte-sized constant', why: 'The letter encodes the section and linkage, not the type or width. Sizes are shown with -S.' },
      ] },
      { q: 'A global is defined as `uint32_t period_ms = 250;`. You connect a debugger, run `monitor reset halt` and `print period_ms`. It shows 0, or a leftover value. The build and flash are correct. Why?', kind: 'arch', choices: [
        { t: 'The variable lives in RAM, and the startup code that copies its initial value from flash has not run yet', ok: true, why: 'The debugger reads the run address (VMA). At the reset vector that RAM has not been initialised: the 250 is still only at the load address in flash.' },
        { t: 'The debugger reads the load address in flash, where initial values are stored in compressed form', why: 'GDB uses the symbol\'s run address, which is in RAM, and objcopy stores initial values as plain bytes. The flash copy would read as 250.' },
        { t: 'Initialised globals are placed in .bss, which a reset clears to zero before the core is halted', why: 'A nonzero initialiser puts the variable in .data, not .bss, and a reset does not clear RAM: the startup code does, later.' },
        { t: 'The ELF given to GDB must be stale, because a correct ELF always shows the initial value', why: 'The ELF supplies the address and type, never the value. Values always come from target memory, which at this moment has not been set up.' },
      ] },
      { q: 'What does the Intel HEX checksum protect against?', kind: 'security', choices: [
        { t: 'Accidental corruption of a record, such as a damaged file or transfer error', ok: true, why: 'It is a simple sum that anyone can recompute, so it detects mistakes but offers no resistance to deliberate change.' },
        { t: 'Someone modifying the firmware on purpose', why: 'An attacker changes the data and recalculates the sum in the same step. Authenticity needs a keyed MAC or a signature.' },
        { t: 'Flashing the file to the wrong chip', why: 'The checksum covers only the record\'s own bytes. It knows nothing about the device.' },
      ] },
      { q: 'You run `strings` on your release .bin and see an API token. Stripping the ELF before conversion would have:', kind: 'security', choices: [
        { t: 'Made no difference, because the token is data in .rodata, not a symbol', ok: true, why: 'Stripping removes names and debug information. The program\'s constants are part of what must be loaded and remain in every format.' },
        { t: 'Removed it, because strip deletes all strings', why: 'strip deletes the string *tables* used for symbol names. String literals used by the code are program data and are untouched.' },
        { t: 'Encrypted it', why: 'No binutils conversion performs encryption. The bytes are copied as they are.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 11
  {
    id: 'dbg-extraction', title: 'Identifying a chip and reading its firmware back', minutes: 50,
    summary: 'From package markings to a datasheet, then reading flash from a board you own, and the locks that stop others doing the same.',
    skills: ['dbg-fw-extract'],
    blocks: [
      `## The problem

You have a board you own and no source code for what is on it. Perhaps you inherited the project, the build machine died, or it is a commercial gadget you bought and want to understand. To learn anything you need two things: to know **what the chips are**, and to get **the bytes out of the flash**.

The same two steps are the first thing an attacker does to your product. So this lesson has two halves that mirror each other: how it is done, and what the designer does about it.`,
      { t: 'callout', kind: 'security', md: `Read firmware only from hardware you own or are authorised to assess. Circumventing a manufacturer's readout protection can be unlawful depending on jurisdiction and purpose, and it is not what this course teaches: everything below uses the vendor's own documented tools on an unlocked device, or this app's bundled synthetic images.` },
      `## Theory: identifying an unknown chip

### Read the package

The top marking usually has three or four lines:

- a **logo** or manufacturer name;
- the **part number**, sometimes abbreviated on small packages;
- a **date code**, commonly four digits \`YYWW\` (year and week);
- a **lot or trace code**.

Use a magnifier and light from a low angle; laser marking is shallow. Search for the part number together with "datasheet". Then record the **package** (QFN, QFP, BGA, SOIC) and **pin count**, which narrow the variants.

Very small packages carry a two- or three-character **marking code** in place of the part number. The datasheet has a "marking" or "ordering information" table that maps codes to parts, and it is the only reliable decoder.

### Confirm with measurements

A marking is a claim. Check it against the datasheet's pinout:

- With the board **off**, use continuity to see which pins connect to ground and which to the supply rail. They should match the datasheet's VSS and VDD pins.
- Look at what is attached: a crystal on the oscillator pins, a USB connector on the USB pins, the debug header on the SWD pins.
- If you can attach a debug probe, the **IDCODE/DPIDR** and the core's CPUID register (previous lessons) identify the core independently of the marking.

A mismatch means the wrong datasheet, a different variant, or a remarked part.

### When the marking is gone

Some products have the marking sanded or lasered off. The supporting evidence remains: package and pin count, which pins are power and ground, the crystal's frequency, the external flash chip, what the boot log prints, and the debug port's ID. Each is a filter, and together they usually leave very few candidates.

### External memory is a separate chip

An 8-pin SOIC or small WSON near the processor is often **SPI NOR flash**. It is identified the same way, and also electrically: the standard JEDEC "read ID" command (\`0x9F\`) returns a manufacturer byte, a memory-type byte and a capacity byte, which tools such as esptool's \`flash-id\` command print for you. The original ESP32 keeps its firmware in such a chip, inside the module's metal can.`,
      `## Theory: three ways firmware leaves a board

| Path | Uses | Needs |
|---|---|---|
| **The bootloader** | The chip's ROM or factory serial bootloader has a "read memory" command | A UART or USB connection and the boot-mode pin or sequence |
| **The debug port** | SWD or JTAG reads flash as ordinary memory | A probe, and debug access not disabled |
| **The memory chip itself** | An external flash chip is read directly over SPI, in circuit or desoldered | A flash reader or clip; the processor held in reset so it does not drive the bus |

All three are ordinary engineering operations with vendor support. Each has a corresponding lock.`,
      `## On real hardware: reading back your own board

### ESP32 family: the ROM bootloader

Espressif's ROM bootloader implements flash read and write over UART (and over USB on chips with the USB Serial/JTAG controller). \`esptool\` drives it. This is the same path \`idf.py flash\` uses.`,
      { t: 'code', lang: 'sh', status: 'reviewed', caption: 'Backing up an ESP32 board you own. Spelling is that of esptool v5, as used throughout the ESP-IDF v6.1 documentation (esptool, hyphenated commands). esptool v4 and earlier: esptool.py flash_id, read_flash, image_info. Not run on a board here; check esptool --help.',
        code: String.raw`esptool --port /dev/ttyUSB0 flash-id                       # manufacturer, device, detected size
esptool --port /dev/ttyUSB0 read-flash 0 0x400000 full.bin  # whole 4 MB chip
esptool --port /dev/ttyUSB0 read-flash 0x8000 0x1000 ptable.bin
esptool --chip esp32 image-info full_app.bin               # header and segments of an app image`,
        explain: [
          { lines: '1', md: 'Sends the JEDEC ID command to the SPI flash through the ROM loader and reports its size. Use the size it reports in the next command; 0x400000 assumes 4 MB.' },
          { lines: '2', md: 'Reads from offset 0 for the given length into a file. The offsets are flash offsets, not CPU addresses.' },
          { lines: '3', md: 'The partition table is at its default offset 0x8000 and occupies one 0x1000 sector. Its entries tell you where the bootloader, application and data partitions are.' },
          { lines: '4', md: 'Run on an application image cut out of the dump at the offset the partition table gives (0x10000 for the default factory app).' },
        ] },
      `Within the dump, the second-stage bootloader is at offset \`0x1000\` on the original ESP32 and \`0x0\` on ESP32-S3, C3 and C6; the partition table defaults to \`0x8000\` and the factory application to \`0x10000\`.

### Cortex-M parts: the debug port

On an unlocked MAX78000 or MSPM0L2228 the debug port reads flash like any memory. With OpenOCD running (previous lessons):

\`\`\`
> reset halt
> dump_image max78000_flash.bin 0x10000000 0x80000     # MAX78000: 512 KB at 0x1000_0000
> dump_image mspm0_flash.bin    0x00000000 0x40000     # MSPM0L2228: 256 KB at 0x0000_0000
\`\`\`

TI's UniFlash is the vendor's programming tool for MSPM0, and the MSPM0 ROM bootstrap loader (BSL) is a second path, with its own configuration block in NONMAIN. This project has not verified which read-back operations either offers on the L2228: check TI's UniFlash and BSL documentation for the interfaces and commands they provide.

On the eCTF boards for 2024–2026 a MITRE-provided bootloader occupies the start of flash (\`0x1000_0000\`–\`0x1000_DFFF\` on the MAX78000; \`0x0000_0000\`–\`0x0000_5FFF\` in the 2026 MSPM0 layout), and team firmware is installed through it. What that bootloader permits in each competition phase is set by that year's rules.

### An external SPI flash chip

If the firmware is in a separate flash chip on a board you own, a flash programmer with a test clip can read it in place, provided the processor is held in reset so two masters do not fight over the bus and the clip's supply does not back-power the board. The open-source \`flashrom\` tool supports many such programmers. This path bypasses the processor entirely, which is its significance for security: nothing the firmware does can prevent it.`,
      `## Worked example: orienting yourself in a dump

You have \`full.bin\` from an ESP32 development board you own. Before any disassembly:

1. **Size check.** 4,194,304 bytes = 4 MB: matches \`flash_id\`.
2. **Bootloader.** Offset \`0x1000\` should begin with \`E9\`, the image magic.
3. **Partition table.** Read \`0x8000\`–\`0x8FFF\`. ESP-IDF's \`gen_esp32part.py\` converts the binary table back to readable CSV. Suppose it lists \`nvs\` at \`0x9000\`, \`phy_init\` at \`0xF000\` and \`factory\` at \`0x10000\`, size 1 MB.
4. **Application.** Offset \`0x10000\` should again begin with \`E9\`. Suppose the first eight bytes there are \`E9 06 02 10 14 12 08 40\`. By the header layout from the file-formats lesson: magic, 6 segments, flash mode code 2, and an entry address stored little-endian in bytes 4–7. \`image-info\` on that region lists the segments and their load addresses, which is everything a disassembler needs.
5. **Strings.** \`strings -n 8 full.bin | less\`: project name, ESP-IDF version, compile date, log format strings, URLs, and anything the developers left in.
6. **NVS.** The \`nvs\` partition holds key-value settings. On a device that has been used, that can include Wi-Fi credentials in plain form unless NVS encryption is enabled. This is why a second-hand IoT device is a privacy problem as well as a security one.

If the dump from offset \`0x1000\` onward looks like uniform noise with no \`E9\`, no strings and no structure, flash encryption is enabled, and you are looking at ciphertext. That is the defence working.`,
      { t: 'predict', q: 'A product enables flash encryption on an ESP32 but leaves the UART ROM bootloader fully functional. An attacker reads the whole flash with esptool. What do they get?',
        choices: [
          { t: 'The plaintext firmware, because the ROM bootloader decrypts on read', why: 'The serial read command returns the raw contents of the flash chip. Decryption happens in the path the CPU uses to execute and map flash, not in the download protocol\'s raw read.' },
          { t: 'Ciphertext: the bytes stored in the flash chip, which are encrypted', ok: true, why: 'A raw flash read, by the ROM loader or by a clip on the chip, returns what is physically stored. Without the key in eFuse, which software cannot read out, it is not useful.' },
          { t: 'Nothing: the read command fails', why: 'Whether the command is available depends on the download-mode configuration. Encryption alone does not disable it; it changes what the bytes mean.' },
        ],
        reveal: `Flash encryption protects **confidentiality of the stored bytes**. It does not by itself stop someone writing to flash or running their own code, which is what secure boot is for, and it does not close the download mode, which has its own eFuse settings (see "secure download mode" and the UART download-mode eFuses in the ESP-IDF security guide). The ESP-IDF documentation describes a development mode and a release mode for flash encryption; only the release configuration is meant for products. Note also that Espressif has published advisories about fault-injection attacks on some chip revisions, so the defence is strong but not absolute.` },
      { t: 'callout', kind: 'mistake', title: 'Testing the lock only with the tool you normally use', md: `A team enables readout protection, confirms that their IDE can no longer read the chip, and ships. But there were three paths out, and they closed one. Test every path on a production-configured unit: the debug port with the vendor tool *and* with OpenOCD, the ROM or serial bootloader's read command, and any external memory with a reader. Also test what the lock does to *you*: can you still update the device, and what happens on a mass erase?` },
      `## The designer's side: closing each path

| Path | Lock | Platform notes |
|---|---|---|
| Debug port | Disable or password-protect debug access | **MSPM0L2228**: NONMAIN boot configuration (debug access enabled / password / disabled; SWD port enable). **ESP32 family**: JTAG-disable eFuses, set automatically when secure boot or flash encryption release mode is enabled; see the security guides for the eFuse names on your chip. **MAX78000**: consult the user guide and datasheet for the part's debug-lock mechanism |
| ROM / serial bootloader | Disable it, restrict it, or require a password | **MSPM0L2228**: the NONMAIN boot configuration has a BSL pin-invoke option and a bootloader-mode setting, and a separate BSL configuration block; take the details (interfaces, password) from TI's BSL documentation, which this project has not verified. **ESP32 family**: secure download mode or disabling UART download mode by eFuse |
| External flash | Encrypt what is stored; keep keys inside the processor | **ESP32 family**: flash encryption (AES-256 with an eFuse key on the original ESP32; XTS-AES on newer chips). Parts with internal flash, such as the MAX78000 and MSPM0L2228, have no external bus to clip onto |
| Factory reset / mass erase | Decide whether it is allowed and what it wipes | **MSPM0L2228**: mass erase and factory reset can each be enabled, password-protected or disabled in NONMAIN |
| Everything else | Assume a determined attacker eventually reads one device | Per-device keys, so one extraction does not break every unit; no global secret in firmware |

Many of these settings are **one-way**. An eFuse cannot be un-burned, and a NONMAIN configuration that disables both debug and the bootloader with no recovery path leaves a board that can never be reprogrammed. Practise on a board you are prepared to lose, and keep a written record of what was set.`,
      { t: 'callout', kind: 'decision', title: 'Why not rely on the lock alone?', md: `Readout protection is a check performed by hardware and boot code, and checks can sometimes be glitched or have implementation flaws; several chip families have had published bypasses. So a sound design layers: lock the ports, encrypt stored secrets, authenticate what boots, and give each device its own keys so that the worst case is one compromised unit. The security section covers fault injection and how to make checks harder to skip.` },
      { t: 'widget', name: 'firmware-inspector', props: { image: 'lockbox' }, caption: 'lockbox.bin is a raw dump with no ELF and no symbols, as if read from a device. For this lesson open the Strings view and do the credential task: what does one read-out give away? The load-address task uses the vector-table method of the next lesson; come back to it then.' },
      { t: 'exercise', prompt: `You carve the application out of an ESP32 dump at the offset the partition table gives. Its first eight bytes are \`E9 06 02 10 14 12 08 40\`. What is the image's **entry address**? Give it in hex.`,
        hints: [
          'Which byte tells you this really is an image, and which of the following bytes are one-byte fields?',
          'The header starts with four one-byte fields (magic, segment count, flash mode, speed/size). The entry address is the 32-bit field after them. In which byte order does an ESP32 store it?',
          'Method: take bytes 4 to 7 and read them as a little-endian word, last byte most significant.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0[xX])?40081214\\s*$'], nudge: 'Bytes 4–7 are 14 12 08 40. Reverse them to read the little-endian word.' },
        solution: `Byte 0 is the magic \`0xE9\`, byte 1 says 6 segments, byte 2 is the flash mode and byte 3 packs the flash frequency (low nibble) and size (high nibble). Bytes 4–7, \`14 12 08 40\`, are the entry address, little-endian: **0x40081214**. That is an address in the ESP32's internal RAM region for code (IRAM, \`0x4008_0000\` upward), which is where the application's start-up function is placed. It is not a flash offset: the segment table that follows says which bytes of the file are loaded or mapped at which address. If byte 0 were not \`E9\` you would be at the wrong offset, or looking at encrypted flash.` },
      `## Harder application: an extraction threat model for your own product

Your product is an ESP32-C3 sensor node. Firmware holds a device certificate and private key for a cloud service and the customer's Wi-Fi credentials. Fill in the table for the product as built *without* any security configuration, then with one.

| Attacker action | No configuration | With flash encryption (release mode), secure boot, per-device key |
|---|---|---|
| Plug in USB, run \`esptool read_flash\` | Full plaintext firmware, key, Wi-Fi password | Download mode restricted; a raw read, if possible at all, yields ciphertext |
| Attach JTAG over the built-in USB | Halt, dump RAM, read decrypted key in memory | JTAG disabled by eFuse |
| Read the SPI flash chip directly | Same plaintext | Ciphertext |
| Flash modified firmware that prints the key | Works | Rejected: signature does not verify |
| Extract one device by fault injection in a lab | Not needed | Possible in principle; yields that device's key only |

Now write the verification plan: for each row, the exact command you would run against a production unit and the output that counts as a pass. A defence you have not tried to defeat with the attacker's own tools is an assumption.`,
      { t: 'refs', items: [
        { title: 'esptool', url: 'https://github.com/espressif/esptool' },
        { title: 'ESP-IDF: flash encryption', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/flash-encryption.rst' },
        { title: 'ESP-IDF: partition tables', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/partition-tables.rst' },
        { title: 'ESP-IDF: security advisories index (vulnerabilities.rst)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/vulnerabilities.rst' },
        { title: 'TI MSPM0 SDK: NONMAIN boot configuration for the L2228', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h' },
        { title: 'eCTF 2025 reference design: firmware.ld (bootloader and team flash regions)', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/firmware.ld' },
      ] },
    ],
    quiz: [
      { q: 'A chip\'s marking suggests part X. Which check best confirms it before you rely on X\'s datasheet?', kind: 'circuit', choices: [
        { t: 'Compare which pins connect to ground and supply on the board with the datasheet\'s pinout', ok: true, why: 'Power and ground pin positions are fixed by the die and package, quick to measure with the board off, and differ between unrelated parts.' },
        { t: 'Check that the package colour matches the photo in the datasheet', why: 'Nearly all packages are the same black epoxy. Appearance does not distinguish parts.' },
        { t: 'Measure the chip\'s supply current', why: 'Current depends on the firmware and operating mode far more than on the part identity.' },
      ] },
      { q: 'Why is an external SPI flash chip a weaker place for firmware than internal flash, absent encryption?', kind: 'security', choices: [
        { t: 'It can be read directly by clipping onto its pins, bypassing every protection in the processor', ok: true, why: 'The memory chip answers any SPI master. The processor\'s debug locks and boot settings are not involved.' },
        { t: 'SPI flash loses data sooner', why: 'Retention is not the issue. The issue is who can talk to the memory.' },
        { t: 'External flash cannot be write-protected', why: 'Many SPI flash chips do have write-protection features. The confidentiality problem is that they can be read by anyone with access to the pins.' },
      ] },
      { q: 'A team disables SWD in their MSPM0 configuration but leaves the ROM bootstrap loader enabled with its default settings. What should they verify?', kind: 'security', choices: [
        { t: 'What the bootstrap loader allows without authentication, since it is a second path to the flash', ok: true, why: 'Each access path has its own lock. Closing one says nothing about the others, so the loader\'s commands and password policy must be checked on a production unit.' },
        { t: 'Nothing further: disabling SWD disables all external access', why: 'The debug port and the serial bootloader are separate mechanisms with separate configuration fields.' },
        { t: 'Only that the device still boots', why: 'Booting shows the configuration did not brick the device. It shows nothing about what an outsider can read.' },
      ] },
      { q: 'You read an ESP32 dump and find no 0xE9 magic at the bootloader offset, no readable strings, and byte values that look uniformly random. What is the most likely explanation?', kind: 'security', choices: [
        { t: 'Flash encryption is enabled and the dump is ciphertext', ok: true, why: 'Encrypted data has no structure or text. A raw read returns exactly what is stored.' },
        { t: 'The flash is erased', why: 'Erased NOR flash reads as 0xFF everywhere, which is the opposite of random-looking.' },
        { t: 'The wrong baud rate was used for the download', why: 'The download protocol is checksummed, so a rate problem causes failures and retries, not a successfully saved file of noise.' },
      ] },
      { q: 'Why give each device its own key instead of one key in the firmware for all units?', kind: 'security', choices: [
        { t: 'So that extracting one device, by whatever means, compromises that device only', ok: true, why: 'Locks reduce the chance of extraction; per-device keys limit the damage when it happens anyway.' },
        { t: 'Per-device keys make the firmware smaller', why: 'They add provisioning work and storage. The benefit is in limiting the blast radius.' },
        { t: 'A shared key cannot be stored in flash', why: 'It can be stored perfectly well, which is the problem: every unit then contains the secret for all of them.' },
      ] },
      { q: 'Before enabling an irreversible debug-disable setting on your only board, what should you have done?', kind: 'concept', choices: [
        { t: 'Confirmed a working update or recovery path that does not need the debug port, on a board you can afford to lose', ok: true, why: 'One-way settings remove your own access too. If the remaining update path is broken, the board is permanently stuck.' },
        { t: 'Saved the ELF file', why: 'Keeping the ELF is good practice but does not restore access to a chip that can no longer be programmed.' },
        { t: 'Nothing: the setting can be cleared by a mass erase', why: 'Whether mass erase is permitted is itself one of the settings, and eFuse-based locks cannot be cleared at all.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 12
  {
    id: 'dbg-static-analysis', title: 'Reading a firmware image: triage, disassembly and Ghidra', minutes: 70,
    summary: 'Find the load address from the vector table, use strings and constants as landmarks, read short disassembly, and set up Ghidra for a raw image.',
    skills: ['dbg-fw-triage', 'dbg-disasm-read'],
    blocks: [
      `## The problem

You have 600 bytes or 600 kilobytes of raw binary read from a device you own. No symbols, no sections, no file name that helps. A disassembler pointed at it with default settings produces thousands of lines of nonsense, because it does not know the instruction set, where the image sits in memory, or where code ends and data begins.

Reverse engineering firmware is mostly a matter of answering those three questions with evidence, then letting tools do the bulk work. This is also how you audit your own release: if you can find it this way, so can anyone.`,
      `## Theory: triage before disassembly

### 1. What architecture?

Usually you know the chip. If not, the image tells you. A Cortex-M image starts with a vector table whose entries are small odd numbers in the flash range. An ESP32 application image starts with \`0xE9\`. Arm Thumb code is full of two-byte instructions whose high byte is often \`0x4x\`, \`0xBx\`, \`0xDx\` or \`0xFx\`; \`70 47\` (\`bx lr\`, the function return) is everywhere.

### 2. Where is it loaded? The Cortex-M vector table

A Cortex-M image begins with a table of 32-bit little-endian words:

| Offset | Entry |
|---|---|
| 0x00 | Initial stack pointer |
| 0x04 | Reset handler |
| 0x08 | NMI handler |
| 0x0C | HardFault handler |
| … | Further exceptions, then one entry per interrupt |

Three facts make this a powerful landmark:

- The **initial SP** points to the top of RAM, so it reveals the RAM base and often its size.
- Every handler address is **odd**, because bit 0 marks Thumb code.
- All handler addresses lie **inside the image**. Since the reset handler is typically one of the first functions, just after the table, \`reset vector − (small offset)\` rounded down gives the **load address**.

Unused entries all point to the same default handler, so a table full of one repeated value with a few different ones is normal.

### 3. Where does code end and data begin?

- **Strings** mark \`.rodata\`.
- **Literal pools**: Thumb code loads 32-bit constants from small tables placed after each function. Those words are data in the middle of code, and they are the addresses the function uses: peripheral registers, RAM variables, strings.
- **Entropy**: code and text have visible structure. Compressed or encrypted regions look uniformly random. Long runs of \`0xFF\` are erased flash; runs of \`0x00\` are padding.
- **Known constants**: cryptographic algorithms contain fixed tables. SHA-256's round constants start \`0x428A2F98, 0x71374491\`; AES has its S-box starting \`63 7C 77 7B\`; CRC-32 tables start \`00000000 77073096\`. Finding one tells you what the code nearby does without reading an instruction.

### 4. Memory inspection is the same activity

Inspecting a live device's memory with \`x/\` in GDB or \`mdw\` in OpenOCD, and inspecting a dump in a hex viewer, are one skill. The questions are identical: is this word a pointer into flash (code or constant), into RAM (variable), into the peripheral region (register), or just a number? A value such as \`0x20000418\` is almost certainly a RAM address on a Cortex-M; \`0x40001000\` a peripheral; \`0x08000131\` code (odd, in flash).`,
      `## Worked example: the first sixteen bytes

A dump from a Cortex-M0+ device begins:

\`\`\`
00000000: 00 10 00 20  41 20 00 08  81 20 00 08  83 20 00 08
\`\`\`

Read as little-endian words:

- \`0x20001000\`: initial SP. RAM is at \`0x2000_0000\` and the stack starts 4 kB above its base.
- \`0x08002041\`: reset vector. Odd, so Thumb; the handler is at \`0x08002040\`.
- \`0x08002081\`, \`0x08002083\`: NMI and HardFault handlers at \`0x08002080\` and \`0x08002082\`. Two bytes apart: each is a single 2-byte instruction, an infinite loop \`b .\` (\`fe e7\`).

The vector table of a Cortex-M0+ with 16 exception slots is 0x40 bytes. If the reset handler directly follows it, the image base is \`0x08002040 − 0x40 = 0x08002000\`.

That is not the start of flash on a part whose flash begins at \`0x0800_0000\`. The first \`0x2000\` bytes (8 KiB) belong to something else: a **bootloader**. You have learned the device's boot architecture from four words. The eCTF layouts are the same pattern: team firmware linked at \`0x1000_E000\` behind a bootloader at \`0x1000_0000\` (2024, 2025), or at \`0x0000_6000\` (2026).

Check the hypothesis: with base \`0x08002000\`, every literal-pool pointer into flash should land on something sensible, such as the start of a string. If they land mid-string, the base is wrong.

### The triage order

Do these in order on any raw image, and write each result down before the next:

1. **Size and shape.** How long is the file? Is the end padded with \`FF\` or \`00\`?
2. **First 16 bytes as four little-endian words.** A RAM address followed by odd flash addresses is a Cortex-M vector table; \`E9\` is an ESP image; \`7F 45 4C 46\` is an ELF you were not expecting.
3. **Initial SP** → RAM base and a lower bound on RAM size.
4. **Reset vector** → clear bit 0, subtract its offset in the file → **load address**. Test it: every non-zero vector must fall inside \`base … base + file length\`.
5. **Does the base equal the start of flash?** If not, something else boots first.
6. **Strings**, with offsets. Add the base to get the addresses that code will use to refer to them.
7. **Constants and entropy**: known tables name the algorithms; high-entropy blocks are compressed or encrypted; flat runs are padding.
8. Only now **disassemble**, starting from the reset handler and from the code that refers to the interesting strings.

The inspector below gives you a different image from the worked example. Its base is not the one above: derive it.`,
      { t: 'widget', name: 'firmware-inspector', props: { image: 'lockbox' }, caption: 'Do the triage on lockbox.bin in the order above: Vectors view for steps 2–5, Strings view for step 6. The tool checks your load address, the credential, and the memory address the credential lives at.' },
      `## Reading disassembly

You do not need to write assembly. You need to recognise a handful of shapes. Arguments arrive in \`r0\`–\`r3\` on Arm and \`a0\`–\`a7\` on RISC-V; the return value leaves in \`r0\` or \`a0\`.

### A register write

This listing is from the app's bundled Thumb image, built with clang from the C shown.`,
      { t: 'code', lang: 'text', status: 'reviewed', caption: 'Thumb (Cortex-M0+) disassembly of led_on() from the bundled synthetic image. C source: void led_on(void) { GPIO_OUT |= 1u << 5; }',
        code: String.raw`0800011c  4802      ldr   r0, [pc, #0x8]   @ 0x8000128
0800011e  6801      ldr   r1, [r0]
08000120  2220      movs  r2, #0x20
08000122  430a      orrs  r2, r1
08000124  6002      str   r2, [r0]
08000126  4770      bx    lr
08000128  40000004  .word 0x40000004`,
        explain: [
          { lines: '1', md: 'Load a 32-bit constant from the literal pool just after the function. `r0` now holds 0x40000004, an address in the peripheral region.' },
          { lines: '2', md: 'Read the register at that address into `r1`.' },
          { lines: '3-4', md: '0x20 is bit 5. OR it into the value read.' },
          { lines: '5', md: 'Write the result back to the same address. Read, modify, write: this is `|=` on a memory-mapped register.' },
          { lines: '6', md: 'Return: branch to the address in the link register.' },
          { lines: '7', md: 'Not an instruction. This word is the literal the first line loaded. A disassembler that decodes it as code produces garbage here.' },
        ] },
      `The same function for RISC-V, from the same C source:`,
      { t: 'code', lang: 'text', status: 'reviewed', caption: 'RV32 disassembly of led_on() from the bundled synthetic image.',
        code: String.raw`80000138  lui   a0, 0x40000
8000013c  lw    a1, 0x4(a0)
80000140  ori   a1, a1, 0x20
80000144  sw    a1, 0x4(a0)
80000148  ret`,
        explain: [
          { lines: '1', md: '`lui` loads the upper 20 bits: `a0` = 0x40000000. RISC-V builds addresses from an upper part and a 12-bit offset, so there is no literal pool.' },
          { lines: '2-4', md: 'Load word from 0x40000004, OR in bit 5, store it back. `0x4(a0)` means address `a0 + 4`.' },
        ] },
      `### A compare loop

This is the shape of every string comparison, and therefore of many password checks.`,
      { t: 'code', lang: 'text', status: 'reviewed', caption: 'Thumb disassembly of str_equal(a, b) from the bundled image. Returns 1 if the strings match.',
        code: String.raw`0800012c  780a      ldrb  r2, [r1]
0800012e  7803      ldrb  r3, [r0]
08000130  2b00      cmp   r3, #0x0
08000132  d004      beq   0x800013e
08000134  4293      cmp   r3, r2
08000136  d102      bne   0x800013e
08000138  1c49      adds  r1, r1, #0x1
0800013a  1c40      adds  r0, r0, #0x1
0800013c  e7f6      b     0x800012c
0800013e  1a99      subs  r1, r3, r2
08000140  4248      rsbs  r0, r1, #0
08000142  4148      adcs  r0, r1
08000144  4770      bx    lr`,
        explain: [
          { lines: '1-2', md: 'Load one byte from each string. `r0` and `r1` are the two pointer arguments.' },
          { lines: '3-4', md: 'If the byte from `a` is zero, the string has ended: leave the loop.' },
          { lines: '5-6', md: 'Compare the two bytes. If they differ, leave the loop. **This is the early exit**: the loop runs once per matching character.' },
          { lines: '7-9', md: 'Advance both pointers and branch backwards. A backward branch is a loop.' },
          { lines: '10-12', md: 'A compiler idiom that computes `(r3 == r2) ? 1 : 0` without a branch.' },
        ] },
      { t: 'callout', kind: 'security', title: 'What the loop shape tells an attacker, and the fix', md: `Because the loop exits at the first differing byte, the time the function takes depends on how many leading characters of the guess are correct. That is a **timing side channel**, and with it a secret can be recovered one character at a time. The defence is a comparison that always processes every byte and accumulates differences (\`diff |= a[i] ^ b[i]\`), with no data-dependent branch. In disassembly, a constant-time compare has a loop whose only exit is the length counter. The security section's timing-attack tool demonstrates both.` },
      { t: 'widget', name: 'disasm-lab', props: { arch: 'thumb' }, caption: 'Short Thumb functions from the bundled image. For each, say what it does before revealing the C.' },
      `## Ghidra orientation

**Ghidra** is an open-source reverse-engineering suite from the NSA: disassembler, decompiler, cross-reference database. It will not understand a raw image until you tell it three things.

### Import settings

1. **File → Import File**, choose the \`.bin\`. Format: **Raw Binary**.
2. **Language**: for a Cortex-M part choose ARM, little-endian, 32-bit, the **Cortex** variant, which sets Thumb as the instruction mode. For an ESP32-C3 choose RISC-V 32-bit little-endian. Recent Ghidra releases include Xtensa for the ESP32 and S3.
3. **Options → Base Address**: the load address you derived from the vector table. A wrong base is the most common reason for a useless analysis: every absolute pointer then misses its target.
4. An **ELF** needs none of this. Ghidra reads the architecture and addresses from the file. For an ESP32 application image, convert or load its segments at the addresses \`image_info\` prints.

### Describe the rest of memory

Open **Window → Memory Map** and add blocks for what is not in the file: RAM at its base (uninitialised, read/write) and the peripheral region (uninitialised, read/write, marked volatile). Without them the decompiler shows accesses to RAM variables and registers as errors instead of as memory references.

### Find the reset handler

1. Go to the base address. Mark the first words as 32-bit **pointers** (select and press \`P\`). Ghidra now shows the vector table as references.
2. Follow the second entry, the reset vector. Ghidra clears the Thumb bit for you. If the bytes there are not yet code, press \`D\` to disassemble and \`F\` to make a function.
3. Run **Auto Analyze**. From the vectors it follows calls and finds most functions.
4. The reset handler has a recognisable shape: a loop copying from flash to RAM (\`.data\`), a loop writing zeros (\`.bss\`), then a call. The call target is \`main\`. Rename it.

### Strings and cross-references

1. **Window → Defined Strings** lists every string with its address.
2. Double-click one, then use **References → Show References to Address** on it. Each reference is code that uses the string.
3. That is the fastest route into unknown firmware: find the string \`"ACCESS DENIED"\`, jump to the code that prints it, and the branch just above is the decision. The other side of that branch is what happens on success, and the condition is the check.
4. Rename functions and variables as you understand them (\`L\`). The decompiler view updates everywhere. Analysis is the gradual replacement of \`FUN_08004084\` with meaningful names.

For peripheral registers, compare addresses with the chip's reference manual or its SVD file; community loaders exist that apply SVD names automatically.`,
      { t: 'predict', q: 'You import a Cortex-M image into Ghidra with base address 0 when the correct base is 0x08004000. The code is position-dependent. What will you see?',
        choices: [
          { t: 'Correct disassembly and decompilation, with all addresses simply 0x08004000 lower', why: 'Individual instructions decode the same anywhere, but the constants they load are absolute addresses that still point at the real location, which is now outside the loaded block.' },
          { t: 'Instructions decode, but string references, function pointers and vector-table entries point to addresses where nothing is loaded', ok: true, why: 'Relative branches still work. Every absolute pointer, including the vectors and all literal-pool addresses, refers to 0x0800xxxx, where Ghidra has no bytes.' },
          { t: 'Ghidra refuses to import the file', why: 'Any base is accepted for a raw binary. The tool has no way to know it is wrong.' },
        ],
        reveal: `The tell-tale signs of a wrong base: the vector table points outside the image, no string has any cross-reference, and the decompiler is full of raw addresses in red. Fix it in the Memory Map (move or rebase the block) and re-run analysis. Getting the base right first is why the vector-table arithmetic comes before opening Ghidra.` },
      { t: 'callout', kind: 'mistake', title: 'Starting with the decompiler', md: `Opening a 500 kB image and reading decompiled functions from the top is slow and discouraging: most of what you see is library code (\`memcpy\`, \`printf\`, RTOS internals, crypto primitives). Start from evidence instead: strings, known constants, the vector table, and the registers of the peripheral you care about. Those lead to the dozen functions that matter.` },
      { t: 'callout', kind: 'decision', title: 'objdump or Ghidra?', md: `For a file with symbols, or a quick look at one function, \`objdump -d\` (or \`llvm-objdump\`) is immediate and scriptable. For a raw image of any size, Ghidra's cross-references and decompiler repay the setup time many times over. Use the hex viewer and \`strings\` first in both cases: they cost nothing and decide where to look.` },
      { t: 'exercise', prompt: `A raw Cortex-M image's first two words are \`0x20008000\` and \`0x000060C1\`. The vector table is 0xC0 bytes long and the reset handler follows it directly. What is the image's load address? Give it in hex.`,
        hints: [
          'Which of the two words is an address inside the image, and what does its odd low bit mean?',
          'You know where the reset handler is in memory and, from the table length, where it is in the file. How do those two facts give the address of the file\'s first byte?',
          'Method: load address = (reset vector with bit 0 cleared) − (offset of the handler in the file). Here the handler\'s offset equals the table length.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0[xX])?0*6000\\s*$'], nudge: 'Reset handler address (bit 0 cleared) minus the size of the vector table.' },
        solution: `Reset handler = \`0x60C1 & ~1 = 0x60C0\`. Load address = \`0x60C0 − 0xC0\` = **0x6000**. The initial SP \`0x20008000\` says RAM tops out at \`0x20008000\`. An image at \`0x6000\` on a part whose flash starts at 0 means something else owns the first 24 kB: this is the shape of the 2026 eCTF layout, where the bootloader occupies \`0x0000\`–\`0x5FFF\`.` },
      `## Harder application: audit an updater

The bundled \`updater.bin\` is a synthetic bootloader-style image. Treat it as a release you are about to ship and audit it with the inspector: no source, no symbols.

Aim to answer, with the evidence for each:

1. What version is it? (A known-vulnerable version of a bootloader is found exactly this way.)
2. Which hash algorithm does it implement, and how do you know without reading code?
3. Where is the public key it verifies against, and in what format?
4. Is there a region that is neither code nor text? What is it likely to be?
5. From the strings, what does it do when verification fails?

Then the designer's questions. A **public** key in the image is not a secret: that is the point of asymmetric signatures. What would be a finding is a private key, a symmetric key used for authentication, or a string like "signature check skipped in debug build".`,
      { t: 'widget', name: 'firmware-inspector', props: { image: 'updater' }, caption: 'updater.bin: version string, an embedded public key, a hash constant table and a compressed block. Find each from evidence in the bytes.' },
      { t: 'widget', name: 'disasm-lab', props: { arch: 'riscv' }, caption: 'The same functions compiled for RV32. Compare how each architecture loads an address and returns a value.' },
      { t: 'refs', items: [
        { title: 'Ghidra', url: 'https://github.com/NationalSecurityAgency/ghidra' },
        { title: 'Arm CMSIS 6 (vector table and core definitions)', url: 'https://github.com/ARM-software/CMSIS_6' },
        { title: 'RISC-V ISA manual', url: 'https://github.com/riscv/riscv-isa-manual' },
        { title: 'eCTF 2026 reference design: firmware.ld', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/firmware.ld' },
      ] },
    ],
    quiz: [
      { q: 'A raw Cortex-M image starts with the words 0x20002000, 0x08000145. What do they tell you?', kind: 'arch', choices: [
        { t: 'RAM is around 0x2000_0000 with the stack starting at 0x20002000, and the reset handler is Thumb code at 0x08000144', ok: true, why: 'The first word is the initial stack pointer and the second the reset vector, whose low bit is the Thumb marker.' },
        { t: 'The image is 0x20002000 bytes long and its checksum is 0x08000145', why: 'A Cortex-M vector table has no length or checksum fields. Its first two entries are fixed by the architecture.' },
        { t: 'The reset handler is at the odd address 0x08000145', why: 'Thumb instructions are 2-byte aligned, so code never starts at an odd address. The low bit is a state flag.' },
      ] },
      { q: 'In Thumb disassembly you see `ldr r0, [pc, #8]` and, after the function\'s return, a `.word 0x40004400`. What is the word?', kind: 'code', choices: [
        { t: 'A literal-pool constant: an address the function loads, here in the peripheral region', ok: true, why: 'Thumb cannot encode a 32-bit constant in one instruction, so the compiler stores it after the function and loads it PC-relative.' },
        { t: 'A 32-bit instruction that runs after the return', why: 'Nothing falls through a return. Bytes after it are either the next function or data such as this pool.' },
        { t: 'The function\'s return value', why: 'Return values are produced in r0 at run time. This word is a fixed constant in the image.' },
      ] },
      { q: 'Without reading any code, how can you tell that an image implements SHA-256?', kind: 'security', choices: [
        { t: 'It contains the algorithm\'s constant table, beginning 0x428A2F98, 0x71374491', ok: true, why: 'Standard algorithms use published constants that appear verbatim in any implementation that does not compute them at run time.' },
        { t: 'It contains the string "SHA-256"', why: 'An implementation needs no such string. Its absence proves nothing, and its presence might only be a log message.' },
        { t: 'Part of the image has high entropy', why: 'High entropy indicates compressed or encrypted data. It does not identify an algorithm.' },
      ] },
      { q: 'Why add a RAM block and a peripheral block to Ghidra\'s memory map for a raw flash image?', kind: 'concept', choices: [
        { t: 'So that references to variables and registers resolve to named memory instead of invalid addresses', ok: true, why: 'The file only contains flash. The code refers to RAM and peripherals constantly, and the tool must know those addresses exist.' },
        { t: 'So that Ghidra can run the firmware', why: 'Static analysis does not execute anything. The blocks only describe the address space.' },
        { t: 'Because the import fails without them', why: 'Import succeeds with only the file\'s block. The analysis is merely much less readable.' },
      ] },
      { q: 'You want to find the code that decides whether a PIN is accepted. Which approach is usually fastest?', kind: 'security', choices: [
        { t: 'Find the "denied" or "granted" message string and follow its cross-references back to the branch that selects it', ok: true, why: 'User-visible messages are anchored to the decision that prints them, and cross-references take you straight there.' },
        { t: 'Read the decompiled code from the reset handler onward', why: 'That path goes through all start-up and library code before reaching application logic, which may be thousands of functions later.' },
        { t: 'Search for the instruction `cmp`', why: 'Compare instructions occur in almost every function. The search returns most of the program.' },
      ] },
      { q: 'A compare function\'s loop has a `bne` out of the loop immediately after comparing two bytes. What property does that give the function?', kind: 'security', choices: [
        { t: 'Its run time depends on how many leading bytes match, which leaks information about a secret', ok: true, why: 'An early exit ends the loop at the first mismatch, so longer correct prefixes take measurably longer.' },
        { t: 'It is constant-time, since every byte is compared', why: 'Every byte is compared only if all of them match. On a mismatch the remaining bytes are never examined.' },
        { t: 'It returns the wrong result for strings of different lengths', why: 'The early exit affects timing, not correctness. The result is still computed correctly.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 13
  {
    id: 'dbg-boot-analysis', title: 'Analysing a boot chain: what does each stage check?', minutes: 45,
    summary: 'A structured way to examine ROM, bootloader and application stages, on your own designs and on the course platforms.',
    skills: ['dbg-boot-analyse'],
    blocks: [
      `## The problem

A product claims "secure boot". A boot log says \`image ok, booting\`. What exactly was checked? A CRC and a digital signature both produce the word "ok", and they protect against completely different things. As a designer you must be able to answer this for your own device, and as an analyst the answer tells you where a boot chain is weak.

A boot chain is a sequence of programs, each of which loads the next. Its security is the conjunction of every hand-off. One stage that checks nothing, or checks the wrong thing, breaks the chain no matter how strong the others are.`,
      `## Theory: five questions per stage

For each stage (ROM, each bootloader, the application) write down:

1. **Where does it live, and who can change it?** Mask ROM cannot be changed. Flash can, by whoever has write access.
2. **What does it load next, from where?** An address, a partition, a slot chosen by a flag.
3. **What does it check before jumping?** Nothing; a magic number; a length; a checksum or CRC; a hash compared with a stored value; a MAC; a signature; a version number.
4. **Against what trusted data?** A checksum is compared with a value stored *next to the image*, which an attacker changes at the same time. A signature is checked against a **public key**, and that key must itself be anchored somewhere the attacker cannot write: ROM, eFuse, or a previous verified stage.
5. **What happens on failure?** Halt, retry, fall back to another image, enter a recovery or download mode. Failure paths are code too, and are often less tested.

Then two questions about the chain as a whole:

- **Is the thing checked the thing executed?** If a stage verifies an image in one place and then runs a copy from another, or verifies, then re-reads from storage that can change in between, the check can be bypassed.
- **Can an old, validly signed image be installed?** Without **rollback protection** (a monotonic version counter in protected storage), an attacker reinstalls a release with a known bug.

### What each kind of check actually proves

| Check | Detects accidental corruption | Detects deliberate modification | Needs a secret on the device |
|---|---|---|---|
| Magic number, length | Barely | No | No |
| Checksum / CRC | Yes | **No**: recomputed in seconds | No |
| Plain hash stored with the image | Yes | **No**: replaced along with the image | No |
| Hash compared with a value in protected storage | Yes | Yes, for that one image | No |
| MAC (HMAC, CMAC) | Yes | Yes | **Yes**, a symmetric key, which must be unreadable |
| Digital signature | Yes | Yes | No: only a public key, which need not be secret but must be unmodifiable |`,
      `## On real hardware: the course platforms

### ESP32 family

1. **ROM bootloader** (mask ROM). Reads strapping pins to choose between serial download and normal boot. Loads the second-stage bootloader from flash offset \`0x1000\` (original ESP32) or \`0x0\` (S3, C3, C6).
2. **Second-stage bootloader** (flash). Reads the partition table at \`0x8000\`, chooses an application partition (factory or an OTA slot), loads its segments and jumps.
3. **Application.**

Without secure boot, the image format's checksum and optional appended SHA-256 detect corruption. They do not authenticate anything.

With **Secure Boot V2**, the ROM verifies the second-stage bootloader's signature using a public-key digest held in eFuse, and the bootloader verifies the application the same way. The scheme is RSA-PSS with an RSA-3072 key on the original ESP32, the S3 and the C3; the ESP32-C6 offers RSA-3072 or ECDSA P-256. Secure Boot V2 is available on the original ESP32 from chip revision v3.0 and on the ESP32-C3 from v0.3. The older V1 scheme applies to earlier ESP32 revisions and works differently. Flash encryption is a separate feature that provides confidentiality; the two are designed to be used together.

### MSPM0L2228

The ROM boot code runs first and reads the **NONMAIN** configuration (BCR and BSL settings): debug policy, bootloader invocation, mass-erase policy, and whether to perform an application integrity check (CRC, hash, or none). TI also provides **Customer Secure Code**, an MCUboot-based stage that verifies images with ECDSA P-256 and SHA-256, configures the flash firewalls and key store, and supports rollback protection. TI's guide states that it does not by itself guarantee a complete secure-boot implementation: it is a component to be integrated and evaluated.

### MAX78000

The device header shows ROM at address 0 and application flash from \`0x1000_0000\`. What the ROM offers by way of secure boot depends on the part variant: consult the datasheet and user guide.

### eCTF boards

For 2024 and 2025 (MAX78000FTHR) the reference linker scripts place a MITRE bootloader at \`0x1000_0000\` (length \`0xE000\`) and team firmware at \`0x1000_E000\`. For 2026 (MSPM0L2228) the bootloader is at \`0x0000_0000\` (length \`0x6000\`) and team firmware at \`0x0000_6000\`. In each case your firmware is a **second stage** behind code you do not control. Read that year's rules for what that bootloader checks and allows; do not assume.`,
      { t: 'widget', name: 'boot-sequence', props: { platform: 'esp32' }, caption: 'Step through the stages and note, for each, where it is stored and what it verifies before handing over.' },
      `## Worked example: reading an updater's behaviour

Apply the five questions to a small updater, using only what an image and a console reveal. The numbers are those of this app's synthetic \`updater.bin\`.

**Evidence from the image**

- Vector table at the image base; reset vector just after it. The image is linked at the start of flash: this *is* the first stage after ROM.
- Strings: a version banner, \`waiting for image header\`, \`bad image magic\`, \`ecdsa-p256-sha256 signature check failed\`, \`signature ok, booting application\`.
- The SHA-256 constant table.
- A 65-byte block beginning \`0x04\`, preceded by the tag \`PKEY\`: an uncompressed P-256 public key.

**Answers**

1. *Where, who can change it?* In flash at the base. Anyone who can write flash can replace the updater itself, unless a ROM stage verifies it or the region is write-protected. **This is the first thing to establish on a real product.**
2. *What does it load?* An application at a fixed address, behind a header.
3. *What does it check?* A magic number and a length bound, then a hash and a signature, according to the strings.
4. *Against what?* The embedded public key. It is in the same flash as the updater, so it is exactly as trustworthy as the updater: if an attacker can rewrite one they can rewrite the other.
5. *On failure?* It prints a message and stops. There is no fallback image and no recovery mode visible in the strings, which is safe but means a failed update leaves a dead device.

**What the evidence does not show**: whether the signature covers the header fields (a signed body with an unsigned length field is a classic flaw), whether there is rollback protection (no version comparison message appears), and whether the verify function is correct. Strings describe intent. Only the code and tests establish behaviour.`,
      { t: 'predict', q: 'A bootloader computes a CRC-32 over the application and compares it with a CRC stored in the application\'s header. An attacker with flash write access modifies the application. What happens at the next boot?',
        choices: [
          { t: 'The bootloader rejects the image, because the CRC no longer matches', why: 'That would be true for accidental corruption. Someone deliberately changing the image can change the stored CRC in the same write.' },
          { t: 'The image boots, provided the attacker also updated the stored CRC, which requires no secret', ok: true, why: 'A CRC is a public function of the data. The reference value sits in attacker-writable storage next to the image.' },
          { t: 'The bootloader erases the flash', why: 'Nothing in the description gives it a reason to: once the stored CRC is updated, the comparison succeeds.' },
        ],
        reveal: `Integrity against **accidents** and integrity against **adversaries** are different properties. A CRC provides the first only. For the second, the reference must be something the attacker cannot produce (a signature or MAC) or cannot write (a hash in protected storage). When you read "image verified" in a log, find out which.` },
      { t: 'callout', kind: 'mistake', title: 'Verifying one thing and running another', md: `A bootloader reads the image length from the header, hashes that many bytes, verifies the signature, and then jumps to the image, where the code reads beyond the signed length or uses header fields that were not covered by the signature. Or it verifies the image in slot A and a flag later makes it boot slot B. Make the signature cover **everything** the next stage depends on, including version, length, load address and any configuration, and execute exactly the bytes that were verified.` },
      { t: 'callout', kind: 'decision', title: 'Signature or MAC for firmware authentication?', md: `A MAC is small and fast, but the device must hold the same secret key that creates valid images. One extracted device then lets an attacker sign firmware for all of them. A signature needs only a public key on the device, so extraction yields nothing that can sign. Prefer signatures for firmware authenticity whenever the chip can afford the verification; use MACs where both ends are trusted and the key is per-device and hardware-protected.` },
      { t: 'widget', name: 'secure-boot-chain', props: { platform: 'generic' }, caption: 'Tamper with a stage, swap a key, roll back a version, and see which stage, if any, stops the boot.' },
      { t: 'exercise', prompt: `A device has three stages: mask ROM → bootloader in flash → application in flash. The ROM does not verify the bootloader. The bootloader verifies the application's ECDSA signature with a public key stored in the bootloader's own flash region. Flash is writable through an unlocked debug port. Which single stage would an attacker replace to run arbitrary code, and why does the signature check not stop them? Name the stage.`,
        hints: [
          'Ask of each stage: who verifies *it*?',
          'The public key and the code that uses it are stored in the same writable place.',
        ],
        answer: { type: 'text', accept: ['[Bb]ootloader', '[Ss]econd[- ]stage', '[Ss]tage 2'], nudge: 'Which stage is loaded without anything checking it first?' },
        solution: `The **bootloader**. Nothing verifies it, so an attacker with flash write access replaces it with one that skips verification, or simply replaces the embedded public key with their own and signs their own application. The signature check is sound but its trust anchor is not anchored. Fixes: have the ROM verify the bootloader against a key or digest in immutable storage (this is what ESP32 Secure Boot V2 does with eFuse), or make the bootloader region permanently write-protected and lock the debug port. Then verify by attempting the replacement on a production-configured unit.` },
      `## Harder application: write the boot analysis for a design

Take one of the eCTF reference layouts, or a product of your own, and produce a one-page boot analysis with this structure:

| Stage | Storage and who can write it | Loads | Checks | Trust anchor | On failure |
|---|---|---|---|---|---|
| ROM | | | | | |
| Bootloader | | | | | |
| Application | | | | | |

Below the table answer: Is the checked data the executed data? Is rollback possible? Which debug and download paths remain open at each stage? What secrets are present in each stage's image?

For every cell, record your evidence: a line in a linker script, a vendor document, an observed boot-log line, or a test you ran. Mark anything you have assumed. Where the answer for an eCTF bootloader is defined by the rules and not by the public repository, cite the rules page and do not guess. An analysis in this form is directly usable as the boot section of a design document, and it is also the checklist an attacker would work through.`,
      { t: 'refs', items: [
        { title: 'ESP-IDF: Secure Boot V2', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v2.rst' },
        { title: 'ESP-IDF: Secure Boot V1 (original ESP32 before revision v3.0)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v1.rst' },
        { title: 'TI MSPM0 SDK: Customer Secure Code user\'s guide', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/docs/english/middleware/boot_manager/doc_guide/_sources/doc_guide-srcs/customer_secure_users_guide.rst.txt' },
        { title: 'eCTF 2024 reference design: firmware.ld', url: 'https://github.com/mitre-cyber-academy/2024-ectf-insecure-example/blob/master/application_processor/firmware.ld' },
        { title: 'eCTF 2026 reference design: firmware.ld', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/firmware.ld' },
      ] },
    ],
    quiz: [
      { q: 'A boot log prints "CRC OK, booting". What has been established?', kind: 'security', choices: [
        { t: 'The image was probably not corrupted by accident; nothing about who produced it', ok: true, why: 'A CRC detects random errors. Anyone modifying the image can recompute it.' },
        { t: 'The image was produced by the manufacturer', why: 'Authorship can only be established with a secret the manufacturer holds, as in a signature. A CRC involves no secret.' },
        { t: 'The image is the latest version', why: 'A CRC says nothing about version. Preventing old images needs a version counter in protected storage.' },
      ] },
      { q: 'Why is it acceptable for a firmware image to contain a public key in plain view?', kind: 'security', choices: [
        { t: 'A public key can only verify signatures, not create them; what matters is that it cannot be replaced', ok: true, why: 'Its confidentiality is irrelevant. Its integrity is essential, because whoever controls the key controls what is accepted.' },
        { t: 'It is not acceptable: all keys must be encrypted', why: 'This applies the rule for secret keys to a key that is public by design. Encrypting it would add nothing.' },
        { t: 'Public keys are too long to be recognised in a dump', why: 'They are easily recognised by format, as you did with the 0x04-prefixed 65-byte point. Obscurity is not the reason.' },
      ] },
      { q: 'On an ESP32 with Secure Boot V2, what anchors the trust in the second-stage bootloader\'s signature?', kind: 'arch', choices: [
        { t: 'A digest of the public key stored in eFuse, checked by the mask ROM', ok: true, why: 'The ROM cannot be modified and eFuses cannot be rewritten, so the key that verifies the bootloader is fixed for the life of the chip.' },
        { t: 'The public key stored in the partition table', why: 'The partition table is ordinary flash content and is read by the second stage, after it has already been verified.' },
        { t: 'A checksum in the image header', why: 'The header checksum is an integrity check against corruption and involves no key.' },
      ] },
      { q: 'A signed image format signs only the code, not the header that contains the length and load address. Why is that a weakness?', kind: 'security', choices: [
        { t: 'An attacker can alter header fields to change what is loaded or where, without invalidating the signature', ok: true, why: 'Unsigned fields that influence loading are attacker-controlled inputs to the bootloader.' },
        { t: 'The signature will be too short', why: 'Signature size is fixed by the algorithm and does not depend on how much data is covered.' },
        { t: 'Headers cannot be hashed', why: 'Any bytes can be hashed. Leaving them out is a design choice, and here a poor one.' },
      ] },
      { q: 'What does rollback protection require that a signature check alone does not provide?', kind: 'security', choices: [
        { t: 'A monotonic version value in storage the attacker cannot rewind, compared at boot or update', ok: true, why: 'An old release is still validly signed. Only a record of the minimum acceptable version can reject it.' },
        { t: 'A longer signing key', why: 'Key length affects forgery resistance. An old genuine image needs no forgery.' },
        { t: 'Encrypting the firmware', why: 'Encryption hides contents. An old encrypted, signed image would still be accepted.' },
      ] },
      { q: 'On the 2026 eCTF MSPM0L2228 layout, team firmware is linked at 0x00006000. What does that imply for how your vector table is used?', kind: 'arch', choices: [
        { t: 'A bootloader at address 0 runs first and must hand over to your image; your vector table is not the one the core reads at reset', ok: true, why: 'The core takes its reset vector from the start of flash, which the bootloader occupies. Your image is entered by that bootloader.' },
        { t: 'The core reads its reset vector from 0x6000 on this chip', why: 'A Cortex-M0+ takes its initial vectors from the start of the vector table at reset, which is address 0 here. The linker script places the bootloader there.' },
        { t: 'Nothing: the offset is only a linker convention', why: 'The offset reflects real flash contents. Code linked for 0x6000 that was placed at 0 would have every absolute address wrong.' },
      ] },
    ],
  },
];

const glossary = [
  { term: 'ELF', def: 'Executable and Linkable Format: the build output that holds code, data, load addresses, symbols and debug information.' },
  { term: 'Section', def: 'A named region of an ELF (`.text`, `.rodata`, `.data`, `.bss`, debug sections) used by the linker and debugger.' },
  { term: 'Segment (program header)', def: 'A loader\'s view of an ELF: bytes at a file offset to be placed at a memory address. A segment may contain several sections.' },
  { term: '.bss', def: 'The section for zero-initialised writable data. It has a size and a RAM address but no bytes in the image.' },
  { term: 'LMA and VMA', def: 'Load address and run (virtual) address of a section. For `.data` in firmware, the LMA is in flash and the VMA in RAM.' },
  { term: 'Symbol table', def: 'The ELF table that maps names to addresses and sizes. Removed by `strip`; never present on the device.' },
  { term: 'DWARF', def: 'The debug-information format in ELF files: source lines, types and variable locations.' },
  { term: 'Raw binary (.bin)', def: 'The bytes of an image in address order with no addresses or metadata. Must be flashed at the address it was linked for.' },
  { term: 'Intel HEX', def: 'A text format of records, each with a length, address, type, data and a checksum that makes the record sum to zero.' },
  { term: 'S-record', def: 'Motorola\'s text firmware format, similar in purpose to Intel HEX, with record types S0–S9.' },
  { term: 'objcopy', def: 'The binutils tool that converts between object formats, for example ELF to raw binary or Intel HEX.' },
  { term: 'ESP32 application image', def: 'Espressif\'s boot format: a header starting with 0xE9, load segments, a checksum and an optional SHA-256, produced from the ELF by esptool.' },
  { term: 'Partition table', def: 'On ESP-IDF systems, a table (default offset 0x8000) listing the flash regions for applications and data.' },
  { term: 'Date code', def: 'A marking on an IC package giving its manufacture date, commonly as YYWW.' },
  { term: 'JEDEC ID', def: 'The manufacturer, type and capacity bytes an SPI flash returns to command 0x9F.' },
  { term: 'Readout protection', def: 'A chip configuration that prevents flash being read through the debug port or bootloader. Names and semantics differ per vendor.' },
  { term: 'NONMAIN', def: 'The MSPM0 configuration memory holding boot (BCR) and bootstrap-loader (BSL) settings, including debug access policy.' },
  { term: 'eFuse', def: 'One-time-programmable bits in a chip. Espressif chips use them for keys and irreversible security settings.' },
  { term: 'Flash encryption', def: 'Transparent encryption of external flash contents with a key held in the processor, so a raw read yields ciphertext.' },
  { term: 'Vector table', def: 'The table of exception handler addresses at the start of a Cortex-M image. Entry 0 is the initial stack pointer, entry 1 the reset handler.' },
  { term: 'Thumb bit', def: 'Bit 0 of a Cortex-M code address. It is set in every valid function pointer and vector and is not part of the address.' },
  { term: 'Literal pool', def: 'A block of constants placed after a Thumb function and loaded PC-relative. Data embedded in the code region.' },
  { term: 'Entropy (of data)', def: 'A measure of how random bytes look. Compressed and encrypted regions are near the maximum; code and text are lower.' },
  { term: 'Cross-reference', def: 'A record in a disassembler of which code refers to a given address. The main navigation tool in reverse engineering.' },
  { term: 'Ghidra', def: 'An open-source reverse-engineering suite with disassembler and decompiler for many architectures.' },
  { term: 'Decompiler', def: 'A tool that reconstructs approximate C from machine code. Its output is a reading aid, not the original source.' },
  { term: 'Trust anchor', def: 'The data a verification ultimately depends on, such as a key digest in ROM or eFuse. It must be unmodifiable by the attacker.' },
  { term: 'Rollback protection', def: 'Refusing validly signed but older firmware, using a version counter in protected storage.' },
  { term: 'Chain of trust', def: 'A boot sequence in which each stage verifies the next before running it, starting from an immutable first stage.' },
];

const troubleshooting = [
  { symptom: 'Firmware crashes immediately after flashing a .bin', area: 'Firmware files', causes: 'The binary was written at an offset other than the address it was linked for, or it is an image format the boot ROM does not expect.', fix: 'Flash the ELF or HEX so the tool uses the embedded addresses, or check the linker script\'s flash origin against the flashing offset.' },
  { symptom: 'The .bin is megabytes or gigabytes larger than expected', area: 'Firmware files', causes: 'A loadable section has an address far from the rest (for example a RAM-addressed section marked as loadable), and objcopy filled the gap.', fix: 'Inspect `readelf -l`; fix the linker script so RAM sections have flash load addresses, or exclude the section with `objcopy -R`.' },
  { symptom: 'objdump prints "unknown architecture" or nonsense instructions', area: 'Firmware files', causes: 'The host\'s objdump does not know the target instruction set, or a raw binary is being disassembled with no architecture given.', fix: 'Use the prefixed tool (`arm-none-eabi-objdump`) or `llvm-objdump`; for a raw file give the machine and base address explicitly.' },
  { symptom: 'esptool cannot connect to the chip', area: 'Extraction', causes: 'The chip is not in download mode, the wrong port is selected, a terminal program holds the port, or download mode is disabled.', fix: 'Hold the boot button (GPIO0 low on the original ESP32) while resetting, close other serial programs, check the port name.' },
  { symptom: 'A flash dump shows no strings and no recognisable headers', area: 'Extraction', causes: 'Flash encryption is enabled, the wrong region or size was read, or the data is compressed.', fix: 'Check for 0xFF (erased) versus random-looking data, confirm offsets with the partition table, and check the device\'s security configuration.' },
  { symptom: 'Ghidra shows no cross-references to any string', area: 'Reverse engineering', causes: 'Wrong base address, or the wrong language variant (Arm instead of Thumb).', fix: 'Derive the base from the vector table, rebase the memory block, select the Cortex/Thumb variant and re-run auto-analysis.' },
  { symptom: 'Disassembly turns into garbage partway through a function', area: 'Reverse engineering', causes: 'A literal pool or data table inside the code region is being decoded as instructions.', fix: 'Mark the bytes as data (pointer or word). Use the PC-relative loads before it to find where the pool starts.' },
];

const refs = [
  { org: 'NSA', title: 'Ghidra software reverse engineering suite', url: 'https://github.com/NationalSecurityAgency/ghidra' },
  { org: 'Espressif', title: 'esptool: serial bootloader utility and image tools', url: 'https://github.com/espressif/esptool' },
  { org: 'Espressif', title: 'ESP-IDF security guides (secure boot, flash encryption)', url: 'https://github.com/espressif/esp-idf/tree/v6.1/docs/en/security' },
  { org: 'Texas Instruments', title: 'MSPM0 SDK: Customer Secure Code user\'s guide', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/docs/english/middleware/boot_manager/doc_guide/_sources/doc_guide-srcs/customer_secure_users_guide.rst.txt' },
  { org: 'RISC-V', title: 'RISC-V ISA manual', url: 'https://github.com/riscv/riscv-isa-manual' },
  { org: 'MITRE', title: 'eCTF reference designs 2016–2025', url: 'https://github.com/mitre-cyber-academy', note: 'Linker scripts show the bootloader and team flash regions per year.' },
  { org: 'MITRE', title: 'eCTF 2026 insecure example', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example' },
];

export default { skills, lessons, labs: [], glossary, troubleshooting, refs };
