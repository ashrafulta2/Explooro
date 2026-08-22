/**
 * HomeStub — Prompt 1.5 router/store/api demo page. Temporary: Prompt 4.5 replaces this with the
 * real marketplace home. Proves api.js's mock latency and the router's param-based navigation.
 */
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { Card } from '../../components/ui/Card.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Button } from '../../components/ui/Button.js';

export default function HomeStub(root, { navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';

  const heading = document.createElement('h2');
  heading.textContent = t('pages.home.heading');
  const desc = document.createElement('p');
  desc.className = 'text-sm text-muted';
  desc.textContent = t('pages.home.description', { mode: import.meta.env.VITE_API_MODE ?? 'mock' });
  wrap.append(heading, desc);

  const list = document.createElement('div');
  list.className = 'route-stub__cards';
  list.append(Skeleton({ variant: 'card', width: 200 }), Skeleton({ variant: 'card', width: 200 }));
  wrap.append(list);

  const actions = document.createElement('div');
  actions.className = 'route-stub__actions';
  actions.append(
    Button({ label: t('pages.home.visit_store'), variant: 'secondary', onClick: () => navigate('/store/rahim-fashion') }),
    // Reuses the nav link's phrasing rather than a longer label — the long form overflowed the
    // 360px viewport as an unbroken button (caught with Playwright during Prompt 1.6 verification).
    Button({ label: t('router_demo.nav_saler'), variant: 'ghost', onClick: () => navigate('/saler') })
  );
  wrap.append(actions);
  root.append(wrap);

  let cancelled = false;
  // limit: 10 (not the default 20) covers every fixture, including the ৳125,000 bundle that
  // proves South Asian grouping (1,25,000) visually differs from Western (125,000).
  api.get('/products', { query: { limit: 10 } }).then(({ data }) => {
    if (cancelled) return;
    list.replaceChildren();
    const lang = getLanguage();
    for (const product of data.products) {
      const body = document.createElement('p');
      body.className = 'text-sm text-muted';
      body.textContent = `${formatCurrency(product.price, { lang })} · ${product.district}`;
      list.append(
        Card({
          title: product.title_bn,
          subtitle: product.title_en,
          body,
          interactive: true,
          onClick: () => navigate(`/product/${product.ref}`),
        })
      );
    }
  });

  return () => {
    cancelled = true;
  };
}
