/**
 * PostComposer — the window a member writes a post in. One window per role, numbered sections, so
 * the form is clear at a glance and says what each part is for:
 *   customer      Product → Rating → Experience                       (a verified-purchase review)
 *   supplier      Type → Product → Stock and pricing → Highlights     (an update for shop partners)
 *   shop partner  Type → Product → Idea → Tags                        (a usability tip or idea)
 *   admin         Type → Message → Audience                           (an announcement)
 *
 * Invariants:
 *  - The choices of product come from the API (delivered purchases, own products, own store items),
 *    never from the client, and the server re-checks them. This window cannot widen what a role may post.
 *  - Publish is disabled while the request is in flight, so a double click cannot post twice.
 *  - Photos and a video are attached through MediaPicker. Publish is disabled while a file is still
 *    uploading, so a post is never sent without a file the author thought was on it.
 */
import { el, icon, productTitle } from './dom.js';
import { Button } from '../ui/Button.js';
import { MediaPicker } from './MediaPicker.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatNumber } from '../../services/format.js';
import {
  ROLE_KINDS, AUDIENCES, getComposerProducts, createPost, createAnnouncement, errorText,
} from '../../services/community.api.js';

const MAX_STEPS = 8;
const MAX_TIERS = 5;

function section(n, title, hint, ...children) {
  return el('section', 'cm-sec', [
    el('div', 'cm-sec__head', [el('span', 'cm-sec__n', formatNumber(n)), el('h4', 'cm-sec__title', title), hint ? el('span', 'cm-sec__hint', hint) : null]),
    ...children,
  ]);
}

