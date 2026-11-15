// Real-time systems, part D: the lab, skills, glossary, troubleshooting, references.
const C = String.raw;

const skills = [
  { id: 'rtos-sk-superloop', name: 'Structure bare-metal firmware as a superloop or time-triggered loop and say where it stops being enough', track: 'programming' },
  { id: 'rtos-sk-sched-predict', name: 'Predict which task runs next under cooperative, preemptive and time-sliced scheduling', track: 'programming' },
  { id: 'rtos-sk-config', name: 'Read a FreeRTOS configuration and explain what the tick, priorities, stacks and heap scheme imply', track: 'programming' },
  { id: 'rtos-sk-periodic', name: 'Write a drift-free periodic task and size its stack from a measured high-water mark', track: 'programming' },
  { id: 'rtos-sk-context', name: 'Explain what a context switch saves on Cortex-M and estimate its cost', track: 'programming' },
  { id: 'rtos-sk-isr-defer', name: 'Write an ISR that defers work to a task using the FromISR API correctly', track: 'programming' },
  { id: 'rtos-sk-ipc-choose', name: 'Choose between a queue, semaphore, notification, event group and stream buffer for a given hand-off', track: 'programming' },
  { id: 'rtos-sk-race-find', name: 'Find a race condition by reading code and classify it', track: 'programming' },
  { id: 'rtos-sk-critical', name: 'Choose the cheapest adequate protection: critical section, scheduler suspension or mutex', track: 'programming' },
  { id: 'rtos-sk-mutex', name: 'Use a mutex with bounded hold time and a timeout', track: 'programming' },
  { id: 'rtos-sk-inversion', name: 'Diagnose priority inversion and compute worst-case blocking', track: 'programming' },
  { id: 'rtos-sk-deadlock', name: 'Find a deadlock from lock order and remove it by design', track: 'programming' },
  { id: 'rtos-sk-rma', name: 'Check schedulability with the utilisation bound and response-time analysis', track: 'programming' },
  { id: 'rtos-sk-measure', name: 'Measure latency and jitter with GPIO toggles and a logic analyser', track: 'programming' },
  { id: 'rtos-sk-design', name: 'Draw a task diagram with data ownership, queue policies and watchdog supervision', track: 'programming' },
];

