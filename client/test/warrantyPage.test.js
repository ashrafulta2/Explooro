/**
 * warrantyPage.test.js — Invariant & Logic Unit Tests for Customer Digital Warranties.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('Digital Warranty Hub — Client Logic & Invariants', async (t) => {
  await t.test('1. Expiry Countdown & Progress Meter Invariants', () => {
    const now = Date.now();
    const startsAt = new Date(now - 30 * 86400000).toISOString(); // 30 days ago
    const expiresAt = new Date(now + 90 * 86400000).toISOString(); // 90 days from now

    const startsMs = new Date(startsAt).getTime();
    const expiresMs = new Date(expiresAt).getTime();
    const totalMs = expiresMs - startsMs; // 120 days total
    const remainingMs = Math.max(0, expiresMs - now);

    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const elapsedMs = Math.min(totalMs, Math.max(0, now - startsMs));
    const progressPercent = Math.round((elapsedMs / totalMs) * 100);

    assert.equal(remainingDays >= 89 && remainingDays <= 90, true, 'Remaining days computed correctly');
    assert.equal(progressPercent >= 24 && progressPercent <= 26, true, 'Progress is approx 25% (30 of 120 days elapsed)');
  });

  await t.test('2. Expired Warranty Flagging', () => {
    const now = Date.now();
    const pastExpiry = new Date(now - 10 * 86400000).toISOString(); // 10 days ago
    const remainingMs = Math.max(0, new Date(pastExpiry).getTime() - now);
    const isActive = remainingMs > 0;

    assert.equal(isActive, false, 'Card with past expiry date must evaluate to inactive');
    assert.equal(remainingMs, 0, 'Remaining time is clamped to 0');
  });

  await t.test('3. Search and Multi-Field Filtering Logic', () => {
    const mockCards = [
      {
        id: 1,
        ref: 'WAR-WALT-9910',
        serial_number: 'SN-WALT-2026-9910',
        product_title_en: 'Walton 43-inch Android Smart TV',
        product_title_bn: 'ওয়ালটন ৪৩-ইঞ্চি অ্যান্ড্রয়েড স্মার্ট টিভি',
        supplier_shop_name: 'Walton Official Store',
        is_active: true,
      },
      {
        id: 2,
        ref: 'WAR-RICE-4412',
        serial_number: 'SN-AGRO-2026-4412',
        product_title_en: 'Miniket Premium Rice 25kg Bag',
        product_title_bn: 'মিনিকেট প্রিমিয়াম চাল ২৫ কেজি ব্যাগ',
        supplier_shop_name: 'Bengal Agro Foods Ltd.',
        is_active: true,
      },
      {
        id: 3,
        ref: 'WAR-BLND-1045',
        serial_number: 'SN-MIY-2025-1045',
        product_title_en: 'Miyako 3-in-1 Heavy Duty Blender',
        product_title_bn: 'মিয়াকো ৩-ইন-১ হেভি ডিউটি ব্লেন্ডার',
        supplier_shop_name: 'Miyako Appliances',
        is_active: false,
      },
    ];

    // Filter by serial search query
    const serialMatch = mockCards.filter((c) =>
      c.serial_number.toLowerCase().includes('agro')
    );
    assert.equal(serialMatch.length, 1);
    assert.equal(serialMatch[0].id, 2);

    // Filter by Ref ID query
    const refMatch = mockCards.filter((c) =>
      c.ref.toLowerCase().includes('blnd')
    );
    assert.equal(refMatch.length, 1);
    assert.equal(refMatch[0].id, 3);

    // Filter by Bangla title
    const bnMatch = mockCards.filter((c) =>
      c.product_title_bn.includes('ওয়ালটন')
    );
    assert.equal(bnMatch.length, 1);
    assert.equal(bnMatch[0].id, 1);

    // Filter active vs expired
    const activeOnly = mockCards.filter((c) => c.is_active);
    const expiredOnly = mockCards.filter((c) => !c.is_active);
    assert.equal(activeOnly.length, 2);
    assert.equal(expiredOnly.length, 1);
  });

  await t.test('4. Sorting Invariants', () => {
    const list = [
      { id: 1, title: 'Zebra Lamp', expires_at: new Date(Date.now() + 100 * 86400000).toISOString(), starts_at: new Date(Date.now() - 50 * 86400000).toISOString() },
      { id: 2, title: 'Alpha Cooker', expires_at: new Date(Date.now() + 10 * 86400000).toISOString(), starts_at: new Date(Date.now() - 100 * 86400000).toISOString() },
      { id: 3, title: 'Beta Fan', expires_at: new Date(Date.now() + 50 * 86400000).toISOString(), starts_at: new Date(Date.now() - 10 * 86400000).toISOString() },
    ];

    // Sort by expiring soonest
    const expiringSoon = [...list].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime());
    assert.equal(expiringSoon[0].id, 2, 'ID 2 expires soonest (10d)');
    assert.equal(expiringSoon[1].id, 3, 'ID 3 expires next (50d)');
    assert.equal(expiringSoon[2].id, 1, 'ID 1 expires last (100d)');

    // Sort by title A-Z
    const byTitle = [...list].sort((a, b) => a.title.localeCompare(b.title));
    assert.equal(byTitle[0].title, 'Alpha Cooker');
    assert.equal(byTitle[1].title, 'Beta Fan');
    assert.equal(byTitle[2].title, 'Zebra Lamp');
  });

  await t.test('5. Claim Form Validation Rules', () => {
    const validateClaim = (issueDescription, preferredResolution) => {
      if (!issueDescription || issueDescription.trim().length < 10) {
        return { valid: false, error: 'MIN_CHARS_REQUIRED' };
      }
      const allowedResolutions = ['REPAIR', 'REPLACE', 'REFUND'];
      if (!allowedResolutions.includes(preferredResolution)) {
        return { valid: false, error: 'INVALID_RESOLUTION' };
      }
      return { valid: true };
    };

    assert.equal(validateClaim('Too short', 'REPAIR').valid, false);
    assert.equal(validateClaim('Screen backlight flickering on HDMI input', 'INVALID').valid, false);
    assert.equal(validateClaim('Screen backlight flickering on HDMI input', 'REPAIR').valid, true);
    assert.equal(validateClaim('Display panel broken upon courier arrival', 'REPLACE').valid, true);
  });
});
