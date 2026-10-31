/**
 * VariantEditor — the supplier's variant rows inside the product form (size, colour, material, ...).
 *
 * Saved as one list by PUT /products/:ref/variants (server/src/services/productVariant.service.ts),
 * which is where every rule is enforced; this component only collects rows and catches the obvious
 * mistakes early. A row IS its combination: the server updates a matching row instead of adding a
 * second one, and switches off a combination that is left out.
 *
 * The supplier first picks what changes between options (up to MAX_VARIANT_DIMENSIONS of
 * VARIANT_DIMENSIONS); every row then has one box per picked dimension. That keeps every row the
 * same shape, which the shopper's picker (VariantSelector) needs.
 *
 * WHY the product's stock is the variants' total: checkout sells min(variant stock, product stock)
 * and decrements both, so the form shows the sum and the server writes it.
 */
import { t } from '../../services/i18n.ts';
import {
  DEFAULT_VARIANT_DIMENSIONS,
  MAX_VARIANT_DIMENSIONS,
  VARIANT_DIMENSIONS,
  type VariantDimension,
} from '../../config/variantDimensions.ts';
import '../../styles/components/variant-editor.css';

export interface VariantRow {
  attributes: Partial<Record<VariantDimension, string>>;
  price_delta: number;
  stock_qty: number;
  sku?: string | null;
  /** One of the product's own photos (media id), shown when a shopper picks this variant. */
  image_media_id?: number | null;
}

/** A product photo the rows can point at: only uploaded ones (numeric media id) qualify. */
export interface VariantPhoto {
  id: number | string;
  url?: string | null;
}

export interface VariantEditorElement extends HTMLDivElement {
  /** The rows as the API wants them; rows with no option filled are left out. */
  getVariants(): VariantRow[];
  setVariants(list: unknown[]): void;
  /** The product's current photos; a row whose photo was removed falls back to none. */
  setPhotos(photos: VariantPhoto[]): void;
  /** True once the supplier changed anything, so an untouched form never rewrites variants. */
  isTouched(): boolean;
  /** A message for the first row the server would refuse, or null. Focuses that field. */
  validate(): string | null;
  totalStock(): number;
}

const isDimension = (k: string): k is VariantDimension => (VARIANT_DIMENSIONS as readonly string[]).includes(k);

/** Accepts the server shape (attributes_json, image_id, NUMERIC strings) or the mock one. */
export function normalizeVariants(list: unknown[]): VariantRow[] {
  return (Array.isArray(list) ? list : []).map((v: any) => {
    const attrs = v?.attributes || v?.attributes_json || {};
    const attributes: VariantRow['attributes'] = {};
    for (const k of Object.keys(attrs)) if (isDimension(k) && attrs[k]) attributes[k] = String(attrs[k]);
    const image = v?.image_media_id ?? v?.image_id ?? null;
    return {
      attributes,
      price_delta: Number(v?.price_delta) || 0,
      stock_qty: Number(v?.stock_qty) || 0,
      sku: v?.sku || '',
      image_media_id: image == null || image === '' ? null : Number(image),
    };
  });
}

/** The dimensions a stored list uses, in list order; the defaults when there is none. */
export function dimensionsOf(rows: VariantRow[]): VariantDimension[] {
  const used = VARIANT_DIMENSIONS.filter((d) => rows.some((r) => r.attributes[d]));
  return used.length ? used.slice(0, MAX_VARIANT_DIMENSIONS) : [...DEFAULT_VARIANT_DIMENSIONS];
}

const dimLabel = (d: VariantDimension) => t(`product_detail.variant.attribute.${d}`);

