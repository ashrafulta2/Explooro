/**
 * jobSchedule.test.js — the scheduler table words an interval the way an admin would say it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scheduleLabel } from '../src/pages/admin/jobSchedule.js';

test('whole days, hours and minutes get a plain label', () => {
  assert.equal(scheduleLabel(86400000), 'Daily');
  assert.equal(scheduleLabel(3600000), 'Hourly');
  assert.equal(scheduleLabel(6 * 3600000), 'Every 6 hours');
  assert.equal(scheduleLabel(2 * 86400000), 'Every 2 days');
  assert.equal(scheduleLabel(15 * 60000), 'Every 15 min');
});

test('a sub-minute interval falls back to seconds', () => {
  assert.equal(scheduleLabel(30000), 'Every 30 s');
});

test('a missing or invalid interval has no label, so the table shows a dash', () => {
  assert.equal(scheduleLabel(undefined), null);
  assert.equal(scheduleLabel(0), null);
  assert.equal(scheduleLabel('abc'), null);
});
