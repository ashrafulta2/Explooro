/**
 * SupplierSamplesPage.js — A supplier sets which products they will send as a paid sample, and answers
 * the salers who ask for one.
 *
 * Route: /supplier/samples  (module: sourcing, read: supplier.analytics.view, write: supplier.sample.manage)
 *
 * WHY the page spells out the money: a supplier who offers a sample at ৳200 should know before they
 * switch it on that the platform keeps its share of the price, that the shipping goes whole to them,
 * and that nothing reaches their vault until the saler confirms (or the confirm window runs out).
 */
import { sampleKitApi } from '../../services/sampleKit.api.js';
import { SampleRequestTable } from '../../components/sampleKit/SampleRequestTable.js';
import { Button } from '../../components/ui/Button.js';
import { Switch } from '../../components/ui/Switch.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { toast } from '../../services/toast.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

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

function numberInput(value, { min, max, step = '0.01', label }) {
  const wrap = el('label', 'incentive-field');
  wrap.append(el('span', 'incentive-field__label', label));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = step;
  input.inputMode = 'decimal';
  input.className = 'incentive-input';
  input.value = value ?? '';
  wrap.append(input);
  return { wrap, input };
}

export default function SupplierSamplesPage(root) {
  const container = el('div', 'supplier-page-container');

  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('sample.supplier_title', 'Sample Requests')), el('p', 'supplier-header__sub', t('sample.supplier_subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let view = null;

  async function load() {
    const res = await sampleKitApi.getSupplierSamples();
    view = res?.data ?? res;
    render();
  }

  async function respond(row, action, extra) {
    try {
      await sampleKitApi.respond(row.id, action, extra);
      await load();
      toast.success(t(`sample.done_${action}`));
    } catch (err) {
      toast.error(pickMessage(err) || t('sample.action_failed'));
      // The request may have moved under us (the saler cancelled, the job expired it): show the truth.
      try { await load(); } catch { /* keep what is on screen */ }
    }
  }

  async function ask(row, action) {
    const { confirmed, reason } = await confirmDialogWithReason({
      title: t(`sample.ask_${action}_title`),
      description: t(`sample.ask_${action}_body`),
      confirmLabel: t(`sample.${action}`),
      variant: action === 'decline' ? 'danger' : 'primary',
      reasonLabel: t(action === 'ship' ? 'sample.tracking_label' : 'sample.decline_label'),
      reasonRequired: false,
    });
    if (!confirmed) return;
    await respond(row, action, action === 'ship' ? { tracking_note: reason } : { reason });
  }

  function actionsFor(row) {
    const out = [];
    if (row.status === 'REQUESTED') out.push({ label: t('sample.accept'), variant: 'primary', onClick: () => respond(row, 'accept') });
    if (['REQUESTED', 'ACCEPTED'].includes(row.status)) {
      out.push({ label: t('sample.ship'), variant: 'secondary', onClick: () => ask(row, 'ship') });
      out.push({ label: t('sample.decline'), variant: 'ghost', onClick: () => ask(row, 'decline') });
    }
    return out;
  }

  function howCard() {
    const card = section(t('sample.how_title'));
    card.append(
      el('p', 'incentive-card__text', t('sample.how_body_supplier', {
        fee: view.rules.platform_fee_pct, days: view.rules.response_days, confirm: view.rules.auto_confirm_days,
      }))
    );
    if (view.blocked) card.append(el('p', 'incentive-card__note', t('sample.blocked_note', { grade: view.grade })));
    return card;
  }

  function offerRow(p) {
    const row = el('div', 'sample-offer');
    row.append(el('div', 'sample-offer__title', p.title_en));

    const price = numberInput(p.sample_price, { min: view.rules.min_price, max: view.rules.max_price, label: t('sample.price') });
    const ship = numberInput(p.sample_shipping_fee ?? 0, { min: 0, max: view.rules.max_shipping_fee, label: t('sample.shipping') });
    let active = Boolean(p.sample_active);
    const toggle = Switch({ label: t('sample.offer_on'), checked: active, onChange: (on) => { active = on; } });

    const save = Button({ label: t('sample.save'), size: 'sm', type: 'button' });
    let saving = false;
    save.addEventListener('click', async () => {
      if (saving) return;
      saving = true;
      save.setLoading(true);
      try {
        await sampleKitApi.saveOffer(p.product_id, { price: Number(price.input.value), shipping_fee: Number(ship.input.value || 0), is_active: active });
        await load();
        toast.success(t('sample.saved'));
      } catch (err) {
        toast.error(pickMessage(err) || t('sample.save_failed'));
      } finally {
        saving = false;
        save.setLoading(false);
      }
    });

    const grid = el('div', 'sample-offer__fields');
    grid.append(price.wrap, ship.wrap, toggle, save);
    row.append(grid);

    // What the saler pays and what the supplier ends up with, using the platform's own fee setting.
    const priceNum = Number(price.input.value);
    if (priceNum > 0) {
      const fee = Math.round(priceNum * view.rules.platform_fee_pct) / 100;
      row.append(el('p', 'incentive-card__note', t('sample.you_receive', {
        total: formatCurrency(priceNum + Number(ship.input.value || 0)),
        net: formatCurrency(priceNum - fee + Number(ship.input.value || 0)),
      })));
    }
    return row;
  }

  function render() {
    const offers = section(t('sample.offers_title'));
    if (view.products.length) {
      const list = el('div', 'sample-offers');
      view.products.forEach((p) => list.append(offerRow(p)));
      offers.append(list);
    } else {
      offers.append(el('p', 'incentive-card__text', t('sample.no_products')));
    }

    const requests = section(t('sample.requests_title'));
    requests.append(
      view.requests.length
        ? SampleRequestTable(view.requests, { perspective: 'supplier', actionsFor })
        : el('p', 'incentive-card__text', t('sample.requests_empty_supplier'))
    );

    body.replaceChildren(howCard(), requests, offers);
  }

  (async () => {
    try {
      await load();
    } catch (err) {
      console.error('Failed to load sample requests:', err);
      toast.error(t('sample.load_failed'));
      body.replaceChildren(EmptyState({ title: t('sample.load_failed') }));
    }
  })();

  return () => container.remove();
}
