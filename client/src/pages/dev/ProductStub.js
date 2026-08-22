/**
 * ProductStub — Prompt 1.5 router demo. Temporary: Prompt 4.6 replaces this with the real product
 * detail page. Proves the router's `:id` param and api.js's ApiError path (NOT_FOUND).
 */
import { api, ApiError } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Button } from '../../components/ui/Button.js';

export default function ProductStub(root, { params, navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';

  const heading = document.createElement('h2');
  heading.textContent = t('pages.product.heading');
  const route = document.createElement('p');
  route.className = 'text-sm text-muted';
  route.textContent = t('pages.product.route_label', { id: params.id });
  wrap.append(heading, route);

  const body = document.createElement('div');
  body.append(Skeleton({ variant: 'text', lines: 3 }));
  wrap.append(body);

  const back = Button({ label: t('common.back_to_marketplace'), variant: 'secondary', onClick: () => navigate('/') });
  wrap.append(back);
  root.append(wrap);

  let cancelled = false;
  const lang = getLanguage();
  api
    .get(`/products/${params.id}`)
    .then(({ data }) => {
      if (cancelled) return;
      const p = data.product;
      body.replaceChildren();
      const h3 = document.createElement('h3');
      h3.textContent = p.title_bn;
      const en = document.createElement('p');
      en.className = 'text-sm text-muted';
      en.textContent = p.title_en;
      const price = document.createElement('p');
      price.className = 'text-lg';
      price.textContent = t('pages.product.district_label', {
        price: formatCurrency(p.price, { lang }),
        stock: t('common.in_stock', { count: formatNumber(p.stock, { lang }) }),
        district: p.district,
      });
      body.append(h3, en, price);
    })
    .catch((err) => {
      if (cancelled) return;
      body.replaceChildren();
      const p = document.createElement('p');
      p.className = 'text-sm';
      p.textContent = err instanceof ApiError ? `${err.code}: ${err.message_en}` : t('pages.product.load_failed');
      body.append(p);
    });

  return () => {
    cancelled = true;
  };
}
