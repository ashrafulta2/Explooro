/**
 * staff.service.js — Staff Management: roster, provisioning, role changes, suspension, 2FA reset
 * and re-invitation (Prompt 3.3).
 *
 * Invariants, all enforced here rather than in the UI (the client hides buttons; this refuses):
 *  - Nobody changes their own access. An admin who could suspend themselves, or demote themselves
 *    into a role that can no longer undo it, has locked the platform by accident.
 *  - The last ACTIVE Super Admin can be neither demoted nor suspended. The check runs under an
 *    advisory lock (repository.lockSuperAdminGuard), so two concurrent requests cannot both pass it.
 *  - Every write needs a reason (>= 3 characters), kept in the audit row, because "who changed this
 *    and why" is the only question anyone asks about a staff change afterwards.
 *  - Every write is ONE transaction covering the change, its audit row and (for role/status) the
 *    session revocation. A change that cannot be audited is not made.
 *  - Suspending, changing a role, or resetting 2FA signs the person out of every session; the
 *    permission cache is dropped after commit so the next request re-resolves.
 *  - Contact details are unique. The pre-check gives a field-level error; the DB constraint still
 *    backs it, and a race between two provisions maps the constraint violation to the same error.
 *
 * Errors use the closed code enum in docs/api-contract.md §3; the specific business reason rides in
 * `details.reason` (LAST_SUPER_ADMIN, NOTHING_TO_RESET, …) and the offending input in `details.field`.
 */

import { withTransaction } from '../config/db.js';
import { STAFF_MIN_ROLE_LEVEL, STAFF_PRIVILEGED_MIN_LEVEL, STAFF_ROLE_DESCRIPTIONS } from '../config/staffRoles.js';
import * as staffRepo from '../repositories/staff.repository.js';
import * as rbacService from './rbac.service.js';
import { registerActionExecutor } from './makerChecker.service.js';
import { writeAudit } from '../lib/audit.js';
import { checkBucket } from '../lib/rateBucket.js';
import { generateRef } from '../lib/ref.js';
import { AppError } from '../plugins/errorHandler.js';

export const NAME_MAX = 120;
export const DEPARTMENT_MAX = 120;
export const REASON_MIN = 3;
export const REASON_MAX = 300;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
const ACTIVITY_LIMIT = 50;
const INVITE_RESENDS_PER_HOUR = 3;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUSES = new Set(['ACTIVE', 'INVITED', 'SUSPENDED']);
const TWO_FACTOR_FILTERS = new Set(['ENABLED', 'PENDING']);

// ── Errors ───────────────────────────────────────────────────────────────────────────────────

const invalid = (field, en, bn) => new AppError('VALIDATION_FAILED', en, bn, { field });
const notFound = () => new AppError('NOT_FOUND', 'Staff member not found.', 'স্টাফ সদস্য পাওয়া যায়নি।');
const selfAction = () =>
  new AppError(
    'FORBIDDEN',
    'You cannot change your own access. Ask another Super Admin.',
    'আপনি নিজের অ্যাক্সেস বদলাতে পারবেন না। অন্য সুপার অ্যাডমিনকে বলুন।',
    { reason: 'SELF_ACTION' }
  );
const lastSuperAdmin = () =>
  new AppError(
    'CONFLICT',
    'This is the only active Super Admin. Promote another Super Admin first, otherwise nobody could recover the platform.',
    'এটিই একমাত্র সক্রিয় সুপার অ্যাডমিন। আগে আরেকজনকে সুপার অ্যাডমিন করুন, নইলে প্ল্যাটফর্ম পুনরুদ্ধারের কেউ থাকবে না।',
    { reason: 'LAST_SUPER_ADMIN' }
  );

// ── Pure helpers (exported for tests) ────────────────────────────────────────────────────────

/** "01711000001", "8801711000001" and "+8801711000001" all become "+8801711000001"; else null. */
export function normalisePhone(raw) {
  const compact = String(raw ?? '').replace(/[\s()-]/g, '');
  const match = compact.match(/^(?:\+?880|0)(1[3-9]\d{8})$/);
  return match ? `+880${match[1]}` : null;
}

