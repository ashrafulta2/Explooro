/**
 * SocialKitPage.ts — Explooro partner Flyer Studio (Prompt 9.7 / §AL.2).
 *
 * Route: /saler/social-kit
 *
 * The studio itself (thousands of ready designs, editing, downloads, sharing) is
 * components/flyer/FlyerStudio.ts, shared with suppliers. This page only says where a partner's
 * products and links come from:
 * - products and the store name: GET /saler/store (the partner's own curated items), so a flyer
 *   always advertises something the partner really sells, under their real store name;
 * - the QR: a tracked short link per product and channel (POST /saler/social-kit/links), so every
 *   order a flyer brings is credited to the partner.
 */

import { salerApi } from '../../services/saler.api.ts';
import { getMyStore } from '../../services/store.api.ts';
import { FlyerStudio, type StudioItem } from '../../components/flyer/FlyerStudio.ts';
import type { PageContext } from '../types.ts';
import '../../styles/components/flyer-studio.css';

export default function SocialKitPage(root: HTMLElement, { query }: PageContext = {}) {
  let storeSlug = '';
  return FlyerStudio(root, {
    role: 'partner',
    titleKey: 'social_kit.title',
    subtitleKey: 'flyer.partner_subtitle',
    back: { href: '/saler', labelKey: 'saler.dashboard.title' },
    brandLineKey: 'social_kit.flyer_verified',
    linkNoteKey: 'social_kit.preview_note',
    empty: { textKey: 'social_kit.no_products', href: '/saler/sourcing', ctaKey: 'social_kit.no_products_cta' },
    allowWholeStore: true,
    async load() {
      const data = await getMyStore();
      storeSlug = data?.store?.slug || '';
      const seen = new Set<number>();
      const items: StudioItem[] = [];
      for (const shelf of data?.shelves || []) {
        for (const it of shelf?.items || []) {
          const id = Number(it.product_id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const price = Number(it.custom_retail_price ?? it.default_retail_price ?? it.price);
          items.push({
            id,
            title_en: it.title_en || '',
            title_bn: it.title_bn || '',
            price: Number.isFinite(price) && price > 0 ? price : null,
            image_url: typeof it.image_url === 'string' && it.image_url ? it.image_url : null,
          });
        }
      }
      return { brand: data?.store?.shop_name || '', items };
    },
    async link(target, channel) {
      const res = await salerApi.createSocialKitLink(
        target === 'ALL'
          // WHY an explicit target: without one the server builds /store/<numeric id>, which is not a
          // storefront route; storefronts are addressed by slug.
          ? { source_channel: channel, target_url: storeSlug ? `/store/${storeSlug}` : undefined }
          : { product_id: target, source_channel: channel },
      );
      const data = res?.data || res;
      if (!data?.code || !data?.full_url) throw new Error('NO_LINK');
      return { url: data.full_url, code: data.code };
    },
  }, (query || {}) as Record<string, string>);
}
