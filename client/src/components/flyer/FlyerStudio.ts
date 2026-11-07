/**
 * FlyerStudio.ts — the design studio behind /saler/social-kit (Explooro partners) and
 * /supplier/social-kit (suppliers).
 *
 * The person picks what to promote, an occasion and a size, and gets a gallery of ready designs
 * with their own product, price, photo, store name and QR link already in place
 * (config/flyerTemplates.ts × lib/flyerEngine.ts). One tap picks a design; from there they can
 * change the headline or tag, then download, share the image straight to WhatsApp/Facebook from a
 * phone, or copy a ready-written caption. Nothing has to be designed by hand.
 *
 * WHY the gallery draws lazily: an occasion has thousands of designs. Only GALLERY_PAGE cards
 * exist at a time, and a card's SVG is drawn only when it scrolls into view (IntersectionObserver),
 * with a QR look-alike instead of encoding the real link — so the page stays as light as a list.
 *
 * Its stylesheet (styles/components/flyer-studio.css) is imported by the two pages, not here, so
 * Node can still import this module in tests (it has no loader for .css).
 *
 * WHY one component for both roles: the difference is only where products and links come from
 * (`StudioSource`). Partners get a tracked short link per product (orders credit them); a supplier
 * links to the product page itself.
 */

import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import { escapeHtml } from '../../services/html.ts';
import { formatCurrency, formatNumber } from '../../services/format.ts';
import { Skeleton } from '../ui/Skeleton.ts';
import { renderFlyer, fillCaption, type FlyerContent, type FlyerItem } from '../../lib/flyerEngine.ts';
import { zipBlob, type ZipEntry } from '../../lib/zip.ts';
import {
  FORMATS, OCCASIONS, designAt, designCount, designKey, parseDesignKey, occasionById, paletteById,
  type DesignRef, type FormatId, type Occasion,
} from '../../config/flyerTemplates.ts';

export interface StudioItem {
  id: number;
  title_en: string;
  title_bn: string;
  price: number | null;
  image_url: string | null;
}

export interface StudioLink { url: string; code?: string }

export type LinkChannel = 'QR_CODE' | 'PRINT_FLYER';

export interface StudioSource {
  /** 'partner' | 'supplier' — names the saved-designs slot and the download files. */
  role: string;
  titleKey: string;
  subtitleKey: string;
  back: { href: string; labelKey: string };
  /** The "verified …" line printed under the store name on every flyer. */
  brandLineKey: string;
  /** Explains where the QR leads. */
  linkNoteKey: string;
  /** Shown when there is nothing to promote yet. */
  empty: { textKey: string; href: string; ctaKey: string };
  /** True when "my whole store" can be promoted (partners have a storefront). */
  allowWholeStore: boolean;
  load(): Promise<{ brand: string; items: StudioItem[] }>;
  link(target: number | 'ALL', channel: LinkChannel): Promise<StudioLink>;
}

const GALLERY_PAGE = 24;
// WHY a cap on one batch: every image is drawn and held in memory until the ZIP is written
// (~0.3-1 MB a PNG), and a partner's batch also asks the server for one tracked link per product.
// 40 keeps a batch well inside a mid-range phone's memory and finishes in seconds.
export const BULK_LIMIT = 40;
const SAVED_LIMIT = 60;
const SAVED = 'saved';

