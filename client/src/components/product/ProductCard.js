/**
 * ProductCard — the atomic product tile used across the marketplace (Prompt 4.5).
 *
 * @param {object} product       — product data shape from GET /products
 * @param {string} role          — current user role ('customer' | 'saler' | etc.)
 * @param {object} modules       — { flash_sale, sourcing, physical_shop_status, … }
 * @param {string} lang          — current language ('en' | 'bn')
 * @param {'full'|'compact'}  size
 * @param {function} onNavigate  — navigate(path) from router context
 * @param {function} onAction    — called with (product, actionType) on CTA click
 *
 * Invariants:
 *  - Aspect-ratio-locked placeholder (1:1) → zero CLS even before image arrives.
 *  - title uses `lang`-aware field: `title_bn` when lang==='bn', else `title_en`.
 *  - Margin badge is only rendered when role==='saler' AND modules.sourcing is truthy.
 *  - Flash tag is only rendered when product.is_flash_sale AND modules.flash_sale is truthy.
 *  - Physical open/closed dot is only rendered when modules.physical_shop_status is truthy.
 *  - Verified supplier badge is only rendered when product.is_verified_supplier is truthy.
 *  - CTA: 'saler' → "Add to My Store", all others → "Quick Buy" (hidden when out of stock).
 *  - Press feedback via scale(0.98) matches craft.css §press — defined in product.css.
 */

import '../../styles/components/product.css';
import { formatCurrency } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { openQuickBuyModal } from '../cart/QuickBuyModal.js';

// Ten HSL-defined, accessible background colours for the SVG image placeholder.
// Each maps to a distinct category visual identity — consistent per image_index.
export const PLACEHOLDER_COLOURS = [
  { bg: '#9b467b', fg: '#fff' }, // pink (brand-900) — Clothing
  { bg: '#2d7b44', fg: '#fff' }, // green — Kids
  { bg: '#1e5fa8', fg: '#fff' }, // blue — Electronics
  { bg: '#592a47', fg: '#fff' }, // deep plum (brand-1000) — Bags
  { bg: '#7b3da0', fg: '#fff' }, // purple — Jewellery
  { bg: '#936412', fg: '#fff' }, // amber — Food & Grocery
  { bg: '#205b31', fg: '#fff' }, // dark green — Crafts
  { bg: '#2c343a', fg: '#fff' }, // charcoal — Footwear
  { bg: '#8b1f17', fg: '#fff' }, // deep red — Beauty & Health
  { bg: '#464e55', fg: '#fff' }, // dark grey — Wholesale
];

const CATEGORY_DUMMY_IMAGES = {
  'Clothing': [
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=500&auto=format&fit=crop&q=80',
  ],
  'Kids': [
    'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1559715745-e1b33a271c8f?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=500&auto=format&fit=crop&q=80',
  ],
  'Bags': [
    'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1627123424574-724758594e93?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&auto=format&fit=crop&q=80',
  ],
  'Electronics': [
    'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500&auto=format&fit=crop&q=80',
  ],
  'Home & Kitchen': [
    'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&auto=format&fit=crop&q=80',
  ],
  'Jewellery': [
    'https://images.unsplash.com/photo-1611591475847-f0b48a1b24d7?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1630019852942-f89202989a59?w=500&auto=format&fit=crop&q=80',
  ],
  'Food & Grocery': [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1611080626919-7cf5a9dbab5b?w=500&auto=format&fit=crop&q=80',
  ],
  'Footwear': [
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=500&auto=format&fit=crop&q=80',
  ],
  'Beauty & Health': [
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1608248597359-bb5e7a9b0c20?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1567928815104-b7980ee5032e?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80',
  ],
  'Crafts': [
    'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&auto=format&fit=crop&q=80',
  ],
  'Furniture': [
    'https://images.unsplash.com/photo-1503602642458-232111445657?w=500&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1594671581654-2785ac5ced4b?w=500&auto=format&fit=crop&q=80',
  ],
  'Wholesale': [
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80',
  ],
};

