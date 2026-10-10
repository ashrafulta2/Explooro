/**
 * referralWiring.test.js — the referral engine is now reachable and honours its settings.
 *
 * Invariants:
 *  1. A refused attribution is recorded as a FRAUD_FLAGGED row (the admin fraud panel reads it);
 *     a same-account attempt is not, because the table forbids it.
 *  2. max_tier_depth is enforced twice: no tier-2 row is minted at depth 1, and an existing tier-2
 *     row stops earning once the admin lowers the depth.
 *  3. /auth/register accepts an optional referral_code, and the controller treats it as best-effort.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as referralService from '../src/services/referral.service.js';
import authRoutes from '../src/routes/auth.routes.js';

const cache = { get: async () => null, set: async () => {} };

function makeDb({ settings = {}, referrer = { id: 1, user_id: 10, code: 'REF-X' }, upstream = [] } = {}) {
  const inserts = [];
  const db = {
    inserts,
    query: async (sql, params = []) => {
      if (sql.includes('FROM platform_modules')) {
        return {
          rows: [{
            key: 'referral_engine',
            is_enabled: true,
            default_enabled: true,
            settings_json: { max_tier_depth: 2, qualifying_event: 'FIRST_ORDER', ...settings },
          }],
        };
      }
      if (sql.includes('FROM user_referral_codes')) return { rows: [referrer] };
      if (sql.includes('COUNT(*)::int as count FROM referrals')) return { rows: [{ count: 0 }] };
      if (sql.includes('INSERT INTO referrals')) {
        inserts.push({ sql, params });
        const isTier2 = sql.includes('2, $4');
        return {
          rows: sql.includes('FRAUD_FLAGGED')
            ? []
            : [{ id: isTier2 ? 102 : 101, tier_level: isTier2 ? 2 : 1, referrer_user_id: params[1], referred_user_id: params[2] }],
        };
      }
      if (sql.includes('SELECT referrer_user_id FROM referrals')) return { rows: upstream };
      return { rows: [] };
    },
  };
  return db;
}

describe('Referral wiring: fraud rows', () => {
  test('a phone match is refused and stored as FRAUD_FLAGGED with its reason', async () => {
    const db = makeDb({ referrer: { id: 1, user_id: 10, code: 'REF-X', referrer_phone: '01711111111' } });
    const out = await referralService.recordReferralAttribution(db, cache, {
      referralCode: 'REF-X', referredUserId: 20, phone: '01711111111', ip: '1.2.3.4',
    });
    assert.equal(out.attributed, false);
    assert.equal(out.isFraud, true);
    assert.equal(out.reason, 'SELF_REFERRAL_PHONE_MATCH');
    assert.equal(db.inserts.length, 1);
    assert.match(db.inserts[0].sql, /FRAUD_FLAGGED/);
    assert.deepEqual(db.inserts[0].params.slice(1, 5), [10, 20, 'SELF_REFERRAL_PHONE_MATCH', 'FIRST_ORDER']);
  });

  test('a same-account attempt is refused without a row (no_self_referral forbids it)', async () => {
    const db = makeDb();
    const out = await referralService.recordReferralAttribution(db, cache, { referralCode: 'REF-X', referredUserId: 10 });
    assert.equal(out.reason, 'SELF_REFERRAL_SAME_ACCOUNT');
    assert.equal(db.inserts.length, 0);
  });
});

describe('Referral wiring: max_tier_depth', () => {
  test('depth 2 mints the upstream sponsor as tier 2', async () => {
    const db = makeDb({ upstream: [{ referrer_user_id: 5 }] });
    const out = await referralService.recordReferralAttribution(db, cache, { referralCode: 'REF-X', referredUserId: 20 });
    assert.equal(out.attributed, true);
    assert.ok(out.tier2, 'tier 2 expected at depth 2');
  });

  test('depth 1 mints tier 1 only, even with an upstream sponsor', async () => {
    const db = makeDb({ settings: { max_tier_depth: 1 }, upstream: [{ referrer_user_id: 5 }] });
    const out = await referralService.recordReferralAttribution(db, cache, { referralCode: 'REF-X', referredUserId: 20 });
    assert.equal(out.attributed, true);
    assert.equal(out.tier2, null);
    assert.equal(db.inserts.length, 1);
  });

  test('an existing tier-2 row earns nothing once the depth is lowered to 1', async () => {
    const db = {
      query: async (sql) => {
        if (sql.includes('FROM platform_modules')) {
          return {
            rows: [{
              key: 'referral_engine',
              is_enabled: true,
              default_enabled: true,
              settings_json: { tier_1_rate_pct: 5, tier_2_rate_pct: 2, max_tier_depth: 1, holding_period_days: 7 },
            }],
          };
        }
        if (sql.includes('FROM referrals')) return { rows: [{ id: 102, ref: 'REF-LINK-T2', tier_level: 2, referrer_user_id: 5 }] };
        return { rows: [] };
      },
      // A tier-2 payout would open a transaction; reaching connect() is the failure.
      connect: async () => { throw new Error('tier 2 must not be paid at depth 1'); },
    };
    const earned = await referralService.evaluateQualifyingEvent(db, cache, { userId: 20, orderId: 7, orderAmount: 1000 });
    assert.deepEqual(earned, []);
  });
});

describe('Referral wiring: sign-up', () => {
  test('POST /auth/register accepts an optional referral_code', async () => {
    const app = Fastify();
    const schemas = [];
    app.addHook('onRoute', (route) => {
      if (route.method === 'POST' && route.url === '/register') schemas.push(route.schema);
    });
    for (const name of ['authenticate', 'requireModule', 'requirePermission']) {
      app.decorate(name, () => async () => {});
    }
    await app.register(authRoutes).ready().catch(() => {});
    const body = schemas[0]?.body;
    assert.ok(body, 'register route must be declared');
    assert.equal(body.properties.referral_code.type, 'string');
    assert.equal(body.additionalProperties, false);
    assert.ok(!(body.required || []).includes('referral_code'), 'referral_code stays optional');
  });
});
