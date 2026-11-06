/**
 * PartnerRewardCard.ts — this month's partner reward estimate on the Explooro partner dashboard.
 *
 * Draws only what GET /saler/partner-reward returns (server services/partnerReward.service.ts
 * getOwnView): the taka the partner's share would be if the month closed today, plus their last
 * payout. The client never scores anything itself.
 *
 * WHY only the amount (owner, 2026-11-02): the card used to show the score out of 100, the points on
 * each of the four factors, "you hold X% of a pool of ৳Y" and how the pool is shared. The owner
 * wants partners left curious about how rewards work, so it shows what they get and not why. The
 * API still sends the breakdown, and the admin page (/admin/growth/partner-rewards) draws it.
 *
 * It reuses the commission tier card's classes, as PartnerScoreCard does: the cards sit together on
 * the dashboard, and the stylesheet budget has no room for a copy.
 */
import { formatCurrency } from '../../services/format.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { esc } from './CommissionTierCard.ts';

export const FACTOR_ORDER = ['sales', 'social', 'community', 'activity'];

type Figure = number | string;

export interface RewardHistoryRow {
  /** `YYYY-MM-DD`, the first day of the month that was paid. */
  period_start: string;
  amount: Figure;
}

/** The `data` of GET /saler/partner-reward (server services/partnerReward.service.ts getOwnView). */
export interface PartnerRewardData {
  /** Factor → how many of the 100 points it is worth. */
  weights: Record<string, Figure>;
  /** Factor → the points this partner has on it. */
  points: Record<string, Figure>;
  /** Factor → the raw count behind those points. */
  values?: Record<string, Figure>;
  community_counts?: { posts?: Figure; likes?: Figure; comments?: Figure; saves?: Figure };
  score?: Figure;
  share_pct?: Figure;
  pool_estimate?: Figure;
  estimated_amount?: Figure;
  partners_scored?: Figure;
  /** `YYYY-MM-DD` the month closes on. */
  closes_on: string;
  period?: { start?: string };
  history?: RewardHistoryRow[];
}

/** Pure. Whether the card should exist at all: the API answered with a reward shape. */
export function isVisible(data: PartnerRewardData | null | undefined): data is PartnerRewardData {
  return Boolean(data) && Boolean(data.weights) && Boolean(data.points);
}

/** Pure. "2026-09-01" -> "September 2026" in the current language. */
export function monthLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat(getLanguage() === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function PartnerRewardCard({ data }: { data?: PartnerRewardData | null } = {}): HTMLElement | null {
  if (!isVisible(data)) return null;

  const card = document.createElement('section');
  card.className = 'commission-tier-card partner-reward-card';
  card.setAttribute('aria-label', t('saler.partner_reward.title'));

  const last = Array.isArray(data.history) && data.history[0]
    ? `<p class="commission-tier-card__foot">${esc(t('saler.partner_reward.last_payout', {
        month: monthLabel(data.history[0].period_start),
        amount: formatCurrency(Number(data.history[0].amount) || 0),
      }))}</p>`
    : '';

  card.innerHTML = `
    <div class="commission-tier-card__head">
      <div>
        <span class="commission-tier-card__eyebrow">${esc(t('saler.partner_reward.title'))} · ${esc(monthLabel(data.period?.start))}</span>
        <h3 class="commission-tier-card__tier">${esc(formatCurrency(Number(data.estimated_amount) || 0))}</h3>
      </div>
    </div>
    ${last}
  `;
  return card;
}
