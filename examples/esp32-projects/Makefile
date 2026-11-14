CC ?= gcc
CFLAGS ?= -Wall -Wextra -std=c11
TESTS = frame_test net_util_test movavg_test app_logic_test sr595_model

test: $(TESTS)
	@for t in $(TESTS); do ./build/$$t || exit 1; done; echo "all host tests passed"

frame_test: ; @mkdir -p build && $(CC) $(CFLAGS) frame.c frame_test.c -o build/$@
net_util_test: ; @mkdir -p build && $(CC) $(CFLAGS) net_util.c net_util_test.c -o build/$@
movavg_test: ; @mkdir -p build && $(CC) $(CFLAGS) movavg.c movavg_test.c -o build/$@
app_logic_test: ; @mkdir -p build && $(CC) $(CFLAGS) app_logic.c app_logic_test.c -o build/$@
sr595_model: ; @mkdir -p build && $(CC) $(CFLAGS) sr595_model.c -o build/$@

clean: ; rm -rf build
.PHONY: test clean $(TESTS)
