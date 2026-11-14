// Disassembly reading lab: small functions compiled for Thumb (ARMv6-M) and RV32IM, with questions.
// The listings are llvm-objdump output for C compiled with clang (see js/sim/fwimages.js); the original C is
// shown only after the learner has committed to an answer.
import { h, clear } from '../core/dom.js';
import { DISASM, TOOLCHAIN } from '../sim/fwimages.js';

export const ARCHS = { thumb: 'Arm Thumb (Cortex-M)', riscv: 'RISC-V (RV32IM)' };
/** challenge id -> function in the compiled image */
export const CHALLENGES = { arithmetic: 'scale_add', loop: 'sum_array', mmio: 'led_on', strcmp: 'str_equal', 'pin-check': 'check_pin', 'stack-buffer': 'read_number' };
const TITLES = { arithmetic: 'Leaf arithmetic', loop: 'Loop over an array', mmio: 'Register bit set', strcmp: 'String compare', 'pin-check': 'PIN check', 'stack-buffer': 'Stack buffer' };

export const CHEATS = {
  thumb: [
    ['r0–r3', 'arguments 1 to 4; r0 also carries the return value. A callee may overwrite them.'],
    ['r4–r11', 'callee-saved: a function that uses them must push them first and pop them before returning.'],
    ['r7', 'frame pointer in Thumb code (when one is kept).'],
    ['sp (r13)', 'stack pointer. The stack grows towards lower addresses; push decrements sp.'],
    ['lr (r14)', 'link register: bl stores the return address here, with bit 0 set for Thumb.'],
    ['pc (r15)', 'program counter. Reads as the current instruction + 4. "ldr rX, [pc, #n]" loads a constant from the literal pool placed after the function.'],
    ['flags', 'N Z C V, set by instructions whose name ends in s (adds, subs, cmp…). Conditional branches test them: beq/bne (Z), blo/bhs (C, unsigned), blt/bge (signed).'],
    ['return', 'bx lr, or pop {…, pc} when lr was pushed in the prologue.'],
  ],
  riscv: [
    ['a0–a7', 'arguments 1 to 8; a0 also carries the return value. A callee may overwrite them.'],
    ['s0–s11', 'callee-saved. s0 doubles as the frame pointer when one is kept.'],
    ['t0–t6', 'temporaries, not preserved across calls.'],
    ['sp', 'stack pointer. Grows towards lower addresses, kept 16-byte aligned.'],
    ['ra', 'return address: jal stores the address of the next instruction here.'],
    ['zero', 'always reads 0. "li", "mv", "beqz", "ret" are assembler shorthands built on it (ret is jalr zero, 0(ra)).'],
    ['no flags', 'there is no flags register: a branch compares two registers itself (beq, bne, blt, bltu…).'],
    ['constants', 'a 32-bit constant is built in two steps: lui loads the upper 20 bits, addi (or the offset of a load/store) adds the low 12.'],
  ],
};

const num = (t) => { const s = String(t).trim().replace(/_/g, ''); return /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^-?\d+$/.test(s) ? parseInt(s, 10) : NaN; };
const hx = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
const R = (ok, msg) => ({ ok, msg });

/** A question answered with a number or address. `near` maps other plausible answers to specific feedback. */
function numQ(q, answer, okMsg, near = {}, fallback = 'Not that.', hints = []) {
  return { kind: 'num', q, answer, hints, check(t) { const v = num(t); if (isNaN(v)) return R(false, 'Type a number: hex with 0x, or decimal.'); if ((v >>> 0) === (answer >>> 0)) return R(true, okMsg); const k = Object.keys(near).find((x) => (Number(x) >>> 0) === (v >>> 0)); return R(false, k !== undefined ? near[k] : fallback); } };
}
function choiceQ(q, options, correct, okMsg, wrong, hints = []) {
  return { kind: 'choice', q, options, answer: correct, hints, check(i) { if (i === '' || i == null) return R(false, 'Pick one.'); return +i === correct ? R(true, okMsg) : R(false, wrong[+i] || 'Not that. Trace it with small numbers.'); } };
}

