/* Software model of one or more cascaded 74HC595 shift registers.
 * Bit 0 of .shift is stage QA (nearest SER), bit 7 is QH (feeds QH'). */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t shift;   /* the 8 shift-register flip-flops */
    uint8_t latch;   /* the 8 storage-register flip-flops that drive QA..QH */
} sr595_t;

/* Rising edge on SRCLK: every stage takes its neighbour's value and SER
 * enters QA. Returns the bit that was on QH' before the edge, which is
 * what a second chip wired to QH' would sample on that same edge. */
static int sr595_srclk_rise(sr595_t *s, int ser)
{
    int qh_out = (s->shift >> 7) & 1;
    s->shift = (uint8_t)((s->shift << 1) | (ser & 1));
    return qh_out;
}

/* Rising edge on RCLK: copy the shift register to the output pins. */
static void sr595_rclk_rise(sr595_t *s) { s->latch = s->shift; }

/* What an SPI master does for one byte, to a chain of n chips. */
static void spi_send_byte(sr595_t *chain, int n, uint8_t value, int msb_first)
{
    for (int i = 0; i < 8; i++) {
        int bit = msb_first ? (value >> (7 - i)) & 1 : (value >> i) & 1;
        for (int c = 0; c < n; c++)      /* bit ripples down the chain */
            bit = sr595_srclk_rise(&chain[c], bit);
    }
}

/* Bar-graph pattern: level 0..8 -> that many low-order outputs on. */
static uint8_t bar_pattern(unsigned level)
{
    if (level >= 8) return 0xFF;
    return (uint8_t)((1u << level) - 1u);
}

int main(void)
{
    sr595_t one = {0, 0};

    /* MSB first: bit n of the byte lands on output Q(A+n). */
    spi_send_byte(&one, 1, 0x01, 1);
    assert(one.latch == 0x00);           /* nothing visible until RCLK rises */
    sr595_rclk_rise(&one);
    assert(one.latch == 0x01);           /* only QA is high */

    /* LSB first: the byte comes out mirrored, 0x01 lights QH instead. */
    spi_send_byte(&one, 1, 0x01, 0);
    sr595_rclk_rise(&one);
    assert(one.latch == 0x80);

    /* Two chips: the FIRST byte sent ends up in the FAR chip. */
    sr595_t two[2] = {{0, 0}, {0, 0}};
    spi_send_byte(two, 2, 0xAA, 1);
    spi_send_byte(two, 2, 0x0F, 1);
    sr595_rclk_rise(&two[0]);
    sr595_rclk_rise(&two[1]);
    assert(two[0].latch == 0x0F && two[1].latch == 0xAA);

    assert(bar_pattern(0) == 0x00 && bar_pattern(3) == 0x07);
    assert(bar_pattern(8) == 0xFF && bar_pattern(200) == 0xFF);

    printf("sr595 model: all checks passed\n");
    return 0;
}
