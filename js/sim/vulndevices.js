// Intentionally vulnerable *fictional* devices for the `vuln-device` widget.
// Pure state machines, no DOM:  create(deviceId) -> { banner, send(line) -> outputText, solved, prompt, memory? }
// Nothing here talks to real hardware; every product, address and key is invented for teaching.

/* ---------- small synchronous SHA-256 / HMAC (the device models must be synchronous) ---------- */
const K256 = (() => {
  const k = []; let n = 2;
  while (k.length < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) k.push(Math.floor((Math.cbrt(n) % 1) * 4294967296) >>> 0);
    n++;
  }
  return k;
})();
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
export function sha256(msg) {
  const m = msg instanceof Uint8Array ? msg : textBytes(msg);
  const len = m.length, total = ((len + 9 + 63) >> 6) << 6;
  const b = new Uint8Array(total); b.set(m); b[len] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len << 3) >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer);
  H.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}
export function hmacSha256(key, msg) {
  let k = key instanceof Uint8Array ? key : textBytes(key);
  if (k.length > 64) k = sha256(k);
  const ip = new Uint8Array(64).fill(0x36), op = new Uint8Array(64).fill(0x5c);
  k.forEach((x, i) => { ip[i] ^= x; op[i] ^= x; });
  const m = msg instanceof Uint8Array ? msg : textBytes(msg);
  const inner = sha256(concat(ip, m));
  return sha256(concat(op, inner));
}
function textBytes(t) { const o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i) & 0xff; return o; }
function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
export const toHex = (bytes, sep = '') => Array.from(bytes, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(sep);
export function fromHex(text) {
  const t = String(text).replace(/0x/gi, '').replace(/[\s:,]/g, '');
  if (!t.length || t.length % 2 || /[^0-9a-f]/i.test(t)) return null;
  const o = new Uint8Array(t.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(t.substr(i * 2, 2), 16);
  return o;
}
const h8 = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
const h4 = (n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
/** 8 bytes per line so it stays readable on a narrow screen. */
export function hexdump(bytes, base = 0, perLine = 8) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    const row = Array.from(bytes.slice(i, i + perLine));
    lines.push(h8(base + i) + '  ' + row.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(perLine * 3 - 1) +
      '  ' + row.map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join(''));
  }
  return lines.join('\n');
}

/* ---------- flags ---------- */
const FLAGS = {
  'debug-backdoor': 'BENCH{factory_menu_left_in_release}',
  'hardcoded-pin': 'BENCH{one_firmware_one_pin_every_unit}',
  'format-leak': 'BENCH{never_pass_input_as_the_format}',
  'overflow-auth': 'BENCH{sixteen_bytes_then_is_admin}',
  'replay-fob': 'BENCH{a_mac_must_cover_the_counter}',
  'rollback-updater': 'BENCH{signed_is_not_the_same_as_current}',
  'weak-prng': 'BENCH{uptime_is_not_entropy}',
};
export function checkFlag(deviceId, text) {
  return !!FLAGS[deviceId] && String(text).trim() === FLAGS[deviceId];
}

/* ---------- weak-prng constants (shared with the widget's scratch calculator and the capture panel) ---------- */
export const LCG_A = 1103515245, LCG_C = 12345;
/** The nonce the weak-prng device issues when `auth` runs at `uptime` seconds. */
export function lcgNonce(uptime) { return (Math.imul(uptime >>> 0, LCG_A) + LCG_C) >>> 0; }
const PRNG_KEY = textBytes('vaultpad-service-key-7f1c');
const PRNG_CAPTURE_SEED = 287;
function prngResponse(nonce) {
  return toHex(hmacSha256(PRNG_KEY, new Uint8Array([nonce >>> 24, nonce >>> 16, nonce >>> 8, nonce])).slice(0, 8));
}

/* ---------- replay-fob constants ---------- */
const FOB_KEY = textBytes('gatelink-pairing-key-19a4'), FOB_ID = [0x3c, 0x7e];
const fobMac = (cmd) => hmacSha256(FOB_KEY, new Uint8Array([...FOB_ID, cmd])).slice(0, 4);

/* ---------- printf model for format-leak ---------- */
class Fault extends Error { constructor(addr) { super('fault'); this.addr = addr >>> 0; } }
/**
 * A faithful-enough printf: walks `format`, pulling one 32-bit word per conversion from argWord(n) (n = 1, 2, ...).
 * readStr(addr) returns the NUL-terminated bytes at addr or throws Fault. Supports %x %X %d %i %u %p %c %s %% ,
 * width, zero padding and positional %N$x. %n consumes an argument and writes nothing (this libc was built without it).
 */
export function formatPrintf(format, argWord, readStr) {
  let next = 1, out = '';
  const re = /%(?:(\d+)\$)?([-0 #+]*)(\d+)?(?:hh|h|ll|l|z)?([a-zA-Z%])/g;
  let last = 0, m;
  while ((m = re.exec(format))) {
    out += format.slice(last, m.index); last = re.lastIndex;
    const conv = m[4];
    if (conv === '%') { out += '%'; continue; }
    if (!'xXdiupcsn'.includes(conv)) { out += m[0]; continue; }
    const idx = m[1] ? Math.max(1, +m[1]) : next++;
    const w = argWord(idx) >>> 0;
    let t;
    if (conv === 'x') t = w.toString(16);
    else if (conv === 'X') t = w.toString(16).toUpperCase();
    else if (conv === 'd' || conv === 'i') t = String(w | 0);
    else if (conv === 'u') t = String(w);
    else if (conv === 'p') t = '0x' + w.toString(16).padStart(8, '0');
    else if (conv === 'c') t = printable([w & 0xff]);
    else if (conv === 's') t = printable(readStr(w));
    else t = '';
    const width = +(m[3] || 0), flags = m[2] || '';
    if (t.length < width) t = flags.includes('-') ? t.padEnd(width) : t.padStart(width, flags.includes('0') && conv !== 's' && conv !== 'c' ? '0' : ' ');
    out += t;
    if (out.length > 600) { out = out.slice(0, 600) + '…'; break; }
  }
  if (out.length <= 600) out += format.slice(last);
  return out;
}
const printable = (bytes) => Array.from(bytes, (x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '\\x' + x.toString(16).padStart(2, '0'))).join('');

/* ---------- device factories ---------- */
const split = (line) => { const i = line.search(/\s/); return i < 0 ? [line, ''] : [line.slice(0, i), line.slice(i + 1).trim()]; };
const unknown = (cmd) => `unknown command '${cmd}' (try 'help')`;

const FACTORIES = {
  'debug-backdoor'() {
    const banner = 'Thermo-7 room thermostat  fw 2.4.1 (release)\nservice console, 115200 8N1\ntype \'help\'';
    let target = 21.0;
    const nvs = new Uint8Array(96).fill(0xff);
    const put = (off, t) => { nvs.set(textBytes(t), off); nvs[off + t.length] = 0; };
    put(0, 'NVS1'); put(8, 'ssid=WORKSHOP-2G'); put(28, 'psk=correct-horse-7'); put(52, 'tok=' + FLAGS['debug-backdoor']);
    const flash = new Uint8Array([0x00, 0x80, 0x00, 0x20, 0xc1, 0x01, 0x00, 0x08, 0x15, 0x02, 0x00, 0x08, 0x17, 0x02, 0x00, 0x08,
      0x19, 0x02, 0x00, 0x08, 0x1b, 0x02, 0x00, 0x08, 0x1d, 0x02, 0x00, 0x08, 0, 0, 0, 0]);
    const ram = new Uint8Array(32); ram.set([0x34, 0x08, 0, 0, 0xd2, 0, 0, 0, 0x01]);
    const regions = { flash: [0x08000000, flash], ram: [0x20000000, ram], nvs: [0x0803f000, nvs] };
    return {
      banner,
      send(line) {
        const [cmd, arg] = split(line);
        switch (cmd) {
          case 'help':
            return 'commands:\n  help      this list\n  status    current readings\n  set <c>   set target temperature (10-30)\n  version   firmware version\n  reboot    restart' +
              (arg === '-a' ? '\nhidden (factory):\n  debug     manufacturing test menu  [TODO: strip before release]' : '');
          case 'status': return `room 20.5 C  target ${target.toFixed(1)} C  heat ${target > 20.5 ? 'ON' : 'off'}  wifi connected`;
          case 'set': { const v = parseFloat(arg); if (!(v >= 10 && v <= 30)) return 'usage: set <10..30>'; target = v; return `target ${v.toFixed(1)} C`; }
          case 'version': return 'Thermo-7 fw 2.4.1 (release) built with MFG_TEST=1';
          case 'reboot': target = 21.0; return 'rebooting...\n\n' + banner;
          case 'debug': {
            const [sub, a2] = split(arg);
            if (sub === 'regions') return 'name   base        size   contents\nflash  0x08000000  256K   code\nram    0x20000000  32K    data\nnvs    0x0803F000  4K     settings, wifi credentials, cloud token';
            if (sub === 'dump') {
              const r = regions[a2];
              if (!r) return 'usage: debug dump <flash|ram|nvs>';
              return `${a2} @ 0x${h8(r[0])} (first ${r[1].length} bytes)\n` + hexdump(r[1], r[0]);
            }
            return 'mfg test menu\n  debug regions        list memory regions\n  debug dump <region>  hex dump the start of a region';
          }
          default: return unknown(cmd);
        }
      },
    };
  },

  'hardcoded-pin'() {
    const banner = 'KeyNest K8 key cabinet  fw 1.6.0\nservice port - installer access requires the admin PIN\ntype \'help\'';
    let admin = false, left = 3; // attempt counter is kept in flash: a reboot does not reset it
    return {
      banner,
      send(line) {
        const [cmd, arg] = split(line);
        switch (cmd) {
          case 'help': return 'commands:\n  help          this list\n  status        cabinet state\n  login <pin>   installer login (6 digits)\n  audit         service record (installer only)\n  open <slot>   release a key slot 1-8 (installer only)\n  logout\n  reboot';
          case 'status': return `8 slots, 8 keys present, door closed\nsession: ${admin ? 'installer' : 'none'}   PIN attempts left: ${left}`;
          case 'login':
            if (left <= 0) return 'LOCKED: too many wrong PINs. Factory service required.';
            if (!/^\d{6}$/.test(arg)) return 'usage: login <6-digit pin>';
            if (arg === '731946') { admin = true; left = 3; return 'PIN OK - installer session open'; }
            left--; return left > 0 ? `PIN wrong (${left} left)` : 'PIN wrong\nLOCKED: too many wrong PINs. Factory service required.';
          case 'audit':
            if (!admin) return 'denied: installer login required';
            return 'service record\n  unit serial   K8-004417\n  installed     2024-01-17\n  cloud enrol   ' + FLAGS['hardcoded-pin'];
          case 'open':
            if (!admin) return 'denied: installer login required';
            return /^[1-8]$/.test(arg) ? `slot ${arg} released` : 'usage: open <1..8>';
          case 'logout': admin = false; return 'session closed';
          case 'reboot': admin = false; return 'rebooting...\n\n' + banner + (left <= 0 ? '\nLOCKED' : '');
          default: return unknown(cmd);
        }
      },
    };
  },

  'format-leak'() {
    const banner = 'BadgeTag B2 e-ink name badge  fw 0.9.3\nUSB serial console\ntype \'help\'';
    const RAM = 0x20000000, RAM_SIZE = 0x2000, ROD = 0x08004000, SP = 0x20001f80, BUF = SP + 8, TOKEN = 0x20000410;
    const ram = new Uint8Array(RAM_SIZE), rod = new Uint8Array(64);
    const dv = new DataView(ram.buffer);
    const puts = (mem, off, t) => { mem.set(textBytes(t), off); mem[off + t.length] = 0; };
    puts(rod, 0, 'name set: '); puts(rod, 16, 'BadgeTag B2'); puts(rod, 32, 'fw 0.9.3');
    let name = 'unnamed';
    const init = () => {
      ram.fill(0); name = 'unnamed';
      puts(ram, 0x400, 'B2-00417'); puts(ram, 0x410, FLAGS['format-leak']);
      dv.setUint32(SP - RAM, TOKEN, true);            // const char *svc_token   (local of cmd_name)
      dv.setUint32(SP - RAM + 4, 0, true);            // size_t len
      dv.setUint32(SP - RAM + 72, 0, true);           // saved r4
      dv.setUint32(SP - RAM + 76, 0x20001fe0, true);  // saved r7
      dv.setUint32(SP - RAM + 80, 0x08000a41, true);  // saved lr (return into the command loop)
    };
    init();
    const read8 = (addr) => {
      if (addr >= RAM && addr < RAM + RAM_SIZE) return ram[addr - RAM];
      if (addr >= ROD && addr < ROD + rod.length) return rod[addr - ROD];
      throw new Fault(addr);
    };
    const readStr = (addr) => { const o = []; for (let i = 0; i < 96; i++) { const b = read8(addr + i); if (!b) break; o.push(b); } return o; };
    return {
      banner,
      send(line) {
        const [cmd] = split(line);
        const arg = line.slice(cmd.length).replace(/^\s/, '');
        switch (cmd) {
          case 'help': return 'commands:\n  help          this list\n  name <text>   set the name shown on the badge\n  show          print the current name\n  version\n  reboot';
          case 'show': return 'name: ' + name;
          case 'version': return 'BadgeTag B2 fw 0.9.3, serial B2-00417';
          case 'reboot': init(); return 'rebooting...\n\n' + banner;
          case 'name': {
            if (!arg) return 'usage: name <text>';
            const text = arg.slice(0, 63), bytes = textBytes(text);
            ram.fill(0, BUF - RAM, BUF - RAM + 64); ram.set(bytes, BUF - RAM);
            dv.setUint32(SP - RAM + 4, bytes.length, true);
            const regs = [BUF, bytes.length, ROD]; // r1, r2, r3 as cmd_name left them
            const argWord = (n) => {
              if (n <= 3) return regs[n - 1];
              const addr = SP + 4 * (n - 4);
              if (addr + 4 > RAM + RAM_SIZE) throw new Fault(addr);
              return dv.getUint32(addr - RAM, true);
            };
            try {
              const out = formatPrintf(text, argWord, readStr);
              name = text;
              return 'name set: ' + out;
            } catch (e) {
              if (!(e instanceof Fault)) throw e;
              init();
              return `name set: \n*** HardFault (BusFault, BFAR=0x${h8(e.addr)}) in vfprintf\nrebooting...\n\n` + banner;
            }
          }
          default: return unknown(cmd);
        }
      },
    };
  },

  'overflow-auth'() {
    const banner = 'ColdLog C3 vaccine fridge logger  fw 3.1.0\nmaintenance console\ntype \'help\'';
    const BASE = 0x20000100, HANDLER = 0x08001c35;
    const mem = new Uint8Array(32); const dv = new DataView(mem.buffer);
    let touched = false;
    const init = () => { mem.fill(0); mem.set(textBytes('none'), 0); dv.setUint32(20, 0x5a17c0de, true); dv.setUint32(24, HANDLER, true); };
    init();
    const user = () => { const o = []; for (let i = 0; i < mem.length && mem[i]; i++) o.push(mem[i]); return printable(o); };
    return {
      banner,
      memory: () => ({ base: BASE, bytes: mem.slice(), touched,
        fields: [{ name: 'char user[16]', off: 0, len: 16 }, { name: 'uint8_t is_admin', off: 16, len: 1 }, { name: 'uint8_t fails', off: 17, len: 1 },
          { name: '(padding)', off: 18, len: 2 }, { name: 'uint32_t session_id', off: 20, len: 4 }, { name: 'void (*on_logout)(void)', off: 24, len: 4 }] }),
      send(line) {
        const [cmd, arg] = split(line);
        switch (cmd) {
          case 'help': return 'commands:\n  help                    this list\n  login <user> [password] guest users need no password; \'admin\' does\n  whoami                  current session\n  readings                last temperatures\n  export-keys             cloud upload credentials (admin only)\n  logout\n  reboot';
          case 'login': {
            const [u, pw] = split(arg);
            if (!u) return 'usage: login <user> [password]';
            const bytes = textBytes(u);
            touched = true;
            mem[16] = 0;                                   // session.is_admin = 0;
            for (let i = 0; i <= bytes.length; i++) {      // strcpy(session.user, arg);   <- no bound
              if (i < mem.length) mem[i] = i < bytes.length ? bytes[i] : 0;
            }
            if (bytes.length >= 24) {                      // the copy reached the function pointer
              const pc = dv.getUint32(24, true);
              init();
              return `*** HardFault: tried to execute 0x${h8(pc)} (pc loaded from session.on_logout)\nrebooting...\n\n` + banner;
            }
            if (u === 'admin') {
              mem[17]++;
              return pw ? 'admin password incorrect' : 'admin requires a password';
            }
            return `logged in as ${user()} (${mem[16] ? 'admin' : 'guest'})`;
          }
          case 'whoami': return `user: ${user()}   role: ${mem[16] ? 'admin' : 'guest'}   is_admin byte: ${touched && mem[16] ? 'non-zero' : '0'}`;
          case 'readings': return '4.1 C  4.0 C  4.3 C  4.2 C   (2-8 C window: ok)';
          case 'export-keys':
            if (!mem[16]) return 'denied: admin only';
            return 'cloud upload credentials\n  endpoint  coldlog.example/ingest\n  api_key   ' + FLAGS['overflow-auth'];
          case 'logout': mem.fill(0, 0, 18); mem.set(textBytes('none'), 0); return 'logged out';
          case 'reboot': init(); return 'rebooting...\n\n' + banner;
          default: return unknown(cmd);
        }
      },
    };
  },

  'replay-fob'() {
    const banner = 'RF bench tool attached to your SDR, tuned to the GateLink G3 remote channel.\nThe receiver\'s status UART is also connected.\nreceiver: GateLink G3  fw 1.0\ntype \'help\'';
    let fw = 1, ctr = 0x0040, last = 0x0040;
    const frameV1 = () => new Uint8Array([0xaa, ...FOB_ID, 0x01, ...fobMac(0x01)]);
    const frameV2 = (c) => new Uint8Array([0xaa, ...FOB_ID, 0x01, c >> 8, c & 0xff, ...fobMac(0x01)]);
    return {
      banner,
      send(line) {
        const [cmd, arg] = split(line);
        switch (cmd) {
          case 'help': return 'commands:\n  help         this list\n  sniff        wait for the owner to press the remote and record the frame\n  send <hex>   transmit a frame\n  status       read the receiver\'s status UART\n  format       frame layout from the product manual';
          case 'format':
            return fw === 1
              ? 'fw 1.0 frame, 8 bytes:\n  AA | id[2] | cmd[1] | mac[4]\n  cmd 01 = open. mac = first 4 bytes of HMAC-SHA-256 with the pairing key.'
              : 'fw 2.0 frame, 10 bytes:\n  AA | id[2] | cmd[1] | ctr[2, big-endian] | mac[4]\n  cmd 01 = open. The receiver only accepts a counter greater than the last one it accepted.';
          case 'status':
            return fw === 1 ? 'receiver fw 1.0   gate closed   paired remotes: 1 (id 3C7E)'
              : `receiver fw 2.0   gate closed   paired remotes: 1 (id 3C7E)\nlast accepted counter 0x${h4(last)}   will accept 0x${h4(last + 1)}..0x${h4(last + 0x100)}`;
          case 'sniff':
            if (fw === 1) return 'owner pressed the remote. gate opened and closed again.\ncaptured: ' + toHex(frameV1(), ' ');
            ctr++; last = ctr;
            return 'owner pressed the remote. gate opened and closed again.\ncaptured: ' + toHex(frameV2(ctr), ' ');
          case 'send': {
            const f = fromHex(arg);
            if (!f) return 'usage: send <hex bytes>, e.g. send AA 01 02';
            const want = fw === 1 ? 8 : 10;
            if (f.length !== want) return `receiver: dropped, frame is ${f.length} bytes, expected ${want}`;
            if (f[0] !== 0xaa) return 'receiver: dropped, no preamble';
            if (f[1] !== FOB_ID[0] || f[2] !== FOB_ID[1]) return 'receiver: dropped, unknown remote id';
            const mac = fobMac(f[3]), got = f.slice(want - 4);
            if (!mac.every((x, i) => x === got[i])) return 'receiver: rejected, MAC mismatch';
            if (f[3] !== 0x01) return 'receiver: rejected, unknown command';
            if (fw === 1) {
              fw = 2; ctr = 0x0040; last = 0x0040;
              return 'receiver: MAC ok -> GATE OPEN\n\nStage 1 done: a recorded frame is valid forever.\nThe vendor responds with firmware 2.0, which adds a rolling counter. The receiver and remote have been updated.\nreceiver: GateLink G3  fw 2.0\nRun \'format\' and \'sniff\' again.';
            }
            const c = (f[4] << 8) | f[5];
            if (c <= last || c > last + 0x100) return `receiver: rejected, counter 0x${h4(c)} outside the accepted window`;
            last = c; if (c > ctr) ctr = c;
            return 'receiver: MAC ok, counter ok -> GATE OPEN\nreceiver log: installer token ' + FLAGS['replay-fob'];
          }
          default: return unknown(cmd);
        }
      },
    };
  },

  'rollback-updater'() {
    const CAT = {
      'p4-1.0.3.bin': { ver: '1.0.3', date: '2022-03-02', sig: 'valid', notes: 'Initial release.' },
      'p4-1.2.0.bin': { ver: '1.2.0', date: '2023-06-19', sig: 'valid', notes: 'Security: removed the factory \'diag\' console command, which printed the device key store (advisory PSA-2023-01).\nAll units should update.' },
      'p4-1.4.2.bin': { ver: '1.4.2', date: '2024-09-30', sig: 'valid', notes: 'Flow sensor calibration fixes. Installed on this unit.' },
      'p4-1.5.0-rc1.bin': { ver: '1.5.0-rc1', date: '2024-11-11', sig: 'test key', notes: 'Release candidate, signed with the engineering test key. Not for field units.' },
      'custom.bin': { ver: '9.9.9', date: 'today', sig: 'none', notes: 'An image you built yourself. You do not have the vendor signing key.' },
    };
    let ver = '1.4.2';
    const bannerFor = () => `PumpCtl P4 irrigation controller  fw ${ver}\nlocal service console\ntype 'help'`;
    const hasDiag = () => ver === '1.0.3';
    return {
      banner: bannerFor(),
      send(line) {
        const [cmd, arg] = split(line);
        switch (cmd) {
          case 'help': return 'commands:\n  help             this list\n  version          running firmware\n  catalog          images on the update server\n  notes <image>    release notes\n  update <image>   download, verify signature, install\n  status           pump state\n  reboot' + (hasDiag() ? '\n  diag             factory diagnostics' : '');
          case 'version': return `fw ${ver}   bootloader 1.0   update key: vendor ECDSA P-256 key #1`;
          case 'status': return 'pump off   zone valves closed   next run 06:00';
          case 'catalog': return 'image              version     released\n' + Object.entries(CAT).map(([n, c]) => n.padEnd(19) + c.ver.padEnd(12) + c.date).join('\n');
          case 'notes': return CAT[arg] ? `${arg} (${CAT[arg].ver})\n${CAT[arg].notes}` : 'usage: notes <image>   (see \'catalog\')';
          case 'update': {
            const c = CAT[arg];
            if (!c) return 'usage: update <image>   (see \'catalog\')';
            let o = `downloading ${arg} ... done\nverifying signature with vendor key #1 ... `;
            if (c.sig !== 'valid') return o + (c.sig === 'none' ? 'FAILED (no signature)' : 'FAILED (signed by an unknown key)') + '\nupdate rejected, still running ' + ver;
            ver = c.ver;
            return o + 'OK\nwriting flash ... done\nrebooting...\n\n' + bannerFor();
          }
          case 'reboot': return 'rebooting...\n\n' + bannerFor();
          case 'diag': {
            if (!hasDiag()) return unknown(cmd);
            if (arg === 'keys') return 'key store\n  slot 0  cloud identity   ' + FLAGS['rollback-updater'] + '\n  slot 1  (empty)';
            if (arg === 'sensors') return 'flow 0.0 l/min   pressure 2.1 bar   soil 41 %';
            return 'factory diagnostics\n  diag sensors   raw sensor values\n  diag keys      print the key store';
          }
          default: return unknown(cmd);
        }
      },
    };
  },

  'weak-prng'() {
    const banner = 'VaultPad V2 safe keypad  fw 4.0.2\nservice port: challenge-response authentication\ntype \'help\'';
    let t = 2, pending = null, lockUntil = 0;
    const stamp = (s) => `[up ${String(s).padStart(4, '0')} s] `;
    return {
      banner,
      get prompt() { return `t=${t}s> `; },
      send(line) {
        const [cmd, arg] = split(line);
        const now = t; t += 1; // every command takes one second of device uptime
        switch (cmd) {
          case 'help': return 'commands:\n  help         this list\n  uptime       seconds since boot\n  auth         request a challenge\n  resp <hex>   answer the outstanding challenge (8 bytes)\n  wait <s>     do nothing for s seconds\n  reboot       power-cycle (uptime restarts)\nevery command takes one second.';
          case 'uptime': return stamp(now) + 'uptime ' + now + ' s';
          case 'wait': {
            const n = parseInt(arg, 10);
            if (!(n >= 1 && n <= 3600)) { return 'usage: wait <1..3600>'; }
            t = now + n; return `... ${n} s pass. uptime is now ${t} s`;
          }
          case 'auth':
            if (now < lockUntil) return stamp(now) + `service port locked for another ${lockUntil - now} s`;
            pending = lcgNonce(now);
            return stamp(now) + 'challenge: ' + h8(pending) + '\nanswer with: resp <first 8 bytes of HMAC-SHA-256(service key, challenge)>';
          case 'resp': {
            if (pending == null) return stamp(now) + 'no challenge outstanding (run \'auth\')';
            const r = fromHex(arg), want = prngResponse(pending);
            pending = null;
            if (!r || r.length !== 8) return stamp(now) + 'malformed response (need 8 bytes). challenge discarded.';
            if (toHex(r) !== want) { lockUntil = now + 30; return stamp(now) + 'response wrong. service port locked for 30 s.'; }
            return stamp(now) + 'service access granted\nmaster reset code: ' + FLAGS['weak-prng'];
          }
          case 'reboot': t = 2; pending = null; lockUntil = 0; return 'rebooting...\n\n' + banner;
          default: return unknown(cmd);
        }
      },
    };
  },
};

/** Build a fresh device. `solved` turns true once the flag has appeared on its console. */
export function create(deviceId) {
  const f = FACTORIES[deviceId];
  if (!f) throw new Error(`unknown device "${deviceId}"`);
  const d = f();
  let solved = false;
  return {
    id: deviceId,
    banner: d.banner,
    get solved() { return solved; },
    get prompt() { return d.prompt || '> '; },
    memory: d.memory ? () => d.memory() : null,
    send(line) {
      const clean = String(line).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
      if (!clean) return '';
      const out = d.send(clean);
      if (out.includes(FLAGS[deviceId])) solved = true;
      return out;
    },
  };
}

/* ---------- briefing, side panels, hints and debrief for each device ---------- */
const captureNonce = lcgNonce(PRNG_CAPTURE_SEED);
export const DEVICES = {
  'debug-backdoor': {
    title: 'Thermostat with a factory menu', product: 'Thermo-7 room thermostat', level: 1, difficulty: 'Starter',
    briefing: 'A Wi-Fi thermostat with a service UART on a 4-pin header inside the case. Your team has been hired to assess it; you may use the console in any way. Firmware extraction has already been done for you: a strings dump is on the right.',
    goal: 'Obtain the cloud token stored on the device. It has the form BENCH{...}.',
    panels: [{ title: 'strings thermo7-2.4.1.bin (excerpt)', text: 'Thermo-7 room thermostat\nfw 2.4.1 (release)\nroom %d.%d C  target %d.%d C\nusage: set <10..30>\nhelp -a\nhidden (factory):\nmfg test menu\ndebug regions\ndebug dump <region>\nnvs\nssid=\npsk=\ntok=\nMFG_TEST=1' }],
    hints: ['Start by learning what the console offers. Then compare that list with the strings dump: is there text in the firmware that the normal help never printed?',
      'The strings dump contains `help -a` and `debug`. A command that is not in the help is still a command.',
      'Run `debug regions` and look at what each region is said to contain, then dump the one that holds settings.'],
    debrief: {
      what: 'A manufacturing test command was compiled into the release firmware. Hiding it from `help` did not remove it.',
      how: 'Factories need a way to read and write memory to test and provision boards. The convenient way is a console command behind a build flag. If the release build keeps the flag set, every shipped unit carries a memory-dump tool on its UART.',
      exploit: 'You found the command name in the strings dump (or via `help -a`), listed the regions, and dumped the settings region, which stored the Wi-Fi passphrase and cloud token in plain text.',
      detect: 'Run `strings` on the release image and review every command name; diff the command tables of the factory and release builds; fuzz the console with a word list in pre-release testing.',
      defend: 'Compile factory code out of release builds rather than hiding it, and fail the build if it is present. Keep secrets out of plain storage: use the chip\'s protected key storage if it has one. Disable or authenticate the service console in the field.',
      verify: 'A CI check that greps the release binary for factory strings and fails on a match; a test that sends every factory command to a release build and expects "unknown command"; a readout of the settings region showing no plain-text secrets.',
      code: '/* Factory commands exist only in factory builds. */\n#if defined(MFG_TEST) && defined(RELEASE_BUILD)\n#error "MFG_TEST must not be set in a release build"\n#endif\n\nstatic const struct cmd commands[] = {\n    { "help",   cmd_help   },\n    { "status", cmd_status },\n#ifdef MFG_TEST\n    { "debug",  cmd_debug  },   /* never reaches a release image */\n#endif\n};',
    },
  },
  'hardcoded-pin': {
    title: 'Key cabinet with one PIN for every unit', product: 'KeyNest K8 key cabinet', level: 1, difficulty: 'Starter' },
  // NOTE: briefing / panels / hints / debrief for the devices below are not written yet (see the builder's report).
  'format-leak': { title: 'Name badge that formats its input', product: 'BadgeTag B2 e-ink name badge', level: 2, difficulty: 'Intermediate' },
  'overflow-auth': { title: 'Fridge logger with an unbounded login', product: 'ColdLog C3 fridge logger', level: 3, difficulty: 'Intermediate' },
  'replay-fob': { title: 'Gate remote and a rolling counter', product: 'GateLink G3 gate receiver', level: 3, difficulty: 'Intermediate' },
  'rollback-updater': { title: 'Updater that accepts old firmware', product: 'PumpCtl P4 irrigation controller', level: 4, difficulty: 'Advanced' },
  'weak-prng': { title: 'Keypad with predictable challenges', product: 'VaultPad V2 safe keypad', level: 5, difficulty: 'Advanced' },
};
export const PRNG_CAPTURE = { nonce: captureNonce };