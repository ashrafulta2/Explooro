/**
 * SalerSamplesPage.js — A saler orders a paid sample of a supplier's product, and follows it to the door.
 *
 * Route: /saler/samples  (module: sourcing, read: saler.sourcing.view, act: saler.sample.request)
 *
 * WHY the dialog says the money is HELD, not spent: that is the whole promise of the feature. The cost
 * sits in the saler's own vault until they confirm it arrived (or the confirm window runs out), and
 * comes straight back if the supplier declines or never ships. A saler who does not believe that will
 * not order, so the dialog states it next to the amount, every time.
 */
import { sampleKitApi } from '../../services/sampleKit.api.js';
import { SampleRequestTable } from '../../components/sampleKit/SampleRequestTable.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
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

function textField(labelText, { rows = 0, maxLength, value = '', type = 'text', autocomplete = '' } = {}) {
  const wrap = el('label', 'incentive-field');
  wrap.append(el('span', 'incentive-field__label', labelText));
  const input = document.createElement(rows ? 'textarea' : 'input');
  if (rows) input.rows = rows;
  else input.type = type;
  input.className = rows ? 'incentive-input kit-textarea' : 'incentive-input';
  if (maxLength) input.maxLength = maxLength;
  if (autocomplete) input.autocomplete = autocomplete;
  input.value = value;
  wrap.append(input);
  return { wrap, input };
}

export default function SalerSamplesPage(root) {
  const container = el('div', 'supplier-page-container');

  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('sample.saler_title', 'Product Samples')), el('p', 'supplier-header__sub', t('sample.saler_subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let view = null;

  async function load() {
    const res = await sampleKitApi.getSalerSamples();
    view = res?.data ?? res;
    render();
  }

  async function act(row, action) {
    try {
      await sampleKitApi.act(row.id, action);
      await load();
      toast.success(t(`sample.done_${action}`));
    } catch (err) {
      toast.error(pickMessage(err) || t('sample.action_failed'));
      try { await load(); } catch { /* keep what is on screen */ }
    }
  }

  function actionsFor(row) {
    const out = [];
    if (row.status === 'REQUESTED') out.push({ label: t('sample.cancel'), variant: 'ghost', onClick: () => act(row, 'cancel') });
    if (row.status === 'SHIPPED') out.push({ label: t('sample.confirm'), variant: 'primary', onClick: () => act(row, 'confirm') });
    return out;
  }

  function openRequestDialog(offer, trigger) {
    const form = el('form', 'incentive-form');
    form.noValidate = true;
    const name = textField(t('sample.ship_name'), { maxLength: 100, autocomplete: 'name' });
    const phone = textField(t('sample.ship_phone'), { maxLength: 20, type: 'tel', autocomplete: 'tel' });
    const address = textField(t('sample.ship_address'), { rows: 3, maxLength: 300, autocomplete: 'street-address' });
    const note = textField(t('sample.ship_note'), { rows: 2, maxLength: 300 });
    form.append(
      el('p', 'incentive-card__text', t('sample.held_promise', { total: formatCurrency(offer.total), days: view.rules.response_days })),
      name.wrap, phone.wrap, address.wrap, note.wrap
    );

    const cancelBtn = Button({ label: t('sample.dialog_cancel'), variant: 'secondary', onClick: () => modal.closeModal(false) });
    // WHY created without `loading`: see the other pages - a re-render must never inherit a busy flag.
    const submitBtn = Button({ label: t('sample.dialog_submit', { total: formatCurrency(offer.total) }) });
    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, submitBtn);

    const modal = Modal({
      title: t('sample.dialog_title', { product: offer.title_en }),
      content: form,
      footer,
      size: 'sm',
      onClose: () => setTimeout(() => modal.remove(), 400),
    });

    let sending = false;
    submitBtn.addEventListener('click', async () => {
      if (sending) return;
      sending = true;
      submitBtn.setLoading(true);
      try {
        await sampleKitApi.requestSample({
          product_id: offer.product_id,
          ship_to: { name: name.input.value, phone: phone.input.value, address: address.input.value },
          note: note.input.value,
        });
        modal.closeModal(true);
        await load();
        toast.success(t('sample.requested'));
      } catch (err) {
        toast.error(pickMessage(err) || t('sample.request_failed'));
      } finally {
        sending = false;
        submitBtn.setLoading(false);
      }
    });

    document.body.append(modal);
    modal.openModal(trigger);
  }

  function offerCard(offer) {
    const card = el('article', 'incentive-card sample-card');
    if (offer.image_url) {
      const img = document.createElement('img');
      img.src = offer.image_url;
      img.alt = '';
      img.loading = 'lazy';
      img.className = 'sample-card__image';
      card.append(img);
    }
    const main = el('div', 'sample-card__main');
    main.append(
      el('h3', 'incentive-card__title', offer.title_en),
      el('p', 'incentive-card__note', t('sample.from', { supplier: offer.supplier_name || '' })),
      el('p', 'incentive-card__tiers', t('sample.price_line', { price: formatCurrency(offer.price), shipping: formatCurrency(offer.shipping_fee), total: formatCurrency(offer.total) }))
    );

    if (offer.request_status) {
      main.append(el('span', 'incentive-status incentive-status--info', t(`sample.status.${offer.request_status}`)));
    } else {
      const btn = Button({
        label: t('sample.request'),
        size: 'sm',
        disabled: view.slots_left === 0,
        onClick: () => openRequestDialog(offer, btn),
      });
      main.append(btn);
      if (view.slots_left === 0) main.append(el('p', 'incentive-card__note', t('sample.limit_note', { max: view.rules.max_open_per_saler })));
    }
    card.append(main);
    return card;
  }

  function render() {
    const offers = el('section', 'incentive-card');
    offers.append(el('h2', 'incentive-card__title', t('sample.offers_saler_title')));
    offers.append(el('p', 'incentive-card__note', t('sample.how_body_saler', { days: view.rules.response_days, confirm: view.rules.auto_confirm_days, max: view.rules.max_open_per_saler })));
    if (view.offers.length) {
      const grid = el('div', 'sample-grid');
      view.offers.forEach((o) => grid.append(offerCard(o)));
      offers.append(grid);
    } else {
      offers.append(el('p', 'incentive-card__text', t('sample.offers_empty')));
    }

    const mine = el('section', 'incentive-card');
    mine.append(el('h2', 'incentive-card__title', t('sample.mine_title')));
    mine.append(
      view.requests.length
        ? SampleRequestTable(view.requests, { perspective: 'saler', actionsFor })
        : el('p', 'incentive-card__text', t('sample.requests_empty_saler'))
    );

    body.replaceChildren(mine, offers);
  }

  (async () => {
    try {
      await load();
    } catch (err) {
      console.error('Failed to load samples:', err);
      toast.error(t('sample.load_failed'));
      body.replaceChildren(EmptyState({ title: t('sample.load_failed') }));
    }
  })();

  return () => container.remove();
}
