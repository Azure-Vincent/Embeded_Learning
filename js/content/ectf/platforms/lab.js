// eCTF platforms track: laboratory "First day on an unfamiliar competition board".
// A documentation laboratory. Nothing in it was run on hardware; facts are from docs/FACTS.md (round 2) and the
// primary documents cited inline.
import { S, NOT_LOADED as N, src } from './src.js';

const lab = {
  id: 'ectf-plat-lab-first-day',
  title: 'First day on an unfamiliar competition board',
  kind: 'Laboratory',
  minutes: 180,
  summary: 'From primary documentation only, produce a cited platform brief for a board you have not used: memory map, boot flow, debug and flash procedure, toolchain setup, and security features with their documented limits.',
  skills: ['ectf-plat-first-day', 'ectf-plat-read-docs', 'ectf-plat-compare', 'ectf-plat-mspm0-map', 'ectf-plat-max78000-map'],
  requires: ['mcu-architecture', 'security'],
  objectives: [
    'Derive a chip’s flash and RAM bases and sizes from the vendor’s linker file or device header, and overlay the competition’s layout from a reference linker script.',
    'Describe the boot flow from reset to the first instruction of team firmware, marking which stage owns which memory and what is not yet known.',
    'Write a build, flash and debug procedure that names every tool and version, each traced to a file in the reference repository or SDK.',
    'List the hardware security features with, for each, its documented limits and whether you have confirmed it is permitted.',
    'Attach a primary-source citation to every statement, and keep an explicit list of what could not be verified.',
  ],
  hardware: [
    'None required. This is a documentation laboratory: you work from the reference repository, the vendor SDK and the datasheet / reference manual.',
    'Optional, if you own one: the target board (the examples use the TI MSPM0L2228 — the eCTF 2026 MSP-LITO-L2228 board or TI’s LP-MSPM0L2228 LaunchPad — and the Analog Devices MAX78000FTHR from eCTF 2024–2025). Steps that need a board are marked and can be skipped.',
  ],
  software: [
    'A web browser and git, to read the reference repository and vendor SDK on GitHub.',
    'A PDF reader for the datasheet (TI SLASF94) and technical reference manual (TI SLAU847).',
    'This course’s memory-map, boot-sequence, mcu-block-diagram and platform-compare widgets.',
    'Optional: Docker, to reproduce the reference build (eCTF 2025 and 2026 reference designs build in Docker).',
  ],
  background: [
    `Lesson 6 ended with a twelve-item checklist. This laboratory makes you run the document-only part of it and hand in the result as a **platform brief**: two or three pages that a teammate could use to start work without asking you anything.

The default target is the **MSPM0L2228 as used in eCTF 2026**, because it is the current platform and all four kinds of source — repository, vendor SDK, datasheet/TRM and rules — can be read for it. If you want a second pass, repeat it for the **MAX78000 as used in eCTF 2025** and compare the two briefs.

Rules of the laboratory:

1. **Every line has a citation.** A URL to a file in an official repository, or a document name with section number. "Lesson 4 says so" is not a citation; follow the lesson's source link and cite that.
2. **Unknown is a valid answer.** If the primary source does not say, write "not established" and name the document that should. A confident guess is the only wrong answer.
3. **Widgets are for exploring, documents are for citing.** The widgets show the same facts interactively and flag what is unverified. They are a simulation of a memory map, not the chip.`,
    { t: 'callout', kind: 'sim', title: 'Nothing here was run on real hardware', md: `Neither this course's authors nor this laboratory ran anything on a physical MSPM0L2228, MAX78000 or ESP32. The commands shown are transcribed from the reference repositories. If you have a board, the optional steps tell you what you *should* see and how to check; treat a mismatch as information about your setup or about this text, and trust the vendor's document.` },
    { t: 'callout', kind: 'note', title: 'This is a course exercise', md: `The brief format, the rubric and the questions are this course's. They are not an eCTF deliverable and not official MITRE material. In a real competition, the required documents are defined by [that year's rules](${S.rules}).` },
  ],
  diagram: [
    { t: 'ascii', text: `Where each part of the brief comes from

 ┌────────────────────────┐   MCU part number, CPU flags, SDK + compiler versions
 │ Reference repository   │──► Makefile / Dockerfile
 │ (ectfmitre, 2026)      │──► firmware.ld            competition memory layout
 │                        │──► inc/*.h                pins, interfaces, protocol, sizes
 │                        │──► README                 build commands, do-not-fork notice
 └────────────────────────┘
 ┌────────────────────────┐
 │ Vendor SDK on GitHub   │──► linker file / device header   chip memory map, peripherals
 │ (TI mspm0-sdk)         │──► boot_config.h, CSC guide      boot policy, secure-boot options
 │                        │──► tools docs                    probes, IDE, flashing tools
 └────────────────────────┘
 ┌────────────────────────┐
 │ Datasheet and TRM      │──► limits: frequency, voltage, flash endurance, ADC, tamper pins
 │ (ti.com)               │──► semantics: NONMAIN, write protection, BSL, key store
 └────────────────────────┘
 ┌────────────────────────┐
 │ Rules site (MITRE)     │──► board name, official flash procedure, bootloader, what is allowed
 └────────────────────────┘
                 │
                 ▼
        PLATFORM BRIEF  =  memory map · boot flow · build/flash/debug · security features · open questions`, caption: 'Four kinds of source, each authoritative for different lines of the brief.' },
    { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'mspm0l2228' }, caption: 'Orientation: the blocks you will be documenting.' },
  ],
  steps: [
    { title: 'Set up the brief and the evidence log',
      md: `Create a document with these headings: *Sources*, *Part and board*, *Memory map*, *Boot flow*, *Build*, *Flash and debug*, *Security features and limits*, *Constraints*, *Open questions*. Under *Sources*, record the URL and the branch or tag of each repository you use — for 2026 the reference repository's \`release\` branch${src('2026 repository', S.y2026)} and the SDK tag the Dockerfile pins.

Add a three-column evidence log at the end: *claim*, *source (URL or document + section)*, *status* (verified / inferred / not established). Every line you write in the brief gets a row.` },
    { title: 'Pin the part and the board',
      md: `Open the firmware Makefile and Dockerfile. Record the device define, the CPU and architecture flags, the float ABI, the SDK version and the compiler version${src('2026 firmware Makefile', S.y2026make, '2026 Dockerfile', S.y2026docker)}.

Then try to establish the **board name** from the repository alone. You should find that you cannot: the repository proves the MCU, not the board, and the obvious guess — TI's evaluation board for this part, the LP-MSPM0L2228 LaunchPad${src('SDK README', S.tiReadme)} — is wrong. Only now open the rules' board page${src('2026 board page', S.r26board)} and record: the board's name, whether it can be bought, what the rules say about the LaunchPad, where the debug probe is and how it is connected, and which document the linked user manual is actually for. Anything about the board that the page does not state (its schematic, for one) goes into *Open questions*.`,
      blocks: [
        { t: 'callout', kind: 'mistake', title: 'Filling the gap with the obvious answer', md: `"It's the LaunchPad, what else would it be?" is how a wrong board name gets into a brief and then into a purchase order or a pinout assumption. The brief's value is that a reader can tell verified lines from inferred ones.` },
      ] },
    { title: 'Chip-level memory map',
      md: `From the vendor's linker command file for the part${src('mspm0l2228.cmd', S.tiCmd)}, record flash origin and length, SRAM origin and length, and the NONMAIN configuration addresses. Convert each length to kilobytes and compute each region's last address.

Then open the memory-map table in the datasheet (SLASF94A, Table 8-4)${src('datasheet', S.tiDs)} and compare. The linker file gives one SRAM line; the table gives several. Record every address range at which the SRAM appears, what error checking each applies, and which one the linker file uses. Record the two flash banks too.

Check your work against the widget below using its address quiz. Then write one sentence in the brief about anything that differs from what you would have assumed — for this part, that the 32 KB of RAM is one memory with three views, and that the linker file alone would never have told you.`,
      blocks: [
        { t: 'widget', name: 'memory-map', props: { platform: 'mspm0l2228' }, caption: 'Explore, then cite the linker file — not the widget — in your brief.' },
      ] },
    { title: 'Competition layout on top of the chip',
      md: `Open the reference design's \`firmware.ld\`${src('2026 firmware.ld', S.y2026ld)}. Record every \`MEMORY\` region: name, origin, length, and any comment. Draw them stacked, as lesson 4 does.

Verify four things and record the working: (1) the regions are contiguous with no gaps or overlaps; (2) they sum to the chip's flash size; (3) the RAM region matches the vendor's SRAM origin and length; (4) the regions match the flash layout in the rules' detailed specifications${src('2026 detailed specifications', S.r26detail)}. Check (4) should turn up one difference. Write down which document wins and what the difference means for a large image. For each region, write who owns it — bootloader, team, specification-fixed — and the evidence.`,
      blocks: [
        { t: 'exercise', prompt: `From the 2026 reference linker script: BOOTLOADER origin 0x0 length 0x6000; FLASH origin 0x6000 length 0x34000; FAT origin 0x3A000 length 0x400; APP2 origin 0x3A400 length 0x5C00. How many kilobytes (1 KB = 1024 bytes) of flash can team code in the FLASH region occupy at most?`,
          hints: [`Only one of the four regions is the one your firmware is linked into.`, `0x34000 = 3 × 65536 + 4 × 4096.`, `Divide the byte count by 1024.`],
          solution: `\`0x34000\` = 196 608 + 16 384 = 212 992 bytes = **208 KB**. That is the region's size; the reference design also places file storage inside it starting at \`0x10000\`, so the space available to *code* is smaller. The linker script comments APP2 as a second "location of team firmware". Compare its length with the rules: they give APP2 \`0x5800\`, not \`0x5C00\`, and reserve the final \`0x400\` bytes at \`0x3FC00\` for the bootloader — so 22 KB of APP2 is yours, not 23.`,
          answer: { type: 'number', value: 208, tol: 0, unit: 'KB' } },
      ] },
    { title: 'Boot flow',
      md: `Write the boot sequence as numbered stages from reset to the first instruction of team firmware. For each stage: what code runs, where it lives, what it reads, what it decides, how it transfers control. Use the widget to explore, then go to the sources.

For the MSPM0L2228 you can establish from the SDK: that boot policy is held in NONMAIN and which options exist${src('boot_config.h', S.tiBootCfg)}; that the core has a relocatable vector table${src('mspm0l222x.h', S.tiHdr)}; and that TI offers an MCUboot-based Customer Secure Code stage for this family${src('CSC guide', S.tiCsc)}. From the reference linker script you can establish that the first \`0x6000\` bytes of flash belong to a bootloader.

From the TRM (SLAU847F, section 1.4)${src('TRM', S.tiTrm)} add what the ROM boot configuration routine does before any flash code — debug policy, write protection, the optional CRC check, whether the bootstrap loader starts — and how the bootstrap loader is invoked. From the rules' bootloader page${src('2026 bootloader page', S.r26boot)} add the MITRE bootloader's visible behaviour: its two modes, how update mode is entered and indicated, and how the design-phase and attack-phase builds differ.

You will **not** be able to establish what the secure bootloader verifies or how \`.prot\` images are protected: that is not published. It becomes a stage marked "not established", which is the honest state and an important one — it bounds what your firmware can assume about the stage before it.`,
      blocks: [
        { t: 'widget', name: 'boot-sequence', props: { platform: 'mspm0l2228' }, caption: 'Stages the widget marks as unverified should appear as "not established" in your brief too.' },
      ] },
    { title: 'Toolchain and build procedure',
      md: `Write the build as a numbered procedure a teammate can follow on a clean machine: prerequisites, commands, expected outputs. Take every command from the README or Makefiles${src('2026 README', S.y2026readme, 'root Makefile', S.y2026rootmake)}. For each tool record the pinned version and where it is pinned.

Then draw the secrets pipeline from lesson 6 for this build, and for each artefact (\`global.secrets\`, the generated header, \`hsm.elf\`, \`hsm.bin\`) write who can read it.

*Optional, needs Docker but no board:* run the reference build unchanged. You should see the build end with \`hsm.elf\` and \`hsm.bin\` in your output directory. If you do, record the image's size and compare it with the team region; if not, record the exact error — that is a finding for the brief, not a failure of the lab.`,
      code: `make docker
uvx --with-editable ./ectf26_design --from ectf26_design secrets global.secrets <groups>
docker run --rm -v ./firmware:/hsm -v ./global.secrets:/secrets/global.secrets:ro -v ./build:/out -e HSM_PIN='1a2b3c' -e PERMISSIONS='1234=R--:4321=RWC' build-hsm`,
      lang: 'bash', status: 'reviewed' },
    { title: 'Flash and debug procedure',
      md: `Write two procedures and keep them separate.

**Official flashing path.** From the rules' bootloader and boot-reference pages${src('2026 bootloader page', S.r26boot, '2026 boot reference', S.r26bootref)}, answer three questions with the exact tool, setting and command for each: how the bootloader is installed (which tool, which device and connection, which erase setting and why it matters), how update mode is entered and what you should see, and which host commands erase, transfer and start an image.

**Debug path.** From the rules' OpenOCD page${src('2026 OpenOCD page', S.r26openocd)}, record the interface and target files, the OpenOCD version requirement, and the GDB port. From the SDK's tools documentation, record the vendor alternatives${src('debug_program.rst', S.tiDebug, 'SDK tools docs', S.tiTools)}. State the conditions under which this path applies: a design-phase board with the external probe wired correctly. Note explicitly that the rules document OpenOCD for debugging, not for flashing, and why writing flash outside the bootloader is risky on this part.

For contrast, summarise in three lines how the same two paths looked on the MAX78000 in eCTF 2025: MITRE bootloader over serial with \`python -m ectf25.utils.flash\`; on-board MAX32625PICO DAPLink adapter for debug${src('2025 README', S.y2025readme, 'Feather README', S.maxFthr)}.` },
    { title: 'Security features with documented limitations',
      md: `Make a table with columns: *feature*, *what the source says it does*, *documented limit or caveat*, *permitted by rules?*, *source*. Fill it from the datasheet's security sections, TRM section 1.4, the device header, the SDK examples, \`boot_config.h\` and the CSC guide${src('datasheet', S.tiDs, 'TRM', S.tiTrm, 'mspm0l222x.h', S.tiHdr, 'SDK examples', S.tiExamples, 'boot_config.h', S.tiBootCfg, 'CSC guide', S.tiCsc)}.

Minimum rows for this part: AES accelerator; TRNG; keystore; CRC; MPU; SWD security levels; mass-erase and factory-reset policy; bootstrap loader; static write protection; Customer Secure Code; tamper I/O; the ECC- and parity-checked SRAM views; flash ECC.

The *limit* column is the point of the exercise. Examples of what belongs there: TI's own statement that CSC "does not guarantee a full secure boot implementation on a device"; that a NONMAIN mistake can remove your own debug access; that static write protection is overridden by an SWD mass erase or factory reset unless those are password-protected or disabled; that AESADV has no 192-bit key size; that the keystore is meant to be loaded before the application runs; that a checked SRAM view faults on memory not initialised through it. Where you have no documented limit, write "limit not yet read — TRM section …", never "none".

Fill the *permitted* column from the 2026 rules. For any feature that has to be configured before \`INITDONE\`, record that on attack boards the MITRE secure bootloader acts as the CSC and issues INITDONE itself${src('2026 bootloader page', S.r26boot)}, and what that leaves for your firmware to decide. "Not established" is still an acceptable entry; a guess is not.`,
      blocks: [
        { t: 'widget', name: 'platform-compare', props: {}, caption: 'Use the security-features and attack-surface axes to see how the same table would look for the other two platforms.' },
      ] },
    { title: 'Constraints and open questions',
      md: `Finish the brief with two lists.

**Constraints** that will shape the design, each with its number and source: RAM size; stack size setting in the reference linker script; team flash region size; flash page size used by the reference design; file count and maximum sizes; number of interrupt priority levels; absence of FPU and hardware divide; serial speed and number of interfaces.

**Open questions**, each with the document or person that can close it. You should have at least eight. Order them by how much design work each one blocks.` },
  ],
  walkthrough: [
    `What each part of the brief tells you about the machine, and why it is in this order.

- **Part before board, board before map.** The MCU define selects the device header and linker file; everything else is read from those. Getting the part wrong makes every later line wrong; getting the board wrong makes the pin and probe lines wrong.
- **Chip map before competition map.** The vendor file says where memory physically exists. The reference script says how this year's system divides it. Reading them in that order is how you notice that a region is reserved (it exists on the chip but you may not use it) rather than absent.
- **Boot flow next, because it decides who is trusted.** On a Cortex-M0+ the processor takes its first stack pointer and program counter from the vector table at address 0 after reset. In the 2026 layout address 0 is inside the bootloader region, so the first code to run is not yours; your vector table at \`0x6000\` is only used once something has pointed the core at it. Whatever that earlier stage checks or fails to check bounds what your firmware can guarantee.
- **Build before flash.** The build determines what is in the image, including secrets. The flash path determines who else can put an image on the device. They are different attack surfaces and belong in different sections.
- **Security features last, with limits.** Only once you know the map, the boot chain and the rules can you say what a feature is protecting and from whom. A feature list without limits reads like a brochure and designs like one.`,
    { t: 'callout', kind: 'why', title: 'Why citations and not just answers', md: `A brief is used weeks later, by someone else, when the board does something unexpected. At that moment the only useful line is one that can be checked. A citation also records *which revision* of a document or tag of an SDK the line was true for — and the 2024-to-2025 MSDK change shows those move.` },
  ],
  testing: [
    `You cannot test a document on a bench, but you can test it.

1. **Arithmetic checks.** Region sizes sum to the chip's flash size; each region's end equals the next one's start; the RAM region equals the vendor's. For the linker script you should see \`0x6000 + 0x34000 + 0x400 + 0x5C00 = 0x40000\`; for the rules' layout, \`0x6000 + 0x34000 + 0x400 + 0x5800 + 0x400 = 0x40000\`.
2. **Cross-source checks.** At least three facts in the brief should be confirmed by two independent files — for example the SRAM origin in both the vendor linker file and the reference linker script; the MCU in both the Makefile define and the driverlib it links.
3. **Cold-read test.** Give the brief to someone who has not seen the platform. Ask them five questions: Where is RAM? What runs first after reset? What compiler and version? How do I get an image onto the board? What do we not know yet? They should be able to answer each from the brief in under a minute, including "we don't know — it says to read X".
4. **Citation audit.** Pick five lines at random and follow their citations. Each should lead to a page that says what the line says.
5. **Widget cross-check.** Compare your memory map and boot stages with the widgets. Any disagreement is resolved by the primary source, and is worth noting in the brief either way.

*If you own the board (optional):* after following the official flashing procedure from the rules with the unmodified reference image, you should see the LED behaviour the rules describe (D1 flashing red in update mode on the MSP-LITO-L2228) and the host-tool responses they list. Record what you observe next to what the documents predicted. Do not write that step up as done unless you did it.`,
  ],
  troubleshooting: [
    { symptom: 'You cannot find the flash or RAM addresses in the reference repository', cause: 'You are looking in source files; memory regions are defined in the linker script, and the chip-level values in the vendor SDK.', fix: 'Open `firmware/firmware.ld` in the reference repository for the competition layout, and the vendor’s linker file for the part (for the MSPM0L2228, `mspm0l2228.cmd` under the SDK’s `linker_files/ticlang`) for the chip-level map.' },
    { symptom: 'The two linker files give different flash regions for the same chip', cause: 'They answer different questions: the vendor file describes the whole device; the reference file carves out bootloader and specification-fixed regions.', fix: 'Record both. Check that the reference regions fit inside the vendor’s flash range and sum to its size. The difference is the competition layout, which is what you wanted to find.' },
    { symptom: 'A vendor documentation link from this course does not load', cause: 'Vendor sites reorganise, and a few URLs in this course (Analog Devices’ product pages, some rendered guides) could not be opened when the fact sheet was checked.', fix: 'Search the vendor’s site for the document by part number and title (datasheet, technical reference manual, user guide). Cite the document number and revision you actually opened.' },
    { symptom: 'You cannot determine the board name or debugger from the repository', cause: 'The reference repository establishes the MCU only; board details are in the rules’ getting-started pages and the board’s user guide.', fix: 'Read the rules’ board page and cite it. Do not infer the board from the MCU: one MCU can be on several boards with different probes, buttons and LEDs — the 2026 competition board and TI’s LaunchPad are an example.' },
    { symptom: 'The reference Docker build fails while downloading the SDK or compiler', cause: 'The Dockerfile fetches a pinned SDK tag and compiler release from the network; a proxy, an offline machine or a moved download will break it.', fix: 'Read the failing line of the Dockerfile to see which download failed, check network access to that host, and record the failure in the brief. Do not substitute a different SDK or compiler version without recording it as a deviation.' },
    { symptom: 'Your security-features table has no limits column entries', cause: 'Feature lists come from headers and example names, which state what exists, not what it guarantees.', fix: 'For each feature open the TRM chapter or SDK guide that describes it and look specifically for conditions, exclusions and warnings. If you have not read it yet, write that, with the chapter name.' },
  ],
  challenge: [
    `**Do it again, colder.** Take a platform this track has not covered — the TI TM4C123GH6PM from eCTF 2023${src('2023 repository', S.y2023)} is suitable, or any development board you own — and produce the same brief in ninety minutes using only its reference repository (if any), vendor SDK, datasheet and reference manual. No solution is provided.

Then write half a page comparing your new brief with the MSPM0L2228 one: which sections were faster the second time, which facts you had to look up again from scratch, and which three questions you would now ask about *any* board in the first ten minutes. Bring that list to the practice scenarios later in this track.`,
  ],
  quiz: [
    { kind: 'arch', q: `Your brief says "SRAM: 32 KB, linked at 0x20200000 (unchecked view)". A teammate’s startup code sets the initial stack pointer to 0x20208000 and they ask whether that is inside RAM. What do you tell them?`,
      choices: [
        { t: 'It is one past the last RAM byte, which is correct for a stack', ok: true, why: 'Origin plus length is 0x20208000. A full-descending stack starts there and its first push decrements before storing, so the write lands just below it, inside RAM.' },
        { t: 'It is outside RAM, so the very first push will raise a fault', why: 'The first push decrements the pointer before writing, so the write lands below this address, not at it.' },
        { t: 'It is wrong; the stack pointer must start at the RAM origin', why: 'A stack that grows downward from the origin would leave RAM on its first push.' },
        { t: 'It cannot be judged without knowing which SRAM view is checked', why: 'Origin and length of the view the image is linked against are sufficient to compute the top of that view.' },
      ] },
    { kind: 'concept', q: `While writing the "Flash and debug" section for eCTF 2026 you find that the rules give an OpenOCD command for the MSPM0L2228. What may the brief state?`,
      choices: [
        { t: 'OpenOCD is the documented debug path; flashing goes through the eCTF bootloader', ok: true, why: 'The rules page describes OpenOCD for debugging with the XDS110, and a separate page describes UniFlash for the bootloader and `uvx ectf hw … flash` for team images. Two procedures, two sections.' },
        { t: 'Teams flash their images with OpenOCD, since a tool that can debug a chip can also program it', why: 'That turns the capability of a tool into a statement about the competition’s procedure. The rules document a different flashing path, and warn about erasing the wrong sector.' },
        { t: 'Nothing about OpenOCD, because only the official flashing path belongs in a brief', why: 'A documented debug path with its conditions stated is exactly what a teammate needs; omitting it loses information.' },
        { t: 'The board has an XDS110 on it, because the OpenOCD command selects the xds110 interface', why: 'The interface file names the probe type, not where it sits. On the 2026 board the probe is external, on jumper wires.' },
      ] },
    { kind: 'security', q: `In the security-features table, which entry for "debug access can be restricted via NONMAIN" is the most useful?`,
      choices: [
        { t: 'Does: three SWD levels, from open to disabled. Limit: a wrong write can lock out the owner; SWD mass erase overrides write protection unless restricted. Permitted: to confirm in the rules. Source: TRM 1.4.2', ok: true, why: 'It separates capability, risk and permission, cites the section, and marks which part is still to be confirmed, so a reader knows what to rely on.' },
        { t: 'Does: makes the device secure against physical attackers once the debug port has been turned off. Limit: none known. Permitted: yes, since disabling debug is always good practice. Source: general knowledge', why: 'Disabling one port does not address other physical attacks, "none" claims knowledge nobody has gathered, and permission is asserted rather than checked.' },
        { t: 'Does: disables SWD. Recommended: enable immediately on every board', why: 'A recommendation without knowing reversibility or the rules can cost the team its board or its eligibility.' },
        { t: 'Not applicable to competitions, where the organisers control debug', why: 'Whether it applies is exactly what the rules decide; dismissing it leaves a feature unexamined.' },
      ] },
    { kind: 'concept', q: `A cold reader of your brief cannot tell which statements you verified and which you inferred. What is the consequence?`,
      choices: [
        { t: 'Every statement has to be treated as unverified and checked again', ok: true, why: 'The value of a brief is that verified lines can be relied on without re-checking. Mixing in unmarked inferences removes that property from all of them, so the brief saves nobody any work.' },
        { t: 'None, as long as most of the statements turn out to be right', why: 'The reader cannot know which ones are right, so being mostly right does not help them.' },
        { t: 'Only the security-features section is affected by the ambiguity', why: 'A wrong memory address or tool version is as costly as a wrong security claim; the problem is general.' },
        { t: 'The brief becomes shorter, and a shorter brief is easier to use', why: 'Brevity gained by dropping the evidence status removes the information the reader most needs.' },
      ] },
    { kind: 'arch', q: `You repeat the lab for the MAX78000 as used in eCTF 2025. Which line of the MSPM0L2228 brief can be copied across unchanged?`,
      choices: [
        { t: 'None of the factual lines; only the headings and the method', ok: true, why: 'Memory map, boot owner, compiler, SDK, probe and security blocks all differ between the two parts. The structure of the brief is what is reusable.' },
        { t: 'The SRAM line, since both are Cortex-M parts with RAM at 0x20000000', why: 'One part has 128 KB at a single address; the other has 32 KB visible through three views. The core type fixes neither.' },
        { t: 'The compiler line, since both builds target Arm cores', why: 'The 2025 reference build uses the GNU Arm toolchain and the 2026 one uses TI Arm Clang.' },
        { t: 'The flash erase-unit line, since both use internal flash', why: 'The MAX78000 header gives 8 KB pages; the MSPM0L2228 has 1 KB sectors.' },
      ] },
  ],
  rubric: [
    { criterion: 'Memory map', points: 20, evidence: 'Chip-level flash and RAM bases and sizes from the vendor file; competition regions from the reference linker script; arithmetic shown; ownership of each region stated with evidence.' },
    { criterion: 'Boot flow', points: 15, evidence: 'Numbered stages from reset to team firmware; each stage has location, owner and hand-off; unknown stages marked with the document that describes them.' },
    { criterion: 'Build, flash and debug procedure', points: 20, evidence: 'Commands transcribed from the repository; tool and SDK versions with where they are pinned; official flash path and debug path kept separate; conditions stated.' },
    { criterion: 'Security features and limits', points: 20, evidence: 'Table with a documented limit or "not yet read — chapter …" for every feature, and a permitted-by-rules column that is honest.' },
    { criterion: 'Citations', points: 15, evidence: 'Every statement traceable to a primary source; a random audit of five lines succeeds.' },
    { criterion: 'Open questions', points: 10, evidence: 'At least eight, each with the document or person that can close it, ordered by how much design work they block.' },
  ],
};

export default [lab];
