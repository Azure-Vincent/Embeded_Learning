// Pure, test-covered models behind the security widgets. Every model is a teaching abstraction of a
// well-known vulnerability CLASS and its countermeasure; parameters are illustrative, not a real device.
// Nothing here attacks real hardware. Each model is built so the learner can see the weakness and then
// watch the same procedure fail once the documented defence is switched on.

// ---------------------------------------------------------------------------
// Fixed-width integer arithmetic (integer-overflow widget)
// ---------------------------------------------------------------------------
export const WIDTHS = { u8: [8, false], u16: [16, false], u32: [32, false], i8: [8, true], i16: [16, true], i32: [32, true] };
export function wrap(value, type) {
  const [bits, signed] = WIDTHS[type];
  const mod = 2 ** bits;
  let v = ((value % mod) + mod) % mod;          // reduce to [0, 2^bits)
  if (signed && v >= mod / 2) v -= mod;         // reinterpret high half as negative
  return v;
}
export const asUnsigned = (value, type) => { const [bits] = WIDTHS[type]; const mod = 2 ** bits; return ((value % mod) + mod) % mod; };
/** The classic "offset + len" bounds check done in a narrow unsigned type. Returns what the DEVICE decides. */
export function lengthCheck(offset, len, bufSize, type = 'u16') {
  const sum = wrap(offset + len, type);         // wraps on a real device
  const accepted = sum <= bufSize;              // the naive check
  const bytesCopied = len;                      // memcpy uses the true len regardless
  return { sum, accepted, overflow: accepted && offset + len > bufSize, bytesCopied, wrote: accepted ? offset + len : 0 };
}
/** count * size for an allocation, with wraparound. */
export function allocSize(count, size, type = 'u32') {
  const product = wrap(count * size, type);
  return { product, allocated: product, needed: count * size, undersized: product < count * size };
}

// ---------------------------------------------------------------------------
// Adjacent-memory corruption (stack-smash widget). A descending stack holds, from low to high address:
// buf[0..n-1], a one-byte `authorized` flag, saved FP (4 bytes), return address (4 bytes).
// Writing more than n bytes into buf spills into the neighbours, exactly as on a real 32-bit target.
// ---------------------------------------------------------------------------
export function stackFrame(bufLen = 8) {
  // addresses are illustrative; layout order is what matters
  const base = 0x20001000;
  return {
    base, bufLen,
    regions: [
      { name: 'buf', addr: base, size: bufLen },
      { name: 'authorized', addr: base + bufLen, size: 1 },
      { name: 'saved_fp', addr: base + bufLen + 1, size: 4 },
      { name: 'return_addr', addr: base + bufLen + 5, size: 4 },
    ],
    total: bufLen + 9,
  };
}
/** Copy `input` bytes into the frame with NO bounds check and report what got clobbered. */
export function unsafeCopy(frame, input, { canary = false, bounds = false } = {}) {
  const mem = new Uint8Array(frame.total);
  const canaryVal = canary ? [0xde, 0xc0, 0xad, 0x0b] : null;
  // place a canary between buf and authorized when enabled (shifts neighbours up)
  const layout = canary
    ? stackFrameWithCanary(frame.bufLen)
    : frame;
  const buf = new Uint8Array(layout.total);
  const n = bounds ? Math.min(input.length, frame.bufLen) : input.length;
  let busFault = false;
  for (let i = 0; i < n; i++) {
    if (i >= buf.length) { busFault = true; break; }   // ran off the whole frame
    buf[i] = input[i] & 0xff;
  }
  const read = (name) => { const r = layout.regions.find((x) => x.name === name); if (!r) return null; const off = r.addr - layout.base; return Array.from(buf.slice(off, off + r.size)); };
  const authorized = (read('authorized') || [0])[0] !== 0;
  const retBytes = read('return_addr') || [0, 0, 0, 0];
  const retAddr = retBytes[0] | (retBytes[1] << 8) | (retBytes[2] << 16) | (retBytes[3] << 24); // little-endian
  const canaryBytes = canary ? read('canary') : null;
  const canaryIntact = !canary || (canaryBytes && canaryVal.every((b, i) => b === canaryBytes[i]));
  return {
    bytesWritten: n, overran: n > frame.bufLen, authorized, retAddr: retAddr >>> 0,
    canaryIntact, aborted: canary && !canaryIntact, boundsLimited: bounds && input.length > frame.bufLen,
    layout,
  };
}
function stackFrameWithCanary(bufLen) {
  const base = 0x20001000;
  return {
    base, bufLen,
    regions: [
      { name: 'buf', addr: base, size: bufLen },
      { name: 'canary', addr: base + bufLen, size: 4 },
      { name: 'authorized', addr: base + bufLen + 4, size: 1 },
      { name: 'saved_fp', addr: base + bufLen + 5, size: 4 },
      { name: 'return_addr', addr: base + bufLen + 9, size: 4 },
    ],
    total: bufLen + 13,
  };
}
export const UNLOCK_ADDR = 0x08000461, DENY_ADDR = 0x08000435; // illustrative function addresses (Thumb bit set)

