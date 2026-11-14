import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/sim/attacks.js';

test('fixed-width wrap: unsigned and signed', () => {
  assert.equal(A.wrap(256, 'u8'), 0);
  assert.equal(A.wrap(255 + 1, 'u8'), 0);
  assert.equal(A.wrap(-1, 'u8'), 255);
  assert.equal(A.wrap(200 + 100, 'u8'), 44);
  assert.equal(A.wrap(128, 'i8'), -128);
  assert.equal(A.wrap(-129, 'i8'), 127);
  assert.equal(A.wrap(0x1_0000, 'u16'), 0);
  assert.equal(A.wrap(0xffffffff + 1, 'u32'), 0);
});

test('length check wraps and is bypassed', () => {
  // offset huge, len huge: 16-bit sum wraps below bufSize so the naive check passes
  const r = A.lengthCheck(0xfff0, 0x20, 64, 'u16');
  assert.equal(r.sum, A.wrap(0xfff0 + 0x20, 'u16'));
  assert.ok(r.accepted, 'wrapped sum passes the check');
  assert.ok(r.overflow, 'but the real copy overflows');
});

test('length check: honest values rejected when too big', () => {
  const r = A.lengthCheck(60, 60, 64, 'u16');
  assert.equal(r.sum, 120);
  assert.ok(!r.accepted);
});

test('alloc size multiply overflow', () => {
  const r = A.allocSize(0x1000000, 0x100, 'u32'); // 2^24 * 2^8 = 2^32 -> 0
  assert.equal(r.product, 0);
  assert.ok(r.undersized);
});

test('stack overflow flips adjacent flag', () => {
  const f = A.stackFrame(8);
  const input = new Uint8Array(9).fill(0x41); input[8] = 0x01; // one byte past buf -> authorized
  const r = A.unsafeCopy(f, input);
  assert.ok(r.overran);
  assert.ok(r.authorized, 'adjacent authorized byte set');
});

test('stack overflow overwrites return address, little-endian', () => {
  const f = A.stackFrame(8);
  const addr = A.UNLOCK_ADDR >>> 0;
  const input = new Uint8Array(8 + 1 + 4 + 4);
  input.fill(0x41, 0, 8 + 1 + 4); // fill buf, flag, saved fp
  input[13] = addr & 0xff; input[14] = (addr >> 8) & 0xff; input[15] = (addr >> 16) & 0xff; input[16] = (addr >> 24) & 0xff;
  const r = A.unsafeCopy(f, input);
  assert.equal(r.retAddr, addr);
});

test('canary aborts on overflow before return', () => {
  const f = A.stackFrame(8);
  const input = new Uint8Array(20).fill(0x41);
  const r = A.unsafeCopy(f, input, { canary: true });
  assert.ok(!r.canaryIntact);
  assert.ok(r.aborted, 'canary mismatch -> abort');
});

test('bounds-checked copy never overruns', () => {
  const f = A.stackFrame(8);
  const input = new Uint8Array(40).fill(0x41);
  const r = A.unsafeCopy(f, input, { bounds: true });
  assert.ok(!r.overran);
  assert.ok(!r.authorized);
  assert.ok(r.boundsLimited);
});

test('timing: early-exit compare leaks prefix length', () => {
  const secret = [1, 2, 3, 4, 5, 6];
  const t0 = A.compareTime(secret, [9, 0, 0, 0, 0, 0], { noise: 0 }).time;
  const t3 = A.compareTime(secret, [1, 2, 3, 9, 0, 0], { noise: 0 }).time;
  assert.ok(t3 > t0, 'more matching bytes take longer');
});

test('timing: constant-time removes the signal', () => {
  const secret = [1, 2, 3, 4, 5, 6];
  const t0 = A.compareTime(secret, [9, 0, 0, 0, 0, 0], { constantTime: true, noise: 0 }).time;
  const t3 = A.compareTime(secret, [1, 2, 3, 9, 0, 0], { constantTime: true, noise: 0 }).time;
  assert.equal(t0, t3);
});

