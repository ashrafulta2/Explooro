/**
 * creativeStudio.js — AI Creative Studio (Prompt 10.3 / `idea proposition.md` §W).
 *
 * Ad copy generation, product-description improvement, and a studio-background treatment for
 * product photos. Every output is a DRAFT — this module never writes to `products` or
 * `media_assets` itself. Applying a draft always goes through the already-audited, already
 * permission-checked endpoint for that resource (`PATCH /products/:id` for description text,
 * the existing media upload pipeline for a treated photo) — never a new AI-specific write path.
 *
 * Background treatment scope (documented, not hidden): this is a flat-canvas padding/matte
 * composite via `sharp` — real pixel work, deterministically applied — NOT subject segmentation
 * or true background *removal*. True cutout needs an ML segmentation model, which is outside the
 * approved dependency list (docs/dependency-ledger.md); Claude only picks the matte color/style
 * (grounded in the product's real category/title), sharp executes it. Same "model judges, code
 * computes" split used by demandForecast.js.
 */

import * as provider from './provider.js';
import * as productRepo from '../../repositories/product.repository.js';
import { getStorageDriver } from '../../integrations/storage/index.js';
import { processAndSaveMedia, applyFlatBackgroundMatte } from '../media.service.js';
import { AppError } from '../../plugins/errorHandler.js';

const FEATURE_KEY = 'creative';

const BACKGROUND_STYLES = ['STUDIO_WHITE', 'SOFT_NEUTRAL', 'BRAND_ACCENT'];
const STYLE_DEFAULT_HEX = {
  STUDIO_WHITE: '#ffffff',
  SOFT_NEUTRAL: '#f1f0ec',
  BRAND_ACCENT: '#0f4c3a',
};

function formatPrice(product) {
  return parseFloat(product.default_retail_price ?? 0).toFixed(0);
}

/** Loads the real product row an ad-copy/description/background request must be grounded in. */
async function loadGroundingProduct(db, productId, deps = {}) {
  const getProductById = deps.getProductById || productRepo.getProductById;
  const product = await getProductById(db, productId);
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }
  return product;
}

function adCopySystemPrompt(lang) {
  return `You are Explooro's marketing copywriter for a Bangladeshi social-commerce platform.
Write ONE short ad caption (2-3 sentences, suitable for WhatsApp/Facebook sharing) for the product
described in the user message. Rules:
1. Use ONLY the facts given (title, price, category) — never invent a discount, feature, or claim
   not present in the input.
2. Write in ${lang === 'bn' ? 'Bengali' : 'English'}.
3. End with a short call-to-action.
4. Output plain text only — no markdown, no quotes around the caption.`;
}

/** Generates a bilingual-ready ad caption grounded in the real product row. Draft only — never
 * posted anywhere automatically; the saler copies it into WhatsApp/Facebook/the flyer tool. */
export async function generateAdCopy(db, { userId, productId, lang = 'en', tone = 'friendly' }, deps = {}) {
  const generate = deps.generateCompletion || provider.generateCompletion;
  const product = await loadGroundingProduct(db, productId, deps);

  const title = lang === 'bn' ? product.title_bn : product.title_en;
  const prompt = `Product: ${title}\nCategory: ${product.category_name_en || 'General'}\nPrice: ৳${formatPrice(product)}\nTone: ${tone}\nWrite the caption now.`;

  const result = await generate(db, {
    userId,
    featureKey: FEATURE_KEY,
    system: adCopySystemPrompt(lang),
    prompt,
    maxTokens: 220,
  });

  const text = result.text || composeFallbackAdCopy(product, lang);
  return {
    draft_text: text.trim(),
    lang,
    product: { id: product.id, ref: product.ref, title, price: parseFloat(product.default_retail_price) },
    degraded: result.degraded,
    requires_approval: true,
  };
}

function composeFallbackAdCopy(product, lang) {
  const title = lang === 'bn' ? product.title_bn : product.title_en;
  const price = formatPrice(product);
  return lang === 'bn'
    ? `${title} মাত্র ৳${price} টাকায়! এখনই অর্ডার করুন।`
    : `Get ${title} for just ৳${price}! Order now.`;
}

function descriptionSystemPrompt(lang) {
  return `You are Explooro's product-copy editor. Improve the given product description for clarity,
persuasiveness, and scannability. Rules:
1. Never invent a spec, material, dimension, or claim not present in the input title/description.
2. Keep it to 3-5 short sentences or bullet-style lines.
3. Write in ${lang === 'bn' ? 'Bengali' : 'English'}.
4. Output plain text only.`;
}

/** Improves an existing product description. Draft only — the caller (a supplier who owns the
 * product) must explicitly apply it via the existing `PATCH /products/:id`, never auto-saved. */
