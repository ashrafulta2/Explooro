/**
 * SponsoredSlot.js — Viewability-Gated Sponsored Ad Component (Prompt 9.1).
 *
 * Requirements:
 * 1. Prominent "Sponsored" / "স্পন্সর্ড" badge per regulatory & trust standards.
 * 2. Fully hidden when `sponsored_ads` module is disabled or when no ad won the auction.
 * 3. Viewability-based impression beacon (fires only when element is >= 50% in viewport for >= 1s).
 * 4. Fraud-safe click dispatch and seamless navigation.
 * 5. Multiple responsive display formats: 'card' | 'banner' | 'feed'.
 */

import { appStore } from '../../state/appStore.js';
import { t, getLanguage } from '../../services/i18n.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { api } from '../../core/api.js';

export class SponsoredSlot {
  /**
   * @param {Object} options
   * @param {Object} options.ad - Ad object returned from auction { campaignId, creativeId, headline, description, bannerImageUrl, callToAction, destinationUrl, chargedCpc, product }
   * @param {'card'|'banner'|'feed'} [options.variant='card'] - Layout variant
   * @param {string} [options.placement='SEARCH_RESULTS']
   * @param {Function} [options.onAdClick]
   */
  constructor({ ad = null, variant = 'card', placement = 'SEARCH_RESULTS', onAdClick = null } = {}) {
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
    container.dataset.campaignId = ad.campaignId;
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
            <button type="button" class="btn btn-primary btn-sm sponsored-cta-btn">
              ${this._formatCta(ad.callToAction, isBn)} →
            </button>
          </div>
        </div>
      `;
    } else {
      // 'card' or 'feed' format
      const product = ad.product || {};
      const imgUrl = ad.bannerImageUrl || product.thumbnail_url || product.primary_image_url || '/placeholder.png';
      const priceFormatted = product.default_retail_price ? `৳${Number(product.default_retail_price).toLocaleString('en-US')}` : '';

      container.innerHTML = `
        <div class="sponsored-product-card">
          <div class="sponsored-card-header">
            <span class="sponsored-tag" aria-label="${isBn ? 'বিজ্ঞাপন' : 'Advertisement'}">
              ${isBn ? 'স্পন্সর্ড' : 'Sponsored'}
            </span>
          </div>
          <div class="sponsored-card-image-wrap">
            <img src="${this._escapeHtml(imgUrl)}" alt="${this._escapeHtml(ad.headline)}" class="sponsored-card-img" loading="lazy" />
          </div>
          <div class="sponsored-card-body">
            <h4 class="sponsored-card-title">${this._escapeHtml(ad.headline || ad.title)}</h4>
            ${ad.description ? `<p class="sponsored-card-desc">${this._escapeHtml(ad.description)}</p>` : ''}
            ${priceFormatted ? `<div class="sponsored-card-price">${priceFormatted}</div>` : ''}
            <button type="button" class="btn btn-outline btn-sm sponsored-cta-btn">
              ${this._formatCta(ad.callToAction, isBn)}
            </button>
          </div>
        </div>
      `;
    }

    // Attach click listener
    container.addEventListener('click', (e) => {
      e.preventDefault();
      this._handleClick();
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
  _setupViewabilityObserver(element) {
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

  _formatCta(ctaKey = 'SHOP_NOW', isBn = false) {
    const ctas = {
      SHOP_NOW: isBn ? 'এখনই কিনুন' : 'Shop Now',
      LEARN_MORE: isBn ? 'বিস্তারিত দেখুন' : 'Learn More',
      GET_OFFER: isBn ? 'অফার নিন' : 'Get Offer',
      VIEW_PRODUCT: isBn ? 'পণ্য দেখুন' : 'View Product',
    };
    return ctas[ctaKey] || (isBn ? 'এখনই কিনুন' : 'Shop Now');
  }

  _escapeHtml(str) {
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
