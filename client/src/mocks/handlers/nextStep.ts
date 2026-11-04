/**
 * nextStep.ts — Mock handlers for GET /me/next-step and the opt-out
 * (server/src/routes/nextStep.routes.ts, Prompt 13.2).
 *
 * Same contract as the live service: the journey comes from client/src/config/journeys.ts, a step
 * whose page's module is switched off is left out, and a blocked step carries its reason and no
 * route. Each dev role starts a few steps in (MOCK_DONE) so the card shows a realistic middle step;
 * the supplier waits on KYC approval so the blocked state is previewable too.
 *
 * Not mirrored: permissions. Every dev account holds its role's full permission set, so the live
 * `no_permission` and `not_delegated` branches have nothing to act on here.
 */

import { getMockSessionUser } from './auth.ts';
import { publicModuleMap } from '../moduleState.ts';
import { journeyFor, JOURNEY_ROLES, type JourneyRole, type JourneyStep } from '../../config/journeys.ts';
import { navItems } from '../../config/navigation.ts';
import type { MockRoute } from '../types.ts';

const MOCK_DONE: Record<JourneyRole, string[]> = {
  customer: ['user.phone_verified', 'user.address_saved'],
  saler: ['user.phone_verified'],
  supplier: ['user.phone_verified', 'kyc.submitted'],
  moderator: ['staff.two_factor_enrolled'],
  editor: ['staff.two_factor_enrolled'],
  admin: ['staff.two_factor_enrolled', 'admin.kyc_reviewed'],
  super_admin: ['staff.two_factor_enrolled', 'platform.language_chosen'],
};

/** Blocks in force for the dev accounts: the supplier's KYC is still under review. */
const MOCK_ACTIVE_BLOCKS = new Set(['kyc_review', 'waiting_for_buyer', 'waiting_for_delivery', 'balance_empty']);
const BLOCK_KEEPS_ROUTE = new Set(['waiting_for_buyer', 'waiting_for_delivery']);

/** The few journey pages that are not sidebar items; '/seller/kyc' is the only one with a module. */
const NON_SIDEBAR_MODULE: Record<string, string> = { '/seller/kyc': 'supplier_verification' };

const OPT_OUT_KEY = 'explooro:mock:next-step-off';

function optedOut(userId): boolean {
  try {
    return localStorage.getItem(`${OPT_OUT_KEY}:${userId}`) === '1';
  } catch {
    return false;
  }
}

function moduleOf(step: JourneyStep): string {
  const item = navItems.find((n) => n.path === step.route && (n.roles || [n.role]).includes(step.role));
  return item?.module || NON_SIDEBAR_MODULE[step.route] || 'core';
}

function view(step: JourneyStep, block: string | null) {
  return {
    id: step.id,
    order: step.order,
    route: block && !BLOCK_KEEPS_ROUTE.has(block) ? null : step.route,
    title_key: step.title_key,
    next_key: step.nextHint_key,
    status: block ? 'blocked' : 'todo',
    blocked_by: block ? { reason: block, message_key: `journey.block.${block}` } : null,
  };
}

function moduleOff() {
  return {
    status: 403,
    body: { error: { code: 'MODULE_DISABLED', module_key: 'guided_experience', message_en: 'The "Next-step guidance" module is currently disabled on this platform.' } },
  };
}

export const nextStepHandlers = [
  {
    method: 'GET',
    path: '/me/next-step',
    handler() {
      const modules: Record<string, boolean> = publicModuleMap();
      if (modules.guided_experience === false) return moduleOff();
      const user = getMockSessionUser();
      const role = (user?.roles?.[0] || user?.role || 'customer') as JourneyRole;
      const empty = { enabled: true, reason: null, journey: null, progress: { done: 0, total: 0 }, current: null, upcoming: [], steps: [] };
      if (!JOURNEY_ROLES.includes(role)) return { data: empty };
      if (optedOut(user?.id)) return { data: { ...empty, enabled: false, reason: 'opted_out', journey: role } };

      const steps = journeyFor(role).filter((s) => !(s.skipWhen || []).includes('module_off') || modules[moduleOf(s)] !== false);
      const done = new Set(MOCK_DONE[role]);
      const kycGateOn = modules.supplier_verification !== false;
      const pending = steps.filter((s) => !done.has(s.doneWhen));
      const all = steps.map((s) => {
        if (done.has(s.doneWhen)) return { ...view(s, null), status: 'done' };
        const block = (s.blockedBy || []).find((b) => MOCK_ACTIVE_BLOCKS.has(b) && (b !== 'kyc_review' || kycGateOn)) || null;
        return view(s, block);
      });
      const views = all.filter((v) => v.status !== 'done');
      return {
        data: {
          enabled: true,
          reason: null,
          journey: role,
          progress: { done: steps.length - pending.length, total: steps.length },
          current: views[0] || null,
          upcoming: views.slice(1),
          steps: all,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/me/next-step/preference',
    handler() {
      if ((publicModuleMap() as Record<string, boolean>).guided_experience === false) return moduleOff();
      return { data: { show_next_steps: !optedOut(getMockSessionUser()?.id) } };
    },
  },
  {
    method: 'PUT',
    path: '/me/next-step/preference',
    handler({ body }) {
      if ((publicModuleMap() as Record<string, boolean>).guided_experience === false) return moduleOff();
      if (typeof body?.show_next_steps !== 'boolean') {
        return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en: 'show_next_steps must be true or false.' } } };
      }
      try {
        const key = `${OPT_OUT_KEY}:${getMockSessionUser()?.id}`;
        if (body.show_next_steps) localStorage.removeItem(key);
        else localStorage.setItem(key, '1');
      } catch {
        // Private mode: the choice lasts until reload.
      }
      return { data: { show_next_steps: body.show_next_steps } };
    },
  },
] satisfies MockRoute[];