export function VariantEditor({
  initial = [],
  onChange = null,
  pending = false,
  photos = [],
}: {
  initial?: unknown[];
  onChange?: ((rows: VariantRow[]) => void) | null;
  /**
   * The stored list is still loading: nothing can be edited until setVariants() hands it over.
   * WHY: a row added before the stored ones arrive marks the editor touched, the stored rows are
   * then never shown, and saving switches every one of them off.
   */
  pending?: boolean;
  photos?: VariantPhoto[];
} = {}): VariantEditorElement {
  const root = document.createElement('div') as VariantEditorElement;
  root.className = 'variant-editor';
  root.setAttribute('role', 'group');

  const uid = Math.random().toString(36).slice(2, 8);
  const head = document.createElement('div');
  head.className = 'variant-editor__head';
  const title = document.createElement('span');
  title.className = 'catalog-form-label';
  title.id = `variant-editor-${uid}`;
  title.textContent = t('admin_catalog.variants.title');
  root.setAttribute('aria-labelledby', title.id);
  const hint = document.createElement('span');
  hint.className = 'catalog-form-hint';
  hint.textContent = t('admin_catalog.variants.hint');
  head.append(title, hint);

  // "What changes between options?" — one checkbox per dimension, at most MAX checked.
  const dimsBox = document.createElement('fieldset');
  dimsBox.className = 'variant-editor__dims';
  const legend = document.createElement('legend');
  legend.className = 'catalog-form-hint';
  legend.textContent = t('admin_catalog.variants.dims_legend', { max: MAX_VARIANT_DIMENSIONS });
  dimsBox.append(legend);
  const dimChecks = new Map<VariantDimension, HTMLInputElement>();
  for (const d of VARIANT_DIMENSIONS) {
    const label = document.createElement('label');
    label.className = 'variant-editor__dim';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = d;
    label.append(box, document.createTextNode(dimLabel(d)));
    dimsBox.append(label);
    dimChecks.set(d, box);
  }

  const list = document.createElement('div');
  list.className = 'variant-editor__list';

  const empty = document.createElement('p');
  empty.className = 'variant-editor__empty';

  const total = document.createElement('p');
  total.className = 'variant-editor__total';
  total.setAttribute('aria-live', 'polite');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'catalog-icon-btn variant-editor__add';
  addBtn.textContent = `+ ${t('admin_catalog.variants.add')}`;

  root.append(head, dimsBox, list, empty, total, addBtn);

  let touched = false;
  let dims: VariantDimension[] = [...DEFAULT_VARIANT_DIMENSIONS];
  let photoList: VariantPhoto[] = [];

  const usablePhotos = () => photoList.filter((p) => /^\d+$/.test(String(p.id)));

  function field(name: string, labelText: string, control: HTMLElement): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = `variant-editor__field variant-editor__field--${name}`;
    const caption = document.createElement('span');
    caption.textContent = labelText;
    label.append(caption, control);
    return label;
  }

  function textInput(name: string, value: string | number, type = 'text', placeholder = ''): HTMLInputElement {
    const el = document.createElement('input');
    el.className = 'catalog-form-input';
    el.name = `variant_${name}`;
    el.type = type;
    if (type === 'number') {
      el.min = '0';
      el.step = name === 'price_delta' ? '0.01' : '1';
      el.inputMode = name === 'price_delta' ? 'decimal' : 'numeric';
    } else {
      el.maxLength = name === 'sku' ? 64 : 40;
    }
    if (placeholder) el.placeholder = placeholder;
    el.value = String(value ?? '');
    return el;
  }

  /** The photo picker: a select over the product's photos plus a thumbnail of the choice. */
  function photoControl(selected: number | null | undefined): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'variant-editor__photo';
    const select = document.createElement('select');
    select.className = 'catalog-form-select';
    select.name = 'variant_image';
    const thumb = document.createElement('img');
    thumb.className = 'variant-editor__thumb';
    thumb.alt = '';
    const fill = (value: string) => {
      const none = new Option(t('admin_catalog.variants.photo_none'), '');
      select.replaceChildren(none, ...usablePhotos().map((p, i) => new Option(t('admin_catalog.variants.photo_n', { n: i + 1 }), String(p.id))));
      select.value = usablePhotos().some((p) => String(p.id) === value) ? value : '';
      const chosen = usablePhotos().find((p) => String(p.id) === select.value);
      thumb.hidden = !chosen?.url;
      if (chosen?.url) thumb.src = chosen.url;
    };
    select.addEventListener('change', () => fill(select.value));
    (wrap as any).refill = () => fill(select.value);
    fill(selected == null ? '' : String(selected));
    wrap.append(select, thumb);
    return wrap;
  }

  function addRow(row: VariantRow = { attributes: {}, price_delta: 0, stock_qty: 0, sku: '', image_media_id: null }): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'variant-editor__row';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'catalog-icon-btn catalog-icon-btn--danger variant-editor__remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', t('admin_catalog.variants.remove'));
    remove.addEventListener('click', () => {
      el.remove();
      changed();
      (list.querySelector<HTMLInputElement>('.variant-editor__row:last-child input') || addBtn).focus();
    });
    for (const d of dims) {
      el.append(field(d, dimLabel(d), textInput(d, row.attributes[d] || '', 'text', t(`admin_catalog.variants.example.${d}`))));
    }
    el.append(
      field('price_delta', t('admin_catalog.variants.price_delta'), textInput('price_delta', row.price_delta || 0, 'number')),
      field('stock', t('admin_catalog.variants.stock'), textInput('stock', row.stock_qty || 0, 'number')),
      field('sku', t('admin_catalog.variants.sku'), textInput('sku', row.sku || '')),
      field('image', t('admin_catalog.variants.photo'), photoControl(row.image_media_id)),
      remove
    );
    list.append(el);
    return el;
  }

  const rowValue = (row: Element, name: string) =>
    (row.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="variant_${name}"]`)?.value || '').trim();

  function read(): Array<VariantRow & { el: Element }> {
    return [...list.querySelectorAll('.variant-editor__row')].map((el) => {
      const attributes: VariantRow['attributes'] = {};
      for (const d of dims) {
        const v = rowValue(el, d);
        if (v) attributes[d] = v;
      }
      const image = rowValue(el, 'image');
      return {
        el,
        attributes,
        price_delta: Number(rowValue(el, 'price_delta')) || 0,
        stock_qty: Number(rowValue(el, 'stock')) || 0,
        sku: rowValue(el, 'sku') || null,
        image_media_id: image ? Number(image) : null,
      };
    });
  }

  const sumStock = (rows: VariantRow[]) => rows.reduce((sum, r) => sum + (Number.isInteger(r.stock_qty) ? r.stock_qty : 0), 0);

  function refresh(): void {
    const rows = read();
    addBtn.disabled = pending;
    dimsBox.disabled = pending;
    root.setAttribute('aria-busy', String(pending));
    for (const [d, box] of dimChecks) {
      box.checked = dims.includes(d);
      // Unchecked boxes lock once the maximum is reached, so the limit is visible, not an error.
      box.disabled = !box.checked && dims.length >= MAX_VARIANT_DIMENSIONS;
    }
    empty.textContent = t(pending ? 'common.loading' : 'admin_catalog.variants.empty');
    empty.hidden = rows.length > 0;
    total.hidden = rows.length === 0;
    total.textContent = t('admin_catalog.variants.total', { count: sumStock(rows) });
  }

  function changed(): void {
    touched = true;
    refresh();
    onChange && onChange(root.getVariants());
  }

  /** Redraws every row for the current dimensions, keeping what was typed in the ones still there. */
  function redraw(rows: VariantRow[]): void {
    list.replaceChildren();
    rows.forEach((r) => addRow(r));
  }

  dimsBox.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    const d = box.value as VariantDimension;
    const rows = read();
    if (box.checked && !dims.includes(d)) dims = VARIANT_DIMENSIONS.filter((x) => dims.includes(x) || x === d);
    if (!box.checked) {
      // Never leave zero dimensions: a row with no option is not a variant.
      if (dims.length === 1) {
        box.checked = true;
        return;
      }
      dims = dims.filter((x) => x !== d);
    }
    redraw(rows);
    changed();
  });
  list.addEventListener('input', changed);
  list.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).matches('select')) changed();
  });
  addBtn.addEventListener('click', () => {
    addRow().querySelector('input')?.focus();
    changed();
  });

  root.getVariants = () =>
    read()
      .filter((r) => Object.keys(r.attributes).length > 0)
      .map(({ el: _el, ...r }) => r);

  root.setVariants = (next) => {
    const rows = normalizeVariants(next);
    dims = dimensionsOf(rows);
    redraw(rows);
    touched = false;
    pending = false;
    refresh();
  };

  root.setPhotos = (next) => {
    photoList = Array.isArray(next) ? next : [];
    list.querySelectorAll<HTMLElement>('.variant-editor__photo').forEach((w) => (w as any).refill?.());
  };

  root.isTouched = () => touched;
  root.totalStock = () => sumStock(root.getVariants());

  root.validate = () => {
    const seen = new Set<string>();
    for (const r of read()) {
      const fail = (name: string, key: string) => {
        const el = r.el.querySelector<HTMLInputElement>(`[name="variant_${name}"]`);
        el?.setAttribute('aria-invalid', 'true');
        el?.focus();
        return t(key);
      };
      const filled = Object.keys(r.attributes).length;
      // A row left completely blank is ignored rather than refused.
      if (!filled && !rowValue(r.el, 'sku') && !Number(rowValue(r.el, 'stock'))) continue;
      // Every picked dimension in every row: the shopper's picker needs one value per button row.
      const missing = dims.find((d) => !r.attributes[d]);
      if (missing) return fail(missing, 'admin_catalog.variants.fill_every_option');
      const key = dims.map((d) => (r.attributes[d] || '').toLowerCase()).join('|');
      if (seen.has(key)) return fail(dims[0], 'admin_catalog.variants.duplicate');
      seen.add(key);
      if (!Number.isInteger(r.stock_qty) || r.stock_qty < 0) return fail('stock', 'admin_catalog.variants.bad_stock');
      if (r.price_delta < 0) return fail('price_delta', 'admin_catalog.variants.bad_price');
      if (r.sku && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(r.sku)) return fail('sku', 'admin_catalog.variants.bad_sku');
    }
    return null;
  };

  photoList = photos;
  const start = normalizeVariants(initial);
  dims = dimensionsOf(start);
  redraw(start);
  refresh();
  return root;
}
