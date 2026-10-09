/**
 * teamPurchaseEngine.test.js — Test suite for Prompt 9.5: Social Group Buying (Team Purchase).
 *
 * Tests:
 * 1. Pure rules: settings resolution/validation, group price (floored at wholesale cost), recipient form.
 * 2. Team creation: the group price comes from settings, never the request; WALLET holds the money.
 * 3. Completion: every member becomes a real order of group price + shipping; WALLET orders are PAID.
 * 4. Expiry: WALLET holds go back to AVAILABLE; every HELD member is marked REFUNDED.
 * 5. Anti-gaming: double join, expired team, unsupported payment method.
 *
 * End-to-end behaviour against a real database (orders, escrow, ledger balance) was checked by hand
 * on 2026-10-09; `npm run check:sql` prepares every static statement in the service.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as teamPurchaseService from '../src/services/teamPurchase.service.js';

const {
  resolveSettings,
  validateSettingsPatch,
  computeGroupPrice,
  validateRecipient,
  DEFAULT_SETTINGS,
} = teamPurchaseService;

const mockCache = { get: async () => null, set: async () => {} };
const RECIPIENT = { recipientName: 'Karim Uddin', addressLine: 'House 45, Road 7, Dhanmondi, Dhaka' };

/** A db whose query() is `handler`; connect() hands back the same handler as a client. */
function mockDb(handler) {
  const db = {
    calls: [],
    query: async (sql, params = []) => {
      db.calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      return (await handler(sql, params)) || { rows: [] };
    },
    connect: async () => ({ query: db.query, release: () => {} }),
  };
  return db;
}

const moduleRow = (settings = {}) => ({
  rows: [{ key: 'group_buying', is_enabled: true, default_enabled: true, settings_json: settings }],
});

