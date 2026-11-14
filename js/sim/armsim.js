// A small Cortex-M simulator for the debug-session tool.
//
// What is modelled: the complete 16-bit Thumb instruction set of ARMv6-M plus the 32-bit BL (everything clang
// emits for -mcpu=cortex-m0plus), the NZCV flags, a flash and a RAM region, exception entry and return for
// HardFault with the 8-word stack frame, and the fault status registers of an ARMv7-M core (CFSR, HFSR, BFAR)
// so that fault diagnosis can be practised. ARMv6-M code runs unchanged on ARMv7-M cores, which is why the two
// can be combined.
// What is not: Thumb-2 32-bit instructions other than BL, interrupts, SysTick, PSP/unprivileged mode, MPU,
// PRIMASK, cycle timing, unaligned-access faults. SVC and BKPT are reported as stop events, not executed.

export const CFSR = { IBUSERR: 1 << 8, PRECISERR: 1 << 9, BFARVALID: 1 << 15, UNDEFINSTR: 1 << 16, INVSTATE: 1 << 17 };
export const HFSR_FORCED = 0x40000000;
export const EXC_RETURN_THREAD_MSP = 0xfffffff9;
export const SCB = { CPUID: 0xe000ed00, ICSR: 0xe000ed04, VTOR: 0xe000ed08, SHCSR: 0xe000ed24, CFSR: 0xe000ed28, HFSR: 0xe000ed2c, DFSR: 0xe000ed30, MMFAR: 0xe000ed34, BFAR: 0xe000ed38 };

class Fault {
  constructor(cfsr, addr) { this.cfsr = cfsr; this.addr = addr; }
}

/** The handful of Bench-MCU peripherals the debug programs touch (see docs/BENCH_MCU.md). Fictional. */
export class BenchPeripherals {
  constructor() { this.reset(); }
  reset() { this.gpioDir = 0; this.gpioOut = 0; this.uartCtrl = 0; this.uartTx = ''; this.adcCtrl = 0; this.adcStatus = 0; this.adcData = 0; this.adcValue = 2748; }
  has(addr) { return addr >= 0x40000000 && addr < 0x40004000; }
  read(addr) {
    switch (addr) {
      case 0x40000000: return this.gpioDir;
      case 0x40000004: case 0x40000008: return this.gpioOut;
      case 0x40001004: return 1; // UART_STATUS: TX_READY
      case 0x40001008: return this.uartCtrl;
      case 0x40003000: return this.adcCtrl;
      case 0x40003004: return this.adcStatus;
      case 0x40003008: return this.adcData;
      default: return 0;
    }
  }
  write(addr, v) {
    switch (addr) {
      case 0x40000000: this.gpioDir = v & 0xffff; break;
      case 0x40000004: this.gpioOut = v & 0xffff; break;
      case 0x40001000: this.uartTx += String.fromCharCode(v & 0xff); break;
      case 0x40001008: this.uartCtrl = v & 3; break;
      case 0x40003000: // ADC_CTRL: START (bit 0) is self-clearing; the conversion completes at once in this model
        this.adcCtrl = v & 0xf0;
        if (v & 1) { this.adcData = this.adcValue; this.adcStatus = 1; }
        break;
      default: break;
    }
  }
}

export class ArmSim {
  constructor({ flashBase = 0x08000000, flashSize = 0x10000, ramBase = 0x20000000, ramSize = 0x10000, peripherals = new BenchPeripherals() } = {}) {
    this.flashBase = flashBase; this.flash = new Uint8Array(flashSize).fill(0xff);
    this.ramBase = ramBase; this.ram = new Uint8Array(ramSize);
    this.periph = peripherals;
    this.r = new Uint32Array(16);
    this.reset();
  }

  eraseFlash() { this.flash.fill(0xff); }
  loadFlash(addr, bytes) { this.flash.set(bytes, addr - this.flashBase); }

