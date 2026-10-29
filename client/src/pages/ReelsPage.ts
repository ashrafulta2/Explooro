/**
 * ReelsPage.ts — Dedicated Full-Screen Shoppable Reels Feed Page (Prompt 10.8).
 *
 * Implements /reels.
 */

import { ShoppableReels } from '../components/content/ShoppableReels.ts';
import type { PageContext } from './types.ts';

export default function ReelsPage(root: HTMLElement, ctx: PageContext = {}) {
  const container = document.createElement('div');
  container.className = 'reels-page py-4 px-2 md:px-4 max-w-lg mx-auto flex items-center justify-center';

  const reelsInstance = ShoppableReels({
    onBuyProduct: (product: { slug?: string; id?: string | number }) => {
      window.location.href = `/products/${product.slug || product.id}`;
    },
  });

  container.append(reelsInstance.element);
  root.append(container);

  return () => container.remove();
}
