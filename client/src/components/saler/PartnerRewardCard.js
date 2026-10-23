/**
 * PartnerRewardCard.js — this month's partner reward pool estimate on the shop partner dashboard.
 *
 * Draws only what GET /saler/partner-reward returns (server services/partnerReward.service.ts
 * getOwnView): the points the partner has on each of the four factors, their share of the pool and
 * the taka that share would be if the month closed today, plus their last payouts. The client never
 * scores anything itself.
 *
 * It reuses the commission tier card's classes, as PartnerScoreCard does: the cards sit together on
 * the dashboard, and the stylesheet budget has no room for a copy.
 */
import { formatCurrency, formatNumber } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';
import { esc } from './CommissionTierCard.js';

export const FACTOR_ORDER = ['sales', 'social', 'community', 'activity'];

/** Pure. Whether the card should exist at all: the API answered with a reward shape. */
export function isVisible(data) {
  return Boolean(data) && Boolean(data.weights) && Boolean(data.points);
}

/** Pure. The raw count behind a factor, in words ("3 delivered orders"). */
export function factorDetail(key, data) {
  const v = Number(data?.values?.[key]) || 0;
  const c = data?.community_counts || {};
  switch (key) {
    case 'sales': return t('saler.partner_reward.detail_sales', { count: formatNumber(v) });
    case 'social': return t('saler.partner_reward.detail_social', { count: formatNumber(v) });
    case 'community': return t('saler.partner_reward.detail_community', {
      posts: formatNumber(Number(c.posts) || 0),
      reactions: formatNumber((Number(c.likes) || 0) + (Number(c.comments) || 0) + (Number(c.saves) || 0)),
    });
    default: return t('saler.partner_reward.detail_activity', { count: formatNumber(v) });
  }
}

/** Pure. "2026-09-01" -> "September 2026" in the current language. */
export function monthLabel(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat(getLanguage() === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function dayLabel(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat(getLanguage() === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
}

/**
 * @param {object} props
 * @param {object} props.data  the `data` of GET /saler/partner-reward
 * @returns {HTMLElement|null}
 */
export function PartnerRewardCard({ data } = {}) {
  if (!isVisible(data)) return null;

  const card = document.createElement('section');
  card.className = 'commission-tier-card partner-reward-card';
  card.setAttribute('aria-label', t('saler.partner_reward.title'));

  const score = Number(data.score) || 0;
  const headline = score > 0
    ? t('saler.partner_reward.estimate_line', {
        share: formatNumber(Number(data.share_pct) || 0),
        pool: formatCurrency(Number(data.pool_estimate) || 0),
      })
    : t('saler.partner_reward.no_points_line');

  const rows = FACTOR_ORDER.map((k) => `
      <li class="commission-tier-card__step">
        <span class="commission-tier-card__step-name">${esc(t(`saler.partner_reward.factor_${k}`))} · <span class="text-muted">${esc(factorDetail(k, data))}</span></span>
        <span class="commission-tier-card__step-meta">${esc(formatNumber(Number(data.points?.[k]) || 0))} / ${esc(formatNumber(Number(data.weights?.[k]) || 0))}</span>
      </li>`).join('');

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
      <span class="commission-tier-card__bonus">${esc(t('saler.partner_reward.score', { score: formatNumber(score) }))}</span>
    </div>
    <p class="commission-tier-card__line">${esc(headline)}</p>
    <ol class="commission-tier-card__ladder">${rows}</ol>
    <p class="commission-tier-card__foot">${esc(t('saler.partner_reward.foot', {
      date: dayLabel(data.closes_on),
      count: formatNumber(Number(data.partners_scored) || 0),
    }))}</p>
    ${last}
  `;
  return card;
}
