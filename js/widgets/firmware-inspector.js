// Firmware image inspector: hex view, vector table, strings, entropy and ELF structure of synthetic images.
// The images are built by tools/fwimages/build.sh from C sources in this repository (see js/sim/fwimages.js).
import { h, s, clear } from '../core/dom.js';
import { INSPECTOR_IMAGES, b64ToBytes, TOOLCHAIN } from '../sim/fwimages.js';

/* ------------------------------------------------------------------ pure logic */

export const hex32 = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
export const hexN = (n, w = 2) => (n >>> 0).toString(16).padStart(w, '0');
export const rd32 = (u8, off) => (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0;
const rd16 = (u8, off) => u8[off] | (u8[off + 1] << 8);

/** Accepts 0x1f8, 0x0800_0000, 08000000h is NOT accepted, plain decimal. Returns NaN when it is not a number. */
export function parseNum(text) {
  const t = String(text).trim().replace(/_/g, '');
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return NaN;
}

const SECTION_TYPES = { 0: 'NULL', 1: 'PROGBITS', 2: 'SYMTAB', 3: 'STRTAB', 8: 'NOBITS' };
const SYM_TYPES = ['NOTYPE', 'OBJECT', 'FUNC', 'SECTION', 'FILE'];
const cstr = (u8, off) => { let e = off; while (e < u8.length && u8[e]) e++; return String.fromCharCode(...u8.subarray(off, e)); };

/** Minimal ELF32 little-endian parser: header, section headers, program headers, .symtab. */
export function parseElf(u8) {
  if (u8.length < 52 || u8[0] !== 0x7f || u8[1] !== 0x45 || u8[2] !== 0x4c || u8[3] !== 0x46) throw new Error('not an ELF file (magic 7f 45 4c 46 missing)');
  if (u8[4] !== 1 || u8[5] !== 1) throw new Error('only 32-bit little-endian ELF is supported');
  const header = {
    class: 'ELF32', data: 'little endian', type: rd16(u8, 16), machine: rd16(u8, 18), entry: rd32(u8, 24),
    phoff: rd32(u8, 28), shoff: rd32(u8, 32), flags: rd32(u8, 36), ehsize: rd16(u8, 40),
    phentsize: rd16(u8, 42), phnum: rd16(u8, 44), shentsize: rd16(u8, 46), shnum: rd16(u8, 48), shstrndx: rd16(u8, 50),
  };
  const segments = [];
  for (let i = 0; i < header.phnum; i++) {
    const o = header.phoff + i * header.phentsize;
    segments.push({ type: rd32(u8, o), offset: rd32(u8, o + 4), vaddr: rd32(u8, o + 8), paddr: rd32(u8, o + 12),
      filesz: rd32(u8, o + 16), memsz: rd32(u8, o + 20), flags: rd32(u8, o + 24), align: rd32(u8, o + 28) });
  }
  const sections = [];
  for (let i = 0; i < header.shnum; i++) {
    const o = header.shoff + i * header.shentsize;
    sections.push({ index: i, nameOff: rd32(u8, o), type: rd32(u8, o + 4), flags: rd32(u8, o + 8), addr: rd32(u8, o + 12),
      offset: rd32(u8, o + 16), size: rd32(u8, o + 20), link: rd32(u8, o + 24), info: rd32(u8, o + 28), entsize: rd32(u8, o + 36) });
  }
  const shstr = sections[header.shstrndx];
  for (const sec of sections) {
    sec.name = shstr ? cstr(u8, shstr.offset + sec.nameOff) : '';
    sec.typeName = SECTION_TYPES[sec.type] || '0x' + sec.type.toString(16);
    // Load address (LMA): the physical address of the PT_LOAD segment that carries this section.
    sec.lma = sec.addr;
    if (sec.flags & 2) {
      const seg = segments.find((p) => p.type === 1 && sec.addr >= p.vaddr && sec.addr + sec.size <= p.vaddr + p.memsz &&
        (sec.type === 8 || (sec.offset >= p.offset && sec.offset + sec.size <= p.offset + p.filesz)));
      if (seg) sec.lma = (seg.paddr + (sec.addr - seg.vaddr)) >>> 0;
    }
  }
  const symbols = [];
  const symtab = sections.find((x) => x.type === 2);
  if (symtab) {
    const str = sections[symtab.link];
    for (let o = symtab.offset; o + 16 <= symtab.offset + symtab.size; o += 16) {
      const info = u8[o + 12];
      symbols.push({ name: cstr(u8, str.offset + rd32(u8, o)), value: rd32(u8, o + 4), size: rd32(u8, o + 8),
        type: info & 15, bind: info >> 4, shndx: rd16(u8, o + 14), typeName: SYM_TYPES[info & 15] || String(info & 15) });
    }
  }
  return { header, sections, segments, symbols };
}

/** Shannon entropy in bits per byte of a byte array (0 for a constant block, 8 for a uniform one). */
export function shannon(u8) {
  if (!u8.length) return 0;
  const count = new Uint32Array(256);
  for (const b of u8) count[b]++;
  let e = 0;
  for (const c of count) if (c) { const p = c / u8.length; e -= p * Math.log2(p); }
  return e;
}

/** Entropy of consecutive blocks. A block of N bytes cannot exceed log2(N) bits, hence `max`. */
export function blockEntropy(u8, block) {
  const out = [];
  for (let off = 0; off < u8.length; off += block) {
    const part = u8.subarray(off, Math.min(off + block, u8.length));
    out.push({ off, len: part.length, bits: shannon(part), max: Math.min(8, Math.log2(part.length || 1)) });
  }
  return out;
}

/** Like `strings -n minLen -t x`: runs of printable ASCII (0x20-0x7e and tab). */
export function extractStrings(u8, minLen = 4) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= u8.length; i++) {
    const b = i < u8.length ? u8[i] : 0;
    const printable = (b >= 0x20 && b <= 0x7e) || b === 9;
    if (printable) { if (start < 0) start = i; } else {
      if (start >= 0 && i - start >= minLen) out.push({ off: start, text: String.fromCharCode(...u8.subarray(start, i)) });
      start = -1;
    }
  }
  return out;
}