export function cleanReason(raw) {
  const reason = String(raw ?? '').trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    throw invalid(
      'reason',
      `A reason of ${REASON_MIN}–${REASON_MAX} characters is required for the audit log.`,
      `অডিট লগের জন্য ${REASON_MIN}–${REASON_MAX} অক্ষরের কারণ দিতে হবে।`
    );
  }
  return reason;
}

/** Throws a field-level VALIDATION_FAILED for the first bad field; returns normalised values. */
export function validateProvision(input = {}) {
  const fullName = String(input.full_name ?? '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 2 || fullName.length > NAME_MAX) {
    throw invalid('full_name', 'Enter the full name.', 'পূর্ণ নাম লিখুন।');
  }
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw invalid('email', 'Enter a valid work email.', 'সঠিক অফিস ইমেইল দিন।');
  }
  const phone = normalisePhone(input.phone);
  if (!phone) {
    throw invalid('phone', 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).', 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)।');
  }
  const roleKey = String(input.role_key ?? '');
  if (!roleKey) throw invalid('role_key', 'Choose a role.', 'একটি রোল নির্বাচন করুন।');

  const department = String(input.department ?? '').trim().replace(/\s+/g, ' ');
  if (department.length > DEPARTMENT_MAX) {
    throw invalid('department', `Department must be ${DEPARTMENT_MAX} characters or fewer.`, `বিভাগের নাম সর্বোচ্চ ${DEPARTMENT_MAX} অক্ষরের হতে পারবে।`);
  }
  return { fullName, email, phone, roleKey, department: department || null };
}

/** Rows come back with snake_case columns and bigints as strings; the API wants plain values. */
export function shapeStaff(row) {
  return {
    id: Number(row.id),
    ref: row.ref,
    full_name: row.full_name ?? row.email,
    email: row.email,
    phone: row.phone,
    role_key: row.role_key,
    role_label_en: row.role_label_en,
    role_label_bn: row.role_label_bn,
    department: row.department ?? null,
    two_factor_enabled: Boolean(row.two_factor_enabled),
    status: row.status,
    last_active_at: row.last_login_at ?? null,
    created_at: row.created_at,
    permissions_count: row.permissions_count ?? 0,
  };
}

function shapeVitals(v) {
  const rate = v.usable_staff ? Math.round((v.usable_with_2fa / v.usable_staff) * 1000) / 10 : 0;
  return {
    total_staff: v.total_staff,
    active_staff: v.active_staff,
    invited_staff: v.invited_staff,
    two_factor_rate_pct: rate,
    two_factor_pending: v.usable_staff - v.usable_with_2fa,
    privileged_roles_count: v.active_super_admins,
  };
}

function shapeRole(r) {
  const copy = STAFF_ROLE_DESCRIPTIONS[r.key];
  return {
    key: r.key,
    label_en: r.label_en,
    label_bn: r.label_bn,
    permissions_count: r.permissions_count,
    privileged: r.level >= STAFF_PRIVILEGED_MIN_LEVEL,
    description_en: copy?.en ?? null,
    description_bn: copy?.bn ?? null,
  };
}

function isOnlyActiveSuperAdmin(row, lockedSuperAdminIds) {
  return row.role_key === 'super_admin' && lockedSuperAdminIds.length === 1 && lockedSuperAdminIds[0] === Number(row.id);
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

export async function listStaff(db, { q, role, status, twoFactor, page, limit } = {}) {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(limit, 10) || DEFAULT_PAGE_SIZE));
  let pageNo = Math.max(1, Number.parseInt(page, 10) || 1);

  const filters = {
    minLevel: STAFF_MIN_ROLE_LEVEL,
    query: String(q ?? '').trim() || null,
    role: role && role !== 'ALL' ? String(role) : null,
    status: STATUSES.has(status) ? status : null,
    twoFactor: TWO_FACTOR_FILTERS.has(twoFactor) ? twoFactor : null,
    limit: pageSize,
  };

  let { rows, total } = await staffRepo.listStaff(db, { ...filters, offset: (pageNo - 1) * pageSize });
  if (rows.length === 0 && pageNo > 1) {
    // The pager asked for a page past the end (rows were removed, or a stale link). Land on the
    // last real page rather than showing an empty table with a page count that says otherwise.
    ({ total } = await staffRepo.listStaff(db, { ...filters, limit: 1, offset: 0 }));
    pageNo = Math.max(1, Math.ceil(total / pageSize));
    ({ rows } = await staffRepo.listStaff(db, { ...filters, offset: (pageNo - 1) * pageSize }));
  }

  const [roles, vitals] = await Promise.all([
    staffRepo.listStaffRoles(db, STAFF_MIN_ROLE_LEVEL),
    staffRepo.getVitals(db, STAFF_MIN_ROLE_LEVEL),
  ]);

  return {
    staff: rows.map(shapeStaff),
    total,
    page: pageNo,
    limit: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    roles: roles.map(shapeRole),
    vitals: shapeVitals(vitals),
  };
}