  reset() {
    this.r.fill(0);
    this.N = this.Z = this.C = this.V = 0; this.T = 1; this.ipsr = 0;
    this.cfsr = 0; this.hfsr = 0; this.bfar = 0; this.mmfar = 0;
    this.lockup = false; this.steps = 0; this.event = null;
    this.ram.fill(0);
    this.periph.reset();
    const sp = this.peek32(this.flashBase), pc = this.peek32(this.flashBase + 4);
    this.r[13] = sp & ~3; this.r[14] = 0xffffffff;
    if (pc === 0xffffffff) { this.lockup = true; this.r[15] = 0xfffffffe; } // erased flash: the core locks up at once
    else { this.r[15] = pc & ~1; this.T = pc & 1; }
  }

  get xpsr() { return ((this.N << 31) | (this.Z << 30) | (this.C << 29) | (this.V << 28) | (this.T << 24) | this.ipsr) >>> 0; }
  set xpsr(v) { this.N = v >>> 31; this.Z = (v >>> 30) & 1; this.C = (v >>> 29) & 1; this.V = (v >>> 28) & 1; this.T = (v >>> 24) & 1; this.ipsr = v & 0x1ff; }

  /* ---- memory ---- */
  region(addr) {
    let o = addr - this.flashBase;
    if (o >= 0 && o < this.flash.length) return [this.flash, o, false];
    o = addr - this.ramBase;
    if (o >= 0 && o < this.ram.length) return [this.ram, o, true];
    return null;
  }
  scbRead(addr) {
    switch (addr) {
      case SCB.CPUID: return 0x410fc241; // Cortex-M4 r0p1
      case SCB.ICSR: return this.ipsr;
      case SCB.VTOR: return this.flashBase;
      case SCB.CFSR: return this.cfsr >>> 0;
      case SCB.HFSR: return this.hfsr >>> 0;
      case SCB.MMFAR: return this.mmfar >>> 0;
      case SCB.BFAR: return this.bfar >>> 0;
      default: return 0;
    }
  }
  /** Word-level device access. Returns undefined when nothing is mapped there. */
  devRead(addr) {
    if (this.periph.has(addr)) return this.periph.read(addr) >>> 0;
    if (addr >= 0xe000ed00 && addr < 0xe000ed40) return this.scbRead(addr);
    return undefined;
  }
  devWrite(addr, v) {
    if (this.periph.has(addr)) { this.periph.write(addr, v >>> 0); return true; }
    if (addr >= 0xe000ed00 && addr < 0xe000ed40) {
      if (addr === SCB.CFSR) this.cfsr &= ~v; // write one to clear
      if (addr === SCB.HFSR) this.hfsr &= ~v;
      return true;
    }
    return false;
  }
  /** Debugger read without side effects or faults; undefined when unmapped. */
  peek8(addr) {
    addr >>>= 0;
    const m = this.region(addr);
    if (m) return m[0][m[1]];
    const w = this.devRead((addr & ~3) >>> 0);
    return w === undefined ? undefined : (w >>> ((addr & 3) * 8)) & 0xff;
  }
  peek(addr, size) {
    let v = 0;
    for (let i = size - 1; i >= 0; i--) { const b = this.peek8(addr + i); if (b === undefined) return undefined; v = v * 256 + b; }
    return v;
  }
  peek32(addr) { return this.peek(addr, 4); }
  /** Debugger write. Returns false when the address is unmapped or is flash. */
  poke(addr, size, value) {
    addr >>>= 0;
    const m = this.region(addr);
    if (m) { if (!m[2]) return false; for (let i = 0; i < size; i++) m[0][m[1] + i] = (value >>> (8 * i)) & 0xff; return true; }
    if (size === 4) return this.devWrite(addr, value);
    return false;
  }
  read(addr, size) {
    addr >>>= 0;
    const m = this.region(addr);
    if (m && m[1] + size <= m[0].length) { let v = 0; for (let i = size - 1; i >= 0; i--) v = v * 256 + m[0][m[1] + i]; return v; }
    const w = this.devRead((addr & ~3) >>> 0);
    if (w === undefined) throw new Fault(CFSR.PRECISERR | CFSR.BFARVALID, addr);
    return size === 4 ? w : (w >>> ((addr & 3) * 8)) & (size === 1 ? 0xff : 0xffff);
  }
  write(addr, size, value) {
    addr >>>= 0;
    const m = this.region(addr);
    if (m && m[2] && m[1] + size <= m[0].length) { for (let i = 0; i < size; i++) m[0][m[1] + i] = (value >>> (8 * i)) & 0xff; return; }
    // Peripheral registers are 32 bits wide; narrower writes are widened (enough for the bundled programs).
    if (!m && this.devWrite((addr & ~3) >>> 0, value >>> 0)) return;
    throw new Fault(CFSR.PRECISERR | CFSR.BFARVALID, addr); // unmapped, or a write to flash
  }

