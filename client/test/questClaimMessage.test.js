import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { questClaimMessage } from '../src/components/gamification/questClaimMessage.js';

describe('questClaimMessage', () => {
  test('a normal claim names the coins the server awarded', () => {
    assert.match(questClaimMessage({ rewardCoins: 35, capped: false }, false), /\+35 coins/);
    assert.match(questClaimMessage({ rewardCoins: 35 }, true), /\+35/);
  });

  test('a fully capped claim never claims coins were added', () => {
    const msg = questClaimMessage({ rewardCoins: 0, capped: true }, false);
    assert.match(msg, /no coins were added/);
    assert.doesNotMatch(msg, /\+\d/);
  });

  test('a partly capped claim shows the awarded part and says the rest was not', () => {
    const msg = questClaimMessage({ rewardCoins: 10, capped: true }, false);
    assert.match(msg, /\+10 coins added/);
    assert.match(msg, /limit/);
  });

  test('a missing claim does not invent an amount', () => {
    assert.doesNotMatch(questClaimMessage(undefined, false), /\d/);
  });
});
