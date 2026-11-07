/**
 * flyerTemplates.ts — the design library behind the Flyer Studio (/saler/social-kit, /supplier/social-kit).
 *
 * A design is not a stored picture. It is a combination of four independent choices:
 *
 *   layout (12)  ×  colour palette (24)  ×  background pattern (8)  ×  headline (5–8 per occasion)
 *
 * and lib/flyerEngine.ts draws any combination, in any of the four formats, with the partner's or
 * supplier's own product, price, photo, name and QR link already filled in. That is how a person
 * gets thousands of ready designs without designing anything, and why adding one layout, palette,
 * pattern or headline here multiplies the whole library instead of adding one picture.
 *
 * WHY the copy lives here and not in locales/*.json: the locale files load with the app shell on
 * every page, and this is ~150 lines of headlines only the studio ever reads. Kept here, it ships
 * in the studio's own lazy chunk. Each entry carries both languages side by side, so a missing
 * translation is impossible to write (client/test/flyerEngine.test.js also checks it).
 *
 * WHY no discount numbers in the copy: an Explooro partner cannot set or change a price, so a
 * headline such as "50% off" would be a promise nobody on the platform made. Headlines sell the
 * moment (Eid, a new arrival, fast delivery), the real price comes from the product.
 */

export type FormatId = 'SQUARE' | 'STORY' | 'A4_PRINT' | 'BANNER';
export type LayoutId =
  | 'hero_card' | 'full_bleed' | 'split' | 'spotlight' | 'price_burst' | 'polaroid'
  | 'magazine' | 'ticket' | 'collage' | 'arch' | 'ribbon' | 'stack';
export type PatternId = 'plain' | 'dots' | 'stripes' | 'rings' | 'confetti' | 'alpana' | 'waves' | 'shapes';

export interface Bilingual { en: string; bn: string }

export interface Palette {
  id: string;
  name: Bilingual;
  bg: string;       // canvas
  surface: string;  // cards and panels drawn on the canvas
  accent: string;   // pills, stickers, buttons
  onAccent: string; // text on accent
  text: string;     // main text on bg AND on surface
  muted: string;    // secondary text on bg and surface
  price: string;    // the price, large, on bg and surface
  deco: string;     // the background pattern (drawn faint)
}

export interface Occasion {
  id: string;
  emoji: string;
  label: Bilingual;
  /** Palette ids that suit the occasion; empty = every palette. */
  palettes: string[];
  headlines: Bilingual[];
  tags: Bilingual[];
  /** Social post text. {headline} {product} {price} {link} are filled in; a [bracketed] part is dropped when a value inside it is empty (no price). */
  caption: Bilingual;
  hashtags: string;
}

export const FORMATS: Record<FormatId, { width: number; height: number; label: string }> = {
  SQUARE: { width: 1080, height: 1080, label: 'flyer.format.square' },
  STORY: { width: 1080, height: 1920, label: 'flyer.format.story' },
  A4_PRINT: { width: 1240, height: 1754, label: 'flyer.format.print' },
  BANNER: { width: 1200, height: 630, label: 'flyer.format.banner' },
};

export const LAYOUTS: LayoutId[] = [
  'hero_card', 'full_bleed', 'split', 'spotlight', 'price_burst', 'polaroid',
  'magazine', 'ticket', 'collage', 'arch', 'ribbon', 'stack',
];

export const PATTERNS: PatternId[] = ['plain', 'dots', 'stripes', 'rings', 'confetti', 'alpana', 'waves', 'shapes'];

/**
 * Every palette must keep text readable on both its canvas and its cards: text and muted ≥ 4.5:1,
 * the price (always drawn large) ≥ 3:1, onAccent on accent ≥ 4.5:1. flyerEngine.test.js measures
 * each one, so a new palette that fails contrast fails the test instead of shipping unreadable.
 */