export const VECTOR_NAMES = ['Initial SP', 'Reset', 'NMI', 'HardFault', 'MemManage', 'BusFault', 'UsageFault', 'reserved', 'reserved',
  'reserved', 'reserved', 'SVCall', 'DebugMonitor', 'reserved', 'PendSV', 'SysTick'];

/** Decode the first 16 words of a Cortex-M image as a vector table. */
export function decodeVectors(u8, loadAddr = 0) {
  const out = [];
  for (let i = 0; i < 16 && i * 4 + 4 <= u8.length; i++) {
    const value = rd32(u8, i * 4);
    const v = { index: i, name: VECTOR_NAMES[i], value };
    if (i > 0 && value !== 0) {
      v.thumb = (value & 1) === 1;
      v.target = (value & ~1) >>> 0;
      v.inImage = v.target >= loadAddr && v.target < loadAddr + u8.length;
    }
    out.push(v);
  }
  return out;
}

/** Find a byte pattern. `needle` is text, or space-separated hex bytes such as "98 2f 8a 42". */
export function searchBytes(u8, needle) {
  const t = needle.trim();
  if (!t) return { hits: [], length: 0 };
  const pat = /^(0x)?[0-9a-f]{2}(\s+[0-9a-f]{2})+$/i.test(t)
    ? t.replace(/^0x/i, '').split(/\s+/).map((x) => parseInt(x, 16))
    : [...t].map((c) => c.charCodeAt(0) & 0xff);
  const hits = [];
  outer: for (let i = 0; i + pat.length <= u8.length; i++) {
    for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer;
    hits.push(i);
  }
  return { hits, length: pat.length };
}

