/**
 * jobRegistration.test.js — every registerJob() call uses only the keys the scheduler reads.
 *
 * WHY: jobs/scheduler.ts reads `intervalMs` and `moduleKey` and has no cron syntax. Two jobs passed
 * `cron` and `module` instead, so the scheduler ignored both: team_purchase_expiry ran hourly, not every
 * 5 minutes (expired teams' holds waited up to an hour for their refund), and cart_recovery_sweep ran
 * hourly with its module switched off. Found when the jobs moved to TypeScript.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JOBS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'jobs');
const KNOWN_KEYS = new Set(['name', 'intervalMs', 'moduleKey', 'handler', 'lockId']);

function registrations() {
  const out = [];
  for (const file of readdirSync(JOBS).filter((f) => /\.(js|ts)$/.test(f) && !f.startsWith('scheduler.'))) {
    const src = readFileSync(path.join(JOBS, file), 'utf8').replace(/\r\n/g, '\n');
    for (const m of src.matchAll(/^registerJob\(\{\n([\s\S]*?)\n\}\);/gm)) {
      const keys = [...m[1].matchAll(/^ {2}(\w+)\s*:/gm)].map((k) => k[1]);
      out.push({ file, keys });
    }
  }
  return out;
}

test('every job registration names only keys the scheduler reads, and an interval', () => {
  const regs = registrations();
  assert.ok(regs.length >= 15, `found ${regs.length} registrations`);
  const problems = [];
  for (const { file, keys } of regs) {
    for (const k of keys) if (!KNOWN_KEYS.has(k)) problems.push(`${file}: unknown key "${k}"`);
    if (!keys.includes('intervalMs')) problems.push(`${file}: no intervalMs (would run on the 1-hour default)`);
  }
  assert.deepEqual(problems, []);
});

test('team purchase expiry runs every 5 minutes and cart recovery every 15, gated on its module', async () => {
  await import('../src/jobs/teamPurchaseExpiry.job.ts');
  await import('../src/jobs/cartRecovery.job.ts');
  const { listRegisteredJobs } = await import('../src/jobs/scheduler.ts');
  const byName = Object.fromEntries(listRegisteredJobs().map((j) => [j.name, j]));
  assert.deepEqual(byName.team_purchase_expiry, { name: 'team_purchase_expiry', interval_ms: 300000, module_key: null });
  assert.deepEqual(byName.cart_recovery_sweep, { name: 'cart_recovery_sweep', interval_ms: 900000, module_key: 'cart_recovery' });
});
