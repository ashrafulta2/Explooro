/**
 * SponsoredSlot.ts — Viewability-Gated Sponsored Ad Component (Prompt 9.1).
 *
 * Requirements:
 * 1. Prominent "Sponsored" / "স্পন্সর্ড" badge per regulatory & trust standards.
 * 2. Fully hidden when `sponsored_ads` module is disabled or when no ad won the auction.
 * 3. Viewability-based impression beacon (fires only when element is >= 50% in viewport for >= 1s).
 * 4. Fraud-safe click dispatch and seamless navigation.
 * 5. Multiple responsive display formats: 'card' | 'banner' | 'feed'.
 */

import { appStore } from '../../state/appStore.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { isFeatureEnabled } from '../../services/featureFlags.ts';
import { api } from '../../core/api.ts';

/** A winning ad, in the shape the auction and the reserved placements both produce. */
export interface SponsoredAdData {
  campaignId: number | string;
  creativeId?: number | string | null;
  headline?: string;
  description?: string;
  bannerImageUrl?: string;
  callToAction?: string;
  destinationUrl?: string;
  productId?: number | string | null;
  chargedCpc?: number | string;
  title?: string;
  product?: Record<string, unknown>;
  [field: string]: unknown;
}

export interface SponsoredSlotOptions {
  ad?: SponsoredAdData | null;
  variant?: 'card' | 'banner' | 'feed' | string;
  placement?: string;
  onAdClick?: ((ad: SponsoredAdData) => void) | null;
}

export class SponsoredSlot {
  ad: SponsoredAdData | null;
  variant: string;
  placement: string;
  onAdClick: SponsoredSlotOptions['onAdClick'];
  element: HTMLElement | null;
  observer: IntersectionObserver | null;
  viewabilityTimer: ReturnType<typeof setTimeout> | null;
  impressionRecorded: boolean;
  unsubscribeStore: (() => void) | null;

  /**
   * @param {Object} options
   * @param {Object} options.ad - Ad object returned from auction { campaignId, creativeId, headline, description, bannerImageUrl, callToAction, destinationUrl, chargedCpc, product }
   * @param {'card'|'banner'|'feed'} [options.variant='card'] - Layout variant
   * @param {string} [options.placement='SEARCH_RESULTS']
   * @param {Function} [options.onAdClick]
   */
  constructor({ ad = null, variant = 'card', placement = 'SEARCH_RESULTS', onAdClick = null }: SponsoredSlotOptions = {}) {
    this.ad = ad;
    this.variant = variant;
    this.placement = placement;
    this.onAdClick = onAdClick;
    this.element = null;
    this.observer = null;
    this.viewabilityTimer = null;
    this.impressionRecorded = false;
    this.unsubscribeStore = null;
  }

