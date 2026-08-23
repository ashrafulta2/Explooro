/**
 * reviewIntegrity.js — Fake-Review Detection (Prompt 10.3 / `idea proposition.md` §Z).
 *
 * docs/prompt.md REQUIREMENT 3: scoring on text patterns, velocity, reviewer history, and purchase
 * verification, producing "a moderation flag with a confidence score — a human always decides."
 *
 * The score itself is a deterministic, rule-based sum — no model call — for the same reason
 * demandForecast.js keeps its arithmetic out of the LLM: a fake-review score has to be reproducible
 * and explainable to a moderator, not subject to sampling variance. Claude is used only, optionally,
 * to phrase a one-line explanation of already-computed signals for the moderator's benefit; it never
 * decides the score or the outcome. A flagged review is submitted to the existing Prompt 7.4
 * `moderation_queue` (item_type REVIEW) — never auto-deleted or auto-hidden.
 */

import * as provider from './provider.js';
import { submitToQueue } from '../moderation.service.js';

const FEATURE_KEY = 'review_integrity';
export const FLAG_THRESHOLD = 55; // integrity_score below this → sent to moderation

// Mirrors the shape moderation.service.js's own preScreenContent flags use, so a review flag
// renders identically to a product flag in the existing moderation queue UI (Prompt 7.4).
const SIGNAL_LABELS = {
  VERY_SHORT_BODY: { severity: 'LOW', label_en: 'Review body is very short', label_bn: 'রিভিউর লেখা খুবই সংক্ষিপ্ত' },
  GENERIC_TEMPLATE_PHRASE: { severity: 'MEDIUM', label_en: 'Reads like a generic template phrase', label_bn: 'সাধারণ টেমপ্লেট বাক্যের মতো মনে হচ্ছে' },
  EXCESSIVE_PUNCTUATION: { severity: 'LOW', label_en: 'Excessive exclamation marks', label_bn: 'অতিরিক্ত বিস্ময়বোধক চিহ্ন' },
  RATING_TEXT_MISMATCH: { severity: 'HIGH', label_en: 'Rating and review text sentiment disagree', label_bn: 'রেটিং ও রিভিউর লেখার মধ্যে অসামঞ্জস্য' },
  DUPLICATE_BODY_TEXT: { severity: 'HIGH', label_en: 'Identical text found in another review', label_bn: 'অন্য একটি রিভিউতে একই লেখা পাওয়া গেছে' },
  REVIEWER_BURST: { severity: 'MEDIUM', label_en: 'Same reviewer posted 3+ reviews in 24 hours', label_bn: 'একই রিভিউয়ার ২৪ ঘণ্টায় ৩টির বেশি রিভিউ দিয়েছেন' },
  PRODUCT_REVIEW_BURST: { severity: 'MEDIUM', label_en: 'This product got 5+ reviews within an hour', label_bn: 'এই পণ্যে এক ঘণ্টায় ৫টির বেশি রিভিউ এসেছে' },
  NEW_ACCOUNT: { severity: 'LOW', label_en: 'Reviewer account is less than 3 days old', label_bn: 'রিভিউয়ারের অ্যাকাউন্ট ৩ দিনের কম পুরনো' },
};

function toAutoFlag(signal) {
  const meta = SIGNAL_LABELS[signal.code] || { severity: 'LOW', label_en: signal.code, label_bn: signal.code };
  return { code: signal.code, ...meta };
}

const GENERIC_PHRASES = [
  'great product', 'excellent product', 'highly recommend', 'best product ever',
  'good quality', 'worth it', 'five stars', 'nice product', 'good product',
];
const POSITIVE_WORDS = ['love', 'great', 'excellent', 'amazing', 'perfect', 'best', 'good'];
const NEGATIVE_WORDS = ['bad', 'terrible', 'worst', 'broken', 'awful', 'poor', 'disappointing'];

function textPatternSignals(review) {
  const signals = [];
  const body = (review.body || '').trim();
  const lower = body.toLowerCase();

  if (body.length > 0 && body.length < 12) {
    signals.push({ code: 'VERY_SHORT_BODY', penalty: 10 });
  }
  const genericHits = GENERIC_PHRASES.filter((p) => lower.includes(p)).length;
  if (genericHits > 0 && body.length < 60) {
    signals.push({ code: 'GENERIC_TEMPLATE_PHRASE', penalty: 15 });
  }
  const exclaims = (body.match(/!/g) || []).length;
  if (exclaims >= 3) {
    signals.push({ code: 'EXCESSIVE_PUNCTUATION', penalty: 8 });
  }

  const hasPositive = POSITIVE_WORDS.some((w) => lower.includes(w));
  const hasNegative = NEGATIVE_WORDS.some((w) => lower.includes(w));
  if (review.rating >= 4 && hasNegative && !hasPositive) {
    signals.push({ code: 'RATING_TEXT_MISMATCH', penalty: 25 });
  }
  if (review.rating <= 2 && hasPositive && !hasNegative) {
    signals.push({ code: 'RATING_TEXT_MISMATCH', penalty: 25 });
  }

  return signals;
}