// ---------------------------------------------------------------------------
// Timing side channel (timing-attack widget). A byte-by-byte compare that returns early leaks, through
// its run time, how many leading bytes matched. We model time as base + perByte*matches + noise.
// ---------------------------------------------------------------------------
export function compareTime(secret, guess, { constantTime = false, base = 100, perByte = 8, noise = 0, rng = Math.random } = {}) {
  let matches = 0, acc = 0;
  for (let i = 0; i < secret.length; i++) {
    const eq = guess[i] === secret[i];
    if (constantTime) { acc |= (guess[i] ^ (secret[i] ?? 0)); matches = secret.length; }  // always full scan
    else { if (!eq) break; matches++; }
  }
  const ok = constantTime ? (acc === 0 && guess.length === secret.length) : (matches === secret.length && guess.length === secret.length);
  const gauss = noise ? (rng() + rng() + rng() - 1.5) * noise : 0;
  const time = base + perByte * (constantTime ? secret.length : matches) + gauss;
  return { time, matches, ok };
}
/** Recover one secret byte at `position` (earlier bytes known) by measuring mean time per candidate. */
export function recoverByte(secret, known, position, opts = {}) {
  const samples = opts.samples || 30, candidates = opts.candidates || Array.from({ length: 10 }, (_, d) => d);
  const means = candidates.map((c) => {
    const guess = known.concat(c, new Array(secret.length - position - 1).fill(0));
    let sum = 0;
    for (let s = 0; s < samples; s++) sum += compareTime(secret, guess, opts).time;
    return { c, mean: sum / samples };
  });
  means.sort((a, b) => b.mean - a.mean);
  return { best: means[0].c, means, confident: means[0].mean - means[1].mean > (opts.perByte || 8) * 0.4 };
}

// ---------------------------------------------------------------------------
// Fault injection against a boot-time check (glitch-sim widget). The signature-verify branch runs in a
// narrow instruction window; a glitch landing in that window, with adequate width, may skip the branch.
// Outcomes and probabilities are INVENTED for teaching and labelled as such in the widget.
// ---------------------------------------------------------------------------
export function glitchAttempt(offset, width, { windowStart = 40, windowEnd = 52, defence = 'none', rng = Math.random } = {}) {
  const inWindow = offset >= windowStart && offset <= windowEnd;
  const widthOk = width >= 2 && width <= 8;
  let pGlitch = inWindow && widthOk ? 0.35 - Math.abs(offset - (windowStart + windowEnd) / 2) * 0.03 : 0.0;
  pGlitch = Math.max(0, pGlitch);
  const pBrown = width > 8 ? Math.min(0.9, (width - 8) * 0.15) : 0.02; // too wide -> brown-out reset
  const r = rng();
  if (r < pBrown) return { outcome: 'reset', booted: false, note: 'Brown-out reset: the glitch was too wide and the core reset cleanly.' };
  if (r < pBrown + pGlitch) {
    if (defence === 'double-check') { // both of two independent checks must be skipped
      return rng() < pGlitch ? { outcome: 'bypass', booted: true, note: 'Both redundant checks were skipped — defence defeated this time.' }
                             : { outcome: 'caught', booted: false, note: 'One check was skipped but the second, differently-encoded check still failed closed.' };
    }
    if (defence === 'random-delay') return { outcome: 'missed', booted: false, note: 'Jitter moved the vulnerable instruction; the glitch missed the window.' };
    return { outcome: 'bypass', booted: true, note: 'The verify branch was skipped — the unsigned image booted.' };
  }
  return { outcome: 'noeffect', booted: false, note: 'No effect: the check ran normally and rejected the image.' };
}
/** Sweep offset x width and return a success-rate grid for the heat map. */
export function glitchSweep(opts = {}, trials = 40) {
  const offsets = opts.offsets || Array.from({ length: 24 }, (_, i) => 28 + i);
  const widths = opts.widths || Array.from({ length: 12 }, (_, i) => i + 1);
  let rngState = 123456789;
  const rng = () => { rngState = (Math.imul(rngState, 1103515245) + 12345) >>> 0; return rngState / 2 ** 32; };
  return { offsets, widths, grid: widths.map((w) => offsets.map((o) => {
    let hits = 0; for (let t = 0; t < trials; t++) if (glitchAttempt(o, w, { ...opts, rng }).outcome === 'bypass') hits++;
    return hits / trials;
  })) };
}

