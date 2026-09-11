/**
 * ReturnsPage.js — Customer Returns & Refunds Listing Page
 *
 * Route: /account/returns
 *
 * Displays all customer return requests with structured card layout:
 * status tracker stepper, details grid, copyable reverse tracking,
 * constrained evidence thumbnail preview with lightbox modal, and filter tabs.
 * All UI strings resolved via t('customer_returns.*') for proper i18n.
 */

import '../../styles/components/returns.css';
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { Modal } from '../../components/ui/Modal.js';
import { bindBackControl } from '../../core/navBack.js';

export default function ReturnsPage(root, { navigate } = {}) {
  const nav = (url, opts = {}) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'account-page returns-page';

  let currentTab = 'ALL';
  let allReturns = [];

  // 1. Header
  const header = document.createElement('div');
  header.className = 'account-page__header';
  header.innerHTML = `
    <div>
      <a href="/account" class="account-page__back">
        ${t('customer_returns.back_to_account')}
      </a>
      <div class="account-page__title-wrap">
        <h1 class="account-page__title">
          ${t('customer_returns.page_title')}
        </h1>
        <div class="returns-page__header-actions">
          <a href="/account/orders" class="order-action-btn order-action-btn--ghost" data-view-orders>
            <span class="order-action-btn__icon">📦</span>
            ${t('customer_returns.view_orders_btn')}
          </a>
        </div>
      </div>
      <p class="account-page__subtitle">
        ${t('customer_returns.page_subtitle')}
      </p>
    </div>
  `;
  container.append(header);

  bindBackControl(header.querySelector('.account-page__back'), nav, '/account');

  header.querySelector('[data-view-orders]')?.addEventListener('click', (e) => {
    e.preventDefault();
    nav('/account/orders');
  });

  // 2. Tabs Filter Slot
  const tabsSlot = document.createElement('div');
  tabsSlot.className = 'returns-page__tabs';
  container.append(tabsSlot);

  // 3. List Slot
  const listSlot = document.createElement('div');
  listSlot.className = 'returns-page__list';
  container.append(listSlot);

  root.append(container);

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

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

  function getReasonLabel(code) {
    const key = `customer_returns.reason_codes.${code}`;
    const translated = t(key);
    return translated !== key ? translated : (code || '—');
  }

  function getStatusBadge(status) {
    const key = `customer_returns.status.${status}`;
    const label = t(key) !== key ? t(key) : status;
    const variantMap = {
      REQUESTED: 'warning',
      RECEIVED: 'info',
      INSPECTED: 'info',
      APPROVED: 'success',
      REFUNDED: 'success',
      REJECTED: 'danger',
      DISPUTED: 'warning',
    };
    const variant = variantMap[status] || 'neutral';
    return `<span class="badge badge--${variant}">${escapeHtml(label)}</span>`;
  }

  function getStatusNotice(status) {
    if (status === 'REQUESTED') return t('customer_returns.status_note_requested');
    if (status === 'RECEIVED') return t('customer_returns.status_note_received');
    if (status === 'INSPECTED') return t('customer_returns.status_note_inspected');
    if (status === 'REFUNDED') return t('customer_returns.status_note_refunded');
    return null;
  }

  function renderStepper(status) {
    // 4 stages: Submitted (1) -> Received (2) -> Inspected (3) -> Resolved (4)
    const stageStatus = {
      REQUESTED: 1,
      RECEIVED: 2,
      INSPECTED: 3,
      APPROVED: 4,
      REFUNDED: 4,
      REJECTED: 4,
      DISPUTED: 3,
    };
    const currentStage = stageStatus[status] || 1;
    const isRejected = status === 'REJECTED';

    const steps = [
      { num: 1, label: t('customer_returns.step_submitted') },
      { num: 2, label: t('customer_returns.step_received') },
      { num: 3, label: t('customer_returns.step_inspected') },
      { num: 4, label: isRejected ? t('customer_returns.status.REJECTED') : t('customer_returns.step_resolved') },
    ];

    return `
      <div class="customer-return-card__stepper-wrap">
        <div class="customer-return-card__stepper">
          ${steps.map((step) => {
            let stateClass = '';
            let iconOrNum = step.num;
            if (isRejected && step.num === 4) {
              stateClass = 'customer-return-card__step--danger';
              iconOrNum = '✕';
            } else if (step.num < currentStage || (step.num === 4 && (status === 'REFUNDED' || status === 'APPROVED'))) {
              stateClass = 'customer-return-card__step--done';
              iconOrNum = '✓';
            } else if (step.num === currentStage) {
              stateClass = 'customer-return-card__step--active';
            }
            return `
              <div class="customer-return-card__step ${stateClass}">
                <div class="customer-return-card__step-num">${iconOrNum}</div>
                <div class="customer-return-card__step-label">${escapeHtml(step.label)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function openEvidenceModal(url) {
    const content = document.createElement('div');
    content.className = 'return-evidence-preview';
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Evidence Preview';
    img.loading = 'eager';
    content.append(img);

    const modal = Modal({
      title: t('customer_returns.evidence_modal_title'),
      content,
      size: 'lg',
      showClose: true,
      closeOnScrim: true,
    });
    modal.open();
  }

  async function loadReturns() {
    listSlot.innerHTML = '';
    listSlot.append(
      Skeleton({ width: '100%', height: '180px' }),
      Skeleton({ width: '100%', height: '180px' })
    );

    try {
      const res = await api.get('/returns/my-returns');
      const returns = res.data?.returns || res.returns || res.data || [];
      allReturns = Array.isArray(returns) ? returns : [];
      updateTabs();
      filterAndRender();
    } catch (err) {
      listSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'account-page__error';
      errBox.innerHTML = `<p>${escapeHtml(t('customer_returns.load_failed'))}</p>`;
      listSlot.append(errBox);
    }
  }

  function updateTabs() {
    tabsSlot.innerHTML = '';
    const counts = {
      ALL: allReturns.length,
      REQUESTED: allReturns.filter((r) => r.status === 'REQUESTED').length,
      RECEIVED: allReturns.filter((r) => r.status === 'RECEIVED').length,
      INSPECTED: allReturns.filter((r) => r.status === 'INSPECTED').length,
      REFUNDED: allReturns.filter((r) => r.status === 'REFUNDED' || r.status === 'APPROVED').length,
    };

    const tabsDef = [
      { id: 'ALL', label: t('customer_returns.tab_all'), badge: String(counts.ALL) },
      { id: 'REQUESTED', label: t('customer_returns.tab_requested'), badge: counts.REQUESTED > 0 ? String(counts.REQUESTED) : null },
      { id: 'RECEIVED', label: t('customer_returns.tab_received'), badge: counts.RECEIVED > 0 ? String(counts.RECEIVED) : null },
      { id: 'INSPECTED', label: t('customer_returns.tab_inspected'), badge: counts.INSPECTED > 0 ? String(counts.INSPECTED) : null },
      { id: 'REFUNDED', label: t('customer_returns.tab_refunded'), badge: counts.REFUNDED > 0 ? String(counts.REFUNDED) : null },
    ];

    const tabsComponent = Tabs({
      tabs: tabsDef,
      active: currentTab,
      onChange: (tabId) => {
        if (tabId === currentTab) return;
        currentTab = tabId;
        filterAndRender();
      },
    });
    tabsSlot.append(tabsComponent);
  }

  function filterAndRender() {
    let filtered = allReturns;
    if (currentTab === 'REQUESTED') {
      filtered = allReturns.filter((r) => r.status === 'REQUESTED');
    } else if (currentTab === 'RECEIVED') {
      filtered = allReturns.filter((r) => r.status === 'RECEIVED');
    } else if (currentTab === 'INSPECTED') {
      filtered = allReturns.filter((r) => r.status === 'INSPECTED');
    } else if (currentTab === 'REFUNDED') {
      filtered = allReturns.filter((r) => r.status === 'REFUNDED' || r.status === 'APPROVED');
    }

    renderReturns(filtered);
  }

  function renderReturns(returns) {
    listSlot.innerHTML = '';

    if (returns.length === 0) {
      const empty = EmptyState({
        icon: '🔄',
        title: t('customer_returns.empty_title'),
        description: t('customer_returns.empty_desc'),
        action: {
          label: t('customer_returns.view_orders_btn'),
          onClick: () => nav('/account/orders'),
        },
      });
      listSlot.append(empty.element || empty);
      return;
    }

    returns.forEach((ret) => {
      const card = document.createElement('div');
      card.className = 'customer-return-card';

      // Top Row
      const topRow = `
        <div class="customer-return-card__top">
          <div class="customer-return-card__ref-group">
            <div class="customer-return-card__ref-row">
              <span class="customer-return-card__ref">#${escapeHtml(ret.ref)}</span>
              ${getStatusBadge(ret.status)}
              <a href="/account/orders" class="customer-return-card__order-badge" data-order-ref="${escapeHtml(ret.sub_order_ref || String(ret.sub_order_id) || '')}">
                📦 ${escapeHtml(t('customer_returns.order_ref_label'))}: ${escapeHtml(ret.sub_order_ref || String(ret.sub_order_id) || '—')}
              </a>
            </div>
          </div>
          <div class="customer-return-card__amount-group">
            <div class="customer-return-card__amount-label">${escapeHtml(t('customer_returns.refund_amount_label'))}</div>
            <div class="customer-return-card__amount-value">${formatCurrency(ret.refund_amount || 0)}</div>
          </div>
        </div>
      `;

      // Stepper
      const stepper = renderStepper(ret.status);

      // Status Notice
      const noticeText = getStatusNotice(ret.status);
      const noticeBanner = noticeText
        ? `<div class="customer-return-card__notice">
            <span>ℹ️</span>
            <span>${escapeHtml(noticeText)}</span>
          </div>`
        : '';

      // Details Grid: Reason, Tracking, Carrier, Submitted Date
      const trackingCell = ret.reverse_tracking_number
        ? `<span class="customer-return-card__info-val" style="font-family: var(--font-mono, monospace);">
            ${escapeHtml(ret.reverse_tracking_number)}
            <button type="button" class="customer-return-card__copy-btn" data-copy-tracking="${escapeHtml(ret.reverse_tracking_number)}" title="${escapeHtml(t('customer_returns.copy_tracking'))}" aria-label="${escapeHtml(t('customer_returns.copy_tracking'))}">
              📋
            </button>
          </span>`
        : `<span class="customer-return-card__info-val text-muted">—</span>`;

      const detailsGrid = `
        <div class="customer-return-card__grid">
          <div class="customer-return-card__info-cell">
            <div class="customer-return-card__info-label">${escapeHtml(t('customer_returns.reason_label'))}</div>
            <div class="customer-return-card__info-val">⚠️ ${escapeHtml(getReasonLabel(ret.reason_code))}</div>
          </div>
          <div class="customer-return-card__info-cell">
            <div class="customer-return-card__info-label">${escapeHtml(t('customer_returns.carrier_label'))}</div>
            <div class="customer-return-card__info-val">🚚 ${escapeHtml(ret.reverse_carrier || '—')}</div>
          </div>
          <div class="customer-return-card__info-cell">
            <div class="customer-return-card__info-label">${escapeHtml(t('customer_returns.tracking_label'))}</div>
            ${trackingCell}
          </div>
          <div class="customer-return-card__info-cell">
            <div class="customer-return-card__info-label">${escapeHtml(t('customer_returns.submitted_on_label'))}</div>
            <div class="customer-return-card__info-val">📅 ${ret.created_at ? formatDate(ret.created_at) : '—'}</div>
          </div>
        </div>
      `;

      // Customer Note
      let noteHtml = '';
      if (ret.customer_note && ret.customer_note.trim()) {
        noteHtml = `
          <div class="customer-return-card__note">
            <span class="customer-return-card__note-icon">💬</span>
            <div class="customer-return-card__note-content">
              <span class="customer-return-card__note-label">${escapeHtml(t('customer_returns.note_label'))}:</span>
              ${escapeHtml(ret.customer_note)}
            </div>
          </div>
        `;
      }

      // Evidence Thumbnails
      const evidenceUrls = ret.evidence_urls_json || ret.evidence_urls || [];
      let evidenceHtml = '';
      if (Array.isArray(evidenceUrls) && evidenceUrls.length > 0) {
        evidenceHtml = `
          <div class="customer-return-card__evidence">
            <div class="customer-return-card__evidence-label">${escapeHtml(t('customer_returns.evidence_label'))} (${evidenceUrls.length})</div>
            <div class="customer-return-card__evidence-grid" data-evidence-gallery></div>
          </div>
        `;
      }

      // Card Actions
      const actionsHtml = `
        <div class="customer-return-card__actions">
          <div class="customer-return-card__actions-left">
            <a href="/account/orders" class="order-action-btn order-action-btn--ghost" data-order-link>
              <span class="order-action-btn__icon">📦</span>
              ${escapeHtml(t('customer_returns.view_order'))}
            </a>
          </div>
          <div class="customer-return-card__actions-right">
            ${ret.reverse_tracking_number ? `
              <button type="button" class="order-action-btn order-action-btn--ghost" data-copy-tracking="${escapeHtml(ret.reverse_tracking_number)}">
                <span class="order-action-btn__icon">📋</span>
                ${escapeHtml(t('customer_returns.copy_tracking'))} ${escapeHtml(ret.reverse_tracking_number)}
              </button>
            ` : ''}
          </div>
        </div>
      `;

      card.innerHTML = topRow + stepper + noticeBanner + detailsGrid + noteHtml + evidenceHtml + actionsHtml;

      // Populate evidence gallery elements with event listeners
      if (Array.isArray(evidenceUrls) && evidenceUrls.length > 0) {
        const galleryEl = card.querySelector('[data-evidence-gallery]');
        if (galleryEl) {
          evidenceUrls.forEach((url, idx) => {
            const thumbBtn = document.createElement('button');
            thumbBtn.type = 'button';
            thumbBtn.className = 'customer-return-card__evidence-thumb';
            thumbBtn.title = t('customer_returns.click_to_view');
            thumbBtn.setAttribute('aria-label', `${t('customer_returns.evidence_photo', { index: idx + 1 })} - ${t('customer_returns.click_to_view')}`);

            const img = document.createElement('img');
            img.src = url;
            img.alt = t('customer_returns.evidence_photo', { index: idx + 1 });
            img.className = 'customer-return-card__evidence-img';
            img.loading = 'lazy';

            const overlay = document.createElement('span');
            overlay.className = 'customer-return-card__evidence-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            overlay.textContent = '🔍';

            thumbBtn.append(img, overlay);
            thumbBtn.addEventListener('click', () => openEvidenceModal(url));
            galleryEl.append(thumbBtn);
          });
        }
      }

      // Order badge & links
      card.querySelectorAll('[data-order-ref], [data-order-link]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          nav('/account/orders');
        });
      });

      // Copy tracking buttons
      card.querySelectorAll('[data-copy-tracking]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const trk = btn.getAttribute('data-copy-tracking');
          if (trk && navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(trk)
              .then(() => toast.success(t('customer_returns.tracking_copied')))
              .catch(() => toast.info(trk));
          } else if (trk) {
            toast.info(trk);
          }
        });
      });

      listSlot.append(card);
    });
  }

  loadReturns();

  return () => {
    container.remove();
  };
}
