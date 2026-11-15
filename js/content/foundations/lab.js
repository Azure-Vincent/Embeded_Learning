// Foundations lab: bring up the bench. Commands are written against the ESP-IDF v6.1 documentation sources.
// None of this was run against a physical board; ESP-IDF itself was not installed in the authoring environment.

export default {
  id: 'fnd-lab-bench',
  title: 'Lab: bring up your bench',
  kind: 'Guided lab',
  minutes: 120,
  summary: 'Install and verify the toolchain, build ESP-IDF hello_world, flash it and read its serial output, and record every version in your notebook. A no-hardware path is included.',
  skills: ['fnd-idf-install', 'fnd-linux-serial', 'fnd-serial-tools', 'fnd-git', 'fnd-learn-loop', 'fnd-debug-method'],
  objectives: [
    'Install the host tools and ESP-IDF on Ubuntu and prove each is working with a verification command',
    'Build the hello_world example and identify the files a build produces and where each is written in flash',
    'Find a board\'s serial device, fix access to it properly, and flash and monitor the board',
    'Record tool versions and the flashed source state in a notebook entry that someone else could reproduce',
    'Without hardware: complete the build, inspect its output, and use a Workbench tool to practise the serial step',
  ],
  hardware: [
    'A computer running Ubuntu (22.04 or 24.04 LTS recommended), installed natively if possible',
    'Optional but recommended: an ESP32-family development board (ESP32, ESP32-S3, ESP32-C3 or ESP32-C6)',
    'A USB cable known to carry data',
    'No other parts. Nothing is wired to the board in this lab',
  ],
  software: [
    'git, cmake, ninja-build, python3 with venv (from Ubuntu packages)',
    'ESP-IDF, installed by the ESP-IDF Installation Manager or by the legacy install.sh method',
    'A web browser for the Workbench (no-hardware path)',
  ],
  background: [
    `Every later lab assumes a working chain from your editor to a running chip. This lab builds that chain one link at a time and proves each link before adding the next. That order matters: if you install everything, plug in the board and run one command that fails, you have six suspects. If each link was verified when it was added, a failure can only be in the newest one.

The chain has two halves that can be checked independently:

- **Build half**: host tools → ESP-IDF environment → cross-compiler → image files in \`build/\`. This needs no board.
- **Device half**: cable → USB enumeration → device node → permissions → bootloader → running application → serial output.

If you have no board yet, complete the build half fully. It is real, checkable work: you will have a firmware image and you will know what is in it. Record the lab as completed without hardware and return to the device half when a board arrives.`,
    { t: 'callout', kind: 'hw', md: `The expected outputs in this lab are taken from Espressif's documentation and from how the tools are specified to behave. They were not captured from a board by the authors of this course. Where your output differs, that is information: write it down and work out why.` },
  ],
  diagramTitle: 'The chain you are building, and how each link is verified',
  diagram: [
    { t: 'ascii', text: `BUILD HALF (no board needed)

 source files --> idf.py build --> CMake + Ninja --> cross-compiler --> build/
                      |                                   |
            needs the ESP-IDF                  xtensa-...-gcc  (ESP32, ESP32-S3)
            environment active                 riscv32-esp-elf-gcc (ESP32-C3, C6)
            in THIS terminal

 build/bootloader/bootloader.bin            second-stage bootloader
 build/partition_table/partition-table.bin  what lives where in flash
 build/hello_world.bin                      your application
 build/hello_world.elf                      same code + symbols, for debugger and monitor

DEVICE HALF

 laptop --USB data cable--> bridge chip or native USB --> UART0 / USB serial --> chip
   |            |                    |                          |
 lsusb       dmesg -w          /dev/ttyUSB0 or             boot ROM waits for the
 (enumerated?) (driver bound?)  /dev/ttyACM0 (dialout?)     flashing tool if BOOT is held` },
    `### Installation verification table

Fill in the right-hand column in your notebook as you go. A row is complete only when you have seen the output yourself.

| Link | Verification command | A pass looks like | Your result |
|---|---|---|---|
| Operating system | \`lsb_release -ds\` and \`uname -r\` | Ubuntu release name and kernel version | |
| Git | \`git --version\` | A version number | |
| Python | \`python3 --version\` | 3.10 or newer (the ESP-IDF minimum) | |
| CMake | \`cmake --version\` | A version number (ESP-IDF v6.1's example asks for at least 3.22) | |
| Ninja | \`ninja --version\` | A version number | |
| Serial group | \`id -nG\` | The list includes \`dialout\` | |
| ESP-IDF environment | \`idf.py --version\` | An ESP-IDF version string | |
| ESP-IDF location | \`echo $IDF_PATH\` | A directory that exists | |
| Cross-compiler | \`xtensa-esp32-elf-gcc --version\` or \`riscv32-esp-elf-gcc --version\` | A compiler banner. If the name is not found, read the compiler path from \`build/compile_commands.json\` after the first build | |
| Build | \`idf.py build\` | Ends with "Project build complete" and a flashing command | |
| USB enumeration | \`lsusb\` before and after plugging in | One new line | |
| Device node | \`sudo dmesg -w\` while plugging in | "now attached to ttyUSB0" or "ttyACM0: USB ACM device" | |
| Flash | \`idf.py -p PORT flash\` | A "Hash of data verified." line after each of the three images, then a "Hard resetting" line | |
| Serial output | \`idf.py -p PORT monitor\` | Boot log, then \`Hello world!\` | |`,
  ],
  steps: [
    { title: 'Open a notebook entry and record the starting state', md: `Create an entry titled "Bench bring-up" in the app's Lab notebook, or in a text file you will later commit. Record the date, the computer, and the output of the commands below. Write down, before you begin, **which step you predict will give you trouble and why**. Compare at the end.`, code: `lsb_release -ds\nuname -r\npython3 --version`, lang: 'bash', status: 'reviewed' },
    { title: 'Install and verify the host tools', md: `Install the packages the legacy ESP-IDF guide lists. They are harmless if you later use the Installation Manager, and you need git, cmake and ninja regardless. Then run each verification command from the table and record its output.

If \`python3 --version\` reports something older than 3.10, stop here and upgrade Ubuntu or install a newer Python before continuing; ESP-IDF will not work.`, code: `sudo apt-get update\nsudo apt-get install git wget flex bison gperf python3 python3-pip python3-venv cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0\n\ngit --version\ncmake --version\nninja --version`, lang: 'bash', status: 'reviewed' },
    { title: 'Give your user access to serial ports', md: `Add yourself to \`dialout\`, then **log out of the desktop and back in** (or reboot). Open a new terminal and check that \`dialout\` appears. Do this now, before a board is involved, so that a permission problem cannot be confused with a cable problem later.

If you do not use a Braille display, also remove \`brltty\`, which claims common USB serial chips on some Ubuntu releases.`, code: `sudo usermod -aG dialout "$USER"\n# log out and back in, then in a new terminal:\nid -nG\n\n# optional, if you have no Braille display:\nsudo apt remove brltty`, lang: 'bash', status: 'reviewed' },
    { title: 'Install ESP-IDF', md: `Choose **one** route.

**Route A, Installation Manager (the default since ESP-IDF v6.0).** When \`eim install\` finishes, it prints a \`source ".../activate_idf_<version>.sh"\` command. Copy that exact line into your notebook: it is how you activate the environment in every new terminal.

**Route B, legacy.** Clone the release and run its install script, then source \`export.sh\`.

Either way, finish by running \`idf.py --version\` and \`echo $IDF_PATH\` in the activated terminal and recording both.`, blocks: [
      { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Route A', code: `echo "deb [trusted=yes] https://dl.espressif.com/dl/eim/apt/ stable main" | sudo tee /etc/apt/sources.list.d/espressif.list\nsudo apt update\nsudo apt install eim\neim install\n# then run the "source ..." activation command that eim printed` },
      { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Route B', code: `mkdir -p ~/esp && cd ~/esp\ngit clone -b v6.1 --recursive https://github.com/espressif/esp-idf.git\ncd ~/esp/esp-idf\n./install.sh esp32        # or: ./install.sh all\n. $HOME/esp/esp-idf/export.sh` },
      { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Verify (both routes)', code: `idf.py --version\necho $IDF_PATH` },
      { t: 'callout', kind: 'note', md: `If a newer stable ESP-IDF than v6.1 exists when you do this lab, use the version its get-started guide names. Record the version you installed; later lessons will ask.` },
    ] },
    { title: 'Copy hello_world, put it under Git, select your chip', md: `Copy the example out of the ESP-IDF tree, create a repository with a \`.gitignore\` **before** the first build so build output is never committed, and select the target that matches the chip on your board (\`esp32\`, \`esp32s3\`, \`esp32c3\`, \`esp32c6\`). With no board, use \`esp32\`.

Git refuses to commit until it knows your name and e-mail address, so the first two lines set them; skip them if \`git config --global user.name\` already prints a name. \`set-target\` writes the full configuration to a new file, \`sdkconfig\`, which \`git status --short\` should list as untracked (\`??\`). This lab commits it, so that the repository records every option the image was built with. If the later build adds other untracked files that are not build output (for example \`dependencies.lock\`), commit those too.

Before running \`set-target\`, predict: which cross-compiler will this choice select, Xtensa or RISC-V?`, code: `mkdir -p ~/esp\ncp -r $IDF_PATH/examples/get-started/hello_world ~/esp/\ncd ~/esp/hello_world\n\ngit config --global user.name  "Your Name"          # once per computer, if never done\ngit config --global user.email "you@example.com"\n\ngit init\nprintf 'build/\\nsdkconfig.old\\nmanaged_components/\\nbuild.log\\n' > .gitignore\ngit add .\ngit commit -m "Import ESP-IDF hello_world example unchanged"\n\nidf.py set-target esp32\ngit status --short\ngit add sdkconfig\ngit commit -m "Select target esp32"`, lang: 'bash', status: 'reviewed' },
    { title: 'Build, and predict what a second build will do', md: `Run the build and save its output. The first build compiles the SDK components the example needs and takes a few minutes.

Before running the build a second time, write a prediction: how many files will be compiled? Then run it and compare. Then open \`main/hello_world_main.c\`, change nothing, save it (or \`touch\` it), and build again. Record how many steps ran each time and explain the numbers using what you know about how Make and Ninja decide what is out of date.`, code: `idf.py build 2>&1 | tee build.log\nidf.py build\ntouch main/hello_world_main.c\nidf.py build`, lang: 'bash', status: 'reviewed' },
    { title: 'Inspect the build output', md: `This step is the core of the no-hardware path, and worth doing with a board too. Answer each question in your notebook from the files, not from memory.

1. List the three \`.bin\` files and their sizes.
2. Open \`build/flasher_args.json\`. At what flash offset will each \`.bin\` be written? Compare the bootloader's offset with what you expect for your chip: the boot ROM of the original ESP32 looks for it at \`0x1000\`; on ESP32-S3, C3 and C6 it is at \`0x0\`.
3. Run \`idf.py size\`. How much flash does the application use, and how much RAM is statically allocated?
4. Open \`build/compile_commands.json\` and read the first entry. What is the full path of the compiler? Is it an Xtensa or a RISC-V compiler? Does that match your prediction from the previous step?
5. \`build/hello_world.elf\` is much larger than \`build/hello_world.bin\`. Why? What does the ELF contain that the chip does not need?`, code: `ls -l build/*.bin build/bootloader/*.bin build/partition_table/*.bin\ncat build/flasher_args.json\nidf.py size\nhead -n 12 build/compile_commands.json\nls -l build/hello_world.elf build/hello_world.bin`, lang: 'bash', status: 'reviewed' },
    { title: 'Find the board (with hardware), or practise the serial step (without)', blocks: [
      `**With a board.** Run \`lsusb\` and note the list. Start \`sudo dmesg -w\`. Plug the board in. Record the lines that appear and the device node named in the last one. Stop dmesg with Ctrl+C, run \`lsusb\` again and note the new line, then check the node's owner, group and mode.

If nothing at all appears in dmesg, the fault is the cable or the connector: change the cable before anything else. If the node appears and then disconnects, read the lines around it for the name of the program responsible.`,
      { t: 'code', lang: 'bash', status: 'reviewed', code: `lsusb\nsudo dmesg -w          # plug in the board, read, then Ctrl+C\nlsusb\nls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null` },
      `**Without a board.** Use the simulated serial terminal below. Set the terminal to 115200 baud, 8N1, the default console setting of ESP-IDF, and exchange a few bytes with the simulated device. Then deliberately choose a wrong baud rate and observe what arrives. Write down what the wrong setting looks like, so you recognise it when a real board shows it. This is a model of a UART link: it has no USB layer, no permissions and no boot process, which are the parts you will still need to verify on real hardware.`,
      { t: 'widget', name: 'uart-terminal', props: { baud: 115200, format: '8N1' }, caption: 'Workbench UART terminal. Try the matching setting first, then a mismatched one.' },
    ] },
    { title: 'Flash and monitor (hardware only)', md: `Flash and open the monitor in one command, using the port you found. You should see the flashing tool connect, write three images and verify each, then reset the chip. The monitor should then show the boot log followed by \`Hello world!\`, a line describing the chip, and a countdown, after which the chip restarts and the sequence repeats.

If the tool prints a row of dots and then reports \`Failed to connect\`, hold the board's **BOOT** button, start the command again, and release the button when writing begins. If it stops instead with a fatal error saying the chip is not the type it expected, the project's target does not match your board: go back, run \`idf.py set-target\` with the chip name the tool printed, and rebuild.

In the boot log, find and record: the reset reason, the application's project name and **app version**, and the ESP-IDF version the image was built with. Exit the monitor with **Ctrl+]**.

Without hardware, tick this step after reading it and answering in your notebook: which of the three images would be written to which offset, and which line of the boot log would tell you the source state of the image?`, code: `idf.py -p /dev/ttyUSB0 flash monitor`, lang: 'bash', status: 'hw' },
    { title: 'Record versions and tag what you flashed', md: `First \`git status --short\` should print nothing; if it lists files, commit them (or add build products to \`.gitignore\`) before going on. Tag the commit you built from, capture the identifier, and paste it with the tool versions into the notebook entry. \`versions.txt\` is a record worth keeping: commit it afterwards. The app version inside the image was fixed when the image was built, so if you want the boot log to show the tag name, build and flash once more after tagging and check what the "App version" line says. Complete the verification table. Finally, answer the question you set yourself in step 1: was your prediction about the difficult step right?`, code: `git status --short\ngit tag -a bench-bringup -m "hello_world, first verified build"\ngit describe --tags --always --dirty\n\n{ lsb_release -ds; uname -r; git --version; python3 --version; cmake --version | head -n 1; ninja --version; idf.py --version; } 2>&1 | tee versions.txt`, lang: 'bash', status: 'reviewed' },
  ],
  walkthrough: [
    `### What \`idf.py build\` does

\`idf.py\` is a Python front end. On the first build it runs CMake, which reads your project's \`CMakeLists.txt\`, includes ESP-IDF's build logic through \`IDF_PATH\`, selects the cross-compiler for the chosen target through a toolchain file, and generates Ninja build files in \`build/\`. It then runs Ninja, which executes the compile and link commands. The result is not one program but three images, because the chip boots in stages.

### What the three images are for

- **\`bootloader.bin\`** is the second-stage bootloader. The chip's built-in boot ROM, which cannot be changed, loads it from a fixed flash offset: \`0x1000\` on the original ESP32, \`0x0\` on ESP32-S3, C3 and C6. It initialises flash access and decides which application to start.
- **\`partition-table.bin\`** is a small table, written at \`0x8000\` by default, that tells the bootloader how the rest of flash is divided: where the application is, where non-volatile storage is.
- **\`hello_world.bin\`** is your application together with the parts of ESP-IDF it uses, including FreeRTOS. In the default layout it is written at \`0x10000\`.

\`flasher_args.json\` records exactly these offset-and-file pairs. \`idf.py flash\` reads it and passes them to \`esptool\`. The Boot sequence lessons in later sections follow this chain instruction by instruction, and the Security section shows how secure boot adds a signature check at each hand-over.

### What \`idf.py flash\` does on the wire

The flashing tool opens the serial port and toggles two control lines of the USB bridge, DTR and RTS. On most dev boards a small transistor circuit connects those lines to the chip's EN (reset) pin and to its boot-mode pin. That pin is a **strapping pin**: the boot ROM samples it at reset, and if it is low, the ROM waits for a flashing tool on the serial port instead of starting the application. Which pin it is depends on the chip: **GPIO0** on the ESP32 and ESP32-S3, **GPIO9** on the ESP32-C3 and ESP32-C6. The tool pulses the lines so that the chip resets with the boot-mode pin low, then talks to the ROM's serial bootloader, uploads a small helper program, and writes and verifies each image.

The **BOOT** button is wired to that same pin. Holding it during reset does by hand what the DTR/RTS circuit does automatically, which is why it rescues a board whose automatic circuit is missing, mistimed, or defeated by a USB hub or virtual machine.

A board connected through the chip's own USB Serial/JTAG port (ESP32-S3, C3, C6) has no bridge chip and no DTR/RTS transistor circuit; the USB controller inside the chip performs the reset into the bootloader when the tool asks for it. The BOOT button works the same way if that fails.

### What the monitor adds

\`idf.py monitor\` is a serial terminal that also knows your project. It opens the port at the console baud rate (115200 by default) and, because it has \`build/hello_world.elf\`, it can translate raw code addresses printed in a crash report into function names and line numbers. That is one practical reason the ELF file is kept beside the binary.`,
  ],
  testing: [
    `The lab is complete when you can show each of the following from your own notebook entry. Phrase each as an observation you made.

**Both paths**

- Every row of the verification table up to "Build" has an output recorded.
- \`idf.py build\` ended with a "Project build complete" message, and a second build with no changes compiled nothing. You can explain why.
- You can state, from \`flasher_args.json\`, which file goes to which offset for your target.
- \`git describe --tags --always --dirty\` printed an identifier that does **not** end in \`-dirty\`.

**Hardware path**

- You should see the board's node named in dmesg, and \`ls -l\` showing group \`dialout\` with your user in that group.
- Flashing should end with verification messages and a hard reset.
- The monitor should show \`Hello world!\` repeating after each countdown. Check that it is *your* build: change the text in \`main/hello_world_main.c\`, rebuild, flash and confirm the new text appears. A unique message is the simplest proof that the code you are reading is the code that is running. Commit that change, and note that the app version in the boot log changes with it.
- Press the board's EN/reset button while the monitor is open. You should see the boot log start again, with a reset reason that differs from the one after a software restart.

**No-hardware path**

- You exchanged bytes in the Workbench UART terminal at 115200 8N1 and recorded what a mismatched baud rate looks like.
- You recorded the lab as completed without hardware. The skills in this lab then show "Built in a lab" and rise to "Verified on hardware" when you repeat the device half on a board.`,
  ],
  troubleshooting: [
    { symptom: '`Permission denied: \'/dev/ttyUSB0\'` when flashing or monitoring', cause: 'Your session is not in the `dialout` group, either because you were never added or because you have not logged in again since.', fix: 'Run `sudo usermod -aG dialout "$USER"`, log out of the desktop and back in, confirm with `id -nG`. Do not use `sudo idf.py`: it leaves root-owned files in `build/`.' },
    { symptom: 'A row of dots, then `Failed to connect to ESP32` (followed by "No serial data received", or "Timed out waiting for packet header" with older esptool releases)', cause: 'The chip did not enter its serial bootloader. The automatic reset circuit did not pull the boot-mode pin (GPIO0 on ESP32/S3, GPIO9 on C3/C6) low at reset, or something wired to that pin or to EN is interfering.', fix: 'Hold the BOOT button, start the flash command, release BOOT when writing starts. If that works every time, the auto-reset circuit is the issue. Disconnect anything attached to strapping pins; try without a USB hub.' },
    { symptom: '"Could not open port" or "No such file or directory" for the port', cause: 'Wrong port name: the board is `ttyACM0` not `ttyUSB0`, or it re-enumerated as `ttyUSB1`, or there is no device at all.', fix: 'Run `ls /dev/ttyUSB* /dev/ttyACM*` and read the last lines of `sudo dmesg`. Use the node named there. If none exists, see the next row.' },
    { symptom: 'Power LED on, but nothing new in `lsusb` or `dmesg`', cause: 'Charge-only USB cable, a damaged cable or connector, or (in a VM or WSL) the device is still attached to the host.', fix: 'Swap to a cable known to carry data and label the bad one. In a VM, attach the device to the guest; in WSL, attach it with usbipd.' },
    { symptom: 'Port appears in dmesg, then "now disconnected from ttyUSB0" within a second', cause: '`brltty` claimed the USB bridge chip.', fix: '`sudo apt remove brltty`, then replug. Confirm the "attached" line is now the last one.' },
    { symptom: 'First flash attempt after plugging in says the port is busy; a later attempt works', cause: 'ModemManager is probing the new port, or another terminal program still has it open.', fix: 'Check with `sudo fuser -v /dev/ttyUSB0`. Close stray monitors and `screen` sessions. If it is ModemManager and you have no modem: `sudo systemctl disable --now ModemManager`.' },
    { symptom: '`idf.py: command not found`', cause: 'The ESP-IDF environment is not active in this terminal.', fix: 'Run the activation command for your install route (the `source` line printed by `eim`, or `. $HOME/esp/esp-idf/export.sh`) in this terminal.' },
    { symptom: 'Python errors from `idf.py` about missing modules, or a message that the Python environment or requirements are not satisfied', cause: 'A different virtual environment is active (your project `.venv`, conda), so `idf.py` runs under the wrong Python; or the install step was interrupted.', fix: '`deactivate` any other environment (`conda deactivate` for conda), open a fresh terminal, activate only ESP-IDF. If it persists, rerun the installer (`./install.sh` or `eim install`).' },
    { symptom: '`error: externally-managed-environment` from pip', cause: 'You tried to install a Python package into Ubuntu\'s system Python.', fix: 'Create a virtual environment: `python3 -m venv .venv`, `. .venv/bin/activate`, then install. Never use `--break-system-packages` for project tools.' },
    { symptom: '`cmake: not found`, `ninja: not found`, or CMake reports it is older than the required minimum', cause: 'Host prerequisites are missing, or the distribution\'s CMake is older than this ESP-IDF version needs.', fix: '`sudo apt-get install cmake ninja-build`. Ubuntu 22.04 and 24.04 ship a CMake that meets the 3.22 minimum. On an older release, ask the ESP-IDF tools installer for its own copy (`python3 $IDF_PATH/tools/idf_tools.py install cmake ninja` on the legacy route, then source `export.sh` again and check `which cmake`); on Linux it does not download them by default.' },
    { symptom: 'Build fails with missing files inside `components/`, or "not a git repository" in a submodule (legacy route)', cause: 'ESP-IDF was cloned without `--recursive`, so submodules are empty.', fix: 'In `~/esp/esp-idf` run `git submodule update --init --recursive`, then rebuild.' },
    { symptom: 'Monitor shows a steady stream of unreadable characters', cause: 'Baud rate mismatch between the monitor and the chip\'s console, or (per Espressif\'s guide) a board whose crystal frequency differs from the configured one, which scales every baud rate.', fix: 'Use `idf.py monitor`, which reads the configured rate. If still garbled, check the crystal frequency setting in `idf.py menuconfig` against your board\'s documentation.' },
    { symptom: 'Flashing stops right after connecting with a fatal error that the chip is a different type from the one expected', cause: 'The project was built for a different target than the chip on the board. The image would be for the wrong CPU and its bootloader at the wrong offset, so the flashing tool refuses to write it.', fix: 'Read the chip type that the flashing tool reports when it connects. Run `idf.py set-target` with the matching name, rebuild, flash again.' },
    { symptom: 'Build errors about permissions on files in `build/`', cause: 'An earlier build was run with `sudo`, leaving root-owned files.', fix: 'Remove the build directory (`sudo rm -rf build` once), fix the real cause of whatever prompted sudo, and rebuild as your own user.' },
  ],
  challenge: [
    `Do these without step-by-step instructions. No solutions are given; your notebook entry is the evidence.

1. **A stable name.** Write a udev rule that gives your board the name \`/dev/bench_esp32\` whenever it is plugged in, and flash using that name. Verify it survives unplugging and replugging, and that it still works with a second USB serial device connected first.
2. **A reproducible build.** Build the same commit in Espressif's \`espressif/idf\` Docker image, pinned to the same ESP-IDF version as your host install, writing output to a separate build directory. Compare the size of the application binary from the two builds. Are the files byte-identical? If not, find one concrete reason (the build embeds some information about when and where it was built; ESP-IDF has a configuration option for reproducible builds).
3. **A logged boot.** Using the \`read_port.py\` script from lesson 5 in its own virtual environment, capture three complete boot cycles to a file with timestamps. From the log, measure the time from the first boot message to \`Hello world!\`. Without a board, run the script against a pseudo-terminal that you feed from a second script.
4. **A second chip.** If you have a board with a different ESP chip, build and flash the same project for it. List every difference you can observe: compiler, bootloader offset, device node type, boot log.`,
  ],
  quiz: [
    { kind: 'concept', q: `You installed everything, plugged in the board and ran \`idf.py -p /dev/ttyUSB0 flash\`. It failed. Why does the lab insist on verifying each link separately instead?`, choices: [
      { t: `Because the individual verification commands run faster than a full build and flash, which saves time overall.`, why: `Speed is not the point. Consider how many different causes a single end-to-end failure could have.` },
      { t: `A failure of the whole chain has many possible causes; a failure right after adding one verified link has one.`, ok: true, why: `Incremental verification keeps the list of suspects to one.` },
      { t: `Because flashing a board before its USB link has been verified can corrupt the bootloader.`, why: `Flashing an example does not harm a board. The benefit is in localising faults.` },
    ] },
    { kind: 'arch', q: `\`flasher_args.json\` for a build targeting the original ESP32 lists the bootloader at offset \`0x1000\`. You run \`idf.py set-target esp32c3\` and rebuild. What do you expect for the bootloader offset now, and why does it matter?`, choices: [
      { t: `Still 0x1000: the offset is set by ESP-IDF's partition layout, which is the same for every target.`, why: `The offset is where the chip's built-in ROM looks, and that ROM differs between chip families.` },
      { t: `0x0, because the ESP32-C3's boot ROM loads the second-stage bootloader from a different fixed offset.`, ok: true, why: `The ROM fixes the offset: 0x1000 on the original ESP32, 0x0 on ESP32-S3, C3 and C6.` },
      { t: `0x10000: RISC-V chips have no second-stage bootloader, so the application sits at the first image offset.`, why: `That is the default application offset. Every chip in the family has a second-stage bootloader; what differs is where its ROM expects to find it.` },
    ] },
    { kind: 'circuit', q: `Flashing fails with a "Failed to connect" error. Holding BOOT while starting the command makes it work. What does holding BOOT do electrically?`, choices: [
      { t: `It erases the old application, so the ROM finds nothing to run and waits for a new image.`, why: `The button is a plain switch to a pin. Erasing is done later by the flashing tool, once it is connected.` },
      { t: `It holds the boot-mode strapping pin low, so the ROM enters its serial bootloader at reset.`, ok: true, why: `The boot ROM samples that pin at reset: GPIO0 on the ESP32 and ESP32-S3, GPIO9 on the ESP32-C3 and C6.` },
      { t: `It slows the chip's clock, giving the flashing tool more time to synchronise with it.`, why: `The button is a plain switch from one pin to ground. It cannot change a clock; think about what the ROM reads from that pin at reset.` },
    ] },
    { kind: 'concept', q: `After flashing, the monitor shows \`Hello world!\`. How do you prove the board is running the build you just made and not an image flashed earlier?`, choices: [
      { t: `It printed the expected text straight after a flash that reported success, so it must be the new build.`, why: `The previous image printed the same text. An unchanged output cannot distinguish them.` },
      { t: `Change the printed message, rebuild, flash, and look for the new text in the monitor.`, ok: true, why: `Only something unique to the new build can show that it is what is running. The app version in the boot log, compared with \`git describe\`, is a second such marker.` },
      { t: `Check that the files in \`build/\` have a timestamp later than your last edit.`, why: `That shows a build happened on the laptop. It says nothing about what is in the chip's flash.` },
    ] },
    { kind: 'concept', q: `You completed the build and inspection steps and used the Workbench UART terminal, but have no board. How should you record the lab, and what remains unverified?`, choices: [
      { t: `As verified on hardware: the build succeeded and the simulated terminal showed the right output.`, why: `The build proves the host half. The cable, enumeration, permissions, bootloader entry and serial output have not been exercised at all.` },
      { t: `As completed without hardware; enumeration, permissions, flashing and real serial output are still unverified.`, ok: true, why: `The record should match the evidence. Half the chain is proven; the other half is modelled.` },
      { t: `It cannot be recorded at all until a board is available, because simulated work is not evidence.`, why: `Work done without a board is real and is recorded, with a label that says what kind of evidence it is.` },
    ] },
  ],
};
