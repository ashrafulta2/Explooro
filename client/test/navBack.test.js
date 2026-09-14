/**
 * navBack.test.js — Dynamic Back Button Destination & Label Invariants.
 *
 * Runs via node:test without adding any npm dependencies to the client.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getBackDestination, renderBackLink } from '../src/core/navBack.js';

describe('navBack — Dynamic Navigation & Origin Label Resolution', () => {
  describe('1. Route mapping to destination names (English)', () => {
    test('Marketplace root and paths', () => {
      assert.equal(getBackDestination('/', 'en').name, 'Marketplace');
      assert.equal(getBackDestination('/marketplace', 'en').name, 'Marketplace');
      assert.equal(getBackDestination('/marketplace?cat=electronics', 'en').name, 'Marketplace');
    });

    test('Customer Account interior sub-surfaces', () => {
      assert.equal(getBackDestination('/account/orders', 'en').name, 'Orders');
      assert.equal(getBackDestination('/account/wishlist', 'en').name, 'Wishlist');
      assert.equal(getBackDestination('/account/coupons', 'en').name, 'Coupons');
      assert.equal(getBackDestination('/account/coins', 'en').name, 'Coins & Streak');
      assert.equal(getBackDestination('/account/team-purchases', 'en').name, 'Team Purchases');
      assert.equal(getBackDestination('/account/warranties', 'en').name, 'Warranties');
      assert.equal(getBackDestination('/account/returns', 'en').name, 'Returns');
      assert.equal(getBackDestination('/account/reviews', 'en').name, 'Reviews');
      assert.equal(getBackDestination('/account/following', 'en').name, 'Following');
      assert.equal(getBackDestination('/account/addresses', 'en').name, 'Addresses');
      assert.equal(getBackDestination('/account/profile', 'en').name, 'Profile');
      assert.equal(getBackDestination('/account/settings', 'en').name, 'Settings');
      assert.equal(getBackDestination('/account/become-saler', 'en').name, 'Become a Saler');
    });

    test('Customer Account dashboard root', () => {
      assert.equal(getBackDestination('/account', 'en').name, 'Account');
      assert.equal(getBackDestination('/customer', 'en').name, 'Account');
    });

    test('Shopping & Exploration flows', () => {
      assert.equal(getBackDestination('/cart', 'en').name, 'Cart');
      assert.equal(getBackDestination('/checkout', 'en').name, 'Checkout');
      assert.equal(getBackDestination('/search?q=jamdani', 'en').name, 'Search');
      assert.equal(getBackDestination('/category/clothing', 'en').name, 'Category');
      assert.equal(getBackDestination('/product/dhakai-jamdani', 'en').name, 'Product');
      assert.equal(getBackDestination('/live', 'en').name, 'Live Shopping');
      assert.equal(getBackDestination('/stories', 'en').name, 'Stories');
    });
  });

  describe('2. Route mapping to destination names (Bengali)', () => {
    test('Marketplace root in Bengali', () => {
      assert.equal(getBackDestination('/', 'bn').name, 'মার্কেটপ্লেস');
    });

    test('Customer Account sub-surfaces in Bengali', () => {
      assert.equal(getBackDestination('/account/orders', 'bn').name, 'অর্ডারসমূহ');
      assert.equal(getBackDestination('/account/wishlist', 'bn').name, 'উইশলিস্ট');
      assert.equal(getBackDestination('/account/coupons', 'bn').name, 'কুপন ও ভাউচার');
      assert.equal(getBackDestination('/account/coins', 'bn').name, 'কয়েন ও স্ট্রিক');
      assert.equal(getBackDestination('/account/team-purchases', 'bn').name, 'টিম পারচেজ');
      assert.equal(getBackDestination('/account/warranties', 'bn').name, 'ওয়ারেন্টি');
      assert.equal(getBackDestination('/account/returns', 'bn').name, 'রিটার্ন');
      assert.equal(getBackDestination('/account/reviews', 'bn').name, 'রিভিউ');
      assert.equal(getBackDestination('/account/following', 'bn').name, 'পছন্দের দোকান');
      assert.equal(getBackDestination('/account/addresses', 'bn').name, 'ডেলিভারি ঠিকানা');
      assert.equal(getBackDestination('/account/profile', 'bn').name, 'প্রোফাইল');
      assert.equal(getBackDestination('/account/settings', 'bn').name, 'সেটিংস');
      assert.equal(getBackDestination('/account', 'bn').name, 'অ্যাকাউন্ট');
    });

    test('Shopping flows in Bengali', () => {
      assert.equal(getBackDestination('/cart', 'bn').name, 'কার্ট');
      assert.equal(getBackDestination('/checkout', 'bn').name, 'চেকআউট');
      assert.equal(getBackDestination('/search?q=jamdani', 'bn').name, 'অনুসন্ধান');
      assert.equal(getBackDestination('/product/dhakai-jamdani', 'bn').name, 'পণ্য');
      assert.equal(getBackDestination('/live', 'bn').name, 'লাইভ শপিং');
    });
  });

  describe('3. renderBackLink HTML generation and dynamic resolution', () => {
    test('renders chevron icon and designated label', () => {
      const html = renderBackLink({ href: '/account', label: 'Custom Destination' });
      assert.match(html, /back-btn__chevron/);
      assert.match(html, /<span>Custom Destination<\/span>/);
      assert.match(html, /href="\/account"/);
    });

    test('replaces generic "Account" label with fallback destination name when no history', () => {
      const html = renderBackLink({ href: '/account', label: 'Account' });
      assert.match(html, /<span>Account<\/span>/);
      assert.match(html, /href="\/account"/);
    });

    test('honours non-account fallback href when label is omitted', () => {
      const html = renderBackLink({ href: '/account/wishlist' });
      assert.match(html, /<span>Wishlist<\/span>/);
      assert.match(html, /href="\/account\/wishlist"/);
    });
  });
});
