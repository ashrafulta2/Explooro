/**
 * reviewsHub.test.js — Invariant & Logic Unit Tests for Customer Reviews & UGC Hub.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

test('Customer Reviews Hub — Client Logic & Invariants', async (t) => {
  await t.test('1. Coin Incentive Computation Rules', () => {
    function computeCoinsForReview(media = []) {
      const hasVideo = media.some((m) => m.media_kind === 'VIDEO');
      const hasImage = media.some((m) => m.media_kind === 'IMAGE');
      if (hasVideo) return 40;
      if (hasImage) return 20;
      return 10;
    }

    assert.equal(computeCoinsForReview([]), 10, 'Text-only review awards 10 coins');
    assert.equal(computeCoinsForReview([{ media_kind: 'IMAGE', url: 'img1.webp' }]), 20, 'Photo review awards +20 coins');
    assert.equal(computeCoinsForReview([{ media_kind: 'VIDEO', url: 'vid1.mp4' }]), 40, 'Video unboxing review awards +40 coins (2x bonus)');
    assert.equal(
      computeCoinsForReview([
        { media_kind: 'IMAGE', url: 'img1.webp' },
        { media_kind: 'VIDEO', url: 'vid1.mp4' },
      ]),
      40,
      'Mixed photo and video review awards the max tier (+40 coins)'
    );
  });

  await t.test('2. Rating Bounds & Star Normalization', () => {
    function validateRating(rating) {
      const num = Number(rating);
      if (isNaN(num) || num < 1 || num > 5 || !Number.isInteger(num)) {
        return { valid: false, error: 'Rating must be an integer between 1 and 5' };
      }
      return { valid: true, rating: num };
    }

    assert.equal(validateRating(5).valid, true);
    assert.equal(validateRating(1).valid, true);
    assert.equal(validateRating(0).valid, false);
    assert.equal(validateRating(6).valid, false);
    assert.equal(validateRating(3.5).valid, false);
    assert.equal(validateRating('invalid').valid, false);
  });

  await t.test('3. Search, Filter & Sorter Invariants', () => {
    const mockReviews = [
      {
        id: 1,
        product_ref: 'PRD-8F2K9QX7',
        product_title_en: 'Premium Cotton Saree',
        product_title_bn: 'প্রিমিয়াম কটন শাড়ি',
        rating: 5,
        title: 'Authentic pure cotton',
        body: 'Beautiful fabric and fast delivery to Mirpur.',
        helpful_count: 14,
        created_at: '2026-08-20T10:00:00Z',
      },
      {
        id: 2,
        product_ref: 'PRD-2M7V9WQ1',
        product_title_en: 'Eid Special Panjabi',
        product_title_bn: 'ঈদ স্পেশাল পাঞ্জাবি',
        rating: 4,
        title: 'Great fit',
        body: 'Ordered M, fits nicely.',
        helpful_count: 4,
        created_at: '2026-08-25T10:00:00Z',
      },
      {
        id: 3,
        product_ref: 'PRD-5N3P8RT4',
        product_title_en: 'Kids Winter Jacket',
        product_title_bn: 'শীতের বাচ্চাদের জ্যাকেট',
        rating: 3,
        title: 'Average quality',
        body: 'Zipper could be better.',
        helpful_count: 22,
        created_at: '2026-08-15T10:00:00Z',
      },
    ];

    // Search by English product title
    const searchPanjabi = mockReviews.filter((r) =>
      r.product_title_en.toLowerCase().includes('panjabi')
    );
    assert.equal(searchPanjabi.length, 1);
    assert.equal(searchPanjabi[0].id, 2);

    // Search by Bengali product title
    const searchBn = mockReviews.filter((r) =>
      r.product_title_bn.includes('শাড়ি')
    );
    assert.equal(searchBn.length, 1);
    assert.equal(searchBn[0].id, 1);

    // Search by review body keywords
    const searchMirpur = mockReviews.filter((r) =>
      r.body.toLowerCase().includes('mirpur')
    );
    assert.equal(searchMirpur.length, 1);
    assert.equal(searchMirpur[0].id, 1);

    // Filter by rating = 5
    const fiveStars = mockReviews.filter((r) => r.rating === 5);
    assert.equal(fiveStars.length, 1);
    assert.equal(fiveStars[0].id, 1);

    // Sort by helpful votes descending
    const sortedHelpful = [...mockReviews].sort((a, b) => b.helpful_count - a.helpful_count);
    assert.equal(sortedHelpful[0].id, 3); // 22 helpful votes
    assert.equal(sortedHelpful[1].id, 1); // 14 helpful votes

    // Sort by rating descending
    const sortedRating = [...mockReviews].sort((a, b) => b.rating - a.rating);
    assert.equal(sortedRating[0].rating, 5);
    assert.equal(sortedRating[2].rating, 3);
  });

  await t.test('4. Pending Reviewable Purchases Filtering', () => {
    const orders = [
      { product_ref: 'PRD-1', status: 'DELIVERED', order_item_id: 'OI-1' },
      { product_ref: 'PRD-2', status: 'DELIVERED', order_item_id: 'OI-2' },
      { product_ref: 'PRD-3', status: 'SHIPPED', order_item_id: 'OI-3' },
    ];

    const existingReviews = [{ product_ref: 'PRD-1', reviewer_name: 'Dev Customer' }];
    const reviewedRefs = new Set(existingReviews.map((r) => r.product_ref));

    const pending = orders.filter((o) => o.status === 'DELIVERED' && !reviewedRefs.has(o.product_ref));

    assert.equal(pending.length, 1, 'Only delivered unreviewed items are pending');
    assert.equal(pending[0].product_ref, 'PRD-2');
  });

  await t.test('5. Localization Parity (EN ↔ BN)', () => {
    const enKeys = Object.keys(enDict.customer_reviews || {});
    const bnKeys = Object.keys(bnDict.customer_reviews || {});

    assert.equal(enKeys.length > 20, true, 'EN dictionary must contain extensive customer review keys');
    assert.equal(bnKeys.length > 20, true, 'BN dictionary must contain extensive customer review keys');

    for (const key of enKeys) {
      assert.equal(key in bnDict.customer_reviews, true, `Key "${key}" in en.json must have matching bn.json translation`);
      assert.notEqual(bnDict.customer_reviews[key], '', `BN translation for "${key}" cannot be empty`);
    }
  });

  await t.test('6. Deep-Link & Query Param Resolution', () => {
    function resolveTabFromParams(param) {
      if (['pending', 'to_review'].includes(param)) return 'pending';
      if (['published', 'my_reviews'].includes(param)) return 'published';
      if (['media', 'ugc'].includes(param)) return 'media';
      return 'pending';
    }

    assert.equal(resolveTabFromParams('to_review'), 'pending');
    assert.equal(resolveTabFromParams('my_reviews'), 'published');
    assert.equal(resolveTabFromParams('ugc'), 'media');
    assert.equal(resolveTabFromParams('unknown'), 'pending');

    const pendingList = [
      { order_ref: 'ORD-849102', product_ref: 'PRD-9K1L4XC6', title: 'Handloom Saree' },
      { order_ref: 'ORD-552190', product_ref: 'PRD-3X7T9Q1M', title: 'Pure Ghee' },
    ];

    const matchByProduct = pendingList.find((p) => p.product_ref === 'PRD-9K1L4XC6');
    assert.equal(Boolean(matchByProduct), true);
    assert.equal(matchByProduct.order_ref, 'ORD-849102');

    const matchByOrder = pendingList.find((p) => p.order_ref === 'ORD-552190');
    assert.equal(Boolean(matchByOrder), true);
    assert.equal(matchByOrder.product_ref, 'PRD-3X7T9Q1M');
  });
});
