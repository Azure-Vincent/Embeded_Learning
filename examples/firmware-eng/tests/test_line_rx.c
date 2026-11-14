#include "line_rx.h"
#include "test.h"

static line_rx_t lr;

/* Feed a string; return how many complete lines were reported, keep the last one. */
static int feed(const char *s, char *last, size_t last_size)
{
    int lines = 0;
    for (; *s != '\0'; s++) {
        if (line_feed(&lr, (uint8_t)*s)) {
            lines++;
            if (last != NULL) { strncpy(last, lr.buf, last_size - 1); last[last_size - 1] = '\0'; }
        }
    }
    return lines;
}

static void test_simple_line(void)
{
    char last[64] = "";
    line_init(&lr);
    CHECK(feed("STATUS", last, sizeof last) == 0);   /* nothing until the terminator */
    CHECK(feed("\n", last, sizeof last) == 1);
    CHECK_STR(last, "STATUS");
}

static void test_crlf_and_empty_lines(void)
{
    char last[64] = "x";
    line_init(&lr);
    CHECK(feed("LOCK\r\n", last, sizeof last) == 1);
    CHECK_STR(last, "LOCK");
    CHECK(feed("\r\n", last, sizeof last) == 1);
    CHECK_STR(last, "");
}

static void test_two_lines_in_one_burst(void)
{
    char last[64] = "";
    line_init(&lr);
    CHECK(feed("A\nBC\n", last, sizeof last) == 2);
    CHECK_STR(last, "BC");
}

static void test_exactly_max_length_is_accepted(void)
{
    char last[64] = "";
    line_init(&lr);
    CHECK(feed("123456789012345678901234\n", last, sizeof last) == 1);   /* 24 = LINE_CAP */
    CHECK(strlen(last) == LINE_CAP);
    CHECK(lr.overlong == 0);
}

static void test_overlong_line_is_dropped_and_parser_recovers(void)
{
    char last[64] = "";
    line_init(&lr);
    CHECK(feed("1234567890123456789012345", last, sizeof last) == 0);    /* 25 bytes */
    CHECK(feed("PIN 4921\n", last, sizeof last) == 0);   /* still the tail of the bad line */
    CHECK(lr.overlong == 1);
    CHECK(feed("STATUS\n", last, sizeof last) == 1);     /* next line is clean */
    CHECK_STR(last, "STATUS");
}

static void test_all_byte_values_do_not_break_it(void)
{
    line_init(&lr);
    for (int round = 0; round < 3; round++)
        for (int c = 0; c < 256; c++) (void)line_feed(&lr, (uint8_t)c);
    CHECK(lr.len <= LINE_CAP);
}

int main(void)
{
    RUN(test_simple_line);
    RUN(test_crlf_and_empty_lines);
    RUN(test_two_lines_in_one_burst);
    RUN(test_exactly_max_length_is_accepted);
    RUN(test_overlong_line_is_dropped_and_parser_recovers);
    RUN(test_all_byte_values_do_not_break_it);
    return TEST_REPORT("test_line_rx");
}