const labs = [
  {
    id: 'rtos-lab-multitask',
    title: 'Design, build and measure a multitasking system',
    kind: 'Guided laboratory',
    minutes: 240,
    summary: 'A FreeRTOS application on an ESP32 with a periodic sampler, a processing task, a log task and a button interrupt. You draw it, predict its schedule, measure its real jitter, then deliberately break it with a priority inversion and a deadlock and repair both.',
    skills: ['rtos-sk-design', 'rtos-sk-sched-predict', 'rtos-sk-periodic', 'rtos-sk-isr-defer', 'rtos-sk-mutex', 'rtos-sk-inversion', 'rtos-sk-deadlock', 'rtos-sk-measure'],
    requires: ['esp32'],
    objectives: [
      'Draw a task diagram with priorities, periods, queues and ownership before writing code.',
      'Predict the schedule on paper and in the scheduler simulator, then compare it with a logic-analyser capture.',
      'Measure the period jitter and response time of a periodic task under load.',
      'Handle a button with an ISR that defers to a task.',
      'Produce an unbounded priority inversion on purpose, measure it, and remove it.',
      'Produce a lock-order deadlock on purpose, diagnose it from the symptoms, and remove it.',
      'Size each task stack from its measured high-water mark.',
    ],
    hardware: [
      'ESP32 development board (original dual-core ESP32; an ESP32-S3 works with different pin choices — check its GPIO table)',
      'Push button between GPIO 27 and GND (the internal pull-up is used)',
      'Potentiometer (about 10 kΩ) with its ends on 3V3 and GND and its wiper on GPIO 34, or any 0–3.3 V signal',
      'Logic analyser with at least 4 channels (any low-cost 24 MHz 8-channel unit supported by sigrok/PulseView is enough)',
      'Jumper wires; USB cable',
    ],
    software: [
      'ESP-IDF (current stable release; see the ESP32 section for installation)',
      'PulseView (sigrok) or your analyser vendor\'s software',
      'A serial terminal (`idf.py monitor`)',
    ],
    background: [
      `You will build this system:

- **sample** — every 10 ms, reads the ADC and sends the reading to a queue. It has the hardest timing requirement.
- **process** — receives readings, keeps a running average, and updates a small shared **stats** structure protected by a mutex.
- **log** — once a second, takes a snapshot of the stats and prints it.
- **button** — a GPIO interrupt notifies a task, which debounces and resets the stats.
- **load** — an optional CPU-burning task at a middle priority, used to provoke priority inversion.

Three GPIOs are debug outputs for the logic analyser, and one channel watches the button, so the capture shows the schedule directly.`,
      { t: 'callout', kind: 'hw', md: 'Nothing in this lab was run on physical hardware by this course. Every expected result below is what the design and the documentation say you **should** see. If your board disagrees, the board is right: find out why. That is the lab.' },
      { t: 'callout', kind: 'warn', title: 'Pin all tasks to one core for this lab',
        md: `The ESP32 has two cores. If the tasks are allowed on both, the "medium" task simply runs on the other core and the priority inversion never appears, and the simulator's single-CPU predictions do not apply. Every task in this lab is created with \`xTaskCreatePinnedToCore(..., 1)\`. At the end you will remove the pinning and see what changes. The 10 ms period also assumes the default 100 Hz tick; check \`CONFIG_FREERTOS_HZ\`.` },
    ],
    diagram: [
      { t: 'ascii', caption: 'Wiring. GPIO 34 is input-only and on ADC1 (channel 6), so it is unaffected by Wi-Fi use of ADC2. None of these are strapping pins on the original ESP32.',
        text: `ESP32 pin   Connects to                      Purpose
---------   ------------------------------   ------------------------------
GPIO 27     button → GND                     button input (internal pull-up)
GPIO 34     potentiometer wiper              ADC1 channel 6
3V3 / GND   potentiometer ends               ADC source
GPIO 25     logic analyser CH0               high while sample task runs
GPIO 26     logic analyser CH1               high while process task holds the mutex
GPIO 33     logic analyser CH2               high while load task runs
GPIO 27     logic analyser CH3               button edge (stimulus)
GND         logic analyser GND               common reference (required)` },
      { t: 'ascii', caption: 'The task diagram you are aiming for. Draw your own on paper first, with priorities and stack sizes, before reading on.',
        text: `[GPIO 27 ISR]──notify──►┌─────────────┐
                        │ button  P7  │── resets stats (takes stats mutex) ──┐
                        └─────────────┘                                      ▼
┌─────────────┐  q_samples (16 × sample_t,   ┌─────────────┐   ┌────────────────────┐
│ sample  P6  │   timeout 0, count drops)    │ process P4  │──►│ stats (mutex,      │
│ 10 ms       │─────────────────────────────►│ event-driven│   │ hold time < 50 µs) │
└─────────────┘                              └─────────────┘   └────────────────────┘
      ▲ owns ADC                                                         ▲ snapshot
                                             ┌─────────────┐             │
              (load P5: burns CPU, no I/O)   │ log     P2  │─────────────┘
                                             │ 1 s, owns the console     │
                                             └─────────────┘` },
    ],
    steps: [
      { title: 'Draw the task diagram and write the timing table',
        md: `On paper, before any code: draw each task as a box with its **priority**, **period or trigger**, and a first guess at **stack size**. Draw the queue with its item type, length and what happens when it is full. Mark who owns the ADC and who owns the console. Mark the one piece of shared state and its lock.

Then fill in a table with a column for period T, a guess for execution time C, and utilisation C/T for each periodic task. Use these guesses to start: sample C = 0.2 ms, process C = 0.3 ms per sample, log C = 5 ms per second. Compute the total utilisation and compare it with the Liu–Layland bound for three tasks (0.780). Write the numbers down: you will replace the guesses with measurements in step 5.

Check your priorities against the rate-monotonic rule. Where they differ (the button task is event-driven and above the sampler), write one sentence justifying it — and one sentence on what bounds how long it can delay the sampler.` },
      { title: 'Predict the schedule in the simulator',
        md: `Open the scheduler simulator in the **preemptive** scenario. It has three periodic tasks; set them to approximate yours at a coarser scale (for example periods 5, 10, 20 ticks and run times 1, 2, 3) with rate-monotonic priorities. Before pressing run, sketch the first 20 ticks on paper. Then run it and compare. Now give the longest-period task the highest priority and predict which deadline is missed first.

Keep the sketch. The logic-analyser capture in step 5 should have the same shape.`,
        blocks: [
          { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'preemptive' }, title: 'Predict before you build' },
        ] },
      { title: 'Create the project skeleton: pins, queue, mutex',
        md: `Create a new ESP-IDF project and replace \`main.c\` with the following. It sets up the debug pins, the ADC, the queue and the mutex. Read the comments; every later step adds to this file.`,
        lang: 'c', status: 'idf-checked',
        code: C`#include <stdint.h>
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_timer.h"
#include "esp_attr.h"
#include "esp_log.h"

#define BUTTON_GPIO   27
#define DBG_SAMPLE    25
#define DBG_LOCK      26
#define DBG_LOAD      33
#define APP_CORE      1            /* every task in this lab is pinned here */

static const char *TAG = "lab";

typedef struct {
    uint32_t t_ms;
    int      raw;
} sample_t;

typedef struct {
    uint32_t count;
    int32_t  avg;
    int      min, max;
} stats_t;

static QueueHandle_t     s_samples;
static SemaphoreHandle_t s_stats_mutex;
static stats_t           s_stats;          /* shared: guarded by s_stats_mutex */
static volatile uint32_t s_dropped;        /* written only by sample_task      */
static adc_oneshot_unit_handle_t s_adc;
static TaskHandle_t s_h_sample, s_h_process, s_h_log, s_h_button;

static void debug_pins_init(void)
{
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << DBG_SAMPLE) | (1ULL << DBG_LOCK) | (1ULL << DBG_LOAD),
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&out);
}

static void adc_init(void)
{
    adc_oneshot_unit_init_cfg_t unit = { .unit_id = ADC_UNIT_1 };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit, &s_adc));
    adc_oneshot_chan_cfg_t chan = { .bitwidth = ADC_BITWIDTH_DEFAULT, .atten = ADC_ATTEN_DB_12 };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc, ADC_CHANNEL_6, &chan));   /* GPIO 34 */
}

/* Burn CPU for a given time without blocking: used to model work. */
static void burn_ms(uint32_t ms)
{
    int64_t end = esp_timer_get_time() + (int64_t)ms * 1000;
    while (esp_timer_get_time() < end) { }
}` },
      { title: 'Write the sampling, processing and log tasks',
        md: `Add the three tasks. Note where each debug pin is driven, that the sampler never blocks on the queue, and that the log task copies the stats under the mutex and prints **after** releasing it.`,
        lang: 'c', status: 'idf-checked',
        code: C`static void sample_task(void *arg)                 /* priority 6, period 10 ms */
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        gpio_set_level(DBG_SAMPLE, 1);
        sample_t s = { .t_ms = (uint32_t)(esp_timer_get_time() / 1000) };
        adc_oneshot_read(s_adc, ADC_CHANNEL_6, &s.raw);
        if (xQueueSend(s_samples, &s, 0) != pdTRUE) {
            s_dropped++;                           /* never block the sampler */
        }
        gpio_set_level(DBG_SAMPLE, 0);
        vTaskDelayUntil(&last, pdMS_TO_TICKS(10));
    }
}

static void process_task(void *arg)                /* priority 4, event-driven */
{
    sample_t s;
    for (;;) {
        if (xQueueReceive(s_samples, &s, pdMS_TO_TICKS(1000)) != pdTRUE) {
            ESP_LOGW(TAG, "no samples for 1 s");
            continue;
        }
        if (xSemaphoreTake(s_stats_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            gpio_set_level(DBG_LOCK, 1);
            s_stats.count++;
            s_stats.avg += (s.raw - s_stats.avg) / 8;          /* simple low-pass */
            if (s_stats.count == 1 || s.raw < s_stats.min) s_stats.min = s.raw;
            if (s_stats.count == 1 || s.raw > s_stats.max) s_stats.max = s.raw;
            gpio_set_level(DBG_LOCK, 0);
            xSemaphoreGive(s_stats_mutex);
        } else {
            ESP_LOGE(TAG, "process: stats mutex timeout");
        }
    }
}

static void log_task(void *arg)                    /* priority 2, period 1 s */
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        stats_t snap = { 0 };
        if (xSemaphoreTake(s_stats_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            snap = s_stats;                        /* copy out: hold time is a struct copy */
            xSemaphoreGive(s_stats_mutex);
        } else {
            ESP_LOGE(TAG, "log: stats mutex timeout");     /* somebody has held it for 50 ms */
        }
        ESP_LOGI(TAG, "n=%u avg=%d min=%d max=%d dropped=%u",
                 (unsigned)snap.count, (int)snap.avg, snap.min, snap.max, (unsigned)s_dropped);
        ESP_LOGI(TAG, "stack free (bytes): sample=%u process=%u log=%u button=%u",
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_sample),
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_process),
                 (unsigned)uxTaskGetStackHighWaterMark(NULL),
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_button));
        vTaskDelayUntil(&last, pdMS_TO_TICKS(1000));
    }
}` },
      { title: 'Add the button ISR with deferred handling, and app_main',
        md: `The ISR does one thing: notify the button task. The task debounces by waiting 30 ms and re-reading the pin, then resets the stats under the mutex. Kernel objects and tasks are created **before** the interrupt is enabled.`,
        lang: 'c', status: 'idf-checked',
        code: C`static void IRAM_ATTR button_isr(void *arg)
{
    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(s_h_button, &woken);
    portYIELD_FROM_ISR(woken);
}

static void button_task(void *arg)                 /* priority 7, event-driven */
{
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        vTaskDelay(pdMS_TO_TICKS(30));             /* debounce */
        if (gpio_get_level(BUTTON_GPIO) != 0) {
            continue;                              /* it was a bounce or a release */
        }
        if (xSemaphoreTake(s_stats_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            s_stats = (stats_t){ 0 };
            xSemaphoreGive(s_stats_mutex);
            ESP_LOGI(TAG, "stats reset");
        }
        ulTaskNotifyTake(pdTRUE, 0);               /* discard bounces seen meanwhile */
    }
}

void app_main(void)
{
    debug_pins_init();
    adc_init();

    s_samples = xQueueCreate(16, sizeof(sample_t));
    s_stats_mutex = xSemaphoreCreateMutex();
    configASSERT(s_samples && s_stats_mutex);

    /* Generous stacks to start with (bytes on ESP-IDF); trimmed in the last step. */
    xTaskCreatePinnedToCore(button_task,  "button",  4096, NULL, 7, &s_h_button,  APP_CORE);
    xTaskCreatePinnedToCore(sample_task,  "sample",  4096, NULL, 6, &s_h_sample,  APP_CORE);
    xTaskCreatePinnedToCore(process_task, "process", 4096, NULL, 4, &s_h_process, APP_CORE);
    xTaskCreatePinnedToCore(log_task,     "log",     4096, NULL, 2, &s_h_log,     APP_CORE);

    gpio_config_t btn = {
        .pin_bit_mask = 1ULL << BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    gpio_config(&btn);
    gpio_install_isr_service(0);
    gpio_isr_handler_add(BUTTON_GPIO, button_isr, NULL);
}` },
      { title: 'Measure the baseline with the logic analyser',
        status: 'hw',
        md: `Build, flash and open the monitor. You should see one stats line and one stack line per second, and \`dropped=0\`. Turn the potentiometer: \`avg\` should follow.

Connect the analyser (ground first). Capture at 1 MHz or faster for at least 10 s.

1. **Period and jitter of the sampler (CH0).** Measure rising edge to rising edge. Record mean, minimum and maximum over the whole capture (PulseView: add a *timing* or *jitter* decoder, or export and compute). You should see a mean of 10.00 ms. Write down max − min: that is your baseline jitter.
2. **Execution times.** CH0 high time is the sampler's response time per activation; CH1 high time is the mutex hold time in the process task. Put the measured values into your table from step 1 in place of the guesses and recompute utilisation.
3. **Order.** Confirm that each CH1 pulse follows a CH0 pulse: the process task runs only when the sampler has blocked.
4. **Button latency.** Trigger on the falling edge of CH3. The "stats reset" message is deliberately ~30 ms later (debounce). To see the ISR-to-task latency itself, temporarily toggle a spare pin as the first statement of the button task after \`ulTaskNotifyTake\` and measure from the CH3 edge to that pin. Then comment out \`portYIELD_FROM_ISR(woken)\`, rebuild, and measure again over twenty presses: you should see the latency become variable, up to about one tick. Restore the line.

Compare the capture with your sketch from step 2. Explain any difference before continuing.` },
      { title: 'Introduce a priority inversion on purpose',
        md: `Now break it. Three changes:

1. Add the **load** task below at priority 5 (between sample and process). It burns 60 ms of CPU every 200 ms and touches no shared data.
2. Make the sampler **use the stats mutex**: it will read \`s_stats.avg\` under the lock each cycle (as if it needed the average for a threshold check).
3. Create the lock as a **binary semaphore** instead of a mutex, so there is no priority inheritance, and make the process task hold it for longer by adding \`burn_ms(2)\` inside the locked region.

Before you run it, predict: what is the sampler's worst-case period now? Which channel will show the cause?`,
        lang: 'c', status: 'idf-checked',
        code: C`/* 1. New task */
static void load_task(void *arg)                   /* priority 5: between sample and process */
{
    for (;;) {
        gpio_set_level(DBG_LOAD, 1);
        burn_ms(60);
        gpio_set_level(DBG_LOAD, 0);
        vTaskDelay(pdMS_TO_TICKS(140));
    }
}
/* in app_main: xTaskCreatePinnedToCore(load_task, "load", 3072, NULL, 5, NULL, APP_CORE); */

/* 2. In sample_task, after adc_oneshot_read(): */
        int32_t avg_now = 0;
        if (xSemaphoreTake(s_stats_mutex, portMAX_DELAY) == pdTRUE) {
            avg_now = s_stats.avg;
            xSemaphoreGive(s_stats_mutex);
        }
        (void)avg_now;

/* 3. In app_main, replace the mutex creation with a lock that has NO inheritance: */
    s_stats_mutex = xSemaphoreCreateBinary();
    xSemaphoreGive(s_stats_mutex);
/*    ...and in process_task, add  burn_ms(2);  after gpio_set_level(DBG_LOCK, 1). */`,
        blocks: [
          { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'priority-inversion' }, title: 'What you are about to cause' },
        ] },
      { title: 'Measure the inversion, then remove it',
        status: 'hw',
        md: `Capture 10 s again. Look for places where CH1 (lock held) goes high, then CH2 (load) goes high **while CH1 is still high**, and CH0 (sampler) does not pulse for tens of milliseconds. You should see sampler periods of up to roughly 60–70 ms instead of 10 ms, followed by a burst of back-to-back catch-up activations, and \`dropped\` may start to rise. The sampler is being delayed by the load task, with which it shares nothing. Record the worst period.

**Fix 1 — restore the mutex.** Change the creation back to \`xSemaphoreCreateMutex()\` (and delete the extra \`xSemaphoreGive\`). Capture again. You should see that when the sampler blocks on the lock, the process task finishes its 2 ms locked region immediately even if the load task is ready: CH1 stays high without CH2 intruding. The sampler's worst-case period should now be about 10 ms plus the 2 ms hold time. Record it.

**Fix 2 — remove the sharing.** The sampler does not need the lock at all if the process task publishes the average through a length-1 queue written with \`xQueueOverwrite\` and read by the sampler with \`xQueuePeek(q, &avg, 0)\`. Implement it, remove \`burn_ms(2)\`, and measure again. Compare all three jitter figures with your baseline.`,
        blocks: [
          { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'priority-inheritance' }, title: 'What fix 1 should look like' },
        ] },
      { title: 'Introduce a deadlock on purpose, diagnose it, remove it',
        md: `Add a second mutex, \`s_cfg_mutex\`, guarding a small config struct (say a \`gain\` value). Then create opposite lock orders:

- the **process** task, while holding the stats mutex, takes the config mutex to read the gain;
- the **button** task takes the config mutex first (to reset the gain), and while holding it takes the stats mutex to reset the stats.

Use \`portMAX_DELAY\` on all four takes. To widen the window so that you can hit it by hand, put \`vTaskDelay(pdMS_TO_TICKS(20))\` between the two takes in the button task.

Run it and press the button once or twice. You should see \`log: stats mutex timeout\` once a second and the stats line fall to \`n=0\` (the log task could not take its snapshot, so it prints the zeroed one), then \`dropped\` climbing — the 16-item queue fills in 160 ms once nobody empties it. The log task itself keeps printing and the task watchdog stays quiet: nothing is hogging the CPU. **Diagnose it as if you did not know the cause:** which tasks stopped? Are they consuming CPU (look at CH1 and the idle behaviour)? What is each waiting for? If you enable \`CONFIG_FREERTOS_USE_TRACE_FACILITY\` and the stats formatting functions in menuconfig, \`vTaskList()\` output will show both tasks in the Blocked state.

Then fix it twice:

1. **Lock order.** Declare "stats before config" in a comment at the declarations and change the button task to follow it.
2. **No nesting.** Restructure so neither task holds both: the process task copies the gain under the config mutex, releases it, and only then takes the stats mutex; the button task resets each under its own lock in turn.

Finally replace every \`portMAX_DELAY\` on a mutex with a finite timeout and an error log, so that a future deadlock announces itself.`,
        lang: 'c', status: 'idf-checked',
        code: C`/* DELIBERATELY WRONG: opposite lock orders. Do not keep this. */

/* process_task: stats -> cfg */
    xSemaphoreTake(s_stats_mutex, portMAX_DELAY);
    xSemaphoreTake(s_cfg_mutex, portMAX_DELAY);
    int gain = s_cfg.gain;
    xSemaphoreGive(s_cfg_mutex);
    /* ... update s_stats using gain ... */
    xSemaphoreGive(s_stats_mutex);

/* button_task: cfg -> stats */
    xSemaphoreTake(s_cfg_mutex, portMAX_DELAY);
    s_cfg.gain = 1;
    vTaskDelay(pdMS_TO_TICKS(20));          /* widens the window so you can hit it */
    xSemaphoreTake(s_stats_mutex, portMAX_DELAY);
    s_stats = (stats_t){ 0 };
    xSemaphoreGive(s_stats_mutex);
    xSemaphoreGive(s_cfg_mutex);`,
        blocks: [
          { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'deadlock' }, title: 'The same deadlock, step by step' },
        ] },
      { title: 'Check stack high-water marks and trim',
        status: 'hw',
        md: `With the repaired firmware, exercise the worst paths: press the button repeatedly, sweep the potentiometer, leave the load task running, and let it run for several minutes. Read the "stack free" line.

For each task compute peak use = allocated − free. Set the new size to peak ÷ 0.7 (30 % of the stack left as margin), rounded up to a multiple of 256 bytes. Rebuild, repeat the worst-case run, and confirm that the free figures are now about 30 % of each stack and stable.

Then try the opposite: set the log task's stack to 1024 bytes. You should see either a stack-overflow report naming the task or a crash with a corrupted backtrace, depending on your overflow-check configuration. Note which, restore the size, and write down why "it boots" is not evidence that a stack is big enough.` },
      { title: 'Unpin the tasks and observe two cores',
        status: 'hw',
        md: `Change \`APP_CORE\` to \`tskNO_AFFINITY\` for the load and process tasks and repeat the measurement from step 6 with the load task running. You should see CH2 (load) high at the same time as CH0 or CH1 pulses: two tasks really executing at once. Re-run the inversion experiment with the binary-semaphore lock. Is the sampler still delayed? Explain what you see in terms of which core each task was on, and state why "it has no inversion on the dual-core board" is not a property you can rely on.` },
    ],
    walkthrough: [
      `**The sampler** blocks in \`vTaskDelayUntil\`. On each tick interrupt the kernel compares the tick count with the wake time stored for the task; when they match it moves the TCB from the delayed list to the priority-6 ready list and, because 6 is higher than whatever is running on that core, requests a switch. The first thing the task does is one write to the GPIO output register — the rising edge you measure. The delay between the tick and that edge is the sampler's release jitter: interrupt latency plus the context switch plus anything of higher priority (the button task, ISRs, kernel critical sections).

**\`xQueueSend\` with timeout 0** copies eight bytes into the queue's storage inside a short kernel critical section. Because the process task is blocked on that queue, the kernel also moves it to its ready list; it does not run yet because priority 4 is below 6. When the sampler blocks again, the scheduler picks it.

**The mutex** records the holder's TCB. When the sampler (6) blocks on it while the process task (4) holds it, the kernel raises the holder's priority to 6 and moves it to the priority-6 ready list, so the load task (5) cannot preempt it. On the give, the kernel restores priority 4 and readies the sampler. A binary semaphore has no holder field, so none of that happens — that is the entire difference between your broken and fixed captures.

**The button ISR** runs on the interrupt stack with the interrupted task's context saved. \`vTaskNotifyGiveFromISR\` increments a counter in the button task's TCB and moves it to the ready list. \`portYIELD_FROM_ISR(woken)\` makes the interrupt return through the scheduler, so the CPU resumes in the button task rather than in the task that was interrupted.

**The deadlock** is two TCBs each sitting on the other mutex's waiting list. Neither is on a ready list, so the scheduler never selects them. The idle task and the log task still run, which is why nothing "crashes".`,
    ],
    testing: [
      `Work through this list and keep the captures as evidence.

| Check | You should see |
|---|---|
| Baseline sampler period | mean 10.00 ms; record max − min jitter |
| Baseline \`dropped\` | stays 0 |
| Mutex hold time (CH1) in the final firmware | tens of microseconds |
| Button ISR-to-task latency with the yield | consistently short |
| Same without \`portYIELD_FROM_ISR\` | variable, up to about one tick (10 ms) |
| Inversion (binary semaphore + load task) | sampler gaps of tens of ms, coinciding with CH2 high while CH1 is high |
| After restoring the mutex | worst sampler period ≈ 10 ms + hold time |
| Deadlock build | \`log: stats mutex timeout\` every second, \`n=0\`, \`dropped\` rising, log task still printing, no task-watchdog report |
| After the lock-order fix | no freeze after 50 button presses |
| Stack free after trimming | roughly 30 % of each stack, stable over minutes |

For each row write the measured number next to the expectation. Where they differ, explain the difference or mark it as an open question — do not adjust the expectation to fit.`,
    ],
    troubleshooting: [
      { symptom: 'Sampler period measures 20 ms or irregular, never 10 ms', cause: 'The tick rate is not 100 Hz, or `pdMS_TO_TICKS(10)` is not a whole number of ticks; or the analyser sample rate is too low.', fix: 'Check `CONFIG_FREERTOS_HZ` in sdkconfig. Capture at 1 MHz or more.' },
      { symptom: 'No priority inversion appears even with the binary semaphore and load task', cause: 'Tasks are not all pinned to the same core, so the load task runs on the other core; or the process task\'s locked region is too short to be caught.', fix: 'Pin every task to `APP_CORE`, keep `burn_ms(2)` inside the locked region, and capture for longer.' },
      { symptom: '`task_wdt: Task watchdog got triggered` naming IDLE1 during the inversion experiment', cause: 'The load task\'s busy period is long enough, together with the other tasks, that the idle task on core 1 does not run within the watchdog timeout.', fix: 'Check that the load task really blocks for 140 ms in each cycle. Do not disable the watchdog; a 60 ms burn every 200 ms leaves idle plenty of time.' },
      { symptom: 'Board resets with `Guru Meditation Error` as soon as the button is pressed', cause: 'The ISR used `s_h_button` before the button task was created, or the handler calls a non-ISR-safe function.', fix: 'Create tasks before `gpio_isr_handler_add`. Keep the ISR to the three lines shown.' },
      { symptom: 'Several "stats reset" messages per press', cause: 'Contact bounce generating separate falling edges more than 30 ms apart, or a floating input.', fix: 'Confirm the pull-up is enabled and the button goes to GND. Look at CH3 on the analyser to see the bounce duration and lengthen the debounce delay to match.' },
      { symptom: 'ADC reading does not change, or reads 0 / 4095', cause: 'Potentiometer wiper not on GPIO 34, or the ends not on 3V3 and GND.', fix: 'Measure the wiper with a multimeter; it should sweep 0–3.3 V. Never connect 5 V to an ESP32 pin.' },
      { symptom: 'Logic analyser shows noise or nothing', cause: 'No common ground between analyser and board, or the threshold voltage is set for 5 V logic.', fix: 'Connect GND first. Set the threshold for 3.3 V logic.' },
      { symptom: 'Deadlock build never freezes', cause: 'The window between the two takes is too small to hit by hand, or both tasks happen to use the same order.', fix: 'Keep the 20 ms delay between the button task\'s two takes, and check the order in each task against the listing.' },
    ],
    challenge: [
      `Extend the system without being given the answer:

1. **Supervise it.** Subscribe the sample and process tasks to the ESP-IDF task watchdog and make each check in only when it has completed a cycle. Re-introduce the deadlock and show that the watchdog now reports the stuck task by name. Decide, and justify, whether the system should reset.
2. **Measure before you claim.** Enable Wi-Fi (station mode, connected and idle) and repeat the baseline jitter measurement. Report the change and identify, using extra debug pins or the task list, what is preempting the sampler.
3. **Take the sampling off the tick.** Use a periodic \`esp_timer\` at 1 kHz whose callback reads the ADC and passes samples to the process task through a stream buffer. (With the default dispatch method an \`esp_timer\` callback runs in a high-priority task, where \`adc_oneshot_read\` is allowed. The ADC header says it must not be called from an ISR, so a GPTimer alarm callback could only notify a task that does the read.) Size the buffer from rates and the worst stall you measured, state your overflow policy, and show the measured jitter.
4. **Write the timing argument.** With your measured C and T values, including the button task and the load task, do a response-time analysis for the sampler including the blocking term from the mutex. Compare the computed worst case with the worst case you captured.`,
    ],
    quiz: [
      { q: 'Why are all tasks pinned to one core for the inversion experiment?', kind: 'arch',
        choices: [
          { t: 'On two cores the medium task can run on the other core instead of preempting the holder.', ok: true, why: 'Inversion needs the medium task to take the CPU away from the low-priority holder. With a spare core it has no need to.' },
          { t: 'A FreeRTOS mutex only excludes tasks on the core that created it, so the lock would fail.', why: 'They work across cores. Pinning is about making the scheduling scenario reproducible, not about the mutex functioning.' },
          { t: 'The logic analyser can only observe pins driven from one core at a time.', why: 'The analyser observes pins, and any task on either core can drive a pin.' },
        ] },
      { q: 'In the broken build, the sampler shares the lock only with the process task. Why does the *load* task\'s 60 ms burn appear in the sampler\'s period?', kind: 'concept',
        choices: [
          { t: 'It preempts the process task while that task holds the lock, and nothing boosts the holder.', ok: true, why: 'The sampler is blocked behind the holder, and the holder is kept off the CPU by a task of intermediate priority. With no inheritance the holder cannot finish, so the sampler waits for the load task too.' },
          { t: 'The load task takes the same lock inside `burn_ms()`, so the sampler queues behind it.', why: '`burn_ms()` only reads the clock. The load task touches no shared data at all, which is what makes this failure hard to spot in a code review of the lock\'s users.' },
          { t: 'The load task has a higher priority than the sampler and simply preempts it for 60 ms.', why: 'It is priority 5 against the sampler\'s 6. It can only delay the sampler indirectly.' },
        ] },
      { q: 'During the deadlock, the task watchdog does not fire and the log task keeps printing. Why?', kind: 'concept',
        choices: [
          { t: 'Deadlocked tasks are Blocked and use no CPU, so the idle task still runs normally.', ok: true, why: 'The default task watchdog detects a starved idle task, which is the opposite of what a deadlock produces.' },
          { t: 'The task watchdog is suspended for as long as any task holds a mutex.', why: 'Holding a mutex has no effect on any watchdog.' },
          { t: 'The kernel detects deadlocks and suppresses the watchdog.', why: 'FreeRTOS has no deadlock detection. That is why application-level supervision is needed.' },
        ] },
      { q: 'After removing `portYIELD_FROM_ISR(woken)` from the button ISR, the measured ISR-to-task latency varies between almost 0 and about 10 ms. What sets the 10 ms?', kind: 'code',
        choices: [
          { t: 'The tick period: without the yield, the switch waits for the next tick.', ok: true, why: 'The task is ready but no switch was requested, so it waits for the scheduler\'s next look: the next tick, or the next blocking call of the running task if that comes first.' },
          { t: 'The debounce delay, which the task now has to sit through before it is seen to run.', why: 'The debounce delay is 30 ms and happens after the task has already started running.' },
          { t: 'The GPIO interrupt latency, which is longer when no yield is requested.', why: 'Interrupt entry takes microseconds and did not change. What changed is what happens on the way out of the ISR.' },
        ] },
      { q: 'You trim a stack to "peak use ÷ 0.7". What must be true for that number to be trustworthy?', kind: 'arch',
        choices: [
          { t: 'The worst-case code paths were actually executed before the high-water mark was read.', ok: true, why: 'The mark records history only. An unexercised error path may need more than anything measured so far.' },
          { t: 'The task was created with `xTaskCreate` rather than `xTaskCreatePinnedToCore`, so that it can migrate.', why: 'Core affinity does not affect how stack use is measured.' },
          { t: 'The board was reset just before reading the value.', why: 'A reset discards the history the mark is built from. The value is meaningful only after a long, demanding run.' },
        ] },
    ],
    rubric: [
      { criterion: 'Task diagram and timing table', points: 15, evidence: 'One page with priorities, periods, stack sizes, queue length and full-policy, peripheral ownership; utilisation computed with guessed and then measured values.' },
      { criterion: 'Prediction versus measurement', points: 15, evidence: 'Paper schedule sketch next to a logic-analyser capture, with differences explained.' },
      { criterion: 'Baseline jitter measurement', points: 15, evidence: 'Mean, min and max period over at least 1000 cycles, with the capture file or screenshot.' },
      { criterion: 'Priority inversion demonstrated and removed', points: 20, evidence: 'Capture showing the delayed sampler with the load task running while the lock is held; worst-case period before and after each fix.' },
      { criterion: 'Deadlock demonstrated, diagnosed and removed', points: 20, evidence: 'Written diagnosis from symptoms; the lock order stated in the source; 50 presses without a freeze.' },
      { criterion: 'Stack sizing', points: 15, evidence: 'Table of allocated, peak used and final size per task, measured after a stated worst-case exercise.' },
    ],
  },
];

