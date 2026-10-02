/**
 * ImageUploader — the picker's `accept` attribute is only a hint, so drag-drop and paste could send
 * a PDF straight to the upload API. handleFiles has to reject unsupported types itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/media/ImageUploader.js', import.meta.url), 'utf8');

test('the allowed-type list covers exactly the formats the dropzone advertises', () => {
  const list = src.match(/ALLOWED_MEDIA_TYPES = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(list, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4']);
});

test('the file picker accept attribute is derived from the same list', () => {
  assert.match(src, /fileInput\.accept = ALLOWED_MEDIA_TYPES\.join\(','\)/);
});

test('handleFiles rejects an unsupported type before the size check and any upload', () => {
  const body = src.slice(src.indexOf('async function handleFiles'));
  const mime = body.indexOf('ALLOWED_MEDIA_TYPES.includes(file.type)');
  const size = body.indexOf('file.size > maxSize');
  const upload = body.indexOf('items.push(placeholder)');
  assert.ok(mime > -1, 'no MIME check in handleFiles');
  assert.ok(mime < size && size < upload, 'MIME check must run before size check and upload');
});
