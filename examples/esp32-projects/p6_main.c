/* Project 6: 74HC595 on SPI. ESP-IDF, original ESP32 DevKit. */
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_log.h"

#define SR_HOST    SPI2_HOST
#define PIN_SCLK   18      /* -> 74HC595 pin 11 SRCLK */
#define PIN_MOSI   23      /* -> 74HC595 pin 14 SER   */
#define PIN_MISO   19      /* not used by the 595; used by the flash extension */
#define PIN_LATCH  4       /* -> 74HC595 pin 12 RCLK, driven as chip select */

static const char *TAG = "p6";
static spi_device_handle_t s_sr;

static void sr_write(uint8_t value)
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA,   /* data lives inside the struct */
        .length  = 8,                      /* in BITS, not bytes */
        .tx_data = { value },
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_sr, &t));
}

void app_main(void)
{
    spi_bus_config_t bus = {
        .sclk_io_num   = PIN_SCLK,
        .mosi_io_num   = PIN_MOSI,
        .miso_io_num   = PIN_MISO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SR_HOST, &bus, SPI_DMA_CH_AUTO));

    spi_device_interface_config_t dev = {
        .mode           = 0,               /* CPOL=0, CPHA=0 */
        .clock_speed_hz = 100 * 1000,      /* slow enough to see on a cheap analyser */
        .spics_io_num   = PIN_LATCH,       /* low during the byte, rises after it */
        .queue_size     = 1,
        /* .flags = SPI_DEVICE_BIT_LSBFIRST,   <- try this in step 5 */
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SR_HOST, &dev, &s_sr));

    sr_write(0x00);                        /* known state: shift register powers up random */
    ESP_LOGI(TAG, "walking one bit across QA..QH");

    uint8_t pattern = 0x01;
    while (1) {
        sr_write(pattern);
        ESP_LOGI(TAG, "wrote 0x%02X", pattern);
        pattern = (uint8_t)(pattern << 1);
        if (pattern == 0) pattern = 0x01;
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}