export const PALETTES: Palette[] = [
  // Dark canvases
  { id: 'midnight', name: { en: 'Midnight', bn: 'মিডনাইট' }, bg: '#0f172a', surface: '#1e293b', accent: '#38bdf8', onAccent: '#0f172a', text: '#f8fafc', muted: '#cbd5e1', price: '#4ade80', deco: '#38bdf8' },
  { id: 'royal_gold', name: { en: 'Royal Gold', bn: 'রয়্যাল গোল্ড' }, bg: '#1a130b', surface: '#2e200e', accent: '#f59e0b', onAccent: '#1a130b', text: '#fef3c7', muted: '#fcd34d', price: '#fde68a', deco: '#f59e0b' },
  { id: 'festive_red', name: { en: 'Festive Red', bn: 'উৎসবের লাল' }, bg: '#450a0a', surface: '#7f1d1d', accent: '#fbbf24', onAccent: '#450a0a', text: '#fef2f2', muted: '#fecaca', price: '#fde047', deco: '#fbbf24' },
  { id: 'emerald_night', name: { en: 'Emerald Night', bn: 'পান্না রাত' }, bg: '#052e2b', surface: '#0b3f3a', accent: '#fbbf24', onAccent: '#052e2b', text: '#ecfdf5', muted: '#a7f3d0', price: '#fde68a', deco: '#34d399' },
  { id: 'plum', name: { en: 'Plum', bn: 'প্লাম' }, bg: '#2e1065', surface: '#3b0f7a', accent: '#f472b6', onAccent: '#2e1065', text: '#faf5ff', muted: '#e9d5ff', price: '#fbcfe8', deco: '#f472b6' },
  { id: 'charcoal_lime', name: { en: 'Charcoal Lime', bn: 'চারকোল লাইম' }, bg: '#111111', surface: '#1f1f1f', accent: '#a3e635', onAccent: '#111111', text: '#fafafa', muted: '#d4d4d4', price: '#a3e635', deco: '#a3e635' },
  { id: 'ocean', name: { en: 'Ocean', bn: 'সমুদ্র' }, bg: '#082f49', surface: '#0c4a6e', accent: '#22d3ee', onAccent: '#082f49', text: '#f0f9ff', muted: '#bae6fd', price: '#67e8f9', deco: '#22d3ee' },
  { id: 'maroon_cream', name: { en: 'Maroon Cream', bn: 'মেরুন ক্রিম' }, bg: '#3f0d12', surface: '#5c1a1f', accent: '#f5deb3', onAccent: '#3f0d12', text: '#fff7ed', muted: '#fcd9b6', price: '#fde68a', deco: '#f5deb3' },
  { id: 'noir_coral', name: { en: 'Noir Coral', bn: 'নোয়ার কোরাল' }, bg: '#18181b', surface: '#27272a', accent: '#fb7185', onAccent: '#18181b', text: '#fafafa', muted: '#d4d4d8', price: '#fdba74', deco: '#fb7185' },
  { id: 'forest', name: { en: 'Forest', bn: 'বনসবুজ' }, bg: '#14281d', surface: '#1f3a2a', accent: '#86efac', onAccent: '#14281d', text: '#f0fdf4', muted: '#bbf7d0', price: '#fde047', deco: '#86efac' },
  { id: 'indigo_sun', name: { en: 'Indigo Sun', bn: 'নীল সূর্য' }, bg: '#1e1b4b', surface: '#312e81', accent: '#facc15', onAccent: '#1e1b4b', text: '#eef2ff', muted: '#c7d2fe', price: '#fde047', deco: '#facc15' },
  { id: 'hot_pink', name: { en: 'Hot Pink', bn: 'হট পিংক' }, bg: '#9d174d', surface: '#831843', accent: '#fde047', onAccent: '#500724', text: '#ffffff', muted: '#fce7f3', price: '#fde047', deco: '#fde047' },
  // Light canvases
  { id: 'clean_blue', name: { en: 'Clean Blue', bn: 'ক্লিন ব্লু' }, bg: '#ffffff', surface: '#f1f5f9', accent: '#1d4ed8', onAccent: '#ffffff', text: '#0f172a', muted: '#475569', price: '#15803d', deco: '#1d4ed8' },
  { id: 'boishakh', name: { en: 'Boishakh', bn: 'বৈশাখ' }, bg: '#fff7f5', surface: '#ffffff', accent: '#b91c1c', onAccent: '#ffffff', text: '#1c1917', muted: '#57534e', price: '#b91c1c', deco: '#dc2626' },
  { id: 'mint', name: { en: 'Mint', bn: 'মিন্ট' }, bg: '#ecfdf5', surface: '#ffffff', accent: '#047857', onAccent: '#ffffff', text: '#022c22', muted: '#065f46', price: '#047857', deco: '#10b981' },
  { id: 'blush', name: { en: 'Blush', bn: 'ব্লাশ' }, bg: '#fdf2f8', surface: '#ffffff', accent: '#be185d', onAccent: '#ffffff', text: '#3b0a24', muted: '#831843', price: '#be185d', deco: '#f472b6' },
  { id: 'explooro_amber', name: { en: 'Explooro Amber', bn: 'এক্সপ্লোরো অ্যাম্বার' }, bg: '#fbbf24', surface: '#ffffff', accent: '#1c1917', onAccent: '#fbbf24', text: '#1c1917', muted: '#44403c', price: '#991b1b', deco: '#ffffff' },
  { id: 'lavender', name: { en: 'Lavender', bn: 'ল্যাভেন্ডার' }, bg: '#f5f3ff', surface: '#ffffff', accent: '#6d28d9', onAccent: '#ffffff', text: '#1e1b4b', muted: '#4c1d95', price: '#6d28d9', deco: '#a78bfa' },
  { id: 'sand', name: { en: 'Sand', bn: 'বালুকা' }, bg: '#faf5ef', surface: '#ffffff', accent: '#9a3412', onAccent: '#ffffff', text: '#292524', muted: '#57534e', price: '#9a3412', deco: '#ea580c' },
  { id: 'sky', name: { en: 'Sky', bn: 'আকাশ' }, bg: '#e0f2fe', surface: '#ffffff', accent: '#0369a1', onAccent: '#ffffff', text: '#0c1a2b', muted: '#334155', price: '#0369a1', deco: '#38bdf8' },
  { id: 'paper_black', name: { en: 'Paper Black', bn: 'কাগজ-কালো' }, bg: '#f5f5f4', surface: '#ffffff', accent: '#0a0a0a', onAccent: '#ffffff', text: '#0a0a0a', muted: '#44403c', price: '#b91c1c', deco: '#0a0a0a' },
  { id: 'tangerine', name: { en: 'Tangerine', bn: 'কমলা' }, bg: '#fff7ed', surface: '#ffffff', accent: '#c2410c', onAccent: '#ffffff', text: '#1c1917', muted: '#57534e', price: '#c2410c', deco: '#fb923c' },
  { id: 'sage', name: { en: 'Sage', bn: 'সেজ' }, bg: '#f0f4ef', surface: '#ffffff', accent: '#3f6212', onAccent: '#ffffff', text: '#1a2e05', muted: '#3f6212', price: '#3f6212', deco: '#84cc16' },
  { id: 'puja', name: { en: 'Puja', bn: 'পূজা' }, bg: '#fff1f2', surface: '#ffffff', accent: '#9f1239', onAccent: '#fde68a', text: '#1c0a0f', muted: '#881337', price: '#9f1239', deco: '#e11d48' },
];

