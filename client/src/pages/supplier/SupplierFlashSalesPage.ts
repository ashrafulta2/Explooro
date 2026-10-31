/**
 * SupplierFlashSalesPage.ts — a supplier runs a flash sale on their own product (migration 096).
 *
 * Route: /supplier/flash-sales (module: flash_sale, permission: growth.flash_sale.manage_own)
 *
 * WHY the payout is shown before the button: the supplier pays the whole discount. The platform's and
 * the shop partner pool's share stay what they are at the regular price, so every taka off the price
 * comes off what the supplier is paid. The figures come from GET /supplier/flash-sales/quote, the same
 * pricing function checkout runs, so the page never works out a payout itself.
 *
 * WHY some products cannot be discounted yet: a product must sell at its current price for the
 * admin's `min_listing_days` first, so the struck price shoppers see is one they were really charged.
 */
import { supplierFlashSaleApi, type FlashQuote, type SupplierFlashRules } from '../../services/supplierFlashSale.api.ts';
import { Button } from '../../components/ui/Button.ts';
import { Skeleton } from '../../components/ui/Skeleton.ts';
import { EmptyState } from '../../components/ui/EmptyState.ts';
import { toast } from '../../services/toast.ts';
import { confirmDialog } from '../../components/ui/ConfirmDialog.ts';
import { pickMessage } from '../../core/api.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatCurrency, formatNumber } from '../../services/format.ts';

const PAGE_SIZE = 20;
const QUOTE_DELAY_MS = 300;
const DEFAULT_HOURS = 24;

