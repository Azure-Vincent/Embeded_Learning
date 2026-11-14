/* test_app.c - the whole application, driven through the fake HAL.
 * Nothing here knows that the real product has a UART or a GPIO. */
#include "app.h"
#include "hal_fake.h"
#include "test.h"

static void start(void)
{
    fake_reset();
    app_init();
}

static void send(const char *text)
{
    fake_tx_clear();
    fake_rx_push(text);
    app_poll();
}

static void test_boots_locked(void)
{
    start();
    app_poll();
    CHECK(!fake_pin(HAL_PIN_LATCH));
    send("STATUS\n");
    CHECK_STR(fake_tx(), "LOCKED\n");
}

static void test_correct_pin_opens_latch(void)
{
    start();
    send("PIN 4921\n");
    CHECK_STR(fake_tx(), "OK\n");
    CHECK(fake_pin(HAL_PIN_LATCH));
}

static void test_latch_closes_after_timeout(void)
{
    start();
    send("PIN 4921\n");
    fake_advance_ms(LOCK_UNLOCK_MS - 1);
    app_poll();
    CHECK(fake_pin(HAL_PIN_LATCH));
    fake_advance_ms(1);
    app_poll();
    CHECK(!fake_pin(HAL_PIN_LATCH));
}

static void test_wrong_pin_three_times_locks_out(void)
{
    start();
    send("PIN 0000\n");  CHECK_STR(fake_tx(), "DENIED\n");
    send("PIN 1111\n");  CHECK_STR(fake_tx(), "DENIED\n");
    send("PIN 2222\n");  CHECK_STR(fake_tx(), "LOCKOUT\n");
    CHECK(fake_pin(HAL_PIN_LED));
    send("PIN 4921\n");  CHECK_STR(fake_tx(), "LOCKOUT\n");   /* right PIN, still refused */
    CHECK(!fake_pin(HAL_PIN_LATCH));
    fake_advance_ms(LOCK_LOCKOUT_MS);
    app_poll();
    CHECK(!fake_pin(HAL_PIN_LED));
    send("PIN 4921\n");  CHECK_STR(fake_tx(), "OK\n");
}

static void test_pin_prefix_and_suffix_are_rejected(void)
{
    start();
    send("PIN 492\n");    CHECK_STR(fake_tx(), "DENIED\n");
    send("PIN 49210\n");  CHECK_STR(fake_tx(), "DENIED\n");
    CHECK(!fake_pin(HAL_PIN_LATCH));
}

static void test_unknown_and_empty_commands(void)
{
    start();
    send("OPEN SESAME\n");  CHECK_STR(fake_tx(), "ERR\n");
    send("\n");             CHECK_STR(fake_tx(), "");
    send("VERSION\r\n");    CHECK_STR(fake_tx(), APP_VERSION "\n");
}

static void test_command_split_across_polls(void)
{
    start();
    send("PIN 4");   CHECK_STR(fake_tx(), "");
    send("921");     CHECK_STR(fake_tx(), "");
    send("\n");      CHECK_STR(fake_tx(), "OK\n");
}

/* An over-long line must not unlock, must not crash, and must not eat the next command. */
static void test_overlong_line_is_harmless(void)
{
    start();
    send("PIN 4921 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n");
    CHECK_STR(fake_tx(), "");
    CHECK(!fake_pin(HAL_PIN_LATCH));
    send("STATUS\n");
    CHECK_STR(fake_tx(), "LOCKED\n");
}

/* Flood: more bytes arrive between two polls than the RX FIFO holds. */
static void test_rx_flood_drops_bytes_but_recovers(void)
{
    start();
    for (int i = 0; i < 100; i++) app_on_rx_byte('x');   /* as if 100 RX interrupts fired */
    CHECK(app_rx_dropped() == 100 - (APP_RX_FIFO_SIZE - 1));
    app_poll();            /* drain the FIFO first: while it is full, even the '\n' below would be dropped */
    send("\n");            /* ends the garbage line (which was over-long, so discarded) */
    send("STATUS\n");
    CHECK_STR(fake_tx(), "LOCKED\n");
}

int main(void)
{
    RUN(test_boots_locked);
    RUN(test_correct_pin_opens_latch);
    RUN(test_latch_closes_after_timeout);
    RUN(test_wrong_pin_three_times_locks_out);
    RUN(test_pin_prefix_and_suffix_are_rejected);
    RUN(test_unknown_and_empty_commands);
    RUN(test_command_split_across_polls);
    RUN(test_overlong_line_is_harmless);
    RUN(test_rx_flood_drops_bytes_but_recovers);
    return TEST_REPORT("test_app");
}
