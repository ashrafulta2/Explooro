/**
 * ProductGrid — cursor-paginated product grid with infinite scroll (Prompt 4.5).
 *
 * @param {object} opts
 * @param {function} opts.fetchPage  — async (cursor?) => { products, meta: { cursor: { next, has_more } } }
 * @param {string}   opts.role       — current user role
 * @param {object}   opts.modules    — live module flags
 * @param {string}   opts.lang       — 'en' | 'bn'
 * @param {function} opts.onNavigate — router navigate(path)
 * @param {function} opts.onAction   — (product, actionType) CTA callback
 * @returns {{ el: HTMLElement, cleanup: () => void }}
 *
 * Invariants:
 *  - IntersectionObserver sentinel drives infinite scroll; disconnected on cleanup.
 *  - Back-to-top button appears after the user scrolls 1× viewport height.
 *  - Skeleton placeholders (N=8 on first load) reserve exact card shape → zero CLS.
 *  - aria-busy on the container signals loading to screen readers.
 *  - Empty state is rendered when no products are returned on the first page.
 */

import { ProductCard, ProductCardSkeleton } from './ProductCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { t } from '../../services/i18n.js';

const INITIAL_SKELETONS = 8;

/** Inline SVG: chevron up (back to top). */
function chevronUpSvg() {
  const wrap = document.createElement('span');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';
  return wrap.firstChild;
}

/**
 * @param {object} opts
 * @returns {{ el: HTMLElement, cleanup: () => void }}
 */
export function ProductGrid({
  fetchPage,
  role = 'customer',
  modules = {},
  lang = 'en',
  onNavigate = null,
  onAction = null,
} = {}) {
  // ── Back-to-top button (fixed, outside the grid scroll) ─────────────────
  const backTop = document.createElement('button');
  backTop.type = 'button';
  backTop.className = 'product-grid__back-top';
  backTop.setAttribute('aria-label', t('marketplace.back_to_top'));
  backTop.append(chevronUpSvg());
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.append(backTop);

  const onScroll = () => {
    const past = window.scrollY > window.innerHeight;
    backTop.classList.toggle('is-visible', past);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Grid container ───────────────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'product-grid-wrapper';

  const grid = document.createElement('div');
  grid.className = 'product-grid';
  grid.setAttribute('aria-busy', 'true');
  wrapper.append(grid);

  // ── Loading indicator ────────────────────────────────────────────────────
  const loadingRow = document.createElement('div');
  loadingRow.className = 'product-grid__loading';
  loadingRow.style.display = 'none';
  const spinner = document.createElement('div');
  spinner.className = 'product-grid__spinner';
  const loadingText = document.createElement('span');
  loadingText.textContent = t('common.loading');
  loadingRow.append(spinner, loadingText);
  wrapper.append(loadingRow);

  // ── IntersectionObserver sentinel (bottom of grid) ───────────────────────
  const sentinel = document.createElement('div');
  sentinel.className = 'product-grid__sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  wrapper.append(sentinel);

  // ── State ────────────────────────────────────────────────────────────────
  let cursor = null;
  let hasMore = true;
  let loading = false;
  let firstLoad = true;

  // Show skeletons on first mount
  for (let i = 0; i < INITIAL_SKELETONS; i += 1) {
    grid.append(ProductCardSkeleton());
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;

    if (firstLoad) {
      grid.setAttribute('aria-busy', 'true');
    } else {
      loadingRow.style.display = 'flex';
    }

    try {
      const result = await fetchPage(cursor);
      const products = result?.data?.products ?? result?.products ?? [];
      const meta = result?.meta ?? result;

      if (firstLoad) {
        // Replace skeletons with real cards
        grid.replaceChildren();
        firstLoad = false;
      }

      if (products.length === 0 && grid.children.length === 0) {
        // Empty state
        const emptyWrap = document.createElement('div');
        emptyWrap.className = 'product-grid__empty';
        emptyWrap.append(
          EmptyState({
            title: t('marketplace.empty.title'),
            description: t('marketplace.empty.description'),
            variant: 'empty',
          })
        );
        grid.append(emptyWrap);
        hasMore = false;
      } else {
        for (const product of products) {
          grid.append(
            ProductCard({ product, role, modules, lang, size: 'full', onNavigate, onAction })
          );
        }

        cursor = meta?.cursor?.next ?? null;
        hasMore = meta?.cursor?.has_more ?? false;
      }
    } catch (err) {
      // On error: show a brief message in the loading row rather than breaking the grid
      loadingRow.textContent = t('common.error_generic');
      loadingRow.style.color = 'var(--danger-700)';
      hasMore = false;
    } finally {
      grid.setAttribute('aria-busy', 'false');
      loadingRow.style.display = 'none';
      loading = false;
      observer.observe(sentinel); // re-arm after each successful load
    }
  }

  // Start first load
  loadMore();

  // ── IntersectionObserver ─────────────────────────────────────────────────
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        observer.unobserve(sentinel); // unobserve while loading to prevent multi-triggers
        loadMore();
      }
    },
    { rootMargin: '200px' }
  );
  observer.observe(sentinel);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  function cleanup() {
    observer.disconnect();
    window.removeEventListener('scroll', onScroll);
    backTop.remove();
  }

  return { el: wrapper, cleanup };
}
