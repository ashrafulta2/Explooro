/**
 * adAuction.service.js — Deterministic Second-Price Ad Auction Engine (Prompt 9.1).
 *
 * Implements:
 * 1. Second-Price Vickrey Auction:
 *    Winner pays (SecondRank / WinnerQualityScore) + 0.01 (bounded by winner's max bid and min reserve price).
 * 2. Quality Score (QS) Formula:
 *    QS = BaseRelevance * (1 + 5.0 * CTR) * (1 + SellerTierMultiplier)
 * 3. Ad Rank (AR):
 *    AR = MaxBid * QualityScore
 * 4. Budget Pacing:
 *    Spreads daily budget across 24-hour diurnal curve to prevent premature budget exhaustion.
 */

// Reserve minimum CPC price in BDT
export const MIN_RESERVE_PRICE = 1.00;

// Multipliers for seller trust tiers in quality scoring
export const TIER_MULTIPLIERS = {
  STARTER: 0.0,
  VERIFIED_TRADER: 0.15,
  ELITE_PARTNER: 0.30,
};

/**
 * Computes Base Relevance for a candidate ad given context.
 *
 * @param {Object} targeting - Campaign targeting JSON { categories: [], districts: [], keywords: [] }
 * @param {Object} context - Query context { keyword, categoryId, district }
 * @returns {number} relevance score (0.5 to 2.0)
 */
export function calculateBaseRelevance(targeting = {}, context = {}) {
  let score = 1.0;
  const { keywords = [], categories = [], districts = [] } = targeting;
  const { keyword = '', categoryId = null, district = '' } = context;

  // 1. Keyword match
  if (keyword && keywords.length > 0) {
    const normCtxKw = String(keyword).trim().toLowerCase();
    const exactMatch = keywords.some(k => String(k).trim().toLowerCase() === normCtxKw);
    const partialMatch = keywords.some(k => {
      const targetKw = String(k).trim().toLowerCase();
      return targetKw.includes(normCtxKw) || normCtxKw.includes(targetKw);
    });

    if (exactMatch) {
      score += 0.8;
    } else if (partialMatch) {
      score += 0.4;
    } else {
      score -= 0.2;
    }
  }

  // 2. Category match
  if (categoryId != null && categories.length > 0) {
    const catNum = Number(categoryId);
    if (categories.map(Number).includes(catNum)) {
      score += 0.4;
    } else {
      score -= 0.3;
    }
  }

  // 3. District match
  if (district && districts.length > 0) {
    const normDist = String(district).trim().toLowerCase();
    if (districts.some(d => String(d).trim().toLowerCase() === normDist)) {
      score += 0.3;
    } else {
      score -= 0.1;
    }
  }

  // Keep score bounded within [0.5, 2.5]
  return Math.max(0.5, Math.min(2.5, score));
}

/**
 * Computes Quality Score (QS) for an ad campaign.
 *
 * Formula:
 *   CTR = clicks / max(impressions, 100) (default 0.02 for cold-start)
 *   QS = BaseRelevance * (1 + 5.0 * CTR) * (1 + SellerTierMultiplier)
 *
 * @param {Object} campaign - Campaign with impressions_count, clicks_count, targeting_json
 * @param {string} sellerTier - 'STARTER' | 'VERIFIED_TRADER' | 'ELITE_PARTNER'
 * @param {Object} context - { keyword, categoryId, district }
 * @returns {number} Quality Score
 */
export function calculateQualityScore(campaign, sellerTier = 'STARTER', context = {}) {
  const baseRelevance = calculateBaseRelevance(campaign.targeting_json || {}, context);

  const impressions = Number(campaign.impressions_count) || 0;
  const clicks = Number(campaign.clicks_count) || 0;

  // Cold start baseline CTR = 2.0%
  const ctr = impressions >= 50 ? clicks / impressions : 0.02;

  const tierMultiplier = TIER_MULTIPLIERS[sellerTier] ?? 0.0;

  // WHY: Bounding CTR effect so clickbait cannot run away with 10x rank
  const effectiveCtr = Math.min(0.20, ctr);

  const qs = baseRelevance * (1.0 + (5.0 * effectiveCtr)) * (1.0 + tierMultiplier);
  return Number(qs.toFixed(4));
}

/**
 * Evaluates budget pacing to check if campaign should participate in this hour's auction.
 *
 * @param {Object} campaign - Campaign data { daily_budget, today_spent_amount, total_budget, spent_amount }
 * @param {Date} [now=new Date()]
 * @returns {{ allowed: boolean, reason?: string, pacingMultiplier?: number }}
 */
