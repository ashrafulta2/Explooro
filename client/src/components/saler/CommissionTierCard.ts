/**
 * CommissionTierCard.ts — where a shop partner stands on the earned commission ladder.
 *
 * Draws only what GET /saler/commission-tier returns (server services/salerTier.service.ts getSalerView):
 * the tier, the bonus it pays, the delivered volume in the window and the gap to the next tier.
 * The client never works out a tier or a bonus itself.
 *
 * Returns null while the platform has tiers switched off, so a shop partner is never shown a ladder that
 * pays nothing.
 */
import { formatCurrency, formatNumber } from '../../services/format.js';
import { t } from '../../services/i18n.js';

const TIER_ORDER = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

/** Figures arrive as numbers or as numeric strings (NUMERIC columns); the card converts with Number(). */
type Figure = number | string;

export interface TierLadderStep {
  tier: string;
  min_volume?: Figure;
  bonus_pct?: Figure;
}

export interface NextTier {
  tier: string;
  min_volume: Figure;
  bonus_pct?: Figure;
  /** Delivered volume still needed to reach it. */
  remaining?: Figure;
}

/** The `data` of GET /saler/commission-tier (server services/salerTier.service.ts getSalerView). */
export interface CommissionTierData {
  enabled: boolean;
  tier: string;
  bonus_pct?: Figure;
  volume?: Figure;
  window_days?: Figure;
  next?: NextTier | null;
  ladder?: TierLadderStep[];
}

function tierName(tier: string): string {
  return t(`saler.commission_tier.name_${String(tier).toLowerCase()}`, tier);
}

export const esc = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

/** Pure. Whether the card should exist at all: tiers on, and a tier the client knows. */
export function isVisible(data: CommissionTierData | null | undefined): data is CommissionTierData {
  return Boolean(data) && data.enabled === true && TIER_ORDER.includes(data.tier);
}

/**
 * Pure. Percent of the way from the current tier's floor to the next tier, 0 to 100; 100 at the top.
 * WHY from the floor: a shop partner just above SILVER should see a near-empty bar towards GOLD, not one
 * already half full from the BRONZE-to-SILVER climb.
 */
export function progressPct(data: CommissionTierData | null | undefined): number {
  if (!data?.next) return 100;
  const volume = Number(data.volume) || 0;
  const floor = Number(data.ladder?.find((l) => l.tier === data.tier)?.min_volume) || 0;
  const span = Math.max(1, Number(data.next.min_volume) - floor);
  return Math.min(100, Math.max(0, Math.round(((volume - floor) / span) * 100)));
}

/** Returns null when the platform has tiers off, so no ladder is shown that pays nothing. */
export function CommissionTierCard({ data }: { data?: CommissionTierData | null } = {}): HTMLElement | null {
  if (!isVisible(data)) return null;

  const volume = Number(data.volume) || 0;
  const next = data.next || null;
  const pct = progressPct(data);

  const card = document.createElement('section');
  card.className = 'commission-tier-card';
  card.setAttribute('aria-label', t('saler.commission_tier.title', 'Your commission tier'));

  const bonus = Number(data.bonus_pct) || 0;
  const headline = next
    ? t('saler.commission_tier.to_next', 'Sell {{amount}} more to reach {{tier}} (+{{bonus}}%)', {
        amount: formatCurrency(next.remaining),
        tier: tierName(next.tier),
        bonus: formatNumber(Number(next.bonus_pct) || 0),
      })
    : t('saler.commission_tier.top', 'You are on the top tier. Keep your sales up to stay here.');

  card.innerHTML = `
    <div class="commission-tier-card__head">
      <div>
        <span class="commission-tier-card__eyebrow">${esc(t('saler.commission_tier.title', 'Your commission tier'))}</span>
        <h3 class="commission-tier-card__tier">${esc(tierName(data.tier))}</h3>
      </div>
      <span class="commission-tier-card__bonus">${bonus > 0
        ? esc(t('saler.commission_tier.bonus', '+{{bonus}}% on every sale', { bonus: formatNumber(bonus) }))
        : esc(t('saler.commission_tier.no_bonus', 'Base commission'))}</span>
    </div>
    <div class="commission-tier-card__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
         aria-label="${esc(headline)}">
      <div class="commission-tier-card__fill" style="width: ${pct}%"></div>
    </div>
    <p class="commission-tier-card__line">${esc(headline)}</p>
    <ol class="commission-tier-card__ladder">
      ${(data.ladder || [])
        .map((l) => `
        <li class="commission-tier-card__step${l.tier === data.tier ? ' is-current' : ''}${TIER_ORDER.indexOf(l.tier) < TIER_ORDER.indexOf(data.tier) ? ' is-passed' : ''}">
          <span class="commission-tier-card__step-name">${esc(tierName(l.tier))}</span>
          <span class="commission-tier-card__step-meta">${l.tier === 'BRONZE'
            ? esc(t('saler.commission_tier.start', 'Start'))
            : esc(formatCurrency(l.min_volume))} · +${esc(formatNumber(Number(l.bonus_pct) || 0))}%</span>
        </li>`)
        .join('')}
    </ol>
    <p class="commission-tier-card__foot">${esc(t('saler.commission_tier.window', '{{amount}} delivered in the last {{days}} days. Returned and cancelled orders do not count.', {
      amount: formatCurrency(volume),
      days: formatNumber(Number(data.window_days) || 0),
    }))}</p>
  `;
  return card;
}