  render() {
    // 1. Module Gate: Check if sponsored_ads module is enabled
    const isAdsEnabled = isFeatureEnabled('sponsored_ads');
    if (!isAdsEnabled || !this.ad) {
      const emptySpan = document.createElement('span');
      emptySpan.style.display = 'none';
      this.element = emptySpan;
      return emptySpan;
    }

    const lang = getLanguage();
    const ad = this.ad;
    const isBn = lang === 'bn';

    const container = document.createElement('div');
    container.className = `sponsored-slot sponsored-slot--${this.variant}`;
    container.dataset.campaignId = String(ad.campaignId);
    container.dataset.placement = this.placement;

    // Build markup based on variant
    if (this.variant === 'banner') {
      container.innerHTML = `
        <div class="sponsored-banner-card">
          <div class="sponsored-banner-badge">
            <span class="sponsored-tag" aria-label="${isBn ? 'বিজ্ঞাপন' : 'Advertisement'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              ${isBn ? 'স্পন্সর্ড' : 'Sponsored'}
            </span>
          </div>
          <div class="sponsored-banner-content">
            <div class="sponsored-banner-text">
              <h3 class="sponsored-banner-headline">${this._escapeHtml(ad.headline || ad.title)}</h3>
              ${ad.description ? `<p class="sponsored-banner-desc">${this._escapeHtml(ad.description)}</p>` : ''}
            </div>
            ${ad.bannerImageUrl ? `
              <div class="sponsored-banner-media">
                <img src="${this._escapeHtml(ad.bannerImageUrl)}" alt="${this._escapeHtml(ad.headline)}" class="sponsored-banner-img" loading="lazy" />
              </div>
            ` : ''}
          </div>
          <div class="sponsored-banner-footer">
            <button type="button" class="btn btn--primary btn--sm sponsored-cta-btn">
              ${this._formatCta(ad.callToAction, isBn)} →
            </button>
          </div>
        </div>
      `;
    } else {
      // 'card' or 'feed' format: the same footprint as a ProductCard, so it can sit in a product grid.
      container.innerHTML = this._cardMarkup(ad);
      this._wireCard(container);
    }

    // Attach click listener (the "why this ad" button handles its own clicks and stops them here)
    container.addEventListener('click', (e) => {
      e.preventDefault();
      this._handleClick();
    });
    container.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === container) {
        e.preventDefault();
        this._handleClick();
      }
    });

    this.element = container;

    // Initialize Viewability IntersectionObserver (>= 50% visible for >= 1 second)
    this._setupViewabilityObserver(container);

    // Subscribe to store so disabling sponsored_ads module dynamically hides slot
    this.unsubscribeStore = appStore.subscribe(() => {
      const active = isFeatureEnabled('sponsored_ads');
      if (!active && this.element) {
        this.element.style.display = 'none';
      } else if (active && this.element) {
        this.element.style.display = '';
      }
    });

    return container;
  }

  /**
   * Tracks viewability: element must be >= 50% in viewport for 1 full second continuously.
   */
  _setupViewabilityObserver(element: Element) {
    if (typeof IntersectionObserver === 'undefined' || !this.ad) return;

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!this.viewabilityTimer && !this.impressionRecorded) {
            this.viewabilityTimer = setTimeout(() => {
              this._recordViewableImpression();
            }, 1000); // 1-second viewability threshold
          }
        } else {
          // Left view before 1 second -> cancel timer
          if (this.viewabilityTimer) {
            clearTimeout(this.viewabilityTimer);
            this.viewabilityTimer = null;
          }
        }
      }
    }, { threshold: [0.5] });

    this.observer.observe(element);
  }

  async _recordViewableImpression() {
    if (this.impressionRecorded || !this.ad) return;
    this.impressionRecorded = true;

    try {
      await api.post('/ads/impressions', {
        campaign_id: this.ad.campaignId,
        creative_id: this.ad.creativeId,
        placement: this.placement,
        viewable: true,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  async _handleClick() {
    if (!this.ad) return;

    // 1. Dispatch click beacon & billing
    try {
      await api.post('/ads/clicks', {
        campaign_id: this.ad.campaignId,
        creative_id: this.ad.creativeId,
        charged_cpc: this.ad.chargedCpc,
      });
    } catch {
      // Proceed to navigation even if tracking endpoint errors
    }

    if (this.onAdClick) {
      this.onAdClick(this.ad);
    }

    // 2. Navigate to destination URL
    const dest = this.ad.destinationUrl || (this.ad.productId ? `/product/${this.ad.productId}` : '/');
    if (dest.startsWith('http://') || dest.startsWith('https://')) {
      window.open(dest, '_blank', 'noopener,noreferrer');
    } else {
      window.location.pathname = dest;
    }
  }

  /**
   * The product-card ad. Every line past the title is optional and only drawn when the ad carries
   * it: shop name, rating, a struck-through price with its saving. Those are what make a shopper
   * want to open a card, so the ad shows them exactly as an organic card would.
   */
  _cardMarkup(ad: SponsoredAdData): string {
    const product = (ad.product || {}) as Record<string, any>;
    const esc = (v: unknown) => this._escapeHtml(v);
    const title = ad.headline || ad.title || product.title_en || '';
    const imgUrl = ad.bannerImageUrl || product.thumbnail_url || product.primary_image_url || product.main_image || '';

    const price = Number(product.special_price || product.default_retail_price || product.price || 0);
    const was = Number(product.compare_at_price || (product.special_price ? product.price : 0) || 0);
    const offPct = was > price && price > 0 ? Math.round(((was - price) / was) * 100) : 0;
    const money = (n: number) => `৳${n.toLocaleString(getLanguage() === 'bn' ? 'bn-BD' : 'en-US')}`;

    const shop = product.shop_name || product.store?.shop_name || '';
    const rating = Number(product.avg_rating ?? product.rating ?? 0);
    const reviews = Number(product.review_count ?? 0);
    const meta = [
      shop ? `<span class="sponsored-card-shop">${esc(shop)}</span>` : '',
      rating > 0
        ? `<span class="sponsored-card-rating" ${reviews ? `title="${esc(t('ads.slot.reviews', { count: reviews }))}"` : ''}><span aria-hidden="true">★</span> ${rating.toFixed(1)}${reviews ? ` <span class="sponsored-card-reviews">(${reviews})</span>` : ''}</span>`
        : '',
    ].filter(Boolean).join('');

    const media = imgUrl
      ? `<img src="${esc(imgUrl)}" alt="${esc(title)}" class="sponsored-card-img" loading="lazy" />`
      : '';

    return `
      <article class="sponsored-product-card">
        <div class="sponsored-card-image-wrap${imgUrl ? '' : ' is-empty'}">
          ${media}
          <span class="sponsored-tag" aria-label="${esc(t('ads.slot.aria_label'))}">${esc(t('ads.sponsored'))}</span>
          <button type="button" class="sponsored-why" aria-expanded="false" aria-label="${esc(t('ads.slot.why_label'))}" title="${esc(t('ads.slot.why_label'))}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          </button>
        </div>
        <div class="sponsored-card-body">
          <h4 class="sponsored-card-title">${esc(title)}</h4>
          ${meta ? `<p class="sponsored-card-meta">${meta}</p>` : ad.description ? `<p class="sponsored-card-desc">${esc(ad.description)}</p>` : ''}
          ${price > 0 ? `
            <div class="sponsored-card-price">
              <span>${money(price)}</span>
              ${offPct ? `<s class="sponsored-card-was">${money(was)}</s><span class="sponsored-card-off">${esc(t('ads.slot.off', { pct: offPct }))}</span>` : ''}
            </div>` : ''}
          <p class="sponsored-why-note" hidden>${esc(t('ads.slot.why_text'))}</p>
          <span class="btn btn--primary btn--sm sponsored-cta-btn">${esc(this._formatCta(ad.callToAction))}</span>
        </div>
      </article>
    `;
  }

  /** Card behaviour: the whole card is one link-like target, and a broken image falls back cleanly. */
  _wireCard(container: HTMLElement) {
    container.tabIndex = 0;
    container.setAttribute('role', 'link');

    const img = container.querySelector<HTMLImageElement>('.sponsored-card-img');
    img?.addEventListener('error', () => {
      // WHY: a dead image URL otherwise leaves a square of alt text, the "broken ad" look.
      img.parentElement?.classList.add('is-empty');
      img.remove();
    }, { once: true });

    const why = container.querySelector<HTMLButtonElement>('.sponsored-why');
    const note = container.querySelector<HTMLElement>('.sponsored-why-note');
    why?.addEventListener('click', (e) => {
      // WHY stopPropagation: opening the explanation is not a click on the ad, so it must not bill.
      e.stopPropagation();
      e.preventDefault();
      if (!note) return;
      note.hidden = !note.hidden;
      why.setAttribute('aria-expanded', String(!note.hidden));
    });
  }

  _formatCta(ctaKey = 'SHOP_NOW', isBn?: boolean): string {
    if (isBn === undefined) {
      const keys = { SHOP_NOW: 'cta_shop_now', LEARN_MORE: 'cta_learn_more', GET_OFFER: 'cta_get_offer', VIEW_PRODUCT: 'cta_view_product' };
      return t(`ads.slot.${keys[ctaKey] || 'cta_shop_now'}`);
    }
    const ctas = {
      SHOP_NOW: isBn ? 'এখনই কিনুন' : 'Shop Now',
      LEARN_MORE: isBn ? 'বিস্তারিত দেখুন' : 'Learn More',
      GET_OFFER: isBn ? 'অফার নিন' : 'Get Offer',
      VIEW_PRODUCT: isBn ? 'পণ্য দেখুন' : 'View Product',
    };
    return ctas[ctaKey] || (isBn ? 'এখনই কিনুন' : 'Shop Now');
  }

  _escapeHtml(str?: unknown): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.viewabilityTimer) {
      clearTimeout(this.viewabilityTimer);
      this.viewabilityTimer = null;
    }
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
  }
}
