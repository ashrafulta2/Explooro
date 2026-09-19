/**
 * AdminB2bEscrowPage.js — B2B Wholesale Escrow Governance & Milestone Settlement (Prompt 10.6).
 *
 * Implements:
 * 1. B2B wholesale escrow metrics (total value, active contracts, disbursed value, disputed deals).
 * 2. Deal cards with the agreed-terms SHA-256 hash and a per-deal disbursement progress bar.
 * 3. Staged milestone schedule with a real release action against POST /b2b-escrow/milestones/:id/release.
 * 4. Maker-Checker: a non-super-admin release comes back as a queued action, not a settlement.
 * 5. Loading skeleton, empty state, error state with retry, and English ↔ Bangla via i18n keys.
 *
 * WHY this reads /b2b-escrow/deals: the page used to call a fabricated /admin/finance/b2b-escrow
 * endpoint that the server never implemented, swallowed the resulting failure, and rendered a
 * hard-coded list of two deals — so live mode showed fake money. The real list endpoint already
 * returns every deal (with milestones) to admins, so the page now uses it and surfaces failures.
 */

import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { listB2bDeals, releaseMilestone } from '../../services/b2bEscrow.api.js';
import { FinanceSubnav } from '../../components/admin/FinanceSubnav.js';

// WHY dynamic: Vite splits this into the route's CSS chunk (keeping it out of the entry bundle's
// budget), and the node:test suite imports page modules directly, where a static `.css` import
// throws ERR_UNKNOWN_FILE_EXTENSION. A failed load leaves the markup usable, just unstyled.
let stylesPromise = null;
function loadStyles() {
  if (!stylesPromise) {
    stylesPromise = import('../../styles/components/b2b-escrow.css').catch(() => {
      stylesPromise = null;
    });
  }
  return stylesPromise;
}

const LIVE_DEAL_STATUSES = new Set(['LOCKED_IN_ESCROW', 'IN_PROGRESS']);

const DEAL_STATUS_TONE = {
  IN_PROGRESS: 'info',
  LOCKED_IN_ESCROW: 'info',
  COMPLETED: 'success',
  DISPUTED: 'danger',
  CANCELLED: 'danger',
  DRAFT: 'neutral',
  PENDING_BUYER_ACCEPTANCE: 'warning',
  PENDING_SUPPLIER_ACCEPTANCE: 'warning',
};

