/**
 * VariantEditor — the supplier's size / colour rows inside the product form.
 *
 * Saved as one list by PUT /products/:ref/variants (server/src/services/productVariant.service.ts),
 * which is where every rule is enforced; this component only collects rows and catches the obvious
 * mistakes early. A row IS its size + colour: the server updates a matching row instead of adding a
 * second one, and switches off a combination that is left out.
 *
 * WHY the product's stock is the variants' total: checkout sells min(variant stock, product stock)
 * and decrements both, so the form shows the sum and the server writes it.
 */
import { t } from '../../services/i18n.ts';
import '../../styles/components/variant-editor.css';

export interface VariantRow {
  attributes: { size?: string; color?: string };
  price_delta: number;
  stock_qty: number;
  sku?: string | null;
}

export interface VariantEditorElement extends HTMLDivElement {
  /** The rows as the API wants them; rows with neither size nor colour are left out. */
  getVariants(): VariantRow[];
  setVariants(list: unknown[]): void;
  /** True once the supplier changed anything, so an untouched form never rewrites variants. */
  isTouched(): boolean;
  /** A message for the first row the server would refuse, or null. Focuses that field. */
  validate(): string | null;
  totalStock(): number;
}

/** Accepts the server shape (attributes_json, NUMERIC strings) or the mock one. */
export function normalizeVariants(list: unknown[]): VariantRow[] {
  return (Array.isArray(list) ? list : []).map((v: any) => {
    const attrs = v?.attributes || v?.attributes_json || {};
    return {
      attributes: { size: attrs.size || '', color: attrs.color || '' },
      price_delta: Number(v?.price_delta) || 0,
      stock_qty: Number(v?.stock_qty) || 0,
      sku: v?.sku || '',
    };
  });
}

