/**
 * ReturnsPage.js — Customer Returns & Refunds Listing Page
 *
 * Route: /account/returns
 *
 * Displays all customer return requests with full detail:
 * status, reason, refund amount, tracking, carrier, date, evidence, and notes.
 * All UI strings resolved via t('customer_returns.*') for proper i18n.
 */

import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function ReturnsPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'container mx-auto p-4 md:p-6 space-y-6 max-w-4xl';

  // Header
  const header = document.createElement('div');
  header.className = 'border-b border-subtle pb-5';
  header.innerHTML = `
    <div class="flex items-center gap-2 mb-2">
      <a href="/account" class="text-sm font-bold text-primary hover:underline" data-nav-back>${t('customer_returns.back_to_account')}</a>
    </div>
    <h1 class="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">${t('customer_returns.page_title')}</h1>
    <p class="text-sm text-muted mt-1">${t('customer_returns.page_subtitle')}</p>
  `;
  container.append(header);

  header.querySelector('[data-nav-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    nav('/account');
  });

  // List slot
  const listSlot = document.createElement('div');
  listSlot.className = 'space-y-4';
  container.append(listSlot);
  root.append(container);

  // Format date helper
  function formatDate(dateStr) {
    try {
      const lang = getLanguage();
      return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  }

  // Resolve reason code to translated label
  function getReasonLabel(code) {
    return t(`customer_returns.reason_codes.${code}`);
  }

  // Resolve status to translated badge
  function getStatusBadge(status) {
    const label = t(`customer_returns.status.${status}`);
    const variantMap = {
      REQUESTED: 'warning',
      RECEIVED: 'primary',
      INSPECTED: 'info',
      APPROVED: 'success',
      REFUNDED: 'success',
      REJECTED: 'danger',
      DISPUTED: 'warning',
    };
    const variant = variantMap[status] || 'neutral';
    return `<span class="badge badge--${variant}">${label}</span>`;
  }

  async function loadReturns() {
    listSlot.innerHTML = '';
    listSlot.append(
      Skeleton({ width: '100%', height: '140px' }),
      Skeleton({ width: '100%', height: '140px' }),
      Skeleton({ width: '100%', height: '140px' })
    );

    try {
      const res = await api.get('/returns/my-returns');
      const returns = res.data?.returns || res.returns || res.data || [];
      renderReturns(Array.isArray(returns) ? returns : []);
    } catch (err) {
      listSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'py-8 text-center text-danger';
      errBox.textContent = t('customer_returns.load_failed');
      listSlot.append(errBox);
    }
  }

  function renderReturns(returns) {
    listSlot.innerHTML = '';

    if (returns.length === 0) {
      const empty = EmptyState({
        icon: '🔄',
        title: t('customer_returns.empty_title'),
        description: t('customer_returns.empty_desc'),
      });
      listSlot.append(empty.element || empty);
      return;
    }

    returns.forEach((ret) => {
      const card = document.createElement('div');
      card.className = 'p-5 rounded-2xl border border-subtle bg-surface shadow-sm space-y-4';

      // Top row: ref + status + refund amount
      const topRow = `
        <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-subtle pb-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-mono font-bold text-foreground">#${ret.ref}</span>
              ${getStatusBadge(ret.status)}
            </div>
            <div class="text-xs text-muted">
              ${t('customer_returns.order_ref_label')}: <span class="font-bold">${ret.sub_order_ref || ret.sub_order_id || '—'}</span>
            </div>
          </div>
          <div class="text-left sm:text-right">
            <div class="text-[11px] text-muted uppercase font-bold">${t('customer_returns.refund_amount_label')}</div>
            <div class="text-lg font-extrabold text-foreground font-mono">${formatCurrency(ret.refund_amount || 0)}</div>
          </div>
        </div>
      `;

      // Details grid: reason, tracking, carrier, date
      const detailsGrid = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div class="text-muted font-bold mb-0.5">${t('customer_returns.reason_label')}</div>
            <div class="text-foreground font-semibold">${getReasonLabel(ret.reason_code)}</div>
          </div>
          <div>
            <div class="text-muted font-bold mb-0.5">${t('customer_returns.tracking_label')}</div>
            <div class="text-foreground font-mono">${ret.reverse_tracking_number || '—'}</div>
          </div>
          <div>
            <div class="text-muted font-bold mb-0.5">${t('customer_returns.carrier_label')}</div>
            <div class="text-foreground">${ret.reverse_carrier || '—'}</div>
          </div>
          <div>
            <div class="text-muted font-bold mb-0.5">${t('customer_returns.submitted_on_label')}</div>
            <div class="text-foreground">${ret.created_at ? formatDate(ret.created_at) : '—'}</div>
          </div>
        </div>
      `;

      // Note
      const noteSection = `
        <div class="text-xs">
          <span class="text-muted font-bold">${t('customer_returns.note_label')}:</span>
          <span class="text-foreground ml-1">${ret.customer_note || t('customer_returns.no_note')}</span>
        </div>
      `;

      // Evidence thumbnails (if any)
      const evidenceUrls = ret.evidence_urls_json || ret.evidence_urls || [];
      let evidenceSection = '';
      if (evidenceUrls.length > 0) {
        const thumbs = evidenceUrls.map((url, idx) =>
          `<a href="${url}" target="_blank" rel="noopener noreferrer" class="block w-16 h-16 rounded-lg overflow-hidden border border-subtle hover:border-primary/50 transition-all">
            <img src="${url}" alt="${t('customer_returns.evidence_photo', { index: idx + 1 })}" class="w-full h-full object-cover" loading="lazy" />
          </a>`
        ).join('');
        evidenceSection = `
          <div class="text-xs">
            <div class="text-muted font-bold mb-1">${t('customer_returns.evidence_label')}</div>
            <div class="flex gap-2 flex-wrap">${thumbs}</div>
          </div>
        `;
      }

      card.innerHTML = topRow + detailsGrid + noteSection + evidenceSection;
      listSlot.append(card);
    });
  }

  loadReturns();

  return () => {
    container.remove();
  };
}
