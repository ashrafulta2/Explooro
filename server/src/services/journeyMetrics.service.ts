/**
 * journeyMetrics.service.ts — how users move through their journeys (Prompt 13.7).
 *
 * For every step of every journey (config/journeys.ts): how many users reached it, how many finished
 * it, the median time between the two, and how many stopped there. Read by
 * GET /admin/platform/guided-experience.
 *
 * The numbers come from journey_step_events (migration 103), which the Next-Step engine writes the
 * first time it sees a step become a user's current step (REACHED) or done (COMPLETED). A user who
 * finished a step before the engine ever showed it to them counts as reached and completed, with no
 * time: there is no honest start time to measure from.
 *
 * Abandon: reached at least `abandon_after_days` ago and still not done. The rate is abandoned over
 * settled (done, or abandoned), so users who reached a step yesterday do not count against it. A step
 * whose rate is above `abandon_threshold_pct` is flagged; both numbers are the `guided_experience`
 * module's settings, never constants here.
 */

import { JOURNEYS } from '../config/journeys.ts';
import * as repo from '../repositories/journeyMetrics.repository.ts';
import * as moduleRepo from '../repositories/module.repository.ts';
import { MODULE_KEY } from './nextStep.service.ts';

/** Bounds for the two settings. Migration 103's settings_schema holds the same numbers. */
export const SETTING_LIMITS = {
  abandon_threshold_pct: { min: 5, max: 95, fallback: 40 },
  abandon_after_days: { min: 1, max: 90, fallback: 7 },
};

/** Steps that wait on someone else (a buyer, a courier): a stall there is not the user leaving. */
const WAITS_ON_OTHERS = new Set(['waiting_for_buyer', 'waiting_for_delivery']);

function bounded(raw: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readSettings(settingsJson: Record<string, unknown> | null | undefined) {
  return {
    abandon_threshold_pct: bounded(settingsJson?.abandon_threshold_pct, SETTING_LIMITS.abandon_threshold_pct),
    abandon_after_days: bounded(settingsJson?.abandon_after_days, SETTING_LIMITS.abandon_after_days),
  };
}

export interface StepMetrics {
  id: string;
  order: number;
  title_key: string;
  reached: number;
  reached_events: number;
  completed: number;
  abandoned: number;
  settled: number;
  timed: number;
  median_seconds: number | null;
  /** Abandoned over settled, 0–100 with one decimal, or null when nobody has settled yet. */
  abandon_rate: number | null;
  flagged: boolean;
  waits_on_others: boolean;
}

export interface JourneyMetricsReport {
  module: { key: string; enabled: boolean };
  settings: ReturnType<typeof readSettings>;
  totals: { reached_events: number; completed_events: number };
  journeys: {
    role: string;
    opt_out: { users: number; opted_out: number; rate: number | null };
    steps: StepMetrics[];
  }[];
  /** Every flagged step, worst first: the numbered fixes of docs/usability-report.md. */
  flagged: { role: string; id: string; title_key: string; abandon_rate: number }[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Pure: turns the repository's rows into the page's report. Exported for the tests. */
export function buildReport(
  aggregates: repo.StepAggregateRow[],
  totals: { reached_events: number; completed_events: number },
  optOut: { role: string; users: number; opted_out: number }[],
  moduleRow: { is_enabled?: boolean; settings_json?: Record<string, unknown> } | null
): JourneyMetricsReport {
  const settings = readSettings(moduleRow?.settings_json);
  const byStep = new Map(aggregates.map((a) => [`${a.journey}:${a.step_id}`, a]));
  const optOutByRole = new Map(optOut.map((o) => [o.role, o]));
  const roles = [...new Set(JOURNEYS.map((s) => s.role))];

  const journeys = roles.map((role) => {
    const steps = JOURNEYS.filter((s) => s.role === role)
      .sort((a, b) => a.order - b.order)
      .map((s): StepMetrics => {
        const a = byStep.get(`${role}:${s.id}`);
        const settled = a?.settled ?? 0;
        const abandoned = a?.abandoned ?? 0;
        const rate = pct(abandoned, settled);
        return {
          id: s.id,
          order: s.order,
          title_key: `journey.${role}.${s.id}.title`,
          reached: a?.reached ?? 0,
          reached_events: a?.reached_events ?? 0,
          completed: a?.completed ?? 0,
          abandoned,
          settled,
          timed: a?.timed ?? 0,
          median_seconds: a?.median_seconds == null ? null : Math.round(a.median_seconds),
          abandon_rate: rate,
          // WHY strictly above: the brief reads "> 40% abandon".
          flagged: rate !== null && rate > settings.abandon_threshold_pct,
          waits_on_others: s.blockedBy.some((b) => WAITS_ON_OTHERS.has(b)),
        };
      });
    const o = optOutByRole.get(role);
    return {
      role,
      opt_out: { users: o?.users ?? 0, opted_out: o?.opted_out ?? 0, rate: pct(o?.opted_out ?? 0, o?.users ?? 0) },
      steps,
    };
  });

  const flagged = journeys
    .flatMap((j) => j.steps.filter((s) => s.flagged).map((s) => ({ role: j.role, id: s.id, title_key: s.title_key, abandon_rate: s.abandon_rate as number })))
    .sort((a, b) => b.abandon_rate - a.abandon_rate);

  return {
    module: { key: MODULE_KEY, enabled: moduleRow?.is_enabled !== false },
    settings,
    totals,
    journeys,
    flagged,
  };
}

export async function getReport(db): Promise<JourneyMetricsReport> {
  const moduleRow = await moduleRepo.getModuleByKey(db, MODULE_KEY);
  const { abandon_after_days } = readSettings(moduleRow?.settings_json);
  const [aggregates, totals, optOut] = await Promise.all([
    repo.stepAggregates(db, abandon_after_days),
    repo.eventTotals(db),
    repo.optOutByRole(db),
  ]);
  return buildReport(aggregates, totals, optOut, moduleRow);
}