export async function getStaff(db, id) {
  const row = await staffRepo.getStaffById(db, Number(id), STAFF_MIN_ROLE_LEVEL);
  if (!row) throw notFound();
  const activity = await staffRepo.listStaffActivity(db, row.ref, ACTIVITY_LIMIT);
  return { staff: shapeStaff(row), activity };
}

// ── Invitation email ─────────────────────────────────────────────────────────────────────────

async function sendInvitation(emailSender, config, { email, fullName, roleLabelEn }) {
  const url = config?.core?.publicWebUrl ?? '';
  const subject = 'You have been added to the Explooro admin team';
  const text = [
    `Hello ${fullName},`,
    '',
    `You have been added to the Explooro admin team as ${roleLabelEn}.`,
    `Sign in at ${url}/login using the "OTP Sign In" tab with your mobile number. You will be asked to set up two-factor authentication on first sign-in.`,
    '',
    `আপনাকে এক্সপ্লুরোর অ্যাডমিন টিমে ${roleLabelEn} হিসেবে যুক্ত করা হয়েছে।`,
    `${url}/login-এ গিয়ে "OTP Sign In" ট্যাবে আপনার মোবাইল নম্বর দিয়ে সাইন ইন করুন। প্রথমবার সাইন-ইনে দুই-স্তর যাচাই সেট করতে হবে।`,
  ].join('\n');
  await emailSender(email, { subject, text });
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} deps    { db, cache, emailSender, config }
 * @param {object} actor   { id }
 * @param {object} input   request body
 * @param {object} meta    { ip, userAgent, traceId } for the audit row
 */
export async function provisionStaff({ db, emailSender, config }, actor, input, meta = {}) {
  const v = validateProvision(input);

  const created = await withTransaction(db, async (tx) => {
    const role = await staffRepo.findStaffRoleByKey(tx, v.roleKey, STAFF_MIN_ROLE_LEVEL);
    if (!role) throw invalid('role_key', 'Choose a valid staff role.', 'সঠিক স্টাফ রোল নির্বাচন করুন।');

    const clash = await staffRepo.findConflictingContact(tx, { email: v.email, phone: v.phone });
    if (clash) throw duplicateContact(clash);

    let userId;
    try {
      userId = await staffRepo.insertStaffUser(tx, { ref: generateRef('USR'), phone: v.phone, email: v.email });
    } catch (err) {
      // Two provisions racing past the pre-check: the unique constraint is the real arbiter.
      if (err?.code === '23505') throw duplicateContact(/phone/.test(err.constraint ?? '') ? 'phone' : 'email');
      throw err;
    }
    await staffRepo.insertStaffProfile(tx, { userId, fullName: v.fullName, department: v.department });
    await staffRepo.insertUserRole(tx, { userId, roleId: role.id, assignedBy: actor.id });

    const row = await staffRepo.getStaffById(tx, userId, STAFF_MIN_ROLE_LEVEL);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'staff.account.create',
      targetType: 'staff',
      targetRef: row.ref,
      before: {},
      after: { role_key: role.key, status: 'INVITED' },
      riskTier: 'CRITICAL',
      ...meta,
    });
    return row;
  });

  // Outside the transaction on purpose: an SMTP outage must not undo a committed, audited account.
  // The admin is told, and "Resend invite" is the recovery.
  let inviteSent = true;
  try {
    await sendInvitation(emailSender, config, { email: created.email, fullName: created.full_name, roleLabelEn: created.role_label_en });
  } catch {
    inviteSent = false;
  }

  const staff = shapeStaff(created);
  return {
    staff,
    invite_sent: inviteSent,
    message_en: inviteSent
      ? `${staff.full_name} was added as ${staff.role_label_en}. An invitation was emailed to ${staff.email}; they sign in with a one-time code sent to their mobile.`
      : `${staff.full_name} was added as ${staff.role_label_en}, but the invitation email could not be sent. Use "Resend invite" once email is available.`,
    message_bn: inviteSent
      ? `${staff.full_name}-কে ${staff.role_label_bn} হিসেবে যোগ করা হয়েছে। ${staff.email}-এ আমন্ত্রণ পাঠানো হয়েছে; তিনি মোবাইলে পাওয়া ওয়ান-টাইম কোড দিয়ে সাইন-ইন করবেন।`
      : `${staff.full_name}-কে ${staff.role_label_bn} হিসেবে যোগ করা হয়েছে, কিন্তু আমন্ত্রণ ইমেইল পাঠানো যায়নি। ইমেইল চালু হলে "আমন্ত্রণ আবার পাঠান" ব্যবহার করুন।`,
  };
}

