// Tests for the pure logic of js/widgets/struct-layout.js. Run: node --test tests/struct-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOf } from '../js/sim/cinterp.js';

// The widget imports DOM helpers that only touch `document` when called, so importing it in node is safe.
const { byteMap, bestSize, paddingBytes, swapLines, reorderable, DEFAULT_SOURCE } = await import('../js/widgets/struct-layout.js');

test('default example: 16 bytes with 7 bytes of padding, best order is 12', () => {
  const s = layoutOf(DEFAULT_SOURCE).structs[0];
  assert.equal(s.name, 'sensor_reading'); assert.equal(s.size, 16); assert.equal(s.align, 4);
  assert.deepEqual(s.fields.map((f) => f.offset), [0, 4, 8, 10, 12]);
  assert.equal(paddingBytes(s), 7);
  assert.equal(bestSize(s.fields), 12);
});
test('byteMap marks each byte with its field or padding', () => {
  const s = layoutOf('struct a { char c; short s; int i; };').structs[0];
  assert.deepEqual(byteMap(s).map((c) => c.field), [0, -1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(byteMap(s).map((c) => c.first), [true, false, true, false, true, false, false, false]);
});
test('byteMap of a union shows the largest member', () => {
  const s = layoutOf('union u { uint8_t b[3]; uint16_t h; };').structs[0];
  assert.equal(s.size, 4);
  assert.deepEqual(byteMap(s).map((c) => c.field), [0, 0, 0, -1]);
});
test('swapLines moves a field and the layout shrinks', () => {
  let src = DEFAULT_SOURCE;
  const before = layoutOf(src).structs[0];
  assert.equal(reorderable(before), true);
  src = swapLines(src, before.fields[0].line, before.fields[1].line); // timestamp first
  const after = layoutOf(src).structs[0];
  assert.deepEqual(after.fields.map((f) => f.name), ['timestamp', 'id', 'flags', 'value', 'crc']);
  assert.equal(after.size, 12); assert.equal(after.size, bestSize(after.fields));
  assert.equal(swapLines('a\nb', 1, 5), 'a\nb');
});
test('fields sharing a line cannot be reordered by line swaps', () => {
  assert.equal(reorderable(layoutOf('struct p { int x, y; };').structs[0]), false);
  assert.equal(reorderable(layoutOf('union u {\n int x;\n char c;\n};').structs[0]), false);
});
test('packed layout removes all padding', () => {
  const s = layoutOf(DEFAULT_SOURCE, { packed: true }).structs[0];
  assert.equal(s.size, 9); assert.equal(paddingBytes(s), 0); assert.equal(s.packed, true);
});
test('8-byte members align to 8 and force tail padding', () => {
  const s = layoutOf('struct t { uint64_t big; uint8_t tag; };').structs[0];
  assert.equal(s.size, 16); assert.deepEqual(s.padding, [{ offset: 9, size: 7 }]);
  assert.equal(bestSize(s.fields), 16);
});
test('nested structs, arrays and pointers', () => {
  const r = layoutOf('struct in { uint16_t a; uint8_t b; };\ntypedef struct { uint8_t tag; struct in pair[2]; void *next; } outer_t;');
  assert.equal(r.structs.length, 2);
  const o = r.structs[1];
  assert.equal(o.name, 'outer_t');
  assert.deepEqual(o.fields.map((f) => [f.offset, f.size, f.align]), [[0, 1, 1], [2, 8, 2], [12, 4, 4]]);
  assert.equal(o.size, 16);
});
test('errors report a line', () => {
  const r = layoutOf('struct s {\n  uint8_t a;\n  unknown_t b;\n};');
  assert.equal(r.ok, false); assert.equal(r.error.line, 3);
});
