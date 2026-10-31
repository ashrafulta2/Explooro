/**
 * productVariant.service.ts — the supplier's variants of one product (size, colour, material, ...).
 *
 * The product page, cart, checkout and live stream already read `product_variants`; until this file
 * nothing could write it, so only seeded demo products ever had variants. One call saves the whole
 * list (PUT semantics), which keeps a retried request harmless without an idempotency table.
 *
 * Identity: a variant IS its combination of attributes (e.g. size + colour). Saving "M / Red" again
 * updates that row instead of inserting a second one, and a combination left out of the list is
 * switched off, never deleted (orders reference it).
 */

import * as productRepo from '../repositories/product.repository.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { withTransaction } from '../config/db.ts';
import { writeAudit } from '../lib/audit.ts';

/**
 * What variants may differ by. VariantSelector draws one button row per key it finds.
 * Must equal client/src/config/variantDimensions.ts (server/test/productVariant.test.js checks).
 */
export const VARIANT_ATTRIBUTE_KEYS = ['size', 'color', 'material', 'style', 'weight', 'volume', 'capacity', 'pack_size'] as const;

// WHY these bounds are constants, not settings: they are input-shape limits (one form row per
// variant, a label that fits a button, a picker a shopper can answer), not business numbers.
export const VARIANT_LIMITS = {
  maxVariants: 100,
  maxDimensions: 3,
  maxValueLength: 40,
  maxSkuLength: 64,
  // The INTEGER column's ceiling and a ceiling that keeps retail + delta inside NUMERIC(14,2).
  maxStock: 2147483647,
  maxPriceDelta: 1e10,
};

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface VariantInput {
  attributes: Record<string, string>;
  sku: string | null;
  price_delta: number;
  stock_qty: number;
  /** A media_assets id among the product's own photos, shown when this variant is picked. */
  image_media_id: number | null;
}

function invalid(index: number, field: string, en: string, bn: string): never {
  throw new AppError('VALIDATION_FAILED', `Variant ${index + 1}: ${en}`, `ভ্যারিয়েন্ট ${index + 1}: ${bn}`, { field, index });
}

/** Case-insensitive key for a combination, so "M / Red" and "m / red" cannot both exist. */
export function comboKey(attributes: Record<string, unknown> | null | undefined): string {
  return VARIANT_ATTRIBUTE_KEYS.map((k) => `${k}=${String(attributes?.[k] ?? '').trim().toLowerCase()}`).join('|');
}

/**
 * Validates and normalises the list a supplier sent. Pure, so the rules are testable without a DB.
 * Throws VALIDATION_FAILED naming the row; returns the clean list otherwise.
 * Whether a photo belongs to the product needs the DB, so saveVariants checks that.
 */
