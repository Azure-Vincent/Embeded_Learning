# examples/security-review - security review of a small firmware module, proved on the host.
#
#   make test       build cmd.c (corrected) + tests with ASan and UBSan, and run them; must pass
#   make test-vuln  build review_me.c (defective) with the same tests; it MUST fail - read the report
#   make happy      show that review_me.c passes a happy-path-only test without sanitizers
#   make analyze    gcc -fanalyzer over both versions
#   make clean
#
# Host-only teaching code. platform_mac() in test_cmd.c is a stand-in, not a real MAC.

CC     ?= gcc
BUILD  := build
WARN   := -Wall -Wextra -Werror -Wshadow -Wconversion
SAN    := -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer
CFLAGS := -std=c11 $(WARN) -g -O1

.PHONY: all test test-vuln happy analyze clean
all: test

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/test_fixed: test_cmd.c cmd.c cmd.h | $(BUILD)
	$(CC) $(CFLAGS) $(SAN) test_cmd.c cmd.c -o $@

$(BUILD)/test_vuln: test_cmd.c review_me.c cmd.h | $(BUILD)
	$(CC) $(CFLAGS) $(SAN) test_cmd.c review_me.c -o $@

$(BUILD)/test_vuln_nosan: test_cmd.c review_me.c cmd.h | $(BUILD)
	$(CC) $(CFLAGS) -DHAPPY_ONLY test_cmd.c review_me.c -o $@

test: $(BUILD)/test_fixed
	./$(BUILD)/test_fixed

# The leading '!' inverts the exit status: this target succeeds only if the defective build fails.
test-vuln: $(BUILD)/test_vuln
	! ./$(BUILD)/test_vuln

happy: $(BUILD)/test_vuln_nosan
	./$(BUILD)/test_vuln_nosan

analyze:
	$(CC) $(CFLAGS) -fanalyzer -c review_me.c -o /dev/null
	$(CC) $(CFLAGS) -fanalyzer -c cmd.c -o /dev/null

clean:
	rm -rf $(BUILD)
