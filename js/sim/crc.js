// Integrity checks used by the packet tools. Bitwise reference implementations: slow, but each line maps onto
// the shift register a learner sees in the stepper. All functions take an array-like of byte values (0..255).

/** Additive checksum: sum of all bytes modulo 256. */
export function sum8(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + (b & 0xFF)) & 0xFF;
  return s;
}

/** XOR of all bytes (longitudinal redundancy check). */
export function xor8(bytes) {
  let x = 0;
  for (const b of bytes) x ^= b & 0xFF;
  return x;
}

export const CRC8_POLY = 0x07; // x^8 + x^2 + x + 1 (the x^8 term is the bit shifted out)

/** CRC-8 (poly 0x07, init 0x00, no reflection, no final XOR). Check value for "123456789" is 0xF4. */
export function crc8(bytes, init = 0x00) {
  let crc = init & 0xFF;
  for (const b of bytes) {
    crc ^= b & 0xFF;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ CRC8_POLY) & 0xFF : (crc << 1) & 0xFF;
  }
  return crc;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR). Check value 0x29B1. */
export function crc16ccitt(bytes, init = 0xFFFF) {
  let crc = init & 0xFFFF;
  for (const b of bytes) {
    crc ^= (b & 0xFF) << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

/** CRC-32 (IEEE 802.3: reflected poly 0xEDB88320, init and final XOR 0xFFFFFFFF). Check value 0xCBF43926. */
export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const b of bytes) {
    crc ^= b & 0xFF;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * CRC-8 one operation at a time, for visualisation. Each byte produces one 'load' step (register ^= byte) followed
 * by eight 'shift' steps. Every step records the register before and after, and for shifts the bit that fell out of
 * the top (`msb`) and whether the polynomial was XORed in (`xored`). The last step's `after` equals crc8(bytes).
 */
export function crc8Steps(bytes, init = 0x00) {
  const steps = [];
  let crc = init & 0xFF;
  bytes.forEach((raw, byteIndex) => {
    const byte = raw & 0xFF;
    const loaded = crc ^ byte;
    steps.push({ phase: 'load', byteIndex, byte, bit: -1, before: crc, after: loaded, msb: 0, xored: false });
    crc = loaded;
    for (let bit = 0; bit < 8; bit++) {
      const msb = (crc >> 7) & 1;
      const shifted = (crc << 1) & 0xFF;
      const after = msb ? shifted ^ CRC8_POLY : shifted;
      steps.push({ phase: 'shift', byteIndex, byte, bit, before: crc, shifted, after, msb, xored: !!msb });
      crc = after;
    }
  });
  return steps;
}

/** The checks a frame can carry. `size` is the number of check bytes on the wire (CRC-16 is sent high byte first). */
export const CHECKS = {
  none: { title: 'None', size: 0, fn: () => 0 },
  sum: { title: 'Additive checksum', size: 1, fn: sum8 },
  xor: { title: 'XOR (LRC)', size: 1, fn: xor8 },
  crc8: { title: 'CRC-8', size: 1, fn: crc8 },
  crc16: { title: 'CRC-16/CCITT-FALSE', size: 2, fn: crc16ccitt },
};

/** Check value as wire bytes, most significant first. */
export function checkBytes(kind, bytes) {
  const c = CHECKS[kind];
  if (!c || !c.size) return [];
  const v = c.fn(bytes);
  return c.size === 2 ? [(v >> 8) & 0xFF, v & 0xFF] : [v & 0xFF];
}
