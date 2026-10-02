/**
 * CameraCapture — the uploader's Camera button must not silently fall back to the file picker on
 * desktop. <input capture> is ignored by desktop browsers, so a fine-pointer device with
 * getUserMedia on a secure origin has to get the webcam dialog instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { pickCameraMode, cameraErrorKey } from '../src/components/media/CameraCapture.js';

test('desktop with getUserMedia on a secure origin uses the webcam dialog', () => {
  assert.equal(pickCameraMode({ coarsePointer: false, hasGetUserMedia: true, secureContext: true }), 'webcam');
});

test('touch devices keep the native camera app', () => {
  assert.equal(pickCameraMode({ coarsePointer: true, hasGetUserMedia: true, secureContext: true }), 'native');
});

test('no getUserMedia or an insecure origin falls back to the native input', () => {
  assert.equal(pickCameraMode({ coarsePointer: false, hasGetUserMedia: false, secureContext: true }), 'native');
  assert.equal(pickCameraMode({ coarsePointer: false, hasGetUserMedia: true, secureContext: false }), 'native');
  assert.equal(pickCameraMode(), 'native');
});

test('getUserMedia errors map to specific messages', () => {
  assert.equal(cameraErrorKey({ name: 'NotAllowedError' }), 'media.camera.error_denied');
  assert.equal(cameraErrorKey({ name: 'NotFoundError' }), 'media.camera.error_not_found');
  assert.equal(cameraErrorKey({ name: 'NotReadableError' }), 'media.camera.error_in_use');
  assert.equal(cameraErrorKey(new Error('boom')), 'media.camera.error_generic');
});

test('every camera string exists in both English and Bangla', () => {
  const en = enDict.media.camera;
  const bn = bnDict.media.camera;
  assert.deepEqual(Object.keys(bn).sort(), Object.keys(en).sort());
  for (const key of ['error_denied', 'error_not_found', 'error_in_use', 'error_generic']) {
    assert.ok(en[key] && bn[key], `media.camera.${key} missing`);
  }
});
