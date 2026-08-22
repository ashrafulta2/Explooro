/**
 * transliterate.js — Banglish ⇄ Bengali phonetic dictionary & normalization (Prompt 4.4).
 *
 * Enables Bangladeshi marketplace users to search in Latin script (e.g. "shari", "punjabi", "modhu")
 * and seamlessly match products and categories in both English and native Bengali script.
 */

// Commerce synonyms & phonetic equivalence dictionary
export const BANGLISH_COMMERCE_DICTIONARY = {
  // Traditional & Apparel
  'shari': ['শাড়ি', 'saree', 'sari', 'shari'],
  'sari': ['শাড়ি', 'saree', 'shari', 'sari'],
  'saree': ['শাড়ি', 'sari', 'shari', 'saree'],
  'jamdani': ['জামদানি', 'jamdani'],
  'panjabi': ['পাঞ্জাবি', 'punjabi', 'panjabi', 'panzabi'],
  'punjabi': ['পাঞ্জাবি', 'panjabi', 'punjabi'],
  'kurti': ['কুর্তি', 'kurti', 'kurta'],
  'kamiz': ['কামিজ', 'kameez', 'kamiz'],
  'kameez': ['কামিজ', 'kamiz', 'kameez'],
  'fotua': ['ফতুয়া', 'fatua', 'fotua'],
  'koti': ['কোটি', 'কটি', 'koti'],
  'lungi': ['লুঙ্গি', 'lungi'],
  'gamcha': ['গামছা', 'gamcha'],
  'kantha': ['কাঁথা', 'nakshi', 'kantha', 'katha'],
  'nakshi': ['নকশী', 'নকশা', 'nakshi', 'kantha'],

  // Western & Daily Wear
  'shirt': ['শার্ট', 'shirt', 'shart'],
  'tshirt': ['টি-শার্ট', 'tshirt', 't-shirt', 't shirt'],
  'polo': ['পোলো', 'polo'],
  'pant': ['প্যান্ট', 'pant', 'pants', 'trouser'],
  'jeans': ['জিন্স', 'jeans', 'denim'],
  'chino': ['চিনো', 'chino'],
  'wallet': ['ওয়ালেট', 'মানিব্যাগ', 'wallet', 'purse'],
  'bag': ['ব্যাগ', 'bag', 'backpack'],
  'belt': ['বেল্ট', 'belt'],
  'shoe': ['জুতা', 'জুতো', 'shoe', 'shoes', 'sneaker'],
  'shoes': ['জুতা', 'জুতো', 'shoes', 'shoe'],

  // Electronics & Gadgets
  'ghori': ['ঘড়ি', 'watch', 'smartwatch', 'ghori'],
  'watch': ['ঘড়ি', 'watch', 'smartwatch'],
  'headphone': ['হেডফোন', 'headphone', 'earphone', 'tws', 'earbuds'],
  'earbuds': ['ইয়ারবাডস', 'earbuds', 'tws', 'headphone'],
  'earphone': ['ইয়ারফোন', 'earphone', 'earbuds'],
  'charger': ['চার্জার', 'charger', 'adapter'],
  'powerbank': ['পাওয়ার ব্যাংক', 'powerbank', 'power bank'],
  'mouse': ['মাউস', 'mouse'],
  'keyboard': ['কীবোর্ড', 'keyboard'],
  'speaker': ['স্পিকার', 'speaker', 'soundbox'],

  // Food & Organic Groceries
  'modhu': ['মধু', 'honey', 'modhu', 'madhu'],
  'madhu': ['মধু', 'honey', 'modhu'],
  'honey': ['মধু', 'honey', 'modhu'],
  'tel': ['তেল', 'oil', 'mustard', 'tel'],
  'oil': ['তেল', 'oil'],
  'sorisha': ['সরিষা', 'সরিষার', 'mustard', 'shorisha', 'sorisha'],
  'shorisha': ['সরিষা', 'mustard', 'sorisha'],
  'mustard': ['সরিষা', 'mustard', 'oil'],
  'ghee': ['ঘি', 'গাওয়া', 'ghee'],
  'ghi': ['ঘি', 'ghee'],
  'chal': ['চাল', 'পোলাও', 'rice', 'kalijira', 'chal'],
  'chaal': ['চাল', 'rice', 'chal'],
  'rice': ['চাল', 'পোলাও', 'rice'],
  'cha': ['চা', 'tea', 'cha'],
  'tea': ['চা', 'tea'],
  'holud': ['হলুদ', 'turmeric', 'holud', 'haldi'],
  'haldi': ['হলুদ', 'turmeric', 'holud'],
  'morich': ['মরিচ', 'chili', 'chilli', 'morich'],
  'elachi': ['এলাচ', 'cardamom', 'elachi', 'elach'],
  'badam': ['বাদাম', 'almond', 'badam', 'nuts'],
  'almond': ['কাঠবাদাম', 'বাদাম', 'almond'],
  'chia': ['চিয়া', 'চিয়া', 'chia'],
  'kalijira': ['কালোজিরা', 'কালিজিরা', 'kalijira', 'black seed'],

  // Home & Crafts
  'chula': ['চুলা', 'chula', 'stove', 'cooker'],
  'mop': ['মপ', 'ঝাড়ু', 'mop'],
  'rug': ['ম্যাট', 'রাগ', 'rug', 'mat'],
  'mat': ['ম্যাট', 'পাটি', 'mat', 'rug'],
  'tub': ['টব', 'প্ল্যান্টার', 'planter', 'pot'],
  'pot': ['পাত্র', 'হাঁড়ি', 'টব', 'pot'],
  'mug': ['মগ', 'কাপ', 'mug', 'cup'],
  'cup': ['কাপ', 'মগ', 'cup'],
  'lamp': ['বাতি', 'ল্যাম্প', 'প্রদীপ', 'lamp'],
  'prodeep': ['প্রদীপ', 'বাতি', 'lamp', 'diya'],
  'jute': ['পাট', 'পাটজাত', 'সোনালী আঁশ', 'jute'],
  'pat': ['পাট', 'jute', 'pat'],

  // Beauty & Skincare
  'aloevera': ['অ্যালোভেরা', 'ঘৃতকুমারী', 'aloe', 'aloevera'],
  'aloe': ['অ্যালোভেরা', 'aloe'],
  'serum': ['সিরাম', 'serum'],
  'sunscreen': ['সানস্ক্রিন', 'sunscreen', 'sunblock'],
  'facewash': ['ফেসওয়াশ', 'facewash', 'face wash'],
  'shampoo': ['শ্যাম্পু', 'shampoo'],
  'shaban': ['সাবান', 'soap', 'shaban', 'saban'],
  'soap': ['সাবান', 'soap'],
  'lipstick': ['লিপস্টিক', 'lipstick'],
  'mehendi': ['মেহেদি', 'মেহেন্দী', 'henna', 'mehendi'],
  'henna': ['মেহেদি', 'henna'],

  // Books & Sports
  'boi': ['বই', 'পুস্তক', 'book', 'boi'],
  'book': ['বই', 'book', 'books'],
  'khata': ['খাতা', 'নোটবুক', 'notebook', 'khata'],
  'notebook': ['নোটবুক', 'খাতা', 'notebook', 'journal'],
  'bat': ['ব্যাট', 'bat'],
  'ball': ['বল', 'ball'],
  'racket': ['র‌্যাকেট', 'র‍্যাকেট', 'racket', 'badminton'],
  'badminton': ['ব্যাডমিন্টন', 'badminton', 'racket'],
};

