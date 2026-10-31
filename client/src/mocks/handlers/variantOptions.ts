/**
 * variantOptions.ts — Mock API for which variant options each category offers.
 *
 * Mirrors server/src/routes/variantOptions.routes.ts (GET/PUT /admin/catalog/variant-options and
 * GET /catalog/variant-options). Persisted to localStorage, as handlers/attribution.ts is, so a save
 * survives a reload in mock mode. The real rules are server-side; this keeps the same shape and the
 * checks a page would hit.
 */

import type { MockRoute } from '../types.ts';
import { VARIANT_DIMENSIONS, resolveFor } from '../../config/variantDimensions.ts';
import { MOCK_CATEGORIES } from './products.ts';

const STORAGE_KEY = 'explooro:mock:variant-options';
const MIN_REASON_LENGTH = 10;

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed?.rules?.categories) return parsed;
  } catch {
    // Private browsing — nothing set, every option everywhere.
  }
  return { rules: { categories: {} }, updated_at: null, updated_by: null };
}

let state = load();
const history = [];

const parentOf = () => new Map(MOCK_CATEGORIES.map((c) => [String(c.id), c.parent_id == null ? null : String(c.parent_id)]));

/** Used by the variant save mock (handlers/products.ts) so it refuses what the live save refuses. */
export function mockOptionsForCategory(categoryId) {
  return resolveFor(state.rules, categoryId ?? null, parentOf());
}

const bad = (message_en, message_bn) => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en, message_bn } } });

export const variantOptionsHandlers = [
  {
    method: 'GET',
    path: '/admin/catalog/variant-options',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            ...state,
            options: [...VARIANT_DIMENSIONS],
            categories: MOCK_CATEGORIES.map((c) => ({ id: c.id, parent_id: c.parent_id, name_en: c.name_en, name_bn: c.name_bn, is_active: true })),
            history,
            can_update: true,
          },
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/admin/catalog/variant-options',
    handler({ body }) {
      if (typeof body?.reason !== 'string' || body.reason.trim().length < MIN_REASON_LENGTH) {
        return bad(`Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`, `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`);
      }
      if ((body.base_updated_at ?? null) !== (state.updated_at ?? null)) {
        return {
          status: 409,
          body: { error: { code: 'CONFLICT', message_en: 'Someone else changed these options after you opened the page. Reload to see their change, then apply yours again.', message_bn: 'আপনি পেজটি খোলার পর অন্য কেউ এই অপশনগুলো বদলেছেন। রিলোড করে আবার আপনার পরিবর্তন করুন।' } },
        };
      }
      const ids = new Set(MOCK_CATEGORIES.map((c) => String(c.id)));
      const next = {};
      for (const [id, list] of Object.entries(body?.categories || {})) {
        if (!ids.has(id)) return bad(`Category ${id} does not exist.`, `ক্যাটেগরি ${id} নেই।`);
        if (!Array.isArray(list) || !list.length || list.some((k) => !(VARIANT_DIMENSIONS as readonly string[]).includes(k))) {
          return bad('Each category needs at least one known option.', 'প্রতিটি ক্যাটেগরিতে অন্তত একটি সঠিক অপশন লাগবে।');
        }
        next[id] = VARIANT_DIMENSIONS.filter((k) => list.includes(k));
      }
      const before = state.rules;
      state = { rules: { categories: next }, updated_at: new Date().toISOString(), updated_by: 'usr-dev-1' };
      history.unshift({ created_at: state.updated_at, actor_ref: 'USR-DEV-SUPER-ADMIN', before_json: before, after_json: state.rules, meta_json: { reason: body.reason.trim() } });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Kept in memory for this page view.
      }
      return { status: 200, body: { data: state, message_en: 'Variant options saved. Product forms use them from the next save.', message_bn: 'ভ্যারিয়েন্ট অপশন সেভ হয়েছে।' } };
    },
  },
  {
    method: 'GET',
    path: '/catalog/variant-options',
    handler({ query }) {
      const id = String(query?.category_id ?? '');
      if (!/^\d+$/.test(id)) return bad('category_id must be a category id.', 'category_id অবশ্যই একটি ক্যাটেগরি আইডি হতে হবে।');
      return { status: 200, body: { data: { category_id: Number(id), options: mockOptionsForCategory(id) } } };
    },
  },
] satisfies MockRoute[];
