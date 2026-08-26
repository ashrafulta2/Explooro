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
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  pure_gold: {
    key: 'pure_gold',
    name_en: 'Pure Gold & Black',
    name_bn: 'পিওর গোল্ড ও ব্ল্যাক',
    description_en: 'Royal luxury identity featuring pure gold accents (#ffbc00) paired with solid obsidian black.',
    description_bn: 'বিলাসবহুল রয়্যাল লুক — খাঁটি গোল্ড অ্যাকসেন্ট (#ffbc00) এবং অবসিডিয়ান ব্ল্যাক কম্বিনেশন।',
    master: {
      seed: '#ffbc00',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  amazon_pro: {
    key: 'amazon_pro',
    name_en: 'Amazon Pro',
    name_bn: 'অ্যামাজন প্রো',
    description_en: 'Classic marketplace identity featuring warm amber CTA buttons on crisp white/neutral surfaces.',
    description_bn: 'ক্লাসিক মার্কেটপ্লেস লুক — পরিষ্কার নিউট্রাল সারফেসে ওয়ার্ম অ্যাম্বার বাটন অ্যাকসেন্ট।',
    master: {
      seed: '#ff9900',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  alibaba_enterprise: {
    key: 'alibaba_enterprise',
    name_en: 'Alibaba Enterprise',
    name_bn: 'আলিবাবা এন্টারপ্রাইজ',
    description_en: 'Commercial B2B marketplace styling with vivid golden orange CTA buttons and clean neutral cards.',
    description_bn: 'বাণিজ্যিক বি২বি মার্কেটপ্লেস লুক — গোল্ডেন অরেঞ্জ অ্যাকসেন্ট এবং পরিষ্কার নিউট্রাল কার্ড।',
    master: {
      seed: '#ff6a00',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  daraz_express: {
    key: 'daraz_express',
    name_en: 'Daraz Express',
    name_bn: 'দারাজ এক্সপ্রেস',
    description_en: 'South Asian consumer marketplace styling with vibrant orange buttons on clean white canvas.',
    description_bn: 'দক্ষিণ এশীয় মার্কেটপ্লেস লুক — প্রাণবন্ত কমলা অ্যাকসেন্ট ও পরিষ্কার সাদা সারফেস।',
    master: {
      seed: '#f85606',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  cobalt_trust: {
    key: 'cobalt_trust',
    name_en: 'Cobalt Trust',
    name_bn: 'কোবাল্ট ট্রাস্ট',
    description_en: 'Authoritative fintech blue accents on clean neutral surfaces for escrow and vault flows.',
    description_bn: 'ফিনটেক ব্লু অ্যাকসেন্ট ও পরিষ্কার নিউট্রাল সারফেস — এসক্রো ও ভল্টের জন্য।',
    master: {
      seed: '#1d4ed8',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  fresh_black_white: {
    key: 'fresh_black_white',
    name_en: 'Clean Monochrome',
    name_bn: 'ক্লিন মনোক্রোম',
    description_en: 'Pure Scandinavian monochrome identity — solid dark buttons on a crisp white canvas.',
    description_bn: 'খাঁটি মনোক্রোম পরিচয় — ঝকঝকে সাদা ক্যানভাসে সলিড ডার্ক বাটন।',
    master: {
      seed: '#111111',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'mono',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  emerald_market: {
    key: 'emerald_market',
    name_en: 'Emerald Market',
    name_bn: 'এমারেল্ড মার্কেট',
    description_en: 'Calm deep teal accents on clean neutral surfaces. Reads as steady and inventory-led.',
    description_bn: 'গাঢ় টিল অ্যাকসেন্ট ও পরিষ্কার নিউট্রাল সারফেস — স্থির অনুভূতি।',
    master: {
      seed: '#0f766e',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },

  crimson_flash: {
    key: 'crimson_flash',
    name_en: 'Crimson Flash',
    name_bn: 'ক্রিমসন ফ্ল্যাশ',
    description_en: 'Urgent crimson action accents on clean neutral canvas for promotional storefronts.',
    description_bn: 'জরুরি ক্রিমসন অ্যাকসেন্ট ও পরিষ্কার নিউট্রাল ক্যানভাস।',
    master: {
      seed: '#be123c',
      vividness: 1,
      neutralMode: 'match',
      neutralTint: 0,
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
    description_en: 'Signature soft pink accents on clean neutral slate surfaces.',
    description_bn: 'সিগনেচার সফট পিংক অ্যাকসেন্ট ও পরিষ্কার নিউট্রাল স্লেট সারফেস।',
    master: {
      seed: '#eea1ce',
      vividness: 1,
      neutralMode: 'cool',
      neutralTint: 0,
      accentHarmony: 'complement',
      statusPull: 0,
      surfaceWash: false,
      borderTint: false,
    },
  },
};

/**
 * The colour the product ships with. `initTheme()` mounts this on every boot that has no published
 * palette, so it is the real default — not just where the Theme Studio starts.
 *
 * It must stay identical to `DEFAULT_MASTER` in services/colorRamp.js, which is what
 * styles/themes.css is generated from — and client/test/colorRamp.test.js fails if the two drift.
 * WHY both exist rather than one: this file is the human-facing preset list (names, descriptions,
 * the Studio's chips), while DEFAULT_MASTER is the engine's own fallback for a partial config and
 * has to live beside the generator that the server imports too. They are different jobs that
 * happen to need the same numbers, so the test — not a comment — is what keeps them equal.
 *
 * Changing the shipped colour therefore means: edit both, then run `node scripts/palette.mjs
 * --write`. Skip the regenerate and the product flashes the old colour on every cold load.
 */
export const DEFAULT_MASTER_PRESET = 'pure_gold';
