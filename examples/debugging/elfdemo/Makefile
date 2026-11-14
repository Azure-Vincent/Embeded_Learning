# Builds a tiny freestanding x86-64 ELF for practising binutils. Host only.
CC      ?= gcc
CFLAGS  := -std=c11 -Wall -Wextra -Og -g -ffreestanding -fno-pie -fno-stack-protector \
           -fno-asynchronous-unwind-tables -fcf-protection=none
LDFLAGS := -nostdlib -static -no-pie -Wl,--build-id=none -Wl,-Map=fw.map

all: fw.elf fw.bin fw.hex fw.srec

fw.elf: fw.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $<

fw.bin: fw.elf
	objcopy -O binary $< $@
fw.hex: fw.elf
	objcopy -O ihex $< $@
fw.srec: fw.elf
	objcopy -O srec $< $@

clean:
	rm -f fw.elf fw.bin fw.hex fw.srec fw.map

.PHONY: all clean