export function evaluateBudgetPacing(campaign, now = new Date()) {
  const dailyBudget = Number(campaign.daily_budget) || 0;
  const todaySpent = Number(campaign.today_spent_amount) || 0;
  const totalBudget = Number(campaign.total_budget) || 0;
  const totalSpent = Number(campaign.spent_amount) || 0;

  // Hard stop at total budget cap
  if (totalSpent >= totalBudget) {
    return { allowed: false, reason: 'TOTAL_BUDGET_EXHAUSTED' };
  }

  // Hard stop at daily budget cap
  if (todaySpent >= dailyBudget) {
    return { allowed: false, reason: 'DAILY_BUDGET_EXHAUSTED' };
  }

  // Pacing: Diurnal schedule over 24 hours
  const currentHour = now.getHours(); // 0 to 23
  const expectedFraction = (currentHour + 1) / 24;
  const currentFraction = dailyBudget > 0 ? todaySpent / dailyBudget : 0;

  // If already spent significantly ahead of the diurnal curve (> 1.5x expected fraction and >= 50% spent before mid-day)
  if (currentHour < 18 && currentFraction > (expectedFraction * 1.5) && currentFraction > 0.4) {
    // Throttle low-budget campaigns slightly to reserve spend for evening peak
    const paceFactor = expectedFraction / currentFraction;
    return { allowed: true, pacingMultiplier: Math.max(0.7, paceFactor) };
  }

  return { allowed: true, pacingMultiplier: 1.0 };
}

/**
 * Runs a deterministic Second-Price Auction for a set of candidate campaigns.
 *
 * Algorithm:
 * 1. Filter out campaigns exceeding budget cap or failed pacing.
 * 2. Calculate Quality Score (QS) for each candidate.
 * 3. Calculate Ad Rank (AR = Bid * QS * PacingMultiplier).
 * 4. Sort descending by AR.
 * 5. Determine winning CPC for each allocated slot (up to maxSlots):
 *    Winning CPC = min(Winner.Bid, max(MIN_RESERVE_PRICE, (RunnerUp.AR / Winner.QS) + 0.01))
 *
 * @param {Array<Object>} candidates - List of candidate campaign objects
 * @param {Object} context - { placement, categoryId, district, keyword, maxSlots }
 * @param {Date} [now=new Date()]
 * @returns {Array<Object>} Winners with calculated rank, quality score, and charged CPC
 */
export function runSecondPriceAuction(candidates = [], context = {}, now = new Date()) {
  const maxSlots = context.maxSlots || 3;

  // 1. Evaluate pacing and compute ranks
  const eligible = [];

  for (const c of candidates) {
    const pacing = evaluateBudgetPacing(c, now);
    if (!pacing.allowed) continue;

    const sellerTier = c.seller_tier || c.tier || 'STARTER';
    const qs = calculateQualityScore(c, sellerTier, context);
    const bid = Number(c.bid_amount) || MIN_RESERVE_PRICE;
    const rank = Number((bid * qs * (pacing.pacingMultiplier || 1.0)).toFixed(4));

    eligible.push({
      ...c,
      qualityScore: qs,
      rawBid: bid,
      adRank: rank,
      pacingMultiplier: pacing.pacingMultiplier || 1.0,
    });
  }

  // 2. Sort candidates descending by Ad Rank (tie-break by earlier created_at / campaign id)
  eligible.sort((a, b) => {
    if (b.adRank !== a.adRank) return b.adRank - a.adRank;
    return (a.id || 0) - (b.id || 0);
  });

  // 3. Select winners and compute second-price CPC
  const winners = [];
  const slotCount = Math.min(maxSlots, eligible.length);

  for (let i = 0; i < slotCount; i++) {
    const winner = eligible[i];
    const runnerUp = eligible[i + 1];

    let chargedCpc = MIN_RESERVE_PRICE;

    if (runnerUp && winner.qualityScore > 0) {
      // Second price formula: (RunnerUp Rank / Winner QS) + 0.01
      const calculatedPrice = (runnerUp.adRank / winner.qualityScore) + 0.01;
      chargedCpc = Math.min(winner.rawBid, Math.max(MIN_RESERVE_PRICE, calculatedPrice));
    } else {
      // No runner up — pay reserve price or max bid if reserve is higher
      chargedCpc = Math.min(winner.rawBid, MIN_RESERVE_PRICE);
    }

    winners.push({
      campaignId: winner.id,
      campaignRef: winner.ref,
      creativeId: winner.creative_id || winner.creative?.id,
      userId: winner.user_id,
      productId: winner.product_id,
      title: winner.title,
      headline: winner.headline,
      description: winner.description,
      bannerImageUrl: winner.banner_image_url,
      callToAction: winner.call_to_action || 'SHOP_NOW',
      destinationUrl: winner.destination_url,
      product: winner.product || null,
      placement: winner.placement,
      bidAmount: winner.rawBid,
      qualityScore: winner.qualityScore,
      adRank: winner.adRank,
      chargedCpc: Number(chargedCpc.toFixed(2)),
      slotPosition: i + 1,
    });
  }

  return winners;
}
