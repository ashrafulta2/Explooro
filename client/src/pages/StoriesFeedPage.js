/**
 * StoriesFeedPage.js — UGC Content Commerce, Storytelling Feed & Embedded Buyable Products (Prompt 10.8).
 *
 * Implements /stories:
 * - Editorial storytelling blog posts authored by salers and suppliers.
 * - Embedded interactive buyable product cards with direct Add to Cart / Buy Now.
 * - Top hero banner carousel (fed live from Editor Banner Manager).
 */

import { listStories, listBanners, createStory } from '../services/content.api.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { t, getLanguage } from '../services/i18n.js';
import { toast } from '../services/toast.js';
import { isFeatureEnabled } from '../services/featureFlags.js';

export default function StoriesFeedPage(root, ctx = {}) {
  const container = document.createElement('div');
  container.className = 'stories-feed-page p-4 md:p-6 max-w-5xl mx-auto space-y-8';

  let stories = [];
  let banners = [];

  // Module Gating
  if (!isFeatureEnabled('content_commerce')) {
    container.append(
      EmptyState({
        title: t('content.module_disabled_title'),
        description: t('content.module_disabled_desc'),
      })
    );
    root.append(container);
    return () => container.remove();
  }

  // 1. Hero Banners Carousel
  const bannersContainer = document.createElement('div');
  bannersContainer.className = 'banners-hero-carousel rounded-2xl overflow-hidden shadow-lg border bg-surface';
  container.append(bannersContainer);

  // 2. Header & Filter Bar
  const headerRow = document.createElement('div');
  headerRow.className = 'flex-between flex-wrap gap-4 border-b pb-4';
  headerRow.innerHTML = `
    <div>
      <div class="flex items-center gap-2">
        <span class="text-2xl">📖</span>
        <h2 class="text-2xl font-bold tracking-tight m-0">${t('content.stories_title')}</h2>
      </div>
      <p class="text-sm text-muted m-0 mt-1">${t('content.stories_subtitle')}</p>
    </div>
  `;

  const postBtn = Button({
    label: `✍️ ${t('content.btn_write_story')}`,
    variant: 'primary',
    onClick: openCreateStoryModal,
  });
  headerRow.append(postBtn);
  container.append(headerRow);

  // 3. Stories Feed Container
  const feedList = document.createElement('div');
  feedList.className = 'space-y-8';
  container.append(feedList);

  async function loadData() {
    try {
      const [sRes, bRes] = await Promise.all([
        listStories().catch(() => ({ data: [] })),
        listBanners('HOMEPAGE_HERO').catch(() => ({ data: [] })),
      ]);

      stories = sRes?.data || [];
      banners = bRes?.data || [];

      renderBanners();
      renderStories();
    } catch {
      // Fallback
    }
  }

  function renderBanners() {
    if (banners.length === 0) {
      bannersContainer.style.display = 'none';
      return;
    }

    const b = banners[0];
    const lang = getLanguage();
    const title = lang === 'bn' ? (b.title_bn || b.title_en) : (b.title_en || b.title_bn);

    bannersContainer.innerHTML = `
      <div class="relative h-48 md:h-64 bg-slate-900 flex items-end p-6 bg-cover bg-center text-white" style="background-image: linear-gradient(to top, rgba(0,0,0,0.85), transparent), url('${b.image_url_desktop}')">
        <div class="space-y-2 max-w-xl">
          <span class="badge badge-warning text-xs font-mono font-bold uppercase">Featured Story</span>
          <h3 class="text-xl md:text-2xl font-bold m-0">${title}</h3>
          <a href="${b.target_link}" class="btn btn-sm btn-primary inline-flex items-center gap-1 text-xs">
            ${t('content.explore_story')} ➔
          </a>
        </div>
      </div>
    `;
  }

  function renderStories() {
    feedList.innerHTML = '';
    const lang = getLanguage();

    if (stories.length === 0) {
      feedList.append(
        EmptyState({
          title: t('content.no_stories_title'),
          description: t('content.no_stories_desc'),
        })
      );
      return;
    }

    stories.forEach((story) => {
      const title = lang === 'bn' ? (story.title_bn || story.title_en) : (story.title_en || story.title_bn);
      const content = lang === 'bn' ? (story.content_bn || story.content_en) : (story.content_en || story.content_bn);
      const products = story.embedded_products || [];

      const card = document.createElement('article');
      card.className = 'story-card border rounded-2xl p-6 bg-surface shadow-sm hover:shadow-md transition-shadow space-y-4';

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-primary-soft text-primary font-bold flex items-center justify-center text-sm">
            ${(story.author_name || 'A')[0].toUpperCase()}
          </div>
          <div>
            <div class="font-bold text-sm text-slate-900">${story.author_name || 'Explooro Seller'}</div>
            <div class="text-xs text-muted flex items-center gap-2">
              <span class="badge badge-neutral text-xs font-mono uppercase">${story.author_user_role || 'saler'}</span>
              <span>•</span>
              <span>${new Date(story.created_at).toLocaleDateString()}</span>
              <span>•</span>
              <span>👁️ ${story.view_count || 0} views</span>
            </div>
          </div>
        </div>

        ${story.cover_image_url ? `
          <div class="rounded-xl overflow-hidden h-64 bg-slate-100">
            <img src="${story.cover_image_url}" alt="${title}" class="w-full h-full object-cover" loading="lazy" />
          </div>
        ` : ''}

        <div>
          <h3 class="text-xl font-bold text-slate-900 m-0 mb-2">${title}</h3>
          <p class="text-sm text-slate-700 leading-relaxed m-0">${content}</p>
        </div>

        ${products.length > 0 ? `
          <div class="embedded-products-section border-t pt-4 space-y-3">
            <div class="flex items-center gap-2 text-xs font-bold text-muted uppercase">
              <span>🛍️</span> ${t('content.featured_in_story')}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              ${products.map((p) => {
                const pTitle = lang === 'bn' ? (p.title_bn || p.title_en) : (p.title_en || p.title_bn);
                const media = Array.isArray(p.media) ? p.media[0] : null;
                const imgSrc = media?.url || 'https://placehold.co/80x80';
                return `
                  <div class="border rounded-xl p-3 bg-surface-subtle flex items-center justify-between gap-3">
                    <img src="${imgSrc}" alt="${pTitle}" class="w-12 h-12 rounded-lg object-cover" />
                    <div class="flex-1 min-w-0">
                      <h5 class="text-xs font-bold truncate m-0">${pTitle}</h5>
                      <div class="font-mono text-xs font-bold text-primary">৳${p.retail_price?.toLocaleString()}</div>
                    </div>
                    <a href="/products/${p.slug || p.id}" class="btn btn-sm btn-primary text-xs shrink-0">
                      ⚡ ${t('common.buy_now')}
                    </a>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      `;

      feedList.append(card);
    });
  }

  function openCreateStoryModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Story Title (English)</label>
        <input type="text" id="story-title-en" class="input w-full" placeholder="e.g. Scaling my Jamdani craft store">
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">গল্পের শিরোনাম (বাংলা)</label>
        <input type="text" id="story-title-bn" class="input w-full" placeholder="যেমন: কীভাবে জামদানি শাড়ির বিক্রি দ্বিগুণ করলাম">
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Cover Image URL</label>
        <input type="url" id="story-cover-url" class="input w-full font-mono text-xs" placeholder="https://...">
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Story Content (English)</label>
        <textarea id="story-content-en" class="input w-full" rows="4" placeholder="Share your sourcing journey, customer experience or craft story..."></textarea>
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted mb-1">গল্পের বিস্তারিত (বাংলা)</label>
        <textarea id="story-content-bn" class="input w-full" rows="4" placeholder="আপনার সোর্সিং অভিজ্ঞতা বা সফলতার গল্প লিখুন..."></textarea>
      </div>
    `;

    const modal = Modal({
      title: `✍️ ${t('content.publish_story_title')}`,
      body: modalContent,
      confirmLabel: t('common.publish'),
      onConfirm: async () => {
        const titleEn = modalContent.querySelector('#story-title-en')?.value?.trim();
        const titleBn = modalContent.querySelector('#story-title-bn')?.value?.trim();
        const coverUrl = modalContent.querySelector('#story-cover-url')?.value?.trim();
        const contentEn = modalContent.querySelector('#story-content-en')?.value?.trim();
        const contentBn = modalContent.querySelector('#story-content-bn')?.value?.trim();

        if (!titleEn || !titleBn) {
          toast.error('Both English and Bengali titles are required');
          return;
        }

        try {
          await createStory({
            title_en: titleEn,
            title_bn: titleBn,
            cover_image_url: coverUrl,
            content_en: contentEn,
            content_bn: contentBn,
          });

          toast.success(t('content.story_submitted'));
          modal.close();
          await loadData();
        } catch (err) {
          toast.error(err?.message || 'Failed to publish story');
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  loadData();
  root.append(container);

  return () => container.remove();
}