const MILESTONE_STATUS_TONE = {
  RELEASED: 'success',
  EVIDENCE_SUBMITTED: 'warning',
  FROZEN: 'danger',
  REFUNDED: 'info',
  PENDING: 'neutral',
};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function AdminB2bEscrowPage(root, { navigate } = {}) {
  loadStyles();
  const container = document.createElement('div');
  container.className = 'admin-page b2b-escrow-page';

  let deals = [];
  let loadError = false;
  let isLoading = true;
  let searchQuery = '';
  const releasing = new Set();

  const lang = () => getLanguage();
  const pick = (en, bn) => (lang() === 'bn' && bn ? bn : en);

  function dealTitle(d) {
    return pick(d.title_en || d.deal_title || d.ref, d.title_bn);
  }
  function milestoneLabel(m, index) {
    return pick(m.label_en || m.title, m.label_bn) || `#${m.sequence_no ?? index + 1}`;
  }

  async function loadData({ silent = false } = {}) {
    if (!silent) {
      isLoading = true;
      loadError = false;
      render();
    }
    try {
      const res = await listB2bDeals();
      const list = Array.isArray(res) ? res : res?.data;
      deals = Array.isArray(list) ? list : [];
      loadError = false;
    } catch {
      // Keep the last good list on a silent refresh; on a full load show the error state.
      if (!silent) deals = [];
      loadError = true;
    } finally {
      isLoading = false;
      render();
    }
  }

  function releasedAmountOf(d) {
    if (d.released_amount != null) return num(d.released_amount);
    return (d.milestones || []).filter((m) => m.status === 'RELEASED').reduce((s, m) => s + num(m.amount), 0);
  }

  function computeStats() {
    let total = 0;
    let released = 0;
    let frozen = 0;
    let active = 0;
    let disputes = 0;
    deals.forEach((d) => {
      total += num(d.total_amount);
      released += releasedAmountOf(d);
      frozen += num(d.frozen_amount);
      if (LIVE_DEAL_STATUSES.has(d.status)) active += 1;
      if (d.status === 'DISPUTED') disputes += 1;
    });
    return { total, released, frozen, active, disputes };
  }

  function pill(tone, text) {
    const mod = tone && tone !== 'neutral' ? ` b2b-pill--${tone}` : '';
    return `<span class="b2b-pill${mod}">${escapeHtml(text)}</span>`;
  }

  function dealStatusLabel(status) {
    return t(`admin_b2b_escrow.deal_status_${String(status).toLowerCase()}`, String(status));
  }
  function milestoneStatusLabel(status) {
    return t(`admin_b2b_escrow.milestone_status_${String(status).toLowerCase()}`, String(status));
  }

  // A milestone can only be released while the deal's funds are actually held in escrow, and only
  // once the supplier has submitted proof (or the contract never required any).
  function isReleasable(deal, m) {
    if (!LIVE_DEAL_STATUSES.has(deal.status)) return false;
    if (m.status === 'EVIDENCE_SUBMITTED') return true;
    return m.status === 'PENDING' && (!m.evidence_required || m.evidence_required === 'NONE');
  }

  function milestoneFooter(deal, m) {
    if (m.status === 'RELEASED') return `<span>✓ ${escapeHtml(t('admin_b2b_escrow.disbursed'))}</span>`;
    if (m.status === 'FROZEN') return `<span>❄ ${escapeHtml(t('admin_b2b_escrow.frozen_note'))}</span>`;
    if (m.status === 'REFUNDED') return `<span>↩ ${escapeHtml(t('admin_b2b_escrow.refunded_note'))}</span>`;
    if (isReleasable(deal, m)) {
      const busy = releasing.has(m.id);
      return `
        <button type="button" class="btn btn--secondary btn--sm release-milestone-btn"
          data-deal-id="${escapeHtml(deal.id)}" data-milestone-id="${escapeHtml(m.id)}" ${busy ? 'disabled' : ''}>
          ⚡ ${escapeHtml(busy ? t('common.processing') : t('admin_b2b_escrow.release_btn'))}
        </button>`;
    }
    if (!LIVE_DEAL_STATUSES.has(deal.status)) return `<span>🔒 ${escapeHtml(t('admin_b2b_escrow.locked'))}</span>`;
    return `<span>⏳ ${escapeHtml(t('admin_b2b_escrow.awaiting_proof'))}</span>`;
  }

  function milestoneCard(deal, m, index) {
    const ready = isReleasable(deal, m);
    const mod = m.status === 'RELEASED' ? ' b2b-milestone--released'
      : m.status === 'FROZEN' ? ' b2b-milestone--frozen'
      : ready ? ' b2b-milestone--ready' : '';
    const pct = m.release_pct != null && m.release_pct !== ''
      ? `<div class="b2b-milestone__pct">${escapeHtml(t('admin_b2b_escrow.pct_of_deal', { pct: num(m.release_pct) }))}</div>`
      : '';
    return `
      <article class="b2b-milestone${mod}">
        <div class="b2b-milestone__top">
          <div class="b2b-milestone__row">
            <h4 class="b2b-milestone__title">${escapeHtml(milestoneLabel(m, index))}</h4>
            ${pill(MILESTONE_STATUS_TONE[m.status] || 'neutral', milestoneStatusLabel(m.status))}
          </div>
          <div class="b2b-milestone__amount">${escapeHtml(formatCurrency(num(m.amount)))}</div>
          ${pct}
        </div>
        <div class="b2b-milestone__foot">${milestoneFooter(deal, m)}</div>
      </article>`;
  }

  function dealCard(d) {
    const total = num(d.total_amount);
    const released = releasedAmountOf(d);
    const pct = total > 0 ? Math.min(100, Math.round((released / total) * 100)) : 0;
    const hash = String(d.agreed_terms_hash || d.checksum_sha256 || '');
    const milestones = d.milestones || [];

    return `
      <section class="b2b-deal" aria-label="${escapeHtml(d.ref)}">
        <div class="b2b-deal__head">
          <div class="b2b-deal__main">
            <div class="b2b-deal__ref-row">
              <span class="b2b-deal__ref">${escapeHtml(d.ref || d.deal_ref)}</span>
              ${pill(DEAL_STATUS_TONE[d.status] || 'neutral', dealStatusLabel(d.status))}
            </div>
            <h3 class="b2b-deal__title">${escapeHtml(dealTitle(d))}</h3>
            <div class="b2b-deal__parties">
              <span>${escapeHtml(t('admin_b2b_escrow.buyer'))}: <strong>${escapeHtml(d.buyer_name)}</strong></span>
              <span>${escapeHtml(t('admin_b2b_escrow.supplier'))}: <strong>${escapeHtml(d.supplier_name)}</strong></span>
            </div>
          </div>

          <div class="b2b-deal__summary">
            <span class="b2b-deal__total-label">${escapeHtml(t('admin_b2b_escrow.contract_total'))}</span>
            <span class="b2b-deal__total">${escapeHtml(formatCurrency(total))}</span>
            ${hash ? `
              <span class="system-table__checksum-box" title="${escapeHtml(hash)}">
                SHA-256: ${escapeHtml(hash.slice(0, 10))}…${escapeHtml(hash.slice(-6))}
              </span>` : ''}
            <span class="b2b-deal__created">${escapeHtml(t('admin_b2b_escrow.created'))} ${escapeHtml(formatDate(d.created_at))}</span>
          </div>
        </div>

        <div class="b2b-progress">
          <div class="b2b-progress__meta">
            <span>${escapeHtml(t('admin_b2b_escrow.disbursed_progress'))}</span>
            <span>${escapeHtml(formatCurrency(released))} / ${escapeHtml(formatCurrency(total))} · ${pct}%</span>
          </div>
          <div class="b2b-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
            aria-label="${escapeHtml(t('admin_b2b_escrow.disbursed_progress'))}">
            <div class="b2b-progress__fill" style="width: ${pct}%"></div>
          </div>
        </div>

        <div class="b2b-milestones">
          <h4 class="b2b-milestones__heading">${escapeHtml(t('admin_b2b_escrow.milestone_schedule'))}</h4>
          ${milestones.length
            ? `<div class="b2b-milestones__grid">${milestones.map((m, i) => milestoneCard(d, m, i)).join('')}</div>`
            : `<p class="text-xs text-muted">${escapeHtml(t('admin_b2b_escrow.no_milestones'))}</p>`}
        </div>
      </section>`;
  }

  function filteredDeals() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) =>
      [d.ref, d.deal_ref, d.buyer_name, d.supplier_name, d.title_en, d.title_bn, d.deal_title]
        .some((v) => String(v || '').toLowerCase().includes(q)));
  }

  function stateBlock(icon, title, desc, withRetry = false) {
    return `
      <div class="b2b-state" role="status">
        <span aria-hidden="true" style="font-size: 32px;">${icon}</span>
        <h3 class="b2b-state__title">${escapeHtml(title)}</h3>
        <p class="b2b-state__desc">${escapeHtml(desc)}</p>
        ${withRetry ? `<button type="button" class="btn btn--primary btn--sm retry-btn">${escapeHtml(t('common.retry'))}</button>` : ''}
      </div>`;
  }

  // Only the deal list is re-rendered while typing in search, so the input keeps focus.
  function renderDeals() {
    const mount = container.querySelector('.b2b-deals');
    const count = container.querySelector('.b2b-toolbar__count');
    if (!mount) return;

    if (loadError && !deals.length) {
      mount.innerHTML = stateBlock('⚠️', t('admin_b2b_escrow.load_failed_title'), t('admin_b2b_escrow.load_failed_desc'), true);
      if (count) count.textContent = '';
      mount.querySelector('.retry-btn')?.addEventListener('click', () => loadData());
      return;
    }

    const list = filteredDeals();
    if (count) count.textContent = t('admin_b2b_escrow.results_count', { shown: list.length, total: deals.length });

    if (!deals.length) {
      mount.innerHTML = stateBlock('🤝', t('admin_b2b_escrow.empty_title'), t('admin_b2b_escrow.empty_desc'));
    } else if (!list.length) {
      mount.innerHTML = stateBlock('🔍', t('admin_b2b_escrow.no_match_title'), t('admin_b2b_escrow.no_match_desc'));
    } else {
      mount.innerHTML = list.map(dealCard).join('');
    }

    mount.querySelectorAll('.release-milestone-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleRelease(btn));
    });
  }

  async function handleRelease(btn) {
    const dealId = String(btn.getAttribute('data-deal-id'));
    const milestoneId = String(btn.getAttribute('data-milestone-id'));
    const deal = deals.find((x) => String(x.id) === dealId);
    const milestone = deal?.milestones?.find((m) => String(m.id) === milestoneId);
    if (!deal || !milestone || releasing.has(milestone.id)) return;

    const confirmed = await confirmDialog({
      title: t('admin_b2b_escrow.confirm_title', { label: milestoneLabel(milestone) }),
      description: t('admin_b2b_escrow.confirm_desc', {
        amount: formatCurrency(num(milestone.amount)),
        supplier: deal.supplier_name,
      }),
      confirmLabel: t('admin_b2b_escrow.confirm_label'),
      cancelLabel: t('common.cancel'),
      trigger: btn,
    });
    if (!confirmed) return;

    releasing.add(milestone.id);
    renderDeals();
    try {
      const res = await releaseMilestone(milestone.id);
      const payload = res?.data ?? res;
      if (payload?.is_pending_maker_checker) {
        toast.info(t('admin_b2b_escrow.queued_maker_checker'));
      } else {
        toast.success(t('admin_b2b_escrow.released_success'));
      }
    } catch (err) {
      toast.error(err?.message || t('admin_b2b_escrow.release_failed'));
    } finally {
      releasing.delete(milestone.id);
    }
    // Re-read from the server: the ledger, not this page, decides what actually settled.
    await loadData({ silent: true });
  }

  function skeleton() {
    return `
      <div class="b2b-skeleton" aria-busy="true" aria-live="polite">
        <span class="sr-only">${escapeHtml(t('common.loading'))}</span>
        <div class="admin-kpi-grid">
          ${'<div class="b2b-skeleton__block b2b-skeleton__block--kpi"></div>'.repeat(4)}
        </div>
        <div class="b2b-skeleton__block b2b-skeleton__block--deal"></div>
        <div class="b2b-skeleton__block b2b-skeleton__block--deal"></div>
      </div>`;
  }

  function render() {
    root.innerHTML = '';

    const header = `
      <div class="admin-page-header">
        <div>
          <div class="admin-page-eyebrow">
            <span class="badge badge--neutral">🤝 ${escapeHtml(t('admin_b2b_escrow.eyebrow'))}</span>
          </div>
          <h1 class="admin-page-title">${escapeHtml(t('admin_b2b_escrow.title'))}</h1>
          <p class="admin-page-subtitle">${escapeHtml(t('admin_b2b_escrow.subtitle'))}</p>
        </div>
        <div class="admin-page-actions">
          <button type="button" class="btn btn--secondary btn--sm refresh-btn" ${isLoading ? 'disabled' : ''}>
            🔄 ${escapeHtml(t('common.refresh'))}
          </button>
        </div>
      </div>
      <div class="finance-subnav-mount"></div>`;

    if (isLoading) {
      container.innerHTML = header + skeleton();
    } else {
      const s = computeStats();
      container.innerHTML = `${header}
        <div class="admin-kpi-grid">
          <div class="admin-kpi-card">
            <div class="admin-kpi-card__label">${escapeHtml(t('admin_b2b_escrow.kpi_total_label'))}</div>
            <div class="admin-kpi-card__val font-mono text-primary">${escapeHtml(formatCurrency(s.total))}</div>
            <div class="admin-kpi-card__hint">${escapeHtml(t('admin_b2b_escrow.kpi_total_hint', { count: deals.length }))}</div>
          </div>
          <div class="admin-kpi-card">
            <div class="admin-kpi-card__label">${escapeHtml(t('admin_b2b_escrow.kpi_active_label'))}</div>
            <div class="admin-kpi-card__val font-mono text-brand">${s.active}</div>
            <div class="admin-kpi-card__hint">${escapeHtml(t('admin_b2b_escrow.kpi_active_hint'))}</div>
          </div>
          <div class="admin-kpi-card">
            <div class="admin-kpi-card__label">${escapeHtml(t('admin_b2b_escrow.kpi_settled_label'))}</div>
            <div class="admin-kpi-card__val font-mono text-success">${escapeHtml(formatCurrency(s.released))}</div>
            <div class="admin-kpi-card__hint">${escapeHtml(t('admin_b2b_escrow.kpi_settled_hint'))}</div>
          </div>
          <div class="admin-kpi-card">
            <div class="admin-kpi-card__label">${escapeHtml(t('admin_b2b_escrow.kpi_disputed_label'))}</div>
            <div class="admin-kpi-card__val font-mono text-danger">${s.disputes}</div>
            <div class="admin-kpi-card__hint">${escapeHtml(t('admin_b2b_escrow.kpi_disputed_hint', { amount: formatCurrency(s.frozen) }))}</div>
          </div>
        </div>

        <div class="admin-toolbar">
          <div class="admin-toolbar__search">
            <input type="search" class="input b2b-search" value="${escapeHtml(searchQuery)}"
              aria-label="${escapeHtml(t('admin_b2b_escrow.search_placeholder'))}"
              placeholder="${escapeHtml(t('admin_b2b_escrow.search_placeholder'))}" />
          </div>
          <span class="b2b-toolbar__count" aria-live="polite"></span>
        </div>

        <div class="b2b-deals"></div>`;
    }

    const subnavMount = container.querySelector('.finance-subnav-mount');
    if (subnavMount) subnavMount.replaceWith(FinanceSubnav({ activeKey: 'b2b-escrow', navigate }));

    container.querySelector('.refresh-btn')?.addEventListener('click', () => loadData());
    container.querySelector('.b2b-search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderDeals();
    });

    if (!isLoading) renderDeals();
    root.appendChild(container);
  }

  loadData();
}
