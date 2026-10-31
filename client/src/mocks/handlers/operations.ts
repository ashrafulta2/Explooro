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
      return { status: 200, body: { modes: { ...mockModes }, options: OPTIONS, history: mockHistory, can_update: true } };
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
] satisfies MockRoute[];

export default operationsHandlers;
