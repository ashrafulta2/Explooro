/**
 * deliveryZones.test.js — the delivery charge is set per zone (migration 098).
 *
 * Invariants:
 *  1. A district is charged by exactly one zone: the one listing it, else the default zone.
 *  2. The server and the client resolve the same zone for the same address. Checkout shows the
 *     client's figure while the shopper picks a district; the order pays the server's. If they
 *     disagreed, the shopper would be shown one price and charged another.
 *  3. A zone can only list districts the address form actually sends, and no district is in two
 *     zones (two prices for one district, decided by list order nobody can see).
 *  4. Every order path resolves the zone from the delivery address, fresh, and records it.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as server from '../src/services/deliveryCharge.service.ts';
import * as client from '../../client/src/services/deliveryZones.ts';
import { BD_DISTRICTS_BY_DIVISION, BD_DISTRICT_IDS } from '../src/config/bdDistricts.ts';
import { BANGLADESH_DIVISIONS, ALL_BD_DISTRICTS } from '../../client/src/data/bangladeshGeo.ts';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const policy = (overrides = {}) => ({
  default_zone: 'outside_dhaka',
  zones: [
    { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 60, districts: ['dhaka_city'] },
    { key: 'dhaka_suburbs', name_en: 'Dhaka suburbs', name_bn: 'ঢাকার আশেপাশে', charge: 90, districts: ['gazipur', 'narayanganj'] },
    { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 120, districts: [] },
  ],
  ...overrides,
});

const VALIDATION = (e) => e.code === 'VALIDATION_FAILED';

describe('1. resolving a district to its zone', () => {
  const p = server.validatePolicy(policy());

  test('a listed district pays its zone; anything else pays the default zone', () => {
    assert.equal(server.resolveZone(p, 'dhaka_city').charge, 60);
    assert.equal(server.resolveZone(p, 'gazipur').charge, 90);
    assert.equal(server.resolveZone(p, 'sylhet_city').charge, 120);
    assert.equal(server.resolveZone(p, 'bogura').key, 'outside_dhaka');
  });

  test('no district (the cart, before an address) is the default zone', () => {
    for (const none of [null, undefined, '', '   ']) assert.equal(server.resolveZone(p, none).key, 'outside_dhaka');
    assert.equal(server.defaultZone(p).key, 'outside_dhaka');
  });

  test('names and old spellings an address may carry land in the same zone as the form id', () => {
    for (const v of ['dhaka_city', 'Dhaka City', 'Dhaka', 'DHAKA', ' dhaka ']) assert.equal(server.resolveZone(p, v).key, 'inside_dhaka', v);
    assert.equal(server.canonicalDistrict("Cox's Bazar"), server.canonicalDistrict('coxs_bazar'));
    assert.equal(server.canonicalDistrict('Chattogram'), server.canonicalDistrict('chittagong_city'));
    assert.equal(server.canonicalDistrict('Comilla'), server.canonicalDistrict('cumilla'));
    assert.equal(server.canonicalDistrict('Jessore'), server.canonicalDistrict('jashore'));
  });

  test('every one of the 64 form districts canonicalises to a different value', () => {
    const seen = new Set([...BD_DISTRICT_IDS].map(server.canonicalDistrict));
    assert.equal(seen.size, 64);
  });
});

describe('2. server and client agree', () => {
  const p = server.validatePolicy(policy());
  const inputs = [
    ...BD_DISTRICT_IDS,
    ...ALL_BD_DISTRICTS.flatMap((d) => [d.id, d.name_en, ...(d.aliases || [])]),
    ...BANGLADESH_DIVISIONS.flatMap((div) => div.districts.map((d) => d.name_en)),
    null, '', 'Atlantis', 'DHAKA CITY', "Cox's  Bazar",
  ];

  test('canonicalDistrict is the same function on both sides', () => {
    for (const v of inputs) assert.equal(client.canonicalDistrict(v), server.canonicalDistrict(v), String(v));
  });

  test('resolveZone picks the same zone on both sides for every input', () => {
    for (const v of inputs) assert.equal(client.resolveZone(p, v).key, server.resolveZone(p, v).key, String(v));
  });

  test('what GET /delivery/policy serves is a policy the client accepts, and resolves identically', () => {
    const view = server.publicView(p);
    assert.ok(client.isDeliveryPolicy(view));
    assert.equal(view.per_parcel_charge, 120, 'the pre-zone field means the default zone');
    for (const v of BD_DISTRICT_IDS) assert.equal(client.resolveZone(view, v).charge, server.resolveZone(p, v).charge);
  });

  test('the server district list is exactly the address form\'s', () => {
    const formIds = Object.fromEntries(BANGLADESH_DIVISIONS.map((d) => [d.id, d.districts.map((x) => x.id)]));
    assert.deepEqual(BD_DISTRICTS_BY_DIVISION, formIds);
  });
});

describe('3. validatePolicy is strict', () => {
  test('the shipped default and a three-zone policy pass', () => {
    assert.ok(server.validatePolicy(server.DEFAULT_POLICY));
    assert.equal(server.validatePolicy(policy()).zones.length, 3);
  });

  test('names are trimmed and repeated districts collapse', () => {
    const p = policy();
    p.zones[0].name_en = '  Inside Dhaka  ';
    p.zones[0].districts = ['dhaka_city', 'dhaka_city'];
    const out = server.validatePolicy(p);
    assert.equal(out.zones[0].name_en, 'Inside Dhaka');
    assert.deepEqual(out.zones[0].districts, ['dhaka_city']);
  });

  test('a district in two zones is refused', () => {
    const p = policy();
    p.zones[1].districts.push('dhaka_city');
    assert.throws(() => server.validatePolicy(p), (e) => VALIDATION(e) && e.details?.district === 'dhaka_city');
  });

  test('a district the form never sends is refused', () => {
    for (const bad of ['dhaka', 'Dhaka City', 'atlantis', 42]) {
      const p = policy();
      p.zones[0].districts = [bad];
      assert.throws(() => server.validatePolicy(p), VALIDATION, String(bad));
    }
  });

  test('the default must name a zone; keys must be well-formed and unique', () => {
    assert.throws(() => server.validatePolicy(policy({ default_zone: 'nowhere' })), VALIDATION);
    const dup = policy();
    dup.zones[1].key = 'inside_dhaka';
    assert.throws(() => server.validatePolicy(dup), VALIDATION);
    const badKey = policy();
    badKey.zones[0].key = 'Inside Dhaka';
    assert.throws(() => server.validatePolicy(badKey), VALIDATION);
  });

  test('zone count, names and charges are bounded', () => {
    assert.throws(() => server.validatePolicy({ default_zone: 'a', zones: [] }), VALIDATION);
    const many = Array.from({ length: server.ZONE_LIMITS.maxZones + 1 }, (_, i) => ({ key: `z_${i}`, name_en: 'Z', name_bn: 'জ', charge: 10, districts: [] }));
    assert.throws(() => server.validatePolicy({ default_zone: 'z_0', zones: many }), VALIDATION);
    const noBn = policy();
    noBn.zones[0].name_bn = '  ';
    assert.throws(() => server.validatePolicy(noBn), VALIDATION);
    const long = policy();
    long.zones[0].name_en = 'x'.repeat(server.ZONE_LIMITS.nameMaxLength + 1);
    assert.throws(() => server.validatePolicy(long), VALIDATION);
    for (const charge of [-1, 5000.01, 1.005, '60', null]) {
      const p = policy();
      p.zones[2].charge = charge;
      assert.throws(() => server.validatePolicy(p), VALIDATION, String(charge));
    }
  });
});

describe('4. writes are reasoned, audited and stale-checked', () => {
  function db(stored) {
    let value = stored.value;
    let updatedAt = stored.updated_at;
    return {
      async query(sql, params = []) {
        if (sql.includes('INSERT INTO platform_settings')) {
          value = JSON.parse(params[1]);
          updatedAt = '2026-10-31T10:00:00.000Z';
        }
        if (sql.includes('FROM platform_settings') && params[0] === 'delivery.zones') {
          return { rows: [{ key: 'delivery.zones', value_json: value, updated_at: updatedAt }] };
        }
        return { rows: [] };
      },
    };
  }

  test('a save from a form opened before someone else saved is refused with 409', async () => {
    const pool = db({ value: policy(), updated_at: '2026-10-30T09:00:00.000Z' });
    await assert.rejects(
      server.updatePolicy(pool, null, null, { policy: policy(), reason: 'Raise outside Dhaka rate', userId: 1, expectedUpdatedAt: '2026-10-29T09:00:00.000Z' }),
      (e) => e.code === 'PRECONDITION_CHANGED'
    );
    const ok = await server.updatePolicy(pool, null, null, { policy: policy(), reason: 'Raise outside Dhaka rate', userId: 1, expectedUpdatedAt: '2026-10-30T09:00:00.000Z' });
    assert.equal(ok.zones.length, 3);
  });

  test('an invalid policy never reaches the database', async () => {
    let wrote = false;
    const pool = { async query(sql) { if (sql.includes('INSERT')) wrote = true; return { rows: [] }; } };
    await assert.rejects(server.updatePolicy(pool, null, null, { policy: policy({ default_zone: 'x' }), reason: 'A long enough reason', userId: 1 }), VALIDATION);
    assert.equal(wrote, false);
  });
});

describe('5. every order path charges the zone of the delivery address', () => {
  test('checkout resolves it fresh from the district and records it on the order', () => {
    const checkout = src('services/checkout.service.ts');
    assert.match(checkout, /zoneForAddress\(client, cache, \{ district \}, \{ fresh: true \}\)/);
    assert.match(checkout, /deliveryZone: delivery\.zone\.key/);
  });

  test('a live-stream order does the same, and its quote follows the drawer\'s district', () => {
    const live = src('services/liveStream.service.ts');
    assert.match(live, /zoneForAddress\(pool, cache, \{ district \}, \{ fresh: true \}\)/);
    assert.match(live, /zoneForAddress\(pool, cache, \{ district \}\);/);
    assert.match(live, /deliveryZone: delivery\.zone\.key/);
    assert.match(src('routes/liveStream.routes.ts'), /district: \{ type: 'string', maxLength: 64 \}/);
  });

  test('the zone is stored on orders (migration 098) and the repository writes it', () => {
    const migration = readFileSync(new URL('../src/db/migrations/098_delivery_zones.sql', import.meta.url), 'utf8');
    assert.match(migration, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone TEXT/);
    assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/);
    assert.match(src('repositories/order.repository.ts'), /live_stream_id, delivery_zone, placed_at/);
  });

  test('the migration seeds the zones this service accepts, from the old single charge', () => {
    const migration = readFileSync(new URL('../src/db/migrations/098_delivery_zones.sql', import.meta.url), 'utf8');
    for (const z of server.DEFAULT_POLICY.zones) {
      assert.ok(migration.includes(`'key', '${z.key}'`), z.key);
      assert.ok(migration.includes(`'name_en', '${z.name_en}'`), z.name_en);
      assert.ok(migration.includes(`'name_bn', '${z.name_bn}'`), z.name_bn);
    }
    assert.match(migration, /'default_zone', 'outside_dhaka'/);
    assert.match(migration, /WHERE key = 'delivery\.per_parcel_charge'/);
  });

  test('the admin route takes zones, never a client-chosen per-order charge', () => {
    const routes = src('routes/deliveryCharge.routes.ts');
    assert.match(routes, /required: \['zones', 'default_zone', 'reason'\]/);
    assert.ok(!/per_parcel_charge/.test(routes));
  });
});
