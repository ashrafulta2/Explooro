/**
 * zip.test.js — the hand-written ZIP writer behind the Flyer Studio's bulk download (lib/zip.ts).
 *
 * A broken archive fails silently for the person who downloads it ("the file is damaged"), so the
 * archive is read back here by an independent reader written from the format spec — not by the
 * writer's own code — and every byte, name and checksum is compared.
 *
 * Runs on node:test; no test-runner dependency is added to the client.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32, zipBytes } from '../src/lib/zip.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Reads a stored-only ZIP from its end-of-central-directory record, as unzip tools do. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'end of central directory signature');
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  let p = view.getUint32(eocd + 16, true);
  assert.equal(p + cdSize, eocd, 'central directory ends where the end record starts');
  const out = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(view.getUint32(p, true), 0x02014b50, 'central header signature');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50, 'local header signature');
    assert.equal(view.getUint32(local + 14, true), crc, 'local and central CRC agree');
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    out.push({ name, flags, method, crc, data: bytes.slice(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('every entry reads back byte for byte, with a correct checksum', () => {
  const png = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
  const files = [
    { name: '01-jamdani-saree-square.png', data: png },
    { name: 'captions.txt', data: enc.encode('Eid Mubarak! https://explooro.com/s/AB12\n') },
    { name: 'empty.txt', data: new Uint8Array() },
  ];
  const read = readZip(zipBytes(files));
  assert.deepEqual(read.map((e) => e.name), files.map((f) => f.name));
  read.forEach((entry, i) => {
    assert.equal(entry.method, 0, 'stored');
    assert.deepEqual(entry.data, files[i].data);
    assert.equal(entry.crc, crc32(files[i].data));
  });
});

test('Bangla file names are stored as UTF-8 and flagged so', () => {
  const [entry] = readZip(zipBytes([{ name: '০১-জামদানি-শাড়ি.png', data: new Uint8Array([1, 2, 3]) }]));
  assert.equal(entry.name, '০১-জামদানি-শাড়ি.png');
  assert.equal(entry.flags & 0x0800, 0x0800);
});

test('an empty archive is still a valid archive', () => {
  assert.deepEqual(readZip(zipBytes([])), []);
});
