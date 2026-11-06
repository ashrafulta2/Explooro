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

// Who pays to send a return back (migration 106), equal to the server's seed.
const RETURN_REASONS = ['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'SIZE_MISMATCH', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER'];
const RETURN_SHIPPING_LIMITS = { max_courier_refund: { min: 0, max: 2000 }, pickup_fee: { min: 0, max: 1000 }, customer_courier_cost: { min: 0, max: 100000 } };
let mockReturnShipping = { supplier_fault_reasons: ['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'NOT_AS_DESCRIBED'], max_courier_refund: 150, pickup_fee: 100, updated_at: null, updated_by: null };

// Two booked courier pickups, one billed, one not, so the reconciliation card has rows.
const mockPickups = [
  { id: 1, ref: 'REV-RET-2026-0039-A1B2C3', kind: 'RETURN', carrier: 'STEADFAST', tracking_number: 'CID-1730000000001', status: 'DELIVERED', created_at: new Date(Date.now() - 6 * 86400000).toISOString(), courier_charge: '70.00', fee_charged: '100.00', fee_charged_from: 'CUSTOMER', courier_billed: '130.00', billed_recorded_at: new Date(Date.now() - 2 * 86400000).toISOString(), return_ref: 'RET-2026-0039', claim_ref: null },
  { id: 2, ref: 'REV-CLM-2026-0007-D4E5F6', kind: 'WARRANTY', carrier: 'PATHAO', tracking_number: 'PTH-88213', status: 'IN_TRANSIT', created_at: new Date(Date.now() - 1 * 86400000).toISOString(), courier_charge: '60.00', fee_charged: null, fee_charged_from: null, courier_billed: null, billed_recorded_at: null, return_ref: null, claim_ref: 'CLM-2026-0007' },
];

/** The live mock return-shipping rules, for the returns handlers. */
export function mockReturnShippingPolicy() {
  return mockReturnShipping;
}

/** The returns address as GET /returns/my-returns sends it (`send_back`), or null while incomplete. */
export function mockSendBackAddress() {
  if (missingReturnAddress().length > 0) return null;
  const { updated_at, updated_by, ...address } = mockReturnAddress;
  return address;
}

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
          return_shipping: { ...mockReturnShipping },
          return_shipping_options: { reasons: RETURN_REASONS, limits: RETURN_SHIPPING_LIMITS },
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
  {
    method: 'PUT',
    path: '/admin/platform/operations/return-shipping',
    handler({ body = {} } = {}) {
      const reasons = Array.isArray(body.supplier_fault_reasons) ? body.supplier_fault_reasons : null;
      if (!reasons || reasons.some((r) => !RETURN_REASONS.includes(r))) {
        return bad('Fault reasons must be from the return reasons.', 'কারণগুলো রিটার্নের কারণ থেকে হতে হবে।');
      }
      for (const key of ['max_courier_refund', 'pickup_fee']) {
        const n = Number(body[key]);
        const { min, max } = RETURN_SHIPPING_LIMITS[key];
        if (!Number.isInteger(n) || n < min || n > max) return bad(`${key} must be a whole number of Taka from ${min} to ${max}.`, `${key} ${min} থেকে ${max} এর মধ্যে পূর্ণ টাকা হতে হবে।`);
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
      }
      mockReturnShipping = {
        supplier_fault_reasons: RETURN_REASONS.filter((r) => reasons.includes(r)),
        max_courier_refund: Number(body.max_courier_refund),
        pickup_fee: Number(body.pickup_fee),
        updated_at: new Date().toISOString(),
        updated_by: 1,
      };
      return {
        status: 200,
        body: {
          return_shipping: { ...mockReturnShipping },
          message_en: 'Return shipping rules saved. They apply to returns refunded from now on.',
          message_bn: 'ফেরত পাঠানোর খরচের নিয়ম সংরক্ষিত হয়েছে। এখন থেকে যে রিটার্নের টাকা ফেরত হবে তাতে প্রযোজ্য।',
        },
      };
    },
  },
  // Pickup charges vs courier quotes and bills (migration 107), as reversePickup.service getPickupCharges.
  {
    method: 'GET',
    path: '/admin/platform/operations/pickup-charges',
    handler({ query = {} } = {}) {
      const days = Math.min(365, Math.max(1, parseInt(query.days, 10) || 30));
      const gap = (p) => {
        const cost = p.courier_billed ?? p.courier_charge;
        return cost == null || p.fee_charged == null ? null : (Number(p.fee_charged) - Number(cost)).toFixed(2);
      };
      const collected = mockPickups.reduce((s, p) => s + (Number(p.fee_charged) || 0), 0);
      const cost = mockPickups.reduce((s, p) => s + (Number(p.courier_billed ?? p.courier_charge) || 0), 0);
      return {
        status: 200,
        body: {
          days,
          totals: {
            pickups: mockPickups.length,
            unbilled: mockPickups.filter((p) => p.courier_billed == null).length,
            collected: collected.toFixed(2),
            cost: cost.toFixed(2),
            gap: (collected - cost).toFixed(2),
          },
          pickups: mockPickups.map((p) => ({ ...p, gap: gap(p) })),
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/admin/platform/operations/pickup-charges/:id/bill',
    handler({ params, body = {} } = {}) {
      const p = mockPickups.find((x) => String(x.id) === String(params?.id));
      if (!p) return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'No such pickup.', message_bn: 'এমন কোনো পিকআপ নেই।' } } };
      const n = Number(body.amount);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return bad('The bill must be an amount from 0 to 100000 Taka.', 'বিলের টাকা ০ থেকে ১০০০০০ এর মধ্যে হতে হবে।');
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
      }
      p.courier_billed = n.toFixed(2);
      p.billed_recorded_at = new Date().toISOString();
      return { status: 200, body: { pickup: p, message_en: 'Courier bill recorded.', message_bn: 'কুরিয়ারের বিল লেখা হয়েছে।' } };
    },
  },
] satisfies MockRoute[];

export default operationsHandlers;
