/**
 * Mock for GET /admin/platform/guided-experience (Prompt 13.7).
 *
 * Serves a seeded set of raw journey_step_events and aggregates them the way
 * server/src/repositories/journeyMetrics.repository.ts does (first sighting per user, abandon =
 * reached `abandon_after_days` ago and not done, rate = abandoned / settled, median of reach→done),
 * so the page's totals visibly add up to the events it was built from.
 */

import { JOURNEYS, type JourneyRole } from '../../config/journeys.ts';
import { moduleRegistry, moduleState } from '../moduleState.ts';
import type { MockRoute } from '../types.ts';

const DAY = 86400000;
const WAITS_ON_OTHERS = new Set(['waiting_for_buyer', 'waiting_for_delivery']);

/** Deterministic pseudo-random numbers, so the preview shows the same story on every load. */
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/**
 * Per role: how many users start, and the share that finishes each step. Picked so the preview has
 * a healthy journey, a flagged step (saler KYC) and a step that waits on a buyer.
 */
const FUNNELS: Partial<Record<JourneyRole, { users: number; pass: number[] }>> = {
  customer: { users: 60, pass: [0.95, 0.8, 0.75, 0.7, 0.85, 0.4] },
  saler: { users: 40, pass: [0.95, 0.45, 0.85, 0.8, 0.7, 0.5, 0.6] },
  supplier: { users: 25, pass: [0.95, 0.75, 0.7, 0.8, 0.6, 0.85, 0.6] },
  moderator: { users: 3, pass: [1, 1, 1, 0.67, 1] },
  editor: { users: 2, pass: [1, 1, 1, 0.5, 1] },
};

interface MockEvent {
  user_id: number;
  journey: string;
  step_id: string;
  event: 'REACHED' | 'COMPLETED';
  at: number;
}

function seedEvents(now: number): MockEvent[] {
  const rand = seeded(13_7);
  const events: MockEvent[] = [];
  let userId = 5000;
  for (const [role, funnel] of Object.entries(FUNNELS)) {
    const steps = JOURNEYS.filter((s) => s.role === role).sort((a, b) => a.order - b.order);
    for (let u = 0; u < funnel.users; u += 1) {
      userId += 1;
      let at = now - (2 + rand() * 40) * DAY;
      for (let i = 0; i < steps.length; i += 1) {
        if (at > now) break;
        events.push({ user_id: userId, journey: role, step_id: steps[i].id, event: 'REACHED', at });
        if (rand() > (funnel.pass[i] ?? 0.7)) break;
        // Minutes for small steps, days for steps that wait on someone else.
        const waits = steps[i].blockedBy?.some((b) => WAITS_ON_OTHERS.has(b));
        at += waits ? (1 + rand() * 4) * DAY : (1 + rand() * 30) * 60000;
        if (at > now) break;
        events.push({ user_id: userId, journey: role, step_id: steps[i].id, event: 'COMPLETED', at });
      }
    }
  }
  return events;
}

const EVENTS = seedEvents(Date.now());

function settingsOf(): { abandon_threshold_pct: number; abandon_after_days: number } {
  const mod = moduleRegistry.modules.find((m) => m.key === 'guided_experience') as any;
  const props = mod?.sub_settings_schema?.properties || {};
  return {
    abandon_threshold_pct: props.abandon_threshold_pct?.default ?? 40,
    abandon_after_days: props.abandon_after_days?.default ?? 7,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function buildMockReport(now = Date.now()) {
  const settings = settingsOf();
  const cutoff = now - settings.abandon_after_days * DAY;
  const pairs = new Map<string, { reached: number | null; completed: number | null }>();
  for (const e of EVENTS) {
    const key = `${e.journey}:${e.step_id}:${e.user_id}`;
    const p = pairs.get(key) || { reached: null, completed: null };
    if (e.event === 'REACHED') p.reached = p.reached == null ? e.at : Math.min(p.reached, e.at);
    else p.completed = p.completed == null ? e.at : Math.min(p.completed, e.at);
    pairs.set(key, p);
  }

  const roles = [...new Set(JOURNEYS.map((s) => s.role))];
  const journeys = roles.map((role) => {
    const users = FUNNELS[role]?.users ?? 0;
    const steps = JOURNEYS.filter((s) => s.role === role)
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const mine = [...pairs.entries()].filter(([k]) => k.startsWith(`${role}:${s.id}:`)).map(([, p]) => p);
        const abandoned = mine.filter((p) => p.completed == null && p.reached != null && p.reached < cutoff).length;
        const settled = mine.filter((p) => p.completed != null || (p.reached != null && p.reached < cutoff)).length;
        const timedPairs = mine.filter((p) => p.reached != null && p.completed != null && p.completed >= p.reached);
        const med = median(timedPairs.map((p) => ((p.completed as number) - (p.reached as number)) / 1000));
        const rate = pct(abandoned, settled);
        return {
          id: s.id,
          order: s.order,
          title_key: `journey.${role}.${s.id}.title`,
          reached: mine.length,
          reached_events: mine.filter((p) => p.reached != null).length,
          completed: mine.filter((p) => p.completed != null).length,
          abandoned,
          settled,
          timed: timedPairs.length,
          median_seconds: med == null ? null : Math.round(med),
          abandon_rate: rate,
          flagged: rate !== null && rate > settings.abandon_threshold_pct,
          waits_on_others: Boolean(s.blockedBy?.some((b) => WAITS_ON_OTHERS.has(b))),
        };
      });
    const optedOut = Math.round(users * (role === 'customer' ? 0.07 : role === 'saler' ? 0.1 : 0.04));
    return { role, opt_out: { users, opted_out: optedOut, rate: pct(optedOut, users) }, steps };
  });

  return {
    module: { key: 'guided_experience', enabled: moduleState.get('guided_experience')?.is_enabled !== false },
    settings,
    totals: {
      reached_events: EVENTS.filter((e) => e.event === 'REACHED').length,
      completed_events: EVENTS.filter((e) => e.event === 'COMPLETED').length,
    },
    journeys,
    flagged: journeys
      .flatMap((j) => j.steps.filter((s) => s.flagged).map((s) => ({ role: j.role, id: s.id, title_key: s.title_key, abandon_rate: s.abandon_rate as number })))
      .sort((a, b) => b.abandon_rate - a.abandon_rate),
  };
}

export const guidedExperienceHandlers: MockRoute[] = [
  {
    method: 'GET',
    path: '/admin/platform/guided-experience',
    handler() {
      return { status: 200, body: { success: true, data: buildMockReport() } };
    },
  },
];
