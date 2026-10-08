/**
 * MarketingKitCard — a supplier's ready-made promotion for one product, for a saler to copy from.
 *
 * Invariants:
 *  - Copy buttons copy exactly what is shown; nothing is rewritten on the way to the clipboard.
 *  - Text is set with textContent, never innerHTML: a kit is written by a supplier and shown to many
 *    salers, so it is untrusted.
 *  - The video link is only offered when it is an http(s) URL (the server enforces it too).
 *  - Clipboard access can be refused (insecure context, permissions); the card then says so instead of
 *    pretending it copied.
 *
 * Styles: styles/components/sample-kit.css (+ incentive.css for the card shell), loaded by the routes
 * that render this (main.js).
 */
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../ui/Button.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Older browsers and pages without clipboard permission still honour a selection + copy command. */
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export async function copyText(text) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = legacyCopy(text);
  }
  if (copied) toast.success(t('kit.copied'));
  else toast.error(t('kit.copy_failed'));
  return copied;
}

function isWebUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** The caption in the viewer's language, falling back to the other one rather than showing nothing. */
export function pickCaption(kit, language) {
  const first = language === 'bn' ? kit.caption_bn : kit.caption_en;
  const second = language === 'bn' ? kit.caption_en : kit.caption_bn;
  return first || second || '';
}

export function MarketingKitCard(kit) {
  const language = getLanguage();
  const card = el('article', 'incentive-card kit-card');
  card.append(el('h2', 'incentive-card__title', language === 'bn' ? kit.title_bn || kit.title_en : kit.title_en));
  if (kit.supplier_name) card.append(el('p', 'incentive-card__note', t('kit.by', { supplier: kit.supplier_name })));

  const caption = pickCaption(kit, language);
  if (caption) {
    card.append(el('p', 'kit-caption', caption));
    card.append(Button({ label: t('kit.copy_caption'), variant: 'secondary', size: 'sm', onClick: () => copyText(caption) }));
  }

  if (kit.selling_points?.length) {
    card.append(el('h3', 'kit-heading', t('kit.points')));
    const ul = el('ul', 'incentive-lines');
    for (const p of kit.selling_points) ul.append(el('li', '', p));
    card.append(ul);
  }

  if (kit.hashtags?.length) {
    const line = kit.hashtags.join(' ');
    card.append(el('p', 'kit-hashtags', line));
    card.append(Button({ label: t('kit.copy_hashtags'), variant: 'secondary', size: 'sm', onClick: () => copyText(line) }));
  }

  const images = (kit.images || []).filter(Boolean);
  if (images.length) {
    card.append(el('h3', 'kit-heading', t('kit.images')));
    const grid = el('div', 'kit-images');
    images.forEach((src, i) => {
      const a = el('a', 'kit-images__item');
      a.href = src;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', t('kit.open_image', { n: i + 1 }));
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      a.append(img);
      grid.append(a);
    });
    card.append(grid);
  }

  if (kit.video_url && isWebUrl(kit.video_url)) {
    const a = el('a', 'kit-video', t('kit.watch_video'));
    a.href = kit.video_url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    card.append(a);
  }
  return card;
}
