/**
 * advertiseWizard.ts — the pure parts of the Boost wizard (pages/AdvertisePage.ts): the request it
 * sends and when a step may move on. No DOM and no stylesheet, so tests import it directly.
 */

export const STEPS = ['what', 'who', 'budget'];

export type WizardStep = (typeof STEPS)[number];

/** What the wizard has collected so far. */
export interface WizardState {
  /** What is being boosted: the store, a community post or a product. */
  kind: 'STORE' | 'POST' | 'PRODUCT' | string;
  postId?: number | string | null;
  productId?: number | string | null;
  headline: string;
  description: string;
  days: number | string;
  budget: number | string;
  /** True when the ad goes to everyone, so `audience` is not sent. */
  everyone: boolean;
  audience: Record<string, unknown>;
}

/** The server's price format for the boost product (`GET /ads/easy/options`). */
export interface BoostFormat {
  min_budget: number;
  min_days: number;
  max_days: number;
}

/** The audience estimate (`POST /ads/audience-estimate`). */
export interface AudienceEstimate {
  too_small?: boolean;
  [field: string]: unknown;
}

/** Pure. The request body for POST /ads/campaigns from the wizard's state. */
export function buildCampaignBody(state: WizardState) {
  const days = Number(state.days);
  const budget = Number(state.budget);
  const creative: { headline: string; description: string; community_post_id?: number | string | null; product_id?: number | string | null } = { headline: state.headline.trim(), description: state.description.trim() };
  if (state.kind === 'POST') creative.community_post_id = state.postId;
  if (state.kind === 'PRODUCT') creative.product_id = state.productId;
  return {
    ad_product_key: 'easy_boost',
    title: creative.headline,
    objective: 'TRAFFIC',
    total_budget: budget,
    // WHY spread evenly: a first-time advertiser picks "৳500 over 5 days"; spending it all on day one
    // would end the ad before most of the chosen audience opened the app.
    daily_budget: Math.round((budget / days) * 100) / 100,
    duration_days: days,
    creative,
    targeting: { audience: state.everyone ? {} : { ...state.audience } },
  };
}

/** Pure. Whether a step's required choices are made. */
export function stepComplete(step: WizardStep | string, state: WizardState, { estimate, format }: { estimate?: AudienceEstimate | null; format?: BoostFormat | null } = {}): boolean {
  if (step === 'what') {
    const picked = state.kind === 'STORE' || (state.kind === 'POST' && state.postId) || (state.kind === 'PRODUCT' && state.productId);
    return Boolean(picked && state.headline.trim());
  }
  if (step === 'who') return state.everyone || Boolean(estimate && !estimate.too_small);
  if (step === 'budget') {
    const b = Number(state.budget);
    const d = Number(state.days);
    return Boolean(format) && b >= format.min_budget && Number.isInteger(d) && d >= format.min_days && d <= format.max_days;
  }
  return false;
}
