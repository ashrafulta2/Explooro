/**
 * SalerProPage.js — Saler Pro subscription: choose a plan, see the renewal date, cancel or resume.
 *
 * Route: /saler/pro  (guard: finance.subscription.subscribe_own AND module `subscription_fees`).
 * With the module OFF the route and its nav entry disappear, and the API refuses — nothing here
 * has to special-case "feature off".
 *
 * WHY every number comes from the API: the fee, the rebate points and the grace window are all
 * admin-editable per plan / in module settings, so this page never states a fee or a rebate figure itself.
 */

import '../../styles/components/saler-pro.css';
import { salerApi } from '../../services/saler.api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { escapeHtml } from '../../services/html.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';

const LIVE_STATUSES = ['ACTIVE', 'PAST_DUE', 'WAIVED'];

export default function SalerProPage(root) {
  const container = document.createElement('div');
  container.className = 'saler-page-container saler-pro';

  let data = null;
  let loading = true;
  let busy = false;
  let unsubscribeLang = null;

  const pick = (en, bn) => (getLanguage() === 'bn' ? bn || en : en || bn);
  const planName = (p) => pick(p.name_en, p.name_bn);

  async function load() {
    loading = true;
    render();
    try {
      const res = await salerApi.getSubscription();
      data = res?.data ?? res ?? null;
    } catch (err) {
      toast.error(err.message || t('saler_pro.load_failed'));
    } finally {
      loading = false;
      render();
    }
  }

  async function run(action, successKey) {
    if (busy) return;
    busy = true;
    render();
    try {
      await action();
      toast.success(t(successKey));
      await load();
    } catch (err) {
      // WHY the server message: it says *why* (e.g. "Vault balance is too low") in the user's language.
      toast.error(err.message || t('saler_pro.action_failed'));
    } finally {
      busy = false;
      render();
    }
  }

  async function onSubscribe(plan) {
    const paid = Number(plan.monthly_fee) > 0;
    const ok = await confirmDialog({
      title: t('saler_pro.confirm_subscribe_title', { plan: planName(plan) }),
      description: paid
        ? t('saler_pro.confirm_subscribe_paid', { fee: formatCurrency(plan.monthly_fee), days: data.billing_period_days })
        : t('saler_pro.confirm_subscribe_free'),
      confirmLabel: t('saler_pro.btn_subscribe'),
      cancelLabel: t('common.cancel', 'Cancel'),
    });
    if (!ok) return;
    run(() => salerApi.subscribeToPlan({ plan_id: Number(plan.id) }), 'saler_pro.toast_subscribed');
  }

  async function onCancel() {
    const sub = data.subscription;
    const immediate = sub.status !== 'ACTIVE';
    const ok = await confirmDialog({
      title: t('saler_pro.confirm_cancel_title'),
      description: immediate
        ? t('saler_pro.confirm_cancel_now')
        : t('saler_pro.confirm_cancel_later', { date: formatDate(sub.current_period_end) }),
      confirmLabel: t('saler_pro.btn_cancel'),
      cancelLabel: t('saler_pro.btn_keep'),
      variant: 'danger',
    });
    if (!ok) return;
    run(() => salerApi.cancelSubscription(), 'saler_pro.toast_cancelled');
  }

  function statusBadge(sub) {
    const map = { ACTIVE: 'success', PAST_DUE: 'warning', WAIVED: 'brand' };
    return `<span class="badge badge--${map[sub.status] || 'neutral'} badge--sm">${escapeHtml(t(`saler_pro.status_${sub.status.toLowerCase()}`))}</span>`;
  }

  function currentCard() {
    const sub = data.subscription;
    const card = document.createElement('section');
    card.className = 'card saler-pro__current';
    const rebate = Number(sub.commission_rebate_pct) || 0;

    let note = '';
    if (sub.status === 'PAST_DUE') {
      note = t('saler_pro.note_past_due', { date: formatDate(sub.grace_ends_at) });
    } else if (sub.status === 'WAIVED') {
      note = t('saler_pro.note_waived');
    } else if (sub.cancel_at_period_end) {
      note = t('saler_pro.note_cancelling', { date: formatDate(sub.current_period_end) });
    } else if (sub.auto_renew && Number(sub.monthly_fee) > 0) {
      note = t('saler_pro.note_renews', { date: formatDate(sub.current_period_end), fee: formatCurrency(sub.monthly_fee) });
    }

    card.innerHTML = `
      <div class="saler-pro__current-head">
        <div>
          <p class="saler-pro__eyebrow">${escapeHtml(t('saler_pro.current_plan'))}</p>
          <h2 class="saler-pro__plan-name">${escapeHtml(pick(sub.plan_name_en, sub.plan_name_bn))}</h2>
        </div>
        ${statusBadge(sub)}
      </div>
      ${rebate > 0 ? `<p class="saler-pro__perk">${escapeHtml(t('saler_pro.perk_rebate', { pct: rebate }))}</p>` : ''}
      ${note ? `<p class="saler-pro__note ${sub.status === 'PAST_DUE' ? 'saler-pro__note--warn' : ''}">${escapeHtml(note)}</p>` : ''}
      <div class="saler-pro__actions"></div>`;

    const actions = card.querySelector('.saler-pro__actions');
    const mk = (label, cls, handler) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${cls} btn--sm`;
      b.textContent = label;
      b.disabled = busy;
      b.addEventListener('click', handler);
      actions.append(b);
    };
    if (sub.cancel_at_period_end && sub.status === 'ACTIVE') {
      mk(t('saler_pro.btn_resume'), 'btn--primary', () => run(() => salerApi.resumeSubscription(), 'saler_pro.toast_resumed'));
    } else if (sub.status !== 'WAIVED' || Number(sub.monthly_fee) > 0) {
      mk(t('saler_pro.btn_cancel'), 'btn--secondary', onCancel);
    }
    return card;
  }

  function planCard(plan, hasLive) {
    const card = document.createElement('article');
    card.className = 'card saler-pro__plan';
    const features = (getLanguage() === 'bn' ? plan.features_bn?.length ? plan.features_bn : plan.features_en : plan.features_en?.length ? plan.features_en : plan.features_bn) || [];
    const rebate = Number(plan.commission_rebate_pct) || 0;
    const fee = Number(plan.monthly_fee);
    card.innerHTML = `
      <h3 class="saler-pro__plan-name">${escapeHtml(planName(plan))}</h3>
      <p class="saler-pro__price">${fee > 0 ? escapeHtml(formatCurrency(fee)) : escapeHtml(t('saler_pro.free'))}
        ${fee > 0 ? `<span class="saler-pro__per">${escapeHtml(t('saler_pro.per_period', { days: data.billing_period_days }))}</span>` : ''}</p>
      ${rebate > 0 ? `<p class="saler-pro__perk">${escapeHtml(t('saler_pro.perk_rebate', { pct: rebate }))}</p>` : ''}
      <ul class="saler-pro__features">${features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <div class="saler-pro__actions"></div>`;
    const actions = card.querySelector('.saler-pro__actions');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--primary btn--sm';
    btn.textContent = t('saler_pro.btn_subscribe');
    // WHY disabled rather than hidden: the saler can see what else exists, and the reason is shown.
    btn.disabled = busy || hasLive;
    if (hasLive) btn.title = t('saler_pro.already_subscribed');
    btn.addEventListener('click', () => onSubscribe(plan));
    actions.append(btn);
    return card;
  }

  function invoicesTable() {
    const invoices = data.invoices || [];
    const sec = document.createElement('section');
    sec.className = 'card saler-pro__invoices';
    sec.innerHTML = `<h2 class="saler-pro__section-title">${escapeHtml(t('saler_pro.invoices_title'))}</h2>`;
    if (!invoices.length) {
      sec.insertAdjacentHTML('beforeend', `<p class="saler-pro__muted">${escapeHtml(t('saler_pro.no_invoices'))}</p>`);
      return sec;
    }
    const wrap = document.createElement('div');
    wrap.className = 'saler-pro__table-wrap';
    wrap.innerHTML = `<table class="saler-pro__table"><thead><tr>
        <th>${escapeHtml(t('saler_pro.th_period'))}</th><th>${escapeHtml(t('saler_pro.th_amount'))}</th><th>${escapeHtml(t('saler_pro.th_status'))}</th>
      </tr></thead><tbody>${invoices
        .map((i) => `<tr>
          <td>${escapeHtml(formatDate(i.period_start))} – ${escapeHtml(formatDate(i.period_end))}</td>
          <td class="saler-pro__num">${escapeHtml(formatCurrency(i.amount))}</td>
          <td><span class="badge badge--${i.status === 'PAID' ? 'success' : 'warning'} badge--sm">${escapeHtml(t(`saler_pro.invoice_${String(i.status).toLowerCase()}`, i.status))}</span></td>
        </tr>`)
        .join('')}</tbody></table>`;
    sec.append(wrap);
    return sec;
  }

  function render() {
    container.replaceChildren();
    const head = document.createElement('div');
    head.className = 'saler-header-row';
    head.innerHTML = `<div><h1 class="saler-pro__title">${escapeHtml(t('saler_pro.page_title'))}</h1>
      <p class="saler-pro__muted">${escapeHtml(t('saler_pro.page_subtitle'))}</p></div>`;
    container.append(head);

    if (loading || !data) {
      const p = document.createElement('p');
      p.className = 'saler-pro__muted';
      p.textContent = loading ? t('common.loading', 'Loading') : t('saler_pro.load_failed');
      container.append(p);
      return;
    }

    const hasLive = Boolean(data.subscription && LIVE_STATUSES.includes(data.subscription.status));
    if (hasLive) container.append(currentCard());

    const grid = document.createElement('div');
    grid.className = 'saler-pro__plans';
    for (const plan of data.plans || []) {
      // The plan the saler is already on is shown in the current-plan card, not offered again.
      if (hasLive && plan.code === data.subscription.plan_code) continue;
      grid.append(planCard(plan, hasLive));
    }
    if (grid.children.length) {
      const h = document.createElement('h2');
      h.className = 'saler-pro__section-title';
      h.textContent = hasLive ? t('saler_pro.other_plans') : t('saler_pro.choose_plan');
      container.append(h, grid);
    }
    if (hasLive) {
      const hint = document.createElement('p');
      hint.className = 'saler-pro__muted';
      hint.textContent = t('saler_pro.switch_hint');
      container.append(hint);
    }
    container.append(invoicesTable());
  }

  unsubscribeLang = subscribeLang(() => render());
  load();
  root.append(container);

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
