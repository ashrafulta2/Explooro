/**
 * PartnerScoreCard.ts — how well a shop partner promotes and sells, and what to do to improve it.
 *
 * Draws only what GET /saler/partner-score returns (server services/partnerScore.service.ts
 * toOwnView): the score, the band, the boost the band earns, the points each metric contributed and
 * the one metric with the most points left to win. The client never works out a score itself.
 *
 * It reuses the commission tier card's classes on purpose: the two cards sit together on the
 * dashboard and read as one family, and the stylesheet budget has no room for a copy.
 *
 * WHY no percentage per product anywhere on this card: a partner earns by promoting well, not by
 * picking the product with the highest percentage. The card shows how they are doing, not a rate.
 */
import { formatNumber, localizeDigits } from '../../services/format.ts';
import { t } from '../../services/i18n.ts';
import { esc } from './CommissionTierCard.ts';

const METRIC_ORDER = ['delivered_volume', 'return_rate', 'repeat_customers', 'new_customers', 'link_conversion', 'cancel_rate'];

type Figure = number | string;

export interface ScoreBand {
  key: string;
  min_score?: Figure;
}

export interface NextBand {
  key: string;
  min_score: Figure;
  points_needed?: Figure;
}

/** The `data` of GET /saler/partner-score (server services/partnerScore.service.ts toOwnView). */
export interface PartnerScoreData {
  /** null until the partner has enough orders (`is_new`). */
  score: Figure | null;
  band?: string;
  multiplier?: Figure;
  is_new?: boolean;
  bands: ScoreBand[];
  next_band?: NextBand | null;
  /** Metric → points earned out of the most it can give. */
  components?: Record<string, { earned: Figure; max: Figure }>;
  /** The one metric with the most points left to win. */
  focus?: { metric: string; points?: Figure } | null;
  min_sample_orders?: Figure;
  sample_orders?: Figure;
  window_days?: Figure;
}

const bandName = (key: string): string => t(`saler.partner_score.band_${String(key).toLowerCase()}`, String(key));
const metricName = (key: string): string => t(`saler.partner_score.metric_${key}`, key);

/** Pure. Whether the card should exist at all: the API answered with a score shape. */
export function isVisible(data: PartnerScoreData | null | undefined): data is PartnerScoreData {
  return Boolean(data) && Array.isArray(data.bands) && data.bands.length > 0;
}

/**
 * Pure. Percent of the way from the current band's floor to the next band, 0 to 100; 100 at the top.
 * WHY from the floor: a partner just above RISING should see a near-empty bar towards PRO, not one
 * already half full from the STARTER-to-RISING climb.
 */
export function progressPct(data: PartnerScoreData | null | undefined): number {
  if (data?.score === null || data?.score === undefined) return 0;
  if (!data.next_band) return 100;
  const floor = Number(data.bands?.find((b) => b.key === data.band)?.min_score) || 0;
  const span = Math.max(1, Number(data.next_band.min_score) - floor);
  return Math.min(100, Math.max(0, Math.round(((Number(data.score) - floor) / span) * 100)));
}

/**
 * "1.1" -> "×1.10" ("×১.১০" in Bengali); the boost is shown as a multiplier, never as a
 * per-product rate. Always two decimals so 1.1 and 1.15 line up as a ladder.
 */
export function boostLabel(multiplier: Figure | null | undefined): string {
  return `×${localizeDigits((Number(multiplier) || 1).toFixed(2))}`;
}

export function PartnerScoreCard({ data }: { data?: PartnerScoreData | null } = {}): HTMLElement | null {
  if (!isVisible(data)) return null;

  const card = document.createElement('section');
  card.className = 'commission-tier-card partner-score-card';
  card.setAttribute('aria-label', t('saler.partner_score.title', 'Your partner score'));

  if (data.is_new) {
    card.innerHTML = `
      <div class="commission-tier-card__head">
        <div>
          <span class="commission-tier-card__eyebrow">${esc(t('saler.partner_score.title', 'Your partner score'))}</span>
          <h3 class="commission-tier-card__tier">${esc(t('saler.partner_score.new_title', 'Just getting started'))}</h3>
        </div>
      </div>
      <p class="commission-tier-card__line">${esc(t('saler.partner_score.new_line', 'Get {{count}} orders through your store or links and your score appears here.', {
        count: formatNumber(Number(data.min_sample_orders) || 0),
      }))}</p>
      <p class="commission-tier-card__foot">${esc(t('saler.partner_score.new_progress', '{{done}} of {{count}} orders so far, counted over the last {{days}} days.', {
        done: formatNumber(Number(data.sample_orders) || 0),
        count: formatNumber(Number(data.min_sample_orders) || 0),
        days: formatNumber(Number(data.window_days) || 0),
      }))}</p>`;
    return card;
  }

  const pct = progressPct(data);
  const next = data.next_band;
  const headline = next
    ? t('saler.partner_score.to_next', 'Earn {{points}} more points to reach {{band}}.', {
        points: formatNumber(Number(next.points_needed) || 0),
        band: bandName(next.key),
      })
    : t('saler.partner_score.top', 'You are in the top band. Keep promoting to stay here.');

  const rows = METRIC_ORDER
    .filter((k) => data.components?.[k])
    .map((k) => {
      const c = data.components[k];
      return `
        <li class="commission-tier-card__step${data.focus?.metric === k ? ' is-current' : ''}">
          <span class="commission-tier-card__step-name">${esc(metricName(k))}</span>
          <span class="commission-tier-card__step-meta">${esc(formatNumber(c.earned))} / ${esc(formatNumber(c.max))}</span>
        </li>`;
    })
    .join('');

  const focus = data.focus
    ? `<p class="commission-tier-card__foot">${esc(t('saler.partner_score.focus', 'Biggest chance to improve: {{metric}}, worth up to {{points}} more points.', {
        metric: metricName(data.focus.metric),
        points: formatNumber(Number(data.focus.points) || 0),
      }))}</p>`
    : '';

  card.innerHTML = `
    <div class="commission-tier-card__head">
      <div>
        <span class="commission-tier-card__eyebrow">${esc(t('saler.partner_score.title', 'Your partner score'))}</span>
        <h3 class="commission-tier-card__tier">${esc(bandName(data.band))} · ${esc(formatNumber(Number(data.score)))}/${esc(formatNumber(100))}</h3>
      </div>
      <span class="commission-tier-card__bonus">${esc(t('saler.partner_score.boost', '{{boost}} earning boost', { boost: boostLabel(data.multiplier) }))}</span>
    </div>
    <div class="commission-tier-card__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
         aria-label="${esc(headline)}">
      <div class="commission-tier-card__fill" style="width: ${pct}%"></div>
    </div>
    <p class="commission-tier-card__line">${esc(headline)}</p>
    <ol class="commission-tier-card__ladder">${rows}</ol>
    ${focus}
    <p class="commission-tier-card__foot">${esc(t('saler.partner_score.foot', 'Based on {{count}} orders in the last {{days}} days. The boost applies to your commission once the platform switches it on.', {
      count: formatNumber(Number(data.sample_orders) || 0),
      days: formatNumber(Number(data.window_days) || 0),
    }))}</p>
  `;
  return card;
}
