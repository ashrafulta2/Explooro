/**
 * operations.ts — Mock API handlers for the payout / courier mode (migration 097).
 *
 * Mirrors server/src/routes/manualOperations.routes.ts for /admin/platform/operations. The payout
 * queue (handlers/admin.ts) and the supplier fulfilment pages (handlers/supplier.ts) read the same
 * modes through mockOperationsModes(), so a switch here changes what those pages offer, as it does
 * against the API. Persisted to localStorage like handlers/delivery.ts.
 */

import type { MockRoute } from '../types.ts';

const STORAGE_KEY = 'explooro:mock:operations:modes';
const OPTIONS = { payout_mode: ['MANUAL', 'GATEWAY'], courier_mode: ['MANUAL', 'INTEGRATED'] };
const DEFAULT_MODES = { payout_mode: 'MANUAL', courier_mode: 'MANUAL', updated_at: null, updated_by: null };

function loadModes() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (OPTIONS.payout_mode.includes(parsed?.payout_mode) && OPTIONS.courier_mode.includes(parsed?.courier_mode)) {
        return { ...DEFAULT_MODES, ...parsed };
      }
    }
  } catch {
    // Private browsing — the shipped default.
  }
  return { ...DEFAULT_MODES };
}

let mockModes = loadModes();
let mockHistory = [];

// The returns address (migration 105), empty as shipped, like the server's seed row.
const RETURN_ADDRESS_REQUIRED = ['name', 'phone', 'division', 'district', 'address_line'];
let mockReturnAddress = { name: '', phone: '', division: '', district: '', upazila: '', address_line: '', updated_at: null, updated_by: null };
const missingReturnAddress = () => RETURN_ADDRESS_REQUIRED.filter((f) => !String(mockReturnAddress[f] || '').trim());

/** The live mock modes, for the payout queue and supplier handlers. */
export function mockOperationsModes() {
  return mockModes;
}

const bad = (message_en, message_bn) => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en, message_bn } } });

export const operationsHandlers = [
  {
    method: 'GET',
    path: '/admin/platform/operations',
    handler() {
      return {
        status: 200,
        body: {
          modes: { ...mockModes },
          options: OPTIONS,
          history: mockHistory,
          return_address: { ...mockReturnAddress },
          return_address_missing: missingReturnAddress(),
          return_address_history: [],
          can_update: true,
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/admin/platform/operations',
    handler({ body = {} } = {}) {
      if (!OPTIONS.payout_mode.includes(body.payout_mode)) {
        return bad('Payout mode must be one of MANUAL, GATEWAY.', 'পেআউট মোড MANUAL, GATEWAY এর একটি হতে হবে।');
      }
      if (!OPTIONS.courier_mode.includes(body.courier_mode)) {
        return bad('Courier mode must be one of MANUAL, INTEGRATED.', 'কুরিয়ার মোড MANUAL, INTEGRATED এর একটি হতে হবে।');
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
      }
      const before = { payout_mode: mockModes.payout_mode, courier_mode: mockModes.courier_mode };
      mockModes = { payout_mode: body.payout_mode, courier_mode: body.courier_mode, updated_at: new Date().toISOString(), updated_by: 1 };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mockModes));
      } catch {
        // Non-fatal.
      }
      mockHistory = [{
        id: mockHistory.length + 1,
        action: 'platform.operations.update',
        actor_ref: 'USR-SUPERADMIN',
        created_at: mockModes.updated_at,
        before_json: before,
        after_json: { payout_mode: body.payout_mode, courier_mode: body.courier_mode },
        meta_json: { reason: body.reason.trim() },
      }, ...mockHistory].slice(0, 10);
      return {
        status: 200,
        body: {
          modes: { ...mockModes },
          message_en: 'Operations mode updated. It applies from the next action.',
          message_bn: 'অপারেশন মোড হালনাগাদ হয়েছে। পরের কাজ থেকেই এটি প্রযোজ্য।',
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/admin/platform/operations/return-address',
    handler({ body = {} } = {}) {
      // The server's rules in short (reversePickup.service validateReturnAddress).
      if (String(body.name || '').trim().length < 2) return bad('The name must be 2–80 characters.', 'নাম ২–৮০ অক্ষরের হতে হবে।');
      if (!/^(\+?880|0)?1[3-9]\d{8}$/.test(String(body.phone || '').replace(/[\s-]/g, ''))) {
        return bad('Enter a valid Bangladeshi mobile number.', 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন।');
      }
      if (!body.division || !body.district) return bad('Choose a district in that division.', 'ওই বিভাগের একটি জেলা বাছুন।');
      if (String(body.address_line || '').trim().length < 5) return bad('The address must be 5–200 characters.', 'ঠিকানা ৫–২০০ অক্ষরের হতে হবে।');
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
      }
      mockReturnAddress = {
        name: body.name.trim(),
        phone: body.phone.trim(),
        division: body.division,
        district: body.district,
        upazila: String(body.upazila || '').trim(),
        address_line: body.address_line.trim(),
        updated_at: new Date().toISOString(),
        updated_by: 1,
      };
      return {
        status: 200,
        body: {
          return_address: { ...mockReturnAddress },
          return_address_missing: missingReturnAddress(),
          message_en: 'Returns address saved. Couriers take returned products there from now on.',
          message_bn: 'ফেরতের ঠিকানা সংরক্ষিত হয়েছে। এখন থেকে কুরিয়ার ফেরত পণ্য সেখানে নেবে।',
        },
      };
    },
  },
] satisfies MockRoute[];

export default operationsHandlers;