  /* ---- flags ---- */
  nz(v) { v >>>= 0; this.N = v >>> 31; this.Z = v === 0 ? 1 : 0; return v; }
  adc(a, b, carry) {
    a >>>= 0; b >>>= 0;
    const sum = a + b + carry;
    const res = sum >>> 0;
    this.C = sum > 0xffffffff ? 1 : 0;
    this.V = ((~(a ^ b) & (a ^ res)) >>> 31) & 1;
    return this.nz(res);
  }
  cond(c) {
    switch (c) {
      case 0: return this.Z; case 1: return !this.Z; case 2: return this.C; case 3: return !this.C;
      case 4: return this.N; case 5: return !this.N; case 6: return this.V; case 7: return !this.V;
      case 8: return this.C && !this.Z; case 9: return !this.C || this.Z;
      case 10: return this.N === this.V; case 11: return this.N !== this.V;
      case 12: return !this.Z && this.N === this.V; case 13: return this.Z || this.N !== this.V;
      default: return true;
    }
  }

  /* ---- control flow ---- */
  /** BX, BLX and POP {pc}: bit 0 selects Thumb state; in handler mode an EXC_RETURN value returns from the exception. */
  branchX(addr) {
    addr >>>= 0;
    if (this.ipsr !== 0 && addr >>> 28 === 0xf) { this.exceptionReturn(); return; }
    this.T = addr & 1; this.r[15] = addr & ~1;
  }
  takeFault(f, returnAddr) {
    this.cfsr |= f.cfsr;
    if (f.cfsr & CFSR.BFARVALID) this.bfar = f.addr >>> 0;
    if (this.ipsr !== 0) { this.enterLockup(); return; } // a fault inside the HardFault handler
    this.hfsr |= HFSR_FORCED; // the configurable fault handlers are disabled at reset, so the fault escalates
    const align = (this.r[13] >>> 2) & 1;
    const frame = ((this.r[13] - 32) & ~4) >>> 0;
    const words = [this.r[0], this.r[1], this.r[2], this.r[3], this.r[12], this.r[14], returnAddr >>> 0, (this.xpsr | (align << 9)) >>> 0];
    if (!this.region(frame) || !this.region(frame + 31)) { this.enterLockup(); return; }
    words.forEach((w, i) => this.poke(frame + 4 * i, 4, w));
    this.r[13] = frame; this.r[14] = EXC_RETURN_THREAD_MSP; this.ipsr = 3;
    const vec = this.peek32(this.flashBase + 12);
    this.T = vec & 1; this.r[15] = vec & ~1;
    this.event = { type: 'hardfault', cfsr: f.cfsr, addr: f.addr, frame, from: returnAddr >>> 0 };
  }
  enterLockup() { this.lockup = true; this.r[15] = 0xfffffffe; this.event = { type: 'lockup' }; }
  exceptionReturn() {
    const f = this.r[13];
    this.r[0] = this.peek32(f); this.r[1] = this.peek32(f + 4); this.r[2] = this.peek32(f + 8); this.r[3] = this.peek32(f + 12);
    this.r[12] = this.peek32(f + 16); this.r[14] = this.peek32(f + 20); this.r[15] = this.peek32(f + 24) & ~1;
    const psr = this.peek32(f + 28);
    this.xpsr = psr & ~0x200;
    this.r[13] = (f + 32 + ((psr >>> 9) & 1) * 4) >>> 0;
  }