function duplicateContact(field) {
  return field === 'phone'
    ? new AppError('CONFLICT', 'A staff member with this mobile number already exists.', 'এই মোবাইল নম্বরে আগে থেকেই একজন স্টাফ আছেন।', { field: 'phone' })
    : new AppError('CONFLICT', 'A staff member with this email already exists.', 'এই ইমেইলে আগে থেকেই একজন স্টাফ আছেন।', { field: 'email' });
}

export async function changeRole({ db, cache }, actor, targetId, { role_key: roleKey, reason }, meta = {}) {
  const why = cleanReason(reason);

  const result = await withTransaction(db, async (tx) => {
    // The guard lock comes first, then the target row, in every write — so concurrent requests queue and never deadlock.
    await staffRepo.lockSuperAdminGuard(tx);
    const lockedSupers = await staffRepo.listActiveSuperAdmins(tx);
    if (!(await staffRepo.lockUser(tx, Number(targetId)))) throw notFound();
    const before = await staffRepo.getStaffById(tx, Number(targetId), STAFF_MIN_ROLE_LEVEL);
    if (!before) throw notFound();

    if (Number(before.id) === Number(actor.id)) throw selfAction();

    const role = await staffRepo.findStaffRoleByKey(tx, roleKey, STAFF_MIN_ROLE_LEVEL);
    if (!role) throw invalid('role_key', 'Choose a valid staff role.', 'সঠিক স্টাফ রোল নির্বাচন করুন।');
    if (role.key === before.role_key) {
      throw invalid('role_key', "That is already this member's role.", 'এটিই ইতিমধ্যে এই সদস্যের রোল।');
    }
    if (isOnlyActiveSuperAdmin(before, lockedSupers)) throw lastSuperAdmin();

    await staffRepo.replaceStaffRole(tx, { userId: before.id, roleId: role.id, assignedBy: actor.id, minLevel: STAFF_MIN_ROLE_LEVEL });
    await staffRepo.revokeAllSessions(tx, before.id, 'role_changed');

    const after = await staffRepo.getStaffById(tx, before.id, STAFF_MIN_ROLE_LEVEL);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'staff.role.assign',
      targetType: 'staff',
      targetRef: before.ref,
      before: { role_key: before.role_key },
      after: { role_key: after.role_key },
      meta: { reason: why },
      riskTier: 'CRITICAL',
      // The previous role is all it takes to reverse this; recorded so the audit UI can offer undo.
      undoPayload: { role_key: before.role_key },
      ...meta,
    });
    return after;
  });

  await rbacService.invalidateUserPermissionCache(cache, result.id);
  const staff = shapeStaff(result);
  return {
    staff,
    message_en: `${staff.full_name} is now ${staff.role_label_en}. They were signed out and will get the new permissions on next sign-in.`,
    message_bn: `${staff.full_name} এখন ${staff.role_label_bn}। তিনি সাইন-আউট হয়েছেন এবং পরবর্তী সাইন-ইনে নতুন পারমিশন পাবেন।`,
  };
}