const KEYWORD_IMAGE_RULES = [
  // Specific Traditional Apparel
  { match: /(saree|শাড়ি|jamdani|জামদানি|tant|তাঁত)/i, url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80' },
  { match: /(panjabi|পাঞ্জাবি)/i, url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500&auto=format&fit=crop&q=80' },
  { match: /(kurti|কুর্তি|shalwar|সালোয়ার|three-piece|থ্রি-পিস)/i, url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=80' },
  { match: /(jacket|জ্যাকেট|denim)/i, url: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=500&auto=format&fit=crop&q=80' },
  { match: /(shirt|শার্ট)/i, url: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=500&auto=format&fit=crop&q=80' },
  { match: /(jersey|জার্সি|cricket)/i, url: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=500&auto=format&fit=crop&q=80' },
  { match: /(scarf|স্কার্ফ|dupatta|ওড়না)/i, url: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=500&auto=format&fit=crop&q=80' },
  
  // Kids
  { match: /(duck|হাঁস|rubber duck|টয়|toy|খেলনা)/i, url: 'https://images.unsplash.com/photo-1559715745-e1b33a271c8f?w=500&auto=format&fit=crop&q=80' },
  { match: /(board game|বোর্ড গেম|game)/i, url: 'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=500&auto=format&fit=crop&q=80' },
  { match: /(paint|পেইন্ট|safe paint)/i, url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500&auto=format&fit=crop&q=80' },
  { match: /(frock|ফ্রক)/i, url: 'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=500&auto=format&fit=crop&q=80' },
  { match: /(kids|বাচ্চা|শিশু)/i, url: 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=500&auto=format&fit=crop&q=80' },
  
  // Bags & Wallets
  { match: /(handbag|ladies bag|লেডিস ব্যাগ)/i, url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500&auto=format&fit=crop&q=80' },
  { match: /(hand wallet|ওয়ালেট|wallet)/i, url: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=500&auto=format&fit=crop&q=80' },
  { match: /(backpack|ব্যাকপ্যাক)/i, url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&auto=format&fit=crop&q=80' },
  { match: /(jute|পাটের|shopping bag)/i, url: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=500&auto=format&fit=crop&q=80' },
  { match: /(bag|ব্যাগ)/i, url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500&auto=format&fit=crop&q=80' },
  
  // Electronics & Gadgets
  { match: /(earbud|ইয়ারবাড|headphone|হেডফোন)/i, url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&auto=format&fit=crop&q=80' },
  { match: /(speaker|স্পিকার)/i, url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=500&auto=format&fit=crop&q=80' },
  { match: /(smart watch|স্মার্ট ওয়াচ|watch|ঘড়ি|fitness band)/i, url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80' },
  { match: /(cover|কভার|case)/i, url: 'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=500&auto=format&fit=crop&q=80' },
  { match: /(power bank|পাওয়ার ব্যাংক)/i, url: 'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=500&auto=format&fit=crop&q=80' },
  { match: /(charger|চার্জার|usb)/i, url: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=500&auto=format&fit=crop&q=80' },
  { match: /(lantern|লণ্ঠন|solar|সোলার)/i, url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500&auto=format&fit=crop&q=80' },
  { match: /(lock|লক|তালা)/i, url: 'https://images.unsplash.com/photo-1558002038-1055907df827?w=500&auto=format&fit=crop&q=80' },

  // Footwear
  { match: /(sports shoe|রানিং|running|sneaker|স্পোর্টস শু)/i, url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=80' },
  { match: /(shoe|শু|জুতা)/i, url: 'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=500&auto=format&fit=crop&q=80' },
  { match: /(sandal|স্যান্ডেল|heel|হিল)/i, url: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&auto=format&fit=crop&q=80' },

  // Jewellery
  { match: /(bracelet|ব্রেসলেট)/i, url: 'https://images.unsplash.com/photo-1611591475847-f0b48a1b24d7?w=500&auto=format&fit=crop&q=80' },
  { match: /(earring|দুল|কানের দুল|jewel|গহনা)/i, url: 'https://images.unsplash.com/photo-1630019852942-f89202989a59?w=500&auto=format&fit=crop&q=80' },

  // Food & Grocery
  { match: /(honey|মধু)/i, url: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=500&auto=format&fit=crop&q=80' },
  { match: /(chocolate|চকলেট)/i, url: 'https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=500&auto=format&fit=crop&q=80' },
  { match: /(tea|গ্রিন টি|চা)/i, url: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500&auto=format&fit=crop&q=80' },
  { match: /(pickle|আচার)/i, url: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=500&auto=format&fit=crop&q=80' },
  { match: /(coconut oil|নারিকেল তেল|কোকোনাট)/i, url: 'https://images.unsplash.com/photo-1611080626919-7cf5a9dbab5b?w=500&auto=format&fit=crop&q=80' },

  // Beauty & Health
  { match: /(skin care|স্কিন কেয়ার)/i, url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&auto=format&fit=crop&q=80' },
  { match: /(hair oil|হেয়ার অয়েল|castor oil|ক্যাস্টর অয়েল)/i, url: 'https://images.unsplash.com/photo-1608248597359-bb5e7a9b0c20?w=500&auto=format&fit=crop&q=80' },
  { match: /(mask|মাস্ক|clay mask|ফেস মাস্ক)/i, url: 'https://images.unsplash.com/photo-1567928815104-b7980ee5032e?w=500&auto=format&fit=crop&q=80' },
  { match: /(vitamin|ভিটামিন|supplement|সাপ্লিমেন্ট)/i, url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80' },

  // Home & Furniture
  { match: /(chair|চেয়ার)/i, url: 'https://images.unsplash.com/photo-1503602642458-232111445657?w=500&auto=format&fit=crop&q=80' },
  { match: /(bookshelf|বুকশেলফ)/i, url: 'https://images.unsplash.com/photo-1594671581654-2785ac5ced4b?w=500&auto=format&fit=crop&q=80' },
  { match: /(kitchen|রান্নাঘর|steel|স্টিল)/i, url: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=500&auto=format&fit=crop&q=80' },
  { match: /(pot set|টব|plant pot)/i, url: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=500&auto=format&fit=crop&q=80' },
  { match: /(cushion|কুশন|kantha|নকশিকাঁথা)/i, url: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=500&auto=format&fit=crop&q=80' },
  { match: /(door mat|ম্যাট|mat)/i, url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&auto=format&fit=crop&q=80' },
  { match: /(cleaner|পরিষ্কারক)/i, url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&auto=format&fit=crop&q=80' },

  // Crafts
  { match: /(clay cup|মাটির কাপ|cup|মগ|mug)/i, url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&auto=format&fit=crop&q=80' },
  { match: /(showpiece|শো-পিস|wood|কাঠের)/i, url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=500&auto=format&fit=crop&q=80' },
  { match: /(brass|ব্রাস|ঘণ্টা|bell|কলশ|water pot)/i, url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=500&auto=format&fit=crop&q=80' },
];

const DEFAULT_DUMMY_IMAGES = [
  'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1607344645866-009c320c5ab8?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=500&auto=format&fit=crop&q=80',
];

export function resolveProductImage(product) {
  if (!product) return DEFAULT_DUMMY_IMAGES[0];
  if (product.image_url) return product.image_url;
  if (product.image) return product.image;
  if (product.primary_image) return product.primary_image;
  if (product.images && product.images.length > 0) {
    const p = product.images.find((img) => img.is_primary && img.url) || product.images.find((img) => img.url);
    if (p && p.url) return p.url;
  }

  // Check title and category keywords
  const searchableText = `${product.title_en || ''} ${product.title_bn || ''} ${product.title || ''} ${product.name || ''} ${product.category || ''} ${product.category_bn || ''} ${product.category_name_en || ''} ${product.slug || ''}`;
  for (const rule of KEYWORD_IMAGE_RULES) {
    if (rule.match.test(searchableText)) {
      return rule.url;
    }
  }

  const cat = product.category || product.category_name_en;
  const catList = CATEGORY_DUMMY_IMAGES[cat];
  const idx = typeof product.image_index === 'number'
    ? product.image_index
    : (typeof product.id === 'number' ? product.id : 0);
  if (catList && catList.length > 0) {
    return catList[Math.abs(idx) % catList.length];
  }
  return DEFAULT_DUMMY_IMAGES[Math.abs(idx) % DEFAULT_DUMMY_IMAGES.length];
}

/** Returns the first letter(s) of a title for use as placeholder text. */
export function placeholderInitials(title) {
  if (!title) return '?';
  const words = title.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0] || '').join('').toUpperCase() || '?';
}

/** Inline SVG: filled star (rating display). */
function starSvg(filled) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z');
  svg.append(path);
  return svg;
}

/** Renders 5 stars, filled up to `rating`. Half-stars rounded to nearest integer for simplicity. */
function renderStars(rating) {
  const wrap = document.createElement('span');
  wrap.className = 'product-card__stars';
  wrap.setAttribute('aria-hidden', 'true');
  const filled = Math.round(Number(rating) || 0);
  for (let i = 1; i <= 5; i += 1) {
    wrap.append(starSvg(i <= filled));
  }
  return wrap;
}

/** Inline SVG: verification checkmark. */
function verifiedSvg() {
  const wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'display:inline-flex;width:14px;height:14px;color:var(--brand-600);flex-shrink:0';
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2.5 14.6 5l3.5-.4 1 3.4 3 1.9-1.6 3.1 1.6 3.1-3 1.9-1 3.4-3.5-.4L12 21.5 9.4 19l-3.5.4-1-3.4-3-1.9L4.5 11 2.9 7.9l3-1.9 1-3.4L10.4 3Z"/>' +
    '<path d="m8.8 12.2 2.2 2.2 4.2-4.4"/></svg>';
  return wrap;
}

/** Inline SVG: bolt (flash sale). */
function boltSvg() {
  const wrap = document.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'display:inline-flex;width:10px;height:10px;color:#fff;flex-shrink:0';
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4 14h7v8l9-12h-7z"/></svg>';
  return wrap;
}

/**
 * @param {object} opts
 * @returns {HTMLElement}  — the card root (an <article>)
 */
export function ProductCard({
  product = {},
  role = 'customer',
  modules = {},
  lang = 'en',
  size = 'full',
  onNavigate = null,
  onAction = null,
} = {}) {
  const card = document.createElement('article');
  card.className = size === 'compact' ? 'product-card product-card--compact' : 'product-card';
  // Keyboard accessibility — the whole card is clickable
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute(
    'aria-label',
    lang === 'bn' ? (product.title_bn || product.title_en || '') : (product.title_en || product.title_bn || '')
  );

  const navigate = () => onNavigate && onNavigate(`/product/${product.ref}`);
  card.addEventListener('click', navigate);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); }
  });

  // ── Image / placeholder ─────────────────────────────────────────────────
  const imgWrap = document.createElement('div');
  imgWrap.className = 'product-card__image-wrap';

  const palette = PLACEHOLDER_COLOURS[(product.image_index ?? 0) % PLACEHOLDER_COLOURS.length] || PLACEHOLDER_COLOURS[0];
  const placeholder = document.createElement('div');
  placeholder.className = 'product-card__image-placeholder';
  placeholder.style.cssText = `background:${palette.bg};color:${palette.fg}`;
  placeholder.textContent = placeholderInitials(lang === 'bn' ? product.title_bn : product.title_en);

  const imageUrl = resolveProductImage(product);

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'product-card__image';
    img.src = imageUrl;
    img.alt = (lang === 'bn' ? (product.title_bn || product.title_en) : (product.title_en || product.title_bn)) || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.replaceWith(placeholder);
    }, { once: true });
    imgWrap.append(img);
  } else {
    imgWrap.append(placeholder);
  }

  // Flash sale tag overlaid on the image
  if (product.is_flash_sale && modules.flash_sale) {
    const flashTag = document.createElement('div');
    flashTag.className = 'product-card__flash-tag';
    flashTag.append(boltSvg());
    flashTag.append(document.createTextNode(t('marketplace.flash_sale.tag')));
    imgWrap.append(flashTag);
  }

  card.append(imgWrap);

  // ── Body ────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'product-card__body';

  // Badges row: verified supplier + store open/closed
  const badgesRow = document.createElement('div');
  badgesRow.className = 'product-card__badges';

  if (product.is_verified_supplier) {
    const vBadge = document.createElement('span');
    vBadge.className = 'badge badge--verified badge--sm';
    vBadge.title = t('marketplace.product.verified_supplier');
    vBadge.append(verifiedSvg());
    const vText = document.createElement('span');
    vText.textContent = t('marketplace.product.verified_supplier');
    vBadge.append(vText);
    badgesRow.append(vBadge);
  }

  if (modules.physical_shop_status) {
    const isOpen = product.store_open;
    const statusBadge = document.createElement('span');
    statusBadge.className = 'badge badge--status badge--sm';
    statusBadge.dataset.status = isOpen ? 'open' : 'closed';
    const dot = document.createElement('span');
    dot.className = 'badge__dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = isOpen ? t('marketplace.product.open') : t('marketplace.product.closed');
    statusBadge.append(dot, label);
    badgesRow.append(statusBadge);
  }

  body.append(badgesRow);

  // Title
  const title = document.createElement('h3');
  title.className = 'product-card__title';
  title.textContent = lang === 'bn'
    ? (product.title_bn || product.title_en || '')
    : (product.title_en || product.title_bn || '');
  body.append(title);

  // Price row + margin badge
  const priceRow = document.createElement('div');
  priceRow.className = 'product-card__price-row';

  const priceEl = document.createElement('span');
  priceEl.className = 'product-card__price';
  priceEl.textContent = formatCurrency(product.price, { lang });
  priceRow.append(priceEl);

  // WHY: margin badge only visible to Salers AND only when 'sourcing' module is on —
  // a divergence here (client vs server) is a financial bug; the badge is informational only.
  if (role === 'saler' && modules.sourcing && product.margin_pct != null) {
    const marginBadge = document.createElement('span');
    marginBadge.className = 'product-card__margin';
    marginBadge.textContent = t('marketplace.product.margin_badge', { pct: product.margin_pct });
    priceRow.append(marginBadge);
  }

  body.append(priceRow);

  // Rating
  const ratingWrap = document.createElement('div');
  ratingWrap.className = 'product-card__rating';
  const rating = Number(product.rating) || 0;
  ratingWrap.append(renderStars(rating));
  const ratingCount = document.createElement('span');
  ratingCount.className = 'product-card__rating-count';
  ratingCount.textContent = `(${product.rating_count ?? 0})`;
  ratingWrap.append(ratingCount);
  body.append(ratingWrap);

  card.append(body);

  // ── CTA action button (hidden in compact mode to save space) ────────────
  if (size === 'full') {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'product-card__action';

    const stockVal = product.stock ?? product.stock_qty ?? product.stock_quantity ?? 10;
    const inStock = Number(stockVal) > 0;
    const isSaler = role === 'saler';

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = isSaler
      ? 'product-card__action-btn product-card__action-btn--add-to-store'
      : 'product-card__action-btn';
    actionBtn.disabled = !inStock && !isSaler;

    if (!inStock && !isSaler) {
      actionBtn.textContent = t('marketplace.product.out_of_stock');
      actionBtn.style.background = 'var(--surface-2)';
      actionBtn.style.color = 'var(--text-muted)';
    } else if (isSaler) {
      actionBtn.textContent = t('marketplace.product.add_to_store');
    } else {
      actionBtn.textContent = t('marketplace.product.quick_buy');
    }

    // Stop propagation so clicking the button doesn't also navigate to product detail
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onAction) {
        onAction(product, isSaler ? 'add_to_store' : 'quick_buy');
      } else if (!isSaler) {
        openQuickBuyModal({
          product,
          initialQty: 1,
          navigate: onNavigate,
        });
      }
    });

    actionWrap.append(actionBtn);
    card.append(actionWrap);
  }

  return card;
}

/**
 * ProductCardSkeleton — layout-matching loading placeholder.
 * Same DOM structure as ProductCard; widths match 2-line title + price + rating bar.
 * @returns {HTMLElement}
 */
export function ProductCardSkeleton({ size = 'full' } = {}) {
  const root = document.createElement('div');
  root.className = `skeleton skeleton--product-card${size === 'compact' ? ' product-card--compact' : ''}`;
  root.setAttribute('aria-hidden', 'true');

  const img = document.createElement('div');
  img.className = 'skeleton__image';
  root.append(img);

  const body = document.createElement('div');
  body.className = 'skeleton__body';

  const lines = [
    { width: '90%', height: '13px' },
    { width: '65%', height: '13px' },
    { width: '50%', height: '16px' },
    { width: '70%', height: '12px' },
  ];
  for (const { width, height } of lines) {
    const line = document.createElement('span');
    line.className = 'skeleton__line';
    line.style.cssText = `width:${width};height:${height};display:block;border-radius:4px;
      background:var(--surface-2);animation:skeleton-pulse 1.4s ease-in-out infinite;`;
    body.append(line);
  }
  root.append(body);
  return root;
}