  /** Execute one instruction. Sets this.event when something notable happened (fault, lockup, bkpt, svc). */
  step() {
    this.event = null;
    if (this.lockup) { this.event = { type: 'lockup' }; return; }
    const pc = this.r[15];
    try {
      if (!this.T) throw new Fault(CFSR.INVSTATE);
      const m = this.region(pc);
      if (!m || pc & 1) throw new Fault(CFSR.IBUSERR);
      this.exec(m[0][m[1]] | (m[0][m[1] + 1] << 8), pc);
      this.steps++;
    } catch (e) {
      if (!(e instanceof Fault)) throw e;
      this.takeFault(e, pc);
    }
  }

  exec(insn, pc) {
    const r = this.r;
    const pcv = (pc + 4) >>> 0; // value the instruction sees when it reads PC
    let next = (pc + 2) >>> 0;
    const lo = insn & 7, mid = (insn >>> 3) & 7, hi8 = (insn >>> 8) & 7, imm8 = insn & 0xff, imm5 = (insn >>> 6) & 31;
    switch (insn >>> 12) {
      case 0: case 1: {
        if ((insn >>> 11) === 3) { // ADDS/SUBS register or 3-bit immediate
          const b = insn & 0x400 ? imm5 & 7 : r[imm5 & 7];
          r[lo] = insn & 0x200 ? this.adc(r[mid], ~b, 1) : this.adc(r[mid], b, 0);
        } else {
          const v = r[mid], type = (insn >>> 11) & 3;
          let res;
          if (type === 0) { res = imm5 ? v << imm5 : v; if (imm5) this.C = (v >>> (32 - imm5)) & 1; }
          else if (type === 1) { const n = imm5 || 32; this.C = (v >>> (n - 1)) & 1; res = n === 32 ? 0 : v >>> n; }
          else { const n = imm5 || 32; this.C = n === 32 ? v >>> 31 : (v >>> (n - 1)) & 1; res = n === 32 ? (v >> 31) : (v >> n); }
          r[lo] = this.nz(res);
        }
        break;
      }
      case 2: case 3: {
        const op = (insn >>> 11) & 3;
        if (op === 0) r[hi8] = this.nz(imm8);
        else if (op === 1) this.adc(r[hi8], ~imm8, 1);
        else if (op === 2) r[hi8] = this.adc(r[hi8], imm8, 0);
        else r[hi8] = this.adc(r[hi8], ~imm8, 1);
        break;
      }
      case 4: {
        if (insn & 0x800) { r[hi8] = this.read((pcv & ~3) + imm8 * 4, 4); break; } // LDR literal
        if (!(insn & 0x400)) { this.dataProc((insn >>> 6) & 15, mid, lo); break; }
        const rm = (insn >>> 3) & 15, rd = lo | ((insn >>> 4) & 8);
        const val = (n) => (n === 15 ? pcv : r[n]);
        switch ((insn >>> 8) & 3) {
          case 0: { const v = (val(rd) + val(rm)) >>> 0; if (rd === 15) next = v & ~1; else r[rd] = v; break; }
          case 1: this.adc(val(rd), ~val(rm), 1); break;
          case 2: if (rd === 15) next = val(rm) & ~1; else r[rd] = val(rm); break;
          default: {
            const target = val(rm);
            if (insn & 0x80) r[14] = (pc + 2) | 1; // BLX
            r[15] = next; this.branchX(target); return;
          }
        }
        break;
      }
      case 5: {
        const addr = (r[mid] + r[imm5 & 7]) >>> 0;
        switch ((insn >>> 9) & 7) {
          case 0: this.write(addr, 4, r[lo]); break;
          case 1: this.write(addr, 2, r[lo]); break;
          case 2: this.write(addr, 1, r[lo]); break;
          case 3: r[lo] = (this.read(addr, 1) << 24) >> 24; break;
          case 4: r[lo] = this.read(addr, 4); break;
          case 5: r[lo] = this.read(addr, 2); break;
          case 6: r[lo] = this.read(addr, 1); break;
          default: r[lo] = (this.read(addr, 2) << 16) >> 16;
        }
        break;
      }
      case 6: { const a = r[mid] + imm5 * 4; if (insn & 0x800) r[lo] = this.read(a, 4); else this.write(a, 4, r[lo]); break; }
      case 7: { const a = r[mid] + imm5; if (insn & 0x800) r[lo] = this.read(a, 1); else this.write(a, 1, r[lo]); break; }
      case 8: { const a = r[mid] + imm5 * 2; if (insn & 0x800) r[lo] = this.read(a, 2); else this.write(a, 2, r[lo]); break; }
      case 9: { const a = r[13] + imm8 * 4; if (insn & 0x800) r[hi8] = this.read(a, 4); else this.write(a, 4, r[hi8]); break; }
      case 10: r[hi8] = (insn & 0x800 ? r[13] : pcv & ~3) + imm8 * 4; break;
      case 11: next = this.misc(insn, pc, next); if (next === null) return; break;
      case 12: {
        let addr = r[hi8];
        if (insn & 0x800) { // LDM
          const vals = [];
          for (let i = 0; i < 8; i++) if (insn & (1 << i)) { vals.push([i, this.read(addr, 4)]); addr += 4; }
          for (const [i, v] of vals) r[i] = v;
          if (!(insn & (1 << hi8))) r[hi8] = addr;
        } else {
          for (let i = 0; i < 8; i++) if (insn & (1 << i)) { this.write(addr, 4, r[i]); addr += 4; }
          r[hi8] = addr;
        }
        break;
      }
      case 13: {
        const c = (insn >>> 8) & 15;
        if (c === 14) throw new Fault(CFSR.UNDEFINSTR);
        if (c === 15) { this.event = { type: 'svc', imm: imm8 }; break; }
        if (this.cond(c)) next = (pcv + ((imm8 << 24) >> 23)) >>> 0;
        break;
      }
      case 14: {
        if (insn & 0x800) throw new Fault(CFSR.UNDEFINSTR);
        next = (pcv + (((insn & 0x7ff) << 21) >> 20)) >>> 0;
        break;
      }
      default: { // 32-bit: only BL is implemented
        const m = this.region(pc + 2);
        const lo16 = m ? m[0][m[1]] | (m[0][m[1] + 1] << 8) : 0;
        if ((insn & 0xf800) !== 0xf000 || (lo16 & 0xd000) !== 0xd000) throw new Fault(CFSR.UNDEFINSTR);
        const S = (insn >>> 10) & 1, J1 = (lo16 >>> 13) & 1, J2 = (lo16 >>> 11) & 1;
        const I1 = 1 - (J1 ^ S), I2 = 1 - (J2 ^ S);
        const imm = (S ? -1 << 24 : 0) | (I1 << 23) | (I2 << 22) | ((insn & 0x3ff) << 12) | ((lo16 & 0x7ff) << 1);
        r[14] = (pc + 4) | 1;
        next = (pcv + imm) >>> 0;
      }
    }
    r[15] = next;
  }

