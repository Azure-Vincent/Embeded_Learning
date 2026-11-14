/* bad-pointer: a door controller that unlocks itself. */
#include "bench.h"

#define LED_PIN   5u
#define NAME_LEN  8u

char name_buf[NAME_LEN] = "";
uint32_t door_locked = 0;

static void set_name(const char *src)
{
    for (uint32_t i = 0; i <= NAME_LEN; i++) {
        name_buf[i] = src[i];
    }
}

int main(void)
{
    door_locked = 1;
    GPIO_DIR |= 1u << LED_PIN;
    set_name("FRONTDR1");
    if (door_locked == 0) {
        GPIO_OUT |= 1u << LED_PIN; /* release the strike */
    }
    for (;;) {
    }
}
