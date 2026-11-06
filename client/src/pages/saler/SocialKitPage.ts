/**
 * SocialKitPage.ts — Viral Social Explooro Partner Marketing Toolkit & Flyer Studio (Prompt 9.7 / §AL.2).
 *
 * Route: /saler/social-kit
 * Implements:
 * 1. Multi-format vector flyer generator (1:1 Square, 9:16 WhatsApp Story, A4 Print Poster, Banner).
 * 2. 4 Premium Theme styles (Dark Luxe, Clean Minimal, Neo-Bangla Gold, Bengali Festive).
 * 3. Promotional banner tag selector (Flash Sale, Free Delivery, Limited Stock, Eid Special, Best Seller).
 * 4. A real, scannable QR code (lib/qr.ts, encoded locally) of the tracked affiliate short link.
 * 5. SVG and PNG download, flyer-only print, instant WhatsApp & Facebook sharing.
 *
 * The product list and the store name come from GET /saler/store (the partner's own curated items),
 * so the flyer always advertises a product the partner really sells, under their real store name.
 */

import { salerApi } from '../../services/saler.api.ts';
import { getMyStore } from '../../services/store.api.ts';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import { escapeHtml } from '../../services/html.ts';
import { formatCurrency } from '../../services/format.ts';
import { qrSvgGroup } from '../../lib/qr.ts';
import { Skeleton } from '../../components/ui/Skeleton.ts';
import type { PageContext } from '../types.ts';
import '../../styles/components/social-kit.css';

type Format = 'SQUARE' | 'STORY' | 'A4_PRINT' | 'BANNER';
type Theme = 'DARK' | 'MINIMAL' | 'GOLD' | 'FESTIVE';
type Promo = 'FLASH_SALE' | 'FREE_DELIVERY' | 'LIMITED_STOCK' | 'SPECIAL_EID' | 'BEST_SELLER';

interface KitItem {
  product_id: number;
  title_en: string;
  title_bn: string;
  price: number | null;
  image_url: string | null;
}

interface KitLink {
  code: string;
  full_url: string;
}

const FORMATS: Record<Format, { width: number; height: number; label: string; preview: string }> = {
  SQUARE: { width: 1080, height: 1080, label: 'social_kit.format_square', preview: '360px' },
  STORY: { width: 1080, height: 1920, label: 'social_kit.format_story', preview: '280px' },
  A4_PRINT: { width: 1240, height: 1754, label: 'social_kit.format_print', preview: '320px' },
  BANNER: { width: 1200, height: 630, label: 'social_kit.format_banner', preview: '520px' },
};

const THEMES: Record<Theme, { label: string; bg: string; card: string; accent: string; onAccent: string; text: string; muted: string; price: string }> = {
  DARK: { label: 'social_kit.theme_dark', bg: '#0f172a', card: '#1e293b', accent: '#38bdf8', onAccent: '#0f172a', text: '#f8fafc', muted: '#94a3b8', price: '#4ade80' },
  MINIMAL: { label: 'social_kit.theme_minimal', bg: '#ffffff', card: '#f1f5f9', accent: '#1d4ed8', onAccent: '#ffffff', text: '#0f172a', muted: '#475569', price: '#15803d' },
  GOLD: { label: 'social_kit.theme_gold', bg: '#1a130b', card: '#2e200e', accent: '#f59e0b', onAccent: '#1a130b', text: '#fef3c7', muted: '#fbbf24', price: '#fde68a' },
  FESTIVE: { label: 'social_kit.theme_festive', bg: '#450a0a', card: '#7f1d1d', accent: '#fbbf24', onAccent: '#450a0a', text: '#fef2f2', muted: '#fecaca', price: '#fde047' },
};

const PROMOS: Promo[] = ['FLASH_SALE', 'FREE_DELIVERY', 'LIMITED_STOCK', 'SPECIAL_EID', 'BEST_SELLER'];
const PROMO_LABEL: Record<Promo, string> = {
  FLASH_SALE: 'social_kit.badge_flash_sale',
  FREE_DELIVERY: 'social_kit.badge_free_delivery',
  LIMITED_STOCK: 'social_kit.badge_limited_stock',
  SPECIAL_EID: 'social_kit.badge_special_eid',
  BEST_SELLER: 'social_kit.badge_best_seller',
};