  dataProc(op, m, d) {
    const r = this.r, a = r[d], b = r[m];
    switch (op) {
      case 0: r[d] = this.nz(a & b); break;
      case 1: r[d] = this.nz(a ^ b); break;
      case 2: { const n = b & 0xff; let v = a; if (n) { this.C = n <= 32 ? (a >>> (32 - n)) & 1 : 0; v = n < 32 ? a << n : 0; } r[d] = this.nz(v); break; }
      case 3: { const n = b & 0xff; let v = a; if (n) { this.C = n <= 32 ? (a >>> (n - 1)) & 1 : 0; v = n < 32 ? a >>> n : 0; } r[d] = this.nz(v); break; }
      case 4: { const n = b & 0xff; let v = a; if (n) { this.C = n < 32 ? (a >>> (n - 1)) & 1 : a >>> 31; v = n < 32 ? a >> n : a >> 31; } r[d] = this.nz(v); break; }
      case 5: r[d] = this.adc(a, b, this.C); break;
      case 6: r[d] = this.adc(a, ~b, this.C); break;
      case 7: { const n = b & 0xff; let v = a; if (n) { const k = n & 31; v = k ? ((a >>> k) | (a << (32 - k))) >>> 0 : a; this.C = v >>> 31; } r[d] = this.nz(v); break; }
      case 8: this.nz(a & b); break;
      case 9: r[d] = this.adc(~b, 0, 1); break;
      case 10: this.adc(a, ~b, 1); break;
      case 11: this.adc(a, b, 0); break;
      case 12: r[d] = this.nz(a | b); break;
      case 13: r[d] = this.nz(Math.imul(a, b)); break;
      case 14: r[d] = this.nz(a & ~b); break;
      default: r[d] = this.nz(~b);
    }
  }

