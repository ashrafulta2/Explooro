/**
 * AdvertisePage.js — anyone can advertise, in three plain steps (/advertise, Phase C, migration 087).
 *
 *   1. What to promote — one of your community posts, your store, or a product (only what you own).
 *   2. Who sees it      — everyone, or chosen people: account type, gender, division, interests,
 *                         with a live "about N people" from the server.
 *   3. Budget and days  — a budget and a number of days; the server's quote says roughly how many
 *                         times it will be shown. Paid from the vault, reviewed before it runs.
 *
 * It always buys the one `easy_boost` format (a home-feed card priced per thousand views), so nobody
 * has to learn CPC, CPM or slots. The full format catalogue stays at /saler/ads for those who want it.
 *
 * Everything shown comes from the API: GET /ads/easy/options, POST /ads/audience-estimate,
 * POST /ads/quote. The page never prices or counts anything itself.
 */

import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.ts';
import { adsApi } from '../services/ads.api.js';
import { toast } from '../services/toast.js';
import { t, getLanguage } from '../services/i18n.js';
import { formatCurrency, formatNumber } from '../services/format.js';
import { STEPS, buildCampaignBody, stepComplete } from './advertiseWizard.js';
import '../styles/components/advertise.css';

const ESTIMATE_DEBOUNCE_MS = 350;
// The half-finished boost, kept while its author goes to add money and comes back (per tab only).
const DRAFT_KEY = 'explooro:advertise:draft';
const BUDGET_PRESETS = [200, 500, 1000, 2000];
const DAY_PRESETS = [3, 7, 14];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export default function AdvertisePage(root) {
  const isBn = getLanguage() === 'bn';
  const name = (o) => (isBn && o?.name_bn ? o.name_bn : o?.name_en) || '';
  const page = el('div', 'advertise-page');

  let options = null;
  let loadError = null;
  let stepIndex = 0;
  let estimate = null;
  let quote = null;
  let campaigns = [];
  let submitted = null;
  let estimateTimer = null;
  let quoteTimer = null;
  let destroyed = false;

  const state = {
    kind: null, // 'POST' | 'STORE' | 'PRODUCT'
    postId: null,
    productId: null,
    headline: '',
    description: '',
    everyone: true,
    audience: { roles: [], gender: 'ALL', divisions: [], interests: [] },
    budget: 500,
    days: 7,
  };

  // WHY sessionStorage and a try/catch: it is a convenience for one tab; a private window that refuses
  // storage simply starts the wizard again.
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    sessionStorage.removeItem(DRAFT_KEY);
    if (draft?.state) {
      Object.assign(state, draft.state);
      stepIndex = Math.min(Math.max(Number(draft.stepIndex) || 0, 0), STEPS.length - 1);
    }
  } catch {
    // Start from step 1.
  }

  async function load() {
    try {
      [options, campaigns] = await Promise.all([adsApi.getEasyOptions(), adsApi.listCampaigns().catch(() => [])]);
      loadError = null;
      if (options?.format) {
        state.budget = Math.max(state.budget, options.format.min_budget);
        state.days = Math.min(Math.max(state.days, options.format.min_days), options.format.max_days);
      }
    } catch (err) {
      loadError = err?.message || t('common.error_generic');
    }
    render();
    refreshQuote();
  }

  function refreshEstimate() {
    clearTimeout(estimateTimer);
    if (state.everyone) {
      estimate = null;
      renderReach();
      return;
    }
    estimateTimer = setTimeout(async () => {
      try {
        estimate = await adsApi.estimateAudience(state.audience);
      } catch {
        estimate = null;
      }
      if (!destroyed) renderReach();
    }, ESTIMATE_DEBOUNCE_MS);
  }

  function refreshQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      try {
        const body = buildCampaignBody({ ...state, headline: state.headline || 'x' });
        quote = await adsApi.quote({ ad_product_key: body.ad_product_key, total_budget: body.total_budget, daily_budget: body.daily_budget, duration_days: body.duration_days });
      } catch {
        quote = null;
      }
      if (!destroyed && STEPS[stepIndex] === 'budget') renderBudgetFigures();
    }, ESTIMATE_DEBOUNCE_MS);
  }

  // ---- step 1 -----------------------------------------------------------------------------------
  function whatStep() {
    const card = el('section', 'advertise-card');
    card.append(el('h2', 'advertise-card__title', t('advertise.what.title')), el('p', 'advertise-card__hint', t('advertise.what.hint')));

    const kinds = [];
    if (options.posts?.length) kinds.push({ kind: 'POST', icon: '💬', label: t('advertise.what.post'), desc: t('advertise.what.post_desc') });
    if (options.store) kinds.push({ kind: 'STORE', icon: '🏬', label: t('advertise.what.store'), desc: options.store.shop_name });
    if (options.products?.length) kinds.push({ kind: 'PRODUCT', icon: '📦', label: t('advertise.what.product'), desc: t('advertise.what.product_desc') });

    if (!kinds.length) {
      const empty = el('p', 'advertise-note advertise-note--info', t('advertise.what.nothing'));
      const link = el('a', '', t('advertise.what.write_post'));
      link.href = '/community';
      card.append(empty, link);
      return card;
    }

    const grid = el('div', 'advertise-options');
    for (const k of kinds) {
      const b = el('button', 'advertise-option');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.kind === k.kind));
      b.append(el('span', 'advertise-option__icon', k.icon), el('span', 'advertise-option__name', k.label), el('span', 'advertise-option__desc', k.desc));
      b.addEventListener('click', () => {
        state.kind = k.kind;
        state.postId = null;
        state.productId = null;
        if (k.kind === 'STORE' && !state.headline) state.headline = options.store.shop_name;
        render();
      });
      grid.append(b);
    }
    card.append(grid);

    const pickFrom = (items, selectedId, label, onPick, meta) => {
      card.append(el('p', 'advertise-label', label));
      const list = el('div', 'advertise-list');
      list.setAttribute('role', 'list');
      for (const item of items) {
        const b = el('button', 'advertise-list__item');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(Number(selectedId) === Number(item.id)));
        b.append(el('span', '', item.label), el('span', 'advertise-list__meta', meta(item)));
        b.addEventListener('click', () => onPick(item));
        list.append(b);
      }
      card.append(list);
    };

    if (state.kind === 'POST') {
      pickFrom(
        options.posts.map((p) => ({ ...p, label: p.title || p.excerpt || p.ref })),
        state.postId,
        t('advertise.what.pick_post'),
        (p) => { state.postId = Number(p.id); if (!state.headline) state.headline = (p.title || p.excerpt || '').slice(0, 80); render(); },
        (p) => p.excerpt || ''
      );
    }
    if (state.kind === 'PRODUCT') {
      pickFrom(
        options.products.map((p) => ({ ...p, label: isBn && p.title_bn ? p.title_bn : p.title_en })),
        state.productId,
        t('advertise.what.pick_product'),
        (p) => { state.productId = Number(p.id); if (!state.headline) state.headline = (p.title_en || '').slice(0, 80); render(); },
        (p) => t(p.source === 'STORE' ? 'advertise.what.in_store' : 'advertise.what.you_supply')
      );
    }

    if (state.kind) {
      const headline = Input({ label: t('advertise.what.headline'), hint: t('advertise.what.headline_hint'), name: 'headline', value: state.headline, maxLength: 80, required: true });
      headline.input.addEventListener('input', () => { state.headline = headline.value; syncNav(); });
      const description = Input({ label: t('advertise.what.description'), hint: t('advertise.what.description_hint'), name: 'description', value: state.description, maxLength: 140 });
      description.input.addEventListener('input', () => { state.description = description.value; });
      card.append(headline, description);
    }
    return card;
  }

  // ---- step 2 -----------------------------------------------------------------------------------
  let reachBox = null;
  function chipGroup(label, values, selected, labelOf, onToggle, { single = false } = {}) {
    const wrap = el('div');
    wrap.append(el('p', 'advertise-label', label));
    const chips = el('div', 'advertise-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', label);
    for (const v of values) {
      const c = el('button', 'advertise-chip', labelOf(v));
      c.type = 'button';
      const on = single ? selected === v : selected.includes(v);
      c.setAttribute('aria-pressed', String(on));
      c.addEventListener('click', () => { onToggle(v); render(); refreshEstimate(); });
      chips.append(c);
    }
    wrap.append(chips);
    return wrap;
  }
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function whoStep() {
    const card = el('section', 'advertise-card');
    card.append(el('h2', 'advertise-card__title', t('advertise.who.title')), el('p', 'advertise-card__hint', t('advertise.who.hint')));

    const grid = el('div', 'advertise-options');
    for (const everyone of [true, false]) {
      const b = el('button', 'advertise-option');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.everyone === everyone));
      b.append(
        el('span', 'advertise-option__icon', everyone ? '🌍' : '🎯'),
        el('span', 'advertise-option__name', t(everyone ? 'advertise.who.everyone' : 'advertise.who.choose')),
        el('span', 'advertise-option__desc', t(everyone ? 'advertise.who.everyone_desc' : 'advertise.who.choose_desc'))
      );
      b.addEventListener('click', () => { state.everyone = everyone; render(); refreshEstimate(); });
      grid.append(b);
    }
    card.append(grid);

    if (!state.everyone) {
      const a = state.audience;
      const aud = options.audience;
      card.append(
        chipGroup(t('advertise.who.roles'), aud.roles, a.roles, (r) => t(`advertise.who.role_${r}`), (r) => { a.roles = toggle(a.roles, r); }),
        chipGroup(t('advertise.who.gender'), aud.genders, a.gender, (g) => t(`advertise.who.gender_${g.toLowerCase()}`), (g) => { a.gender = g; }, { single: true }),
        chipGroup(t('advertise.who.divisions'), aud.divisions, a.divisions, (d) => t(`advertise.division.${d.toLowerCase()}`), (d) => { a.divisions = toggle(a.divisions, d); }),
        chipGroup(t('advertise.who.interests'), aud.interests.map((c) => Number(c.id)), a.interests,
          (id) => name(aud.interests.find((c) => Number(c.id) === id)), (id) => { a.interests = toggle(a.interests, id); })
      );
      card.append(el('p', 'advertise-card__hint', t('advertise.who.empty_means_all')));
    }

    reachBox = el('div');
    card.append(reachBox);
    renderReach();
    return card;
  }

  function renderReach() {
    if (!reachBox) return;
    reachBox.replaceChildren();
    if (state.everyone) {
      reachBox.append(el('p', 'advertise-note advertise-note--info', t('advertise.who.everyone_note')));
    } else if (estimate) {
      const box = el('div', 'advertise-reach');
      box.append(el('span', '', t('advertise.who.reach_label')), el('span', 'advertise-reach__num', t('advertise.who.reach', { count: formatNumber(estimate.people) })));
      reachBox.append(box);
      if (estimate.too_small) {
        reachBox.append(el('p', 'advertise-note advertise-note--warn', t('advertise.who.too_small', { min: formatNumber(estimate.min_audience_size) })));
      }
    } else {
      reachBox.append(el('p', 'advertise-card__hint', t('common.loading')));
    }
    syncNav();
  }

  // ---- step 3 -----------------------------------------------------------------------------------
  let figures = null;
  function budgetStep() {
    const f = options.format;
    const card = el('section', 'advertise-card');
    card.append(el('h2', 'advertise-card__title', t('advertise.budget.title')), el('p', 'advertise-card__hint', t('advertise.budget.hint')));

    const presetRow = (values, current, fmt, onPick) => {
      const chips = el('div', 'advertise-chips');
      for (const v of values) {
        const c = el('button', 'advertise-chip', fmt(v));
        c.type = 'button';
        c.setAttribute('aria-pressed', String(Number(current) === v));
        c.addEventListener('click', () => onPick(v));
        chips.append(c);
      }
      return chips;
    };

    const budget = Input({ label: t('advertise.budget.amount'), hint: t('advertise.budget.amount_hint', { min: formatCurrency(f.min_budget) }), type: 'number', name: 'budget', value: String(state.budget), inputmode: 'numeric', required: true });
    budget.input.min = String(f.min_budget);
    budget.input.addEventListener('input', () => { state.budget = Number(budget.value); refreshQuote(); renderBudgetFigures(); });
    const days = Input({ label: t('advertise.budget.days'), hint: t('advertise.budget.days_hint', { min: formatNumber(f.min_days), max: formatNumber(f.max_days) }), type: 'number', name: 'days', value: String(state.days), inputmode: 'numeric', required: true });
    days.input.min = String(f.min_days);
    days.input.max = String(f.max_days);
    days.input.addEventListener('input', () => { state.days = Number(days.value); refreshQuote(); renderBudgetFigures(); });

    card.append(
      budget,
      presetRow(BUDGET_PRESETS.filter((v) => v >= f.min_budget), state.budget, (v) => formatCurrency(v), (v) => { state.budget = v; render(); refreshQuote(); }),
      days,
      presetRow(DAY_PRESETS.filter((v) => v >= f.min_days && v <= f.max_days), state.days, (v) => t('advertise.budget.n_days', { n: formatNumber(v) }), (v) => { state.days = v; render(); refreshQuote(); })
    );

    figures = el('div');
    card.append(figures);
    renderBudgetFigures();
    return card;
  }

  function summaryRows() {
    const what = state.kind === 'STORE'
      ? options.store?.shop_name
      : state.kind === 'POST'
        ? (options.posts.find((p) => Number(p.id) === state.postId)?.title || t('advertise.what.post'))
        : (options.products.find((p) => Number(p.id) === state.productId)?.title_en || t('advertise.what.product'));
    const a = state.audience;
    const who = state.everyone
      ? t('advertise.who.everyone')
      : [
          a.roles.map((r) => t(`advertise.who.role_${r}`)).join(', '),
          a.gender !== 'ALL' ? t(`advertise.who.gender_${a.gender.toLowerCase()}`) : '',
          a.divisions.map((d) => t(`advertise.division.${d.toLowerCase()}`)).join(', '),
          a.interests.map((id) => name(options.audience.interests.find((c) => Number(c.id) === id))).join(', '),
        ].filter(Boolean).join(' · ') || t('advertise.who.everyone');
    return [
      [t('advertise.summary.what'), what || '—'],
      [t('advertise.summary.who'), who],
      [t('advertise.summary.budget'), t('advertise.summary.budget_value', { amount: formatCurrency(Number(state.budget) || 0), n: formatNumber(Number(state.days) || 0) })],
    ];
  }

  function renderBudgetFigures() {
    if (!figures) return;
    figures.replaceChildren();
    const reach = quote?.estimate?.impressions;
    const box = el('div', 'advertise-reach');
    box.append(el('span', '', t('advertise.budget.views_label')), el('span', 'advertise-reach__num', reach != null ? t('advertise.budget.views', { count: formatNumber(reach) }) : '—'));
    figures.append(box);

    const vault = Number(options.vault?.available || 0);
    if (vault < Number(state.budget || 0)) {
      figures.append(el('p', 'advertise-note advertise-note--warn', t('advertise.budget.vault_short', { have: formatCurrency(vault), need: formatCurrency(Number(state.budget) || 0) })));
      const shortfall = Math.ceil(Number(state.budget || 0) - vault);
      const add = el('a', '', t('advertise.budget.add_money'));
      add.href = `/wallet/top-up?amount=${encodeURIComponent(shortfall)}&return=${encodeURIComponent('/advertise')}`;
      add.addEventListener('click', () => {
        try {
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ state, stepIndex }));
        } catch {
          // The wizard restarts after paying; nothing is lost but the clicks.
        }
      });
      figures.append(add);
    } else {
      figures.append(el('p', 'advertise-card__hint', t('advertise.budget.vault_ok', { have: formatCurrency(vault) })));
    }

    const dl = el('dl', 'advertise-summary');
    for (const [k, v] of summaryRows()) dl.append(el('dt', '', k), el('dd', '', v));
    figures.append(el('p', 'advertise-label', t('advertise.summary.title')), dl, el('p', 'advertise-note advertise-note--info', t('advertise.budget.review_note')));
    syncNav();
  }

  // ---- navigation, submit, my ads ---------------------------------------------------------------
  let backBtn = null;
  let nextBtn = null;
  function syncNav() {
    if (!nextBtn) return;
    nextBtn.disabled = !stepComplete(STEPS[stepIndex], state, { estimate, format: options?.format });
  }

  async function submit() {
    nextBtn.disabled = true;
    try {
      submitted = await adsApi.createCampaign(buildCampaignBody(state));
      campaigns = await adsApi.listCampaigns().catch(() => campaigns);
      render();
    } catch (err) {
      toast.error((isBn ? err?.message_bn : null) || err?.message || t('common.error_generic'));
      nextBtn.disabled = false;
    }
  }

  function myAds() {
    const card = el('section', 'advertise-card');
    card.append(el('h2', 'advertise-card__title', t('advertise.mine.title')));
    const mine = (campaigns || []).filter((c) => c.ad_product_key === 'easy_boost' || c.placement === 'FEED').slice(0, 10);
    if (!mine.length) {
      card.append(el('p', 'advertise-card__hint', t('advertise.mine.empty')));
      return card;
    }
    const list = el('div', 'advertise-mine');
    for (const c of mine) {
      const row = el('div', 'advertise-mine__row');
      const info = el('div');
      info.append(
        el('div', 'advertise-mine__title', c.title),
        el('div', 'advertise-mine__meta', t('advertise.mine.meta', {
          status: t(`advertise.status.${String(c.status).toLowerCase()}`),
          spent: formatCurrency(Number(c.spent_amount) || 0),
          budget: formatCurrency(Number(c.total_budget) || 0),
          views: formatNumber(Number(c.impressions_count) || 0),
        }))
      );
      row.append(info);
      if (c.status === 'ACTIVE' || c.status === 'PAUSED') {
        const paused = c.status === 'PAUSED';
        row.append(Button({
          label: t(paused ? 'advertise.mine.resume' : 'advertise.mine.pause'),
          variant: 'secondary',
          size: 'sm',
          onClick: async () => {
            try {
              await adsApi.setCampaignPaused(c.id, !paused);
              campaigns = await adsApi.listCampaigns();
              render();
            } catch (err) {
              toast.error(err?.message || t('common.error_generic'));
            }
          },
        }));
      }
      list.append(row);
    }
    card.append(list);
    return card;
  }

  function render() {
    root.innerHTML = '';
    page.replaceChildren();
    const head = el('header');
    head.append(el('h1', 'advertise-head__title', t('advertise.title')), el('p', 'advertise-head__sub', t('advertise.subtitle')));
    page.append(head);

    if (loadError) {
      page.append(el('p', 'advertise-note advertise-note--warn', loadError));
    } else if (!options) {
      page.append(el('p', 'advertise-card__hint', t('common.loading')));
    } else if (!options.format?.enabled) {
      page.append(el('p', 'advertise-note advertise-note--info', t('advertise.unavailable')));
    } else if (submitted) {
      const card = el('section', 'advertise-card');
      card.append(
        el('h2', 'advertise-card__title', t('advertise.done.title')),
        el('p', 'advertise-card__hint', t(submitted.status === 'PENDING_REVIEW' ? 'advertise.done.review' : 'advertise.done.live'))
      );
      card.append(Button({ label: t('advertise.done.another'), variant: 'primary', size: 'sm', onClick: () => { submitted = null; stepIndex = 0; state.kind = null; state.headline = ''; render(); } }));
      page.append(card, myAds());
    } else {
      const steps = el('ol', 'advertise-steps');
      STEPS.forEach((s, i) => {
        const li = el('li', `advertise-steps__item${i === stepIndex ? ' is-current' : ''}${i < stepIndex ? ' is-done' : ''}`);
        if (i === stepIndex) li.setAttribute('aria-current', 'step');
        li.append(el('span', 'advertise-steps__num', formatNumber(i + 1)), el('span', 'advertise-steps__label', t(`advertise.step.${s}`)));
        steps.append(li);
      });
      page.append(steps);

      const step = STEPS[stepIndex];
      page.append(step === 'what' ? whatStep() : step === 'who' ? whoStep() : budgetStep());

      const actions = el('div', 'advertise-actions');
      backBtn = Button({ label: t('advertise.back'), variant: 'secondary', size: 'sm', disabled: stepIndex === 0, onClick: () => { stepIndex -= 1; render(); } });
      const last = stepIndex === STEPS.length - 1;
      nextBtn = Button({
        label: t(last ? 'advertise.submit' : 'advertise.next'),
        variant: 'primary',
        size: 'sm',
        onClick: () => {
          if (last) return submit();
          stepIndex += 1;
          render();
          if (STEPS[stepIndex] === 'who') refreshEstimate();
          if (STEPS[stepIndex] === 'budget') refreshQuote();
        },
      });
      actions.append(backBtn, nextBtn);
      page.append(actions, myAds());
      syncNav();
    }
    root.append(page);
  }

  render();
  load();
  return () => {
    destroyed = true;
    clearTimeout(estimateTimer);
    clearTimeout(quoteTimer);
  };
}
