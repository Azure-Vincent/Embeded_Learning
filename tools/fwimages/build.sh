#!/bin/sh
# Builds every synthetic firmware image used by the Debugging tools and regenerates js/sim/fwimages.js.
# Needs: clang with ARM and RISC-V targets, ld.lld, llvm-objcopy, llvm-objdump, llvm-dwarfdump, gcc (host test), node.
# Tested with Ubuntu clang 18.1.3. Output binaries go to $OUT (default: a temp dir), not into the repository.
set -eu
cd "$(dirname "$0")"
OUT="${OUT:-${TMPDIR:-/tmp}/bench-fwimages}"
mkdir -p "$OUT"
ARM="clang --target=thumbv6m-none-eabi -mcpu=cortex-m0plus -ffreestanding -fno-builtin -nostdlib -Wall -Wextra -std=c11 -fuse-ld=lld -Wl,--nmagic"
RV="clang --target=riscv32-unknown-elf -march=rv32im -mabi=ilp32 -ffreestanding -fno-builtin -nostdlib -Wall -Wextra -std=c11 -fuse-ld=lld -Wl,--nmagic"

node gen_blobs.mjs
gcc -Wall -Wextra -std=c11 src/sha256.c src/sha256_hosttest.c -o "$OUT/sha256_hosttest" && "$OUT/sha256_hosttest"

# ldscript <name> <flash origin> <flash length> <alignment of the .payload section>
ldscript() { sed -e "s/@FLASH_ORIGIN@/$2/" -e "s/@FLASH_LEN@/$3/" -e "s/@PAYLOAD_ALIGN@/$4/" src/link.ld.in > "$OUT/$1.ld"; }
ldscript app 0x08000000 64K 4
ldscript behind_boot 0x08004000 48K 4
sed -i '/\.payload/d' "$OUT/app.ld" "$OUT/behind_boot.ld"   # only the updater image has a payload section
ldscript updater 0x08000000 64K 0x800   # leaves a gap before the payload; objcopy fills it with 0xFF like erased flash

# Images for the firmware inspector (-Os, no debug info).
$ARM -Os src/startup.c src/fw_demo.c -T "$OUT/app.ld" -o "$OUT/demo.elf"
$ARM -Os src/startup.c src/fw_lockbox.c -T "$OUT/behind_boot.ld" -o "$OUT/lockbox.elf"
$ARM -Os src/startup.c src/fw_updater.c src/sha256.c -T "$OUT/updater.ld" -o "$OUT/updater.elf"
for n in demo lockbox updater; do
  llvm-objcopy -O binary --gap-fill 0xff "$OUT/$n.elf" "$OUT/$n.bin"
done

# Programs for the debug session (-O0 -g so every source line has code and locals live on the stack).
for n in tour hardfault stuck badptr; do
  $ARM -O0 -g -fno-omit-frame-pointer src/startup.c "src/dbg_$n.c" -T "$OUT/app.ld" -o "$OUT/dbg_$n.elf"
  llvm-objcopy -O binary "$OUT/dbg_$n.elf" "$OUT/dbg_$n.bin"
done

# Functions for the disassembly lab (-Oz gives the shortest, most readable loops).
$ARM -Oz src/disasm_funcs.c src/disasm_stubs.c -Wl,-Ttext=0x08000100,-Tdata=0x20000000,-e,_start -o "$OUT/dis_thumb.elf"
$RV -Oz src/disasm_funcs.c src/disasm_stubs.c -Wl,-Ttext=0x80000100,-Tdata=0x80100000,-e,_start -o "$OUT/dis_riscv.elf"

node gen.mjs "$OUT"