const glossary = [
  { term: 'Superloop', def: 'A bare-metal program structure: one infinite loop in `main()` calling each job in turn. The worst-case wait for any job is one full pass of the loop.' },
  { term: 'Foreground/background', def: 'A bare-metal structure where interrupt handlers (foreground) record events and a main loop (background) processes them.' },
  { term: 'Time-triggered scheduler', def: 'A dispatcher driven by a periodic timer that runs each job at its own fixed period; jobs run to completion.' },
  { term: 'RTOS', def: 'Real-time operating system: a kernel that schedules tasks with predictable, bounded timing. Predictable, not necessarily fast.' },
  { term: 'Kernel', def: 'The part of an operating system that schedules tasks and implements objects such as queues and mutexes. In FreeRTOS it is a library linked into the application.' },
  { term: 'Task', def: 'An independent thread of execution with its own stack and priority, usually a function containing an infinite loop.' },
  { term: 'Task control block', def: 'The kernel\'s record for one task (TCB): saved stack pointer, priority, state-list links, name. FreeRTOS keeps the saved stack pointer as its first field.' },
  { term: 'Scheduler', def: 'The kernel code that decides which ready task runs. FreeRTOS uses fixed priorities: the highest-priority ready task runs.' },
  { term: 'Preemption', def: 'The kernel taking the CPU from a running task, at an interrupt, to run a higher-priority one, without the task\'s cooperation.' },
  { term: 'Cooperative scheduling', def: 'Scheduling in which a task keeps the CPU until it yields or blocks. Simple to reason about; one slow task delays all.' },
  { term: 'Time slicing', def: 'Rotating among ready tasks of equal priority at each tick (round-robin).' },
  { term: 'Tick', def: 'The periodic timer interrupt that advances kernel time. All delays and timeouts are whole numbers of ticks.' },
  { term: 'Idle task', def: 'The lowest-priority task, created by the kernel, which runs when nothing else is ready. Frees deleted tasks\' memory and may enter low-power sleep. ESP-IDF has one per core.' },
  { term: 'Ready list', def: 'A per-priority list of tasks that could run now. The scheduler takes the next task from the highest non-empty list.' },
  { term: 'Blocked state', def: 'A task waiting for an event or a time. It uses no CPU and is woken by the event or its timeout.' },
  { term: 'Suspended state', def: 'A task parked by `vTaskSuspend()` (or waiting indefinitely) until explicitly resumed or signalled.' },
  { term: 'Context switch', def: 'Saving the running task\'s CPU registers on its stack and restoring another task\'s, so execution continues in the other task.' },
  { term: 'PendSV', def: 'A Cortex-M exception that software can pend. FreeRTOS runs it at the lowest priority to perform context switches after all other handlers finish.' },
  { term: 'SysTick', def: 'A 24-bit timer inside Cortex-M cores, commonly used to generate the RTOS tick.' },
  { term: 'MSP / PSP', def: 'Cortex-M Main and Process Stack Pointers. Handlers use MSP; FreeRTOS tasks run on PSP, giving one interrupt stack and one stack per task.' },
  { term: 'Port layer', def: 'The CPU- and compiler-specific part of FreeRTOS: context save/restore, tick setup, critical sections, starting the first task.' },
  { term: 'ISR', def: 'Interrupt service routine: the function the CPU runs in response to an interrupt. It preempts every task and cannot block.' },
  { term: 'Interrupt latency', def: 'The time from an interrupt request to the first instruction of its handler. Lengthened by critical sections and higher-priority handlers.' },
  { term: 'Deferred interrupt handling', def: 'Keeping the ISR minimal and waking a task to do the bulk of the work, so the work can block and is prioritised by the scheduler.' },
  { term: 'FromISR API', def: 'FreeRTOS functions safe to call in an interrupt handler: they never block and report through an out-parameter whether a context switch is needed.' },
  { term: 'configMAX_SYSCALL_INTERRUPT_PRIORITY', def: 'On Cortex-M ports, the highest interrupt priority that kernel critical sections mask. Only interrupts at or logically below it may call FromISR functions.' },
  { term: 'Queue', def: 'A fixed-length FIFO of fixed-size items that are copied in and out. Senders and receivers can block with a timeout.' },
  { term: 'Binary semaphore', def: 'A kernel object with a count of 0 or 1, used for signalling between contexts. No owner and no priority inheritance.' },
  { term: 'Counting semaphore', def: 'A semaphore whose count ranges up to a maximum; used to count events or to guard a pool of identical resources.' },
  { term: 'Task notification', def: 'A 32-bit value built into every FreeRTOS task that can be used as a lightweight semaphore, counter or flag set aimed at one specific task.' },
  { term: 'Event group', def: 'A set of flag bits on which tasks can block until any or all of a chosen subset are set.' },
  { term: 'Stream buffer', def: 'A byte-stream buffer for exactly one writer and one reader, efficient for ISR-to-task data. A message buffer is the variant for discrete variable-length messages.' },
  { term: 'Mutex', def: 'A lock for mutual exclusion with an owning task and priority inheritance. Taken and given by the same task; never used from an ISR.' },
  { term: 'Recursive mutex', def: 'A mutex its holder may take again; it is released when given as many times as it was taken.' },
  { term: 'Hold time', def: 'How long a lock is held. It bounds how long other users of the lock can be blocked.' },
  { term: 'Race condition', def: 'A bug where the result depends on the relative timing of two execution contexts touching shared state.' },
  { term: 'Atomic', def: 'Indivisible with respect to other contexts: no other context can observe or interrupt the operation part-way.' },
  { term: 'Torn read', def: 'Reading multi-word or multi-field data while it is being updated, yielding a mixture of old and new parts.' },
  { term: 'Check-then-act', def: 'A race shape in which a condition is tested and then acted on as two separate steps, allowing another context to invalidate the test in between.' },
  { term: 'Critical section', def: 'A code region made indivisible, usually by masking interrupts (`taskENTER_CRITICAL`). Must be short and bounded. On ESP-IDF it also takes a spinlock.' },
  { term: 'Spinlock', def: 'A lock a core acquires by busy-waiting. ESP-IDF critical sections use one (`portMUX_TYPE`) so that the other core is excluded as well.' },
  { term: 'Reentrant', def: 'Safe to be executing in more than one context at once, because the function uses no unprotected shared state.' },
  { term: 'Deadlock', def: 'Tasks each waiting for something only another of them can release. Requires mutual exclusion, hold-and-wait, no preemption and circular wait together.' },
  { term: 'Livelock', def: 'Tasks that keep running and reacting to each other without making progress, for example retrying in lock-step.' },
  { term: 'Starvation', def: 'A ready task getting no (or too little) CPU because higher-priority tasks are always ready.' },
  { term: 'Priority inversion', def: 'A high-priority task waiting for a lower-priority one. Unbounded when a medium-priority task preempts the lock holder.' },
  { term: 'Priority inheritance', def: 'Temporarily raising a mutex holder\'s priority to that of the highest task waiting for the mutex, bounding inversion to the hold time.' },
  { term: 'Priority ceiling', def: 'A locking protocol in which each lock has a ceiling: the highest priority of any task that uses it. In the immediate form a task runs at the ceiling from the moment it takes the lock. On one core it limits blocking to one critical section per activation and prevents deadlock among the tasks using such locks. Not provided by FreeRTOS.' },
  { term: 'Hard real-time', def: 'A timing requirement where missing a deadline is a system failure. Firm: a late result is worthless. Soft: lateness degrades value.' },
  { term: 'Latency', def: 'The delay between an event and the response to it.' },
  { term: 'Jitter', def: 'Variation in a latency or period from one occurrence to the next.' },
  { term: 'WCET', def: 'Worst-case execution time: the longest a piece of code can take to run uninterrupted on the target.' },
  { term: 'Response time', def: 'Time from a task\'s release to its completion, including preemption and blocking. Deadlines constrain response time.' },
  { term: 'Utilisation', def: 'The fraction of CPU time a task needs: execution time divided by period. Summed over tasks to test schedulability.' },
  { term: 'Rate-monotonic', def: 'Fixed-priority assignment in which a shorter period means a higher priority. Optimal among fixed assignments when deadlines equal periods.' },
  { term: 'EDF', def: 'Earliest deadline first: a dynamic-priority policy that always runs the task with the nearest deadline. Not provided by FreeRTOS.' },
  { term: 'Back-pressure', def: 'What a full queue does to its producer: block it, or force it to drop, overwrite or coalesce. Must be chosen deliberately.' },
  { term: 'High-water mark', def: 'The smallest amount of stack that has ever been free for a task, from `uxTaskGetStackHighWaterMark()`. Bytes on ESP-IDF, words upstream.' },
  { term: 'Watchdog', def: 'A timer that resets (or reports on) the system unless it is fed in time. ESP-IDF\'s task watchdog applies this per task and to the idle tasks.' },
  { term: 'SMP', def: 'Symmetric multiprocessing: one kernel scheduling tasks across several identical cores, as on the dual-core ESP32.' },
  { term: 'Core affinity', def: 'A restriction on which core(s) a task may run on, set with `xTaskCreatePinnedToCore` on ESP-IDF.' },
];

