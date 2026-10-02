/**
 * RestrictionEditor.js — Capability switch grid, numeric limits, modes & segment dry-run builder (Prompt 3.3).
 */

import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Select } from '../ui/Select.js';
import { Switch } from '../ui/Switch.js';
import { Textarea } from '../ui/Textarea.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';

// WHY: these must mirror VALID_CAPABILITIES / VALID_NUMERIC_LIMITS in
// server/src/services/restriction.service.js — any key not in those sets is rejected with
// "Invalid capability_key", so an option here that the server doesn't know is a dead option.
const CAPABILITIES = [
  'can_sell',
  'can_list_products',
  'can_buy',
  'can_use_cod',
  'can_withdraw',
  'can_chat',
  'can_live_stream',
  'can_run_ads',
  'can_refer',
  'can_post_review',
  'can_upload_video',
  'can_login',
];

const NUMERIC_LIMITS = [
  'max_cod_order_value',
  'max_withdrawal_per_day',
  'max_products',
  'max_daily_messages',
  'ad_budget_cap',
];

export function openRestrictionEditor({ user = null, trigger = null, onSuccess = null }) {
  const isBn = getLanguage() === 'bn';

  const container = document.createElement('div');
  container.className = 'module-drawer-form';

  // Scope: User vs Segment
  let scope = user ? 'USER' : 'SEGMENT';
  let targetUserRef = user?.ref || '';

  const scopeSelect = Select({
    label: isBn ? 'রেস্ট্রিকশন স্কোপ' : 'Restriction Scope',
    value: scope,
    options: [
      { value: 'USER', label: t('restrictions.scope_user') },
      { value: 'SEGMENT', label: t('restrictions.scope_segment') },
    ],
    // WHY: Select forwards the native change *event*, not the value. Treating the event as the
    // value left both the user-ref field and the segment builder hidden, so USER scope could
    // never be submitted ("Please provide target user ref" with no field to type it in).
    onChange: (e) => syncScope(e.target.value),
  });

  // User input if USER scope
  const userFieldWrap = document.createElement('div');
  userFieldWrap.style.display = scope === 'USER' ? 'block' : 'none';
  const userInput = Input({
    label: isBn ? 'ব্যবহারকারী রেফারেন্স' : 'Target User Ref',
    value: targetUserRef,
    placeholder: 'e.g. USR-9X82KM',
    onInput: (e) => { targetUserRef = e.target.value.trim(); },
  });
  userFieldWrap.append(userInput);

  function syncScope(next) {
    scope = next;
    userFieldWrap.style.display = next === 'USER' ? 'block' : 'none';
    segmentWrap.style.display = next === 'SEGMENT' ? 'block' : 'none';
  }

  // Segment predicate builder if SEGMENT scope
  const segmentWrap = document.createElement('div');
  segmentWrap.style.display = scope === 'SEGMENT' ? 'block' : 'none';
  segmentWrap.className = 'module-drawer-form__field';

  const segmentInput = Textarea({
    label: isBn ? 'সেগমেন্ট শর্ত (Predicate JSON বা এক্সপ্রেশন)' : 'Segment Predicate (Criteria JSON)',
    placeholder: '{"district": "Sylhet", "return_rate_gt": 0.15}',
    rows: 2,
    onInput: () => debouncePreview(),
  });

  const previewCountBadge = document.createElement('div');
  previewCountBadge.className = 'grant-preview-box';
  previewCountBadge.textContent = isBn ? 'ড্রাই-রান প্রিভিউ: শর্ত লিখুন' : 'Dry-run preview: enter predicate criteria';

  let debounceTimer = null;
  function debouncePreview() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        let criteria = {};
        const raw = segmentInput.value.trim();
        if (raw) {
          try {
            criteria = JSON.parse(raw);
          } catch {
            criteria = { filter: raw };
          }
        }
        const res = await api.post('/admin/restrictions/preview-segment', { criteria });
        const count = res.data?.match_count ?? res.match_count ?? 0;
        previewCountBadge.textContent = t('restrictions.dry_run_preview', { count });
      } catch {
        previewCountBadge.textContent = isBn ? 'ড্রাই-রান প্রিভিউ: অকার্যকর শর্ত' : 'Dry-run preview: invalid criteria';
      }
    }, 400);
  }

  segmentWrap.append(segmentInput, previewCountBadge);

  // Enforcement Mode
  const modeSelect = Select({
    label: isBn ? 'এনফোর্সমেন্ট মোড' : 'Enforcement Mode',
    value: 'BLOCK',
    // Mirrors VALID_MODES on the server (there is no LIMIT mode — a numeric cap is THROTTLE).
    options: [
      { value: 'BLOCK', label: t('restrictions.mode_block') },
      { value: 'THROTTLE', label: t('restrictions.mode_throttle') },
      { value: 'FORCE_REVIEW_QUEUE', label: t('restrictions.mode_review') },
      { value: 'SHADOW_BAN', label: t('restrictions.mode_shadow') },
    ],
    onChange: () => syncLimitField(),
  });

  function getFriendlyTargetLabel(key) {
    const fallback = key
      .replace('can_', 'Allow ')
      .replace('max_', 'Max ')
      .replace(/_/g, ' ')
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return t(`restrictions.cap.${key}`, fallback);
  }

  // Target Capability or Numeric Limit selector
  const allTargets = [
    ...CAPABILITIES.map((c) => ({ value: c, label: getFriendlyTargetLabel(c) })),
    ...NUMERIC_LIMITS.map((n) => ({ value: n, label: getFriendlyTargetLabel(n) })),
  ];

  let selectedCap = allTargets[0].value;
  const capSelect = Select({
    label: isBn ? 'রেস্ট্রিকশন লক্ষ্য' : 'Target Capability / Limit',
    value: selectedCap,
    options: allTargets,
    onChange: (e) => {
      selectedCap = e.target.value;
      syncLimitField();
    },
  });

  const limitValueInput = Input({
    label: isBn ? 'নিউমেরিক সীমা মান' : 'Numeric Limit Value',
    type: 'number',
    placeholder: 'e.g. 5000',
  });
  limitValueInput.style.display = 'none';

  // The server requires limit_value for THROTTLE mode, and it is the whole point of a numeric cap.
  function syncLimitField() {
    const needed = modeSelect.value === 'THROTTLE' || NUMERIC_LIMITS.includes(selectedCap);
    limitValueInput.style.display = needed ? 'block' : 'none';
  }

  // Duration
  const durationSelect = Select({
    label: isBn ? 'সময়কাল' : 'Duration',
    value: '24_hours',
    options: [
      { value: '1_hour', label: isBn ? '১ ঘন্টা' : '1 Hour' },
      { value: '24_hours', label: isBn ? '২৪ ঘন্টা' : '24 Hours' },
      { value: '7_days', label: isBn ? '৭ দিন' : '7 Days' },
      { value: '30_days', label: isBn ? '৩০ দিন' : '30 Days' },
      { value: 'permanent', label: isBn ? 'স্থায়ী' : 'Permanent' },
    ],
  });

  // Mandatory reason
  const reasonTextarea = Textarea({
    label: isBn ? 'কারণ (বাধ্যতামূলক >= ১০ অক্ষর)' : 'Mandatory Reason (>= 10 chars)',
    placeholder: isBn ? 'প্রশাসনিক বা সুরক্ষাজনিত কারণ উল্লেখ করুন…' : 'Document administrative justification for compliance audit…',
    rows: 2,
    required: true,
  });

  container.append(
    scopeSelect,
    userFieldWrap,
    segmentWrap,
    modeSelect,
    capSelect,
    limitValueInput,
    durationSelect,
    reasonTextarea
  );

  const applyBtn = Button({
    label: isBn ? 'রেস্ট্রিকশন প্রয়োগ করুন' : 'Apply Restriction',
    variant: 'danger',
    onClick: async () => {
      const reason = reasonTextarea.value.trim();
      if (reason.length < 10) {
        toast.error(isBn ? 'কমপক্ষে ১০ অক্ষরের কারণ প্রদান বাধ্যতামূলক' : 'A justification of at least 10 characters is mandatory');
        return;
      }

      const subjectType = scopeSelect.value;
      const subjectRef = subjectType === 'USER' ? targetUserRef : 'segment';

      if (subjectType === 'USER' && !subjectRef) {
        toast.error(isBn ? 'ব্যবহারকারী রেফারেন্স লিখুন' : 'Please provide target user ref');
        userInput.focus();
        return;
      }

      // The server rejects a SEGMENT restriction without a segment_predicate *object*.
      let segmentPredicate = null;
      if (subjectType === 'SEGMENT') {
        const raw = segmentInput.value.trim();
        try {
          segmentPredicate = raw ? JSON.parse(raw) : null;
        } catch {
          segmentPredicate = null;
        }
        if (!segmentPredicate || typeof segmentPredicate !== 'object' || Array.isArray(segmentPredicate)) {
          toast.error(isBn ? 'সেগমেন্ট শর্ত একটি বৈধ JSON অবজেক্ট হতে হবে' : 'Segment criteria must be a valid JSON object');
          return;
        }
      }

      let expiresAt = null;
      const dur = durationSelect.value;
      if (dur === '1_hour') expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      else if (dur === '24_hours') expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      else if (dur === '7_days') expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      else if (dur === '30_days') expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

      applyBtn.setLoading(true);
      try {
        await api.post('/admin/restrictions', {
          subject_type: subjectType,
          subject_ref: subjectRef,
          segment_predicate: segmentPredicate,
          capability_key: selectedCap,
          mode: modeSelect.value,
          limit_value: limitValueInput.value ? parseFloat(limitValueInput.value) : null,
          reason,
          expires_at: expiresAt,
        });

        toast.success(isBn ? 'রেস্ট্রিকশন সফলভাবে প্রয়োগ করা হয়েছে' : 'Restriction applied successfully');
        if (onSuccess) onSuccess();
        drawer.closeDrawer(true);
      } catch (err) {
        toast.error(err.message || t('common.error_generic'));
      } finally {
        applyBtn.setLoading(false);
      }
    },
  });

  const cancelBtn = Button({
    label: isBn ? 'বাতিল' : 'Cancel',
    variant: 'ghost',
    onClick: () => drawer.closeDrawer(false),
  });

  const footer = document.createDocumentFragment();
  footer.append(cancelBtn, applyBtn);

  const drawer = Drawer({
    title: t('restrictions.btn_new'),
    content: container,
    footer,
    side: 'right',
    size: 'lg',
  });

  document.body.append(drawer);
  drawer.openDrawer(trigger);
}
