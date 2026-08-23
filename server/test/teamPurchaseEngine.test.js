/**
 * teamPurchaseEngine.test.js — Test suite for Prompt 9.5: Social Group Buying (Team Purchase).
 *
 * Tests:
 * 1. Team purchase creation with stock reservation and payment hold (HELD).
 * 2. Complete team assembly converting all member participations into real orders.
 * 3. Incomplete team expiration executing 100% automated refunds and stock release.
 * 4. Anti-gaming: double-join prevention and expired team completion rejection.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as teamPurchaseService from '../src/services/teamPurchase.service.js';

describe('Prompt 9.5: Social Group Buying (Team Purchase Engine)', () => {

  describe('1. Team Creation & Initiation', () => {
    test('Initiator starts a team at discounted group price with 24h countdown window', async () => {
      const mockProduct = {
        id: 501,
        name_en: 'Tangail Cotton Saree',
        base_price: '2000.00',
        stock_quantity: 25,
      };

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return {
              rows: [{
                key: 'group_buying',
                is_enabled: true,
                default_enabled: true,
                settings_json: {
                  default_team_size: 3,
                  window_hours: 24,
                  discount_pct: 20,
                },
              }],
            };
          }
          if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
            return { rows: [mockProduct] };
          }
          if (sql.includes('INSERT INTO team_purchases')) {
            return {
              rows: [{
                id: 1,
                ref: params[0],
                product_id: params[1],
                initiator_user_id: params[2],
                required_members: params[3],
                current_members_count: 1,
                group_price: params[4],
                original_price: params[5],
                status: 'ACTIVE',
                expires_at: params[6],
              }],
            };
          }
          if (sql.includes('INSERT INTO team_purchase_members')) {
            return {
              rows: [{
                id: 10,
                team_purchase_id: params[0],
                user_id: params[1],
                shipping_address_json: params[2],
                payment_method: params[3],
                payment_hold_status: 'HELD',
              }],
            };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      const result = await teamPurchaseService.createTeamPurchase(mockDb, mockCache, {
        userId: 10,
        productId: 501,
        shippingAddress: { street: 'Mirpur 10, Dhaka' },
        paymentMethod: 'BKASH',
      });

      assert.ok(result.team);
      assert.equal(result.team.initiator_user_id, 10);
      assert.equal(result.team.required_members, 3);
      assert.equal(result.team.current_members_count, 1);
      assert.equal(result.team.status, 'ACTIVE');
      // 20% discount on 2000.00 = 1600.00
      assert.equal(result.team.group_price, '1600.00');

      assert.ok(result.initiator_member);
      assert.equal(result.initiator_member.payment_hold_status, 'HELD');
    });
  });

  describe('2. Team Assembly & Order Conversion', () => {
    test('A team of 3 completing within the window creates 3 real orders at the discounted price', async () => {
      let teamRow = {
        id: 1,
        ref: 'TEAM-7X9P2A',
        product_id: 501,
        initiator_user_id: 10,
        required_members: 3,
        current_members_count: 2, // 2 members already joined, joining 3rd completes team
        group_price: '1600.00',
        original_price: '2000.00',
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 36000000).toISOString(),
      };

      const membersList = [
        { id: 1, team_purchase_id: 1, user_id: 10, shipping_address_json: '{}', payment_hold_status: 'HELD' },
        { id: 2, team_purchase_id: 1, user_id: 20, shipping_address_json: '{}', payment_hold_status: 'HELD' },
        { id: 3, team_purchase_id: 1, user_id: 30, shipping_address_json: '{}', payment_hold_status: 'HELD' },
      ];

      const ordersCreated = [];

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'group_buying', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) {
            return { rows: [teamRow] };
          }
          if (sql.includes('SELECT id FROM team_purchase_members WHERE team_purchase_id = $1 AND user_id = $2')) {
            // User 30 not in team yet
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO team_purchase_members')) {
            return {
              rows: [{
                id: 3,
                team_purchase_id: params[0],
                user_id: params[1],
                payment_hold_status: 'HELD',
              }],
            };
          }
          if (sql.includes('UPDATE team_purchases')) {
            teamRow = { ...teamRow, current_members_count: params[0], status: params[1] || 'ACTIVE' };
            return { rows: [teamRow] };
          }
          if (sql.includes('SELECT * FROM team_purchase_members WHERE team_purchase_id = $1')) {
            return { rows: membersList };
          }
          if (sql.includes('INSERT INTO orders')) {
            const ord = {
              id: ordersCreated.length + 101,
              user_id: params[0],
              order_ref: params[1],
              status: 'PLACED',
              total_amount: params[2],
            };
            ordersCreated.push(ord);
            return { rows: [ord] };
          }
          if (sql.includes('UPDATE team_purchase_members SET payment_hold_status = \'CAPTURED\'')) {
            return { rows: [{ id: params[1] }] };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      // User 30 joins as 3rd member
      const joinResult = await teamPurchaseService.joinTeamPurchase(mockDb, mockCache, {
        userId: 30,
        teamId: 1,
        shippingAddress: { street: 'Dhanmondi 27' },
        paymentMethod: 'COD',
      });

      assert.equal(joinResult.completed, true);
      assert.equal(joinResult.team.status, 'COMPLETED');
      assert.equal(joinResult.team.current_members_count, 3);

      // Verify 3 real standard orders were created at group price (1600.00)
      assert.equal(ordersCreated.length, 3);
      ordersCreated.forEach((ord) => {
        assert.equal(ord.status, 'PLACED');
        assert.equal(ord.total_amount, '1600.00');
      });
    });
  });

  describe('3. Automated Expiration & Full Refunds', () => {
    test('An expired incomplete team refunds every member fully and updates status to EXPIRED', async () => {
      const expiredTeam = {
        id: 88,
        ref: 'TEAM-EXPIRED',
        product_id: 501,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      };

      let statusUpdated = false;
      let membersRefundedCount = 0;

      const mockDb = {
        query: async (sql, params = []) => {
          if (sql.includes('FROM team_purchases') && sql.includes("status = 'ACTIVE'") && sql.includes('expires_at <= now()')) {
            return { rows: [expiredTeam] };
          }
          if (sql.includes('UPDATE team_purchases') && sql.includes("status = 'EXPIRED'")) {
            statusUpdated = true;
            return { rows: [{ id: params[0], status: 'EXPIRED' }] };
          }
          if (sql.includes('UPDATE team_purchase_members') && sql.includes("payment_hold_status = 'REFUNDED'")) {
            membersRefundedCount = 2; // 2 members held in expired team
            return { rowCount: 2 };
          }
          return { rows: [] };
        },
        connect: async function () {
          return {
            query: this.query,
            release: () => {},
          };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      const result = await teamPurchaseService.expireIncompleteTeams(mockDb, mockCache);

      assert.equal(result.expiredCount, 1);
      assert.equal(result.refundedCount, 2);
      assert.equal(statusUpdated, true);
    });
  });

  describe('4. Anti-Gaming & Double-Join Prevention', () => {
    test('A user cannot join the same team twice', async () => {
      const teamRow = {
        id: 1,
        status: 'ACTIVE',
        required_members: 3,
        current_members_count: 1,
        expires_at: new Date(Date.now() + 36000000).toISOString(),
      };

      const mockDb = {
        query: async (sql) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'group_buying', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) {
            return { rows: [teamRow] };
          }
          if (sql.includes('SELECT id FROM team_purchase_members WHERE team_purchase_id = $1 AND user_id = $2')) {
            // Existing member found!
            return { rows: [{ id: 10 }] };
          }
          return { rows: [] };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      await assert.rejects(
        async () => {
          await teamPurchaseService.joinTeamPurchase(mockDb, mockCache, {
            userId: 10,
            teamId: 1,
          });
        },
        (err) => {
          assert.equal(err.code || err.message, 'ALREADY_JOINED_TEAM');
          return true;
        }
      );
    });

    test('An expired team cannot be joined', async () => {
      const expiredTeam = {
        id: 1,
        status: 'ACTIVE',
        required_members: 3,
        current_members_count: 1,
        expires_at: new Date(Date.now() - 3600000).toISOString(), // expired
      };

      const mockDb = {
        query: async (sql) => {
          if (sql.includes('FROM platform_modules')) {
            return { rows: [{ key: 'group_buying', is_enabled: true, default_enabled: true }] };
          }
          if (sql.includes('FROM team_purchases') && sql.includes('FOR UPDATE')) {
            return { rows: [expiredTeam] };
          }
          return { rows: [] };
        },
      };

      const mockCache = { get: async () => null, set: async () => {} };

      await assert.rejects(
        async () => {
          await teamPurchaseService.joinTeamPurchase(mockDb, mockCache, {
            userId: 25,
            teamId: 1,
          });
        },
        (err) => {
          assert.equal(err.code || err.message, 'TEAM_EXPIRED');
          return true;
        }
      );
    });
  });

});
