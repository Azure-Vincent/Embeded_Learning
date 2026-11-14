/* Extension: read the JEDEC ID of an external SPI NOR flash chip that
 * shares SCLK/MOSI/MISO with the shift register and has its own CS. */
#define PIN_FLASH_CS  27

static spi_device_handle_t s_flash;

static void flash_attach(void)
{
    spi_device_interface_config_t dev = {
        .mode           = 0,
        .clock_speed_hz = 1 * 1000 * 1000,
        .spics_io_num   = PIN_FLASH_CS,
        .queue_size     = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SR_HOST, &dev, &s_flash));
}

static void flash_read_jedec_id(uint8_t id[3])
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA | SPI_TRANS_USE_RXDATA,
        .length  = 32,                          /* 1 command byte + 3 reply bytes */
        .tx_data = { 0x9F, 0x00, 0x00, 0x00 },  /* 0x9F = Read JEDEC ID */
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_flash, &t));
    id[0] = t.rx_data[1];   /* manufacturer */
    id[1] = t.rx_data[2];   /* memory type  */
    id[2] = t.rx_data[3];   /* capacity     */
    /* rx_data[0] was clocked in while the command went out: ignore it. */
}