const troubleshooting = [
  { symptom: 'ESP-IDF prints `task_wdt: Task watchdog got triggered` naming IDLE0 or IDLE1', area: 'Scheduling',
    causes: 'A task on that core never blocks (busy-wait loop, polling without a delay, `taskYIELD()` used as a wait), so the idle task is starved. Less often: a long computation at a priority above idle.',
    fix: 'Find the task that is always Ready (the message lists the tasks running at the time). Make it block on a queue, semaphore, notification or delay. Split long computations or lower their priority and add blocking points. Do not feed the watchdog from the loop to hide it.' },
  { symptom: '`***ERROR*** A stack overflow in task X has been detected`', area: 'Memory',
    causes: 'The task\'s stack is too small for its deepest call chain: large local arrays, `printf`/logging with formatting, recursion. On ESP-IDF, a stack size ported from a word-based FreeRTOS example is four times too small.',
    fix: 'Increase the stack, then measure with `uxTaskGetStackHighWaterMark()` after exercising worst-case paths and set peak plus margin. Move big buffers to static storage or the heap.' },
  { symptom: 'Random crashes, corrupted variables or hard faults that move when unrelated code changes', area: 'Memory',
    causes: 'An undetected stack overflow writing into a neighbouring allocation; or a pointer to a task\'s stack variable used after that function returned (for example sent through a queue).',
    fix: 'Enable stack overflow checking and check high-water marks. Search for `xQueueSend(q, &pointer, …)` where the pointer refers to a local. Send by value or transfer ownership of pool buffers.' },
  { symptom: 'Queue full: `xQueueSend` returns `errQUEUE_FULL`, or data is dropped under load', area: 'Communication',
    causes: 'Consumer slower than producer on average; a burst longer than the queue can absorb; the consumer blocked on something slow (flash, network, a mutex).',
    fix: 'Compare rates first: if the average consumption is too low, no queue length helps. Otherwise size the queue as (rate difference × burst or stall time) plus margin, choose an explicit full-policy, and count drops.' },
  { symptom: 'System freezes when two buttons (or two commands) are used at the same moment; otherwise fine', area: 'Locking',
    causes: 'Deadlock: two tasks take the same two mutexes in opposite orders, often hidden inside called functions.',
    fix: 'List every lock taken while another is held. Impose one global order or restructure so no task holds two. Replace `portMAX_DELAY` with finite timeouts that log which lock timed out.' },
  { symptom: 'A periodic task\'s timing drifts: it runs every 103 ms instead of 100 ms and falls behind', area: 'Timing',
    causes: '`vTaskDelay()` used for a periodic task, so the period is the delay plus execution and preemption time; or the wake-time variable is re-initialised inside the loop.',
    fix: 'Use `vTaskDelayUntil()`/`xTaskDelayUntil()` with the reference initialised once before the loop.' },
  { symptom: 'Works on a single-core chip (or with one core enabled), fails or corrupts data on a dual-core ESP32', area: 'SMP',
    causes: 'Code relied on priority, or on disabling the scheduler, for mutual exclusion. On two cores tasks of any priority run simultaneously, and `vTaskSuspendAll()` affects only the calling core.',
    fix: 'Protect shared data with a mutex or a spinlock-based critical section. As a diagnostic only, pin the tasks involved to one core and see whether the fault disappears — then fix the sharing.' },
  { symptom: 'High-priority task occasionally responds tens of milliseconds late although nothing above it is busy', area: 'Locking',
    causes: 'Priority inversion: it shares a lock with a low-priority task and a medium-priority task preempts the holder. Typical when the lock is a binary semaphore, or the holder blocks while holding a mutex.',
    fix: 'Use a mutex (priority inheritance), shorten the hold time, never block while holding it, or give the resource to one owner task. Confirm with GPIO traces of all three tasks.' },
  { symptom: 'Assertion or crash inside the kernel (list or queue code) at random times', area: 'Interrupts',
    causes: 'A FreeRTOS call from an interrupt above `configMAX_SYSCALL_INTERRUPT_PRIORITY` (Cortex-M: priority left at its reset value 0); a non-`FromISR` call in an ISR; a mutex given from an ISR; a NULL handle because the interrupt was enabled before the object was created.',
    fix: 'Set every kernel-using interrupt\'s priority explicitly. Use only `…FromISR` functions in handlers. Signal with semaphores or notifications. Create objects before enabling interrupts. Keep `configASSERT` enabled.' },
  { symptom: 'A task woken from an ISR responds with up to one tick of extra, variable delay', area: 'Interrupts',
    causes: 'The ISR does not request a context switch on exit: `xHigherPriorityTaskWoken` is ignored or `portYIELD_FROM_ISR()` is missing.',
    fix: 'Initialise the flag to `pdFALSE`, pass it to the FromISR call, and end the ISR with `portYIELD_FROM_ISR(flag)`.' },
  { symptom: 'ESP-IDF resets with an interrupt watchdog timeout', area: 'Interrupts',
    causes: 'Interrupts were disabled for too long: an over-long critical section, a blocking or slow call inside `taskENTER_CRITICAL`, or an ISR that loops or never clears its source.',
    fix: 'Keep critical sections to a few instructions with no function calls of unknown length. Check that each ISR clears its interrupt flag and does no slow work.' },
  { symptom: '`vTaskDelay(pdMS_TO_TICKS(1))` does not delay, or short delays are wildly inaccurate', area: 'Timing',
    causes: 'The requested time is below the tick period, so it converts to 0 ticks; and a delay of n ticks lasts anywhere between n−1 and n tick periods.',
    fix: 'Check the tick rate. For sub-tick or precise timing use a hardware timer (and wake a task from its ISR), not the tick.' },
  { symptom: 'Counter or flag occasionally wrong by one; the bug vanishes when logging is added', area: 'Shared state',
    causes: 'A race: read-modify-write on a variable shared with an ISR or another task. Added logging shifts the timing and hides it.',
    fix: 'Identify every context that touches the variable. Protect the update with a critical section (if an ISR is involved) or a mutex, or make one context the owner.' },
  { symptom: 'A 64-bit timestamp or multi-field struct sometimes reads as a wildly wrong value', area: 'Shared state',
    causes: 'A torn read: the reader was interrupted between words or fields by the writer.',
    fix: 'Read under a critical section into a local copy, or read twice and retry until both reads match (for a monotonic counter).' },
  { symptom: '`xTaskCreate` fails, or the board runs out of heap after adding a task', area: 'Memory',
    causes: 'Not enough contiguous heap for the stack; stacks over-allocated; on upstream FreeRTOS, `configTOTAL_HEAP_SIZE` too small or a fragmenting heap scheme.',
    fix: 'Check the return value of every create call. Trim stacks from measured high-water marks. Create long-lived objects once at start-up; consider static allocation.' },
  { symptom: 'Task appears to stop after waiting on a queue or semaphore, yet no error is reported', area: 'Communication',
    causes: 'Blocking forever with `portMAX_DELAY` on an event that never comes: producer died, signal sent before the waiter existed, or a binary semaphore that was never given.',
    fix: 'Use finite timeouts and handle the timeout path. Check start-up ordering. Add task supervision so a silent wait becomes a reported fault.' },
  { symptom: 'Console output from different tasks is interleaved mid-line', area: 'Communication',
    causes: 'Several tasks write to the same UART through unlocked calls.',
    fix: 'Give the console one owner task fed by a queue of messages, or use a logging facility that serialises output (ESP-IDF\'s `ESP_LOGx` does).' },
  { symptom: 'Device behaves on the bench, then resets in the field with a watchdog reset and no log', area: 'Timing',
    causes: 'A worst-case path (flash erase, radio retry, long critical section) that bench tests never exercised exceeded a deadline or the watchdog period.',
    fix: 'Do the timing analysis with worst-case figures, measure under worst-case load with GPIO traces, and record the reset reason and last check-in of each supervised task at boot.' },
];