export function VariantEditor({
  initial = [],
  onChange = null,
  pending = false,
}: {
  initial?: unknown[];
  onChange?: ((rows: VariantRow[]) => void) | null;
  /**
   * The stored list is still loading: nothing can be edited until setVariants() hands it over.
   * WHY: a row added before the stored ones arrive marks the editor touched, the stored rows are
   * then never shown, and saving switches every one of them off.
   */
  pending?: boolean;
} = {}): VariantEditorElement {
  const root = document.createElement('div') as VariantEditorElement;
  root.className = 'variant-editor';
  root.setAttribute('role', 'group');

  const head = document.createElement('div');
  head.className = 'variant-editor__head';
  const title = document.createElement('span');
  title.className = 'catalog-form-label';
  title.id = `variant-editor-${Math.random().toString(36).slice(2, 8)}`;
  title.textContent = t('admin_catalog.variants.title');
  root.setAttribute('aria-labelledby', title.id);
  const hint = document.createElement('span');
  hint.className = 'catalog-form-hint';
  hint.textContent = t('admin_catalog.variants.hint');
  head.append(title, hint);

  const list = document.createElement('div');
  list.className = 'variant-editor__list';

  const empty = document.createElement('p');
  empty.className = 'variant-editor__empty';
  empty.textContent = t('admin_catalog.variants.empty');

  const total = document.createElement('p');
  total.className = 'variant-editor__total';
  total.setAttribute('aria-live', 'polite');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'catalog-icon-btn variant-editor__add';
  addBtn.textContent = `+ ${t('admin_catalog.variants.add')}`;

  root.append(head, list, empty, total, addBtn);

  let touched = false;

  function input(name: string, type: string, labelKey: string, value: string | number): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = `variant-editor__field variant-editor__field--${name}`;
    const caption = document.createElement('span');
    caption.textContent = t(labelKey);
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
    el.value = String(value ?? '');
    label.append(caption, el);
    return label;
  }

  function addRow(row: VariantRow = { attributes: {}, price_delta: 0, stock_qty: 0, sku: '' }): HTMLDivElement {
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
    el.append(
      input('size', 'text', 'admin_catalog.variants.size', row.attributes.size || ''),
      input('color', 'text', 'admin_catalog.variants.color', row.attributes.color || ''),
      input('price_delta', 'number', 'admin_catalog.variants.price_delta', row.price_delta || 0),
      input('stock', 'number', 'admin_catalog.variants.stock', row.stock_qty || 0),
      input('sku', 'text', 'admin_catalog.variants.sku', row.sku || ''),
      remove
    );
    list.append(el);
    return el;
  }

  const rowValue = (row: Element, name: string) =>
    (row.querySelector<HTMLInputElement>(`[name="variant_${name}"]`)?.value || '').trim();

  function read(): Array<VariantRow & { el: Element }> {
    return [...list.querySelectorAll('.variant-editor__row')].map((el) => {
      const size = rowValue(el, 'size');
      const color = rowValue(el, 'color');
      return {
        el,
        attributes: { ...(size ? { size } : {}), ...(color ? { color } : {}) },
        price_delta: Number(rowValue(el, 'price_delta')) || 0,
        stock_qty: Number(rowValue(el, 'stock')) || 0,
        sku: rowValue(el, 'sku') || null,
      };
    });
  }

  function refresh(): void {
    const rows = read();
    addBtn.disabled = pending;
    root.setAttribute('aria-busy', String(pending));
    empty.textContent = t(pending ? 'common.loading' : 'admin_catalog.variants.empty');
    empty.hidden = rows.length > 0;
    total.hidden = rows.length === 0;
    total.textContent = t('admin_catalog.variants.total', { count: rootTotal(rows) });
  }

  const rootTotal = (rows: VariantRow[]) => rows.reduce((sum, r) => sum + (Number.isInteger(r.stock_qty) ? r.stock_qty : 0), 0);

  function changed(): void {
    touched = true;
    refresh();
    onChange && onChange(root.getVariants());
  }

  list.addEventListener('input', changed);
  addBtn.addEventListener('click', () => {
    addRow().querySelector('input')?.focus();
    changed();
  });

  root.getVariants = () =>
    read()
      .filter((r) => Object.keys(r.attributes).length > 0)
      .map(({ el: _el, ...r }) => r);

  root.setVariants = (next) => {
    list.replaceChildren();
    normalizeVariants(next).forEach((r) => addRow(r));
    touched = false;
    pending = false;
    refresh();
  };

  root.isTouched = () => touched;
  root.totalStock = () => rootTotal(root.getVariants());

  root.validate = () => {
    const seen = new Set<string>();
    let shape: string | null = null;
    for (const r of read()) {
      const fail = (name: string, key: string) => {
        const el = r.el.querySelector<HTMLInputElement>(`[name="variant_${name}"]`);
        el?.setAttribute('aria-invalid', 'true');
        el?.focus();
        return t(key);
      };
      const hasAny = Object.keys(r.attributes).length > 0;
      // A row left completely blank is ignored rather than refused.
      if (!hasAny && !rowValue(r.el, 'sku') && !Number(rowValue(r.el, 'stock'))) continue;
      if (!hasAny) return fail('size', 'admin_catalog.variants.need_size_or_color');
      // Same rule as the server: every row fills the same fields, or the shopper's picker breaks.
      const rowShape = Object.keys(r.attributes).join('+');
      if (shape !== null && rowShape !== shape) return fail(r.attributes.size ? 'color' : 'size', 'admin_catalog.variants.mixed_shape');
      shape = rowShape;
      const key = `${(r.attributes.size || '').toLowerCase()}|${(r.attributes.color || '').toLowerCase()}`;
      if (seen.has(key)) return fail('size', 'admin_catalog.variants.duplicate');
      seen.add(key);
      if (!Number.isInteger(r.stock_qty) || r.stock_qty < 0) return fail('stock', 'admin_catalog.variants.bad_stock');
      if (r.price_delta < 0) return fail('price_delta', 'admin_catalog.variants.bad_price');
      if (r.sku && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(r.sku)) return fail('sku', 'admin_catalog.variants.bad_sku');
    }
    return null;
  };

  normalizeVariants(initial).forEach((r) => addRow(r));
  refresh();
  return root;
}
