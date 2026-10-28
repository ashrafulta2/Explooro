/**
 * WalletTopUpPage.js — add money to your vault with bKash, Nagad or a card (/wallet/top-up, migration 088).
 *
 * Anyone can advertise (Phase C), and a Boost is paid from the vault, so a shopper who has never sold
 * anything needs a way to put money in. The amount, the methods and the limits all come from the API
 * (`wallet.topup`); the page only shows them.
 *
 * `?amount=` pre-fills the amount and `?return=` (a path on this site) adds a "go back" button after
 * paying, so the Boost wizard can send someone here and get them back with the money in place.
 */

import { Button } from '../components/ui/Button.ts';
import { Input } from '../components/ui/Input.ts';
import { getTopUps, topUp, amountProblem } from '../services/walletTopup.api.js';
import { toast } from '../services/toast.js';
import { t } from '../services/i18n.js';
import { formatCurrency } from '../services/format.js';
import '../styles/components/advertise.css';

const PRESETS = [100, 500, 1000, 2000];
const METHOD_ICON = { BKASH: '📱', NAGAD: '📲', CARD: '💳' };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Only a path on this site may be a "go back" target (never another host). */
function safeReturnPath(value) {
  const p = String(value || '');
  return p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') && p.length < 300 ? p : null;
}

export default function WalletTopUpPage(root) {
  const params = new URLSearchParams(window.location.search);
  const returnPath = safeReturnPath(params.get('return'));
  const page = el('div', 'advertise-page');

  let view = null;
  let loadError = null;
  let busy = false;
  let lastPaid = null;
  const state = { amount: params.get('amount') || '500', method: null };

  async function load() {
    try {
      view = await getTopUps();
      loadError = null;
      if (!state.method) state.method = view.rules.methods[0] || null;
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    }
    render();
  }

  function formCard() {
    const { rules } = view;
    const card = el('section', 'advertise-card');
    card.append(el('h2', 'advertise-card__title', t('topup.form_title')));

    const amount = Input({
      label: t('topup.amount'),
      hint: t('topup.amount_hint', { min: formatCurrency(rules.min_amount), max: formatCurrency(rules.max_amount) }),
      type: 'number',
      name: 'amount',
      value: String(state.amount),
      inputmode: 'decimal',
      required: true,
    });
    amount.input.min = String(rules.min_amount);
    amount.input.max = String(rules.max_amount);
    amount.input.step = '1';
    amount.input.addEventListener('input', () => { state.amount = amount.value; });
    const chips = el('div', 'advertise-chips');
    for (const v of PRESETS.filter((x) => x >= rules.min_amount && x <= rules.max_amount)) {
      const c = el('button', 'advertise-chip', formatCurrency(v));
      c.type = 'button';
      c.setAttribute('aria-pressed', String(Number(state.amount) === v));
      c.addEventListener('click', () => { state.amount = String(v); render(); });
      chips.append(c);
    }
    card.append(amount, chips);

    card.append(el('p', 'advertise-label', t('topup.method')));
    const methods = el('div', 'advertise-options');
    for (const m of rules.methods) {
      const b = el('button', 'advertise-option');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.method === m));
      b.append(el('span', 'advertise-option__icon', METHOD_ICON[m] || '💰'), el('span', 'advertise-option__name', t(`topup.method_${m.toLowerCase()}`)));
      b.addEventListener('click', () => { state.method = m; render(); });
      methods.append(b);
    }
    card.append(methods);
    card.append(el('p', 'advertise-card__hint', t('topup.daily_limit', { limit: formatCurrency(rules.daily_limit) })));

    const actions = el('div', 'advertise-actions');
    const pay = Button({
      label: t('topup.pay', { amount: formatCurrency(Number(state.amount) || 0) }),
      variant: 'primary',
      size: 'sm',
      disabled: busy || !state.method,
      onClick: async () => {
        const problem = amountProblem(state.amount, rules);
        if (problem) {
          toast.error(t(problem, { min: formatCurrency(rules.min_amount), max: formatCurrency(rules.max_amount) }));
          amount.input.focus();
          return;
        }
        busy = true;
        render();
        try {
          const res = await topUp({ amount: state.amount, method: state.method, returnPath: returnPath || '/wallet/top-up' });
          if (res.redirected) return;
          lastPaid = res.paid ? Number(state.amount) : null;
          if (res.paid) toast.success(t('topup.success', { amount: formatCurrency(Number(state.amount)) }));
          else toast.error(t('topup.not_confirmed'));
          view = await getTopUps();
        } catch (err) {
          toast.error(err?.message || t('common.error_generic'));
        } finally {
          busy = false;
          render();
        }
      },
    });
    actions.append(el('span'), pay);
    card.append(actions);
    return card;
  }

  function historyCard() {
    const card = el('section', 'advertise-card');
    card.append(el('h2', 'advertise-card__title', t('topup.history_title')));
    if (!view.items.length) {
      card.append(el('p', 'advertise-card__hint', t('topup.history_empty')));
      return card;
    }
    const list = el('div', 'advertise-mine');
    for (const item of view.items) {
      const row = el('div', 'advertise-mine__row');
      const info = el('div');
      info.append(
        el('div', 'advertise-mine__title', formatCurrency(Number(item.amount))),
        el('div', 'advertise-mine__meta', `${t(`topup.method_${String(item.method).toLowerCase()}`)} · ${t(`topup.status_${String(item.status).toLowerCase()}`)} · ${new Date(item.created_at).toLocaleString()}`)
      );
      row.append(info);
      list.append(row);
    }
    card.append(list);
    return card;
  }

  function render() {
    root.innerHTML = '';
    page.replaceChildren();
    const head = el('header');
    head.append(el('h1', 'advertise-head__title', t('topup.title')), el('p', 'advertise-head__sub', t('topup.subtitle')));
    page.append(head);

    if (loadError) {
      page.append(el('p', 'advertise-note advertise-note--warn', loadError));
    } else if (!view) {
      page.append(el('p', 'advertise-card__hint', t('common.loading')));
    } else {
      const balance = el('div', 'advertise-reach');
      balance.append(el('span', '', t('topup.balance')), el('span', 'advertise-reach__num', formatCurrency(Number(view.balance) || 0)));
      page.append(balance);
      if (lastPaid != null && returnPath) {
        const back = el('div', 'advertise-actions');
        const btn = Button({ label: t('topup.go_back'), variant: 'primary', size: 'sm', onClick: () => { window.location.assign(returnPath); } });
        back.append(el('p', 'advertise-note advertise-note--info', t('topup.added', { amount: formatCurrency(lastPaid) })), btn);
        page.append(back);
      }
      page.append(formCard(), historyCard());
    }
    root.append(page);
  }

  render();
  load();
  return () => {};
}