const refs = [
  { org: 'FreeRTOS', title: 'Mastering the FreeRTOS Real Time Kernel (book source and PDF releases)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel-Book', note: 'The primary tutorial text: tasks, queues, interrupts, resource management, event groups, notifications.' },
  { org: 'FreeRTOS', title: 'FreeRTOS-Kernel source and API headers', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel', note: 'include/task.h, queue.h, semphr.h are the authoritative API contracts; portable/ holds each CPU port.' },
  { org: 'FreeRTOS', title: 'FreeRTOS kernel documentation', url: 'https://www.freertos.org/Documentation/', note: 'Not load-tested from this environment (docs/FACTS.md, UNVERIFIED item 9).' },
  { org: 'Espressif', title: 'ESP-IDF: FreeRTOS (IDF) — documentation source', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/system/freertos_idf.rst', note: 'How ESP-IDF FreeRTOS differs: SMP scheduling, stack sizes in bytes, core affinity, spinlock critical sections.' },
  { org: 'Espressif', title: 'ESP-IDF: FreeRTOS overview and supplemental features — documentation sources', url: 'https://github.com/espressif/esp-idf/tree/v6.1/docs/en/api-reference/system', note: 'See freertos.rst and freertos_additions.rst in this directory.' },
  { org: 'Espressif', title: 'ESP-IDF: Watchdogs — documentation source', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/system/wdts.rst', note: 'Interrupt watchdog and task watchdog.' },
  { org: 'Espressif', title: 'ESP-IDF Programming Guide (rendered)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/', note: 'Not load-tested from this environment (docs/FACTS.md, UNVERIFIED item 9).' },
  { org: 'Arm', title: 'Arm developer documentation: ARMv7-M / ARMv6-M Architecture Reference Manuals and Cortex-M generic user guides (exception model)', url: 'https://developer.arm.com/documentation', note: 'Exception entry/return, MSP/PSP, SVC, PendSV, SysTick, BASEPRI. Not load-tested from this environment.' },
  { org: 'Arm', title: 'CMSIS core headers (NVIC and SysTick access functions)', url: 'https://github.com/ARM-software/CMSIS_6' },
  { org: 'RISC-V International', title: 'RISC-V instruction set manual, privileged architecture (trap handling)', url: 'https://github.com/riscv/riscv-isa-manual' },
  { org: 'ACM', title: 'C. L. Liu and J. W. Layland, "Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environment", Journal of the ACM 20(1), 1973', url: 'https://dl.acm.org/doi/10.1145/321738.321743', note: 'Cite by title; URL not load-tested here.' },
  { org: 'IEEE', title: 'L. Sha, R. Rajkumar, J. P. Lehoczky, "Priority Inheritance Protocols: An Approach to Real-Time Synchronization", IEEE Transactions on Computers 39(9), 1990', url: 'https://ieeexplore.ieee.org/document/57058', note: 'Cite by title; URL not load-tested here.' },
  { org: 'NASA/JPL', title: 'Glenn Reeves, "What really happened on Mars?" (account of the Mars Pathfinder priority inversion, 1997)', url: 'https://www.cs.unc.edu/~anderson/teach/comp790/papers/mars_pathfinder_long_version.html', note: 'Widely mirrored e-mail account by the Pathfinder flight software lead; search by title if this mirror has moved. Not load-tested here.' },
  { org: 'sigrok', title: 'PulseView logic analyser software', url: 'https://github.com/sigrokproject/pulseview' },
];

export default { skills, labs, glossary, troubleshooting, refs };
