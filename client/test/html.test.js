import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../src/services/html.js';

describe('escapeHtml', () => {
  it('neutralises markup and quote characters', () => {
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(escapeHtml(`it's & <b>`), 'it&#39;s &amp; &lt;b&gt;');
  });

  it('escapes the ampersand first so entities are not double-decoded', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  it('treats null and undefined as empty and stringifies numbers', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
  });

  it('leaves Bangla text untouched', () => {
    assert.equal(escapeHtml('নিষেধাজ্ঞা প্রত্যাহার'), 'নিষেধাজ্ঞা প্রত্যাহার');
  });
});
