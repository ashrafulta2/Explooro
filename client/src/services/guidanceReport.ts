/**
 * guidanceReport.ts — pure helpers for /admin/platform/guided-experience (Prompt 13.7). Kept out of
 * the page so node tests can import them without the page's stylesheet.
 */

import { t } from './i18n.ts';
import { formatNumber } from './format.ts';

/** A number with at most one decimal: 66.7, 50, ৬৬.৭. formatNumber always prints two decimals. */
export function formatOneDecimal(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  const out = formatNumber(r);
  return Number.isInteger(r) ? out : out.replace(/[0০]$/, '');
}

/** Seconds → "4 min", "3.5 h", "2 days". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return t('admin_guidance.duration.seconds', { n: formatNumber(Math.round(seconds)) });
  if (seconds < 3600) return t('admin_guidance.duration.minutes', { n: formatNumber(Math.round(seconds / 60)) });
  if (seconds < 86400) return t('admin_guidance.duration.hours', { n: formatOneDecimal(seconds / 3600) });
  return t('admin_guidance.duration.days', { n: formatOneDecimal(seconds / 86400) });
}

/** Do the per-step rows add up to the raw event counts? The page's reconciliation line. */
export function reconcile(report): { reached: number; completed: number; ok: boolean } {
  const steps = (report?.journeys || []).flatMap((j) => j.steps || []);
  const reached = steps.reduce((n, s) => n + (s.reached_events || 0), 0);
  const completed = steps.reduce((n, s) => n + (s.completed || 0), 0);
  return { reached, completed, ok: reached === report?.totals?.reached_events && completed === report?.totals?.completed_events };
}
