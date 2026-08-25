/**
 * master-themes.js — Master Colour presets: one seed colour each, everything else generated.
 *
 * Contrast with theme-presets.js, which hand-authors ~33 hex values per preset and therefore can
 * only repaint the roles someone remembered to list. A master preset carries no palette at all —
 * services/colorRamp.js derives the full brand / neutral / status / accent ramps from the seed,
 * so borders, hover fills, scrollbars, focus rings and the whole dark theme move with it.
 *
 * Adding a preset here is one object. Do NOT paste hex ramps in — if a preset needs a colour the
 * generator will not produce, the generator is what needs fixing.
 */

export const MASTER_PRESETS = {
  midnight_slate: {
    key: 'midnight_slate',
    name_en: 'Midnight Slate',
    name_bn: 'মিডনাইট স্লেট',
    description_en: 'Near-monochrome slate — the shipped default. Typography and product photography carry all the colour.',
    description_bn: 'প্রায়-মনোক্রোম স্লেট — এটিই ডিফল্ট। রঙের ভার টাইপোগ্রাফি ও পণ্যের ছবির উপর।',
    master: {
      seed: '#334155',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 1,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },
  explooro_pink: {
    key: 'explooro_pink',
    name_en: 'Explooro Pink',
    name_bn: 'এক্সপ্লোরো পিংক',
    description_en: 'The signature soft pink on cool charcoal neutrals — the identity this system shipped with, now the alternate.',
    description_bn: 'সিগনেচার সফট পিংক, কুল চারকোল নিউট্রালের সাথে — শুরুর পরিচয়, এখন বিকল্প।',
    // WHY these exact values: fed through colorRamp.js they reproduce styles/themes.css as
    // authored, so "Reset to default" is a real round-trip and not an approximation.
    master: {
      seed: '#eea1ce',
      vividness: 1,
      neutralMode: 'cool',
      neutralTint: 1,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: true,
      borderTint: true,
    },
  },

  cobalt_trust: {
    key: 'cobalt_trust',
    name_en: 'Cobalt Trust',
    name_bn: 'কোবাল্ট ট্রাস্ট',
    description_en: 'Authoritative fintech blue — the register for escrow, vault and payout surfaces.',
    description_bn: 'ফিনটেক নীল — এসক্রো, ভল্ট ও পেআউট স্ক্রিনের জন্য উপযুক্ত।',
    master: {
      seed: '#1d4ed8',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 1.4,
      accentHarmony: 'complement',
      statusPull: 0.35,
      surfaceWash: true,
      borderTint: true,
    },
  },

  emerald_market: {
    key: 'emerald_market',
    name_en: 'Emerald Market',
    name_bn: 'এমারেল্ড মার্কেট',
    description_en: 'Calm deep teal with muted greens. Reads as steady and inventory-led.',
    description_bn: 'শান্ত গাঢ় টিল, মিউটেড সবুজের সাথে। স্থির ও ইনভেন্টরি-কেন্দ্রিক অনুভূতি।',
    master: {
      seed: '#0f766e',
      vividness: 1.15,
      neutralMode: 'match',
      neutralTint: 1.3,
      accentHarmony: 'complement',
      statusPull: 0.3,
      surfaceWash: true,
      borderTint: true,
    },
  },

  amber_bazaar: {
    key: 'amber_bazaar',
    name_en: 'Amber Bazaar',
    name_bn: 'অ্যাম্বার বাজার',
    description_en: 'High-energy marketplace amber on warm neutrals — the Daraz/Amazon register.',
    description_bn: 'উচ্চ-শক্তির মার্কেটপ্লেস অ্যাম্বার, উষ্ণ নিউট্রালের সাথে।',
    master: {
      seed: '#f59e0b',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 1.2,
      accentHarmony: 'complement',
      statusPull: 0.2,
      surfaceWash: true,
      borderTint: true,
    },
  },

  royal_violet: {
    key: 'royal_violet',
    name_en: 'Royal Violet',
    name_bn: 'রয়্যাল ভায়োলেট',
    description_en: 'Premium violet with a strongly tinted neutral family. Boutique, not commodity.',
    description_bn: 'প্রিমিয়াম ভায়োলেট, স্পষ্ট টিন্টেড নিউট্রাল পরিবারসহ। বুটিক লুক।',
    master: {
      seed: '#7c3aed',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 1.6,
      accentHarmony: 'analogous',
      statusPull: 0.3,
      surfaceWash: true,
      borderTint: true,
    },
  },

  crimson_flash: {
    key: 'crimson_flash',
    name_en: 'Crimson Flash',
    name_bn: 'ক্রিমসন ফ্ল্যাশ',
    description_en: 'Urgent crimson for flash-sale-led storefronts. Loud by design.',
    description_bn: 'ফ্ল্যাশ সেল-কেন্দ্রিক স্টোরের জন্য জরুরি ক্রিমসন। ইচ্ছাকৃতভাবে উচ্চকিত।',
    master: {
      seed: '#be123c',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 1.5,
      accentHarmony: 'complement',
      statusPull: 0.25,
      surfaceWash: true,
      borderTint: true,
    },
  },

  sunset_coral: {
    key: 'sunset_coral',
    name_en: 'Sunset Coral',
    name_bn: 'সানসেট কোরাল',
    description_en: 'The pre-pink coral identity, regenerated end to end rather than restored by hand.',
    description_bn: 'পিংকের আগের কোরাল পরিচয়, হাতে নয় — সম্পূর্ণ জেনারেট করা।',
    master: {
      seed: '#f2603c',
      vividness: 1,
      neutralMode: 'cool',
      neutralTint: 1,
      accentHarmony: 'triad',
      statusPull: 0.2,
      surfaceWash: true,
      borderTint: true,
    },
  },

};

/**
 * The colour the product ships with. `initTheme()` mounts this on every boot that has no published
 * palette, so it is the real default — not just where the Theme Studio starts.
 *
 * WHY it is not colorRamp.js's DEFAULT_MASTER: that constant is the ENGINE's calibration baseline,
 * pinned to the pink ladder authored in styles/themes.css so the generator can be proved to
 * reproduce it (client/test/colorRamp.test.js). Which colour the PRODUCT defaults to is a separate
 * decision, and it lives here.
 */
export const DEFAULT_MASTER_PRESET = 'midnight_slate';
