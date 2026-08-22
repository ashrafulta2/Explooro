/**
 * RequestAccessModal.js — JIT Access Request Dialog (Prompt 2.8).
 *
 * Implements Prompt 2.8 Requirement 5:
 * - Displays permission name & plain-language explanation of what it allows.
 * - Mandatory reason field (minimum 10 characters).
 * - Submits via POST /api/v1/access-requests.
 * - Shows live status ("Waiting for Admin approval") and automatically updates UI upon approval.
 */

import { api } from '../../core/api.js';
import { getPermissionMetadata, refreshPermissions, can } from '../../services/permissions.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { Textarea } from '../ui/Textarea.js';

function getPlainLanguage(meta) {
  const isBn = getLanguage() === 'bn';
  return isBn ? meta.plain_bn || meta.plain_en : meta.plain_en || meta.plain_bn;
}

function getFeatureLabel(meta, permissionKey) {
  const isBn = getLanguage() === 'bn';
  return (isBn ? meta?.label_bn : meta?.label_en) || permissionKey;
}

export function openRequestAccessModal({ permission, trigger = null, onSuccess = null }) {
  const meta = getPermissionMetadata(permission) || {};
  const featureName = getFeatureLabel(meta, permission);
  const plainText = getPlainLanguage(meta);

  const container = document.createElement('div');
  container.className = 'request-access-body';

  const explanation = document.createElement('div');
  explanation.className = 'request-access-meta';
  explanation.textContent = t('access.request.explain', { plainLanguage: plainText });

  const reasonField = Textarea({
    label: t('access.request.reason'),
    hint: t('access.request.reason_hint'),
    placeholder: getLanguage() === 'bn' ? 'অনুরোধের বিশদ কারণ লিখুন (কমপক্ষে ১০ অক্ষর)...' : 'Describe why you need elevated access (min 10 chars)...',
    rows: 3,
  });

  const errorMsg = document.createElement('div');
  errorMsg.className = 'text-xs text-danger';
  errorMsg.style.display = 'none';

  container.append(explanation, reasonField, errorMsg);

  let pollInterval = null;

  function cleanupPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  const submitBtn = Button({
    label: t('access.request.submit'),
    variant: 'primary',
    onClick: async () => {
      const reasonVal = reasonField.value?.trim() || '';
      if (reasonVal.length < 10) {
        errorMsg.textContent = getLanguage() === 'bn' ? 'অনুরোধের কারণ কমপক্ষে ১০ অক্ষরের হতে হবে।' : 'Reason must be at least 10 characters long.';
        errorMsg.style.display = 'block';
        return;
      }
      errorMsg.style.display = 'none';

      submitBtn.setLoading(true);
      try {
        const res = await api.post('/access-requests', {
          permission_key: permission,
          reason: reasonVal,
        });

        // Show pending live status inside the modal
        container.replaceChildren();

        const statusCard = document.createElement('div');
        statusCard.className = 'request-access-status';

        const spinner = document.createElement('div');
        spinner.className = 'request-access-status__spinner';

        const statusText = document.createElement('div');
        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.textContent = t('access.modal.waiting_admin');

        const subtitle = document.createElement('div');
        subtitle.className = 'text-xs text-muted';
        const requestRef = res?.data?.ref || res?.deferred?.action_id || 'PGR-LIVE';
        subtitle.textContent = t('access.modal.request_ref', { ref: requestRef });

        statusText.append(title, subtitle);
        statusCard.append(spinner, statusText);
        container.append(statusCard);

        submitBtn.style.display = 'none';

        // Poll for approval every 3s
        let attempts = 0;
        pollInterval = setInterval(async () => {
          attempts++;
          const data = await refreshPermissions();
          if (can(permission)) {
            cleanupPolling();
            toast.success(t('access.granted.toast', { feature: featureName, duration: '2 hours' }));
            modal.closeModal(true);
            onSuccess?.();
          } else if (attempts >= 40) {
            // Stop polling after 2 minutes
            cleanupPolling();
          }
        }, 3000);
      } catch (err) {
        errorMsg.textContent = err.message || t('common.error_generic');
        errorMsg.style.display = 'block';
      } finally {
        submitBtn.setLoading(false);
      }
    },
  });

  const cancelBtn = Button({
    label: t('common.cancel'),
    variant: 'ghost',
    onClick: () => {
      cleanupPolling();
      modal.closeModal(false);
    },
  });

  const footer = document.createDocumentFragment();
  footer.append(cancelBtn, submitBtn);

  const modal = Modal({
    title: t('access.request.title', { feature: featureName }),
    content: container,
    footer,
    onClose: cleanupPolling,
  });

  document.body.append(modal);
  modal.openModal(trigger);
}
