import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeQr, rsRemainder, formatBits, qrSvgGroup } from '../src/lib/qr.ts';

// Level M parameters for the versions decoded below (ISO/IEC 18004 table 9).
const BLOCKS = { 1: [1, 10], 2: [1, 16], 3: [1, 26], 4: [2, 18], 5: [2, 24], 6: [4, 16] };

/** Modules that carry no data, derived independently of the encoder (versions 1–6). */
function functionMap(size, version) {
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // Finder + separator + format area: 9×9 top-left, 8 wide × 9 tall top-right, 9 wide × 8 tall bottom-left.
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) mark(x, y);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 8; x++) { mark(size - 1 - x, y); mark(y, size - 1 - x); }
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(c + dx, c + dy);
  }
  return fn;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** A minimal reader: format bits → mask, zigzag read, de-interleave, RS check, byte-mode payload. */
function decode(qr) {
  const { size, version, modules } = qr;
  let fmt = 0;
  for (let i = 0; i <= 5; i++) fmt |= (modules[i][8] ? 1 : 0) << i;
  fmt |= (modules[7][8] ? 1 : 0) << 6;
  fmt |= (modules[8][8] ? 1 : 0) << 7;
  fmt |= (modules[8][7] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) fmt |= (modules[8][14 - i] ? 1 : 0) << i;
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((m) => formatBits(m) === fmt);
  assert.notEqual(mask, undefined, 'format bits must be a valid level-M code');

  const fn = functionMap(size, version);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x]) bits.push(modules[y][x] !== MASKS[mask](x, y) ? 1 : 0);
      }
    }
  }
  const stream = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) stream.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const [numBlocks, eccLen] = BLOCKS[version];
  const blockLen = Math.floor(stream.length / numBlocks); // versions 1–6 at M have equal blocks
  const blocks = Array.from({ length: numBlocks }, () => []);
  for (let i = 0; i < numBlocks * blockLen; i++) blocks[i % numBlocks].push(stream[i]);
  const data = [];
  for (const block of blocks) {
    const dat = block.slice(0, blockLen - eccLen);
    assert.deepEqual(rsRemainder(dat, eccLen), block.slice(blockLen - eccLen), 'every block must carry valid ECC');
    data.push(...dat);
  }

  assert.equal(data[0] >> 4, 0b0100, 'byte mode');
  const len = ((data[0] & 0x0f) << 4) | (data[1] >> 4);
  const out = [];
  for (let i = 0; i < len; i++) out.push(((data[1 + i] & 0x0f) << 4) | (data[2 + i] >> 4));
  return new TextDecoder().decode(new Uint8Array(out));
}

describe('qr encoder', () => {
  it('computes the textbook Reed–Solomon codewords for HELLO WORLD at 1-M', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    assert.deepEqual(rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('round-trips a tracked short link through a reader', () => {
    for (const text of ['https://explooro.com/s/exp-jvx1i', 'http://localhost:3000/s/abc', 'x']) {
      assert.equal(decode(encodeQr(text)), text);
    }
  });

  it('round-trips multi-block versions and UTF-8 text', () => {
    const long = `https://explooro.com/store/priyo-collection?ref=${'a'.repeat(40)}`;
    const qr = encodeQr(long);
    assert.ok(qr.version >= 4, `expected a multi-block version, got ${qr.version}`);
    assert.equal(decode(qr), long);
    assert.equal(decode(encodeQr('শাড়ি')), 'শাড়ি');
  });

  it('picks the smallest version that fits', () => {
    assert.equal(encodeQr('https://explooro.com/s/exp-jvx1i').version, 3);
    assert.equal(encodeQr('a'.repeat(14)).size, 21);
  });

  it('refuses text beyond version 10 instead of drawing a broken code', () => {
    assert.throws(() => encodeQr('a'.repeat(300)), /QR_TOO_LONG/);
    assert.equal(qrSvgGroup('a'.repeat(300), 0, 0, 100), '');
    assert.equal(qrSvgGroup('', 0, 0, 100), '', 'no link yet must not print a QR of nothing');
  });
});
