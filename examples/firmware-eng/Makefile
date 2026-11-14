# examples/firmware-eng - portable door-lock firmware module, built and tested on the host.
#
#   make test        build every unit test with ASan + UBSan and run them
#   make demo        build the PC port (type commands on stdin)
#   make port-check  compile the Bench-MCU HAL to prove it satisfies hal.h
#   make su          per-function stack usage (-fstack-usage) for bugs/stack_hog.c
#   make inspect     size / nm / readelf on an unsanitised build of the demo
#   make bug-demo    run a deliberately buggy line receiver under ASan (it must fail)
#   make analyze     gcc -fanalyzer over the sources
#   make clean

CC      ?= gcc
BUILD   := build
WARN    := -Wall -Wextra -Werror -Wshadow -Wconversion
SAN     := -fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer
CFLAGS  := -std=c11 $(WARN) -g -O1 -Iinclude -Iport
CORE    := src/ringbuf.c src/line_rx.c src/lock.c
APP     := $(CORE) src/app.c
TESTS   := test_ringbuf test_line_rx test_lock test_app

.PHONY: all test demo port-check su inspect bug-demo analyze clean
all: test

$(BUILD):
	mkdir -p $(BUILD)

# Unit tests of pure modules link only the module under test.
$(BUILD)/test_ringbuf: tests/test_ringbuf.c src/ringbuf.c | $(BUILD)
	$(CC) $(CFLAGS) $(SAN) -Itests $^ -o $@
$(BUILD)/test_line_rx: tests/test_line_rx.c src/line_rx.c | $(BUILD)
	$(CC) $(CFLAGS) $(SAN) -Itests $^ -o $@
$(BUILD)/test_lock: tests/test_lock.c src/lock.c | $(BUILD)
	$(CC) $(CFLAGS) $(SAN) -Itests $^ -o $@
# The application test links the real application against the fake HAL.
$(BUILD)/test_app: tests/test_app.c $(APP) port/hal_fake.c | $(BUILD)
	$(CC) $(CFLAGS) $(SAN) -Itests $^ -o $@

test: $(addprefix $(BUILD)/,$(TESTS))
	@for t in $(TESTS); do ./$(BUILD)/$$t || exit 1; done
	@echo "ALL TESTS PASSED"

# Same application sources, different HAL: link-time substitution.
$(BUILD)/doorlock: $(APP) port/hal_posix.c port/main_posix.c | $(BUILD)
	$(CC) $(CFLAGS) -Wl,-Map=$(BUILD)/doorlock.map $^ -o $@
demo: $(BUILD)/doorlock
	@echo "built $<  -  run it and type: PIN 4921"

port-check: | $(BUILD)
	$(CC) $(CFLAGS) -c port/hal_benchmcu.c -o $(BUILD)/hal_benchmcu.o
	@echo "hal_benchmcu.c compiles against hal.h"

su: | $(BUILD)
	$(CC) -std=c11 -Wall -Wextra -O1 -fstack-usage -c bugs/stack_hog.c -o $(BUILD)/stack_hog.o
	@cat $(BUILD)/stack_hog.su

inspect: $(BUILD)/doorlock
	size $<
	nm --size-sort -S $< | tail -n 8
	readelf -S -W $< | grep -E ' \.(text|rodata|data|bss) '

bug-demo: | $(BUILD)
	$(CC) -std=c11 -Wall -Wextra -g -O1 $(SAN) bugs/line_rx_oob.c -o $(BUILD)/line_rx_oob
	-./$(BUILD)/line_rx_oob

analyze:
	$(CC) -std=c11 -Wall -Wextra -Iinclude -Iport -fanalyzer -fsyntax-only $(APP) port/hal_fake.c

clean:
	rm -rf $(BUILD)