const b = (en: string, bn: string): Bilingual => ({ en, bn });

/** 'all' is the default view: every palette, everyday headlines. */
export const OCCASIONS: Occasion[] = [
  {
    id: 'all', emoji: '✨', label: b('All designs', 'সব ডিজাইন'), palettes: [],
    headlines: [
      b('Just for you', 'শুধু আপনার জন্য'),
      b('Order today', 'আজই অর্ডার করুন'),
      b('Quality you can trust', 'ভরসার মান'),
      b('Shop smart, live better', 'স্মার্ট কেনাকাটা'),
      b('Now available', 'এখন পাওয়া যাচ্ছে'),
      b('Delivered to your door', 'ঘরে বসেই ডেলিভারি'),
      b('Your new favourite', 'আপনার নতুন পছন্দ'),
      b('Don\'t miss out', 'মিস করবেন না'),
    ],
    tags: [b('Hot Deal', 'হট ডিল'), b('Order Now', 'অর্ডার করুন'), b('Trending', 'ট্রেন্ডিং')],
    caption: b('{headline}! {product}[ — only {price}]. Order here: {link}', '{headline}! {product}[ — মাত্র {price}]। অর্ডার করুন: {link}'),
    hashtags: '#Explooro #OnlineShopping #Bangladesh',
  },
  {
    id: 'flash_sale', emoji: '⚡', label: b('Flash sale', 'ফ্ল্যাশ সেল'),
    palettes: ['festive_red', 'noir_coral', 'explooro_amber', 'hot_pink', 'charcoal_lime', 'paper_black', 'tangerine', 'midnight'],
    headlines: [
      b('Flash sale is live', 'ফ্ল্যাশ সেল চলছে'),
      b('Hurry, today only', 'জলদি, শুধু আজ'),
      b('Grab it before it\'s gone', 'শেষ হওয়ার আগেই নিন'),
      b('Deal of the day', 'আজকের সেরা ডিল'),
      b('Fast hands win', 'আগে এলে আগে পাবেন'),
    ],
    tags: [b('Flash Sale', 'ফ্ল্যাশ সেল'), b('Today Only', 'শুধু আজ'), b('Limited Stock', 'সীমিত স্টক')],
    caption: b('⚡ {headline}! {product}[ at {price}]. Stock is limited — order now: {link}', '⚡ {headline}! {product}[ মাত্র {price}]। স্টক সীমিত — এখনই অর্ডার করুন: {link}'),
    hashtags: '#FlashSale #Explooro #DealOfTheDay',
  },
  {
    id: 'new_arrival', emoji: '🆕', label: b('New arrival', 'নতুন এসেছে'),
    palettes: ['clean_blue', 'mint', 'lavender', 'sky', 'paper_black', 'plum', 'ocean', 'blush'],
    headlines: [
      b('Just arrived', 'এইমাত্র এসেছে'),
      b('New in store', 'দোকানে নতুন'),
      b('Fresh pick of the week', 'সপ্তাহের নতুন পছন্দ'),
      b('Be the first to own it', 'সবার আগে আপনার'),
      b('Meet our newest', 'আমাদের নতুন সংগ্রহ'),
    ],
    tags: [b('New', 'নতুন'), b('Just In', 'সদ্য এসেছে'), b('Fresh Stock', 'নতুন স্টক')],
    caption: b('🆕 {headline}: {product}[ for {price}]. See it here: {link}', '🆕 {headline}: {product}[, দাম {price}]। দেখুন এখানে: {link}'),
    hashtags: '#NewArrival #Explooro #NewCollection',
  },
  {
    id: 'eid', emoji: '🌙', label: b('Eid', 'ঈদ'),
    palettes: ['emerald_night', 'royal_gold', 'forest', 'indigo_sun', 'mint', 'sand', 'maroon_cream', 'sage'],
    headlines: [
      b('Eid Mubarak', 'ঈদ মোবারক'),
      b('Make this Eid special', 'এই ঈদ হোক বিশেষ'),
      b('Eid shopping made easy', 'সহজে ঈদের কেনাকাটা'),
      b('Gift joy this Eid', 'ঈদে উপহার দিন আনন্দ'),
      b('Your Eid collection', 'আপনার ঈদ কালেকশন'),
    ],
    tags: [b('Eid Special', 'ঈদ স্পেশাল'), b('Eid Offer', 'ঈদ অফার'), b('Eid Gift', 'ঈদ উপহার')],
    caption: b('🌙 {headline}! {product}[ — {price}]. Order before Eid: {link}', '🌙 {headline}! {product}[ — {price}]। ঈদের আগেই অর্ডার করুন: {link}'),
    hashtags: '#EidMubarak #EidShopping #Explooro',
  },
  {
    id: 'ramadan', emoji: '🕌', label: b('Ramadan', 'রমজান'),
    palettes: ['emerald_night', 'indigo_sun', 'royal_gold', 'midnight', 'forest', 'lavender', 'sand', 'ocean'],
    headlines: [
      b('Ramadan Kareem', 'রমজান কারীম'),
      b('Blessed Ramadan', 'রহমতের রমজান'),
      b('Ready for iftar', 'ইফতারের জন্য প্রস্তুত'),
      b('Ramadan essentials', 'রমজানের প্রয়োজনীয়'),
      b('Shop calm this Ramadan', 'শান্তিতে কেনাকাটা'),
    ],
    tags: [b('Ramadan Special', 'রমজান স্পেশাল'), b('Iftar Pick', 'ইফতার পছন্দ'), b('Blessed Deal', 'বরকতের ডিল')],
    caption: b('🕌 {headline}. {product}[ for {price}], delivered to your door: {link}', '🕌 {headline}। {product}[ মাত্র {price}], ঘরে পৌঁছে যাবে: {link}'),
    hashtags: '#Ramadan #RamadanKareem #Explooro',
  },
  {
    id: 'boishakh', emoji: '🎏', label: b('Pohela Boishakh', 'পহেলা বৈশাখ'),
    palettes: ['boishakh', 'festive_red', 'puja', 'explooro_amber', 'sand', 'tangerine', 'maroon_cream', 'paper_black'],
    headlines: [
      b('Shubho Noborsho', 'শুভ নববর্ষ'),
      b('Welcome Boishakh', 'এসো হে বৈশাখ'),
      b('New year, new look', 'নতুন বছর, নতুন সাজ'),
      b('Celebrate Boishakh', 'বৈশাখ উদযাপন'),
      b('The Boishakhi collection', 'বৈশাখী কালেকশন'),
    ],
    tags: [b('Boishakhi Offer', 'বৈশাখী অফার'), b('Noborsho', 'নববর্ষ'), b('Festive Pick', 'উৎসবের পছন্দ')],
    caption: b('🎏 {headline}! {product}[ — {price}]. Order here: {link}', '🎏 {headline}! {product}[ — {price}]। অর্ডার করুন: {link}'),
    hashtags: '#PohelaBoishakh #ShubhoNoborsho #Explooro',
  },
  {
    id: 'puja', emoji: '🪔', label: b('Puja', 'পূজা'),
    palettes: ['puja', 'festive_red', 'royal_gold', 'maroon_cream', 'hot_pink', 'boishakh', 'tangerine', 'explooro_amber'],
    headlines: [
      b('Shubho Sharodiya', 'শুভ শারদীয়া'),
      b('Puja shopping is here', 'পূজার কেনাকাটা শুরু'),
      b('Dress up for Puja', 'পূজায় নতুন সাজ'),
      b('Festive joy', 'উৎসবের আনন্দ'),
      b('Your Puja collection', 'আপনার পূজা কালেকশন'),
    ],
    tags: [b('Puja Special', 'পূজা স্পেশাল'), b('Festive Offer', 'উৎসব অফার'), b('Sharodiya', 'শারদীয়া')],
    caption: b('🪔 {headline}! {product}[ — {price}]. Order now: {link}', '🪔 {headline}! {product}[ — {price}]। এখনই অর্ডার করুন: {link}'),
    hashtags: '#DurgaPuja #ShubhoSharodiya #Explooro',
  },
  {
    id: 'winter', emoji: '❄️', label: b('Winter', 'শীত'),
    palettes: ['ocean', 'sky', 'midnight', 'clean_blue', 'indigo_sun', 'lavender', 'paper_black', 'forest'],
    headlines: [
      b('Winter is here', 'শীত এসে গেছে'),
      b('Stay warm, stay stylish', 'উষ্ণ থাকুন, স্টাইলিশ থাকুন'),
      b('Winter must-have', 'শীতের অবশ্যই চাই'),
      b('Cozy season picks', 'শীতের সেরা পছন্দ'),
      b('Ready for the cold', 'শীতের প্রস্তুতি'),
    ],
    tags: [b('Winter Pick', 'শীতের পছন্দ'), b('Season Deal', 'মৌসুমি ডিল'), b('Warm Up', 'উষ্ণতা')],
    caption: b('❄️ {headline}! {product}[ for {price}]. Order here: {link}', '❄️ {headline}! {product}[ মাত্র {price}]। অর্ডার করুন: {link}'),
    hashtags: '#Winter #WinterCollection #Explooro',
  },
  {
    id: 'wedding', emoji: '💍', label: b('Wedding season', 'বিয়ের মৌসুম'),
    palettes: ['maroon_cream', 'royal_gold', 'blush', 'hot_pink', 'puja', 'plum', 'sand', 'festive_red'],
    headlines: [
      b('Wedding season is on', 'বিয়ের মৌসুম চলছে'),
      b('The perfect gift', 'সেরা উপহার'),
      b('Shine on the big day', 'বিশেষ দিনে ঝলমলে'),
      b('Made for celebrations', 'উৎসবের জন্য তৈরি'),
      b('Gift with love', 'ভালোবাসার উপহার'),
    ],
    tags: [b('Wedding Pick', 'বিয়ের পছন্দ'), b('Gift Idea', 'উপহার'), b('Special', 'স্পেশাল')],
    caption: b('💍 {headline}! {product}[ — {price}]. Order here: {link}', '💍 {headline}! {product}[ — {price}]। অর্ডার করুন: {link}'),
    hashtags: '#WeddingSeason #GiftIdeas #Explooro',
  },
  {
    id: 'free_delivery', emoji: '🚚', label: b('Fast delivery', 'দ্রুত ডেলিভারি'),
    palettes: ['clean_blue', 'mint', 'sky', 'ocean', 'forest', 'sage', 'charcoal_lime', 'explooro_amber'],
    headlines: [
      b('Delivered to your door', 'ঘরে বসেই ডেলিভারি'),
      b('Order now, relax later', 'অর্ডার দিন, নিশ্চিন্ত থাকুন'),
      b('All over Bangladesh', 'সারা বাংলাদেশে'),
      b('Cash on delivery', 'ক্যাশ অন ডেলিভারি'),
      b('Easy order, safe delivery', 'সহজ অর্ডার, নিরাপদ ডেলিভারি'),
    ],
    tags: [b('Home Delivery', 'হোম ডেলিভারি'), b('Fast Delivery', 'দ্রুত ডেলিভারি'), b('Nationwide', 'সারাদেশে')],
    caption: b('🚚 {headline}! {product}[ for {price}]. Order here: {link}', '🚚 {headline}! {product}[ মাত্র {price}]। অর্ডার করুন: {link}'),
    hashtags: '#HomeDelivery #Explooro #OnlineShoppingBD',
  },
  {
    id: 'best_seller', emoji: '🔥', label: b('Best seller', 'সর্বাধিক বিক্রিত'),
    palettes: ['royal_gold', 'noir_coral', 'paper_black', 'midnight', 'explooro_amber', 'plum', 'tangerine', 'indigo_sun'],
    headlines: [
      b('Customers love it', 'ক্রেতাদের প্রিয়'),
      b('Our best seller', 'আমাদের সেরা বিক্রি'),
      b('Top rated pick', 'সেরা রেটিং'),
      b('Everyone is buying this', 'সবাই কিনছে'),
      b('Back by demand', 'চাহিদায় আবার এলো'),
    ],
    tags: [b('Best Seller', 'বেস্ট সেলার'), b('Top Pick', 'সেরা পছন্দ'), b('Popular', 'জনপ্রিয়')],
    caption: b('🔥 {headline}! {product}[ — {price}]. Get yours: {link}', '🔥 {headline}! {product}[ — {price}]। আপনারটা নিন: {link}'),
    hashtags: '#BestSeller #Explooro #TopPick',
  },
  {
    id: 'weekend', emoji: '🛍️', label: b('Weekend', 'ছুটির দিন'),
    palettes: ['hot_pink', 'lavender', 'tangerine', 'mint', 'sky', 'blush', 'charcoal_lime', 'plum'],
    headlines: [
      b('Weekend shopping', 'ছুটির দিনের কেনাকাটা'),
      b('Treat yourself', 'নিজেকে উপহার দিন'),
      b('Friday favourites', 'শুক্রবারের পছন্দ'),
      b('Weekend vibes', 'ছুটির আমেজ'),
      b('Relax and shop', 'আরামে কেনাকাটা'),
    ],
    tags: [b('Weekend Deal', 'ছুটির ডিল'), b('Treat', 'ট্রিট'), b('Trending', 'ট্রেন্ডিং')],
    caption: b('🛍️ {headline}! {product}[ for {price}]. Order here: {link}', '🛍️ {headline}! {product}[ মাত্র {price}]। অর্ডার করুন: {link}'),
    hashtags: '#WeekendShopping #Explooro #TreatYourself',
  },
  {
    id: 'mega_sale', emoji: '🎯', label: b('Mega campaign', 'মেগা ক্যাম্পেইন'),
    palettes: ['charcoal_lime', 'explooro_amber', 'hot_pink', 'noir_coral', 'indigo_sun', 'festive_red', 'paper_black', 'midnight'],
    headlines: [
      b('The biggest sale', 'সবচেয়ে বড় সেল'),
      b('Mega campaign is live', 'মেগা ক্যাম্পেইন চলছে'),
      b('Shop the big days', 'বড় দিনের কেনাকাটা'),
      b('Countdown is on', 'কাউন্টডাউন শুরু'),
      b('Big days, big picks', 'বড় দিন, বড় পছন্দ'),
    ],
    tags: [b('Mega Sale', 'মেগা সেল'), b('11.11', '১১.১১'), b('Big Day', 'বড় দিন')],
    caption: b('🎯 {headline}! {product}[ for {price}]. Order before it ends: {link}', '🎯 {headline}! {product}[ মাত্র {price}]। শেষ হওয়ার আগেই অর্ডার করুন: {link}'),
    hashtags: '#MegaSale #Explooro #ShopNow',
  },
];

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

