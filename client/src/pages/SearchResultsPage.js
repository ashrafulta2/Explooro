/**
 * SearchResultsPage — the "/search?q=" results page (Prompt 4.4, plan A).
 *
 * Reuses ProductGrid (same cursor-paginated infinite scroll as the marketplace home) fed by
 * `listProducts({ q })`, so the mock/live switch and the normalized product shape are inherited
 * for free. The full Bengali-aware engine + grouped store/category results land with Prompt 4.4
 * proper; this page is deliberately a thin catalog view over the existing product list endpoint.
 */
import { appStore } from '../state/appStore.js';
import { listProducts } from '../services/catalog.api.js';
import { t, getLanguage } from '../services/i18n.js';
import { ProductGrid } from '../components/product/ProductGrid.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { openQuickBuyModal } from '../components/cart/QuickBuyModal.js';
import { updateHead } from '../services/seo.js';

export default function SearchResultsPage(root, { query, navigate }) {
  const cleanups = [];
  const lang = getLanguage();
  const { auth, modules } = appStore.get();
  const role = auth.role || 'customer';
  const term = (query.q || '').trim();

  // Search result pages must never be indexed (thin, infinite permutations).
  updateHead({
    title: term ? `${t('marketplace.search_page.heading')}: ${term}` : t('marketplace.search_page.heading'),
    description: t('marketplace.search_page.prompt_desc'),
    canonicalPath: '/search',
    locale: lang,
    noIndex: true,
  });

  const page = document.createElement('div');
  page.className = 'search-results-page';

  const header = document.createElement('div');
  header.className = 'search-results-page__header';
  const heading = document.createElement('h1');
  heading.className = 'search-results-page__heading';
  heading.textContent = t('marketplace.search_page.heading');
  header.append(heading);

  const countLabel = document.createElement('p');
  countLabel.className = 'search-results-page__count';
  header.append(countLabel);
  page.append(header);

  // No query yet — prompt the user to type instead of running an empty search.
  if (!term) {
    page.append(
      EmptyState({
        variant: 'empty',
        title: t('marketplace.search_page.prompt_title'),
        description: t('marketplace.search_page.prompt_desc'),
      })
    );
    root.append(page);
    return () => cleanups.forEach((fn) => fn());
  }

  heading.textContent = t('marketplace.search_results_for', { query: term });

  function handleAction(product, actionType) {
    if (actionType === 'quick_buy') {
      openQuickBuyModal({ product, initialQty: 1, navigate });
    } else {
      navigate(`/product/${product.ref || product.slug || product.id}`);
    }
  }

  async function fetchPage(cursor) {
    const result = await listProducts({ q: term, limit: 20, ...(cursor ? { cursor } : {}) });
    if (!cursor) {
      const total = result.meta?.total ?? result.products.length;
      countLabel.textContent =
        total === 0
          ? ''
          : t('marketplace.search_page.results_count', { count: total, query: term });
    }
    return result;
  }

  const { el, cleanup } = ProductGrid({
    fetchPage,
    role,
    modules,
    lang,
    onNavigate: navigate,
    onAction: handleAction,
    emptyTitle: t('marketplace.search_page.empty_title'),
    emptyDescription: t('marketplace.search_page.empty_desc', { query: term }),
  });
  cleanups.push(cleanup);
  page.append(el);

  root.append(page);
  return () => cleanups.forEach((fn) => fn());
}