export async function improveDescription(db, { userId, productId, lang = 'en' }, deps = {}) {
  const generate = deps.generateCompletion || provider.generateCompletion;
  const product = await loadGroundingProduct(db, productId, deps);

  const title = lang === 'bn' ? product.title_bn : product.title_en;
  const existing = (lang === 'bn' ? product.description_bn : product.description_en) || '(no description yet)';
  const prompt = `Title: ${title}\nBrand: ${product.brand || 'N/A'}\nCurrent description: ${existing}\nImprove it now.`;

  const result = await generate(db, {
    userId,
    featureKey: FEATURE_KEY,
    system: descriptionSystemPrompt(lang),
    prompt,
    maxTokens: 320,
  });

  const text = result.text || existing;
  return {
    draft_text: text.trim(),
    lang,
    field: lang === 'bn' ? 'description_bn' : 'description_en',
    product: { id: product.id, ref: product.ref, title },
    degraded: result.degraded,
    requires_approval: true,
  };
}

function backgroundSystemPrompt() {
  return `You pick a studio background treatment for an e-commerce product photo. Respond with ONLY
a JSON object: {"style": one of ${JSON.stringify(BACKGROUND_STYLES)}, "reasoning": "one short sentence"}.
No other text.`;
}

function parseBackgroundChoice(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    if (BACKGROUND_STYLES.includes(parsed.style)) {
      return { style: parsed.style, reasoning: String(parsed.reasoning || '').slice(0, 200) };
    }
  } catch {
    // fall through to default
  }
  return null;
}

/** Suggests which flat studio-background treatment fits this product, grounded in its real
 * category/title. The model only picks a style from a fixed enum — sharp does the actual pixels. */
export async function suggestBackgroundTreatment(db, { userId, productId, lang = 'en' }, deps = {}) {
  const generate = deps.generateCompletion || provider.generateCompletion;
  const product = await loadGroundingProduct(db, productId, deps);
  const title = lang === 'bn' ? product.title_bn : product.title_en;

  const result = await generate(db, {
    userId,
    featureKey: FEATURE_KEY,
    system: backgroundSystemPrompt(),
    prompt: `Product: ${title}\nCategory: ${product.category_name_en || 'General'}`,
    maxTokens: 100,
  });

  const choice = (!result.degraded && result.text && parseBackgroundChoice(result.text)) || {
    style: 'STUDIO_WHITE',
    reasoning: 'Default: a plain white matte works for most catalog photos.',
  };

  return {
    style: choice.style,
    background_hex: STYLE_DEFAULT_HEX[choice.style],
    reasoning: choice.reasoning,
    degraded: result.degraded,
  };
}

/**
 * Deterministically applies a flat-color matte around the product's primary photo (padding, not
 * segmentation — see module header) and saves the result as a new, separate media asset via the
 * existing, already-moderated upload pipeline. Returns the new asset; nothing is attached to the
 * product until the saler/supplier explicitly does so through the existing product-image flow.
 */
export async function applyBackgroundTreatment(db, { userId, productId, style, userRestrictions = [] }, deps = {}) {
  if (!BACKGROUND_STYLES.includes(style)) {
    throw new AppError('VALIDATION_FAILED', `Unknown background style: ${style}`, `অজানা ব্যাকগ্রাউন্ড স্টাইল: ${style}`);
  }
  const product = await loadGroundingProduct(db, productId, deps);

  const { rows: images } = await db.query(
    `SELECT m.storage_key, m.mime_type FROM product_images pi
     JOIN media_assets m ON m.id = pi.media_id
     WHERE pi.product_id = $1
     ORDER BY pi.is_primary DESC, pi.display_order ASC
     LIMIT 1`,
    [product.id]
  );
  if (images.length === 0) {
    throw new AppError('NOT_FOUND', 'This product has no photo to treat yet.', 'এই প্রোডাক্টের কোনো ছবি নেই।');
  }

  const driver = getStorageDriver();
  if (typeof driver.getObject !== 'function') {
    throw new AppError(
      'NOT_SUPPORTED',
      'Background treatment needs the local storage driver to read the source photo.',
      'ব্যাকগ্রাউন্ড পরিবর্তনের জন্য লোকাল স্টোরেজ ড্রাইভার প্রয়োজন।'
    );
  }
  const original = await driver.getObject({ key: images[0].storage_key });
  if (!original) {
    throw new AppError('NOT_FOUND', 'Source photo could not be read from storage.', 'মূল ছবিটি স্টোরেজ থেকে পড়া যায়নি।');
  }

  const hex = STYLE_DEFAULT_HEX[style];
  const matteFn = deps.applyFlatBackgroundMatte || applyFlatBackgroundMatte;
  const treatedBuffer = await matteFn(original.buffer, { backgroundHex: hex });

  const savedFn = deps.processAndSaveMedia || processAndSaveMedia;
  const asset = await savedFn(db, {
    userId,
    purpose: 'PRODUCT',
    buffer: treatedBuffer,
    userRestrictions,
  });

  return { asset, style, background_hex: hex, source_product_id: product.id };
}
