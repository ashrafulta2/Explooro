/**
 * StoreStub — Prompt 1.5 router demo. Temporary: Prompt 4.8 replaces this with the real virtual
 * storefront. Proves the router's `:slug` param plus a module-gated route (`virtual_storefront`).
 */
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';

export default function StoreStub(root, { params, navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';

  const heading = document.createElement('h2');
  heading.textContent = t('pages.store.heading');
  const route = document.createElement('p');
  route.className = 'text-sm text-muted';
  route.textContent = t('pages.store.route_label', { slug: params.slug });
  wrap.append(heading, route);

  const body = document.createElement('div');
  body.append(Skeleton({ variant: 'block', width: 320 }));
  wrap.append(body);

  const back = Button({ label: t('common.back_to_marketplace'), variant: 'secondary', onClick: () => navigate('/') });
  wrap.append(back);
  root.append(wrap);

  let cancelled = false;
  const lang = getLanguage();
  api.get(`/stores/${params.slug}`).then(({ data }) => {
    if (cancelled) return;
    body.replaceChildren();
    const header = document.createElement('div');
    header.append(
      Object.assign(document.createElement('h3'), { textContent: data.store.name_bn }),
      Object.assign(document.createElement('p'), {
        className: 'text-sm text-muted',
        textContent: `${data.store.name_en} · ${data.store.district} · ★ ${data.store.rating}`,
      }),
      Badge({ variant: 'verified' })
    );
    body.append(header);

    const list = document.createElement('div');
    list.className = 'route-stub__cards';
    for (const product of data.products) {
      const row = document.createElement('p');
      row.className = 'text-sm';
      row.textContent = `${product.title_bn} — ${formatCurrency(product.price, { lang })}`;
      list.append(row);
    }
    body.append(list);
  });

  return () => {
    cancelled = true;
  };
}
