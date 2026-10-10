/**
 * jobSchedule.js — how the System Health page words a scheduler job's interval.
 *
 * WHY its own file: the interval arrives as milliseconds from `listRegisteredJobs()`, and the
 * table used to show "—" for every row because nothing sent a label. Pure so it can be tested.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function scheduleLabel(intervalMs) {
  const ms = Number(intervalMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms % DAY === 0) return ms === DAY ? 'Daily' : `Every ${ms / DAY} days`;
  if (ms % HOUR === 0) return ms === HOUR ? 'Hourly' : `Every ${ms / HOUR} hours`;
  if (ms % MINUTE === 0) return `Every ${ms / MINUTE} min`;
  return `Every ${Math.round(ms / 1000)} s`;
}
