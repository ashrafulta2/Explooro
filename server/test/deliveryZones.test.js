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
    { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 60, team_charge: 50, days_min: 1, days_max: 2, districts: ['dhaka_city'] },
    { key: 'dhaka_suburbs', name_en: 'Dhaka suburbs', name_bn: 'ঢাকার আশেপাশে', charge: 90, team_charge: 80, days_min: 2, days_max: 3, districts: ['gazipur', 'narayanganj'] },
    { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 120, team_charge: 110, days_min: 3, days_max: 5, districts: [] },
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
    assert.equal('cutoff_hour' in view, true, 'the cut-off travels to the client');
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

  test('the cut-off hour is an hour 0-23 or none, nothing else', () => {
    assert.equal(server.validatePolicy({ ...policy(), cutoff_hour: 17 }).cutoff_hour, 17);
    assert.equal(server.validatePolicy({ ...policy(), cutoff_hour: 0 }).cutoff_hour, 0);
    assert.equal(server.validatePolicy({ ...policy() }).cutoff_hour, null, 'absent means no cut-off');
    assert.equal(server.validatePolicy({ ...policy(), cutoff_hour: null }).cutoff_hour, null);
    for (const bad of [24, -1, 12.5, '14', true]) {
      assert.throws(() => server.validatePolicy({ ...policy(), cutoff_hour: bad }), VALIDATION, String(bad));
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
    const many = Array.from({ length: server.ZONE_LIMITS.maxZones + 1 }, (_, i) => ({ key: `z_${i}`, name_en: 'Z', name_bn: 'জ', charge: 10, team_charge: 10, days_min: 1, days_max: 2, districts: [] }));
    assert.throws(() => server.validatePolicy({ default_zone: 'z_0', zones: many }), VALIDATION);
    const noBn = policy();
    noBn.zones[0].name_bn = '  ';
    assert.throws(() => server.validatePolicy(noBn), VALIDATION);
    const long = policy();
    long.zones[0].name_en = 'x'.repeat(server.ZONE_LIMITS.nameMaxLength + 1);
    assert.throws(() => server.validatePolicy(long), VALIDATION);
    for (const field of ['charge', 'team_charge']) {
      for (const charge of [-1, 5000.01, 1.005, '60', null, undefined]) {
        const p = policy();
        p.zones[2][field] = charge;
        assert.throws(() => server.validatePolicy(p), VALIDATION, `${field}=${charge}`);
      }
    }
  });

  test('delivery days are whole days within the limits, and "from" is never after "to"', () => {
    for (const [min, max] of [[3, 2], [1.5, 2], [-1, 2], [1, server.DAYS_LIMITS.max + 1], ['1', 2], [undefined, 2]]) {
      const p = policy();
      p.zones[0].days_min = min;
      p.zones[0].days_max = max;
      assert.throws(() => server.validatePolicy(p), VALIDATION, `${min}-${max}`);
    }
    const same = policy();
    same.zones[0].days_min = 0;
    same.zones[0].days_max = 0;
    assert.equal(server.validatePolicy(same).zones[0].days_max, 0, 'same-day is allowed');
  });
});