// ---------------------------------------------------------------------------
// Rolling authentication (replay-attack widget). Pure logic; the widget wraps real HMAC via WebCrypto.
// ---------------------------------------------------------------------------
export function makeLock(defence = 'none') {
  return { defence, counter: 0, window: 16, usedNonces: new Set(), lastNonce: null };
}
/** Decide whether the lock accepts a message. `verifyMac` is supplied by the widget (true if the MAC is valid). */
export function lockAccept(lock, msg, verifyMac) {
  if (!verifyMac) return { accepted: false, reason: 'MAC invalid — message not authentic.' };
  if (lock.defence === 'none') return { accepted: true, reason: 'MAC valid. No freshness check, so a recorded message is accepted again.' };
  if (lock.defence === 'counter') {
    if (msg.counter > lock.counter && msg.counter <= lock.counter + lock.window) { lock.counter = msg.counter; return { accepted: true, reason: `Counter ${msg.counter} is ahead of ${lock.counter - (msg.counter - lock.counter)} and inside the window.` }; }
    return { accepted: false, reason: `Counter ${msg.counter} is not newer than the last accepted value — replay rejected.` };
  }
  if (lock.defence === 'nonce') {
    if (msg.nonce !== lock.lastNonce) return { accepted: false, reason: 'This response does not answer the current challenge nonce.' };
    lock.lastNonce = null; return { accepted: true, reason: 'The response is a MAC over the fresh nonce the lock just issued — replay cannot answer a new challenge.' };
  }
  return { accepted: false, reason: 'unknown defence' };
}

// ---------------------------------------------------------------------------
// Secure-boot chain of trust (secure-boot-chain widget). Each stage carries bytes, a signature validity
// flag (the widget computes the real SHA-256 for display; signature validity is modelled) and a version.
// ---------------------------------------------------------------------------
export function bootChain(stages, cfg) {
  // stages: [{name, tampered, signedWithWrongKey, version}], cfg: {secureBoot, antiRollback, minVersion}
  const log = [];
  for (const st of stages) {
    if (st.name !== 'ROM' && cfg.secureBoot) {
      if (st.tampered) { log.push({ stage: st.name, ok: false, msg: 'hash of image does not match the signed digest — stop.' }); return { booted: false, log, stoppedAt: st.name }; }
      if (st.signedWithWrongKey) { log.push({ stage: st.name, ok: false, msg: 'signature does not verify against the trusted public key — stop.' }); return { booted: false, log, stoppedAt: st.name }; }
    } else if (st.name !== 'ROM' && !cfg.secureBoot && (st.tampered || st.signedWithWrongKey)) {
      log.push({ stage: st.name, ok: true, msg: 'secure boot disabled: image accepted WITHOUT verification.' });
    }
    if (cfg.antiRollback && st.version != null && st.version < cfg.minVersion) {
      log.push({ stage: st.name, ok: false, msg: `version ${st.version} is below the anti-rollback minimum ${cfg.minVersion} — stop.` });
      return { booted: false, log, stoppedAt: st.name };
    }
    log.push({ stage: st.name, ok: true, msg: st.name === 'ROM' ? 'immutable boot ROM runs and checks the next stage.' : 'verified, executing.' });
  }
  return { booted: true, log, stoppedAt: null };
}