function el(tag: string, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function titleOf(row: Record<string, any>, prefix = '') {
  const en = row[`${prefix}title_en`];
  const bn = row[`${prefix}title_bn`];
  return (getLanguage() === 'bn' ? bn || en : en || bn) || '';
}

function formatDate(value: string | number | Date) {
  return new Intl.DateTimeFormat(getLanguage() === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** `datetime-local` wants local time without a zone. */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function field(label: string, input: HTMLElement) {
  const wrap = el('label', 'incentive-field');
  wrap.append(el('span', 'incentive-field__label', label), input);
  return wrap;
}

function input(type: string, value: string, attrs: Record<string, string> = {}) {
  const node = document.createElement('input');
  node.type = type;
  node.className = 'incentive-input';
  node.value = value;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function line(label: string, value: string, strong = false) {
  const li = el('li');
  li.append(document.createTextNode(`${label}: `), el('span', strong ? 'incentive-lines__strong' : '', value));
  return li;
}

const STATUS_TONE: Record<string, string> = { ACTIVE: 'success', SCHEDULED: 'info', COMPLETED: 'info', CANCELLED: 'danger', PAUSED: 'warning' };

export default function SupplierFlashSalesPage(root: HTMLElement) {
  const container = el('div', 'supplier-page-container');
  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('supplier_flash.title')), el('p', 'supplier-header__sub', t('supplier_flash.subtitle')));
  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '260px' }));
  container.append(header, body);
  root.append(container);

  let view: { rules: SupplierFlashRules; products: any[]; deals: any[]; meta: { limit: number; offset: number; total: number } } | null = null;
  let offset = 0;
  let selected: Record<string, any> | null = null;
  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  let quoteSeq = 0;

  async function load() {
    view = await supplierFlashSaleApi.overview({ limit: PAGE_SIZE, offset });
    render();
  }

  function rulesCard() {
    const r = view!.rules;
    const card = el('section', 'incentive-card');
    card.append(
      el('h2', 'incentive-card__title', t('supplier_flash.how_title')),
      el('p', 'incentive-card__text', t('supplier_flash.how_body'))
    );
    const list = el('ul', 'incentive-lines');
    list.append(
      line(t('supplier_flash.rule.max_discount'), `${formatNumber(r.max_discount_pct)}%`),
      line(t('supplier_flash.rule.max_duration'), t('supplier_flash.hours', { n: formatNumber(r.max_duration_hours) })),
      line(t('supplier_flash.rule.max_live'), formatNumber(r.max_live_deals)),
      line(t('supplier_flash.rule.min_listing'), t('supplier_flash.days', { n: formatNumber(r.min_listing_days) }))
    );
    card.append(list);
    if (!r.enabled) card.append(el('p', 'incentive-card__note', t('supplier_flash.closed')));
    return card;
  }

  function productsCard() {
    const card = el('section', 'incentive-card');
    card.append(el('h2', 'incentive-card__title', t('supplier_flash.products_title')));
    if (!view!.products.length) {
      card.append(el('p', 'incentive-card__text', t('supplier_flash.products_empty')));
      return card;
    }
    const list = el('ul', 'supplier-flash-list');
    for (const p of view!.products) {
      const row = el('li', 'supplier-flash-row');
      const main = el('div', 'supplier-flash-row__main');
      main.append(
        el('span', 'supplier-flash-row__title', titleOf(p)),
        el('span', 'supplier-flash-row__meta', `${t('supplier_flash.col.price')}: ${formatCurrency(p.default_retail_price)}`)
      );
      const side = el('div', 'supplier-flash-row__side');
      if (p.live_flash_sale_id != null) {
        side.append(el('span', 'incentive-status incentive-status--success', t('supplier_flash.on_sale')));
      } else if (!p.eligible) {
        side.append(el('span', 'incentive-status incentive-status--info', t('supplier_flash.available_from', { date: formatDate(p.eligible_from) })));
      } else {
        side.append(Button({
          label: t('supplier_flash.start'),
          size: 'sm',
          disabled: !view!.rules.enabled,
          onClick: () => { selected = p; render(); },
        }));
      }
      row.append(main, side);
      list.append(row);
    }
    card.append(list);

    const { total, limit } = view!.meta;
    if (total > limit) {
      const pager = el('div', 'incentive-actions');
      pager.append(
        Button({ label: t('supplier_flash.prev'), variant: 'secondary', size: 'sm', disabled: offset === 0, onClick: () => { offset = Math.max(0, offset - limit); load(); } }),
        Button({ label: t('supplier_flash.next'), variant: 'secondary', size: 'sm', disabled: offset + limit >= total, onClick: () => { offset += limit; load(); } })
      );
      card.append(pager);
    }
    return card;
  }

  function formCard(product: Record<string, any>) {
    const card = el('section', 'incentive-card');
    card.append(el('h2', 'incentive-card__title', t('supplier_flash.form_title', { name: titleOf(product) })));
    const form = el('form', 'incentive-form') as HTMLFormElement;
    const regular = Number(product.default_retail_price);
    const start = new Date();
    const end = new Date(start.getTime() + Math.min(DEFAULT_HOURS, view!.rules.max_duration_hours) * 3600_000);

    const price = input('number', '', { min: '0.01', step: '0.01', max: String(regular), required: '', inputmode: 'decimal' });
    const qty = input('number', String(Math.min(10, Number(product.stock_qty) || 1)), { min: '1', step: '1', max: String(product.stock_qty ?? ''), required: '' });
    const perUser = input('number', '1', { min: '1', step: '1', required: '' });
    const startsAt = input('datetime-local', toLocalInput(start), { required: '' });
    const endsAt = input('datetime-local', toLocalInput(end), { required: '' });

    const grid = el('div', 'supplier-flash-grid');
    grid.append(
      field(t('supplier_flash.field.price', { regular: formatCurrency(regular) }), price),
      field(t('supplier_flash.field.qty', { stock: formatNumber(product.stock_qty ?? 0) }), qty),
      field(t('supplier_flash.field.per_user'), perUser)
    );
    const times = el('div', 'supplier-flash-grid');
    times.append(field(t('supplier_flash.field.starts'), startsAt), field(t('supplier_flash.field.ends'), endsAt));

    const preview = el('div');
    preview.setAttribute('aria-live', 'polite');
    preview.append(el('p', 'incentive-card__note', t('supplier_flash.enter_price')));

    const submit = Button({ label: t('supplier_flash.submit'), type: 'submit', disabled: true });
    const actions = el('div', 'incentive-actions');
    actions.append(Button({ label: t('supplier_flash.cancel'), variant: 'secondary', onClick: () => { selected = null; render(); } }), submit);

    function showQuote(q: FlashQuote) {
      const p = q.pricing;
      const list = el('ul', 'incentive-lines');
      list.append(
        line(t('supplier_flash.q.shopper_pays'), `${formatCurrency(p.deal_price)} (−${formatNumber(p.discount_pct)}%)`, true),
        line(t('supplier_flash.q.you_receive'), t('supplier_flash.q.instead_of', { now: formatCurrency(p.supplier_payout), before: formatCurrency(p.regular_supplier_payout) }), true),
        line(t('supplier_flash.q.you_fund'), formatCurrency(p.supplier_funded)),
        line(t('supplier_flash.q.others_keep'), formatCurrency(p.partner_share + p.platform_share))
      );
      preview.replaceChildren(list);
      if (q.problem) preview.append(el('p', 'incentive-status incentive-status--warning', pickMessage(q.problem) || q.problem.code));
      submit.disabled = Boolean(q.problem);
    }

    function requestQuote() {
      if (quoteTimer) clearTimeout(quoteTimer);
      submit.disabled = true;
      const value = Number(price.value);
      if (!(value > 0)) {
        preview.replaceChildren(el('p', 'incentive-card__note', t('supplier_flash.enter_price')));
        return;
      }
      quoteTimer = setTimeout(async () => {
        const seq = ++quoteSeq;
        try {
          const q = await supplierFlashSaleApi.quote(product.id, value.toFixed(2));
          if (seq === quoteSeq) showQuote(q);
        } catch (err) {
          // A price the pricing engine refuses (no discount, or nothing left for the supplier).
          if (seq === quoteSeq) preview.replaceChildren(el('p', 'incentive-status incentive-status--warning', pickMessage(err) || t('supplier_flash.quote_failed')));
        }
      }, QUOTE_DELAY_MS);
    }
    price.addEventListener('input', requestQuote);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      try {
        await supplierFlashSaleApi.create({
          product_id: product.id,
          discount_price: Number(price.value).toFixed(2),
          allocated_qty: Number(qty.value),
          per_user_limit: Number(perUser.value),
          starts_at: new Date(startsAt.value).toISOString(),
          ends_at: new Date(endsAt.value).toISOString(),
        });
        toast.success(t('supplier_flash.created'));
        selected = null;
        await load();
      } catch (err) {
        toast.error(pickMessage(err) || t('supplier_flash.create_failed'));
        submit.disabled = false;
      }
    });

    form.append(grid, times, preview, actions);
    card.append(form);
    queueMicrotask(() => price.focus());
    return card;
  }

  function dealsCard() {
    const card = el('section', 'incentive-card');
    card.append(el('h2', 'incentive-card__title', t('supplier_flash.deals_title')));
    if (!view!.deals.length) {
      card.append(el('p', 'incentive-card__text', t('supplier_flash.deals_empty')));
      return card;
    }
    const list = el('ul', 'supplier-flash-list');
    for (const d of view!.deals) {
      const row = el('li', 'supplier-flash-row');
      const main = el('div', 'supplier-flash-row__main');
      const price = el('span', 'supplier-flash-row__meta');
      price.append(el('s', '', formatCurrency(d.original_price)), document.createTextNode(` ${formatCurrency(d.discount_price)}`));
      main.append(
        el('span', 'supplier-flash-row__title', titleOf(d, 'product_')),
        price,
        el('span', 'supplier-flash-row__meta', `${t('supplier_flash.col.sold')}: ${formatNumber(d.sold_qty)} / ${formatNumber(d.allocated_qty)} · ${t('supplier_flash.col.ends')}: ${formatDate(d.ends_at)}`)
      );
      const side = el('div', 'supplier-flash-row__side');
      side.append(el('span', `incentive-status incentive-status--${STATUS_TONE[d.status] || 'info'}`, t(`supplier_flash.status.${d.status}`)));
      if (d.status === 'ACTIVE' || d.status === 'SCHEDULED') {
        side.append(Button({
          label: t('supplier_flash.stop'),
          variant: 'secondary',
          size: 'sm',
          onClick: async () => {
            const ok = await confirmDialog({ title: t('supplier_flash.stop'), description: t('supplier_flash.stop_confirm'), confirmLabel: t('supplier_flash.stop'), variant: 'danger' });
            if (!ok) return;
            try {
              await supplierFlashSaleApi.stop(d.id);
              toast.success(t('supplier_flash.stopped'));
              await load();
            } catch (err) {
              toast.error(pickMessage(err) || t('supplier_flash.stop_failed'));
            }
          },
        }));
      }
      row.append(main, side);
      list.append(row);
    }
    card.append(list);
    return card;
  }

  function render() {
    if (!view) return;
    const cards = [rulesCard()];
    if (selected) cards.push(formCard(selected));
    cards.push(productsCard(), dealsCard());
    body.replaceChildren(...cards);
  }

  (async () => {
    try {
      await load();
    } catch (err) {
      console.error('Failed to load supplier flash sales:', err);
      body.replaceChildren(EmptyState({ title: pickMessage(err) || t('supplier_flash.load_failed') }));
    }
  })();

  return () => {
    if (quoteTimer) clearTimeout(quoteTimer);
    container.remove();
  };
}
