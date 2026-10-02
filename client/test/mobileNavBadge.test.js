/**
 * mobileNavBadge.test.js — the bottom-nav count badge must pop, remind a bounded number of times,
 * and otherwise stay hidden (it must never become a permanent nag).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_SHOW_WINDOWS, isBadgeShown } from '../src/components/shell/MobileNav.js';

describe('MobileNav badge timing', () => {
  test('shows on arrival and hides shortly after', () => {
    assert.equal(isBadgeShown(0), true);
    assert.equal(isBadgeShown(3999), true);
    assert.equal(isBadgeShown(4000), false);
    assert.equal(isBadgeShown(60000), false);
  });

  test('reminds exactly three more times with widening gaps, then stays silent', () => {
    assert.equal(BADGE_SHOW_WINDOWS.length, 4);
    const starts = BADGE_SHOW_WINDOWS.map(([from]) => from);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    assert.ok(gaps.every((g, i) => i === 0 || g > gaps[i - 1]));
    assert.equal(isBadgeShown(60 * 60 * 1000), false);
  });
});
