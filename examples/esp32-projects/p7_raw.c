/* Step 2: prove the UART and the wire before adding any protocol.
 * Replace the body of app_main's while loop with this. */
const char msg[] = "hello\n";
uart_write_bytes(LINK_UART, msg, sizeof msg - 1);

uint8_t rx[32];
int n = uart_read_bytes(LINK_UART, rx, sizeof rx, pdMS_TO_TICKS(100));
if (n > 0) {
    ESP_LOGI(TAG, "received %d byte(s)", n);
    ESP_LOG_BUFFER_HEXDUMP(TAG, rx, n, ESP_LOG_INFO);
} else {
    ESP_LOGW(TAG, "nothing received");
}
vTaskDelay(pdMS_TO_TICKS(1000));
