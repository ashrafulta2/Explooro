/**
 * StoreHeader.js — Hero banner, avatar, branding, social links, announcement & status for virtual stores (Prompt 4.8).
 */

import { t, getLanguage } from '../../services/i18n.js';
import { Badge } from '../ui/Badge.js';

export function StoreHeader({ store = {}, isPreview = false } = {}) {
  const container = document.createElement('div');
  container.className = 'store-header';

  const shopName = store.shop_name || t('store.default_name');
  const slug = store.slug || 'my-store';
  const bio = store.bio || '';
  const announcement = store.announcement;
  const socialLinks = store.social_links || {};
  const status = store.status || { is_open: true, message: t('shop_status.open_now') };
  const productsCount = store.products_count ?? (store.products ? store.products.length : 0);

  // 1. Cover Banner
  const banner = document.createElement('div');
  banner.className = 'store-header__banner';
  if (store.banner_key || store.banner_url) {
    banner.style.backgroundImage = `url(${store.banner_url || `/api/v1/media/stream/${store.banner_key}`})`;
  }
  const overlay = document.createElement('div');
  overlay.className = 'store-header__banner-overlay';
  banner.append(overlay);
  container.append(banner);

  // 2. Content Body
  const content = document.createElement('div');
  content.className = 'store-header__content';

  // Top row: Avatar + Status Badge
  const topRow = document.createElement('div');
  topRow.className = 'store-header__top-row';

  const avatar = document.createElement('div');
  avatar.className = 'store-header__avatar';
  if (store.logo_key || store.logo_url) {
    const img = document.createElement('img');
    img.src = store.logo_url || `/api/v1/media/stream/${store.logo_key}`;
    img.alt = shopName;
    avatar.append(img);
  } else {
    avatar.textContent = shopName.charAt(0).toUpperCase();
  }

  const statusWrap = document.createElement('div');
  statusWrap.className = 'store-header__status-badge';
  const statusBadge = document.createElement('span');
  statusBadge.className = status.is_open ? 'badge badge--success badge--md' : 'badge badge--danger badge--md';
  statusBadge.textContent = (status.is_open ? '🟢 ' : '🔴 ') + (status.message || (status.is_open ? t('shop_status.open_now') : t('shop_status.closed_now')));
  statusWrap.append(statusBadge);

  topRow.append(avatar, statusWrap);
  content.append(topRow);

  // Identity: Title, Slug, Verified Badge
  const identity = document.createElement('div');
  identity.className = 'store-header__identity';

  const titleRow = document.createElement('div');
  titleRow.className = 'store-header__title-row';

  const title = document.createElement('h1');
  title.className = 'store-header__title';
  title.textContent = shopName;

  const verified = document.createElement('span');
  verified.className = 'badge badge--verified badge--sm';
  verified.innerHTML = `<span>✓</span> <span>${t('store.verified_seller')}</span>`;

  titleRow.append(title, verified);

  const slugText = document.createElement('span');
  slugText.className = 'store-header__slug';
  slugText.textContent = `@${slug}`;

  identity.append(titleRow, slugText);

  if (bio) {
    const bioText = document.createElement('p');
    bioText.className = 'store-header__bio';
    bioText.textContent = bio;
    identity.append(bioText);
  }

  if (announcement) {
    const annBox = document.createElement('div');
    annBox.className = 'store-header__announcement';
    annBox.innerHTML = `<span>📢</span> <strong>${t('store.announcement')}:</strong> <span>${announcement}</span>`;
    identity.append(annBox);
  }

  content.append(identity);

  // Social Links
  const socialRow = document.createElement('div');
  socialRow.className = 'store-header__social';

  if (socialLinks.whatsapp) {
    const wa = createSocialLink('WhatsApp', `https://wa.me/${socialLinks.whatsapp.replace(/\D/g, '')}`, '💬');
    socialRow.append(wa);
  }
  if (socialLinks.facebook) {
    const fb = createSocialLink('Facebook', socialLinks.facebook.startsWith('http') ? socialLinks.facebook : `https://facebook.com/${socialLinks.facebook}`, '📘');
    socialRow.append(fb);
  }
  if (socialLinks.instagram) {
    const ig = createSocialLink('Instagram', socialLinks.instagram.startsWith('http') ? socialLinks.instagram : `https://instagram.com/${socialLinks.instagram}`, '📷');
    socialRow.append(ig);
  }
  if (socialLinks.phone) {
    const ph = createSocialLink('Call', `tel:${socialLinks.phone}`, '📞');
    socialRow.append(ph);
  }

  if (socialRow.children.length > 0) {
    content.append(socialRow);
  }

  // Stats Row
  const statsRow = document.createElement('div');
  statsRow.className = 'store-header__stats';

  const statRating = createStat('★ 4.9', t('store.stat_rating'));
  const statProducts = createStat(`${productsCount}`, t('store.stat_products'));
  const statTrust = createStat('100%', t('store.stat_escrow'));

  statsRow.append(statRating, statProducts, statTrust);
  content.append(statsRow);

  container.append(content);
  return container;
}

function createSocialLink(label, href, icon) {
  const a = document.createElement('a');
  a.className = 'store-header__social-btn';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = label;
  a.innerHTML = `<span>${icon}</span>`;
  return a;
}

function createStat(value, label) {
  const item = document.createElement('div');
  item.className = 'store-header__stat-item';
  const valSpan = document.createElement('span');
  valSpan.className = 'store-header__stat-val';
  valSpan.textContent = value;
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  item.append(valSpan, labelSpan);
  return item;
}