  misc(insn, pc, next) {
    const r = this.r, lo = insn & 7, mid = (insn >>> 3) & 7;
    switch ((insn >>> 8) & 15) {
      case 0: r[13] = insn & 0x80 ? r[13] - (insn & 0x7f) * 4 : r[13] + (insn & 0x7f) * 4; return next;
      case 2: {
        const v = r[mid];
        r[lo] = [(v << 16) >> 16, (v << 24) >> 24, v & 0xffff, v & 0xff][(insn >>> 6) & 3];
        return next;
      }
      case 4: case 5: { // PUSH
        let n = 0;
        for (let i = 0; i < 9; i++) if (insn & (1 << i)) n++;
        let addr = (r[13] - 4 * n) >>> 0;
        const base = addr;
        for (let i = 0; i < 8; i++) if (insn & (1 << i)) { this.write(addr, 4, r[i]); addr += 4; }
        if (insn & 0x100) this.write(addr, 4, r[14]);
        r[13] = base;
        return next;
      }
      case 12: case 13: { // POP
        let addr = r[13];
        const vals = [];
        for (let i = 0; i < 8; i++) if (insn & (1 << i)) { vals.push([i, this.read(addr, 4)]); addr += 4; }
        let target = null;
        if (insn & 0x100) { target = this.read(addr, 4); addr += 4; }
        for (const [i, v] of vals) r[i] = v;
        r[13] = addr;
        if (target !== null) { r[15] = next; this.branchX(target); return null; }
        return next;
      }
      case 10: {
        const v = r[mid], op = (insn >>> 6) & 3;
        if (op === 0) r[lo] = ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24);
        else if (op === 1) r[lo] = ((v & 0x00ff00ff) << 8) | ((v >>> 8) & 0x00ff00ff);
        else if (op === 3) r[lo] = (((v & 0xff) << 24) >> 16) | ((v >>> 8) & 0xff);
        else throw new Fault(CFSR.UNDEFINSTR);
        return next;
      }
      case 6: return next; // CPS: interrupt masking is not modelled
      case 14: this.event = { type: 'bkpt', imm: insn & 0xff }; return next;
      case 15: return next; // NOP and other hints
      default: throw new Fault(CFSR.UNDEFINSTR);
    }
  }

  /**
   * Call a function the way AAPCS does (arguments in r0-r3, return address in LR) and run until it returns.
   * For tests. Returns r0, or throws if the function faults or does not return within maxSteps.
   */
  call(addr, args = [], maxSteps = 2000000) {
    const magic = 0x0800fffe; // inside flash, never reached by the test programs
    this.lockup = false; this.ipsr = 0;
    if (!this.region(this.r[13] - 4)) this.r[13] = this.ramBase + this.ram.length;
    args.forEach((a, i) => { this.r[i] = a >>> 0; });
    this.r[14] = magic | 1; this.r[15] = addr & ~1; this.T = 1;
    for (let i = 0; i < maxSteps; i++) {
      if (this.r[15] === magic) return this.r[0];
      this.step();
      if (this.event) throw new Error('unexpected ' + this.event.type + ' at step ' + i);
    }
    throw new Error('function did not return');
  }
}
