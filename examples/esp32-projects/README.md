# Host-testable helpers from ESP32 projects 6–10

The pure-C parts of the projects (frame encoder/parser, moving average, network back-off helper,
application logic, a 74HC595 model) compile and run on a PC:

```bash
make test
```

The `p6_*.c` … `p10_*.c` files are the ESP-IDF programs quoted in the project pages. They were written against
the ESP-IDF documentation and were **not** compiled or run on hardware here; copy them into an ESP-IDF project
(`main/main.c`) and build with `idf.py build`.