// WHY a stack and not the page font: a downloaded SVG/PNG is opened outside the app, so it can only
// use fonts installed on the viewer's device. Noto Sans Bengali / Nirmala UI cover Bangla on
// Android and Windows.
const FONT_STACK = "'Segoe UI', 'Noto Sans Bengali', 'Nirmala UI', Roboto, system-ui, sans-serif";

/** Splits `text` into at most `maxLines` lines of roughly `maxWidth` px, ellipsising the last one. */
function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  // WHY an estimate: SVG text cannot wrap and there is no layout engine when the file is downloaded.
  // 0.56em is a slightly generous average glyph width for both Latin and Bangla at bold weight.
  const perLine = Math.max(4, Math.floor(maxWidth / (fontSize * 0.56)));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.length >= perLine ? last.slice(0, perLine - 1) : last}…`;
  }
  return lines;
}

function textLines(lines: string[], x: number, y: number, fontSize: number, attrs: string): string {
  return lines.map((line, i) => `<text x="${x}" y="${y + i * fontSize * 1.25}" font-size="${fontSize}" ${attrs}>${escapeHtml(line)}</text>`).join('');
}

export default function SocialKitPage(root: HTMLElement, { query }: PageContext = {}) {
  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let items: KitItem[] = [];
  let shopName = '';
  let storeSlug = '';
  let selected: number | 'ALL' = query?.product_id ? Number(query.product_id) : 'ALL';
  let format: Format = 'SQUARE';
  let theme: Theme = 'DARK';
  let promo: Promo = 'FLASH_SALE';
  let loading = true;
  let loadFailed = false;
  // One tracked link per product and channel, so switching back and forth does not mint new ones.
  const links = new Map<string, KitLink>();
  let link: KitLink | null = null;
  let linkState: 'loading' | 'ready' | 'error' = 'loading';
  let linkRequest = 0;
  // Product photos as data: URIs, keyed by URL; null once a fetch failed.
  // WHY inlined and not linked: an SVG drawn into a canvas (the PNG download) or opened as a file
  // never loads external images, so a linked photo would vanish from everything but the preview.
  const photos = new Map<string, string | null>();

  async function loadPhoto(url: string) {
    if (photos.has(url)) return;
    photos.set(url, null);
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return;
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      photos.set(url, dataUri);
      if (currentItem()?.image_url === url) refresh();
    } catch {
      // A host without CORS keeps the placeholder: same picture in the preview and every download.
    }
  }

  const isBn = () => getLanguage() === 'bn';
  const itemTitle = (item: KitItem) => (isBn() ? item.title_bn || item.title_en : item.title_en || item.title_bn);
  const currentItem = () => (selected === 'ALL' ? null : items.find((i) => i.product_id === selected) || null);
  // Only the values the short_links CHECK constraint accepts (migration 027).
  const channel = () => (format === 'A4_PRINT' ? 'PRINT_FLYER' : 'QR_CODE');

  async function loadData() {
    loading = true;
    loadFailed = false;
    render();
    try {
      const data = await getMyStore();
      shopName = data?.store?.shop_name || '';
      storeSlug = data?.store?.slug || '';
      const seen = new Set<number>();
      items = [];
      for (const shelf of data?.shelves || []) {
        for (const it of shelf?.items || []) {
          const id = Number(it.product_id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const price = Number(it.custom_retail_price ?? it.default_retail_price ?? it.price);
          items.push({ product_id: id, title_en: it.title_en || '', title_bn: it.title_bn || '', price: Number.isFinite(price) && price > 0 ? price : null, image_url: typeof it.image_url === 'string' && it.image_url ? it.image_url : null });
        }
      }
      if (selected !== 'ALL' && !items.some((i) => i.product_id === selected)) selected = 'ALL';
    } catch (err) {
      loadFailed = true;
      toast.error(err?.message || t('social_kit.load_failed'));
    } finally {
      loading = false;
      render();
    }
    if (!loadFailed) ensureLink();
  }

  async function ensureLink() {
    const key = `${selected}|${channel()}`;
    const cached = links.get(key);
    if (cached) {
      link = cached;
      linkState = 'ready';
      refresh();
      return;
    }
    const request = ++linkRequest;
    link = null;
    linkState = 'loading';
    refresh();
    try {
      const res = await salerApi.createSocialKitLink(
        selected === 'ALL'
          // WHY an explicit target: without one the server builds /store/<numeric id>, which is not a
          // storefront route; storefronts are addressed by slug.
          ? { source_channel: channel(), target_url: storeSlug ? `/store/${storeSlug}` : undefined }
          : { product_id: selected, source_channel: channel() },
      );
      const data = res?.data || res;
      if (!data?.code || !data?.full_url) throw new Error('NO_LINK');
      if (request !== linkRequest) return;
      link = { code: data.code, full_url: data.full_url };
      links.set(key, link);
      linkState = 'ready';
    } catch {
      if (request !== linkRequest) return;
      // WHY no placeholder link: a made-up code printed on a flyer would send every scan nowhere and
      // credit nobody, so the share and download actions stay off until a real link exists.
      linkState = 'error';
    }
    refresh();
  }

  function choiceButton(group: string, value: string, label: string, active: boolean) {
    return `<button type="button" class="btn btn--sm ${active ? 'btn--primary' : 'btn--secondary'} social-kit-studio__choice" data-${group}="${value}" aria-pressed="${active}">${label}</button>`;
  }

  function render() {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="/saler">&lt; ${t('saler.dashboard.title', 'Dashboard')}</a>
          <span>/</span>
          <span>${t('social_kit.title')}</span>
        </div>
        <h1 class="saler-header-row__title"><span aria-hidden="true">🎨</span><span>${t('social_kit.title')}</span></h1>
        <p class="saler-header-row__subtitle">${t('social_kit.subtitle')}</p>
      </div>
    `;
    container.append(header);

    if (loading) {
      container.append(Skeleton({ width: '100%', height: '480px' }));
      return;
    }

    if (loadFailed) {
      const failed = document.createElement('div');
      failed.className = 'saler-card social-kit-studio__empty';
      failed.innerHTML = `<p>${t('social_kit.load_failed')}</p><button type="button" class="btn btn--md btn--primary">${t('social_kit.btn_retry')}</button>`;
      failed.querySelector('button').onclick = () => loadData();
      container.append(failed);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'saler-social-kit-grid';

    const controls = document.createElement('div');
    controls.className = 'saler-flyer-controls social-kit-studio';
    controls.innerHTML = `
      <div class="social-kit-studio__group">
        <label for="select-product" class="social-kit-studio__label">${t('social_kit.select_product')}</label>
        <select id="select-product" class="select">
          <option value="ALL">${t('social_kit.entire_store_opt')}</option>
          ${items.map((p) => `<option value="${p.product_id}" ${p.product_id === selected ? 'selected' : ''}>${escapeHtml(itemTitle(p))}${p.price ? ` (${formatCurrency(p.price, { symbol: '৳' })})` : ''}</option>`).join('')}
        </select>
        ${items.length === 0 ? `<p class="social-kit-studio__hint">${t('social_kit.no_products')} <a href="/saler/sourcing">${t('social_kit.no_products_cta')}</a></p>` : ''}
      </div>

      <fieldset class="social-kit-studio__group">
        <legend class="social-kit-studio__label">${t('social_kit.format_title')}</legend>
        <div class="social-kit-studio__choices">
          ${(Object.keys(FORMATS) as Format[]).map((f) => choiceButton('fmt', f, t(FORMATS[f].label), format === f)).join('')}
        </div>
      </fieldset>

      <fieldset class="social-kit-studio__group">
        <legend class="social-kit-studio__label">${t('social_kit.theme_title')}</legend>
        <div class="social-kit-studio__choices">
          ${(Object.keys(THEMES) as Theme[]).map((th) => choiceButton('thm', th, t(THEMES[th].label), theme === th)).join('')}
        </div>
      </fieldset>

      <fieldset class="social-kit-studio__group">
        <legend class="social-kit-studio__label">${t('social_kit.badge_picker_title')}</legend>
        <div class="social-kit-studio__chips">
          ${PROMOS.map((p) => `<button type="button" class="social-kit-studio__chip" data-promo="${p}" aria-pressed="${promo === p}">${t(PROMO_LABEL[p])}</button>`).join('')}
        </div>
      </fieldset>

      <div class="social-kit-studio__link">
        <div class="social-kit-studio__link-head">
          <span class="social-kit-studio__label">${t('social_kit.link_box_title')}</span>
          <span class="badge badge--sm badge--brand social-kit-studio__code" data-slot="code"></span>
        </div>
        <div class="social-kit-studio__link-row">
          <input type="text" readonly aria-label="${t('social_kit.link_input_label')}" class="input social-kit-studio__url" data-slot="url" />
          <button type="button" class="btn btn--sm btn--primary" data-action="copy">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>
            ${t('social_kit.btn_copy_link')}
          </button>
        </div>
        <p class="social-kit-studio__error" data-slot="link-error" hidden>
          ${t('social_kit.link_failed')}
          <button type="button" class="btn btn--sm btn--secondary" data-action="retry-link">${t('social_kit.btn_retry')}</button>
        </p>
      </div>

      <div class="social-kit-studio__group social-kit-studio__group--divided">
        <span class="social-kit-studio__label">${t('social_kit.instant_share_title')}</span>
        <div class="social-kit-studio__share">
          <a target="_blank" rel="noopener noreferrer" class="btn-social btn-social--whatsapp" data-share="whatsapp">${t('social_kit.btn_share_whatsapp')}</a>
          <a target="_blank" rel="noopener noreferrer" class="btn-social btn-social--facebook" data-share="facebook">${t('social_kit.btn_share_facebook')}</a>
        </div>
      </div>

      <div class="social-kit-studio__downloads">
        <button type="button" class="btn btn--md btn--primary btn--full" data-action="download-png">${t('social_kit.btn_download_png')}</button>
        <div class="social-kit-studio__share">
          <button type="button" class="btn btn--md btn--secondary" data-action="download-svg">${t('social_kit.btn_download_svg')}</button>
          <button type="button" class="btn btn--md btn--secondary" data-action="print">${t('social_kit.btn_print')}</button>
        </div>
      </div>
    `;

    controls.querySelector<HTMLSelectElement>('#select-product').onchange = (e) => {
      const value = (e.target as HTMLSelectElement).value;
      selected = value === 'ALL' ? 'ALL' : Number(value);
      ensureLink();
    };
    const bindChoice = (attr: string, apply: (value: string) => void) => {
      const buttons = controls.querySelectorAll<HTMLElement>(`[data-${attr}]`);
      buttons.forEach((btn) => {
        btn.onclick = () => {
          buttons.forEach((b) => {
            const on = b === btn;
            b.setAttribute('aria-pressed', String(on));
            b.classList.toggle('btn--primary', on);
            b.classList.toggle('btn--secondary', !on);
          });
          apply(btn.getAttribute(`data-${attr}`));
        };
      });
    };
    bindChoice('fmt', (v) => {
      const before = channel();
      format = v as Format;
      if (channel() !== before) ensureLink();
      else refresh();
    });
    bindChoice('thm', (v) => { theme = v as Theme; refresh(); });
    controls.querySelectorAll<HTMLElement>('[data-promo]').forEach((chip) => {
      chip.onclick = () => {
        promo = chip.getAttribute('data-promo') as Promo;
        controls.querySelectorAll('[data-promo]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        refresh();
      };
    });
    controls.querySelector<HTMLElement>('[data-action="copy"]').onclick = copyLink;
    controls.querySelector<HTMLElement>('[data-action="retry-link"]').onclick = () => ensureLink();
    controls.querySelector<HTMLElement>('[data-action="download-svg"]').onclick = downloadSvg;
    controls.querySelector<HTMLElement>('[data-action="download-png"]').onclick = downloadPng;
    controls.querySelector<HTMLElement>('[data-action="print"]').onclick = printFlyer;
    controls.querySelectorAll<HTMLAnchorElement>('[data-share]').forEach((a) => {
      a.addEventListener('click', (e) => { if (linkState !== 'ready') e.preventDefault(); });
    });
    grid.append(controls);

    const stage = document.createElement('div');
    stage.className = 'saler-flyer-preview-stage social-kit-studio__stage';
    stage.innerHTML = `
      <div class="social-kit-studio__stage-head">
        <span class="social-kit-studio__label">${t('social_kit.preview_heading')}</span>
        <span class="badge badge--sm badge--neutral" data-slot="preview-tag"></span>
      </div>
      <div class="saler-flyer-preview-canvas" data-slot="canvas" role="img" aria-label="${t('social_kit.preview_heading')}"></div>
      <p class="social-kit-studio__note">${t('social_kit.preview_note')}</p>
    `;
    grid.append(stage);
    container.append(grid);

    refresh();
  }

  /** Updates the link box, share targets, action states and preview without rebuilding the form. */
  function refresh() {
    const photoUrl = currentItem()?.image_url;
    if (photoUrl) loadPhoto(photoUrl);
    const ready = linkState === 'ready' && !!link;
    const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel);
    const code = q('[data-slot="code"]');
    if (!code) return;
    code.textContent = ready ? link.code : linkState === 'loading' ? t('social_kit.link_creating') : '—';
    q<HTMLInputElement>('[data-slot="url"]').value = ready ? link.full_url : '';
    q('[data-slot="link-error"]').hidden = linkState !== 'error';
    container.querySelectorAll<HTMLButtonElement>('[data-action="copy"], [data-action="download-svg"], [data-action="download-png"], [data-action="print"]').forEach((b) => { b.disabled = !ready; });

    const pitch = currentItem() ? t('social_kit.share_text_product') : t('social_kit.share_text_store');
    const wa = q<HTMLAnchorElement>('[data-share="whatsapp"]');
    const fb = q<HTMLAnchorElement>('[data-share="facebook"]');
    [wa, fb].forEach((a) => a.setAttribute('aria-disabled', String(!ready)));
    if (ready) {
      wa.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(`${pitch} ${link.full_url}`)}`;
      fb.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link.full_url)}`;
    } else {
      wa.removeAttribute('href');
      fb.removeAttribute('href');
    }

    q('[data-slot="preview-tag"]').textContent = `${t(FORMATS[format].label)} · ${t(THEMES[theme].label)}`;
    const canvas = q('[data-slot="canvas"]');
    canvas.style.maxWidth = FORMATS[format].preview;
    canvas.innerHTML = generateSvg();
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.full_url);
      toast.success(t('social_kit.toast_link_copied'));
    } catch {
      // Clipboard access can be refused (insecure origin, permissions); the field is selectable.
      const input = container.querySelector<HTMLInputElement>('[data-slot="url"]');
      input?.select();
      toast.error(t('social_kit.copy_failed'));
    }
  }

  function fileName(ext: string) {
    return `explooro-flyer-${selected === 'ALL' ? 'store' : selected}-${format.toLowerCase()}.${ext}`;
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

  function downloadSvg() {
    saveBlob(new Blob([generateSvg()], { type: 'image/svg+xml;charset=utf-8' }), fileName('svg'));
    toast.success(t('social_kit.toast_download_started'));
  }

  function downloadPng() {
    const { width, height } = FORMATS[format];
    const url = URL.createObjectURL(new Blob([generateSvg()], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { toast.error(t('social_kit.toast_png_failed')); return; }
        saveBlob(blob, fileName('png'));
        toast.success(t('social_kit.toast_download_started'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error(t('social_kit.toast_png_failed'));
    };
    img.src = url;
  }

  /** Prints the flyer alone (not the page around it) from a hidden frame. */
  function printFlyer() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.append(frame);
    const doc = frame.contentDocument;
    const pageSize = format === 'A4_PRINT' ? 'A4' : 'auto';
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(fileName('pdf'))}</title><style>@page{size:${pageSize};margin:0}html,body{margin:0}svg{display:block;width:100%;height:auto;max-height:100vh}</style></head><body>${generateSvg()}</body></html>`);
    doc.close();
    const run = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1000);
    };
    // A data-free document is ready at once, but give layout one frame before printing.
    requestAnimationFrame(run);
  }

  function generateSvg() {
    const { width: W, height: H } = FORMATS[format];
    const c = THEMES[theme];
    const item = currentItem();
    const pad = 60;
    const store = shopName || t('social_kit.flyer_store_fallback');
    const primaryTitle = item ? itemTitle(item) : t('social_kit.flyer_store_headline');
    const secondaryTitle = item
      ? (isBn() ? item.title_en : item.title_bn)
      : t('social_kit.flyer_store_sub');
    const price = item?.price ? formatCurrency(item.price, { symbol: '৳' }) : '';
    const promoText = t(PROMO_LABEL[promo]);
    const qrText = linkState === 'ready' && link ? link.full_url : '';
    const initial = escapeHtml(Array.from(store.trim())[0] || 'E');

    // Header: store badge, name, promo pill sized to its text.
    const pillFont = format === 'BANNER' ? 22 : 26;
    const pillW = Math.round(Array.from(promoText).length * pillFont * 0.62 + 48);
    const headerH = 110;
    const header = `
      <g transform="translate(${pad} ${pad})">
        <rect width="${W - pad * 2}" height="${headerH}" rx="20" fill="${c.card}"/>
        <circle cx="55" cy="${headerH / 2}" r="32" fill="${c.accent}"/>
        <text x="55" y="${headerH / 2 + 11}" font-size="32" font-weight="700" text-anchor="middle" fill="${c.onAccent}">${initial}</text>
        ${textLines(wrapText(store, W - pad * 2 - 140 - pillW, 30, 1), 105, 50, 30, `font-weight="700" fill="${c.text}"`)}
        <text x="105" y="84" font-size="20" fill="${c.muted}">${escapeHtml(t('social_kit.flyer_verified'))}</text>
        <rect x="${W - pad * 2 - pillW - 22}" y="${(headerH - 52) / 2}" width="${pillW}" height="52" rx="26" fill="${c.accent}"/>
        <text x="${W - pad * 2 - pillW / 2 - 22}" y="${headerH / 2 + pillFont * 0.36}" font-size="${pillFont}" font-weight="700" text-anchor="middle" fill="${c.onAccent}">${escapeHtml(promoText)}</text>
      </g>`;

    const scanSub = escapeHtml(t('social_kit.scan_qr_subtext'));
    const shortText = escapeHtml(qrText.replace(/^https?:\/\//, ''));

    let body = '';
    if (format === 'BANNER') {
      // Two columns: copy on the left, QR on the right.
      const qrBox = 260;
      const qrX = W - pad - qrBox;
      const qrY = pad + headerH + 30;
      const textW = qrX - pad - 40;
      const titleLines = wrapText(primaryTitle, textW, 44, 2);
      let y = pad + headerH + 80;
      body += textLines(titleLines, pad, y, 44, `font-weight="700" fill="${c.text}"`);
      y += titleLines.length * 55 + 10;
      if (secondaryTitle) {
        body += textLines(wrapText(secondaryTitle, textW, 28, 1), pad, y, 28, `fill="${c.muted}"`);
        y += 60;
      }
      if (price) body += `<text x="${pad}" y="${y + 20}" font-size="64" font-weight="800" fill="${c.price}">${escapeHtml(price)}</text>`;
      body += `<rect x="${qrX - 14}" y="${qrY - 14}" width="${qrBox + 28}" height="${H - qrY - pad + 28}" rx="20" fill="${c.card}"/>`;
      body += qrSvgGroup(qrText, qrX, qrY, qrBox) || `<rect x="${qrX}" y="${qrY}" width="${qrBox}" height="${qrBox}" fill="#ffffff"/>`;
      body += `<text x="${qrX + qrBox / 2}" y="${H - pad - 4}" font-size="17" font-weight="700" text-anchor="middle" fill="${c.text}">${scanSub}</text>`;
    } else {
      const footerH = format === 'SQUARE' ? 230 : 300;
      const qrBox = footerH - 40;
      const footerY = H - pad - footerH;
      const titleFont = format === 'SQUARE' ? 50 : 60;
      const subFont = format === 'SQUARE' ? 32 : 38;
      const priceFont = format === 'SQUARE' ? 76 : 92;
      const textW = W - pad * 2 - 80;
      const titleLines = wrapText(primaryTitle, textW, titleFont, 2);
      const subLines = secondaryTitle ? wrapText(secondaryTitle, textW, subFont, 1) : [];
      const infoH = titleLines.length * titleFont * 1.25 + subLines.length * subFont * 1.4 + (price ? priceFont * 1.3 : 0) + 40;
      const cardY = pad + headerH + 30;
      const cardH = footerY - 30 - cardY;
      const heroH = Math.max(120, cardH - infoH - 80);
      const heroCx = W / 2;
      const heroCy = cardY + 40 + heroH / 2;
      body += `<rect x="${pad}" y="${cardY}" width="${W - pad * 2}" height="${cardH}" rx="28" fill="${c.card}"/>`;
      body += `<rect x="${pad + 40}" y="${cardY + 40}" width="${W - pad * 2 - 80}" height="${heroH}" rx="20" fill="${c.accent}" fill-opacity="0.14"/>`;
      const photo = item?.image_url ? photos.get(item.image_url) : null;
      if (photo) {
        body += `<clipPath id="flyer-hero"><rect x="${pad + 40}" y="${cardY + 40}" width="${W - pad * 2 - 80}" height="${heroH}" rx="20"/></clipPath>`;
        body += `<image href="${photo}" x="${pad + 40}" y="${cardY + 40}" width="${W - pad * 2 - 80}" height="${heroH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#flyer-hero)"/>`;
      } else {
        body += `<text x="${heroCx}" y="${heroCy + Math.min(140, heroH * 0.4) * 0.35}" font-size="${Math.min(140, heroH * 0.4)}" text-anchor="middle">${item ? '🛍️' : '🏬'}</text>`;
      }
      let y = cardY + 40 + heroH + 30 + titleFont;
      body += textLines(titleLines, pad + 40, y, titleFont, `font-weight="700" fill="${c.text}"`);
      y += (titleLines.length - 1) * titleFont * 1.25 + subFont * 1.5;
      if (subLines.length) {
        body += textLines(subLines, pad + 40, y, subFont, `fill="${c.muted}"`);
        y += priceFont * 1.25;
      } else {
        y += priceFont * 0.9;
      }
      if (price) body += `<text x="${pad + 40}" y="${y}" font-size="${priceFont}" font-weight="800" fill="${c.price}">${escapeHtml(price)}</text>`;

      body += `<rect x="${pad}" y="${footerY}" width="${W - pad * 2}" height="${footerH}" rx="24" fill="${c.card}"/>`;
      body += qrSvgGroup(qrText, pad + 20, footerY + 20, qrBox) || `<rect x="${pad + 20}" y="${footerY + 20}" width="${qrBox}" height="${qrBox}" fill="#ffffff"/>`;
      const tx = pad + 20 + qrBox + 36;
      const footW = W - pad - 30 - tx;
      const scanFont = format === 'SQUARE' ? 34 : 40;
      const scanLines = wrapText(t('social_kit.scan_qr_text'), footW, scanFont, 2);
      // Centre the block (title lines, Bangla line, short link) in the footer beside the QR.
      const blockH = scanLines.length * scanFont * 1.25 + scanFont * 0.9 + (shortText ? scanFont * 0.9 : 0);
      let ty = footerY + (footerH - blockH) / 2 + scanFont * 0.85;
      body += textLines(scanLines, tx, ty, scanFont, `font-weight="700" fill="${c.text}"`);
      ty += (scanLines.length - 1) * scanFont * 1.25 + scanFont * 1.1;
      body += `<text x="${tx}" y="${ty}" font-size="${scanFont * 0.66}" font-weight="600" fill="${c.accent}">${scanSub}</text>`;
      if (shortText) body += `<text x="${tx}" y="${ty + scanFont * 0.95}" font-size="${scanFont * 0.6}" fill="${c.muted}" font-family="ui-monospace, Consolas, monospace">${shortText}</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT_STACK}" style="display:block;width:100%;height:auto">
      <rect width="${W}" height="${H}" fill="${c.bg}"/>
      ${header}
      ${body}
    </svg>`;
  }

  const unsubscribeLang = subscribeLang(() => render());

  loadData();
  root.append(container);

  return () => {
    unsubscribeLang?.();
    linkRequest++;
    container.remove();
  };
}