/** Same review body posted verbatim elsewhere on the platform — a strong copy/paste signal. */
async function duplicateBodySignal(db, review) {
  if (!review.body || review.body.trim().length < 15) return [];
  const { rows } = await db.query(
    `SELECT id FROM reviews WHERE body = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
    [review.body, review.id]
  );
  return rows.length > 0 ? [{ code: 'DUPLICATE_BODY_TEXT', penalty: 30 }] : [];
}

/** Same reviewer posting many reviews in a short window — a burst/farm signal. */
async function velocitySignals(db, review) {
  const signals = [];
  const { rows: userRows } = await db.query(
    `SELECT count(*)::int AS n FROM reviews
     WHERE user_id = $1 AND id <> $2 AND created_at >= now() - interval '24 hours'`,
    [review.user_id, review.id]
  );
  if ((userRows[0]?.n || 0) >= 3) {
    signals.push({ code: 'REVIEWER_BURST', penalty: 20 });
  }

  const { rows: productRows } = await db.query(
    `SELECT count(*)::int AS n FROM reviews
     WHERE product_id = $1 AND id <> $2 AND created_at >= now() - interval '1 hour'`,
    [review.product_id, review.id]
  );
  if ((productRows[0]?.n || 0) >= 5) {
    signals.push({ code: 'PRODUCT_REVIEW_BURST', penalty: 15 });
  }
  return signals;
}

/** A brand-new account with little history reviewing immediately is a weaker signal than an
 * established one — cheap to fabricate, so it costs less trust than a duplicate/velocity hit. */
async function reviewerHistorySignal(db, review) {
  const { rows } = await db.query(`SELECT created_at FROM users WHERE id = $1`, [review.user_id]);
  const createdAt = rows[0]?.created_at;
  if (!createdAt) return [];
  const accountAgeDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return accountAgeDays < 3 ? [{ code: 'NEW_ACCOUNT', penalty: 12 }] : [];
}

/**
 * Scores one already-inserted review 0-100 (higher = more trustworthy) from real signals: text
 * patterns, exact-duplicate text, reviewer/product velocity, and reviewer account age. Purchase
 * verification is not scored here because `reviews.order_item_id` is NOT NULL and FK-enforced
 * (006_catalog.sql/008_orders_minimal.sql) — every row already IS a verified purchase by
 * construction; there is nothing left to check.
 */
export async function scoreReview(db, review, deps = {}) {
  const dupFn = deps.duplicateBodySignal || duplicateBodySignal;
  const velFn = deps.velocitySignals || velocitySignals;
  const histFn = deps.reviewerHistorySignal || reviewerHistorySignal;

  const signals = [
    ...textPatternSignals(review),
    ...(await dupFn(db, review)),
    ...(await velFn(db, review)),
    ...(await histFn(db, review)),
  ];

  const score = Math.max(0, 100 - signals.reduce((sum, s) => sum + s.penalty, 0));
  return { score, signals };
}

function explainSystemPrompt(lang) {
  return `You explain to a content moderator, in one short sentence, why a review was flagged for
review integrity, using ONLY the given signal codes. Never invent a reason not in the list. Reply in
${lang === 'bn' ? 'Bengali' : 'English'}.`;
}

function fallbackExplanation(signals, lang) {
  const codes = signals.map((s) => s.code).join(', ');
  return lang === 'bn' ? `সন্দেহজনক লক্ষণ: ${codes}` : `Suspicious signals: ${codes}`;
}

/**
 * Scores a freshly-submitted review and, if it falls below FLAG_THRESHOLD, pushes it into the
 * existing moderation queue (never auto-deletes/auto-hides — a human always decides) and persists
 * the score onto the review row. Called from review.service.js right after insertReview.
 */
export async function evaluateAndFlag(db, { userId, review, lang = 'en' }, deps = {}) {
  const generate = deps.generateCompletion || provider.generateCompletion;
  const submit = deps.submitToQueue || submitToQueue;

  const { score, signals } = await scoreReview(db, review, deps);

  await db.query(`UPDATE reviews SET integrity_score = $2 WHERE id = $1`, [review.id, score]);

  const flagged = score < FLAG_THRESHOLD;
  if (!flagged) {
    return { score, signals, flagged: false };
  }

  let explanation = fallbackExplanation(signals, lang);
  if (signals.length > 0) {
    const result = await generate(db, {
      userId,
      featureKey: FEATURE_KEY,
      system: explainSystemPrompt(lang),
      prompt: `Signals: ${JSON.stringify(signals.map((s) => s.code))}`,
      maxTokens: 100,
    });
    if (!result.degraded && result.text) explanation = result.text.trim();
  }

  await submit(db, {
    itemType: 'REVIEW',
    entityId: review.id,
    submittedBy: review.user_id,
    payloadSnapshot: {
      title: review.title,
      body: review.body,
      rating: review.rating,
      integrity_score: score,
      signals,
      explanation,
    },
    extraAutoFlags: signals.map(toAutoFlag),
  });

  return { score, signals, flagged: true, explanation };
}