function findText(u8, text) {
  outer: for (let i = 0; i + text.length <= u8.length; i++) {
    for (let j = 0; j < text.length; j++) if (u8[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** Facts the tasks are checked against, derived from the image bytes and the ELF it was built from. */
export function imageFacts(name) {
  const img = INSPECTOR_IMAGES[name];
  const bytes = b64ToBytes(img.bin);
  const t = img.truth;
  const base = t.sections[0].addr;
  const sec = (n) => t.sections.find((x) => x.name === n);
  const sym = (n) => t.symbols.find((x) => x.name === n);
  const f = { name, bytes, base, sp: rd32(bytes, 0), reset: rd32(bytes, 4), sec, sym };
  if (name === 'demo') {
    const d = sec('.data');
    f.varVma = sym('blink_period_ms').addr;
    f.varLma = (d.lma + (f.varVma - d.addr)) >>> 0;
    f.varOff = f.varLma - base;
    f.bssSize = sec('.bss').size;
  }
  if (name === 'lockbox') {
    f.credential = 'svc:KESTREL-7741-open';
    f.credOff = findText(bytes, f.credential);
  }
  if (name === 'updater') {
    f.version = '2.4.1';
    f.pkeyOff = findText(bytes, 'PKEY');
    f.keyOff = f.pkeyOff + 8;
    f.payloadOff = sec('.payload').addr - base;
    f.kOff = searchBytes(bytes, '98 2f 8a 42').hits[0];
  }
  return f;
}

const R = (ok, msg) => ({ ok, msg });
const needNum = 'Type a number: hex with a 0x prefix (0x0800) or decimal.';

/** Tasks for an image. check(text) returns { ok, msg } with feedback specific to common wrong answers. */
export function tasksFor(name) {
  const f = imageFacts(name);
  const file = name + '.bin';
  const loadTask = (extra) => ({
    id: 'base', view: 'vectors',
    q: `At which address must ${file} be loaded so that its own pointers make sense? Work it out from the reset vector.`,
    hints: ['Word 1 of a Cortex-M image is the address of the reset handler, with bit 0 set to mark Thumb code.',
      'The handler sits inside the image, usually a few hundred bytes after the vector table, and images are linked at the start of a flash region. Which round address just below the vector fits?',
      'In the Vectors view, type your guess into "Load address": every non-zero vector should then land inside the image.'],
    commands: [`xxd -g4 -e -l 64 ${file}      # the 16 vector words, little-endian`,
      `arm-none-eabi-objdump -D -b binary -marm -Mforce-thumb --adjust-vma=<base> ${file}`,
      'Ghidra: File > Import, format "Raw Binary", language ARM:LE:32:Cortex, Options > Base Address = <base>'],
    check(text) {
      const v = parseNum(text);
      if (isNaN(v)) return R(false, needNum);
      if (v === f.base) return R(true, `Yes: ${hex32(f.base)}. The reset vector ${hex32(f.reset)} minus the Thumb bit is ${hex32(f.reset & ~1)}, which is offset 0x${hexN((f.reset & ~1) - f.base, 1)} in the file. ${extra}`);
      if (v === f.reset || v === (f.reset & ~1) >>> 0) return R(false, 'That is the reset vector itself: the address of the first instruction to run, not the address of the first byte of the file. The vector table comes first.');
      if (v === f.sp) return R(false, 'That is word 0, the initial stack pointer. It points into RAM; the image lives in flash.');
      if (v === 0) return R(false, `With base 0 the reset vector ${hex32(f.reset)} would point far outside a ${f.bytes.length}-byte image. A disassembler would start at the right offset only by luck and every literal-pool pointer would resolve to nothing.`);
      const tgt = (f.reset & ~1) >>> 0;
      if (tgt < v || tgt >= v + f.bytes.length) return R(false, `With that base the reset handler at ${hex32(tgt)} is not inside the image (${hex32(v)} to ${hex32(v + f.bytes.length - 1)}). Ghidra would show the vectors pointing at unmapped memory.`);
      return R(false, 'The reset handler would fall inside the image, but the other vectors and data pointers would be shifted. Bases are almost always a round flash-region boundary.');
    },
    solution: `${hex32(f.base)}`,
  });

  if (name === 'demo') {
    return [
      { id: 'sp', view: 'vectors', q: 'What value does the core load into the stack pointer at reset?',
        hints: ['A Cortex-M core reads two words from the start of the vector table before it runs any code.', 'Word 0 is the initial main stack pointer. Mind the byte order: the file is little-endian.'],
        commands: ['xxd -l 16 demo.bin', 'xxd -g4 -e -l 16 demo.bin      # -e prints little-endian words'],
        check(text) {
          const v = parseNum(text);
          if (isNaN(v)) return R(false, needNum);
          if (v === f.sp) return R(true, `Yes. ${hex32(f.sp)} is one past the end of the 64 KiB SRAM at 0x20000000: the stack is full-descending, so the first push stores below it.`);
          if (v === f.reset) return R(false, 'That is word 1, the reset vector. The stack pointer is word 0.');
          const swapped = ((f.sp & 0xff) << 24 | (f.sp >> 8 & 0xff) << 16 | (f.sp >> 16 & 0xff) << 8 | f.sp >>> 24) >>> 0;
          if (v === swapped) return R(false, 'You read the four bytes in file order. Cortex-M is little-endian: the last byte in the file is the most significant.');
          return R(false, 'Not that. Read the first four bytes of the file as one little-endian 32-bit word.');
        }, solution: hex32(f.sp) },
      loadTask('Use it as the base address in a disassembler.'),
      { id: 'lma', view: 'elf',
        q: `The symbol table says blink_period_ms is at ${hex32(f.varVma)}, in RAM. RAM is empty at power-up, so its initial value (250) must be stored in flash. At which flash address?`,
        hints: ['A section has two addresses: where it is used at run time (VMA) and where its bytes are stored (LMA). For .data they differ.',
          'The program header that carries .data lists both: VirtAddr and PhysAddr.',
          'LMA of the variable = PhysAddr of the segment + (variable address − VirtAddr of the segment).'],
        commands: ['arm-none-eabi-readelf -S demo.elf       # sections: run-time addresses', 'arm-none-eabi-readelf -l demo.elf       # program headers: PhysAddr is the load address',
          'arm-none-eabi-objdump -h demo.elf       # shows VMA and LMA side by side', 'arm-none-eabi-nm -n demo.elf'],
        check(text) {
          const v = parseNum(text);
          if (isNaN(v)) return R(false, needNum);
          if (v === f.varLma) return R(true, `Yes: ${hex32(f.varLma)}. Reset_Handler copies .data from there to ${hex32(f.varVma)} before main runs. A constant you can read in flash is also a constant an attacker with a flash dump can read or change.`);
          if (v === f.varVma) return R(false, 'That is the run-time address (VMA). Nothing is there until the startup code has copied the initial values out of flash.');
          if (v === f.varOff) return R(false, 'That is the offset in the .bin file. The question asks for the flash address: add the load address.');
          return R(false, 'Not that. Find the LOAD program header whose VirtAddr is the start of .data and read its PhysAddr.');
        }, solution: hex32(f.varLma) },
      { id: 'off', view: 'hex', q: 'At which offset in demo.bin is that initial value? Check it in the hex view: 250 is fa 00 00 00.',
        hints: ['File offset = flash address − load address of the image.'],
        commands: ['xxd -s <offset> -l 4 demo.bin'],
        check(text) {
          const v = parseNum(text);
          if (isNaN(v)) return R(false, needNum);
          if (v === f.varOff) return R(true, `Yes: offset 0x${hexN(f.varOff, 1)}. objcopy -O binary writes sections at their load addresses, so .data's initial values follow .rodata in the file.`);
          if (v === f.varLma) return R(false, 'That is the flash address. A file offset counts from the first byte of the file: subtract the load address.');
          return R(false, 'Not that. Subtract the image load address from the flash address you found.');
        }, solution: '0x' + hexN(f.varOff, 1) },
      { id: 'bss', view: 'elf', q: `.bss is 0x${hexN(f.bssSize, 1)} bytes long in the section table. How many bytes of demo.bin does it occupy?`,
        hints: ['Look at the section type. PROGBITS means "bytes in the file"; what does NOBITS mean?'],
        commands: ['arm-none-eabi-readelf -S demo.elf', 'arm-none-eabi-size -A demo.elf'],
        check(text) {
          const v = parseNum(text);
          if (isNaN(v)) return R(false, needNum);
          if (v === 0) return R(true, 'Yes, none. .bss is NOBITS: all zeros, so the file stores only its address and size and the startup code clears that RAM. It costs RAM, not flash.');
          if (v === f.bssSize) return R(false, 'That is how much RAM it takes. Storing that many zero bytes in flash would be waste: the section header records the size and the startup loop writes the zeros.');
          return R(false, 'Not that. Compare the Type column of .bss with .data.');
        }, solution: '0' },
    ];
  }
  if (name === 'lockbox') {
    return [
      loadTask('The image does not start at the beginning of flash: something else, typically a bootloader, owns the first 16 KiB.'),
      { id: 'cred', view: 'strings', q: 'This lock has a maintenance back door: a credential compiled into the firmware. What is it?',
        hints: ['Text the firmware prints or compares against is stored as plain bytes.', 'Open the Strings view. Most entries are messages; one is not something a device would print.'],
        commands: ['strings -n 6 lockbox.bin', 'strings -n 6 -t x lockbox.bin      # -t x adds the file offset of each string'],
        check(text) {
          const t = text.trim();
          if (t === f.credential || t === f.credential.replace(/^svc:/, '')) return R(true, `Yes: "${f.credential}". One command on a flash dump recovers it, and it is the same on every unit sold. What to take from this as a defender: no shared secrets in firmware; per-device secrets kept in protected storage; compare a salted hash or, better, verify a signature so the device holds nothing worth stealing; and enable read-out protection so the dump is harder to get. Then verify: run strings on your own release image.`);
          if (/^0+$/.test(t)) return R(false, 'That is the factory default user code, which the owner is expected to change. Look for the one that cannot be changed.');
          if (/GRANTED|DENIED|Enter|maintenance/i.test(t)) return R(false, 'That is a message the firmware prints. Look for a string that reads like something a person types.');
          return R(false, 'Not that. Use the Strings view and read every entry of six characters or more.');
        }, solution: f.credential },
      { id: 'credaddr', view: 'strings', q: 'At which memory address does that string live when the image is in flash? (You need the load address.)',
        hints: ['Address = load address + file offset. The Strings view shows the offset.'],
        commands: ['strings -t x lockbox.bin | grep svc', 'Ghidra: Search > For Strings, then follow the cross-reference (XREF) to the compare function'],
        check(text) {
          const v = parseNum(text);
          if (isNaN(v)) return R(false, needNum);
          if (v === f.base + f.credOff) return R(true, `Yes: ${hex32(f.base + f.credOff)}. In a disassembler the code that loads this address from its literal pool is the comparison you would study next.`);
          if (v === f.credOff) return R(false, 'That is the file offset. Add the load address of the image.');
          if (v === f.credOff + 0x08000000) return R(false, 'You added 0x08000000, but this image is not loaded at the start of flash. Use the base you found from the reset vector.');
          return R(false, 'Not that. Take the offset of the string from the Strings view and add the load address.');
        }, solution: hex32(f.base + f.credOff) },
    ];
  }
  return [
    { id: 'ver', view: 'strings', q: 'Which version of the updater is this? (Known-vulnerable versions are found this way.)',
      hints: ['Version banners are printed at boot, so they are stored as text.'],
      commands: ['strings -n 8 updater.bin | head'],
      check(text) {
        const t = text.trim();
        if (t.includes(f.version)) return R(true, 'Yes, v2.4.1. An attacker matches this against public advisories; a defender should assume the version is always discoverable.');
        if (/2026/.test(t)) return R(false, 'That is the build date. The version number is in the banner string just before it.');
        return R(false, 'Not that. Look near the start of the Strings view for a banner.');
      }, solution: 'v2.4.1' },
    { id: 'key', view: 'hex', q: 'The updater checks signatures against an embedded P-256 public key. An uncompressed point is 65 bytes starting with 0x04. Give the file offset (or address) of that 0x04 byte.',
      hints: ['Lower the minimum string length to 4: key stores often carry a short ASCII tag.', 'The tag is followed by a small header (algorithm, length, padding), then the key material.',
        'Click the tag in the Strings view and read the hex view: the length byte 0x41 is 65.'],
      commands: ['strings -n 4 -t x updater.bin | grep PKEY', 'xxd -s <offset> -l 80 updater.bin'],
      check(text) {
        const v = parseNum(text);
        if (isNaN(v)) return R(false, needNum);
        if (v === f.keyOff || v === f.base + f.keyOff) return R(true, `Yes: offset 0x${hexN(f.keyOff, 1)} (address ${hex32(f.base + f.keyOff)}). A public key is not secret, so finding it is not the attack. The attack is replacing it: whoever can rewrite these 65 bytes decides which images the device trusts. The defence is to make the key and the code that uses it immutable (ROM, write-protected or OTP storage) and to verify that protection with a write attempt on your own board.`);
        if (v === f.pkeyOff || v === f.base + f.pkeyOff) return R(false, 'That is the "PKEY" tag. The key material starts after the 8-byte header that follows it.');
        return R(false, 'Not that. Find the "PKEY" tag, skip the header, and look for the byte 04 followed by 64 bytes that look random.');
      }, solution: '0x' + hexN(f.keyOff, 1) },
    { id: 'blob', view: 'entropy', q: 'The image contains a compressed block. At which file offset does it start?',
      hints: ['Compressed and encrypted data look random: every byte value is about equally likely, so the entropy is high.',
        'In the Entropy view, look for where the bars jump to the ceiling after a run of zero-entropy padding.', 'Click the first tall bar to open the hex view there. A zlib stream starts with 78.'],
      commands: ['binwalk -E updater.bin      # entropy plot', 'binwalk updater.bin         # scans for known signatures such as a zlib header'],
      check(text) {
        const v = parseNum(text);
        if (isNaN(v)) return R(false, needNum);
        if (v === f.payloadOff || v === f.base + f.payloadOff) return R(true, `Yes: offset 0x${hexN(f.payloadOff, 1)}, where a zlib header (78 da) begins. The flat 0xFF run before it is erased flash used as padding. Entropy cannot tell compressed from encrypted data; a recognisable header can.`);
        if (Math.abs(v - f.payloadOff) < 0x100 || Math.abs(v - f.base - f.payloadOff) < 0x100) return R(false, 'Close, but find the exact first byte. Open the hex view around there and look for where the ff padding ends.');
        if (v === f.kOff || v === f.base + f.kOff) return R(false, 'That region has fairly high entropy too, but it is only 256 bytes and it is not compressed: it is a table of constants (see the next task).');
        return R(false, 'Not that. Use the Entropy view: code sits in the middle of the scale, padding at zero, compressed data at the top.');
      }, solution: '0x' + hexN(f.payloadOff, 1) },
    { id: 'hash', view: 'hex', q: 'Search the image for the bytes 98 2f 8a 42. They are the first entry (0x428a2f98, little-endian) of a well-known constant table. Which hash algorithm does this image implement?',
      hints: ['Use the search box in the Hex view with "98 2f 8a 42".', '0x428a2f98, 0x71374491, 0xb5c0fbcf … are the first round constants of a hash in the SHA-2 family that works on 32-bit words.'],
      commands: ['binwalk -R "\\x98\\x2f\\x8a\\x42" updater.bin', 'Ghidra: Search > Memory, hex 98 2f 8a 42, then follow the XREF to the compression function'],
      check(text) {
        const t = text.toLowerCase().replace(/[\s_-]/g, '');
        if (/sha2?256/.test(t)) return R(true, 'Yes, SHA-256. Algorithms announce themselves through their constants, with or without symbols, so hiding which algorithm you use protects nothing. Security has to rest on the key.');
        if (/sha2$|^sha$/.test(t)) return R(false, 'Right family. Which member uses 64 round constants of 32 bits?');
        if (/md5|sha1|crc/.test(t)) return R(false, 'Different constants. MD5 and SHA-1 start from 0x67452301; CRC-32 uses 0xEDB88320 or a 256-entry table starting 00000000 77073096.');
        return R(false, 'Not that. Look up the constant 0x428a2f98.');
      }, solution: 'SHA-256' },
  ];
}

/* ------------------------------------------------------------------ UI */

const VIEWS = [['hex', 'Hex'], ['vectors', 'Vectors'], ['strings', 'Strings'], ['entropy', 'Entropy'], ['elf', 'ELF']];

export default function mount(el, props = {}, ctx = { complete() {}, isDone: () => false }) {
  clear(el);
  el.classList.add('firmware-inspector');
  const st = { image: INSPECTOR_IMAGES[props.image] ? props.image : 'demo', view: 'hex', load: 0, off: 0, hi: null, minLen: 4, block: 64, solved: {}, hintN: {}, tried: {}, ans: {}, msg: {} };
  let bytes, tasks;
  const narrow = () => (el.clientWidth || 800) < 620;
  const body = h('div', { class: 'fwi-body' });
  const taskBox = h('div', { class: 'fwi-tasks' });
  const head = h('div', {});
  el.append(head, body, taskBox,
    h('p', { class: 'w-note' }, `All three images are synthetic: written for this course and compiled with ${TOOLCHAIN} for a fictional Cortex-M0+ class target (sources in tools/fwimages/src). Nothing here came from a real product and none of it has run on hardware. The commands shown with each task are what you would type against a real dump; their output is not reproduced here.`));

  function setImage(name) {
    st.image = name; bytes = b64ToBytes(INSPECTOR_IMAGES[name].bin); tasks = tasksFor(name);
    st.load = 0; st.off = 0; st.hi = null; st.solved = {}; st.hintN = {}; st.tried = {}; st.ans = {}; st.msg = {};
    if (st.view === 'elf' && !INSPECTOR_IMAGES[name].elf) st.view = 'hex';
    render();
  }
  const goto = (off, len = 1) => { const per = 256; st.off = Math.max(0, Math.min(Math.floor(off / per) * per, Math.floor((bytes.length - 1) / per) * per)); st.hi = [off, off + len]; st.view = 'hex'; render(); };

  function render() {
    const img = INSPECTOR_IMAGES[st.image];
    clear(head).append(
      h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Image' }, Object.keys(INSPECTOR_IMAGES).map((n) =>
        h('button', { class: 'w-tab' + (n === st.image ? ' on' : ''), role: 'tab', 'aria-selected': String(n === st.image), onclick: () => setImage(n) }, INSPECTOR_IMAGES[n].title))),
      h('p', { class: 'fwi-blurb' }, `${img.title}, ${bytes.length} bytes. ${img.blurb}`),
      h('div', { class: 'row fwi-bar' },
        h('label', { class: 'fwi-load' }, 'Load address ',
          h('input', { type: 'text', class: 'w-mono', size: 12, value: hex32(st.load), 'aria-label': 'Load address of the image', spellcheck: 'false',
            onchange: (e) => { const v = parseNum(e.target.value); if (!isNaN(v)) st.load = v >>> 0; render(); } })),
        h('span', { class: 'w-note fwi-loadnote' }, 'address = load address + file offset. A raw .bin does not say where it belongs; you have to work it out.')),
      h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'View' }, VIEWS.map(([id, label]) =>
        h('button', { class: 'w-tab' + (id === st.view ? ' on' : ''), role: 'tab', 'aria-selected': String(id === st.view), onclick: () => { st.view = id; render(); } }, label))));
    clear(body);
    ({ hex: viewHex, vectors: viewVectors, strings: viewStrings, entropy: viewEntropy, elf: viewElf })[st.view]();
    renderTasks();
  }

  function viewHex() {
    const per = narrow() ? 8 : 16;
    const page = 256;
    const end = Math.min(st.off + page, bytes.length);
    const pre = h('pre', { class: 'fwi-hex w-mono', tabindex: 0, 'aria-label': 'Hex dump' });
    pre.append(h('span', { class: 'fwi-dim' }, `${'offset'.padEnd(8)} ${'address'.padEnd(10)} ${per === 16 ? '00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f' : '00 01 02 03 04 05 06 07'}  ASCII\n`));
    for (let row = st.off; row < end; row += per) {
      pre.append(h('span', { class: 'fwi-dim' }, hexN(row, 6).padEnd(8) + ' '), hexN(st.load + row, 8).padEnd(10) + ' ');
      const asc = [];
      for (let i = 0; i < per; i++) {
        const o = row + i;
        if (o >= bytes.length) { pre.append('   '); continue; }
        const on = st.hi && o >= st.hi[0] && o < st.hi[1];
        const b = bytes[o];
        const cell = hexN(b);
        pre.append(on ? h('mark', {}, cell) : b === 0 || b === 0xff ? h('span', { class: 'fwi-dim' }, cell) : cell, i === 7 && per === 16 ? '  ' : ' ');
        const ch = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
        asc.push(on ? h('mark', {}, ch) : ch);
      }
      pre.append(' ', ...asc, '\n');
    }
    const msg = h('span', { class: 'w-note' });
    const search = h('input', { type: 'text', placeholder: 'text or hex bytes: 98 2f 8a 42', 'aria-label': 'Search the image', class: 'w-mono', spellcheck: 'false' });
    const jump = h('input', { type: 'text', placeholder: 'offset, e.g. 0x1f8', size: 12, 'aria-label': 'Go to file offset', class: 'w-mono', spellcheck: 'false' });
    const doSearch = () => {
      const r = searchBytes(bytes, search.value);
      if (!r.hits || !r.hits.length) { msg.textContent = 'No match.'; return; }
      const from = st.hi ? st.hi[0] : -1;
      const next = r.hits.find((x) => x > from) ?? r.hits[0];
      goto(next, r.length);
      body.querySelector('.fwi-found').textContent = `${r.hits.length} match${r.hits.length > 1 ? 'es' : ''}; showing the one at offset 0x${hexN(next, 1)}.`;
    };
    body.append(
      h('div', { class: 'row' },
        h('button', { class: 'btn small ghost', disabled: st.off === 0, onclick: () => { st.off -= page; render(); } }, 'Previous'),
        h('button', { class: 'btn small ghost', disabled: end >= bytes.length, onclick: () => { st.off += page; render(); } }, 'Next'),
        h('span', { class: 'w-mono' }, `0x${hexN(st.off, 1)}–0x${hexN(end - 1, 1)} of 0x${hexN(bytes.length, 1)}`),
        h('form', { class: 'row fwi-inline', onsubmit: (e) => { e.preventDefault(); const v = parseNum(jump.value); if (!isNaN(v) && v < bytes.length) goto(v); else msg.textContent = 'Offset is outside the file.'; } }, jump, h('button', { class: 'btn small', type: 'submit' }, 'Go'))),
      h('form', { class: 'row fwi-inline', onsubmit: (e) => { e.preventDefault(); doSearch(); } }, search, h('button', { class: 'btn small', type: 'submit' }, 'Find next'), msg),
      pre, h('p', { class: 'w-note fwi-found', 'aria-live': 'polite' }, 'Each row shows the file offset, the memory address for the load address above, the bytes, and the same bytes as ASCII (non-printable shown as a dot). 00 and ff are dimmed.'));
  }

  function viewVectors() {
    const vec = decodeVectors(bytes, st.load);
    const rows = vec.map((v) => {
      let meaning;
      if (v.index === 0) meaning = 'loaded into SP (MSP) before any code runs';
      else if (v.value === 0) meaning = 'unused';
      else meaning = [`handler at ${hex32(v.target)}`, v.thumb ? '' : ' — bit 0 is clear: taking this exception would fault',
        h('span', { class: v.inImage ? 'fwi-in' : 'fwi-out' }, v.inImage ? `  inside image, offset 0x${hexN(v.target - st.load, 1)}` : '  outside image at this load address')];
      return h('tr', {}, h('td', {}, String(v.index)), h('td', {}, v.name),
        h('td', {}, h('button', { class: 'fwi-link w-mono', title: 'Show these four bytes in the hex view', onclick: () => goto(v.index * 4, 4) }, hex32(v.value))), h('td', {}, meaning));
    });
    body.append(
      h('div', { class: 'fwi-scroll' }, h('table', { class: 'fwi-table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Exception'), h('th', {}, 'Word'), h('th', {}, 'Meaning'))), h('tbody', {}, rows))),
      h('p', { class: 'w-note' }, 'A Cortex-M image starts with its vector table: 32-bit little-endian words. At reset the core copies word 0 into SP and jumps to word 1. Cortex-M cores execute only Thumb instructions, and bit 0 of every code address in the table must be 1 to say so; the handler itself starts at the even address (value with bit 0 cleared). Words 2 to 15 are the system exception handlers; device interrupt vectors follow from word 16 (this teaching image has none).'),
      h('p', { class: 'w-note' }, '"Inside image" is computed from the load address you entered. With the right address every handler lands inside the file.'));
  }

  function viewStrings() {
    const list = extractStrings(bytes, st.minLen);
    const out = h('output', {}, String(st.minLen));
    body.append(
      h('div', { class: 'w-field fwi-min' }, h('label', { for: 'fwi-minlen' }, 'Minimum length'),
        h('input', { id: 'fwi-minlen', type: 'range', min: 3, max: 12, value: st.minLen, oninput: (e) => { out.textContent = e.target.value; }, onchange: (e) => { st.minLen = +e.target.value; render(); } }), out),
      h('p', { class: 'w-note' }, `${list.length} runs of at least ${st.minLen} printable ASCII characters, like strings -n ${st.minLen} -t x. Short minimums find more tags and more junk: byte sequences in code that happen to be printable.`),
      h('div', { class: 'fwi-scroll fwi-strings' }, h('table', { class: 'fwi-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Offset'), h('th', {}, 'Address'), h('th', {}, 'String'))),
        h('tbody', {}, list.map((x) => h('tr', {},
          h('td', {}, h('button', { class: 'fwi-link w-mono', title: 'Show in the hex view', onclick: () => goto(x.off, x.text.length) }, '0x' + hexN(x.off, 1))),
          h('td', { class: 'w-mono' }, hex32(st.load + x.off)), h('td', { class: 'w-mono fwi-str' }, x.text)))))));
  }

  function viewEntropy() {
    const blocks = blockEntropy(bytes, st.block);
    const W = 640, H = 200, L = 34, B = 22, T = 8;
    const bw = (W - L - 4) / blocks.length;
    const y = (bits) => T + (H - T - B) * (1 - bits / 8);
    const info = h('p', { class: 'w-mono fwi-einfo', 'aria-live': 'polite' }, 'Hover, focus or click a bar.');
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-svg fwi-entropy', role: 'img', 'aria-label': `Entropy of ${st.image}.bin in ${st.block}-byte blocks` });
    for (const g of [0, 2, 4, 6, 8]) svg.append(s('line', { x1: L, x2: W - 4, y1: y(g), y2: y(g), class: 'fwi-grid' }), s('text', { x: L - 6, y: y(g) + 4, 'text-anchor': 'end', 'font-size': 11 }, String(g)));
    const cap = Math.min(8, Math.log2(st.block));
    if (cap < 8) svg.append(s('line', { x1: L, x2: W - 4, y1: y(cap), y2: y(cap), class: 'fwi-cap' }), s('text', { x: W - 6, y: y(cap) - 4, 'text-anchor': 'end', 'font-size': 10, class: 'fwi-captext' }, `ceiling for ${st.block}-byte blocks: ${cap} bits`));
    blocks.forEach((b) => {
      const x = L + (b.off / st.block) * bw;
      const say = () => { info.textContent = `offset 0x${hexN(b.off, 1)}–0x${hexN(b.off + b.len - 1, 1)}: ${b.bits.toFixed(2)} bits per byte`; };
      svg.append(s('rect', { x, y: T, width: Math.max(bw, 1), height: H - T - B, class: 'fwi-hit', tabindex: 0, role: 'button', 'aria-label': `Block at offset 0x${hexN(b.off, 1)}, ${b.bits.toFixed(2)} bits per byte. Open in hex view.`,
        onmouseenter: say, onfocus: say, onclick: () => goto(b.off, b.len), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto(b.off, b.len); } } }),
      s('rect', { x: x + (bw > 3 ? 0.5 : 0), y: y(b.bits), width: Math.max(bw - (bw > 3 ? 1 : 0), 0.8), height: Math.max(y(0) - y(b.bits), b.bits === 0 ? 1.5 : 0), class: 'fwi-bar', 'pointer-events': 'none' }));
    });
    svg.append(s('text', { x: L, y: H - 5, 'font-size': 11 }, '0x0'), s('text', { x: W - 4, y: H - 5, 'font-size': 11, 'text-anchor': 'end' }, 'file offset 0x' + hexN(bytes.length, 1)),
      s('text', { x: 4, y: 12, 'font-size': 10 }, 'bits'));
    body.append(
      h('div', { class: 'row' }, h('label', {}, 'Block size ', h('select', { 'aria-label': 'Entropy block size', onchange: (e) => { st.block = +e.target.value; render(); } },
        [32, 64, 128, 256].map((n) => h('option', { value: n, selected: n === st.block }, n + ' bytes')))),
        h('span', { class: 'w-mono' }, `whole file: ${shannon(bytes).toFixed(2)} bits per byte`)),
      svg, info,
      h('p', { class: 'w-note' }, 'Shannon entropy per block: 0 means one byte value repeated (erased flash 0xFF, zero padding), 8 would mean all 256 values equally likely. Thumb code and text sit in the middle. Compressed and encrypted data sit at the ceiling, and entropy alone cannot tell those two apart. A block of N bytes cannot score above log2(N), so small blocks give fine position but a lower ceiling; tools such as binwalk use larger blocks on larger images.'));
  }

  function viewElf() {
    const img = INSPECTOR_IMAGES[st.image];
    if (!img.elf) {
      body.append(h('p', { class: 'w-msg' }, `There is no ELF for ${img.title}. This is the usual situation with firmware read out of a device: a flat binary with no section names, no symbols and no load address. Use the other views. Switch to demo.bin to see what the ELF adds.`));
      return;
    }
    const elf = parseElf(b64ToBytes(img.elf));
    const hd = elf.header;
    const x = (n, w = 8) => hexN(n, w);
    const flags = (f) => (f & 1 ? 'W' : '') + (f & 2 ? 'A' : '') + (f & 4 ? 'X' : '');
    const pflags = (f) => (f & 4 ? 'R' : ' ') + (f & 2 ? 'W' : ' ') + (f & 1 ? 'E' : ' ');
    const tbl = (heads, rows) => h('div', { class: 'fwi-scroll' }, h('table', { class: 'fwi-table w-mono' }, h('thead', {}, h('tr', {}, heads.map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((r) => h('tr', { class: r.cls || null }, r.map((c) => h('td', {}, c)))))));
    const secRows = elf.sections.filter((sec) => sec.index).map((sec) => { const r = [String(sec.index), sec.name, sec.typeName, x(sec.addr), x(sec.offset, 6), x(sec.size, 6), flags(sec.flags)]; if (sec.type === 8) r.cls = 'fwi-nobits'; return r; });
    const syms = elf.symbols.filter((y) => y.name && !y.name.startsWith('$') && y.type !== 4).sort((a, b) => a.value - b.value);
    body.append(
      h('h4', {}, 'ELF header'),
      h('dl', { class: 'w-kv' },
        h('dt', {}, 'Magic'), h('dd', {}, '7f 45 4c 46 ("\\x7fELF")'), h('dt', {}, 'Class, data'), h('dd', {}, `${hd.class}, ${hd.data}`),
        h('dt', {}, 'Type'), h('dd', {}, hd.type === 2 ? 'EXEC (linked executable)' : String(hd.type)), h('dt', {}, 'Machine'), h('dd', {}, hd.machine === 40 ? '40 (ARM)' : String(hd.machine)),
        h('dt', {}, 'Entry point'), h('dd', {}, `${hex32(hd.entry)}  (Reset_Handler, Thumb bit set)`),
        h('dt', {}, 'Program headers'), h('dd', {}, `${hd.phnum} at file offset ${hd.phoff}`), h('dt', {}, 'Section headers'), h('dd', {}, `${hd.shnum} at file offset 0x${x(hd.shoff, 1)}`)),
      h('h4', {}, 'Section headers'), tbl(['Nr', 'Name', 'Type', 'Addr', 'Off', 'Size', 'Flg'], secRows),
      h('p', { class: 'w-note' }, 'Addr is where the section lives at run time. .text and .rodata run from flash. .data has a RAM address but file bytes: its initial values are stored in flash and copied at startup. .bss is NOBITS: it has an address and a size but no bytes in the file, because it is all zeros and the startup code clears it. Flags: A allocated in memory, W writable, X executable.'),
      h('h4', {}, 'Program headers'),
      tbl(['Type', 'Offset', 'VirtAddr', 'PhysAddr', 'FileSiz', 'MemSiz', 'Flg'], elf.segments.map((p) => [p.type === 1 ? 'LOAD' : p.type === 0x6474e551 ? 'GNU_STACK' : '0x' + p.type.toString(16), x(p.offset, 6), x(p.vaddr), x(p.paddr), x(p.filesz, 5), x(p.memsz, 5), pflags(p.flags)])),
      h('p', { class: 'w-note' }, 'A flasher or objcopy -O binary places each LOAD segment at PhysAddr, the load address (LMA). VirtAddr is the run-time address (VMA). They are equal except for .data. FileSiz 0 with a non-zero MemSiz is .bss.'),
      h('h4', {}, `Symbol table (${syms.length} of ${elf.symbols.length} entries; file names and mapping symbols hidden)`),
      tbl(['Value', 'Size', 'Type', 'Bind', 'Name'], syms.map((y) => [x(y.value), String(y.size), y.typeName, y.bind ? 'GLOBAL' : 'LOCAL', y.name])),
      h('p', { class: 'w-note' }, 'Function symbols have bit 0 set (Thumb), as the vectors do. Symbols exist only in the ELF: demo.bin has none of this, which is why release builds are distributed as .bin or stripped, and why a leaked ELF saves a reverse engineer days.'));
  }

  function renderTasks() {
    clear(taskBox);
    const done = tasks.filter((t) => st.solved[t.id]).length;
    taskBox.append(h('h4', {}, `Tasks for ${st.image}.bin (${done} of ${tasks.length} solved)`));
    tasks.forEach((t, i) => {
      const last = st.msg[t.id];
      const msg = h('div', { class: 'w-msg' + (last ? (last.ok ? ' ok' : ' bad') : ''), 'aria-live': 'polite', hidden: !last }, last ? last.msg : '');
      const input = h('input', { type: 'text', class: 'w-mono', 'aria-label': `Answer to task ${i + 1}`, spellcheck: 'false', autocomplete: 'off', value: st.ans[t.id] || '', oninput: (e) => { st.ans[t.id] = e.target.value; } });
      const hintBox = h('div', { class: 'fwi-hints' }, (t.hints || []).slice(0, st.hintN[t.id] || 0).map((x) => h('p', { class: 'w-note' }, 'Hint: ' + x)));
      const reveal = h('div', {});
      const submit = (e) => {
        e.preventDefault();
        const r = t.check(input.value);
        st.tried[t.id] = (st.tried[t.id] || 0) + 1;
        st.msg[t.id] = r; msg.hidden = false; msg.className = 'w-msg ' + (r.ok ? 'ok' : 'bad'); msg.textContent = r.msg;
        if (r.ok) {
          st.solved[t.id] = r.msg;
          if (tasks.every((k) => st.solved[k.id])) ctx.complete();
          taskBox.querySelector('h4').textContent = `Tasks for ${st.image}.bin (${tasks.filter((k) => st.solved[k.id]).length} of ${tasks.length} solved)`;
        } else if (st.tried[t.id] >= 2 && !reveal.firstChild) {
          addReveal();
        }
      };
      const addReveal = () => {
        {
          reveal.append(h('button', { class: 'btn small ghost', type: 'button', onclick: () => { clear(reveal).append(h('p', { class: 'w-note' }, 'Answer: ', h('code', {}, t.solution), '. Work back from it until you can see where it comes from.')); } }, 'Show the answer'));
        }
      };
      if (!st.solved[t.id] && (st.tried[t.id] || 0) >= 2) addReveal();
      taskBox.append(h('div', { class: 'w-task' },
        h('p', {}, h('strong', {}, `${i + 1}. `), t.q),
        h('form', { class: 'row fwi-inline', onsubmit: submit }, input, h('button', { class: 'btn small', type: 'submit' }, 'Check'),
          (t.hints || []).length ? h('button', { class: 'btn small ghost', type: 'button', onclick: (e) => { st.hintN[t.id] = Math.min((st.hintN[t.id] || 0) + 1, t.hints.length); clear(hintBox).append(t.hints.slice(0, st.hintN[t.id]).map((x) => h('p', { class: 'w-note' }, 'Hint: ' + x))); if (st.hintN[t.id] >= t.hints.length) e.target.disabled = true; } }, 'Hint') : null,
          t.view !== st.view && (t.view !== 'elf' || INSPECTOR_IMAGES[st.image].elf) ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { st.view = t.view; render(); } }, `Open ${VIEWS.find((v) => v[0] === t.view)[1]} view`) : null),
        hintBox, msg, reveal,
        h('details', { class: 'fwi-cmds' }, h('summary', {}, 'On a real dump'), h('pre', { class: 'w-mono' }, t.commands.join('\n')))));
    });
  }

  setImage(st.image);
}
