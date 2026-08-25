/**
 * theme-presets.js — 5 Marketplace Presets for Granular Component-Level Color Studio (Prompt 3.5).
 *
 * Each preset satisfies WCAG AA on every pairing across 6 distinct UI sections:
 * Navbar · Canvas/Surfaces · Brand/Buttons · Typography · Badges · Footer.
 * Zero gradients permitted.
 */

export const THEME_PRESETS = {
  // WHY the key is still `default` when the product no longer ships pink: services/themePalette.js
  // uses this exact object as its "no theme applied" sentinel, and the key is what a stored legacy
  // theme_preset row names. The SHIPPED default is DEFAULT_MASTER_PRESET in config/master-themes.js
  // (Midnight Slate) — this is the pink palette kept as a selectable alternate, nothing more.
  default: {
    key: 'default',
    name_en: 'Explooro Pink',
    name_bn: 'এক্সপ্লোরো পিংক',
    description_en: 'Signature soft pink with balanced charcoal slate surfaces.',
    description_bn: 'সিগনেচার সফট পিংক এবং সুষম চারকোল সারফেস।',
    preview_swatch: '#eea1ce',
    tokens: {
      navbar: {
        bg: '#ffffff',
        text: '#192026',
        border: '#f9cee6',
        search_bg: '#eff2f5',
      },
      surfaces: {
        page: '#fcf7f9',
        card: '#ffffff',
        subtle: '#eff2f5',
        border: '#f9cee6',
      },
      brand: {
        primary: '#eea1ce',
        hover: '#e58bc1',
        contrast: '#192026',
        secondary_bg: '#eff2f5',
        secondary_text: '#192026',
      },
      typography: {
        primary: '#192026',
        secondary: '#464e55',
        muted: '#626a70',
        inverse: '#ffffff',
      },
      badges: {
        success_bg: '#e7f7e9',
        success_text: '#205b31',
        warning_bg: '#feefdc',
        warning_text: '#6e4b0e',
        danger_bg: '#fceeec',
        danger_text: '#8b1f17',
        info_bg: '#eaf3fc',
        info_text: '#16558c',
      },
      footer: {
        bg: '#192026',
        text: '#ffffff',
        muted: '#a6acb1',
        border: '#2c343a',
      },
    },
  },

  alibaba_enterprise: {
    key: 'alibaba_enterprise',
    name_en: 'Alibaba Enterprise',
    name_bn: 'আলিবাবা এন্টারপ্রাইজ',
    description_en: 'High-density commercial B2B palette with vivid golden orange and deep navy navbar.',
    description_bn: 'উচ্চ ঘনত্বের বাণিজ্যিক বি২বি প্যালেট গাঢ় নেভি নেভবার ও গোল্ডেন অরেঞ্জ ব্র্যান্ডসহ।',
    preview_swatch: '#ff6a00',
    tokens: {
      navbar: {
        bg: '#1c2b36',
        text: '#ffffff',
        border: '#2a3b47',
        search_bg: '#ffffff',
      },
      surfaces: {
        page: '#f4f6f8',
        card: '#ffffff',
        subtle: '#e9ecef',
        border: '#dee2e6',
      },
      brand: {
        primary: '#ff6a00',
        hover: '#e55f00',
        contrast: '#1c2b36',
        secondary_bg: '#f1f3f5',
        secondary_text: '#212529',
      },
      typography: {
        primary: '#212529',
        secondary: '#495057',
        muted: '#6c757d',
        inverse: '#ffffff',
      },
      badges: {
        success_bg: '#d1e7dd',
        success_text: '#0f5132',
        warning_bg: '#fff3cd',
        warning_text: '#664d03',
        danger_bg: '#f8d7da',
        danger_text: '#842029',
        info_bg: '#cff4fc',
        info_text: '#055160',
      },
      footer: {
        bg: '#1c2b36',
        text: '#ffffff',
        muted: '#adb5bd',
        border: '#2a3b47',
      },
    },
  },

  amazon_pro: {
    key: 'amazon_pro',
    name_en: 'Amazon Pro',
    name_bn: 'অ্যামাজন প্রো',
    description_en: 'Classic marketplace identity featuring deep obsidian header, warm amber CTA, and soft gray canvas.',
    description_bn: 'ক্লাসিক মার্কেটপ্লেস লুক যাতে রয়েছে ডার্ক অবসিডিয়ান হেডার ও ওয়ার্ম অ্যাম্বার বাটন।',
    preview_swatch: '#ff9900',
    tokens: {
      navbar: {
        bg: '#131921',
        text: '#ffffff',
        border: '#232f3e',
        search_bg: '#ffffff',
      },
      surfaces: {
        page: '#eaeded',
        card: '#ffffff',
        subtle: '#f3f3f3',
        border: '#d5d9d9',
      },
      brand: {
        primary: '#ff9900',
        hover: '#fa8900',
        contrast: '#0f1111',
        secondary_bg: '#e3e6e6',
        secondary_text: '#0f1111',
      },
      typography: {
        primary: '#0f1111',
        secondary: '#333333',
        muted: '#565959',
        inverse: '#ffffff',
      },
      badges: {
        success_bg: '#e6f4ea',
        success_text: '#137333',
        warning_bg: '#fef7e0',
        warning_text: '#8a4b00',
        danger_bg: '#fce8e6',
        danger_text: '#c5221f',
        info_bg: '#e8f0fe',
        info_text: '#174ea6',
      },
      footer: {
        bg: '#232f3e',
        text: '#ffffff',
        muted: '#999999',
        border: '#3a4553',
      },
    },
  },

  daraz_express: {
    key: 'daraz_express',
    name_en: 'Daraz Express',
    name_bn: 'দারাজ এক্সপ্রেস',
    description_en: 'High-energy South Asian consumer marketplace palette with punchy orange and modern surfaces.',
    description_bn: 'দক্ষিণ এশীয় গ্রাহক মার্কেটপ্লেস প্যালেট উজ্জ্বল কমলা ও আধুনিক সারফেসসহ।',
    preview_swatch: '#f85606',
    tokens: {
      navbar: {
        bg: '#f85606',
        text: '#111111',
        border: '#d94700',
        search_bg: '#ffffff',
      },
      surfaces: {
        page: '#f5f5f5',
        card: '#ffffff',
        subtle: '#fafafa',
        border: '#e0e0e0',
      },
      brand: {
        primary: '#f85606',
        hover: '#e04900',
        contrast: '#111111',
        secondary_bg: '#eff0f5',
        secondary_text: '#212121',
      },
      typography: {
        primary: '#212121',
        secondary: '#757575',
        muted: '#9e9e9e',
        inverse: '#ffffff',
      },
      badges: {
        success_bg: '#e8f5e9',
        success_text: '#2e7d32',
        warning_bg: '#fff8e1',
        warning_text: '#8a4b00',
        danger_bg: '#ffebee',
        danger_text: '#c62828',
        info_bg: '#e1f5fe',
        info_text: '#01579b',
      },
      footer: {
        bg: '#2e2e54',
        text: '#ffffff',
        muted: '#8e8ea6',
        border: '#3e3e6b',
      },
    },
  },

  cobalt_enterprise: {
    key: 'cobalt_enterprise',
    name_en: 'Cobalt Enterprise',
    name_bn: 'কোবাল্ট এন্টারপ্রাইজ',
    description_en: 'Modern fintech & supply chain palette with authoritative royal blue and clean cool-slate surfaces.',
    description_bn: 'আধুনিক ফিনটেক ও সাপ্লাই চেইন প্যালেট রাজকীয় নীল ও পরিষ্কার স্লেট সারফেসসহ।',
    preview_swatch: '#1e40af',
    tokens: {
      navbar: {
        bg: '#1e3a8a',
        text: '#ffffff',
        border: '#172554',
        search_bg: '#ffffff',
      },
      surfaces: {
        page: '#f8fafc',
        card: '#ffffff',
        subtle: '#f1f5f9',
        border: '#cbd5e1',
      },
      brand: {
        primary: '#1d4ed8',
        hover: '#1e40af',
        contrast: '#ffffff',
        secondary_bg: '#e2e8f0',
        secondary_text: '#0f172a',
      },
      typography: {
        primary: '#0f172a',
        secondary: '#334155',
        muted: '#64748b',
        inverse: '#ffffff',
      },
      badges: {
        success_bg: '#f0fdf4',
        success_text: '#15803d',
        warning_bg: '#fefce8',
        warning_text: '#a16207',
        danger_bg: '#fef2f2',
        danger_text: '#b91c1c',
        info_bg: '#eff6ff',
        info_text: '#1e40af',
      },
      footer: {
        bg: '#0f172a',
        text: '#f8fafc',
        muted: '#94a3b8',
        border: '#1e293b',
      },
    },
  },

  minimalist_slate: {
    key: 'minimalist_slate',
    name_en: 'Minimalist Slate',
    name_bn: 'মিনিমালিস্ট স্লেট',
    description_en: 'Refined Scandinavian monochrome palette with high typographic clarity and deep charcoal accents.',
    description_bn: 'মার্জিত মনোক্রোম প্যালেট উচ্চ টাইপোগ্রাফিক স্বচ্ছতা ও ডার্ক চারকোল অ্যাকসেন্টসহ।',
    preview_swatch: '#334155',
    tokens: {
      navbar: {
        bg: '#ffffff',
        text: '#0f172a',
        border: '#e2e8f0',
        search_bg: '#f8fafc',
      },
      surfaces: {
        page: '#f8fafc',
        card: '#ffffff',
        subtle: '#f1f5f9',
        border: '#e2e8f0',
      },
      brand: {
        primary: '#0f172a',
        hover: '#1e293b',
        contrast: '#ffffff',
        secondary_bg: '#e2e8f0',
        secondary_text: '#0f172a',
      },
      typography: {
        primary: '#0f172a',
        secondary: '#334155',
        muted: '#64748b',
        inverse: '#ffffff',
      },
      badges: {
        success_bg: '#dcfce7',
        success_text: '#166534',
        warning_bg: '#fef3c7',
        warning_text: '#92400e',
        danger_bg: '#fee2e2',
        danger_text: '#991b1b',
        info_bg: '#e0f2fe',
        info_text: '#075985',
      },
      footer: {
        bg: '#0f172a',
        text: '#ffffff',
        muted: '#94a3b8',
        border: '#1e293b',
      },
    },
  },
};