/** Per-instruction comments, keyed by address. Shown together with the C source after an answer. */
export const NOTES = {
  thumb: {
    scale_add: { 0x8000100: 'r2 = 5', 0x8000102: 'r2 = a * 5 (r0 is the first argument)', 0x8000104: 'r0 = b + a*5', 0x8000106: 'r0 = r0 - 3', 0x8000108: 'return; the result is in r0' },
    sum_array: { 0x800010a: 'r2 = values (r0 is needed for the result)', 0x800010c: 'sum = 0', 0x800010e: 'count left == 0 ?', 0x8000110: 'yes: leave the loop', 0x8000112: 'r3 = *r2, then r2 += 4 (load with post-increment)', 0x8000114: 'sum += r3', 0x8000116: 'count--', 0x8000118: 'back to the test', 0x800011a: 'return sum in r0' },
    led_on: { 0x800011c: 'r0 = 0x40000004, from the literal pool below', 0x800011e: 'read the register', 0x8000120: 'r2 = 0x20 = 1 << 5', 0x8000122: 'set bit 5 in the value read', 0x8000124: 'write it back', 0x8000126: 'return', 0x8000128: 'literal pool: the register address as data, not code' },
    str_equal: { 0x800012c: 'r2 = *b', 0x800012e: 'r3 = *a', 0x8000130: 'end of string a ?', 0x8000132: 'yes: stop', 0x8000134: 'the comparison: *a == *b ?', 0x8000136: 'different: stop early', 0x8000138: 'b++', 0x800013a: 'a++', 0x800013c: 'next character', 0x800013e: 'r1 = *a - *b: zero only if the last characters match', 0x8000140: 'r0 = 0 - r1; carry is set only when r1 == 0', 0x8000142: 'r0 = r0 + r1 + carry = carry: 1 if equal, 0 if not', 0x8000144: 'return', 0x8000146: 'padding (a no-op) to align the next function' },
    check_pin: { 0x8000148: 'prologue: save r4, r6, r7 and the return address', 0x800014a: 'frame pointer', 0x800014c: 'i = 0', 0x800014e: 'r2 = address of stored_pin (literal pool)', 0x8000150: 'i == 4 ?', 0x8000152: 'yes: all four matched, leave the loop', 0x8000154: 'r3 = stored_pin[i]', 0x8000156: 'r4 = entered[i]', 0x8000158: 'the comparison', 0x800015a: 'mismatch: leave the loop early', 0x800015c: 'i++', 0x800015e: 'next digit', 0x8000160: 'r1 = i - 4: zero only if the loop ran to the end', 0x8000162: 'r0 = 0 - r1; carry set only when r1 == 0', 0x8000164: 'r0 = carry: 1 if i == 4, else 0', 0x8000166: 'epilogue: restore registers and return (pop into pc)', 0x8000168: 'literal pool: address of stored_pin in RAM' },
    read_number: { 0x800016c: 'prologue: save r4, r6, r7 and the return address (16 bytes)', 0x800016e: 'frame pointer', 0x8000170: 'reserve 0x18 = 24 bytes of locals', 0x8000172: 'r4 = sp + 4 = &line[0]', 0x8000174: 'first argument = line', 0x8000176: 'call uart_read_line(line): no size is passed', 0x800017a: 'first argument = line', 0x800017c: 'call parse_number(line)', 0x8000180: 'result + 1', 0x8000182: 'release the locals', 0x8000184: 'epilogue: restore registers and return to whatever address is on the stack', 0x8000186: 'padding bytes; the disassembler decodes them as an instruction, but they are never executed' },
  },
  riscv: {
    scale_add: { 0x80000100: 'a2 = a << 2 = a * 4', 0x80000104: 'a0 = b + a', 0x80000108: 'a0 = a + b + 4a = 5a + b', 0x8000010c: 'a0 = a0 - 3', 0x80000110: 'return; the result is in a0' },
    sum_array: { 0x80000114: 'sum = 0', 0x80000118: 'count == 0: skip the loop', 0x8000011c: 'a3 = *values', 0x80000120: 'sum += a3', 0x80000124: 'count--', 0x80000128: 'values++ (4 bytes per element)', 0x8000012c: 'count != 0: loop again', 0x80000130: 'return value = sum', 0x80000134: 'return' },
    led_on: { 0x80000138: 'a0 = 0x40000 << 12 = 0x40000000', 0x8000013c: 'read the register at a0 + 4', 0x80000140: 'set bit 5 (0x20)', 0x80000144: 'write it back to a0 + 4', 0x80000148: 'return' },
    str_equal: { 0x8000014c: 'a2 = *a', 0x80000150: 'a3 = *b', 0x80000154: 'end of string a: stop', 0x80000158: 'the comparison and the branch in one: stop if *a != *b', 0x8000015c: 'a++', 0x80000160: 'b++', 0x80000164: 'next character', 0x80000168: 'a2 = *a ^ *b: zero only if they match', 0x8000016c: 'a0 = (a2 == 0)', 0x80000170: 'return' },
    check_pin: { 0x80000174: 'a1 = 0x80000000', 0x80000178: 'a2 = a1 + 0x244 = address of stored_pin', 0x8000017c: 'counter = -4; it counts up to 0', 0x80000180: 'counter == 0: done', 0x80000184: 'a3 = *entered', 0x80000188: 'a4 = *stored', 0x8000018c: 'the comparison and the early exit: leave if they differ', 0x80000190: 'stored++', 0x80000194: 'entered++', 0x80000198: 'counter++', 0x8000019c: 'not zero yet: next digit', 0x800001a0: 'a0 = (counter == 0): 1 only if all four matched', 0x800001a4: 'return' },
    read_number: { 0x800001a8: 'prologue: reserve a 32-byte frame', 0x800001ac: 'save the return address at sp + 28', 0x800001b0: 'a0 = sp + 8 = &line[0]', 0x800001b4: 'call uart_read_line(line): no size is passed', 0x800001b8: 'a0 = line again', 0x800001bc: 'call parse_number(line)', 0x800001c0: 'result + 1', 0x800001c4: 'reload the return address from the stack', 0x800001c8: 'release the frame', 0x800001cc: 'return to whatever address was loaded' },
  },
};

