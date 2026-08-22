/**
 * VariantSelector — reads real product_variants, disables unavailable combinations with an
 * explanation instead of hiding them (Prompt 4.6 REQUIREMENT 2).
 *
 * Supports N attribute dimensions (size, color, ...) even though today's seed/mock data only ever
 * varies one at a time — selecting a value in one dimension re-evaluates every button in every
 * OTHER dimension against the variants that share the values already picked, so a combination that
 * doesn't exist (or is out of stock) is disabled with a title/aria-description rather than removed
 * from the DOM, per the REQUIREMENT's own wording.
 *
 * `onChange({ variant, price, stockQty, sku, imageUrl, imageIndex })` fires whenever a FULL,
 * in-stock combination is selected; fires with `null` while the selection is incomplete or points
 * at an unavailable combination.
 */
import { t } from '../../services/i18n.js';

function attributeKeys(variants) {
  const keys = [];
  for (const v of variants) {
    for (const key of Object.keys(v.attributes || {})) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function valuesFor(variants, key) {
  const values = [];
  for (const v of variants) {
    const val = v.attributes?.[key];
    if (val != null && !values.includes(val)) values.push(val);
  }
  return values;
}

function findVariant(variants, selection) {
  return variants.find((v) => Object.entries(selection).every(([k, val]) => v.attributes?.[k] === val)) || null;
}

/** Whether a candidate value for `key` yields at least one variant consistent with the REST of
 * the current selection — used to decide if a button should be disabled. */
function isReachable(variants, selection, key, value) {
  const candidate = { ...selection, [key]: value };
  return variants.some((v) => Object.entries(candidate).every(([k, val]) => v.attributes?.[k] === val));
}

export function VariantSelector({ variants = [], basePrice = 0, onChange = null } = {}) {
  const root = document.createElement('div');
  root.className = 'variant-selector';
  if (variants.length === 0) return root; // no-variant products render nothing

  const keys = attributeKeys(variants);
  const selection = {};
  const groups = new Map(); // key -> Map(value -> button)

  function priceFor(variant) {
    return Number(basePrice) + (variant ? variant.price_delta : 0);
  }

  function emitChange() {
    if (keys.some((k) => selection[k] == null)) {
      onChange && onChange(null);
      return;
    }
    const variant = findVariant(variants, selection);
    if (!variant || variant.stock_qty <= 0) {
      onChange && onChange(null);
      return;
    }
    onChange && onChange({
      variant,
      price: priceFor(variant),
      stockQty: variant.stock_qty,
      sku: variant.sku,
      imageUrl: variant.image_url,
      imageIndex: variant.image_index,
    });
  }

  function refreshButtons() {
    for (const key of keys) {
      const buttonMap = groups.get(key);
      for (const [value, btn] of buttonMap) {
        const isSelected = selection[key] === value;
        const otherSelection = { ...selection };
        delete otherSelection[key];
        const reachable = isReachable(variants, otherSelection, key, value);
        const exactVariant = findVariant(variants, { ...otherSelection, [key]: value });
        const outOfStock = reachable && exactVariant && exactVariant.stock_qty <= 0;
        const disabled = !reachable || outOfStock;

        btn.classList.toggle('variant-selector__option--selected', isSelected);
        btn.disabled = disabled;
        btn.setAttribute('aria-pressed', String(isSelected));
        if (disabled) {
          btn.title = outOfStock
            ? t('product_detail.variant.out_of_stock_reason')
            : t('product_detail.variant.unavailable_reason');
        } else {
          btn.removeAttribute('title');
        }
      }
    }
  }

  for (const key of keys) {
    const group = document.createElement('div');
    group.className = 'variant-selector__group';

    const label = document.createElement('span');
    label.className = 'variant-selector__group-label';
    // No locale entry exists per attribute name (size/color/strap/switch/...) since the set is
    // open-ended, data-driven category vocabulary, not fixed UI copy — i18n.js's own missing-key
    // fallback already humanizes the raw key ("size" -> "Size") in both languages.
    label.textContent = t(`product_detail.variant.attribute.${key}`);
    group.append(label);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'variant-selector__options';

    const buttonMap = new Map();
    for (const value of valuesFor(variants, key)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'variant-selector__option';
      btn.textContent = value;
      btn.addEventListener('click', () => {
        selection[key] = selection[key] === value ? undefined : value;
        if (selection[key] === undefined) delete selection[key];
        refreshButtons();
        emitChange();
      });
      buttonMap.set(value, btn);
      optionsRow.append(btn);
    }
    groups.set(key, buttonMap);

    group.append(optionsRow);
    root.append(group);
  }

  // Pre-select the first fully in-stock combination so the price shown on load already reflects
  // a real, purchasable variant rather than the bare base price.
  const firstInStock = variants.find((v) => v.stock_qty > 0);
  if (firstInStock) {
    for (const key of keys) selection[key] = firstInStock.attributes?.[key];
  }

  refreshButtons();
  emitChange();

  return root;
}