function field(label, control, hint) {
  const id = `cm-f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return el('div', 'cm-field', [el('label', 'cm-field__label', label, { for: id }), control, hint ? el('span', 'cm-field__hint', hint) : null]);
}

const textInput = (placeholder, { max = 0, type = 'text', value = '' } = {}) => {
  const i = el('input', 'input', null, { type, placeholder, ...(max ? { maxlength: max } : {}) });
  i.value = value;
  return i;
};
const textArea = (placeholder, max, rows = 3) => el('textarea', 'textarea', null, { placeholder, rows, maxlength: max });

function chips(options, selected, onPick) {
  const wrap = el('div', 'cm-chips', null, { role: 'radiogroup' });
  const buttons = options.map(({ value, label }) => {
    const b = el('button', value === selected ? 'cm-chip cm-chip--on' : 'cm-chip', label, { type: 'button', role: 'radio', 'aria-checked': value === selected });
    b.addEventListener('click', () => {
      buttons.forEach((x, i) => {
        const on = options[i].value === value;
        x.classList.toggle('cm-chip--on', on);
        x.setAttribute('aria-checked', String(on));
      });
      onPick(value);
    });
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}

function starPicker(initial, onChange) {
  let value = initial;
  const wrap = el('div', 'cm-starpick', null, { role: 'radiogroup', 'aria-label': t('community.composer.rating') });
  const label = el('span', 'cm-starpick__label', t(`community.composer.rating_word.${value}`));
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const b = el('button', 'cm-starpick__star', icon('star', 'cm-starpick__icon'), { type: 'button', role: 'radio', 'aria-label': t('community.card.rating_of', { n }), 'aria-checked': n === value });
    b.addEventListener('click', () => { value = n; paint(); onChange(n); });
    return b;
  });
  function paint() {
    stars.forEach((b, i) => {
      b.classList.toggle('cm-starpick__star--on', i < value);
      b.setAttribute('aria-checked', String(i + 1 === value));
    });
    label.textContent = t(`community.composer.rating_word.${value}`);
  }
  paint();
  wrap.append(...stars, label);
  return wrap;
}

function slider(label, initial) {
  const input = el('input', 'cm-range', null, { type: 'range', min: 1, max: 5, step: 1, value: initial, 'aria-label': label });
  const out = el('output', 'cm-range__out', `${formatNumber(initial)}/5`);
  input.addEventListener('input', () => { out.textContent = `${formatNumber(Number(input.value))}/5`; });
  return { input, row: el('div', 'cm-range__row', [el('span', 'cm-range__label', label), input, out]) };
}

/** A list of single-line inputs the author can grow (steps, price tiers) up to a limit. */
function growList(makeRow, max, addLabel) {
  const list = el('div', 'cm-grow');
  const rows = [];
  const addBtn = el('button', 'cm-link-btn', addLabel, { type: 'button' });
  function add() {
    if (rows.length >= max) return;
    const row = makeRow(rows.length);
    rows.push(row);
    list.append(row.node);
    addBtn.hidden = rows.length >= max;
  }
  addBtn.addEventListener('click', add);
  add();
  return { node: el('div', '', [list, addBtn]), rows };
}

const roleTitle = { customer: 'review', supplier: 'update', saler: 'idea', admin: 'announce', super_admin: 'announce' };

/**
 * @param {object} o
 * @param {string} o.role                    'customer' | 'supplier' | 'saler' | 'admin' | 'super_admin'
 * @param {string} o.authorName
 * @param {(post:object)=>void} o.onPublished
 * @param {()=>void} o.onCancel
 */
export function PostComposer({ role, authorName, onPublished, onCancel }) {
  const isAdmin = role === 'admin' || role === 'super_admin';
  const kinds = ROLE_KINDS[role] ?? [];
  const lang = getLanguage();
  const state = { kind: kinds[0], productId: null, orderItemId: null, rating: 4, audience: 'EVERYONE', pinned: true };
  const read = {};
  const root = el('form', 'cm-composer', null, { novalidate: true, 'aria-label': t(`community.composer.title.${roleTitle[role]}`) });

  root.append(el('header', 'cm-composer__head', [
    el('div', '', [
      el('h3', 'cm-composer__title', t(`community.composer.title.${roleTitle[role]}`)),
      el('p', 'cm-composer__sub', t(`community.composer.sub.${roleTitle[role]}`, { name: authorName })),
    ]),
    Button({ label: t('community.composer.close'), variant: 'ghost', size: 'sm', onClick: onCancel }),
  ]));

  const body = el('div', 'cm-composer__body');
  root.append(body);
  const status = el('p', 'cm-composer__error', '', { role: 'alert' });
  let n = 0;
  let publish = null;
  const picker = MediaPicker({ onBusyChange: (busy) => { if (publish) publish.disabled = busy; } });
  const mediaSection = () => section(++n, t('community.media.title'), t('community.composer.optional'), picker);

  const typeSection = () => section(++n, t('community.composer.type'), t('community.composer.pick_one'),
    chips(kinds.map((k) => ({ value: k, label: t(`community.kind.${k}`) })), state.kind, (v) => { state.kind = v; }));

  // The product picker fills in once the API answers; the rest of the form is already usable.
  const productSlot = el('div', 'cm-products', el('p', 'cm-muted', t('community.composer.loading')));

  async function loadProducts() {
    try {
      const { items } = await getComposerProducts();
      productSlot.replaceChildren();
      if (!items.length) {
        productSlot.append(el('p', 'cm-empty-note', t(`community.composer.no_products.${roleTitle[role]}`)));
        return;
      }
      const select = el('select', 'select', null, { 'aria-label': t('community.composer.product') });
      items.forEach((it, i) => {
        const label = role === 'customer'
          ? `${productTitle(it, lang)} · ${it.order_ref}${it.shop_name ? ` · ${it.shop_name}` : ''}`
          : productTitle(it, lang);
        select.append(el('option', '', label, { value: String(i) }));
      });
      const apply = () => {
        const it = items[Number(select.value)];
        state.productId = it.product_id;
        state.orderItemId = it.order_item_id ?? null;
      };
      select.addEventListener('change', apply);
      apply();
      productSlot.append(select);
    } catch (err) {
      productSlot.replaceChildren(el('p', 'cm-composer__error', errorText(err) || t('community.error.generic')));
    }
  }

  if (role === 'customer') {
    body.append(section(++n, t('community.composer.product'), t('community.composer.product_hint.customer'), productSlot));
    const q = slider(t('community.card.facet.quality'), 4);
    const v = slider(t('community.card.facet.value'), 3);
    const d = slider(t('community.card.facet.delivery'), 5);
    Object.assign(read, { quality: q.input, value: v.input, delivery: d.input });
    body.append(section(++n, t('community.composer.rating'), t('community.composer.required'),
      starPicker(state.rating, (x) => { state.rating = x; }), q.row, v.row, d.row));
    read.liked = textArea(t('community.composer.ph.liked'), 1000);
    read.improve = textArea(t('community.composer.ph.could_improve'), 1000);
    read.tip = textInput(t('community.composer.ph.tip'), { max: 300 });
    body.append(section(++n, t('community.composer.experience'), t('community.composer.experience_hint'),
      el('div', 'cm-grid2', [field(t('community.card.liked'), read.liked), field(t('community.card.could_improve'), read.improve)]),
      field(t('community.composer.tip_label'), read.tip)));
    body.append(mediaSection());
  }

  if (role === 'supplier') {
    body.append(typeSection());
    body.append(section(++n, t('community.composer.product'), t('community.composer.product_hint.supplier'), productSlot));
    read.stock = textInput('500', { type: 'number' });
    read.minOrder = textInput('10', { type: 'number' });
    read.price = textInput('780', { type: 'number' });
    read.ships = textInput(t('community.composer.ph.ships_from'), { max: 40 });
    const tiers = growList(() => {
      const qty = textInput(t('community.composer.ph.tier_qty'), { type: 'number' });
      const price = textInput(t('community.composer.ph.tier_price'), { type: 'number' });
      return { qty, price, node: el('div', 'cm-grid2', [qty, price]) };
    }, MAX_TIERS, t('community.composer.add_tier'));
    read.tiers = tiers.rows;
    body.append(section(++n, t('community.composer.stock_pricing'), t('community.composer.shown_on_card'),
      el('div', 'cm-grid2', [field(t('community.card.stock'), read.stock), field(t('community.card.min_order'), read.minOrder),
        field(t('community.composer.wholesale_price'), read.price), field(t('community.card.ships_from'), read.ships)]),
      el('p', 'cm-field__label', t('community.card.price_tiers')), tiers.node));
    read.body = textArea(t('community.composer.ph.highlights'), 2000, 4);
    body.append(section(++n, t('community.composer.highlights'), t('community.composer.highlights_hint'), read.body));
    body.append(mediaSection());
  }

  if (role === 'saler') {
    body.append(typeSection());
    body.append(section(++n, t('community.composer.product'), t('community.composer.product_hint.saler'), productSlot));
    read.title = textInput(t('community.composer.ph.headline'), { max: 120 });
    const steps = growList((i) => {
      const input = textInput(t('community.composer.ph.step', { n: formatNumber(i + 1) }), { max: 200 });
      return { input, node: input };
    }, MAX_STEPS, t('community.composer.add_step'));
    read.steps = steps.rows;
    read.body = textArea(t('community.composer.ph.caption'), 2000);
    body.append(section(++n, t('community.composer.idea'), t('community.composer.idea_hint'),
      field(t('community.composer.headline'), read.title),
      el('p', 'cm-field__label', t('community.composer.steps')), steps.node,
      field(t('community.composer.caption'), read.body)));
    body.append(mediaSection());
    read.tags = textInput(t('community.composer.ph.tags'), { max: 150 });
    body.append(section(++n, t('community.composer.tags'), t('community.composer.optional'), read.tags,
      el('p', 'cm-callout', t('community.composer.shop_button_note'))));
  }

  if (isAdmin) {
    body.append(typeSection());
    read.title = textInput(t('community.composer.ph.announce_title'), { max: 120 });
    read.body = textArea(t('community.composer.ph.announce_body'), 2000, 4);
    body.append(section(++n, t('community.composer.message'), t('community.composer.message_hint'),
      field(t('community.composer.title_label'), read.title), field(t('community.composer.details'), read.body)));
    body.append(mediaSection());
    const pin = el('input', '', null, { type: 'checkbox', checked: true });
    pin.addEventListener('change', () => { state.pinned = pin.checked; });
    body.append(section(++n, t('community.composer.audience'), t('community.composer.who_sees'),
      chips(AUDIENCES.map((a) => ({ value: a, label: t(`community.audience.${a}`) })), state.audience, (v) => { state.audience = v; }),
      el('label', 'cm-check', [pin, t('community.composer.pin')])));
  }

  publish = Button({ label: t('community.composer.publish'), type: 'submit' });
  root.append(status, el('footer', 'cm-composer__foot', [
    el('span', 'cm-composer__note', t('community.composer.live_note')),
    el('div', 'cm-composer__actions', [Button({ label: t('community.composer.cancel'), variant: 'ghost', onClick: onCancel }), publish]),
  ]));

  // Added to every payload: the ids of the files that finished uploading, in the order shown.
  const withMedia = (payload) => {
    const ids = picker.getIds();
    return ids.length ? { ...payload, media_ids: ids } : payload;
  };

  const num = (input) => (input.value === '' ? null : Number(input.value));

  function payload() {
    if (role === 'customer') {
      return {
        kind: 'REVIEW', order_item_id: state.orderItemId,
        details: {
          rating: state.rating, quality: Number(read.quality.value), value: Number(read.value.value), delivery: Number(read.delivery.value),
          liked: read.liked.value, could_improve: read.improve.value, tip: read.tip.value,
        },
      };
    }
    if (role === 'supplier') {
      return {
        kind: state.kind, product_id: state.productId, body: read.body.value,
        details: {
          stock: num(read.stock), min_order: num(read.minOrder), wholesale_price: num(read.price), ships_from: read.ships.value,
          tiers: read.tiers.map((r) => ({ min_qty: num(r.qty), price: num(r.price) })).filter((x) => x.min_qty !== null || x.price !== null),
        },
      };
    }
    if (role === 'saler') {
      return {
        kind: state.kind, product_id: state.productId, title: read.title.value, body: read.body.value,
        details: {
          steps: read.steps.map((r) => r.input.value), tags: read.tags.value.split(/[\s,]+/).filter(Boolean),
        },
      };
    }
    return { kind: state.kind, title: read.title.value, body: read.body.value, audience: state.audience, is_pinned: state.pinned };
  }

  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    if (picker.isBusy()) {
      status.textContent = t('community.media.wait');
      return;
    }
    publish.disabled = true;
    try {
      const data = withMedia(payload());
      const post = await (isAdmin ? createAnnouncement(data) : createPost(data));
      toast.success(t('community.composer.published'));
      onPublished(post);
    } catch (err) {
      // The server's message is already in the right language and names the field that is wrong.
      status.textContent = errorText(err) || t('community.error.generic');
      publish.disabled = false;
    }
  });

  if (!isAdmin) loadProducts();
  return root;
}
