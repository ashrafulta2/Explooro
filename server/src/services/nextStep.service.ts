/**
 * nextStep.service.ts — "what should this user do now?" for every role (Prompt 13.2).
 *
 * Walks the user's journey (config/journeys.ts, the server copy of client/src/config/journeys.ts)
 * and returns the first step whose fact is still false. Read-only: it never writes a "completed"
 * flag, so progress is always what the data says.
 *
 * Rules, in the order they apply (docs/journeys.md §1):
 *  1. `module_off` — a step whose page's module is switched off is left out of the journey.
 *  2. `not_delegated` — staff only: a step whose page needs a permission the person was never given
 *     is left out too, because staff permissions are delegated person by person.
 *  3. A step a non-staff user lacks the permission for stays, but is reported `blocked_by:
 *     no_permission` with no route, so the card never offers a page that would refuse them.
 *  4. Each step's `blockedBy` reasons are checked against the data; an active one is reported with
 *     the reason instead of a button that would fail.
 *
 * The answer is cached per user for `cache_seconds` (module setting, default 20). Any successful
 * write by that user clears it (`invalidateOnWrite`, an app-wide onResponse hook), so a step the
 * user completes shows as done on their very next request. A change made by someone else (an admin
 * approving their KYC, a shopper ordering) shows within `cache_seconds`.
 */

import { journeyFor, STAFF_ROLES, type ServerJourneyStep } from '../config/journeys.ts';
import * as repo from '../repositories/nextStep.repository.ts';
import * as moduleRepo from '../repositories/module.repository.ts';
import { isEnabled } from './module.service.ts';
import { resolvePermissions } from './rbac.service.ts';

export const MODULE_KEY = 'guided_experience';
const CACHE_LIMITS = { min: 0, max: 300, fallback: 20 };

/**
 * Which blocks leave the step's page on offer. Waiting for a shopper or a delivery: the page shows
 * the status, so it is worth opening. Waiting for a review or a balance, or missing a permission:
 * the page would only refuse the action, so there is no button.
 */
const BLOCK_KEEPS_ROUTE: Record<string, boolean> = {
  waiting_for_buyer: true,
  waiting_for_delivery: true,
  kyc_review: false,
  product_review: false,
  balance_empty: false,
  no_permission: false,
};

export interface StepView {
  id: string;
  order: number;
  route: string | null;
  title_key: string;
  next_key: string;
  status: 'todo' | 'blocked' | 'done';
  blocked_by: { reason: string; message_key: string } | null;
}

export interface NextStepPayload {
  enabled: boolean;
  reason: 'opted_out' | null;
  journey: string | null;
  progress: { done: number; total: number };
  current: StepView | null;
  upcoming: StepView[];
  /** Every step left in the journey, in order, done ones included: the setup checklist (Prompt 13.4). */
  steps: StepView[];
}

// WHY v2: the answer gained `steps` in Prompt 13.4; a v1 entry still cached would lack it.
export function nextStepCacheKey(userId: number | string): string {
  return `nextstep:v2:${userId}`;
}

export async function invalidateNextStep(cache, userId: number | string): Promise<void> {
  if (!cache || userId == null) return;
  await cache.del(nextStepCacheKey(userId)).catch(() => {});
}

/**
 * onSend hook: a successful write by a signed-in user may have completed a step, so their cached
 * answer is dropped. WHY every write and not a list of "step-completing" endpoints: a list would have
 * to name ~20 routes across a dozen services and would silently go stale when one is added; dropping
 * one small cache key on every write costs almost nothing.
 * WHY onSend and not onResponse: onSend runs before the response leaves, so the result panel
 * (Prompt 13.3), which asks for the next step the moment the write answers, can never read the stale
 * entry. The payload is passed through untouched.
 */
export async function invalidateOnWrite(req, reply, payload?: unknown): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return payload;
  if (reply.statusCode >= 400 || !req.user?.id) return payload;
  await invalidateNextStep(req.server?.cache, req.user.id);
  return payload;
}

function cacheSeconds(moduleRow): number {
  const raw = Number(moduleRow?.settings_json?.cache_seconds);
  if (!Number.isInteger(raw)) return CACHE_LIMITS.fallback;
  return Math.min(CACHE_LIMITS.max, Math.max(CACHE_LIMITS.min, raw));
}

function emptyPayload(journey: string | null, reason: NextStepPayload['reason'] = null): NextStepPayload {
  return { enabled: reason === null, reason, journey, progress: { done: 0, total: 0 }, current: null, upcoming: [], steps: [] };
}

/** What the engine asks the rest of the platform. Injectable so the tests need no RBAC tables. */
export interface NextStepDeps {
  // WHY Set<unknown>: rbac.service builds the set without a type; the keys are strings in practice.
  resolvePermissions: (db, cache, userId: number) => Promise<{ permissions: Set<unknown> }>;
  isEnabled: (db, cache, moduleKey: string, context: Record<string, any>) => Promise<boolean>;
}
const DEFAULT_DEPS: NextStepDeps = { resolvePermissions, isEnabled };

