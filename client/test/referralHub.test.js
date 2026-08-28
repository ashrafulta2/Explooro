/**
 * referralHub.test.js — Invariants & logic tests for Referral & Growth Hub (Prompt 9.3 & 11.3).
 *
 * Runs via node:test without adding any npm dependencies to the client.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('Referral Hub — Client Logic & Invariants', () => {

  describe('1. 2-Tier Referral Calculator Invariants', () => {
    function computeReferralEarnings(friends, spend) {
      const directEarn = friends * spend * 0.05;
      const subFriends = Math.round(friends * 1.5);
      const subEarn = subFriends * spend * 0.02;
      const totalCash = Math.round(directEarn + subEarn);
      const totalCoins = friends * 100;
      return { directEarn, subFriends, subEarn, totalCash, totalCoins };
    }

    test('Standard scenario: 10 friends spending ৳4,000 monthly', () => {
      const res = computeReferralEarnings(10, 4000);
      assert.equal(res.directEarn, 2000, 'Tier 1 direct: 10 * ৳4,000 * 5% = ৳2,000');
      assert.equal(res.subFriends, 15, 'Tier 2 sub-network estimate: 10 * 1.5 = 15 friends');
      assert.equal(res.subEarn, 1200, 'Tier 2 sub-network: 15 * ৳4,000 * 2% = ৳1,200');
      assert.equal(res.totalCash, 3200, 'Total estimated monthly income = ৳3,200');
      assert.equal(res.totalCoins, 1000, 'Bonus Loyalty Coins = 1,000 Coins');
    });

    test('Boundary scenario: 1 friend spending ৳500 (minimum range)', () => {
      const res = computeReferralEarnings(1, 500);
      assert.equal(res.directEarn, 25);
      assert.equal(res.subFriends, 2);
      assert.equal(res.subEarn, 20);
      assert.equal(res.totalCash, 45);
      assert.equal(res.totalCoins, 100);
    });

    test('Power-referrer scenario: 100 friends spending ৳25,000 (maximum range)', () => {
      const res = computeReferralEarnings(100, 25000);
      assert.equal(res.directEarn, 125000);
      assert.equal(res.subFriends, 150);
      assert.equal(res.subEarn, 75000);
      assert.equal(res.totalCash, 200000);
      assert.equal(res.totalCoins, 10000);
    });
  });

  describe('2. Gamified Referrer Level Milestone Progression', () => {
    function getReferrerLevel(referralCount) {
      if (referralCount >= 25) return { tier: 'PLATINUM_DIRECTOR', min: 25, bonus: '+3% Multiplier' };
      if (referralCount >= 15) return { tier: 'GOLD_VIP', min: 15, bonus: '+2% Multiplier' };
      if (referralCount >= 10) return { tier: 'SILVER', min: 10, bonus: '+1% Multiplier' };
      if (referralCount >= 5) return { tier: 'BRONZE', min: 5, bonus: '+0.5% Multiplier' };
      return { tier: 'STARTER', min: 0, bonus: 'Standard Rate' };
    }

    test('Progresses correctly through all 5 gamification tiers', () => {
      assert.equal(getReferrerLevel(0).tier, 'STARTER');
      assert.equal(getReferrerLevel(4).tier, 'STARTER');
      assert.equal(getReferrerLevel(5).tier, 'BRONZE');
      assert.equal(getReferrerLevel(9).tier, 'BRONZE');
      assert.equal(getReferrerLevel(10).tier, 'SILVER');
      assert.equal(getReferrerLevel(14).tier, 'SILVER');
      assert.equal(getReferrerLevel(15).tier, 'GOLD_VIP');
      assert.equal(getReferrerLevel(24).tier, 'GOLD_VIP');
      assert.equal(getReferrerLevel(25).tier, 'PLATINUM_DIRECTOR');
      assert.equal(getReferrerLevel(100).tier, 'PLATINUM_DIRECTOR');
    });
  });

  describe('3. Tree Directory Filtering & Search Logic', () => {
    const sampleTree = [
      { id: 1, ref: 'REF-001', referee_name: 'Sadia Rahman', referee_email: 'sadia@gmail.com', tier_level: 1, status: 'QUALIFIED' },
      { id: 2, ref: 'REF-002', referee_name: 'Fahim Hasan', referee_email: 'fahim@yahoo.com', tier_level: 1, status: 'PENDING' },
      { id: 3, ref: 'REF-003', referee_name: 'Tanvir Ahmed', referee_email: 'tanvir@gmail.com', tier_level: 2, status: 'QUALIFIED' },
      { id: 4, ref: 'REF-004', referee_name: 'Nusrat Jahan', referee_email: 'nusrat@gmail.com', tier_level: 2, status: 'PENDING' },
    ];

    function filterTree(nodes, filter, query = '') {
      let result = [...nodes];
      if (filter === 'tier1') result = result.filter(n => n.tier_level === 1);
      else if (filter === 'tier2') result = result.filter(n => n.tier_level === 2);
      else if (filter === 'qualified') result = result.filter(n => n.status === 'QUALIFIED');
      else if (filter === 'pending') result = result.filter(n => n.status === 'PENDING');

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        result = result.filter(n =>
          (n.referee_name || '').toLowerCase().includes(q) ||
          (n.ref || '').toLowerCase().includes(q) ||
          (n.referee_email || '').toLowerCase().includes(q)
        );
      }
      return result;
    }

    test('Filters by tier level correctly', () => {
      assert.equal(filterTree(sampleTree, 'tier1').length, 2);
      assert.equal(filterTree(sampleTree, 'tier2').length, 2);
      assert.equal(filterTree(sampleTree, 'all').length, 4);
    });

    test('Filters by qualification status correctly', () => {
      assert.equal(filterTree(sampleTree, 'qualified').length, 2);
      assert.equal(filterTree(sampleTree, 'pending').length, 2);
    });

    test('Performs case-insensitive search by name and email', () => {
      const matchName = filterTree(sampleTree, 'all', 'fahim');
      assert.equal(matchName.length, 1);
      assert.equal(matchName[0].referee_name, 'Fahim Hasan');

      const matchEmail = filterTree(sampleTree, 'all', 'GMAIL.COM');
      assert.equal(matchEmail.length, 3);
    });
  });

  describe('4. Custom Vanity Slug Validation', () => {
    function isValidSlug(slug) {
      if (!slug || typeof slug !== 'string') return false;
      const clean = slug.trim().toLowerCase();
      if (clean.length < 3 || clean.length > 40) return false;
      return /^[a-z0-9-]+$/.test(clean);
    }

    test('Validates legitimate vanity slugs', () => {
      assert.equal(isValidSlug('fahim-deals'), true);
      assert.equal(isValidSlug('bengal-loom-2026'), true);
      assert.equal(isValidSlug('tanvir10'), true);
      assert.equal(isValidSlug('abc'), true);
    });

    test('Rejects invalid or malicious slugs', () => {
      assert.equal(isValidSlug('ab'), false, 'Too short (< 3 chars)');
      assert.equal(isValidSlug('a'.repeat(41)), false, 'Too long (> 40 chars)');
      assert.equal(isValidSlug('fahim deals'), false, 'Contains spaces');
      assert.equal(isValidSlug('deals_2026'), false, 'Contains underscore');
      assert.equal(isValidSlug('fahim@deals!'), false, 'Contains special characters');
      assert.equal(isValidSlug('<script>'), false, 'Contains XSS tags');
    });
  });

  describe('5. XSS Prevention & HTML Escaping', () => {
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    test('Escapes malicious HTML inputs', () => {
      const malicious = '<img src=x onerror=alert(1)> & "hello"';
      const escaped = escapeHtml(malicious);
      assert.equal(escaped, '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;hello&quot;');
      assert.ok(!escaped.includes('<'));
      assert.ok(!escaped.includes('>'));
      assert.ok(!escaped.includes('"'));
    });
  });

});
