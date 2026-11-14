/* cfsr_decode.c - decode an ARMv7-M Configurable Fault Status Register value
 * and an exception stack frame, on the host.
 *
 * On a Cortex-M3/M4/M7 target you read CFSR at 0xE000ED28 and the eight stacked
 * words from the active stack pointer (in GDB: x/8xw $sp, after choosing MSP or PSP
 * from EXC_RETURN bit 2). Paste the numbers here to get a readable report.
 *
 * Cortex-M0/M0+ (ARMv6-M, e.g. MSPM0L2228) has no CFSR: every fault is a
 * HardFault and only the stacked frame is available.
 *
 * Usage: ./cfsr_decode <cfsr-hex> [r0 r1 r2 r3 r12 lr pc xpsr]
 * Build: gcc -Wall -Wextra -std=c11 -o cfsr_decode cfsr_decode.c
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

struct bit_name { unsigned bit; const char *name; const char *meaning; };

static const struct bit_name cfsr_bits[] = {
    /* MemManage Fault Status Register, CFSR[7:0] */
    { 0,  "IACCVIOL",    "instruction fetch from a location the MPU forbids (or XN region)" },
    { 1,  "DACCVIOL",    "data access to a location the MPU forbids" },
    { 3,  "MUNSTKERR",   "MemManage fault while unstacking on exception return" },
    { 4,  "MSTKERR",     "MemManage fault while stacking for exception entry" },
    { 5,  "MLSPERR",     "MemManage fault during lazy FP state save" },
    { 7,  "MMARVALID",   "MMFAR (0xE000ED34) holds the faulting address" },
    /* BusFault Status Register, CFSR[15:8] */
    { 8,  "IBUSERR",     "bus error on instruction fetch" },
    { 9,  "PRECISERR",   "precise data bus error: stacked PC is the faulting instruction" },
    { 10, "IMPRECISERR", "imprecise data bus error: stacked PC is NOT the culprit" },
    { 11, "UNSTKERR",    "bus fault while unstacking on exception return" },
    { 12, "STKERR",      "bus fault while stacking for exception entry (stack pointer is bad)" },
    { 13, "LSPERR",      "bus fault during lazy FP state save" },
    { 15, "BFARVALID",   "BFAR (0xE000ED38) holds the faulting address" },
    /* UsageFault Status Register, CFSR[31:16] */
    { 16, "UNDEFINSTR",  "undefined instruction executed" },
    { 17, "INVSTATE",    "invalid EPSR state, typically a branch to an even address (Thumb bit clear)" },
    { 18, "INVPC",       "invalid PC load on exception return (bad EXC_RETURN)" },
    { 19, "NOCP",        "coprocessor (FPU) used while disabled in CPACR" },
    { 24, "UNALIGNED",   "unaligned access with UNALIGN_TRP set" },
    { 25, "DIVBYZERO",   "integer divide by zero with DIV_0_TRP set" },
};

static void decode_cfsr(uint32_t cfsr)
{
    printf("CFSR = 0x%08lX\n", (unsigned long)cfsr);
    printf("  MMFSR = 0x%02lX  BFSR = 0x%02lX  UFSR = 0x%04lX\n",
           (unsigned long)(cfsr & 0xFFu), (unsigned long)((cfsr >> 8) & 0xFFu),
           (unsigned long)(cfsr >> 16));
    if (cfsr == 0) {
        printf("  no status bits set: look at HFSR (0xE000ED2C), e.g. VECTTBL or a FORCED fault already cleared\n");
        return;
    }
    for (size_t i = 0; i < sizeof cfsr_bits / sizeof cfsr_bits[0]; i++) {
        if (cfsr & (1ul << cfsr_bits[i].bit)) {
            printf("  bit %2u %-11s %s\n", cfsr_bits[i].bit, cfsr_bits[i].name, cfsr_bits[i].meaning);
        }
    }
}

static void decode_frame(const uint32_t f[8])
{
    static const char *const names[8] = { "r0", "r1", "r2", "r3", "r12", "lr", "pc", "xpsr" };
    printf("Stacked frame (lowest address first):\n");
    for (int i = 0; i < 8; i++) printf("  %-4s = 0x%08lX\n", names[i], (unsigned long)f[i]);
    printf("  -> fault taken at (or just after) pc 0x%08lX; caller return address 0x%08lX\n",
           (unsigned long)f[6], (unsigned long)(f[5] & ~1ul));
    if ((f[7] & (1ul << 24)) == 0)
        printf("  -> xPSR.T is 0: the core was not in Thumb state, so a branch went to an even address\n");
    unsigned exc = (unsigned)(f[7] & 0x1FFu);
    if (exc != 0)
        printf("  -> xPSR exception number %u: the fault interrupted a handler, not thread code\n", exc);
}

int main(int argc, char **argv)
{
    if (argc != 2 && argc != 10) {
        fprintf(stderr, "usage: %s <cfsr-hex> [r0 r1 r2 r3 r12 lr pc xpsr]\n", argv[0]);
        return 2;
    }
    decode_cfsr((uint32_t)strtoul(argv[1], NULL, 16));
    if (argc == 10) {
        uint32_t f[8];
        for (int i = 0; i < 8; i++) f[i] = (uint32_t)strtoul(argv[2 + i], NULL, 16);
        decode_frame(f);
    }
    return 0;
}
