/**
 * kycDecisionExecutor.test.js — an Admin's deferred KYC approval can actually be applied.
 *
 * Before: requirePermission deferred the request, a Super Admin approved it, and makerChecker found
 * no executor for users.kyc.approve and marked it FAILED. And the controller read req.user.role
 * (never set), so even a Super Admin's direct decision was queued for a second approval.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as kycDecision from '../src/services/kycDecision.service.js';
import { getRegisteredExecutor, decidePendingAction } from '../src/services/makerChecker.service.js';

describe('reviewerRoleOf', () => {
  test('a Super Admin among several roles counts as super_admin', () => {
    assert.equal(kycDecision.reviewerRoleOf(['admin', 'super_admin']), 'super_admin');
  });
  test('otherwise the first role, and moderator only when there is none', () => {
    assert.equal(kycDecision.reviewerRoleOf(['admin']), 'admin');
    assert.equal(kycDecision.reviewerRoleOf(undefined), 'moderator');
  });
});

function makeDb({ kycStatus = 'UNDER_REVIEW', pending } = {}) {
  const log = { statements: [], referralEventQueries: 0, applied: false };
  const query = async (sql, params = []) => {
    log.statements.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM pending_admin_actions')) return { rows: [pending] };
    if (sql.includes('UPDATE pending_admin_actions')) { log.applied = true; return { rows: [{ ...pending, status: 'APPLIED' }] }; }
    if (sql.includes('SELECT status FROM kyc_verifications')) return { rows: [{ status: kycStatus }] };
    if (sql.includes('SELECT * FROM kyc_verifications') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: 12, user_id: 20, status: kycStatus }] };
    }
    if (sql.includes('UPDATE kyc_verifications')) return { rows: [{ id: 12, user_id: 20, status: params[1] }] };
    if (sql.includes('FROM platform_modules')) {
      return { rows: [{ key: 'referral_engine', is_enabled: true, default_enabled: true, settings_json: { kyc_bonus_bdt: 100 } }] };
    }
    if (sql.includes('FROM referrals') && sql.includes('qualifying_event = $2')) { log.referralEventQueries += 1; return { rows: [] }; }
    return { rows: [] };
  };
  return { query, log, connect: async () => ({ query, release: () => {} }) };
}

describe('users.kyc.approve executor', () => {
  test('is registered', () => {
    assert.ok(getRegisteredExecutor('users.kyc.approve'));
  });

  test('refuses a decision that is not VERIFIED or REJECTED', async () => {
    const ex = getRegisteredExecutor('users.kyc.approve');
    await assert.rejects(ex.validatePreconditions({ decision: 'MAYBE' }, { db: makeDb(), targetRef: '12' }), /VERIFIED or REJECTED/);
  });

  test('refuses a submission that is already verified', async () => {
    const ex = getRegisteredExecutor('users.kyc.approve');
    await assert.rejects(
      ex.validatePreconditions({ decision: 'VERIFIED' }, { db: makeDb({ kycStatus: 'VERIFIED' }), targetRef: '12' }),
      /already verified/
    );
  });

  test('execute verifies directly: no second queue, requester is the reviewer', async () => {
    const ex = getRegisteredExecutor('users.kyc.approve');
    const db = makeDb();
    const out = await ex.execute({ decision: 'VERIFIED', reason_en: 'ok' }, { db, targetRef: '12', actorId: 7 });
    assert.equal(out.decision, 'VERIFIED');
    assert.equal(db.log.statements.some((s) => s.includes('INSERT INTO pending_admin_actions')), false);
    assert.ok(db.log.statements.some((s) => s.includes('UPDATE kyc_verifications')));
  });

  test('afterCommit asks the referral engine for the KYC event, only for VERIFIED', async () => {
    const ex = getRegisteredExecutor('users.kyc.approve');
    const db = makeDb();
    await ex.afterCommit({}, { db, cache: null }, { decision: 'REJECTED', kyc: { user_id: 20 } });
    assert.equal(db.log.referralEventQueries, 0);
    await ex.afterCommit({}, { db, cache: null }, { decision: 'VERIFIED', kyc: { user_id: 20 } });
    assert.equal(db.log.referralEventQueries, 1);
  });
});

describe('decidePendingAction runs afterCommit once the action is applied', () => {
  test('a Super Admin approving a deferred KYC decision ends APPLIED and fires the bonus path', async () => {
    const pending = {
      id: 5, ref: 'PAA-1', status: 'PENDING', action_key: 'users.kyc.approve', actor_id: 7,
      target_type: 'resource', target_ref: '12', payload_json: { decision: 'VERIFIED' },
    };
    const db = makeDb({ pending });
    const out = await decidePendingAction(db, null, { actionId: 5, decision: 'APPROVE', approverId: 1 });
    assert.equal(db.log.applied, true);
    assert.equal(out.result.decision, 'VERIFIED');
    assert.equal(db.log.referralEventQueries, 1);
  });
});
