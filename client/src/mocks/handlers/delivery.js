/**
 * delivery.js — Mock API handlers for the per-parcel delivery charge.
 *
 * Mirrors server/src/routes/deliveryCharge.routes.js. The mock cart (handlers/cart.js) prices
 * delivery with the same value, so a change here shows up in the cart, as it does against the API.
 * Persisted to localStorage for the same reason handlers/genie.js does: "does it survive a reload?"
 */

const STORAGE_KEY = 'explooro:mock:delivery:policy';
const LIMITS = { min: 0, max: 5000 };
const DEFAULT_POLICY = { per_parcel_charge: 60, updated_at: null, updated_by: null };

function loadPolicy() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.per_parcel_charge)) return { ...DEFAULT_POLICY, ...parsed };
    }
  } catch {
    // Private browsing — the shipped default.
  }
  return { ...DEFAULT_POLICY };
}

let mockPolicy = loadPolicy();
let mockHistory = [];

/** The charge the mock cart uses. */
export function mockDeliveryCharge() {
  return mockPolicy.per_parcel_charge;
}

const bad = (message_en, message_bn) => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en, message_bn } } });

export const deliveryHandlers = [
  {
    method: 'GET',
    path: '/delivery/policy',
    handler() {
      return { status: 200, body: { policy: { per_parcel_charge: mockPolicy.per_parcel_charge } } };
    },
  },
  {
    method: 'GET',
    path: '/admin/platform/delivery',
    handler() {
      return { status: 200, body: { policy: { ...mockPolicy }, limits: { ...LIMITS }, history: mockHistory, can_update: true } };
    },
  },
  {
    method: 'PUT',
    path: '/admin/platform/delivery',
    handler({ body = {} } = {}) {
      const charge = body.per_parcel_charge;
      if (typeof charge !== 'number' || !Number.isFinite(charge) || charge < LIMITS.min || charge > LIMITS.max
        || Math.round(charge * 100) !== charge * 100) {
        return bad(
          `The delivery charge must be between ৳${LIMITS.min} and ৳${LIMITS.max}, in whole paisa.`,
          `ডেলিভারি চার্জ ৳${LIMITS.min} থেকে ৳${LIMITS.max} এর মধ্যে হতে হবে।`
        );
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
      }
      const before = mockPolicy.per_parcel_charge;
      mockPolicy = { per_parcel_charge: charge, updated_at: new Date().toISOString(), updated_by: 1 };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mockPolicy));
      } catch {
        // Non-fatal.
      }
      mockHistory = [{
        id: mockHistory.length + 1,
        action: 'platform.delivery.update',
        actor_ref: 'USR-SUPERADMIN',
        created_at: mockPolicy.updated_at,
        before_json: { per_parcel_charge: before },
        after_json: { per_parcel_charge: charge, meta: { reason: body.reason.trim() } },
      }, ...mockHistory].slice(0, 10);
      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          message_en: 'Delivery charge updated. New carts and orders use it now.',
          message_bn: 'ডেলিভারি চার্জ হালনাগাদ হয়েছে। নতুন কার্ট ও অর্ডারে এখন থেকেই এটি প্রযোজ্য।',
        },
      };
    },
  },
];

export default deliveryHandlers;