/** Questions for one function on one architecture. */
export function questionsFor(arch, id) {
  const T = arch === 'thumb';
  const ret = T ? 'r0' : 'a0';
  switch (id) {
    case 'arithmetic': return [
      choiceQ(`The function takes two integers (${T ? 'r0, r1' : 'a0, a1'}). What does it return?`, ['a + b - 3', 'a * 5 + b - 3', '(a + b) * 5 - 3', 'a * 4 + b + 3'], 1,
        T ? 'Yes. muls gives a*5, then b is added and 3 subtracted.' : 'Yes. There is no multiply here: a*4 comes from a shift, a + b from an add, and their sum is 5a + b.',
        { 0: 'The first argument is scaled before it is added. Follow what happens to it.', 2: 'Only the first argument is scaled; b is added once.', 3: T ? 'The multiplier loaded into r2 is 5, and the last instruction subtracts.' : 'a is added twice: once shifted (4a) and once as it is.' },
        ['Give the arguments small values, say a = 1 and b = 0, and execute the instructions on paper.']),
      numQ('It is called with a = 7 and b = 10. What does it return?', 42, `Yes: 7*5 + 10 - 3 = 42, left in ${ret}.`, { 35: 'That is only a*5. Two more instructions follow.', 45: 'The last instruction subtracts 3.', 14: 'The first argument is multiplied by 5 before the add.' }, 'Not that. Run the instructions with these values.'),
      { kind: 'text', q: 'Which register carries the return value?', answer: ret, hints: ['It is in the calling-convention table.'], check: (t) => t.trim().toLowerCase() === ret ? R(true, `Yes, ${ret}. It is also the first argument register, which is why compilers so often compute results in place.`) : R(false, T ? 'Not that. Under the Arm procedure call standard arguments and the result use the lowest-numbered registers.' : 'Not that. In the RISC-V convention the first argument register doubles as the result register.') },
    ];
    case 'loop': return [
      choiceQ(`Arguments: a pointer (${T ? 'r0' : 'a0'}) and a count (${T ? 'r1' : 'a1'}). What does the function do?`, ['Counts the non-zero words in the array', 'Returns the largest word in the array', 'Adds up count 32-bit words starting at the pointer', 'Copies count words to another place'], 2,
        'Yes: a running sum of count words.', { 0: 'Nothing tests the loaded value; it is added unconditionally.', 1: 'There is no comparison between elements, only an add.', 3: 'The loop only loads from memory; it never stores.' }, ['Find the instruction that reads memory, then see what is done with the value.']),
      T ? numQ('Give the address of the instruction that compares the remaining count with zero.', 0x800010e, 'Yes. cmp subtracts and sets the flags without keeping the result; the beq after it acts on them.', { 0x8000110: 'That is the branch that acts on the flags. The comparison is the instruction that sets them.', 0x8000116: 'That decrements the count (and sets flags too), but the loop jumps back to an explicit compare.' }, 'Not that. Look for cmp.')
        : numQ('Give the address of the conditional branch that closes the loop (jumps backwards).', 0x8000012c, 'Yes: bnez a1 compares a1 with zero and branches in one instruction. RISC-V has no flags register.', { 0x80000118: 'That branch is taken forwards, once, to skip the loop when count is 0.' }, 'Not that. Look for a branch whose target is a lower address.'),
      numQ('By how many bytes does the pointer advance on each iteration?', 4, T ? 'Yes. "ldm r2!, {r3}" loads one word and adds 4 to r2: the elements are 32 bits wide.' : 'Yes: addi a0, a0, 4. The elements are 32 bits wide.', { 1: 'One would be a byte array. Look at the load: it reads a whole word.' }, 'Not that. Find where the pointer register is updated.'),
    ];
    case 'mmio': return [
      choiceQ('What does the function do?', ['Writes 0x20 to a register, clearing the other bits', 'Sets one bit of a memory-mapped register and leaves the rest unchanged', 'Reads a register and returns bit 5', 'Clears bit 5 of a register'], 1,
        'Yes: read, OR in one bit, write back.', { 0: 'It reads the register first and ORs the old value in, so other bits survive.', 2: 'The value is written back, and nothing is returned.', 3: 'OR sets bits. Clearing would use AND with the inverted mask (bics / andi).' }),
      numQ('Which address does it write to?', 0x40000004, T ? 'Yes. A 16-bit Thumb instruction cannot hold a 32-bit constant, so the address is stored as data after the function and loaded pc-relative.' : 'Yes: lui builds 0x40000000 and the store adds the offset 4.', { 0x8000128: 'That is where the constant is stored (the literal pool). The question is which address the str writes to: the value of that constant.', 0x40000000: 'That is the base. The load and store use an offset of 4 from it.' }, 'Not that. Which value is in the base register when the store executes, and what offset is added?'),
      numQ('Which bit number does it set?', 5, 'Yes: 0x20 is 1 << 5. In the Bench-MCU map that is GPIO_OUT bit 5. Note that read-modify-write is three instructions: an interrupt that changes the same register between the read and the write has its change overwritten.', { 0x20: 'That is the mask. Which bit number has the value 0x20?', 32: 'That is the mask in decimal. Which bit number is it?', 6: 'Bits are numbered from 0: 0x01 is bit 0.' }, 'Not that. Convert the mask to a bit position.'),
    ];
    case 'strcmp': return [
      choiceQ('Arguments: two pointers to zero-terminated strings. What does the function return?', ['The length of the common prefix', '1 if the strings are identical, otherwise 0', 'The difference of the first two characters that differ, like strcmp', 'A pointer to the first difference'], 1,
        'Yes. The loop stops at the first difference or at the end of the first string; the tail turns "last characters equal" into 1 or 0.', { 0: 'No counter is kept; the pointers themselves advance.', 2: T ? 'The difference is computed, but the two instructions after it reduce it to 1 or 0.' : 'The xor is reduced to 1 or 0 by seqz.', 3: T ? 'The last instructions overwrite r0 with a flag, not an address.' : 'a0 is overwritten with a flag by seqz.' }, ['Trace it with "ab" and "ab", then with "ab" and "ax".']),
      T ? numQ('Give the address of the instruction that compares a character of one string with a character of the other.', 0x8000134, 'Yes: cmp r3, r2.', { 0x8000130: 'That compares a character with zero: the end-of-string test.', 0x8000136: 'That is the branch. The comparison is the instruction that sets the flags.' }, 'Not that. Look for a cmp with two registers.')
        : numQ('Give the address of the instruction that compares a character of one string with a character of the other.', 0x80000158, 'Yes: bne a2, a3 compares and branches at once.', { 0x80000154: 'That tests one character against zero: the end-of-string test.', 0x80000168: 'That xor computes the final result after the loop. The loop exit is decided earlier.' }, 'Not that. Look for a branch with two registers.'),
      numQ('It is called with "help" and "hello". How many characters of each string does it look at before returning?', 4, 'Yes: h, e, l match, the fourth differs, and it stops. The running time depends on where the first difference is. When one of the strings is a secret, that is a timing side channel: an attacker who can measure the time learns how many leading characters are right. A defender compares secrets in constant time (accumulate the differences, decide once at the end) and checks it by measuring.', { 3: 'Three match. It still has to load and compare the fourth to find the difference.', 5: 'It stops at the first difference and does not go on to the end.' }, 'Not that. Walk through the loop character by character.'),
    ];
    case 'pin-check': return [
      choiceQ('The argument points to four bytes typed by the user. What does the function do?', ['Adds the four digits and compares the sum with a stored value', 'Compares the bytes with a stored PIN one at a time, stops at the first mismatch, and returns 1 only if all four match', 'Compares all four bytes every time and returns the number of matches', 'Copies the entered PIN over the stored one'], 1,
        'Yes. An early-exit compare of four bytes.', { 0: 'Nothing is accumulated: each pair of bytes is compared directly.', 2: 'There is a branch out of the loop on the first mismatch, and the result is 0 or 1.', 3: 'The loop only loads; nothing is stored.' }),
      T ? numQ('Where is the stored PIN? Give its address.', 0x20000000, 'Yes: 0x20000000, in RAM, taken from the literal pool at 0x08000168. The initial value still comes from flash (.data), so it is in the firmware image as well.', { 0x8000168: 'That is the literal-pool slot holding the address. The PIN itself is at the address stored there.' }, 'Not that. Follow the ldr that loads from the literal pool.')
        : numQ('Where is the stored PIN? Give its address.', DISASM.riscv.symbols.find((s) => s.name === 'stored_pin').addr, 'Yes: lui gives 0x80000000 and addi adds 0x244. Anyone with the image can read the PIN at that address.', { 0x80000000: 'That is only the upper part from lui. The addi adds the low 12 bits.' }, 'Not that. Combine the lui and the addi that follows.'),
      T ? numQ('Give the address of the instruction that compares an entered digit with a stored digit.', 0x8000158, 'Yes: cmp r4, r3.', { 0x8000150: 'That compares the loop index with 4.', 0x800015a: 'That is the branch that acts on the comparison.' }, 'Not that. Which cmp has the two loaded bytes as operands?')
        : numQ('Give the address of the instruction that compares an entered digit with a stored digit.', 0x8000018c, 'Yes: bne a3, a4.', { 0x80000180: 'That tests the counter against zero.', 0x8000019c: 'That tests the counter, not the digits.' }, 'Not that. Which branch has the two loaded bytes as operands?'),
      numQ('Suppose an attacker can rewrite one instruction in flash. Which conditional branch, replaced by a no-op, makes every PIN pass? Give its address.', T ? 0x800015a : 0x8000018c,
        `Yes. Without that branch the loop always runs to the end and the function returns 1. The whole decision rests on one instruction${T ? '' : ' (here the same one that does the comparison)'}, which is also why a voltage or clock glitch at the right moment can have the same effect without touching flash. What a defender takes from this: the check is only as strong as the integrity of the code and of its execution. Verify firmware before running it (secure boot), write-protect flash and lock the debug port so the patch cannot be made, do not store the PIN in the clear, and for fault resistance compare in a way that a single skipped instruction cannot turn into "accept" (check twice, default to deny). Verify each of those by trying the attack on your own board.`,
        T ? { 0x8000152: 'Removing that branch makes the loop run past four bytes; it does not make a wrong digit pass.', 0x8000158: 'That is the comparison. Removing it leaves stale flags; the cleaner patch is the branch that acts on it.' } : { 0x80000180: 'That is the loop-end test. A wrong digit still leaves through the other branch.', 0x8000019c: 'That branch continues the loop. Removing it ends the loop after one digit, with the counter not zero: reject.' },
        'Not that. Which branch is taken only when a digit is wrong?', ['There are two ways out of the loop: all digits done, or a mismatch. Which branch is the mismatch exit?']),
    ];
    default: return [
      choiceQ('The function takes no arguments and calls two others. What does it do?', ['Reads a line into a buffer on its stack, converts it to a number and returns that number plus one', 'Allocates a buffer on the heap and returns a pointer to it', 'Reads one character and returns it', 'Prints a number'], 0,
        'Yes. The buffer is a local array, so it lives in this function\'s stack frame.', { 1: 'There is no call to an allocator; the space comes from moving sp.', 2: 'The callee is given the address of a buffer, not asked for a single value.', 3: 'The second call receives the buffer and returns a value that is then incremented.' }),
      numQ('At what offset from sp does the buffer start?', T ? 4 : 8, T ? 'Yes: add r4, sp, #4 computes its address.' : 'Yes: addi a0, sp, 8 computes its address.', {}, 'Not that. Find the instruction that computes the address passed to the first call.'),
      numQ('How many bytes can be written to the buffer before the write reaches the saved registers above it?', 20, T ? 'Yes: 24 bytes of locals minus the 4-byte offset. The C source declares char line[20].' : 'Yes: the buffer starts at sp + 8 and the saved return address is at sp + 28. The C source declares char line[20].', T ? { 24: 'That is the whole local area. The buffer starts 4 bytes into it.', 0x18: 'That is the whole local area. The buffer starts 4 bytes into it.' } : { 32: 'That is the whole frame. The buffer starts at sp + 8 and something is saved at sp + 28.', 24: 'The buffer starts at sp + 8, and the saved return address sits at sp + 28.' }, 'Not that. Subtract the start of the buffer from the address of the first saved register.',
        ['Draw the frame: where sp points, where the buffer starts, where the prologue saved things.']),
      numQ('At what offset from the start of the buffer is the saved return address?', T ? 32 : 20,
        (T ? 'Yes. Above the 20-byte buffer sit the saved r4, r6 and r7 (12 bytes), then lr. ' : 'Yes. ra is saved directly above the buffer. ') + 'uart_read_line is given the buffer address and no size, and copies until it sees a newline, so a longer line overwrites the saved return address and the function returns wherever the sender chose. For a defender: every copy takes the destination size; reject over-long input instead of truncating silently; build with stack protection where the toolchain supports it; and test with over-long input to see the rejection. The stack-smash tool shows the overwrite happening.',
        T ? { 20: 'At offset 20 the saved r4 begins. The push stored r4, r6, r7 and then lr, in that order from low to high addresses.', 36: 'That is its offset from sp. The buffer starts at sp + 4.' } : { 28: 'That is its offset from sp. The buffer starts at sp + 8.' }, 'Not that. Where did the prologue store the return address, relative to sp after the frame was set up?',
        [T ? 'push {r4, r6, r7, lr} stores four words; the lowest register is at the lowest address. Then sub sp moves below them.' : 'sw ra, 0x1c(sp) tells you directly.']),
    ];
  }
}

