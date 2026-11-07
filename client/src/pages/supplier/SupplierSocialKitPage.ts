/**
 * SupplierSocialKitPage.ts — the Flyer Studio for suppliers.
 *
 * Route: /supplier/social-kit  (module: social_seller_kit, permission: catalog.product.manage_own)
 *
 * Same studio as the Explooro partner one (components/flyer/FlyerStudio.ts), fed with the
 * supplier's own active products (GET /products?supplier_id=<me>) and their business name.
 *
 * WHY the QR opens the product page and not a short link: tracked short links exist to credit an
 * Explooro partner with the sale (attribution.service). A supplier's own promotion credits nobody,
 * so a plain product link is the honest target and needs no server round trip.
 *
 * WHY no "whole store" option: suppliers have no public storefront page to point a QR at.
 */

import { listProducts } from '../../services/catalog.api.ts';
import { getCurrentUser } from '../../services/session.ts';
import { FlyerStudio, type StudioItem } from '../../components/flyer/FlyerStudio.ts';
import type { PageContext } from '../types.ts';
import '../../styles/components/flyer-studio.css';

// WHY a cap: the studio's product picker is a plain select; 200 covers almost every supplier and
// is the page size the catalog endpoint already serves.
const PRODUCT_LIMIT = 200;

export default function SupplierSocialKitPage(root: HTMLElement, { query }: PageContext = {}) {
  const refs = new Map<number, string>();
  return FlyerStudio(root, {
    role: 'supplier',
    titleKey: 'flyer.supplier_title',
    subtitleKey: 'flyer.supplier_subtitle',
    back: { href: '/supplier', labelKey: 'nav.shared.dashboard' },
    brandLineKey: 'flyer.supplier_verified',
    linkNoteKey: 'flyer.supplier_link_note',
    empty: { textKey: 'flyer.supplier_no_products', href: '/supplier/products', ctaKey: 'flyer.supplier_no_products_cta' },
    allowWholeStore: false,
    async load() {
      const me = getCurrentUser();
      const { products } = await listProducts({ supplier_id: me?.id, status: 'ACTIVE', limit: PRODUCT_LIMIT });
      const items: StudioItem[] = [];
      for (const p of products || []) {
        const id = Number(p.id);
        if (!id) continue;
        refs.set(id, String(p.ref || p.id));
        const price = Number(p.price);
        items.push({
          id,
          title_en: p.title_en || p.name_en || p.title || '',
          title_bn: p.title_bn || p.name_bn || '',
          price: Number.isFinite(price) && price > 0 ? price : null,
          image_url: typeof p.image_url === 'string' && p.image_url ? p.image_url : null,
        });
      }
      const supplierName = products?.[0]?.supplier?.name || '';
      return { brand: supplierName || String(me?.business_name || me?.full_name || me?.name || ''), items };
    },
    async link(target) {
      if (target === 'ALL') throw new Error('NO_TARGET');
      return { url: `${window.location.origin}/product/${encodeURIComponent(refs.get(target) || String(target))}` };
    },
  }, (query || {}) as Record<string, string>);
}