describe('3b. a zones row from before migration 099 keeps its charges', () => {
  test('missing team charge and days are filled in, never the admin\'s charges thrown away', async () => {
    const old = { default_zone: 'outside_dhaka', zones: [
      { key: 'inside_dhaka', name_en: 'Inside Dhaka', name_bn: 'ঢাকার ভিতরে', charge: 70, districts: ['dhaka_city'] },
      { key: 'outside_dhaka', name_en: 'Outside Dhaka', name_bn: 'ঢাকার বাইরে', charge: 130, districts: [] },
    ] };
    const pool = { async query(sql, params = []) {
      return params[0] === 'delivery.zones' ? { rows: [{ key: 'delivery.zones', value_json: old }] } : { rows: [] };
    } };
    const p = await server.getPolicy(pool, null, { fresh: true });
    assert.deepEqual(p.zones.map((z) => [z.charge, z.team_charge, z.days_min, z.days_max]), [[70, 70, 1, 2], [130, 130, 3, 5]]);
  });

  test('but a corrupt field is still refused, not papered over', async () => {
    const bad = { default_zone: 'a', zones: [{ key: 'a', name_en: 'A', name_bn: 'A', charge: 70, team_charge: -5, districts: [] }] };
    const pool = { async query(sql, params = []) {
      return params[0] === 'delivery.zones' ? { rows: [{ key: 'delivery.zones', value_json: bad }] } : { rows: [] };
    } };
    assert.equal((await server.getPolicy(pool, null, { fresh: true })).zones[0].key, 'inside_dhaka', 'the shipped default');
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
    assert.match(src('repositories/order.repository.ts'), /live_stream_id, delivery_zone, /);
  });

  test('migration 099 adds team charge and days without overwriting, and moves the team charge out of the module', () => {
    const m = readFileSync(new URL('../src/db/migrations/099_delivery_zone_team_charge_and_days.sql', import.meta.url), 'utf8');
    assert.match(m, /WHEN z \? 'team_charge' THEN '\{\}'::jsonb/);
    assert.match(m, /WHEN z \? 'days_min' THEN '\{\}'::jsonb/);
    assert.match(m, /SET settings_json = COALESCE\(settings_json, '\{\}'::jsonb\) - 'shipping_charge'/);
    assert.match(m, /ALTER TABLE team_purchase_members[\s\S]*ADD COLUMN IF NOT EXISTS shipping_charge NUMERIC\(14,2\)/);
    assert.match(m, /ADD COLUMN IF NOT EXISTS delivery_days_min SMALLINT/);
    assert.match(src('repositories/order.repository.ts'), /delivery_zone, delivery_days_min, delivery_days_max, placed_at/);
    assert.match(src('services/checkout.service.ts'), /deliveryDaysMin: delivery\.zone\.days_min/);
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

describe('6. team purchase: each member pays their own zone\'s team charge (migration 099)', async () => {
  const team = await import('../src/services/teamPurchase.service.ts');
  const ZONES = server.validatePolicy(policy());
  const cache = { get: async () => null, set: async () => {} };

  /** A db answering by SQL text; delivery.zones is the three-zone policy above. */
  function db(handler) {
    const d = {
      calls: [],
      async query(sql, params = []) {
        d.calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('FROM platform_settings') && params[0] === 'delivery.zones') {
          return { rows: [{ key: 'delivery.zones', value_json: ZONES }] };
        }
        if (sql.includes('FROM platform_modules')) {
          return { rows: [{ key: 'group_buying', is_enabled: true, default_enabled: true, settings_json: {} }] };
        }
        return (await handler(sql, params)) || { rows: [] };
      },
      connect: async () => ({ query: d.query, release: () => {} }),
    };
    return d;
  }

  test('a member\'s charge follows the district they picked, and the wallet hold is group price + that charge', async () => {
    const openTeam = { id: 1, product_id: 501, required_members: 3, current_members_count: 1, group_price: '1700.00',
      shipping_charge: '50.00', status: 'ACTIVE', expires_at: new Date(Date.now() + 3600000).toISOString() };
    let member = null;
    const ledger = [];
    const pool = db((sql, params) => {
      if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [openTeam] };
      if (sql.includes('INSERT INTO team_purchase_members')) {
        member = params;
        return { rows: [{ id: 2, user_id: params[1], payment_method: params[3] }] };
      }
      if (sql.includes('FROM wallets')) return { rows: [{ id: 70, user_id: 20, available_balance: '5000.00', held_balance: '0.00' }] };
      if (sql.includes('INSERT INTO ledger_transactions')) { ledger.push(params); return { rows: [{ id: 1 }] }; }
      if (sql.includes('UPDATE wallets')) return { rows: [{ id: 70 }] };
      return { rows: [] };
    });
    await team.joinTeamPurchase(pool, cache, {
      userId: 20, teamId: 1, recipientName: 'Sumi', addressLine: 'House 3, Zindabazar', division: 'sylhet', district: 'sylhet_city',
      paymentMethod: 'WALLET',
    });
    assert.equal(member[6], '110.00', 'Sylhet is Outside Dhaka: team charge 110, not the starter\'s 50');
    assert.equal(member[7], 'outside_dhaka');
    assert.deepEqual(JSON.parse(member[2]), { recipient_name: 'Sumi', address_line: 'House 3, Zindabazar', division: 'sylhet', district: 'sylhet_city' });
    assert.ok(JSON.stringify(ledger).includes('1810.00'), '1700 + 110 held');
  });

  test('without a picked district the zone is found in the address text, else the default zone', async () => {
    assert.equal((await team.memberDelivery(db(() => null), null, { address_line: 'Tongi, Gazipur' })).zone.key, 'dhaka_suburbs');
    assert.equal((await team.memberDelivery(db(() => null), null, { address_line: 'Somewhere unknown' })).zone.key, 'outside_dhaka');
    assert.equal((await team.memberDelivery(db(() => null), null, { address_line: 'x', district: 'dhaka_city' })).chargePaisa, 5000);
  });

  test('completion charges every member their own snapshot and records zone and days on the order', async () => {
    const full = { id: 1, product_id: 501, required_members: 2, current_members_count: 1, group_price: '1700.00',
      shipping_charge: '50.00', status: 'ACTIVE', expires_at: new Date(Date.now() + 3600000).toISOString() };
    const orders = [];
    const pool = db((sql, params) => {
      if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [full] };
      if (sql.includes('INSERT INTO team_purchase_members')) return { rows: [{ id: 2, user_id: params[1], payment_method: params[3] }] };
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 501, ref: 'PRD-1', title_en: 'Saree', status: 'ACTIVE', stock_qty: 9, base_cost: '1200.00', wholesale_margin: '100.00', supplier_id: 5 }] };
      }
      if (sql.includes('FROM team_purchase_members tpm')) {
        return { rows: [
          { id: 1, user_id: 10, payment_method: 'COD', phone: '+8801700000010', shipping_charge: '50.00', delivery_zone: 'inside_dhaka',
            shipping_address_json: { recipient_name: 'Rahim', address_line: 'Road 7, Dhanmondi', division: 'dhaka', district: 'dhaka_city' } },
          { id: 2, user_id: 20, payment_method: 'COD', phone: '+8801700000020', shipping_charge: '110.00', delivery_zone: 'outside_dhaka',
            shipping_address_json: { recipient_name: 'Sumi', address_line: 'House 3, Zindabazar', division: 'sylhet', district: 'sylhet_city' } },
        ] };
      }
      if (sql.includes('INSERT INTO orders')) { orders.push(params); return { rows: [{ id: 100 + orders.length, ref: params[0] }] }; }
      if (sql.includes('INSERT INTO sub_orders')) return { rows: [{ id: 300 }] };
      return { rows: [] };
    });
    const res = await team.joinTeamPurchase(pool, cache, {
      userId: 20, teamId: 1, recipientName: 'Sumi', addressLine: 'House 3, Zindabazar', division: 'sylhet', district: 'sylhet_city',
    });
    assert.deepEqual(res.orders_created.map((o) => o.total_amount), ['1750.00', '1810.00']);
    // createOrder params: $5 shipping, $24 zone, $25/$26 days.
    assert.deepEqual(orders.map((p) => [p[4], p[23], p[24], p[25]]), [['50.00', 'inside_dhaka', 1, 2], ['110.00', 'outside_dhaka', 3, 5]]);
  });

  test('expiry gives a wallet member back exactly what was held: group price + their own charge', async () => {
    const expired = { id: 88, status: 'ACTIVE', group_price: '850.00', shipping_charge: '50.00' };
    const ledger = [];
    const pool = db((sql, params) => {
      if (sql.includes('expires_at <= now()')) return { rows: [{ id: 88 }] };
      if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [expired] };
      if (sql.includes('FROM team_purchase_members') && sql.includes('SELECT')) {
        return { rows: [{ id: 1, user_id: 7, payment_method: 'WALLET', hold_txn_group_id: 'g', shipping_charge: '110.00' }] };
      }
      if (sql.includes('FROM wallets')) return { rows: [{ id: 70, user_id: 7, available_balance: '0.00', held_balance: '960.00' }] };
      if (sql.includes('INSERT INTO ledger_transactions')) { ledger.push(params); return { rows: [{ id: 1 }] }; }
      if (sql.includes('UPDATE wallets')) return { rows: [{ id: 70 }] };
      if (sql.includes("'REFUNDED'")) return { rowCount: 1 };
      return { rows: [] };
    });
    await team.expireIncompleteTeams(pool, cache);
    assert.ok(JSON.stringify(ledger).includes('960.00'), '850 + 110, not 850 + the starter\'s 50');
  });

  test('the quote prices delivery for the district asked about', async () => {
    const pool = db((sql) => (sql.includes('FROM products')
      ? { rows: [{ id: 501, default_retail_price: '2000.00', base_cost: '1200.00', wholesale_margin: '100.00', status: 'ACTIVE', stock_qty: 9 }] }
      : { rows: [] }));
    const inside = await team.getQuote(pool, { productId: 501, district: 'dhaka_city' });
    const outside = await team.getQuote(pool, { productId: 501, district: 'bogura' });
    assert.equal(inside.shipping_charge, '50.00');
    assert.equal(outside.shipping_charge, '110.00');
    assert.deepEqual([outside.delivery_zone.key, outside.delivery_zone.days_min, outside.delivery_zone.days_max], ['outside_dhaka', 3, 5]);
  });

  test('server and client agree on every zone\'s team charge', () => {
    for (const d of BD_DISTRICT_IDS) assert.equal(client.resolveZone(ZONES, d).team_charge, server.resolveZone(ZONES, d).team_charge, d);
  });
});