export async function changeStatus({ db, cache }, actor, targetId, { status: next, reason }, meta = {}) {
  if (!['ACTIVE', 'SUSPENDED'].includes(next)) {
    throw invalid('status', 'Status must be ACTIVE or SUSPENDED.', 'স্ট্যাটাস ACTIVE বা SUSPENDED হতে হবে।');
  }
  const why = cleanReason(reason);

  const result = await withTransaction(db, async (tx) => {
    await staffRepo.lockSuperAdminGuard(tx);
    const lockedSupers = await staffRepo.listActiveSuperAdmins(tx);
    if (!(await staffRepo.lockUser(tx, Number(targetId)))) throw notFound();
    const before = await staffRepo.getStaffById(tx, Number(targetId), STAFF_MIN_ROLE_LEVEL);
    if (!before) throw notFound();

    if (Number(before.id) === Number(actor.id)) throw selfAction();

    if (next === 'SUSPENDED') {
      if (before.status === 'SUSPENDED') {
        throw new AppError('CONFLICT', 'This account is already suspended.', 'এই অ্যাকাউন্ট আগেই স্থগিত করা হয়েছে।', { reason: 'ALREADY_SUSPENDED' });
      }
      if (isOnlyActiveSuperAdmin(before, lockedSupers)) throw lastSuperAdmin();
      await staffRepo.setUserStatus(tx, before.id, 'SUSPENDED');
      await staffRepo.revokeAllSessions(tx, before.id, 'account_suspended');
    } else {
      if (before.status !== 'SUSPENDED') {
        throw new AppError('CONFLICT', 'Only a suspended account can be reactivated.', 'শুধু স্থগিত অ্যাকাউন্টই পুনরায় সক্রিয় করা যায়।', { reason: 'NOT_SUSPENDED' });
      }
      if (before.account_status === 'BANNED') {
        // A ban is a Trust & Safety sanction, not a staff-management state; lifting it here would bypass that review.
        throw new AppError('CONFLICT', 'This account is banned, not suspended. A ban is lifted through Trust & Safety.', 'এই অ্যাকাউন্ট নিষিদ্ধ, স্থগিত নয়। নিষেধাজ্ঞা ট্রাস্ট ও সেফটির মাধ্যমে তোলা হয়।', { reason: 'ACCOUNT_BANNED' });
      }
      await staffRepo.setUserStatus(tx, before.id, 'ACTIVE');
    }

    const after = await staffRepo.getStaffById(tx, before.id, STAFF_MIN_ROLE_LEVEL);
    await writeAudit(tx, {
      actorId: actor.id,
      action: next === 'SUSPENDED' ? 'staff.account.disable' : 'staff.account.enable',
      targetType: 'staff',
      targetRef: before.ref,
      before: { status: before.status },
      after: { status: after.status },
      meta: { reason: why },
      riskTier: 'CRITICAL',
      ...meta,
    });
    return after;
  });

  await rbacService.invalidateUserPermissionCache(cache, result.id);
  const staff = shapeStaff(result);
  return {
    staff,
    message_en: next === 'SUSPENDED' ? `${staff.full_name} was suspended and signed out everywhere.` : `${staff.full_name} can sign in again.`,
    message_bn: next === 'SUSPENDED' ? `${staff.full_name}-কে স্থগিত করে সব ডিভাইস থেকে সাইন-আউট করা হয়েছে।` : `${staff.full_name} আবার সাইন-ইন করতে পারবেন।`,
  };
}

/**
 * The reset itself, inside a caller-owned transaction. Split from resetTwoFactor() because there are
 * two ways in: the route (which opens its own transaction) and the maker-checker executor below
 * (which is handed an already-open one when a Super Admin approves a delegated admin's request).
 */
async function resetTwoFactorInTx(tx, actorId, targetId, why, meta) {
  if (!(await staffRepo.lockUser(tx, Number(targetId)))) throw notFound();
  const before = await staffRepo.getStaffById(tx, Number(targetId), STAFF_MIN_ROLE_LEVEL);
  if (!before) throw notFound();

  if (Number(before.id) === Number(actorId)) throw selfAction();

  const removed = await staffRepo.deleteEnrolledStaff2fa(tx, before.id);
  if (!removed) {
    throw new AppError(
      'CONFLICT',
      'This member has not enrolled in 2FA yet, so there is nothing to reset.',
      'এই সদস্য এখনো ২এফএ চালু করেননি, তাই রিসেট করার কিছু নেই।',
      { reason: 'NOTHING_TO_RESET' }
    );
  }
  // A reset is done for a locked-out or compromised device: end whatever sessions it opened.
  await staffRepo.revokeAllSessions(tx, before.id, 'two_factor_reset');

  const after = await staffRepo.getStaffById(tx, before.id, STAFF_MIN_ROLE_LEVEL);
  await writeAudit(tx, {
    actorId,
    action: 'security.2fa.reset',
    targetType: 'staff',
    targetRef: before.ref,
    before: { two_factor_enabled: true },
    after: { two_factor_enabled: false },
    meta: { reason: why, ...(meta.approvedBy ? { approved_by: meta.approvedBy } : {}) },
    riskTier: 'HIGH',
    ip: meta.ip,
    userAgent: meta.userAgent,
    traceId: meta.traceId,
  });
  return after;
}

