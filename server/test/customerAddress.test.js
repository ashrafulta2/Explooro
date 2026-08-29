/**
 * customerAddress.test.js — Customer Address Book: validation, transactional default management,
 * profile auto-seed, and the Fastify REST surface.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import customerRoutes from '../src/routes/customer.routes.js';
import * as addressService from '../src/services/customerAddress.service.js';

/**
 * Mock pool whose `.connect()` returns an in-transaction client backed by the same queryHandler,
 * so `withTransaction()` exercises the real BEGIN/COMMIT path. `calls` records every normalized
 * SQL statement in order for assertions about transactional sequencing.
 */
function createMockDb({ queryHandler = null } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    calls.push(normalizedSql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalizedSql)) return { rows: [] };
    if (queryHandler) return queryHandler(normalizedSql, params, sql);
    return { rows: [] };
  }
  const db = { query, calls };
  db.connect = async () => ({ query, release: () => {} });
  return db;
}

const ADDR_ROW = (over = {}) => ({
  id: 1,
  user_id: 42,
  label: 'HOME',
  custom_label: '',
  recipient_name: 'Fatema Begum',
  recipient_phone: '+8801711223344',
  division: 'dhaka',
  district: 'dhaka_city',
  upazila: 'Dhanmondi',
  address_line: 'House 42, Road 7/A',
  delivery_notes: '',
  postal_code: '1205',
  is_default: true,
  created_at: new Date().toISOString(),
  updated_at: null,
  ...over,
});