test('timing: recover a byte without noise', () => {
  const secret = [3, 7, 1, 9, 4, 2];
  const r = A.recoverByte(secret, [], 0, { noise: 0, samples: 5 });
  assert.equal(r.best, 3);
  const r2 = A.recoverByte(secret, [3], 1, { noise: 0, samples: 5 });
  assert.equal(r2.best, 7);
});

test('glitch: no bypass outside the window', () => {
  const rng = () => 0.5;
  const r = A.glitchAttempt(5, 4, { rng });
  assert.equal(r.outcome, 'noeffect');
});

test('glitch: wide pulse causes brown-out reset', () => {
  const rng = () => 0.0;
  const r = A.glitchAttempt(46, 12, { rng });
  assert.equal(r.outcome, 'reset');
});

test('glitch sweep produces a grid with some success in the window', () => {
  const s = A.glitchSweep({ defence: 'none' }, 60);
  const flat = s.grid.flat();
  assert.ok(flat.some((x) => x > 0), 'some cells succeed');
  assert.ok(flat.every((x) => x >= 0 && x <= 1));
});

test('glitch: random-delay defence prevents bypass', () => {
  let hits = 0;
  let st = 1;
  const rng = () => { st = (Math.imul(st, 1103515245) + 12345) >>> 0; return st / 2 ** 32; };
  for (let i = 0; i < 500; i++) if (A.glitchAttempt(46, 4, { defence: 'random-delay', rng }).outcome === 'bypass') hits++;
  assert.equal(hits, 0);
});

test('replay: static message accepted twice without defence', () => {
  const lock = A.makeLock('none');
  assert.ok(A.lockAccept(lock, {}, true).accepted);
  assert.ok(A.lockAccept(lock, {}, true).accepted, 'replay works');
});

test('replay: counter rejects an old message', () => {
  const lock = A.makeLock('counter');
  assert.ok(A.lockAccept(lock, { counter: 5 }, true).accepted);
  assert.ok(!A.lockAccept(lock, { counter: 5 }, true).accepted, 'same counter replay rejected');
  assert.ok(A.lockAccept(lock, { counter: 6 }, true).accepted);
});

test('replay: nonce challenge-response', () => {
  const lock = A.makeLock('nonce');
  lock.lastNonce = 0xABCD;
  assert.ok(!A.lockAccept(lock, { nonce: 0x1111 }, true).accepted, 'wrong nonce rejected');
  lock.lastNonce = 0xABCD;
  assert.ok(A.lockAccept(lock, { nonce: 0xABCD }, true).accepted);
  assert.ok(!A.lockAccept(lock, { nonce: 0xABCD }, true).accepted, 'nonce consumed, replay fails');
});

test('replay: invalid MAC always rejected', () => {
  for (const d of ['none', 'counter', 'nonce']) assert.ok(!A.lockAccept(A.makeLock(d), { counter: 1, nonce: 1 }, false).accepted);
});

test('secure boot: tampered app stops when secure boot on', () => {
  const r = A.bootChain([{ name: 'ROM' }, { name: 'bootloader' }, { name: 'app', tampered: true }], { secureBoot: true });
  assert.ok(!r.booted);
  assert.equal(r.stoppedAt, 'app');
});

test('secure boot: unsigned image boots when disabled', () => {
  const r = A.bootChain([{ name: 'ROM' }, { name: 'bootloader' }, { name: 'app', tampered: true }], { secureBoot: false });
  assert.ok(r.booted);
});

test('secure boot: wrong key rejected', () => {
  const r = A.bootChain([{ name: 'ROM' }, { name: 'bootloader', signedWithWrongKey: true }], { secureBoot: true });
  assert.ok(!r.booted);
  assert.equal(r.stoppedAt, 'bootloader');
});

test('secure boot: anti-rollback refuses an old version', () => {
  const r = A.bootChain([{ name: 'ROM' }, { name: 'bootloader', version: 3 }, { name: 'app', version: 1 }], { secureBoot: true, antiRollback: true, minVersion: 2 });
  assert.ok(!r.booted);
  assert.equal(r.stoppedAt, 'app');
});
