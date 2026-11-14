/* main_esp32.c - ESP-IDF entry point for the door-lock application.
 * STATUS: reviewed against the ESP-IDF API, not compiled or run here (see hal_esp32.c). */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "app.h"

void app_main(void)
{
    app_init();
    for (;;) {
        app_poll();
        vTaskDelay(pdMS_TO_TICKS(10));   /* yield: lets the idle task run and feed its watchdog */
    }
}