describe('Customer Address Book & Management System', () => {
  test('normalizes and validates Bangladeshi phone numbers', () => {
    assert.strictEqual(addressService.normalizeBdPhone('01711223344'), '+8801711223344');
    assert.strictEqual(addressService.normalizeBdPhone('8801812345678'), '+8801812345678');
    assert.strictEqual(addressService.normalizeBdPhone('+8801912345678'), '+8801912345678');
    assert.strictEqual(addressService.isValidBdPhone('01711223344'), true);
    assert.strictEqual(addressService.isValidBdPhone('01211223344'), false); // invalid carrier digit
    assert.strictEqual(addressService.isValidBdPhone('12345'), false);
  });

  test('getCustomerAddresses auto-seeds from the profile address exactly once, atomically', async () => {
    let seedAttempts = 0;
    const db = createMockDb({
      queryHandler: (sql, params) => {
        if (sql.startsWith('SELECT') && sql.includes('FROM user_addresses WHERE user_id = $1')) {
          return { rows: [] }; // empty book
        }
        if (sql.startsWith('INSERT INTO user_addresses') && sql.includes('SELECT u.id')) {
          seedAttempts += 1;
          return { rows: [ADDR_ROW({ id: 101, user_id: params[0] })] };
        }
        return { rows: [] };
      },
    });

    const addresses = await addressService.getCustomerAddresses(db, 42);
    assert.strictEqual(seedAttempts, 1);
    assert.strictEqual(addresses.length, 1);
    assert.strictEqual(addresses[0].is_default, true);
    // the seed is a single INSERT … SELECT … WHERE NOT EXISTS — no separate profile SELECT
    assert.ok(db.calls.some((c) => c.includes('NOT EXISTS (SELECT 1 FROM user_addresses')));
  });

  test('getCustomerAddresses returns [] (never throws) when the profile has no usable address', async () => {
    const db = createMockDb({ queryHandler: () => ({ rows: [] }) });
    const addresses = await addressService.getCustomerAddresses(db, 42);
    assert.deepStrictEqual(addresses, []);
  });

  test('createCustomerAddress: first address is default; runs in a transaction', async () => {
    let inserted = null;
    const db = createMockDb({
      queryHandler: (sql, params) => {
        if (sql.includes('COUNT(*)::int AS total FROM user_addresses')) return { rows: [{ total: 0 }] };
        if (sql.startsWith('INSERT INTO user_addresses') && sql.includes('($1, $2, $3, $4, $5')) {
          inserted = params;
          return { rows: [ADDR_ROW({ id: 201, label: params[1], custom_label: params[2], is_default: params[11] })] };
        }
        return { rows: [] };
      },
    });

    const result = await addressService.createCustomerAddress(db, 42, {
      label: 'HOME',
      recipient_name: 'Tanvir Ahmed',
      recipient_phone: '01812345678',
      division: 'Dhaka',
      district: 'Dhaka_City',
      address_line: 'Level 4, Plot 10, Gulshan 1',
    });

    assert.strictEqual(result.id, 201);
    assert.strictEqual(result.is_default, true); // auto-default: count was 0
    assert.ok(inserted, 'INSERT was issued');
    assert.strictEqual(inserted[4], '+8801812345678'); // phone normalized before insert
    assert.strictEqual(inserted[5], 'dhaka'); // division normalized to lowercase
    assert.strictEqual(inserted[11], true); // is_default persisted
    assert.deepStrictEqual(db.calls[0], 'BEGIN');
    assert.deepStrictEqual(db.calls[db.calls.length - 1], 'COMMIT');
  });

  test('createCustomerAddress: promoting a new default demotes the old one before insert', async () => {
    const db = createMockDb({
      queryHandler: (sql) => {
        if (sql.includes('COUNT(*)::int AS total FROM user_addresses')) return { rows: [{ total: 2 }] };
        if (sql.startsWith('INSERT INTO user_addresses')) return { rows: [ADDR_ROW({ id: 202, is_default: true })] };
        return { rows: [] };
      },
    });

    await addressService.createCustomerAddress(db, 42, {
      label: 'OFFICE', recipient_name: 'X', recipient_phone: '01712345678',
      division: 'dhaka', district: 'dhaka_city', address_line: 'road 1', is_default: true,
    });

    const clearIdx = db.calls.findIndex((c) => c.includes('SET is_default = false WHERE user_id = $1'));
    const insertIdx = db.calls.findIndex((c) => c.startsWith('INSERT INTO user_addresses'));
    assert.ok(clearIdx > -1 && insertIdx > -1 && clearIdx < insertIdx, 'default cleared before insert');
  });

  test('createCustomerAddress rejects a payload over the per-user cap', async () => {
    const db = createMockDb({
      queryHandler: (sql) =>
        sql.includes('COUNT(*)::int AS total FROM user_addresses')
          ? { rows: [{ total: addressService.MAX_ADDRESSES_PER_USER }] }
          : { rows: [] },
    });

    await assert.rejects(
      () =>
        addressService.createCustomerAddress(db, 42, {
          label: 'HOME', recipient_name: 'X', recipient_phone: '01712345678',
          division: 'dhaka', district: 'dhaka_city', address_line: 'road 1',
        }),
      (err) => err.code === 'VALIDATION_FAILED'
    );
  });

  test('validation: OTHER label requires a custom label, and bad input is VALIDATION_FAILED (HTTP 400)', async () => {
    const db = createMockDb();
    await assert.rejects(
      () =>
        addressService.createCustomerAddress(db, 42, {
          label: 'OTHER', custom_label: '  ', recipient_name: 'X', recipient_phone: '01712345678',
          division: 'dhaka', district: 'dhaka_city', address_line: 'road 1',
        }),
      (err) => err.code === 'VALIDATION_FAILED' && err.statusCode === 400
    );
    await assert.rejects(
      () => addressService.createCustomerAddress(db, 42, { label: 'HOME', recipient_name: 'X', recipient_phone: 'not-a-phone' }),
      (err) => err.code === 'VALIDATION_FAILED' && err.statusCode === 400
    );
  });

  test('updateCustomerAddress: ownership enforced, default transition handled in-transaction', async () => {
    const db = createMockDb({
      queryHandler: (sql, params) => {
        if (sql.startsWith('SELECT') && sql.includes('WHERE id = $1 AND user_id = $2')) {
          return { rows: [ADDR_ROW({ id: 301, is_default: false })] };
        }
        if (sql.startsWith('UPDATE user_addresses') && sql.includes('SET label = $1')) {
          return { rows: [ADDR_ROW({ id: 301, recipient_name: params[2], is_default: params[10] })] };
        }
        return { rows: [] };
      },
    });

    const result = await addressService.updateCustomerAddress(db, 42, 301, {
      label: 'HOME', recipient_name: 'Tanvir Updated', recipient_phone: '01799887766',
      division: 'chittagong', district: 'chittagong_city', address_line: 'Road 2, Block A', is_default: true,
    });
    assert.strictEqual(result.recipient_name, 'Tanvir Updated');
    assert.strictEqual(result.is_default, true);
    assert.ok(db.calls.some((c) => c.includes('SET is_default = false WHERE user_id = $1')));
  });

  test('updateCustomerAddress rejects an address the user does not own', async () => {
    const db = createMockDb({ queryHandler: () => ({ rows: [] }) });
    await assert.rejects(
      () =>
        addressService.updateCustomerAddress(db, 42, 999, {
          label: 'HOME', recipient_name: 'X', recipient_phone: '01712345678',
          division: 'dhaka', district: 'dhaka_city', address_line: 'road 1',
        }),
      (err) => err.code === 'NOT_FOUND'
    );
  });

  test('deleteCustomerAddress auto-promotes the most recent remaining address when the default is removed', async () => {
    let deleted = false;
    let promotedId = null;
    const db = createMockDb({
      queryHandler: (sql, params) => {
        if (sql.startsWith('SELECT') && sql.includes('WHERE id = $1 AND user_id = $2')) {
          return { rows: [ADDR_ROW({ id: 401, is_default: true })] };
        }
        if (sql.startsWith('DELETE FROM user_addresses')) { deleted = true; return { rows: [] }; }
        if (sql.includes('ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1')) {
          return { rows: [{ id: 402 }] };
        }
        if (sql.includes('SET is_default = true')) { promotedId = params[0]; return { rows: [ADDR_ROW({ id: params[0] })] }; }
        return { rows: [] };
      },
    });

    const result = await addressService.deleteCustomerAddress(db, 42, 401);
    assert.strictEqual(deleted, true);
    assert.strictEqual(promotedId, 402);
    assert.deepStrictEqual(result, { success: true, deleted_id: 401 });
  });

  test('setDefaultCustomerAddress clears every default before promoting the chosen one', async () => {
    const db = createMockDb({
      queryHandler: (sql, params) => {
        if (sql.startsWith('SELECT') && sql.includes('WHERE id = $1 AND user_id = $2')) {
          return { rows: [ADDR_ROW({ id: 501, is_default: false })] };
        }
        if (sql.includes('SET is_default = true')) return { rows: [ADDR_ROW({ id: params[0], is_default: true })] };
        return { rows: [] };
      },
    });

    const result = await addressService.setDefaultCustomerAddress(db, 42, 501);
    assert.strictEqual(result.is_default, true);
    const clearIdx = db.calls.findIndex((c) => c.includes('SET is_default = false WHERE user_id = $1'));
    const promoteIdx = db.calls.findIndex((c) => c.includes('SET is_default = true'));
    assert.ok(clearIdx > -1 && clearIdx < promoteIdx, 'defaults cleared before promotion');
  });

  test('Fastify REST surface: GET / POST / PUT / PATCH default / DELETE, and 400 on bad input', async () => {
    const db = createMockDb({
      queryHandler: (sql, params) => {
        if (sql.startsWith('SELECT') && sql.includes('FROM user_addresses WHERE user_id = $1')) {
          return { rows: [ADDR_ROW({ id: 601, custom_label: 'My Flat' })] };
        }
        if (sql.includes('COUNT(*)::int AS total FROM user_addresses')) return { rows: [{ total: 1 }] };
        if (sql.startsWith('INSERT INTO user_addresses')) return { rows: [ADDR_ROW({ id: 602, is_default: false })] };
        if (sql.startsWith('SELECT') && sql.includes('WHERE id = $1 AND user_id = $2')) {
          return { rows: [ADDR_ROW({ id: Number(params[0]), is_default: false })] };
        }
        if (sql.startsWith('UPDATE user_addresses') && sql.includes('SET label = $1')) {
          return { rows: [ADDR_ROW({ id: Number(params[11]), recipient_name: params[2], is_default: params[10] })] };
        }
        if (sql.includes('SET is_default = true')) return { rows: [ADDR_ROW({ id: Number(params[0]), is_default: true })] };
        if (sql.startsWith('DELETE FROM user_addresses')) return { rows: [] };
        return { rows: [] };
      },
    });

    const app = Fastify();
    app.decorate('db', db);
    app.decorate('authenticate', async (req) => { req.user = { id: 42, role: 'customer' }; });
    app.register(errorHandlerPlugin);
    await app.register(customerRoutes, { prefix: '/api/v1' });
    await app.ready();

    const getRes = await app.inject({ method: 'GET', url: '/api/v1/customer/addresses' });
    assert.strictEqual(getRes.statusCode, 200);
    assert.strictEqual(JSON.parse(getRes.payload).data.length, 1);

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customer/addresses',
      payload: {
        label: 'OFFICE', recipient_name: 'Office Branch', recipient_phone: '01812345678',
        division: 'dhaka', district: 'dhaka_city', address_line: 'Banani 11',
      },
    });
    assert.strictEqual(postRes.statusCode, 201);
    assert.strictEqual(JSON.parse(postRes.payload).data.id, 602);

    const badRes = await app.inject({
      method: 'POST',
      url: '/api/v1/customer/addresses',
      payload: { label: 'HOME', recipient_name: '', recipient_phone: 'x' },
    });
    assert.strictEqual(badRes.statusCode, 400);

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/customer/addresses/602',
      payload: {
        label: 'HOME', recipient_name: 'Renamed', recipient_phone: '01711223344',
        division: 'dhaka', district: 'dhaka_city', address_line: 'Banani 12',
      },
    });
    assert.strictEqual(putRes.statusCode, 200);

    const patchRes = await app.inject({ method: 'PATCH', url: '/api/v1/customer/addresses/602/default' });
    assert.strictEqual(patchRes.statusCode, 200);

    const delRes = await app.inject({ method: 'DELETE', url: '/api/v1/customer/addresses/602' });
    assert.strictEqual(delRes.statusCode, 200);

    await app.close();
  });
});