export function FlyerStudio(root: HTMLElement, source: StudioSource, query: Record<string, string> = {}) {
  const container = document.createElement('div');
  container.className = 'saler-page-container flyer-studio-page';

  let brand = '';
  let items: StudioItem[] = [];
  let selected: number | 'ALL' = query.product_id ? Number(query.product_id) : 'ALL';
  let format: FormatId = (query.format && query.format in FORMATS ? query.format : 'SQUARE') as FormatId;
  let occasionId = 'all';
  let galleryStart = 0;
  let shown = GALLERY_PAGE;
  let cursor = 0;
  let current: DesignRef = designAt(occasionById('all'), 0);
  let headlineCustom = '';
  let tagCustom = '';
  /** A tag chip the person picked; null = the design's own tag. */
  let tagIndex: number | null = null;
  let showPrice = true;
  let loading = true;
  let loadFailed = false;
  let captionEdited = false;

  const links = new Map<string, StudioLink>();
  let link: StudioLink | null = null;
  let linkState: 'loading' | 'ready' | 'error' = 'loading';
  let linkRequest = 0;

  // Product photos as data: URIs (null once a fetch failed).
  // WHY inlined for downloads: an SVG drawn into a canvas (the PNG) or opened as a file never loads
  // external images, so a linked photo would vanish from everything but the screen.
  const photos = new Map<string, string | null>();
  const pending = new Map<string, Promise<void>>();

  let observer: IntersectionObserver | null = null;
  let previewFrame = 0;

  const savedKey = `flyer-studio.saved.${source.role}`;
  let saved: string[] = readSaved();

  function readSaved(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem(savedKey) || '[]');
      return Array.isArray(raw) ? raw.filter((k) => parseDesignKey(k)).slice(0, SAVED_LIMIT) : [];
    } catch {
      return [];
    }
  }
  function writeSaved() {
    try { localStorage.setItem(savedKey, JSON.stringify(saved)); } catch { /* private mode: keeps working for this visit */ }
  }

  const isBn = () => getLanguage() === 'bn';
  const pick = (b: { en: string; bn: string }) => (isBn() ? b.bn || b.en : b.en || b.bn);
  const titleOf = (it: StudioItem) => (isBn() ? it.title_bn || it.title_en : it.title_en || it.title_bn);
  const otherTitle = (it: StudioItem) => (isBn() ? it.title_en : it.title_bn);
  const currentItem = () => (selected === 'ALL' ? null : items.find((i) => i.id === selected) || null);
  // Whole taka read better on a poster: "৳1,250", not "৳ 1,250.00".
  const money = (n: number | null) => (n ? formatCurrency(n, { symbol: '৳' }).replace(/[.][0০]{2}$/, '').replace(/^৳\s+/, '৳') : '');
  const channel = (): LinkChannel => (format === 'A4_PRINT' ? 'PRINT_FLYER' : 'QR_CODE');
  const occasion = (): Occasion => occasionById(occasionId === SAVED ? current.occasion : occasionId);

  // ── Gallery order ────────────────────────────────────────────────────────────────────────────
  const listSize = () => (occasionId === SAVED ? saved.length : designCount(occasionById(occasionId)));
  function designAtCursor(i: number): DesignRef {
    if (occasionId === SAVED) return parseDesignKey(saved[i]) || current;
    return designAt(occasionById(occasionId), galleryStart + i);
  }

  // ── Photos ───────────────────────────────────────────────────────────────────────────────────
  function loadPhoto(url: string): Promise<void> {
    if (photos.has(url)) return Promise.resolve();
    if (pending.has(url)) return pending.get(url)!;
    const job = (async () => {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP');
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) throw new Error('TYPE');
        photos.set(url, await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }));
      } catch {
        // A host without CORS keeps the drawn placeholder — the same picture on screen and in every file.
        photos.set(url, null);
      } finally {
        pending.delete(url);
      }
    })();
    pending.set(url, job);
    return job;
  }
  /** The photo to draw: the inlined copy once fetched, the URL while it loads, nothing if it failed. */
  function photoFor(url: string | null): string | null {
    if (!url) return null;
    if (photos.has(url)) return photos.get(url) ?? null;
    return url;
  }

  // ── Content ──────────────────────────────────────────────────────────────────────────────────
  /** Items in flyer order: the chosen product first, then others for the collage. */
  function flyerItems(target: number | 'ALL' = selected): StudioItem[] {
    const hero = target === 'ALL' ? null : items.find((i) => i.id === target) || null;
    const rest = items.filter((i) => i !== hero);
    return hero ? [hero, ...rest].slice(0, 4) : items.slice(0, 4);
  }

  function headlineFor(d: DesignRef): string {
    if (headlineCustom.trim()) return headlineCustom.trim();
    const occ = occasionById(d.occasion);
    return pick(occ.headlines[d.headline] || occ.headlines[0]);
  }
  function tagFor(d: DesignRef): string {
    if (tagCustom.trim()) return tagCustom.trim();
    const occ = occasionById(d.occasion);
    return pick(occ.tags[(tagIndex ?? d.headline) % occ.tags.length]);
  }

  /**
   * What a flyer shows. `target` and `qr` default to what is on screen; the bulk export passes
   * each product and its own link instead.
   */
  function contentFor(d: DesignRef, forExport: boolean, target: number | 'ALL' = selected, qr?: string): FlyerContent {
    const photo = (url: string | null) => (forExport ? (url ? photos.get(url) ?? null : null) : photoFor(url));
    const list = flyerItems(target);
    const asItem = (it: StudioItem): FlyerItem => ({ title: titleOf(it), subtitle: otherTitle(it), price: money(it.price), photo: photo(it.image_url) });
    let flyer: FlyerItem[];
    if (target !== 'ALL' || d.layout === 'collage') {
      flyer = list.map(asItem);
    } else {
      // The whole store: the store's own headline, shown with its first product's photo.
      flyer = [{ title: t('flyer.store_title'), subtitle: t('flyer.store_sub'), price: '', photo: photo(list[0]?.image_url ?? null) }, ...list.slice(1).map(asItem)];
    }
    return {
      brand: brand || t('flyer.brand_fallback'),
      brandLine: t(source.brandLineKey),
      headline: headlineFor(d),
      tag: tagFor(d),
      cta: t('flyer.cta'),
      scanLine: t('flyer.scan_line'),
      scanSub: t('flyer.scan_sub'),
      items: flyer.length ? flyer : [{ title: t('flyer.store_title'), price: '', photo: null }],
      qrText: qr ?? (linkState === 'ready' && link ? link.url : ''),
      showPrice,
    };
  }

  function designFor(d: DesignRef, fmt: FormatId = format) {
    return { layout: d.layout, palette: paletteById(d.palette), pattern: d.pattern, format: fmt };
  }

  /** A link for any product and channel, cached with the on-screen ones; does not touch the panel. */
  async function linkFor(target: number | 'ALL', ch: LinkChannel): Promise<StudioLink> {
    const key = `${target}|${ch}`;
    const cached = links.get(key);
    if (cached) return cached;
    const made = await source.link(target, ch);
    if (!made?.url) throw new Error('NO_LINK');
    links.set(key, made);
    return made;
  }

  function captionText(target: number | 'ALL' = selected, url = link?.url || ''): string {
    const occ = occasion();
    const item = target === 'ALL' ? null : items.find((i) => i.id === target) || null;
    const text = fillCaption(pick(occ.caption), {
      headline: headlineFor(current),
      product: item ? titleOf(item) : (brand || t('flyer.brand_fallback')),
      price: item && showPrice ? money(item.price) : '',
      link: url,
    });
    return `${text}\n\n${occ.hashtags}`;
  }

  // ── Links ────────────────────────────────────────────────────────────────────────────────────
  async function ensureLink() {
    const key = `${selected}|${channel()}`;
    const cached = links.get(key);
    if (cached) {
      link = cached;
      linkState = 'ready';
      refreshPanel();
      return;
    }
    const request = ++linkRequest;
    link = null;
    linkState = 'loading';
    refreshPanel();
    try {
      const made = await source.link(selected, channel());
      if (!made?.url) throw new Error('NO_LINK');
      if (request !== linkRequest) return;
      link = made;
      links.set(key, made);
      linkState = 'ready';
    } catch {
      if (request !== linkRequest) return;
      // WHY no placeholder link: a made-up code printed on a flyer sends every scan nowhere, so
      // downloads and sharing stay off until a real link exists.
      linkState = 'error';
    }
    refreshPanel();
  }

  // ── Load ─────────────────────────────────────────────────────────────────────────────────────
  async function loadData() {
    loading = true;
    loadFailed = false;
    render();
    try {
      const data = await source.load();
      brand = data.brand || '';
      items = data.items || [];
      if (selected !== 'ALL' && !items.some((i) => i.id === selected)) selected = 'ALL';
      if (selected === 'ALL' && !source.allowWholeStore) selected = items[0]?.id ?? 'ALL';
      const fromQuery = query.design ? parseDesignKey(query.design) : null;
      if (fromQuery) current = fromQuery;
    } catch (err) {
      loadFailed = true;
      toast.error((err as Error)?.message || t('flyer.load_failed'));
    } finally {
      loading = false;
      render();
    }
    if (!loadFailed && (items.length || source.allowWholeStore)) ensureLink();
  }

  // ── Render ───────────────────────────────────────────────────────────────────────────────────
  function render() {
    observer?.disconnect();
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="${source.back.href}">&lt; ${t(source.back.labelKey)}</a>
          <span>/</span>
          <span>${t(source.titleKey)}</span>
        </div>
        <h1 class="saler-header-row__title"><span aria-hidden="true">🎨</span><span>${t(source.titleKey)}</span></h1>
        <p class="saler-header-row__subtitle">${t(source.subtitleKey)}</p>
      </div>`;
    container.append(header);

    if (loading) {
      container.append(Skeleton({ width: '100%', height: '520px' }));
      return;
    }
    if (loadFailed) {
      const failed = document.createElement('div');
      failed.className = 'saler-card flyer-studio__empty';
      failed.innerHTML = `<p>${t('flyer.load_failed')}</p><button type="button" class="btn btn--md btn--primary">${t('flyer.retry')}</button>`;
      failed.querySelector('button')!.onclick = () => loadData();
      container.append(failed);
      return;
    }
    if (!items.length && !source.allowWholeStore) {
      const empty = document.createElement('div');
      empty.className = 'saler-card flyer-studio__empty';
      empty.innerHTML = `<p>${t(source.empty.textKey)}</p><a class="btn btn--md btn--primary" href="${source.empty.href}">${t(source.empty.ctaKey)}</a>`;
      container.append(empty);
      return;
    }

    const layout = document.createElement('div');
    layout.className = 'flyer-studio';
    layout.append(buildBrowser(), buildPanel());
    container.append(layout);
    renderGallery();
    refreshPanel();
  }

  function buildBrowser(): HTMLElement {
    const main = document.createElement('section');
    main.className = 'flyer-studio__browse';
    main.setAttribute('aria-label', t('flyer.gallery_label'));
    const productOptions = [
      source.allowWholeStore ? `<option value="ALL" ${selected === 'ALL' ? 'selected' : ''}>${t('flyer.whole_store')}</option>` : '',
      ...items.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(titleOf(p))}${p.price ? ` (${money(p.price)})` : ''}</option>`),
    ].join('');
    main.innerHTML = `
      <div class="flyer-studio__steps">
        <label class="flyer-studio__step">
          <span class="flyer-studio__label">${t('flyer.step_product')}</span>
          <select class="select" data-ref="product">${productOptions}</select>
          ${!items.length ? `<span class="flyer-studio__hint">${t(source.empty.textKey)} <a href="${source.empty.href}">${t(source.empty.ctaKey)}</a></span>` : ''}
        </label>
        <div class="flyer-studio__step">
          <span class="flyer-studio__label" id="flyer-size-label">${t('flyer.step_size')}</span>
          <div class="flyer-studio__sizes" role="group" aria-labelledby="flyer-size-label">
            ${(Object.keys(FORMATS) as FormatId[]).map((f) => `<button type="button" class="flyer-studio__size" data-format="${f}" aria-pressed="${f === format}"><span class="flyer-studio__size-shape flyer-studio__size-shape--${f.toLowerCase()}" aria-hidden="true"></span>${t(FORMATS[f].label)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="flyer-studio__step">
        <span class="flyer-studio__label" id="flyer-occasion-label">${t('flyer.step_occasion')}</span>
        <div class="flyer-studio__occasions" role="group" aria-labelledby="flyer-occasion-label">
          ${OCCASIONS.map((o) => `<button type="button" class="flyer-studio__chip" data-occasion="${o.id}" aria-pressed="${o.id === occasionId}"><span aria-hidden="true">${o.emoji}</span> ${escapeHtml(pick(o.label))}</button>`).join('')}
          <button type="button" class="flyer-studio__chip" data-occasion="${SAVED}" aria-pressed="${occasionId === SAVED}"><span aria-hidden="true">★</span> ${t('flyer.saved')} <span data-ref="saved-count">${saved.length ? `(${formatNumber(saved.length)})` : ''}</span></button>
        </div>
      </div>
      <div class="flyer-studio__gallery-head">
        <p class="flyer-studio__count" data-ref="count"></p>
        <button type="button" class="btn btn--sm btn--secondary" data-action="surprise">🎲 ${t('flyer.surprise')}</button>
      </div>
      <div class="flyer-studio__gallery flyer-studio__gallery--${format.toLowerCase()}" data-ref="gallery" role="list"></div>
      <div class="flyer-studio__more"><button type="button" class="btn btn--md btn--secondary" data-action="more">${t('flyer.show_more')}</button></div>
    `;

    main.querySelector<HTMLSelectElement>('[data-ref="product"]')!.onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      selected = v === 'ALL' ? 'ALL' : Number(v);
      captionEdited = false;
      renderGallery();
      ensureLink();
    };
    main.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((btn) => {
      btn.onclick = () => {
        const before = channel();
        format = btn.dataset.format as FormatId;
        main.querySelectorAll('[data-format]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const gallery = main.querySelector<HTMLElement>('[data-ref="gallery"]')!;
        gallery.className = `flyer-studio__gallery flyer-studio__gallery--${format.toLowerCase()}`;
        renderGallery();
        if (channel() !== before) ensureLink();
        else refreshPanel();
      };
    });
    main.querySelectorAll<HTMLButtonElement>('[data-occasion]').forEach((btn) => {
      btn.onclick = () => {
        occasionId = btn.dataset.occasion!;
        main.querySelectorAll('[data-occasion]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        galleryStart = 0;
        shown = GALLERY_PAGE;
        headlineCustom = '';
        tagCustom = '';
        tagIndex = null;
        captionEdited = false;
        if (listSize()) select(0, false);
        renderGallery();
      };
    });
    main.querySelector<HTMLElement>('[data-action="surprise"]')!.onclick = () => {
      const size = listSize();
      if (!size) return;
      galleryStart = occasionId === SAVED ? 0 : Math.floor(Math.random() * size);
      shown = GALLERY_PAGE;
      select(occasionId === SAVED ? Math.floor(Math.random() * size) : 0, true);
      renderGallery();
    };
    main.querySelector<HTMLElement>('[data-action="more"]')!.onclick = () => {
      shown += GALLERY_PAGE;
      renderGallery(true);
    };
    return main;
  }

  /** (Re)builds the gallery cards. `append` keeps the cards already drawn. */
  function renderGallery(append = false) {
    const gallery = container.querySelector<HTMLElement>('[data-ref="gallery"]');
    if (!gallery) return;
    const size = listSize();
    const count = Math.min(shown, size);
    const countEl = container.querySelector<HTMLElement>('[data-ref="count"]')!;
    countEl.textContent = occasionId === SAVED
      ? (size ? t('flyer.saved_count', { count: size }) : '')
      : t('flyer.design_count', { count: formatNumber(size) });
    const more = container.querySelector<HTMLElement>('.flyer-studio__more')!;
    more.hidden = count >= size;

    if (!append) {
      observer?.disconnect();
      gallery.innerHTML = '';
    }
    if (!size) {
      gallery.innerHTML = `<p class="flyer-studio__hint flyer-studio__saved-empty">${t('flyer.saved_empty')}</p>`;
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          drawThumb(entry.target as HTMLElement);
          observer!.unobserve(entry.target);
        }
      }, { rootMargin: '300px 0px' });
    }
    const from = append ? gallery.children.length : 0;
    const frag = document.createDocumentFragment();
    for (let i = from; i < count; i += 1) {
      const d = designAtCursor(i);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'flyer-studio__thumb';
      card.setAttribute('role', 'listitem');
      card.dataset.index = String(i);
      card.dataset.key = designKey(d);
      card.setAttribute('aria-label', t('flyer.design_label', { n: i + 1, palette: pick(paletteById(d.palette).name) }));
      card.setAttribute('aria-pressed', String(designKey(d) === designKey(current)));
      card.onclick = () => {
        select(i, true);
        // On a narrow screen the preview sits below the gallery; bring it into view. On a wide one it
        // is sticky beside the gallery and already visible, so nothing moves.
        const panel = container.querySelector<HTMLElement>('.flyer-studio__panel');
        const box = panel?.getBoundingClientRect();
        if (panel && box && (box.top > window.innerHeight * 0.6 || box.bottom < 0)) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      frag.append(card);
      observer.observe(card);
    }
    gallery.append(frag);
  }

  function drawThumb(card: HTMLElement) {
    const d = parseDesignKey(card.dataset.key || '');
    if (!d) return;
    card.innerHTML = renderFlyer(designFor(d), contentFor(d, false), { uid: `t${card.dataset.index}`, draft: true });
  }

  function select(i: number, refresh: boolean) {
    cursor = Math.max(0, Math.min(listSize() - 1, i));
    current = designAtCursor(cursor);
    captionEdited = false;
    if (!refresh) return;
    const key = designKey(current);
    container.querySelectorAll<HTMLElement>('.flyer-studio__thumb').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === key)));
    refreshPanel();
  }

  function buildPanel(): HTMLElement {
    const panel = document.createElement('aside');
    panel.className = 'flyer-studio__panel';
    panel.setAttribute('aria-label', t('flyer.panel_label'));
    panel.innerHTML = `
      <div class="flyer-studio__preview-head">
        <button type="button" class="btn btn--sm btn--ghost" data-action="prev" aria-label="${t('flyer.prev')}">‹</button>
        <span class="flyer-studio__preview-title" data-ref="preview-title"></span>
        <button type="button" class="btn btn--sm btn--ghost" data-action="next" aria-label="${t('flyer.next')}">›</button>
      </div>
      <div class="flyer-studio__preview flyer-studio__preview--${format.toLowerCase()}" data-ref="preview" role="img" aria-label="${t('flyer.preview_label')}"></div>
      <button type="button" class="flyer-studio__save" data-action="save" aria-pressed="false"></button>

      <div class="flyer-studio__edit">
        <label class="flyer-studio__field">
          <span class="flyer-studio__label">${t('flyer.headline')}</span>
          <select class="select" data-ref="headline-pick"></select>
          <input class="input" type="text" maxlength="48" data-ref="headline" placeholder="${t('flyer.headline_custom')}" />
        </label>
        <div class="flyer-studio__field">
          <span class="flyer-studio__label" id="flyer-tag-label">${t('flyer.tag')}</span>
          <div class="flyer-studio__tags" role="group" aria-labelledby="flyer-tag-label" data-ref="tags"></div>
          <input class="input" type="text" maxlength="24" data-ref="tag" placeholder="${t('flyer.tag_custom')}" aria-label="${t('flyer.tag_custom')}" />
        </div>
        <label class="flyer-studio__check"><input type="checkbox" data-ref="price" ${showPrice ? 'checked' : ''} /> ${t('flyer.show_price')}</label>
      </div>

      <div class="flyer-studio__actions">
        <button type="button" class="btn btn--md btn--primary btn--full" data-action="png">⬇ ${t('flyer.download_png')}</button>
        <button type="button" class="btn btn--md btn--secondary btn--full" data-action="share-image" hidden>📲 ${t('flyer.share_image')}</button>
        <div class="flyer-studio__share">
          <a target="_blank" rel="noopener noreferrer" class="btn-social btn-social--whatsapp" data-share="whatsapp">${t('flyer.share_whatsapp')}</a>
          <a target="_blank" rel="noopener noreferrer" class="btn-social btn-social--facebook" data-share="facebook">${t('flyer.share_facebook')}</a>
        </div>
      </div>

      <div class="flyer-studio__field">
        <span class="flyer-studio__label">${t('flyer.caption')}</span>
        <textarea class="textarea flyer-studio__caption" rows="4" data-ref="caption" aria-label="${t('flyer.caption')}"></textarea>
        <button type="button" class="btn btn--sm btn--secondary" data-action="copy-caption">${t('flyer.copy_caption')}</button>
      </div>

      <div class="flyer-studio__link">
        <span class="flyer-studio__label">${t('flyer.link_title')}</span>
        <div class="flyer-studio__link-row">
          <input type="text" readonly class="input flyer-studio__url" data-ref="url" aria-label="${t('flyer.link_title')}" />
          <button type="button" class="btn btn--sm btn--primary" data-action="copy-link">${t('flyer.copy_link')}</button>
        </div>
        <p class="flyer-studio__error" data-ref="link-error" hidden>${t('flyer.link_failed')} <button type="button" class="btn btn--sm btn--secondary" data-action="retry-link">${t('flyer.retry')}</button></p>
        <p class="flyer-studio__hint">${t(source.linkNoteKey)}</p>
      </div>

      <div class="flyer-studio__bulk">
        <span class="flyer-studio__label">${t('flyer.bulk_title')}</span>
        <button type="button" class="btn btn--sm btn--secondary btn--full" data-action="bulk-products" ${items.length < 2 ? 'hidden' : ''}>🗂 ${t('flyer.bulk_products', { count: Math.min(items.length, BULK_LIMIT) })}</button>
        <button type="button" class="btn btn--sm btn--secondary btn--full" data-action="bulk-sizes">📐 ${t('flyer.bulk_sizes')}</button>
        ${items.length > BULK_LIMIT ? `<p class="flyer-studio__hint">${t('flyer.bulk_limit', { count: BULK_LIMIT })}</p>` : ''}
        <div class="flyer-studio__progress" data-ref="bulk-progress" hidden>
          <progress max="1" value="0" data-ref="bulk-bar" aria-label="${t('flyer.bulk_title')}"></progress>
          <span role="status" aria-live="polite" data-ref="bulk-text"></span>
          <button type="button" class="btn btn--sm btn--ghost" data-action="bulk-cancel">${t('flyer.bulk_cancel')}</button>
        </div>
      </div>

      <div class="flyer-studio__secondary">
        <button type="button" class="btn btn--sm btn--ghost" data-action="svg">${t('flyer.download_svg')}</button>
        <button type="button" class="btn btn--sm btn--ghost" data-action="print">${t('flyer.print')}</button>
      </div>
    `;

    const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
    q('[data-action="prev"]').onclick = () => step(-1);
    q('[data-action="next"]').onclick = () => step(1);
    q('[data-action="save"]').onclick = toggleSaved;
    q<HTMLSelectElement>('[data-ref="headline-pick"]').onchange = (e) => {
      const idx = Number((e.target as HTMLSelectElement).value);
      headlineCustom = '';
      q<HTMLInputElement>('[data-ref="headline"]').value = '';
      current = { ...current, headline: idx };
      captionEdited = false;
      refreshPanel();
    };
    q<HTMLInputElement>('[data-ref="headline"]').oninput = (e) => {
      headlineCustom = (e.target as HTMLInputElement).value;
      captionEdited = false;
      schedulePreview();
    };
    q<HTMLInputElement>('[data-ref="tag"]').oninput = (e) => {
      tagCustom = (e.target as HTMLInputElement).value;
      panel.querySelectorAll('[data-tag]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      schedulePreview();
    };
    q<HTMLInputElement>('[data-ref="price"]').onchange = (e) => {
      showPrice = (e.target as HTMLInputElement).checked;
      captionEdited = false;
      schedulePreview();
    };
    q<HTMLTextAreaElement>('[data-ref="caption"]').oninput = () => { captionEdited = true; };
    q('[data-action="png"]').onclick = downloadPng;
    q('[data-action="share-image"]').onclick = shareImage;
    q('[data-action="svg"]').onclick = downloadSvg;
    q('[data-action="print"]').onclick = printFlyer;
    q('[data-action="copy-caption"]').onclick = () => copyText(q<HTMLTextAreaElement>('[data-ref="caption"]').value, t('flyer.caption_copied'));
    q('[data-action="copy-link"]').onclick = () => link && copyText(link.url, t('flyer.link_copied'));
    q('[data-action="retry-link"]').onclick = () => ensureLink();
    q('[data-action="bulk-products"]').onclick = () => runBulk('products');
    q('[data-action="bulk-sizes"]').onclick = () => runBulk('sizes');
    q('[data-action="bulk-cancel"]').onclick = () => {
      // The image being drawn finishes first; say so at once instead of looking frozen.
      bulkCancelled = true;
      q('[data-ref="bulk-text"]').textContent = t('flyer.bulk_stopping');
      q<HTMLButtonElement>('[data-action="bulk-cancel"]').disabled = true;
    };
    panel.querySelectorAll<HTMLAnchorElement>('[data-share]').forEach((a) => {
      a.addEventListener('click', (e) => { if (linkState !== 'ready') e.preventDefault(); });
    });
    // WHY feature-detected: sharing an image file needs the Web Share API level 2 (phones, some
    // desktops). Where it exists, this is the one-tap path straight into WhatsApp or Facebook.
    try {
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [probe] })) q('[data-action="share-image"]').hidden = false;
    } catch { /* File constructor missing: keep the button hidden */ }
    return panel;
  }

  function step(dir: number) {
    const size = listSize();
    if (!size) return;
    const next = (cursor + dir + size) % size;
    if (next >= shown && occasionId !== SAVED) {
      shown = next + 1;
      renderGallery(true);
    }
    select(next, true);
  }

  function toggleSaved() {
    const key = designKey(current);
    const idx = saved.indexOf(key);
    if (idx >= 0) {
      saved.splice(idx, 1);
      toast.success(t('flyer.unsaved'));
    } else {
      saved.unshift(key);
      saved = saved.slice(0, SAVED_LIMIT);
      toast.success(t('flyer.saved_toast'));
    }
    writeSaved();
    const countEl = container.querySelector('[data-ref="saved-count"]');
    if (countEl) countEl.textContent = saved.length ? `(${formatNumber(saved.length)})` : '';
    if (occasionId === SAVED) {
      shown = Math.max(shown, GALLERY_PAGE);
      renderGallery();
    }
    refreshPanel();
  }

  function schedulePreview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      refreshPanel();
    });
  }

  /** Updates the preview, edit controls, link box and action states without rebuilding the page. */
  function refreshPanel() {
    const panel = container.querySelector<HTMLElement>('.flyer-studio__panel');
    if (!panel) return;
    const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
    // Inline the photos this design will draw; the preview redraws when they arrive.
    const urls = flyerItems().map((i) => i.image_url).filter((u): u is string => !!u);
    urls.filter((u) => !photos.has(u) && !pending.has(u)).forEach((u) => loadPhoto(u).then(() => schedulePreview()));

    const occ = occasionById(current.occasion);
    const ready = linkState === 'ready' && !!link;

    q('[data-ref="preview-title"]').textContent = `${pick(occ.label)} · ${pick(paletteById(current.palette).name)} · ${t(FORMATS[format].label)}`;
    const preview = q('[data-ref="preview"]');
    preview.className = `flyer-studio__preview flyer-studio__preview--${format.toLowerCase()}`;
    preview.innerHTML = renderFlyer(designFor(current), contentFor(current, false), { uid: 'preview' });

    const isSaved = saved.includes(designKey(current));
    const save = q('[data-action="save"]');
    save.setAttribute('aria-pressed', String(isSaved));
    save.textContent = isSaved ? `★ ${t('flyer.saved_button')}` : `☆ ${t('flyer.save_button')}`;

    const headPick = q<HTMLSelectElement>('[data-ref="headline-pick"]');
    headPick.innerHTML = occ.headlines.map((h, i) => `<option value="${i}" ${i === current.headline ? 'selected' : ''}>${escapeHtml(pick(h))}</option>`).join('');
    const tags = q('[data-ref="tags"]');
    const activeTag = tagCustom.trim() ? -1 : (tagIndex ?? current.headline) % occ.tags.length;
    tags.innerHTML = occ.tags.map((tg, i) => `<button type="button" class="flyer-studio__chip flyer-studio__chip--sm" data-tag="${i}" aria-pressed="${i === activeTag}">${escapeHtml(pick(tg))}</button>`).join('');
    tags.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((btn) => {
      btn.onclick = () => {
        tagCustom = '';
        q<HTMLInputElement>('[data-ref="tag"]').value = '';
        tagIndex = Number(btn.dataset.tag);
        refreshPanel();
      };
    });

    if (!captionEdited) q<HTMLTextAreaElement>('[data-ref="caption"]').value = captionText();

    q<HTMLInputElement>('[data-ref="url"]').value = ready ? link!.url : (linkState === 'loading' ? t('flyer.link_creating') : '');
    q('[data-ref="link-error"]').hidden = linkState !== 'error';
    panel.querySelectorAll<HTMLButtonElement>('[data-action="png"], [data-action="svg"], [data-action="print"], [data-action="share-image"], [data-action="copy-link"]').forEach((b) => { b.disabled = !ready; });
    panel.querySelectorAll<HTMLButtonElement>('[data-action="bulk-products"], [data-action="bulk-sizes"]').forEach((b) => { b.disabled = !ready || bulkRunning; });

    const wa = q<HTMLAnchorElement>('[data-share="whatsapp"]');
    const fb = q<HTMLAnchorElement>('[data-share="facebook"]');
    [wa, fb].forEach((a) => a.setAttribute('aria-disabled', String(!ready)));
    if (ready) {
      const caption = q<HTMLTextAreaElement>('[data-ref="caption"]').value;
      wa.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(caption)}`;
      fb.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link!.url)}`;
    } else {
      wa.removeAttribute('href');
      fb.removeAttribute('href');
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────────────────────
  /** The downloadable SVG: photos inlined, the real QR. Defaults to what is on screen. */
  async function exportSvg(target: number | 'ALL' = selected, fmt: FormatId = format, qr?: string): Promise<string> {
    await Promise.all(flyerItems(target).map((i) => (i.image_url ? loadPhoto(i.image_url) : null)));
    return renderFlyer(designFor(current, fmt), contentFor(current, true, target, qr), { uid: 'x' });
  }

  function fileName(ext: string) {
    const target = selected === 'ALL' ? 'store' : selected;
    return `explooro-${source.role}-${target}-${current.layout}-${format.toLowerCase()}.${ext}`;
  }

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    // WHY a delay: revoking in the same tick can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function pngBlob(svg?: string, fmt: FormatId = format): Promise<Blob> {
    const { width, height } = FORMATS[fmt];
    const url = URL.createObjectURL(new Blob([svg ?? await exportSvg()], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('IMG')); img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // -- Bulk export ------------------------------------------------------------------------------
  let bulkRunning = false;
  let bulkCancelled = false;

  /** "Jamdani Saree (Red)" -> "jamdani-saree-red"; Bangla letters are kept (ZIP names are UTF-8). */
  function slug(text: string): string {
    return String(text || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'flyer';
  }

  /**
   * One ZIP of flyers in the chosen design: either every product (one image each, up to BULK_LIMIT)
   * or this flyer in all four sizes. Each image gets its own QR link (a partner's tracked link per
   * product, and the print channel for the A4 poster, exactly as a single download would) and the
   * ZIP carries a captions.txt with every image's ready post text.
   *
   * WHY one image at a time: drawing them all at once would hold every canvas in memory together;
   * in sequence only the finished PNG bytes accumulate, and the progress bar can say where it is.
   */
  async function runBulk(kind: 'products' | 'sizes') {
    if (bulkRunning) return;
    const jobs: { target: number | 'ALL'; fmt: FormatId }[] = kind === 'products'
      ? items.slice(0, BULK_LIMIT).map((it) => ({ target: it.id, fmt: format }))
      : (Object.keys(FORMATS) as FormatId[]).map((fmt) => ({ target: selected, fmt }));
    if (!jobs.length) return;
    bulkRunning = true;
    bulkCancelled = false;
    const box = container.querySelector<HTMLElement>('[data-ref="bulk-progress"]')!;
    const bar = container.querySelector<HTMLProgressElement>('[data-ref="bulk-bar"]')!;
    const text = container.querySelector<HTMLElement>('[data-ref="bulk-text"]')!;
    box.hidden = false;
    container.querySelector<HTMLButtonElement>('[data-action="bulk-cancel"]')!.disabled = false;
    bar.max = jobs.length;
    refreshPanel();
    const entries: ZipEntry[] = [];
    const captions: string[] = [];
    let failed = 0;
    try {
      for (const [i, job] of jobs.entries()) {
        if (bulkCancelled) break;
        bar.value = i;
        text.textContent = t('flyer.bulk_progress', { done: i + 1, total: jobs.length });
        const item = job.target === 'ALL' ? null : items.find((it) => it.id === job.target) || null;
        try {
          const ch: LinkChannel = job.fmt === 'A4_PRINT' ? 'PRINT_FLYER' : 'QR_CODE';
          const url = (await linkFor(job.target, ch)).url;
          const png = await pngBlob(await exportSvg(job.target, job.fmt, url), job.fmt);
          const label = item ? titleOf(item) : (brand || 'store');
          const name = `${String(i + 1).padStart(2, '0')}-${slug(label)}-${job.fmt.toLowerCase()}.png`;
          entries.push({ name, data: new Uint8Array(await png.arrayBuffer()) });
          captions.push(`${name}\n${captionText(job.target, url)}`);
        } catch {
          // One product without a link or an image must not sink the whole batch.
          failed += 1;
        }
      }
      if (bulkCancelled) {
        toast.info(t('flyer.bulk_cancelled'));
        return;
      }
      if (!entries.length) {
        toast.error(t('flyer.bulk_failed'));
        return;
      }
      bar.value = jobs.length;
      text.textContent = t('flyer.bulk_zipping');
      entries.push({ name: 'captions.txt', data: new TextEncoder().encode(`${captions.join('\n\n----------\n\n')}\n`) });
      const what = kind === 'products' ? 'all-products' : (selected === 'ALL' ? 'store' : slug(titleOf(currentItem()!)));
      saveBlob(zipBlob(entries), `explooro-${source.role}-${what}-${current.layout}-${kind === 'products' ? format.toLowerCase() : 'all-sizes'}.zip`);
      toast.success(failed
        ? t('flyer.bulk_done_partial', { count: entries.length - 1, failed })
        : t('flyer.bulk_done', { count: entries.length - 1 }));
    } finally {
      bulkRunning = false;
      box.hidden = true;
      refreshPanel();
    }
  }

  async function withBusy(action: string, job: () => Promise<void>) {
    const btn = container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (btn) btn.disabled = true;
    try {
      await job();
    } finally {
      if (btn) btn.disabled = !(linkState === 'ready' && link);
    }
  }

  function downloadPng() {
    return withBusy('png', async () => {
      try {
        saveBlob(await pngBlob(), fileName('png'));
        toast.success(t('flyer.download_started'));
      } catch {
        toast.error(t('flyer.png_failed'));
      }
    });
  }

  function shareImage() {
    return withBusy('share-image', async () => {
      try {
        const file = new File([await pngBlob()], fileName('png'), { type: 'image/png' });
        const caption = container.querySelector<HTMLTextAreaElement>('[data-ref="caption"]')?.value || '';
        await navigator.share({ files: [file], text: caption });
      } catch (err) {
        // The person closing the share sheet is not an error.
        if ((err as Error)?.name !== 'AbortError') toast.error(t('flyer.share_failed'));
      }
    });
  }

  async function downloadSvg() {
    saveBlob(new Blob([await exportSvg()], { type: 'image/svg+xml;charset=utf-8' }), fileName('svg'));
    toast.success(t('flyer.download_started'));
  }

  /** Prints the flyer alone (not the page around it) from a hidden frame. */
  async function printFlyer() {
    const svg = await exportSvg();
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const pageSize = format === 'A4_PRINT' ? 'A4' : 'auto';
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(fileName('pdf'))}</title><style>@page{size:${pageSize};margin:0}html,body{margin:0}svg{display:block;width:100%;height:auto;max-height:100vh}</style></head><body>${svg}</body></html>`);
    doc.close();
    requestAnimationFrame(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 1000);
    });
  }

  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error(t('flyer.copy_failed'));
    }
  }

  const unsubscribeLang = subscribeLang(() => render());
  loadData();
  root.append(container);

  return () => {
    unsubscribeLang?.();
    observer?.disconnect();
    if (previewFrame) cancelAnimationFrame(previewFrame);
    linkRequest += 1;
    bulkCancelled = true;
    container.remove();
  };
}