export function normalizeVariantInput(raw: unknown): VariantInput[] {
  if (!Array.isArray(raw)) {
    throw new AppError('VALIDATION_FAILED', 'Send variants as a list.', 'ভ্যারিয়েন্টগুলো একটি তালিকা হিসেবে পাঠান।', { field: 'variants' });
  }
  if (raw.length > VARIANT_LIMITS.maxVariants) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A product can have at most ${VARIANT_LIMITS.maxVariants} variants.`,
      `একটি প্রোডাক্টে সর্বোচ্চ ${VARIANT_LIMITS.maxVariants}টি ভ্যারিয়েন্ট থাকতে পারে।`,
      { field: 'variants' }
    );
  }

  const known = new Set<string>(VARIANT_ATTRIBUTE_KEYS);
  const seen = new Set<string>();
  const seenSku = new Set<string>();
  let shape: string | null = null;
  return raw.map((row: any, i) => {
    const sent = row?.attributes && typeof row.attributes === 'object' ? row.attributes : {};
    for (const key of Object.keys(sent)) {
      if (!known.has(key) && String(sent[key] ?? '').trim()) {
        invalid(i, 'attributes', `"${key}" is not an option a variant can have.`, `"${key}" ভ্যারিয়েন্টের কোনো অপশন নয়।`);
      }
    }
    const attributes: Record<string, string> = {};
    for (const key of VARIANT_ATTRIBUTE_KEYS) {
      const value = String(sent[key] ?? '').trim();
      if (value.length > VARIANT_LIMITS.maxValueLength) {
        invalid(i, key, `${key} is too long.`, `${key} অনেক লম্বা।`);
      }
      if (value) attributes[key] = value;
    }
    const keys = Object.keys(attributes);
    if (keys.length === 0) {
      invalid(i, 'attributes', 'give it at least one option, such as a size or a colour.', 'অন্তত একটি অপশন দিন, যেমন সাইজ বা রং।');
    }
    if (keys.length > VARIANT_LIMITS.maxDimensions) {
      invalid(
        i,
        'attributes',
        `a variant can differ in at most ${VARIANT_LIMITS.maxDimensions} ways.`,
        `একটি ভ্যারিয়েন্ট সর্বোচ্চ ${VARIANT_LIMITS.maxDimensions}টি দিকে আলাদা হতে পারে।`
      );
    }
    // WHY one shape for every row: VariantSelector draws a button row per dimension and asks the
    // shopper for each, so "M" next to "XXL / Red" leaves no colour to pick for M and XXL unreachable.
    const rowShape = keys.join('+');
    if (shape !== null && rowShape !== shape) {
      invalid(i, 'attributes', 'fill the same fields as the first row.', 'প্রথম সারির মতো একই ঘরগুলো পূরণ করুন।');
    }
    shape = rowShape;

    const key = comboKey(attributes);
    if (seen.has(key)) {
      invalid(i, 'attributes', 'this combination is already in the list.', 'এই কম্বিনেশন তালিকায় আগেই আছে।');
    }
    seen.add(key);

    const skuRaw = String(row?.sku ?? '').trim();
    if (skuRaw && (skuRaw.length > VARIANT_LIMITS.maxSkuLength || !SKU_PATTERN.test(skuRaw))) {
      invalid(i, 'sku', 'the SKU may use only letters, digits, - and _.', 'SKU তে শুধু অক্ষর, সংখ্যা, - এবং _ থাকতে পারে।');
    }
    if (skuRaw) {
      if (seenSku.has(skuRaw.toUpperCase())) invalid(i, 'sku', 'this SKU is used twice.', 'এই SKU দুবার ব্যবহার হয়েছে।');
      seenSku.add(skuRaw.toUpperCase());
    }

    const stock = Number(row?.stock_qty ?? 0);
    if (!Number.isInteger(stock) || stock < 0 || stock > VARIANT_LIMITS.maxStock) {
      invalid(i, 'stock_qty', 'stock must be a whole number, 0 or more.', 'স্টক অবশ্যই ০ বা তার বেশি পূর্ণ সংখ্যা হতে হবে।');
    }

    // WHY never negative: retail is supplier price + markup, and the pool's and platform's shares
    // come out of that margin. The split engine prices the product, not each variant, so a variant
    // sold below the product's price would eat a margin nothing re-checks.
    const delta = Number(row?.price_delta ?? 0);
    if (!Number.isFinite(delta) || delta < 0 || delta > VARIANT_LIMITS.maxPriceDelta) {
      invalid(i, 'price_delta', 'the extra price must be 0 or more.', 'অতিরিক্ত দাম অবশ্যই ০ বা তার বেশি হতে হবে।');
    }

    const rawImage = row?.image_media_id;
    let imageMediaId: number | null = null;
    if (rawImage !== undefined && rawImage !== null && rawImage !== '') {
      imageMediaId = Number(rawImage);
      if (!Number.isSafeInteger(imageMediaId) || imageMediaId < 1) {
        invalid(i, 'image_media_id', 'pick one of the product photos.', 'প্রোডাক্টের ছবিগুলোর একটি বেছে নিন।');
      }
    }

    return {
      attributes,
      sku: skuRaw || null,
      price_delta: Math.round(delta * 100) / 100,
      stock_qty: stock,
      image_media_id: imageMediaId,
    };
  });
}

/**
 * Throws unless every chosen photo is one of the product's own (product_images).
 * WHY not "any photo the supplier uploaded": a photo that is not on the product never appears in
 * its gallery, so picking the variant would show an image the shopper cannot find again.
 */
export function assertVariantPhotos(wanted: VariantInput[], productMediaIds: number[]): void {
  const own = new Set(productMediaIds.map(Number));
  wanted.forEach((v, i) => {
    if (v.image_media_id != null && !own.has(v.image_media_id)) {
      invalid(i, 'image_media_id', 'that photo is not one of this product\'s photos.', 'এই ছবিটি এই প্রোডাক্টের ছবিগুলোর একটি নয়।');
    }
  });
}

/** A SKU for a row the supplier left blank: the product ref plus the combination, e.g. PRD-8F2K-M-RED. */
export function defaultSku(productRef: string, attributes: Record<string, string>): string {
  const latin = VARIANT_ATTRIBUTE_KEYS.map((k) => attributes[k]).filter(Boolean)
    .map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  // WHY a hash when a value lost letters: "লাল" and "নীল" both strip to nothing, so the readable
  // part alone would give two rows the same SKU. The hash is of the combination, so it is stable.
  const lossy = latin.some((p) => !p);
  let hash = 2166136261;
  for (const ch of comboKey(attributes)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
  const parts = [productRef, ...latin.filter(Boolean), ...(lossy ? [hash.toString(36).toUpperCase()] : [])];
  return parts.join('-').slice(0, VARIANT_LIMITS.maxSkuLength);
}

/**
 * Pairs the wanted list with the rows already stored. Pure.
 * Returns which rows to update (matched by combination, active or not), insert, and switch off.
 */
export function planVariantChanges(existing: any[], wanted: VariantInput[]) {
  const byCombo = new Map(existing.map((row) => [comboKey(row.attributes_json), row]));
  const keep = new Set<number>();
  const updates: Array<{ id: number; input: VariantInput }> = [];
  const inserts: VariantInput[] = [];
  for (const input of wanted) {
    const match = byCombo.get(comboKey(input.attributes));
    if (match) {
      keep.add(Number(match.id));
      updates.push({ id: Number(match.id), input });
    } else {
      inserts.push(input);
    }
  }
  const deactivate = existing.filter((row) => row.is_active && !keep.has(Number(row.id))).map((row) => Number(row.id));
  return { updates, inserts, deactivate };
}

const view = (row) => ({
  id: Number(row.id),
  sku: row.sku,
  attributes: row.attributes_json,
  price_delta: Number(row.price_delta),
  stock_qty: Number(row.stock_qty),
  image_media_id: row.image_id == null ? null : Number(row.image_id),
});

function inTransaction(db, fn) {
  return typeof db.connect === 'function' ? withTransaction(db, fn) : fn(db);
}

/**
 * Saves a product's whole variant list. The owner, or staff, only.
 * Writes one audit row with the active list before and after.
 */
export async function saveVariants(db, idOrRef, userId, rawVariants, isStaff = false) {
  const wanted = normalizeVariantInput(rawVariants);

  const key = String(idOrRef ?? '').trim();
  const product = /^\d+$/.test(key)
    ? await productRepo.getProductById(db, Number(key))
    : await productRepo.getProductByRef(db, key);
  if (!product) throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  if (!isStaff && Number(product.supplier_id) !== Number(userId)) {
    throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
  }
  const productId = Number(product.id);

  try {
    const result = await inTransaction(db, async (tx) => {
      const existing = await productRepo.lockVariantsForProduct(tx, productId);
      if (wanted.some((v) => v.image_media_id != null)) {
        assertVariantPhotos(wanted, await productRepo.getProductMediaIds(tx, productId));
      }
      const before = existing.filter((r) => r.is_active).map(view);
      const { updates, inserts, deactivate } = planVariantChanges(existing, wanted);

      await productRepo.deactivateVariants(tx, deactivate);
      const saved = [];
      for (const { id, input } of updates) {
        const current = existing.find((r) => Number(r.id) === id);
        saved.push(await productRepo.updateVariant(tx, id, {
          sku: input.sku || current.sku,
          priceDelta: input.price_delta,
          stockQty: input.stock_qty,
          imageId: input.image_media_id,
        }));
      }
      for (const input of inserts) {
        saved.push(await productRepo.insertVariant(tx, productId, {
          sku: input.sku || defaultSku(product.ref, input.attributes),
          attributes: input.attributes,
          priceDelta: input.price_delta,
          stockQty: input.stock_qty,
          imageId: input.image_media_id,
        }));
      }
      const totals = await productRepo.syncProductWithVariants(tx, productId);

      const after = saved.map(view).sort((a, b) => a.id - b.id);
      await writeAudit(tx, {
        action: 'catalog.product.variants.update',
        targetType: 'product',
        targetRef: product.ref,
        actorId: userId,
        before: { variants: before, stock_qty: Number(product.stock_qty), has_variants: !!product.has_variants },
        after: { variants: after, stock_qty: Number(totals?.stock_qty), has_variants: !!totals?.has_variants },
      });
      return { variants: after, stock_qty: Number(totals?.stock_qty), has_variants: !!totals?.has_variants };
    });
    return { product_ref: product.ref, ...result };
  } catch (err: any) {
    if (err?.code === '23505') {
      throw new AppError('CONFLICT', 'That SKU is already used by another variant.', 'এই SKU অন্য একটি ভ্যারিয়েন্টে ব্যবহার হচ্ছে।', { field: 'sku' });
    }
    throw err;
  }
}
