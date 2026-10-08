/**
 * SalerMarketingKitsPage.js — Ready-made promotion from suppliers: captions, hashtags, selling points,
 * product photos and a video link, to copy from when a saler lists a product.
 *
 * Route: /saler/marketing-kits  (module: sourcing, permission: saler.sourcing.view)
 *
 * WHY a search box and nothing else: a saler arrives looking for ONE product's kit. Filtering is done
 * in the browser over what the server already returned (the list is capped), so typing never costs a
 * request.
 */
import { sampleKitApi } from '../../services/sampleKit.api.js';
import { MarketingKitCard } from '../../components/sampleKit/MarketingKitCard.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Kits whose product or supplier name contains the query, case-insensitively. An empty query keeps all. */
export function filterKits(kits, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return kits;
  return kits.filter((k) => `${k.title_en} ${k.title_bn || ''} ${k.supplier_name || ''}`.toLowerCase().includes(q));
}

export default function SalerMarketingKitsPage(root) {
  const container = el('div', 'supplier-page-container');

  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('kit.saler_title', 'Marketing Kits')), el('p', 'supplier-header__sub', t('kit.saler_subtitle')));

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'incentive-input kit-search';
  search.placeholder = t('kit.search');
  search.setAttribute('aria-label', t('kit.search'));
  search.hidden = true;

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '220px' }));
  container.append(header, search, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let kits = [];

  function render() {
    const shown = filterKits(kits, search.value);
    if (!shown.length) {
      body.replaceChildren(EmptyState({ title: t(kits.length ? 'kit.no_match' : 'kit.empty_title'), description: kits.length ? '' : t('kit.empty_body'), compact: true }));
      return;
    }
    body.replaceChildren(...shown.map(MarketingKitCard));
  }

  search.addEventListener('input', render);

  (async () => {
    try {
      const res = await sampleKitApi.getSalerKits();
      kits = (res?.data ?? res).kits || [];
      search.hidden = kits.length === 0;
      render();
    } catch (err) {
      console.error('Failed to load marketing kits:', err);
      toast.error(t('kit.load_failed'));
      body.replaceChildren(EmptyState({ title: t('kit.load_failed') }));
    }
  })();

  return () => container.remove();
}
