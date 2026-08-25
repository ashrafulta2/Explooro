/**
 * Explooro Embeddable Commerce Widget (Prompt 10.7).
 *
 * Ultra-lightweight (<15KB, zero runtime dependencies) embeddable product showcase.
 * Embed via: <script src="https://cdn.explooro.com/widget.js" data-store="store-slug" data-limit="4"></script>
 */

(function () {
  'use strict';

  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!script) return;

  const config = {
    apiBase: script.getAttribute('data-api-base') || window.EXPLOORO_API_BASE || '/api/v1',
    containerSelector: script.getAttribute('data-container'),
    storeId: script.getAttribute('data-store'),
    categoryId: script.getAttribute('data-category'),
    limit: parseInt(script.getAttribute('data-limit') || '4', 10),
    lang: script.getAttribute('data-lang') || 'en',
    theme: script.getAttribute('data-theme') || 'light',
  };

  const container = config.containerSelector
    ? document.querySelector(config.containerSelector)
    : document.createElement('div');

  if (!config.containerSelector) {
    script.parentNode.insertBefore(container, script.nextSibling);
  }

  container.className = 'explooro-embed-root';

  // Inject scoped stylesheet
  const style = document.createElement('style');
  style.textContent = `
    .explooro-embed-root {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 16px 0;
      width: 100%;
      box-sizing: border-box;
    }
    .explooro-embed-root * {
      box-sizing: border-box;
    }
    .explooro-embed-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }
    .explooro-product-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      flex-direction: column;
    }
    .explooro-product-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .explooro-product-img {
      width: 100%;
      height: 160px;
      object-fit: cover;
      background: #f8fafc;
    }
    .explooro-product-info {
      padding: 12px;
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .explooro-product-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 8px 0;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .explooro-product-price {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin-top: auto;
      margin-bottom: 10px;
      font-family: monospace;
    }
    .explooro-buy-btn {
      display: block;
      text-align: center;
      background: #0ea5e9;
      color: #ffffff;
      text-decoration: none;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      transition: background 0.15s ease;
    }
    .explooro-buy-btn:hover {
      background: #0284c7;
    }
    .explooro-brand-tag {
      font-size: 10px;
      color: #94a3b8;
      text-align: right;
      margin-top: 8px;
    }
  `;
  document.head.appendChild(style);

  // Render initial loading state
  container.innerHTML = `
    <div style="text-align: center; padding: 24px; color: #64748b; font-size: 13px;">
      Loading Explooro Showcase...
    </div>
  `;

  // Fetch products
  const params = new URLSearchParams({
    limit: config.limit,
  });
  if (config.storeId) params.set('store_id', config.storeId);
  if (config.categoryId) params.set('category_id', config.categoryId);

  fetch(`${config.apiBase}/public/products?${params.toString()}`)
    .then((res) => res.json())
    .then((res) => {
      const products = res?.data || [];
      if (!products.length) {
        container.innerHTML = `<div style="text-align:center; padding: 16px; color: #94a3b8; font-size: 12px;">No products available.</div>`;
        return;
      }

      container.innerHTML = `
        <div class="explooro-embed-grid">
          ${products.map((p) => {
            const title = config.lang === 'bn' ? (p.title_bn || p.title_en) : (p.title_en || p.title_bn);
            const media = Array.isArray(p.media) ? p.media[0] : null;
            const imgSrc = media?.url || 'https://placehold.co/300x200?text=Explooro';
            const priceFormatted = '৳' + parseFloat(p.retail_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            const productUrl = `/products/${p.slug || p.id}`;

            return `
              <div class="explooro-product-card">
                <img class="explooro-product-img" src="${imgSrc}" alt="${title}" loading="lazy" />
                <div class="explooro-product-info">
                  <h4 class="explooro-product-title">${title}</h4>
                  <div class="explooro-product-price">${priceFormatted}</div>
                  <a class="explooro-buy-btn" href="${productUrl}" target="_blank" rel="noopener">
                    ${config.lang === 'bn' ? 'কিনুন' : 'Buy Now'} ➔
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="explooro-brand-tag">Powered by <b>Explooro</b></div>
      `;
    })
    .catch((err) => {
      container.innerHTML = `<div style="text-align:center; padding: 16px; color: #ef4444; font-size: 12px;">Failed to load Explooro products.</div>`;
    });
})();