export function occasionById(id: string): Occasion {
  return OCCASIONS.find((o) => o.id === id) || OCCASIONS[0];
}

/** The palettes an occasion draws from, in a stable order. */
export function palettesFor(occasion: Occasion): Palette[] {
  return occasion.palettes.length ? occasion.palettes.map(paletteById) : PALETTES;
}

/** How many distinct designs an occasion offers in one format. */
export function designCount(occasion: Occasion): number {
  return LAYOUTS.length * palettesFor(occasion).length * PATTERNS.length * occasion.headlines.length;
}

export interface DesignRef {
  occasion: string;
  layout: LayoutId;
  palette: string;
  pattern: PatternId;
  headline: number;
}

/**
 * The design at position `i` of an occasion's gallery.
 *
 * WHY this numbering and not a plain nested loop: a nested loop would show twelve layouts in the
 * same palette, pattern and headline, then the next palette — the first screen would look like one
 * design twelve times. Here the layout changes every step and palette, pattern and headline each
 * shift by the digits before them, so neighbours differ in everything while every index still
 * maps to exactly one design (each step is a shift of one digit, so the map is a bijection —
 * flyerEngine.test.js checks no two indexes collide).
 */
export function designAt(occasion: Occasion, i: number): DesignRef {
  const pals = palettesFor(occasion);
  const L = LAYOUTS.length;
  const P = pals.length;
  const B = PATTERNS.length;
  const H = occasion.headlines.length;
  const n = ((Math.floor(i) % designCount(occasion)) + designCount(occasion)) % designCount(occasion);
  const layout = n % L;
  const j = Math.floor(n / L);
  const a = j % P;
  const bq = Math.floor(j / P) % B;
  const c = Math.floor(j / (P * B)) % H;
  return {
    occasion: occasion.id,
    layout: LAYOUTS[layout],
    palette: pals[(a + layout * 5) % P].id,
    pattern: PATTERNS[(bq + a) % B],
    headline: (c + a + bq) % H,
  };
}

export function designKey(d: DesignRef): string {
  return `${d.occasion}.${d.layout}.${d.palette}.${d.pattern}.${d.headline}`;
}

export function parseDesignKey(key: string): DesignRef | null {
  const [occ, layout, palette, pattern, h] = String(key || '').split('.');
  const occasion = OCCASIONS.find((o) => o.id === occ);
  if (!occasion || !LAYOUTS.includes(layout as LayoutId) || !PALETTES.some((p) => p.id === palette)
    || !PATTERNS.includes(pattern as PatternId)) return null;
  const headline = Number(h);
  if (!Number.isInteger(headline) || headline < 0 || headline >= occasion.headlines.length) return null;
  return { occasion: occ, layout: layout as LayoutId, palette, pattern: pattern as PatternId, headline };
}
