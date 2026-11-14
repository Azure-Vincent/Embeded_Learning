/* stuck-loop: reads the ADC once, then should light the LED. It never gets there. */
#include "bench.h"

#define LED_PIN     5u
#define ADC_READY   (1u << 1)

static uint32_t adc_read(uint32_t channel)
{
    ADC_CTRL = (channel << 4) | ADC_START;
    while ((ADC_STATUS & ADC_READY) == 0) {
        /* wait for the conversion to finish */
    }
    return ADC_DATA;
}

int main(void)
{
    uint32_t raw;
    GPIO_DIR |= 1u << LED_PIN;
    raw = adc_read(3);
    if (raw > 2000) {
        GPIO_OUT |= 1u << LED_PIN;
    }
    for (;;) {
    }
}