/** Is each block reason in force right now? Only the queries a pending step actually needs run. */
async function activeBlocks(db, cache, userId: number, reasons: Set<string>, context, deps: NextStepDeps): Promise<Set<string>> {
  const active = new Set<string>();
  for (const reason of reasons) {
    if (reason === 'waiting_for_buyer' || reason === 'waiting_for_delivery') active.add(reason);
    else if (reason === 'kyc_review') {
      // WHY the module check: product.service only demands a VERIFIED KYC while this module is on.
      const gateOn = await deps.isEnabled(db, cache, 'supplier_verification', context);
      if (gateOn && !(await repo.isKycVerified(db, userId))) active.add(reason);
    } else if (reason === 'product_review') {
      if (await repo.hasProductAwaitingReview(db, userId)) active.add(reason);
    } else if (reason === 'balance_empty') {
      if (!(await repo.hasWithdrawableBalance(db, userId))) active.add(reason);
    }
  }
  return active;
}

function view(role: string, step: ServerJourneyStep, blockedBy: string | null): StepView {
  const base = `journey.${role}.${step.id}`;
  return {
    id: step.id,
    order: step.order,
    route: blockedBy && !BLOCK_KEEPS_ROUTE[blockedBy] ? null : step.route,
    title_key: `${base}.title`,
    next_key: `${base}.next`,
    status: blockedBy ? 'blocked' : 'todo',
    blocked_by: blockedBy ? { reason: blockedBy, message_key: `journey.block.${blockedBy}` } : null,
  };
}

/** Computes the answer without the cache. Exported for the tests. */
export async function computeNextStep(
  db,
  cache,
  user: { id: number; roles?: string[] },
  deps: NextStepDeps = DEFAULT_DEPS
): Promise<NextStepPayload> {
  const role = user.roles?.[0] || 'customer';
  const journey = journeyFor(role);
  if (journey.length === 0) return emptyPayload(null);

  if (!(await repo.getShowNextSteps(db, user.id))) return emptyPayload(role, 'opted_out');

  const context = { userId: user.id, role, roles: user.roles };
  const isStaff = STAFF_ROLES.includes(role);
  const { permissions } = await deps.resolvePermissions(db, cache, user.id);

  const moduleOn = new Map<string, boolean>();
  for (const key of new Set(journey.map((s) => s.module))) {
    moduleOn.set(key, key === 'core' ? true : await deps.isEnabled(db, cache, key, context));
  }

  const steps = journey.filter((s) => {
    if (s.skipWhen.includes('module_off') && !moduleOn.get(s.module)) return false;
    if (s.skipWhen.includes('not_delegated') && isStaff && s.permission && !permissions.has(s.permission)) return false;
    return true;
  });

  const facts = await repo.evaluateFacts(db, user.id, steps.map((s) => s.fact));
  const pending = steps.filter((s) => !facts[s.fact]);
  const blocks = await activeBlocks(db, cache, user.id, new Set(pending.flatMap((s) => s.blockedBy)), context, deps);

  const byId = new Map<string, StepView>();
  for (const s of steps) {
    const missingPermission = Boolean(s.permission) && !permissions.has(s.permission);
    if (facts[s.fact]) {
      // A done step keeps its page so the checklist can offer "open" again, unless the page refuses them.
      byId.set(s.id, { ...view(role, s, null), status: 'done', route: missingPermission ? null : s.route });
    } else {
      const block = missingPermission ? 'no_permission' : s.blockedBy.find((b) => blocks.has(b)) || null;
      byId.set(s.id, view(role, s, block));
    }
  }
  const views = pending.map((s) => byId.get(s.id));

  return {
    enabled: true,
    reason: null,
    journey: role,
    progress: { done: steps.length - pending.length, total: steps.length },
    current: views[0] || null,
    // WHY no pagination: both lists are bounded by the journey itself (at most 9 steps, client test).
    upcoming: views.slice(1),
    steps: steps.map((s) => byId.get(s.id)),
  };
}

export async function getNextStep(
  db,
  cache,
  user: { id: number; roles?: string[] },
  deps: NextStepDeps = DEFAULT_DEPS
): Promise<NextStepPayload> {
  const key = nextStepCacheKey(user.id);
  if (cache) {
    const hit = await cache.get(key).catch(() => null);
    if (hit) {
      try {
        return typeof hit === 'string' ? JSON.parse(hit) : hit;
      } catch {
        // A corrupt entry is recomputed below.
      }
    }
  }

  const payload = await computeNextStep(db, cache, user, deps);
  const ttl = cacheSeconds(await moduleRepo.getModuleByKey(db, MODULE_KEY).catch(() => null));
  if (cache && ttl > 0) await cache.set(key, JSON.stringify(payload), ttl).catch(() => {});
  return payload;
}

/** The per-user opt-out from the account settings page. */
export async function setShowNextSteps(db, cache, userId: number, show: boolean): Promise<{ show_next_steps: boolean }> {
  await repo.setShowNextSteps(db, userId, show);
  await invalidateNextStep(cache, userId);
  return { show_next_steps: show };
}

export async function getPreference(db, userId: number): Promise<{ show_next_steps: boolean }> {
  return { show_next_steps: await repo.getShowNextSteps(db, userId) };
}

/** The facts of a few steps, for callers that still answer an older checklist (`/saler/onboarding`). */
export function factsFor(db, userId: number, facts: string[]): Promise<Record<string, boolean>> {
  return repo.evaluateFacts(db, userId, facts);
}