/* ------------------------------------------------------------------ UI */

export default function mount(el, props = {}, ctx = { complete() {}, isDone: () => false }) {
  clear(el);
  el.classList.add('disasm-lab');
  const st = { arch: ARCHS[props.arch] ? props.arch : 'thumb', id: CHALLENGES[props.challenge] ? props.challenge : 'arithmetic', state: {} };
  const key = () => st.arch + '/' + st.id;
  const cur = () => (st.state[key()] ||= { solved: {}, tries: {}, hintN: {}, msg: {}, val: {}, shown: false });

  function render() {
    clear(el);
    const fn = DISASM[st.arch].functions[CHALLENGES[st.id]];
    const qs = questionsFor(st.arch, st.id);
    const c = cur();
    const revealed = c.shown || c.solved[0];
    const notes = NOTES[st.arch][CHALLENGES[st.id]];
    const allDone = qs.every((_, i) => c.solved[i]);

    el.append(
      h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Architecture' }, Object.entries(ARCHS).map(([a, label]) =>
        h('button', { class: 'w-tab' + (a === st.arch ? ' on' : ''), role: 'tab', 'aria-selected': String(a === st.arch), onclick: () => { st.arch = a; render(); } }, label))),
      h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Function' }, Object.keys(CHALLENGES).map((id, i) => {
        const s2 = st.state[st.arch + '/' + id]; const n = questionsFor(st.arch, id).length;
        const done = s2 && Object.keys(s2.solved).length === n;
        return h('button', { class: 'w-tab' + (id === st.id ? ' on' : ''), role: 'tab', 'aria-selected': String(id === st.id), onclick: () => { st.id = id; render(); } }, `${i + 1}. ${TITLES[id]}${done ? ' ✓' : ''}`);
      })),
      h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, `Function at ${hx(fn.addr)}. `), 'Read the listing and answer the questions. The C source and a comment for every instruction appear once you have answered the first question.')));

    const table = h('table', { class: 'dis-list w-mono' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Address'), h('th', {}, 'Bytes'), h('th', {}, 'Instruction'), revealed ? h('th', {}, 'Meaning') : null)),
      h('tbody', {}, fn.lines.map((l) => h('tr', { class: /^\.word/.test(l.text) ? 'dis-data' : null },
        h('td', {}, (l.addr >>> 0).toString(16).padStart(8, '0')), h('td', { class: 'dis-bytes' }, l.bytes),
        h('td', { class: 'dis-ins' }, h('span', { class: 'dis-mn' }, l.text.split(' ')[0]), ' ' + l.text.split(' ').slice(1).join(' ')),
        revealed ? h('td', { class: 'dis-note' }, notes[l.addr] || '') : null))));

    const top = h('div', { class: 'dis-top' }, h('div', { class: 'dis-scroll', tabindex: 0, role: 'region', 'aria-label': 'Disassembly listing' }, table),
      h('p', { class: 'w-note' }, st.arch === 'thumb'
        ? 'Each Thumb instruction here is 16 bits (bl is 32), shown as one hexadecimal word. ".word" lines are data in the literal pool, shown byte by byte in memory order.'
        : 'Every instruction is 32 bits, shown byte by byte in memory order (little-endian). Names such as li, mv, beqz, j and ret are shorthands the disassembler prints for common forms of real instructions.'));
    const left = h('div', { class: 'dis-left' },
      revealed ? h('div', {}, h('h4', {}, 'Original C'), h('pre', { class: 'w-mono dis-c' }, fn.c)) :
        h('p', { class: 'w-note' }, 'The C source is hidden until you answer the first question. ', h('button', { class: 'btn small ghost', type: 'button', disabled: !c.tries[0], title: c.tries[0] ? '' : 'Attempt the first question first', onclick: () => { c.shown = true; render(); } }, 'Show it anyway')),
      h('details', { class: 'dis-cheat', open: true }, h('summary', {}, `Calling convention: ${st.arch === 'thumb' ? 'Arm AAPCS' : 'RISC-V ILP32'}`),
        h('dl', { class: 'w-kv' }, CHEATS[st.arch].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))));

    const right = h('div', { class: 'dis-right' });
    qs.forEach((q, i) => {
      const last = c.msg[i];
      const msg = h('div', { class: 'w-msg' + (last ? (last.ok ? ' ok' : ' bad') : ''), hidden: !last, 'aria-live': 'polite' }, last ? last.msg : '');
      const hints = h('div', {}, q.hints.slice(0, c.hintN[i] || 0).map((x) => h('p', { class: 'w-note' }, 'Hint: ' + x)));
      let control, read;
      if (q.kind === 'choice') {
        const name = `dis-${st.arch}-${st.id}-${i}-${Math.random().toString(36).slice(2, 7)}`;
        control = h('fieldset', { class: 'dis-choices' }, h('legend', { class: 'dis-sr' }, 'Options'), q.options.map((o, k) => h('label', {}, h('input', { type: 'radio', name, value: k, checked: String(c.val[i]) === String(k), onchange: () => { c.val[i] = k; } }), ' ' + o)));
        read = () => c.val[i];
      } else {
        const field = h('input', { type: 'text', class: 'w-mono', 'aria-label': `Answer to question ${i + 1}`, autocomplete: 'off', spellcheck: 'false', value: c.val[i] || '', oninput: (e) => { c.val[i] = e.target.value; } });
        control = field; read = () => field.value;
      }
      const reveal = h('div', {});
      const showAnswer = () => clear(reveal).append(h('p', { class: 'w-note' }, 'Answer: ', h('code', {}, q.kind === 'choice' ? q.options[q.answer] : q.kind === 'num' ? (q.answer > 4096 ? hx(q.answer) : String(q.answer)) : q.answer), '. Find it in the listing before you move on.'));
      if (!c.solved[i] && (c.tries[i] || 0) >= 3) reveal.append(h('button', { class: 'btn small ghost', type: 'button', onclick: showAnswer }, 'Show the answer'));
      right.append(h('form', { class: 'dis-q', onsubmit: (e) => {
        e.preventDefault();
        const r = q.check(read());
        c.tries[i] = (c.tries[i] || 0) + 1; c.msg[i] = r;
        const was = revealed;
        if (r.ok) c.solved[i] = true;
        if (qs.every((_, k) => c.solved[k])) ctx.complete();
        if ((r.ok && i === 0 && !was) || qs.every((_, k) => c.solved[k]) || i === 0) { render(); return; }
        msg.hidden = false; msg.className = 'w-msg ' + (r.ok ? 'ok' : 'bad'); msg.textContent = r.msg;
        if (!r.ok && c.tries[i] >= 3 && !reveal.firstChild) reveal.append(h('button', { class: 'btn small ghost', type: 'button', onclick: showAnswer }, 'Show the answer'));
      } },
      h('p', {}, h('strong', {}, `${i + 1}. `), q.q), control,
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'submit' }, 'Check'),
        q.hints.length ? h('button', { class: 'btn small ghost', type: 'button', disabled: (c.hintN[i] || 0) >= q.hints.length, onclick: () => { c.hintN[i] = (c.hintN[i] || 0) + 1; render(); } }, 'Hint') : null),
      hints, msg, reveal));
    });
    if (allDone) right.append(h('p', { class: 'w-msg ok' }, 'All questions for this function answered. Try the same function on the other architecture: the C is identical, the idioms are not.'));

    el.append(top, h('div', { class: 'dis-grid' }, right, left),
      h('p', { class: 'w-note' }, `These listings are llvm-objdump output for tools/fwimages/src/disasm_funcs.c, compiled with ${TOOLCHAIN} at -Oz for ${st.arch === 'thumb' ? 'thumbv6m (Cortex-M0+)' : 'riscv32, rv32im without compressed instructions'}. Other compilers, versions and optimisation levels produce different code for the same C; production RISC-V firmware (for example for an ESP32-C3) normally also uses 16-bit compressed instructions. Nothing here was run on hardware. With GNU tools the same view comes from ${st.arch === 'thumb' ? 'arm-none-eabi-objdump -d file.elf' : 'riscv32-unknown-elf-objdump -d file.elf (or riscv64-unknown-elf-objdump)'}, and Ghidra shows it next to a decompilation.`));
  }
  render();
}