function resetMessages(staff) {
  return {
    staff,
    message_en: `2FA reset for ${staff.full_name}. They must enrol a new authenticator at next sign-in.`,
    message_bn: `${staff.full_name}-এর ২এফএ রিসেট হয়েছে। পরবর্তী সাইন-ইনে নতুন অথেনটিকেটর সেট করতে হবে।`,
  };
}

export async function resetTwoFactor({ db }, actor, targetId, { reason }, meta = {}) {
  const why = cleanReason(reason);
  const after = await withTransaction(db, (tx) => resetTwoFactorInTx(tx, actor.id, targetId, why, meta));
  return resetMessages(shapeStaff(after));
}

/**
 * security.2fa.reset is HIGH-tier: an Admin holding it by delegation does not execute directly —
 * requirePermission defers the request into pending_admin_actions, and only when a Super Admin
 * approves does this run. Without a registered executor, approval would find nothing to run and
 * (correctly) refuse to mark the action applied, so a delegated reset could never happen.
 *
 * The deferral stores the request BODY only; the target member is the :id route param, which the
 * engine keeps as `context.targetRef`. The requester (not the approver) is the audit actor, and the
 * approver is recorded beside the reason.
 */
registerActionExecutor('security.2fa.reset', {
  async validatePreconditions(payload, context) {
    cleanReason(payload?.reason);
    const target = await staffRepo.getStaffById(context.db, Number(context.targetRef), STAFF_MIN_ROLE_LEVEL);
    if (!target) throw new Error('The staff member no longer exists.');
    if (!target.two_factor_enabled) throw new Error('This member has no enrolled 2FA left to reset.');
  },

  async execute(payload, context) {
    const after = await resetTwoFactorInTx(
      context.db,
      context.actorId,
      context.targetRef,
      cleanReason(payload?.reason),
      { ip: context.ip, userAgent: context.userAgent, traceId: context.traceId, approvedBy: context.approverId }
    );
    return resetMessages(shapeStaff(after));
  },
});

export async function resendInvite({ db, cache, emailSender, config }, actor, targetId, meta = {}) {
  const row = await staffRepo.getStaffById(db, Number(targetId), STAFF_MIN_ROLE_LEVEL);
  if (!row) throw notFound();
  if (row.status !== 'INVITED') {
    throw new AppError(
      'CONFLICT',
      'Only members who have not signed in yet can be re-invited.',
      'যারা এখনো সাইন-ইন করেননি শুধু তাদেরই আবার আমন্ত্রণ পাঠানো যায়।',
      { reason: 'NOT_INVITED' }
    );
  }
  // Someone else's inbox: cap it, or this endpoint is a mail cannon.
  await checkBucket(cache, `staff-invite:${row.id}`, INVITE_RESENDS_PER_HOUR, 60 * 60);

  try {
    await sendInvitation(emailSender, config, { email: row.email, fullName: row.full_name ?? row.email, roleLabelEn: row.role_label_en });
  } catch {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'The invitation email could not be sent. Try again shortly.', 'আমন্ত্রণ ইমেইল পাঠানো যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন।');
  }
  await writeAudit(db, {
    actorId: actor.id,
    action: 'staff.account.reinvite',
    targetType: 'staff',
    targetRef: row.ref,
    before: {},
    after: {},
    riskTier: 'MEDIUM',
    ...meta,
  });

  return {
    message_en: `The invitation was re-sent to ${row.email}. They sign in with a one-time code sent to their mobile.`,
    message_bn: `${row.email}-এ আমন্ত্রণ আবার পাঠানো হয়েছে। তিনি মোবাইলে পাওয়া ওয়ান-টাইম কোড দিয়ে সাইন-ইন করবেন।`,
  };
}
