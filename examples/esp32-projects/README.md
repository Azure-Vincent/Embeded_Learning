# Host-testable helpers from ESP32 projects 6–10

The pure-C parts of the projects (frame encoder/parser, moving average, network back-off helper,
application logic, a 74HC595 model) compile and run on a PC:

```bash
make test
```

The `p6_*.c` … `p10_*.c` files are the ESP-IDF programs quoted in the project pages. The complete programs
(`p6_main.c`, `p7_main.c`, `p8_main.c`, `p9_main.c`, `p10_skeleton.c`) build for the `esp32` target with
ESP-IDF v6.1 and no warnings (see `tools/idf-check/`). `p6_flash.c`, `p7_raw.c` and `p8_post.c` are fragments
to be pasted into the matching program as the project page describes; they were compiled that way, not on
their own. Nothing here was run on hardware. Copy a program into an ESP-IDF project (`main/main.c`) and
build with `idf.py build`.