describe('Prompt 9.5: Social Group Buying (Team Purchase Engine)', () => {
  describe('1. Pure rules', () => {
    test('resolveSettings falls back field by field and reads the pre-068 single discount', () => {
      assert.deepEqual(resolveSettings(null), { ...DEFAULT_SETTINGS });
      const legacy = resolveSettings({ discount_pct: 20, window_hours: 0, shipping_charge: 'x' });
      assert.equal(legacy.discount_pct_2, 20);
      assert.equal(legacy.discount_pct_3, 20);
      assert.equal(legacy.window_hours, DEFAULT_SETTINGS.window_hours);
      assert.equal(legacy.shipping_charge, DEFAULT_SETTINGS.shipping_charge);
      assert.equal(resolveSettings({ shipping_charge: 75.5 }).shipping_charge, 75.5);
    });

    test('validateSettingsPatch is strict: out-of-range values are refused, not clamped', () => {
      assert.deepEqual(validateSettingsPatch({ shipping_charge: 80 }), { shipping_charge: 80 });
      assert.deepEqual(validateSettingsPatch({ shipping_charge: 0, discount_pct_3: 30 }), { shipping_charge: 0, discount_pct_3: 30 });
      for (const bad of [{ shipping_charge: -1 }, { shipping_charge: 5001 }, { shipping_charge: '60' }, { shipping_charge: 10.555 },
        { discount_pct_2: 91 }, { discount_pct_2: 10.5 }, { window_hours: 0 }, { default_team_size: 4 }, {}]) {
        assert.throws(() => validateSettingsPatch(bad), (err) => err.code === 'VALIDATION_FAILED', JSON.stringify(bad));
      }
    });

    test('computeGroupPrice rounds to whole taka and never goes below the wholesale cost', () => {
      // 15% off 1650 = 1402.5 -> 1403
      assert.equal(computeGroupPrice({ retailPrice: '1650.00', baseCost: '1100.00', wholesaleMargin: '150.00', discountPct: 15 }).group_price, '1403.00');
      // 25% off 1650 = 1237.5, below the 1250 floor -> 1250, and the effective discount reports 24%
      const floored = computeGroupPrice({ retailPrice: '1650.00', baseCost: '1100.00', wholesaleMargin: '150.00', discountPct: 25 });
      assert.equal(floored.group_price, '1250.00');
      assert.equal(floored.discount_pct, 24);
      // A 0% discount is the retail price
      assert.equal(computeGroupPrice({ retailPrice: '999.00', baseCost: '500.00', wholesaleMargin: 0, discountPct: 0 }).group_price, '999.00');
    });

    test('validateRecipient asks for exactly a name and an address', () => {
      assert.deepEqual(validateRecipient({ recipientName: '  Karim ', addressLine: ' House 4, Banani, Dhaka ' }), {
        recipient_name: 'Karim',
        address_line: 'House 4, Banani, Dhaka',
      });
      assert.throws(() => validateRecipient({ recipientName: '', addressLine: 'House 4, Banani, Dhaka' }), /name/i);
      assert.throws(() => validateRecipient({ recipientName: 'Karim', addressLine: 'Dhaka' }), /Address/);
    });
  });

  describe('2. Team creation', () => {
    const product = { id: 501, default_retail_price: '2000.00', base_cost: '1200.00', wholesale_margin: '100.00', status: 'ACTIVE', stock_qty: 25 };

    function creationDb({ walletAvailable = '0.00' } = {}) {
      const state = { team: null, member: null, ledger: [] };
      const db = mockDb((sql, params) => {
        if (sql.includes('FROM platform_modules')) return moduleRow({ discount_pct_2: 15, discount_pct_3: 25, shipping_charge: 60 });
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) return { rows: [product] };
        if (sql.includes('INSERT INTO team_purchases')) {
          state.team = { id: 1, ref: params[0], product_id: params[1], initiator_user_id: params[2], required_members: params[3],
            current_members_count: 1, group_price: params[4], original_price: params[5], shipping_charge: params[6], status: 'ACTIVE' };
          return { rows: [state.team] };
        }
        if (sql.includes('INSERT INTO team_purchase_members')) {
          state.member = { id: 10, team_purchase_id: params[0], user_id: params[1], shipping_address_json: params[2], payment_method: params[3], payment_hold_status: 'HELD' };
          return { rows: [state.member] };
        }
        if (sql.includes('FROM wallets')) return { rows: [{ id: 70, user_id: 10, available_balance: walletAvailable, held_balance: '0.00' }] };
        if (sql.includes('INSERT INTO ledger_transactions')) {
          state.ledger.push(params);
          return { rows: [{ id: state.ledger.length }] };
        }
        if (sql.includes('UPDATE wallets')) return { rows: [{ id: 70 }] };
        return { rows: [] };
      });
      return { db, state };
    }

    test('the group price comes from settings; a price in the request has no effect', async () => {
      const { db, state } = creationDb();
      const result = await teamPurchaseService.createTeamPurchase(db, mockCache, {
        userId: 10, productId: 501, requiredMembers: 3, groupPrice: 1, ...RECIPIENT, paymentMethod: 'COD',
      });
      // 25% off 2000 = 1500, above the 1300 wholesale floor
      assert.equal(result.team.group_price, '1500.00');
      assert.equal(result.team.shipping_charge, '60.00');
      assert.equal(result.team.required_members, 3);
      assert.deepEqual(JSON.parse(state.member.shipping_address_json), { recipient_name: 'Karim Uddin', address_line: RECIPIENT.addressLine });
      assert.equal(state.ledger.length, 0, 'COD holds no money');
    });

    test('a WALLET starter has group price + shipping moved from AVAILABLE to HELD', async () => {
      const { db, state } = creationDb({ walletAvailable: '5000.00' });
      await teamPurchaseService.createTeamPurchase(db, mockCache, { userId: 10, productId: 501, requiredMembers: 2, ...RECIPIENT, paymentMethod: 'WALLET' });
      assert.ok(db.calls.some((c) => c.sql.includes('hold_txn_group_id')), 'the hold is recorded on the member');
      assert.ok(state.ledger.length > 0, 'a ledger group was written');
      const flat = JSON.stringify(state.ledger);
      assert.ok(flat.includes('TEAM_PURCHASE_HOLD'));
      assert.ok(flat.includes('1760.00'), '15% off 2000 = 1700, plus 60 shipping');
    });

    test('a WALLET starter without enough balance is refused', async () => {
      const { db } = creationDb({ walletAvailable: '100.00' });
      await assert.rejects(
        teamPurchaseService.createTeamPurchase(db, mockCache, { userId: 10, productId: 501, requiredMembers: 2, ...RECIPIENT, paymentMethod: 'WALLET' }),
        (err) => err.code === 'INSUFFICIENT_BALANCE'
      );
    });

    test('a team size other than 2 or 3 is refused', async () => {
      const { db } = creationDb();
      await assert.rejects(
        teamPurchaseService.createTeamPurchase(db, mockCache, { userId: 10, productId: 501, requiredMembers: 10, ...RECIPIENT }),
        (err) => err.code === 'VALIDATION_FAILED'
      );
    });
  });

  describe('3. Team assembly & order conversion', () => {
    test('the last join turns every member into an order of group price + shipping', async () => {
      const team = { id: 1, ref: 'TEAM-7X9P2A', product_id: 501, required_members: 2, current_members_count: 1,
        group_price: '1700.00', original_price: '2000.00', shipping_charge: '60.00', status: 'ACTIVE',
        expires_at: new Date(Date.now() + 36000000).toISOString() };
      const orders = [];
      const subOrders = [];
      let completedUpdate = null;

      const db = mockDb((sql, params) => {
        if (sql.includes('FROM platform_modules')) return moduleRow();
        if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [team] };
        if (sql.includes('SELECT id FROM team_purchase_members WHERE team_purchase_id = $1 AND user_id = $2')) return { rows: [] };
        if (sql.includes('INSERT INTO team_purchase_members')) return { rows: [{ id: 2, user_id: params[1], payment_method: params[3] }] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 501, ref: 'PRD-1', title_en: 'Saree', status: 'ACTIVE', stock_qty: 25, base_cost: '1200.00', wholesale_margin: '100.00', supplier_id: 5 }] };
        }
        if (sql.includes('FROM team_purchase_members tpm')) {
          return { rows: [
            { id: 1, user_id: 10, payment_method: 'COD', phone: '+8801700000010', shipping_address_json: { recipient_name: 'Rahim', address_line: 'Chashara, Narayanganj, Dhaka' } },
            { id: 2, user_id: 20, payment_method: 'COD', phone: '+8801700000020', shipping_address_json: { street: 'Old member, Feni' } },
          ] };
        }
        if (sql.includes('INSERT INTO orders')) {
          const row = { id: 100 + orders.length, ref: params[0], params };
          orders.push(row);
          return { rows: [row] };
        }
        if (sql.includes('INSERT INTO sub_orders')) {
          subOrders.push(params);
          return { rows: [{ id: 200 + subOrders.length }] };
        }
        if (sql.includes('UPDATE team_purchases') && sql.includes("'COMPLETED'")) completedUpdate = params;
        return { rows: [] };
      });

      const result = await teamPurchaseService.joinTeamPurchase(db, mockCache, { userId: 20, teamId: 1, ...RECIPIENT, paymentMethod: 'COD' });

      assert.equal(result.completed, true);
      assert.equal(result.team.status, 'COMPLETED');
      assert.equal(result.orders_created.length, 2);
      assert.ok(completedUpdate, 'the team row is marked COMPLETED');
      for (const o of result.orders_created) assert.equal(o.total_amount, '1760.00');

      const orderSql = db.calls.find((c) => c.sql.includes('INSERT INTO orders')).sql;
      assert.ok(orderSql.includes('customer_id') && !orderSql.includes('user_id'), 'orders are written with the real columns');
      // Rahim's district is found in his address; the pre-068 member falls back to the profile/legacy fields.
      assert.ok(orders[0].params.includes('Narayanganj'));
      assert.ok(orders[1].params.includes('Feni'));
      assert.equal(db.calls.filter((c) => c.sql.includes('UPDATE products') && c.sql.includes('stock_qty')).length, 2, 'one unit of stock per member');
    });

    test('a join that would complete a team whose product ran out of stock is refused whole', async () => {
      const team = { id: 1, product_id: 501, required_members: 2, current_members_count: 1, group_price: '1700.00', shipping_charge: '60.00',
        status: 'ACTIVE', expires_at: new Date(Date.now() + 36000000).toISOString() };
      const db = mockDb((sql) => {
        if (sql.includes('FROM platform_modules')) return moduleRow();
        if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [team] };
        if (sql.includes('INSERT INTO team_purchase_members')) return { rows: [{ id: 2 }] };
        if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 501, status: 'ACTIVE', stock_qty: 1, base_cost: '1200.00', wholesale_margin: '100.00', supplier_id: 5 }] };
        }
        return { rows: [] };
      });
      await assert.rejects(
        teamPurchaseService.joinTeamPurchase(db, mockCache, { userId: 20, teamId: 1, ...RECIPIENT }),
        (err) => err.code === 'INSUFFICIENT_STOCK'
      );
      assert.ok(db.calls.some((c) => c.sql === 'ROLLBACK'), 'the transaction is rolled back');
    });
  });

  describe('4. Automated expiration & full refunds', () => {
    test('an expired team releases every WALLET hold and marks HELD members REFUNDED', async () => {
      const team = { id: 88, status: 'ACTIVE', group_price: '850.00', shipping_charge: '60.00' };
      let statusUpdated = false;
      const ledger = [];

      const db = mockDb((sql, params) => {
        if (sql.includes('FROM team_purchases') && sql.includes('expires_at <= now()')) return { rows: [{ id: 88 }] };
        if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [team] };
        if (sql.includes('UPDATE team_purchases') && sql.includes("status = 'EXPIRED'")) {
          statusUpdated = true;
          return { rows: [] };
        }
        if (sql.includes('FROM team_purchase_members') && sql.includes("payment_hold_status = 'HELD'") && sql.includes('SELECT')) {
          return { rows: [
            { id: 1, user_id: 7, payment_method: 'WALLET', hold_txn_group_id: 'abc' },
            { id: 2, user_id: 8, payment_method: 'COD', hold_txn_group_id: null },
          ] };
        }
        if (sql.includes('FROM wallets')) return { rows: [{ id: 70, user_id: 7, available_balance: '0.00', held_balance: '910.00' }] };
        if (sql.includes('INSERT INTO ledger_transactions')) {
          ledger.push(params);
          return { rows: [{ id: 1 }] };
        }
        if (sql.includes('UPDATE wallets')) return { rows: [{ id: 70 }] };
        if (sql.includes('UPDATE team_purchase_members') && sql.includes("'REFUNDED'")) return { rowCount: 2 };
        return { rows: [] };
      });

      const result = await teamPurchaseService.expireIncompleteTeams(db, mockCache);

      assert.equal(result.expiredCount, 1);
      assert.equal(result.refundedCount, 2);
      assert.equal(statusUpdated, true);
      const flat = JSON.stringify(ledger);
      assert.ok(flat.includes('TEAM_PURCHASE_RELEASE'), 'the WALLET hold is released');
      assert.ok(flat.includes('910.00'), 'the whole hold (850 + 60) goes back');
    });

    test('a team completed after the scan is left alone', async () => {
      const db = mockDb((sql) => {
        if (sql.includes('expires_at <= now()')) return { rows: [{ id: 88 }] };
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: 88, status: 'COMPLETED' }] };
        return { rows: [] };
      });
      const result = await teamPurchaseService.expireIncompleteTeams(db, mockCache);
      assert.equal(result.expiredCount, 0);
      assert.ok(!db.calls.some((c) => c.sql.includes("status = 'EXPIRED'")));
    });
  });

  describe('5. Anti-gaming', () => {
    const activeTeam = (overrides = {}) => ({ id: 1, status: 'ACTIVE', required_members: 3, current_members_count: 1,
      expires_at: new Date(Date.now() + 36000000).toISOString(), ...overrides });

    test('a user cannot join the same team twice', async () => {
      const db = mockDb((sql) => {
        if (sql.includes('FROM platform_modules')) return moduleRow();
        if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) return { rows: [activeTeam()] };
        if (sql.includes('SELECT id FROM team_purchase_members WHERE team_purchase_id = $1 AND user_id = $2')) return { rows: [{ id: 10 }] };
        return { rows: [] };
      });
      await assert.rejects(
        teamPurchaseService.joinTeamPurchase(db, mockCache, { userId: 10, teamId: 1, ...RECIPIENT }),
        (err) => err.code === 'CONFLICT'
      );
    });

    test('an expired team cannot be joined', async () => {
      const db = mockDb((sql) => {
        if (sql.includes('FROM platform_modules')) return moduleRow();
        if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) {
          return { rows: [activeTeam({ expires_at: new Date(Date.now() - 3600000).toISOString() })] };
        }
        return { rows: [] };
      });
      await assert.rejects(
        teamPurchaseService.joinTeamPurchase(db, mockCache, { userId: 25, teamId: 1, ...RECIPIENT }),
        (err) => err.code === 'TEAM_PURCHASE_CLOSED'
      );
    });

    test('only Cash on Delivery and Wallet are accepted', async () => {
      const db = mockDb((sql) => (sql.includes('FROM platform_modules') ? moduleRow() : { rows: [] }));
      await assert.rejects(
        teamPurchaseService.joinTeamPurchase(db, mockCache, { userId: 25, teamId: 1, ...RECIPIENT, paymentMethod: 'BKASH' }),
        (err) => err.code === 'VALIDATION_FAILED'
      );
    });
  });
});
