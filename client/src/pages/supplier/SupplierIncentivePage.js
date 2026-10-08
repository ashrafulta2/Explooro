/**
 * SupplierIncentivePage.js — A supplier sets the monthly rebate they pay their top-selling salers.
 *
 * Route: /supplier/incentive  (module: sourcing, read: supplier.analytics.view, write: supplier.incentive.manage)
 *
 * WHY the page shows what is "running now" apart from what is "queued": a change applies from the
 * next month so no saler is moved onto worse tiers mid-month, and a supplier who edits tiers and then
 * sees the old ones still live needs to be told that is intended, not that the save failed.
 */
import { supplierApi } from '../../services/supplier.api.js';
import { IncentivePayoutTable } from '../../components/incentive/IncentivePayoutTable.js';
import { Button } from '../../components/ui/Button.js';
import { Switch } from '../../components/ui/Switch.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatDate } from '../../services/format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(titleText) {
  const s = el('section', 'incentive-card');
  s.append(el('h2', 'incentive-card__title', titleText));
  return s;
}

function tierSummary(tiers) {
  return (tiers || []).map((x) => `${formatCurrency(x.min_volume)} → ${Number(x.rebate_pct)}%`).join('  ·  ');
}

export default function SupplierIncentivePage(root) {
  const container = el('div', 'supplier-page-container');

  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('incentive.title', 'Volume Incentive')), el('p', 'supplier-header__sub', t('incentive.subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let view = null;
  let draft = { active: true, tiers: [] };
  let saving = false;

  function startDraft() {
    // Edit what will be live next: a queued change if there is one, otherwise what is running now.
    const source = view.upcoming || view.current;
    draft = {
      active: source ? source.is_active : true,
      tiers: source?.tiers_json?.length
        ? source.tiers_json.map((x) => ({ min_volume: x.min_volume, rebate_pct: x.rebate_pct }))
        : [{ min_volume: view.rules.min_threshold, rebate_pct: 1 }],
    };
  }

  function statusCard() {
    const card = section(t('incentive.current_title'));
    const cur = view.current;
    if (!cur) card.append(el('p', 'incentive-card__text', t('incentive.current_none')));
    else if (!cur.is_active) card.append(el('p', 'incentive-card__text', t('incentive.current_paused')));
    else card.append(el('p', 'incentive-card__tiers', tierSummary(cur.tiers_json)));

    if (view.upcoming) {
      const date = formatDate(view.upcoming.valid_from);
      const note = el('p', 'incentive-card__note');
      note.append(
        el('strong', '', view.upcoming.is_active ? t('incentive.upcoming_title', { date }) : t('incentive.upcoming_paused', { date })),
        document.createTextNode(view.upcoming.is_active ? `  ${tierSummary(view.upcoming.tiers_json)}` : '')
      );
      card.append(note);
    }
    return card;
  }

  function projectedCard() {
    const card = section(t('incentive.projected_title'));
    const p = view.projected;
    card.append(
      el(
        'p',
        'incentive-card__text',
        p.qualifying_salers > 0
          ? t('incentive.projected_body', {
              count: p.qualifying_salers,
              amount: formatCurrency(p.projected_rebate),
              volume: formatCurrency(p.gross_volume),
            })
          : t('incentive.projected_none')
      )
    );
    return card;
  }

  function howCard() {
    const card = section(t('incentive.how_title'));
    card.append(el('p', 'incentive-card__text', t('incentive.how_body', { lag: view.rules.settle_lag_days, fee: view.rules.platform_fee_pct })));
    return card;
  }

  function editorCard() {
    const card = section(t('incentive.tiers_title'));
    const form = el('form', 'incentive-form');
    form.noValidate = true;

    form.append(
      Switch({
        label: t('incentive.active_label'),
        checked: draft.active,
        onChange: (on) => { draft.active = on; },
      })
    );

    const list = el('div', 'incentive-tiers');
    draft.tiers.forEach((tier, index) => {
      const row = el('div', 'incentive-tier');

      const volumeLabel = el('label', 'incentive-field');
      volumeLabel.append(el('span', 'incentive-field__label', t('incentive.tier_volume')));
      const volume = document.createElement('input');
      volume.type = 'number';
      volume.min = String(view.rules.min_threshold);
      volume.step = '0.01';
      volume.inputMode = 'decimal';
      volume.className = 'incentive-input';
      volume.value = String(tier.min_volume);
      volume.addEventListener('input', () => { tier.min_volume = volume.value; });
      volumeLabel.append(volume);

      const rebateLabel = el('label', 'incentive-field');
      rebateLabel.append(el('span', 'incentive-field__label', t('incentive.tier_rebate')));
      const rebate = document.createElement('input');
      rebate.type = 'number';
      rebate.min = '0.01';
      rebate.max = String(view.rules.max_rebate_pct);
      rebate.step = '0.01';
      rebate.inputMode = 'decimal';
      rebate.className = 'incentive-input';
      rebate.value = String(tier.rebate_pct);
      rebate.addEventListener('input', () => { tier.rebate_pct = rebate.value; });
      rebateLabel.append(rebate);

      const remove = Button({
        label: t('incentive.remove_tier'),
        variant: 'ghost',
        size: 'sm',
        disabled: draft.tiers.length === 1,
        onClick: () => { draft.tiers.splice(index, 1); redrawEditor(); },
      });

      row.append(volumeLabel, rebateLabel, remove);
      list.append(row);
    });
    form.append(list);

    form.append(el('p', 'incentive-card__note', t('incentive.tier_hint', { max: view.rules.max_rebate_pct, min: formatCurrency(view.rules.min_threshold) })));

    const actions = el('div', 'incentive-actions');
    if (draft.tiers.length < view.rules.max_tiers) {
      actions.append(
        Button({
          label: t('incentive.add_tier'),
          variant: 'secondary',
          onClick: () => {
            const last = draft.tiers[draft.tiers.length - 1];
            draft.tiers.push({ min_volume: last ? Number(last.min_volume) * 2 : view.rules.min_threshold, rebate_pct: last ? Number(last.rebate_pct) + 0.5 : 1 });
            redrawEditor();
          },
        })
      );
    }
    // WHY never created busy: a save re-renders this form (via load()) while `saving` is still true, so
    // inheriting it would give the NEW button a spinner that nothing ever clears. The `saving` guard in
    // the submit handler is what stops a double submit.
    const save = Button({ label: t('incentive.save'), type: 'submit' });
    actions.append(save);
    form.append(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      save.setLoading(true);
      try {
        const res = await supplierApi.saveIncentive({
          is_active: draft.active,
          tiers: draft.tiers.map((x) => ({ min_volume: Number(x.min_volume), rebate_pct: Number(x.rebate_pct) })),
        });
        const saved = res?.data ?? res;
        await load();
        const queued = view.upcoming && view.upcoming.valid_from === saved.valid_from;
        toast.success(queued ? t('incentive.saved_next', { date: formatDate(saved.valid_from) }) : t('incentive.saved_now'));
      } catch (err) {
        toast.error(pickMessage(err) || t('incentive.save_failed'));
      } finally {
        saving = false;
        save.setLoading(false);
      }
    });

    card.append(form);
    return card;
  }

  let editorSlot = null;
  function redrawEditor() {
    const fresh = editorCard();
    editorSlot.replaceWith(fresh);
    editorSlot = fresh;
  }

  function render() {
    editorSlot = editorCard();
    const payouts = section(t('incentive.payouts_title'));
    payouts.append(
      view.payouts.length
        ? IncentivePayoutTable(view.payouts, { perspective: 'supplier' })
        : el('p', 'incentive-card__text', t('incentive.payouts_empty'))
    );
    body.replaceChildren(howCard(), statusCard(), projectedCard(), editorSlot, payouts);
  }

  async function load() {
    const res = await supplierApi.getIncentive();
    view = res?.data ?? res;
    startDraft();
    render();
  }

  (async () => {
    try {
      await load();
    } catch (err) {
      console.error('Failed to load volume incentive:', err);
      toast.error(t('incentive.load_failed'));
      body.replaceChildren(EmptyState({ title: t('incentive.load_failed') }));
    }
  })();

  return () => container.remove();
}