// Bengali to Banglish direct character map for fuzzy phonetic lookup
const BN_TO_LATIN = {
  'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'ee', 'উ': 'u', 'ঊ': 'oo', 'ঋ': 'ri',
  'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'f', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'z', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y', 'ৎ': 't', 'ং': 'ng', 'ঃ': '', 'ঁ': '',
  'া': 'a', 'ি': 'i', 'ী': 'ee', 'ু': 'u', 'ূ': 'oo', 'ৃ': 'ri',
  'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou', '্': '',
};

/**
 * Converts Bengali script text to phonetic Banglish.
 * @param {string} text
 * @returns {string}
 */
export function bengaliToBanglish(text) {
  if (!text) return '';
  let out = '';
  for (const ch of text) {
    out += BN_TO_LATIN[ch] !== undefined ? BN_TO_LATIN[ch] : ch;
  }
  return out.toLowerCase();
}

/**
 * Calculates Levenshtein distance between two strings for typo tolerance.
 */
export function levenshteinDistance(a, b) {
  if (!a || !b) return (a || '').length + (b || '').length;
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Expands a raw user search query into all phonetic and bilingual synonyms.
 * For example: "shari" -> ["shari", "saree", "sari", "শাড়ি"]
 *
 * @param {string} rawQuery
 * @returns {string[]} Array of unique search terms
 */
export function expandSearchTerms(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return [];
  const clean = rawQuery.trim().toLowerCase();
  const terms = new Set([clean]);

  // 1. Check direct dictionary matches
  if (BANGLISH_COMMERCE_DICTIONARY[clean]) {
    for (const item of BANGLISH_COMMERCE_DICTIONARY[clean]) {
      terms.add(item.toLowerCase());
    }
  }

  // 2. Check each word in multi-word query
  const words = clean.split(/\s+/);
  for (const word of words) {
    if (BANGLISH_COMMERCE_DICTIONARY[word]) {
      for (const item of BANGLISH_COMMERCE_DICTIONARY[word]) {
        terms.add(item.toLowerCase());
      }
    }
  }

  // 3. Typo-tolerant dictionary lookup (Levenshtein distance <= 1 for terms > 3 chars)
  for (const [key, synonyms] of Object.entries(BANGLISH_COMMERCE_DICTIONARY)) {
    if (clean.length >= 4 && levenshteinDistance(clean, key) <= 1) {
      terms.add(key);
      for (const s of synonyms) terms.add(s.toLowerCase());
    }
  }

  return Array.from(terms);
}
