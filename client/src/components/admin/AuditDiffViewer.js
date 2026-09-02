/**
 * AuditDiffViewer.js — Side-by-side before/after JSON diff viewer with key highlights & plain-language summary (Prompt 3.4).
 */

import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { t, getLanguage } from '../../services/i18n.js';

/**
 * Computes deep differences between before and after objects.
 */
export function computeObjectDiff(beforeObj = {}, afterObj = {}) {
  const b = beforeObj || {};
  const a = afterObj || {};
  const allKeys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));

  const modified = [];
  const added = [];
  const removed = [];

  for (const key of allKeys) {
    const hasB = Object.prototype.hasOwnProperty.call(b, key);
    const hasA = Object.prototype.hasOwnProperty.call(a, key);

    if (hasB && !hasA) {
      removed.push(key);
    } else if (!hasB && hasA) {
      added.push(key);
    } else if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      modified.push(key);
    }
  }

  return { modified, added, removed, totalChanges: modified.length + added.length + removed.length };
}

/**
 * Generates a plain-language explanation of what changed in the audit event.
 */
export function generatePlainLanguageSummary(record = {}) {
  const isBn = getLanguage() === 'bn';
  const action = record.action || 'system.mutation';
  const before = record.before || record.before_state_json || {};
  const after = record.after || record.after_state_json || {};
  const meta = record.meta || {};

  if (action === 'module.disable' || (action.includes('module') && after.is_enabled === false)) {
    const mod = record.target_ref || meta.module_key || 'module';
    const reason = meta.reason || after.disabled_reason || 'maintenance';
    return isBn
      ? `"${mod}" মডিউলটি বন্ধ করা হয়েছে (কারণ: "${reason}")`
      : `Disabled module "${mod}" with reason "${reason}"`;
  }

  if (action === 'module.enable' || (action.includes('module') && after.is_enabled === true)) {
    const mod = record.target_ref || meta.module_key || 'module';
    return isBn ? `"${mod}" মডিউলটি সক্রিয় করা হয়েছে` : `Enabled module "${mod}"`;
  }

  if (action.includes('grant.revoke') || action.includes('grant.delete')) {
    const perm = before.permission_key || meta.permission_key || record.target_ref;
    return isBn ? `"${perm}" পারমিশন প্রত্যাহার করা হয়েছে` : `Revoked standing grant "${perm}"`;
  }

  if (action.includes('grant') || action.includes('permission.grant')) {
    const perm = after.permission_key || meta.permission_key || record.target_ref;
    const target = record.target_ref || meta.user_ref || 'user';
    return isBn
      ? `"${target}" কে "${perm}" পারমিশন প্রদান করা হয়েছে`
      : `Granted permission "${perm}" to ${target}`;
  }

  if (action.includes('restriction.lift') || action.includes('restriction.delete')) {
    const cap = before.capability_key || before.capability || meta.capability_key || record.target_ref;
    return isBn ? `"${cap}" সীমাবদ্ধতা তুলে নেওয়া হয়েছে` : `Lifted capability restriction "${cap}"`;
  }

  if (action.includes('restriction')) {
    const cap = after.capability_key || after.capability || meta.capability_key || record.target_ref;
    const mode = after.mode || 'BLOCK';
    const target = record.target_ref || 'user';
    return isBn
      ? `"${target}" এর উপর ${cap}=${mode} সীমাবদ্ধতা প্রয়োগ করা হয়েছে`
      : `Applied capability restriction ${cap}=${mode} on ${target}`;
  }

  // Key-level differences summary
  const diff = computeObjectDiff(before, after);
  if (diff.totalChanges === 0) {
    return isBn ? 'কোনো পরিবর্তন রেকর্ড করা হয়নি।' : 'No property changes recorded.';
  }

  const parts = [];
  if (diff.modified.length > 0) {
    parts.push(isBn ? `${diff.modified.length}টি মান সংশোধিত (${diff.modified.join(', ')})` : `Modified: ${diff.modified.join(', ')}`);
  }
  if (diff.added.length > 0) {
    parts.push(isBn ? `${diff.added.length}টি মান সংযোজিত (${diff.added.join(', ')})` : `Added: ${diff.added.join(', ')}`);
  }
  if (diff.removed.length > 0) {
    parts.push(isBn ? `${diff.removed.length}টি মান অপসারিত (${diff.removed.join(', ')})` : `Removed: ${diff.removed.join(', ')}`);
  }

  return parts.join(' · ');
}

export function AuditDiffViewer({ record = {} }) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'audit-diff-viewer';

  const before = record.before || record.before_state_json || {};
  const after = record.after || record.after_state_json || {};

  // Plain-Language Summary Box
  const summaryBox = document.createElement('div');
  summaryBox.className = 'diff-summary-box';
  const summaryText = generatePlainLanguageSummary(record);
  summaryBox.textContent = `📋 ${summaryText}`;
  container.append(summaryBox);

  // Side-by-side JSON Pane
  const sideBySide = document.createElement('div');
  sideBySide.className = 'diff-side-by-side';

  // Before Pane
  const beforePane = document.createElement('div');
  beforePane.className = 'diff-pane';
  const beforeHeader = document.createElement('div');
  beforeHeader.className = 'diff-pane__header';
  beforeHeader.style.color = 'var(--danger, #ef4444)';
  beforeHeader.textContent = t('audit_diff.before_label');

  const beforePre = document.createElement('pre');
  beforePre.className = 'diff-pane__pre';
  beforePre.textContent = Object.keys(before).length > 0 ? JSON.stringify(before, null, 2) : '(none)';
  beforePane.append(beforeHeader, beforePre);

  // After Pane
  const afterPane = document.createElement('div');
  afterPane.className = 'diff-pane';
  const afterHeader = document.createElement('div');
  afterHeader.className = 'diff-pane__header';
  afterHeader.style.color = 'var(--success, #10b981)';
  afterHeader.textContent = t('audit_diff.after_label');

  const afterPre = document.createElement('pre');
  afterPre.className = 'diff-pane__pre';
  afterPre.textContent = Object.keys(after).length > 0 ? JSON.stringify(after, null, 2) : '(none)';
  afterPane.append(afterHeader, afterPre);

  sideBySide.append(beforePane, afterPane);
  container.append(sideBySide);

  return container;
}

export function openAuditDiffModal({ record = {}, trigger = null }) {
  const isBn = getLanguage() === 'bn';
  const content = AuditDiffViewer({ record });

  const closeBtn = Button({
    label: isBn ? 'বন্ধ করুন' : 'Close',
    variant: 'secondary',
    onClick: () => modal.closeModal(),
  });

  const modal = Modal({
    title: t('audit_diff.title'),
    content,
    footer: closeBtn,
    size: 'lg',
  });

  document.body.append(modal);
  modal.openModal(trigger);
}

/**
 * Serializes an array of audit record objects into CSV format with standard quoting & escaping.
 */
export function serializeAuditRecordsToCsv(records = []) {
  const headers = ['ID', 'Timestamp', 'Actor Role', 'Action', 'Target Type', 'Target Ref', 'IP Address', 'Trace ID', 'Risk Tier'];
  const rows = records.map((r) => [
    r.id ?? '',
    r.created_at ?? '',
    r.actor_role ?? r.actor ?? '',
    r.action ?? '',
    r.target_type ?? '',
    r.target_ref ?? '',
    r.ip_address ?? '',
    r.trace_id ?? '',
    r.risk_tier ?? '',
  ]);

  return [
    headers.join(','),
    ...rows.map((row) =>
      row
        .map((cell) => {
          const str = String(cell ?? '');
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    ),
  ].join('\n');
}
