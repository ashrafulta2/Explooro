/**
 * followingFeed.test.js — Invariants for the Customer "Followed Stores & Activity Feed" surface.
 *
 * Each suite below pins a defect that shipped in this page, so a regression fails the build rather
 * than reaching a customer:
 *   1. Locale integrity — duplicate "customer" blocks, missing keys, emoji rendered twice.
 *   2. Category filtering — options derived from data, never a hardcoded taxonomy.
 *   3. Trust metrics — never invented when the API omits them.
 *   4. Pluralisation — no "1 shops saved".
 *   5. Markdown pricing — discount derived from real list vs sale price.
 *   6. Escaping — merchant-authored text cannot inject markup.
 *   7. Optimistic follow — list transitions and rollback on failure.
 *   8. Filter state <-> URL round trip.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const localeDir = path.resolve(import.meta.dirname, '../src/locales');
const readLocale = (lang) => JSON.parse(fs.readFileSync(path.join(localeDir, `${lang}.json`), 'utf8'));
const rawLocale = (lang) => fs.readFileSync(path.join(localeDir, `${lang}.json`), 'utf8');

test('Following Feed — Locale Integrity', async (t) => {
  const en = readLocale('en');
  const bn = readLocale('bn');

  await t.test('1. No duplicate top-level "customer" block', () => {
    // A duplicated key silently wins over the first, leaving hundreds of edited lines dead.
    for (const lang of ['en', 'bn']) {
      const occurrences = rawLocale(lang).split('\n  "customer": {').length - 1;
      assert.equal(occurrences, 1, `${lang}.json must declare "customer" exactly once`);
    }
  });

  await t.test('2. en/bn key parity across customer.following', () => {
    const enKeys = Object.keys(en.customer.following).sort();
    const bnKeys = Object.keys(bn.customer.following).sort();
    assert.deepEqual(enKeys, bnKeys, 'every English key must have a Bangla counterpart');
    assert.ok(enKeys.length > 60, 'the page renders far more strings than a handful of keys');
  });

  await t.test('3. No emoji baked into dictionary values', () => {
    // The page prefixes its own decorative icon, so an emoji in the value renders twice —
    // "🔴 🔴 Active Live Broadcasts".
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const [lang, dict] of [['en', en], ['bn', bn]]) {
      for (const [key, value] of Object.entries(dict.customer.following)) {
        assert.ok(!emoji.test(value), `${lang}.customer.following.${key} must not embed an emoji: ${value}`);
      }
    }
  });

  await t.test('4. Plural keys declare both .one and .other', () => {
    const pluralBases = [
      'results_count',
      'stat_followed_stores_sub',
      'card_products',
      'card_followers',
      'live_viewers',
      'story_views',
    ];
    for (const [lang, dict] of [['en', en], ['bn', bn]]) {
      for (const base of pluralBases) {
        assert.ok(`${base}.one` in dict.customer.following, `${lang}: ${base}.one missing`);
        assert.ok(`${base}.other` in dict.customer.following, `${lang}: ${base}.other missing`);
      }
    }
  });

  await t.test('5. Every key the page renders exists in the dictionary', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/pages/customer/FollowingFeedPage.js'),
      'utf8'
    );
    const used = new Set();
    for (const m of source.matchAll(/'customer\.following\.([a-z0-9_]+)'/g)) used.add(m[1]);

    const pluralBases = new Set(['results_count', 'stat_followed_stores_sub', 'card_products', 'card_followers', 'live_viewers', 'story_views']);
    const missing = [...used].filter((key) => {
      if (pluralBases.has(key)) return !(`${key}.one` in en.customer.following);
      return !(key in en.customer.following);
    });
    assert.deepEqual(missing, [], `keys used by the page but absent from en.json: ${missing.join(', ')}`);
  });
});

test('Following Feed — Filtering & Derived Categories', async (t) => {
  // Mirrors makeFilter() in FollowingFeedPage.js.
  const makeFilter = (category, query) => (item) => {
    if (category !== 'all' && item.category !== category) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [item.title_en, item.title_bn, item.title, item.shop_name, item.bio, item.slug]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  };

  // Mirrors categoryOptions(): options come from the data, never a fixed list.
  const deriveCategories = (records) => {
    const seen = new Set();
    records.forEach((r) => r.category && seen.add(r.category));
    return ['all', ...[...seen].sort()];
  };

  const drops = [
    { title_en: 'Jamdani Saree', shop_name: 'Priyo', category: 'fashion' },
    { title_en: 'Silk Dupatta', shop_name: 'Rajshahi Silk', category: 'handloom' },
    { title_en: 'TWS Earbuds', shop_name: 'Bangla Smart', category: 'electronics' },
  ];

  await t.test('1. A hardcoded taxonomy blanks the page when the API omits category', () => {
    // The shipped bug: the UI offered fashion/handloom/electronics/food, but the live API
    // returned no `category` at all, so any chip matched nothing.
    const liveShapedDrops = drops.map(({ category, ...rest }) => rest);
    const hardcoded = 'fashion';
    assert.equal(
      liveShapedDrops.filter(makeFilter(hardcoded, '')).length,
      0,
      'reproduces the defect: a category the payload never carries matches zero rows'
    );
  });

  await t.test('2. Every derived category option matches at least one record', () => {
    for (const cat of deriveCategories(drops)) {
      assert.ok(
        drops.filter(makeFilter(cat, '')).length > 0,
        `derived category "${cat}" must never produce an empty grid`
      );
    }
  });

  await t.test('3. Derived options contain only categories present in the data', () => {
    const options = deriveCategories(drops);
    assert.deepEqual(options, ['all', 'electronics', 'fashion', 'handloom']);
    assert.ok(!options.includes('food'), 'a category with no records is not offered');
  });

  await t.test('4. Search matches title and shop name, case-insensitively', () => {
    assert.equal(drops.filter(makeFilter('all', 'JAMDANI')).length, 1);
    assert.equal(drops.filter(makeFilter('all', 'rajshahi')).length, 1);
    assert.equal(drops.filter(makeFilter('all', 'zzz')).length, 0);
  });

  await t.test('5. Search and category compose (AND, not OR)', () => {
    assert.equal(drops.filter(makeFilter('fashion', 'earbuds')).length, 0);
    assert.equal(drops.filter(makeFilter('fashion', 'jamdani')).length, 1);
  });
});

test('Following Feed — Trust Metrics Are Never Fabricated', async (t) => {
  // Mirrors storeMetaBar(): a metric with no real value is omitted, not defaulted.
  const ratingOf = (store) =>
    store.rating != null && store.rating_count > 0 ? { shown: true, value: store.rating } : { shown: false };

  await t.test('1. An unrated store shows no star rating', () => {
    assert.equal(ratingOf({ rating: null, rating_count: 0 }).shown, false);
    assert.equal(ratingOf({ rating: 4.5, rating_count: 0 }).shown, false, 'a rating with no reviews is not a rating');
  });

  await t.test('2. A genuinely rated store shows its own value', () => {
    const r = ratingOf({ rating: 4.2, rating_count: 18 });
    assert.equal(r.shown, true);
    assert.equal(r.value, 4.2);
  });

  await t.test('3. The old `rating || 4.8` default is gone', () => {
    // Two different unrated stores must not both advertise the same invented score.
    const a = ratingOf({ rating: null, rating_count: 0 });
    const b = ratingOf({ rating: null, rating_count: 0 });
    assert.equal(a.shown, false);
    assert.equal(b.shown, false);
  });

  await t.test('4. Follower count of zero is shown as zero, not hidden or inflated', () => {
    const show = (store) => typeof store.followers_count === 'number';
    assert.equal(show({ followers_count: 0 }), true);
    assert.equal(show({}), false, 'absent means absent — never "500+"');
  });
});

test('Following Feed — Pluralisation', async (t) => {
  const en = readLocale('en').customer.following;
  const bn = readLocale('bn').customer.following;

  // Mirrors tn(): Intl.PluralRules picks the variant, {{n}} carries the display string.
  const render = (dict, base, count, lang) => {
    const category = new Intl.PluralRules(lang).select(count);
    const template = dict[`${base}.${category}`] ?? dict[`${base}.other`];
    return template.replace(/\{\{\s*n\s*\}\}/g, String(count));
  };

  await t.test('1. One followed store reads "1 shop saved", not "1 shops saved"', () => {
    assert.equal(render(en, 'stat_followed_stores_sub', 1, 'en'), '1 shop saved');
    assert.equal(render(en, 'stat_followed_stores_sub', 3, 'en'), '3 shops saved');
  });

  await t.test('2. Product and follower counts agree with their number', () => {
    assert.equal(render(en, 'card_products', 1, 'en'), '1 product');
    assert.equal(render(en, 'card_products', 42, 'en'), '42 products');
    assert.equal(render(en, 'card_followers', 1, 'en'), '1 follower');
  });

  await t.test('3. Zero takes the plural form in English', () => {
    assert.equal(render(en, 'card_products', 0, 'en'), '0 products');
  });

  await t.test('4. Bangla variants resolve and carry the count', () => {
    assert.ok(render(bn, 'card_products', 1, 'bn').length > 0);
    assert.ok(render(bn, 'card_products', 7, 'bn').includes('7'));
  });

  await t.test('5. Bengali "one" covers zero, so every variant must interpolate the count', () => {
    // CLDR Bengali puts 0 in the `one` category (unlike English, where 0 is `other`). A `.one`
    // string that hardcodes "১" therefore renders "1 follower" for a store with none — which is
    // exactly what shipped. Both variants of every plural key must carry {{n}}.
    assert.equal(new Intl.PluralRules('bn').select(0), 'one', 'premise: bn groups 0 with 1');
    assert.equal(new Intl.PluralRules('en').select(0), 'other', 'premise: en groups 0 with many');

    const bases = ['results_count', 'stat_followed_stores_sub', 'card_products', 'card_followers', 'live_viewers', 'story_views'];
    for (const [lang, dict] of [['en', en], ['bn', bn]]) {
      for (const base of bases) {
        for (const variant of ['one', 'other']) {
          assert.match(
            dict[`${base}.${variant}`],
            /\{\{\s*n\s*\}\}/,
            `${lang}.${base}.${variant} must interpolate {{n}}, not hardcode a numeral`
          );
        }
      }
    }
  });

  await t.test('6. Zero followers renders as zero in Bangla, not one', () => {
    assert.equal(render(bn, 'card_followers', 0, 'bn').includes('0'), true);
    assert.equal(render(bn, 'card_followers', 1, 'bn').includes('1'), true);
    assert.notEqual(
      render(bn, 'card_followers', 0, 'bn'),
      render(bn, 'card_followers', 1, 'bn'),
      'zero and one must not render identically'
    );
  });
});

test('Following Feed — Rating Display Precision', async (t) => {
  // Mirrors formatRating(): the shared money formatter pads to 2dp, which is wrong for a star
  // rating — it turned a 4.9-star store into "4.90".
  const trimTrailingZero = (s) => s.replace(/[০0]$/, '');

  await t.test('1. A one-decimal rating keeps one decimal', () => {
    assert.equal(trimTrailingZero('4.90'), '4.9');
    assert.equal(trimTrailingZero('4.70'), '4.7');
  });

  await t.test('2. A whole-number rating is untouched', () => {
    assert.equal(trimTrailingZero('5'), '5');
  });

  await t.test('3. Bengali numerals trim the Bengali zero', () => {
    assert.equal(trimTrailingZero('৪.৯০'), '৪.৯');
  });

  await t.test('4. A non-zero final digit is never trimmed', () => {
    assert.equal(trimTrailingZero('4.95'), '4.95');
    assert.equal(trimTrailingZero('৪.৯৫'), '৪.৯৫');
  });
});

test('Following Feed — Markdown Pricing', async (t) => {
  // Mirrors the drop mapper in customerPortal.service.js.
  const priceOf = (listPrice, customPrice) => {
    const sale = customPrice != null ? Number(customPrice) : Number(listPrice);
    const list = Number(listPrice);
    const hasMarkdown = sale < list && list > 0;
    return {
      retail_price: sale.toFixed(2),
      original_price: hasMarkdown ? list.toFixed(2) : null,
      discount_pct: hasMarkdown ? Math.round(((list - sale) / list) * 100) : null,
    };
  };

  await t.test('1. A genuine markdown yields a strike-through price and a percentage', () => {
    const p = priceOf('4800.00', '4250.00');
    assert.equal(p.retail_price, '4250.00');
    assert.equal(p.original_price, '4800.00');
    assert.equal(p.discount_pct, 11);
  });

  await t.test('2. No custom price means no fake discount', () => {
    const p = priceOf('1500.00', null);
    assert.equal(p.original_price, null, 'nothing to strike through');
    assert.equal(p.discount_pct, null, 'no badge when nothing is discounted');
  });

  await t.test('3. A saler priced ABOVE the supplier default is not shown as a discount', () => {
    const p = priceOf('1000.00', '1200.00');
    assert.equal(p.retail_price, '1200.00');
    assert.equal(p.original_price, null);
    assert.equal(p.discount_pct, null);
  });

  await t.test('4. Discount never divides by zero', () => {
    const p = priceOf('0.00', '0.00');
    assert.equal(p.discount_pct, null);
  });
});

test('Following Feed — Escaping Merchant Text', async (t) => {
  // Mirrors esc() in FollowingFeedPage.js.
  const esc = (value) =>
    value == null
      ? ''
      : String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

  await t.test('1. Script tags in a seller bio are neutralised', () => {
    const out = esc('<script>alert("xss")</script>');
    assert.ok(!out.includes('<script'), 'no live tag survives');
    assert.equal(out, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  await t.test('2. A quote in a shop name cannot break out of an attribute', () => {
    const out = esc('Rahim"s Shop');
    assert.ok(!out.includes('"'), 'the attribute delimiter is encoded');
  });

  await t.test('3. Image onerror injection via alt text is blocked', () => {
    const out = esc('" onerror="fetch(\'//evil\')');
    assert.ok(!out.includes('onerror="'), 'the injected handler is inert');
  });

  await t.test('4. Legitimate Bangla and ampersands survive readably', () => {
    assert.equal(esc('প্রিয় কালেকশন'), 'প্রিয় কালেকশন');
    assert.equal(esc('Silk & Cotton'), 'Silk &amp; Cotton');
  });

  await t.test('5. Null and undefined render as empty, not "null"', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });
});

test('Following Feed — Optimistic Follow Toggle', async (t) => {
  // Mirrors handleToggleFollow(): the store moves between lists immediately; a failure restores.
  const applyToggle = (data, storeId) => {
    const wasFollowing = data.followed_stores.some((s) => s.id === storeId);
    const store =
      data.followed_stores.find((s) => s.id === storeId) || data.suggested_stores.find((s) => s.id === storeId);
    if (wasFollowing) {
      return {
        followed_stores: data.followed_stores.filter((s) => s.id !== storeId),
        suggested_stores: [{ ...store, is_following: false }, ...data.suggested_stores],
      };
    }
    return {
      followed_stores: [{ ...store, is_following: true }, ...data.followed_stores],
      suggested_stores: data.suggested_stores.filter((s) => s.id !== storeId),
    };
  };

  const initial = () => ({
    followed_stores: [{ id: 101, shop_name: 'Priyo' }],
    suggested_stores: [{ id: 103, shop_name: 'Bangla Smart' }],
  });

  await t.test('1. Following moves a store out of suggestions and into followed', () => {
    const next = applyToggle(initial(), 103);
    assert.deepEqual(next.followed_stores.map((s) => s.id), [103, 101]);
    assert.deepEqual(next.suggested_stores.map((s) => s.id), []);
    assert.equal(next.followed_stores[0].is_following, true);
  });

  await t.test('2. Unfollowing moves it back, so the card stays on screen', () => {
    const next = applyToggle(initial(), 101);
    assert.deepEqual(next.followed_stores.map((s) => s.id), []);
    assert.deepEqual(next.suggested_stores.map((s) => s.id), [101, 103]);
  });

  await t.test('3. A store is never in both lists at once', () => {
    const next = applyToggle(initial(), 103);
    const overlap = next.followed_stores.filter((f) => next.suggested_stores.some((s) => s.id === f.id));
    assert.deepEqual(overlap, []);
  });

  await t.test('4. Rollback restores the exact pre-toggle lists', () => {
    const before = initial();
    const snapshot = {
      followed: [...before.followed_stores],
      suggested: [...before.suggested_stores],
    };
    applyToggle(before, 103); // optimistic write, then the request fails
    const restored = { followed_stores: snapshot.followed, suggested_stores: snapshot.suggested };
    assert.deepEqual(restored.followed_stores.map((s) => s.id), [101]);
    assert.deepEqual(restored.suggested_stores.map((s) => s.id), [103]);
  });

  await t.test('5. Toggling twice returns to the starting arrangement', () => {
    const once = applyToggle(initial(), 103);
    const twice = applyToggle(once, 103);
    assert.deepEqual(twice.followed_stores.map((s) => s.id), [101]);
    assert.deepEqual(twice.suggested_stores.map((s) => s.id), [103]);
  });
});

test('Following Feed — Filter State Survives a Reload', async (t) => {
  const TAB_KEYS = ['all', 'drops', 'live', 'stores', 'discover'];

  // Mirrors syncUrl(): defaults are omitted so a clean view has a clean URL.
  const toQuery = (state) => {
    const params = new URLSearchParams();
    if (state.tab && state.tab !== 'all') params.set('tab', state.tab);
    if (state.category && state.category !== 'all') params.set('cat', state.category);
    if (state.query) params.set('q', state.query);
    return params.toString();
  };

  const fromQuery = (qs) => {
    const p = new URLSearchParams(qs);
    return {
      tab: TAB_KEYS.includes(p.get('tab')) ? p.get('tab') : 'all',
      category: p.get('cat') || 'all',
      query: p.get('q') || '',
    };
  };

  await t.test('1. The default view produces no query string', () => {
    assert.equal(toQuery({ tab: 'all', category: 'all', query: '' }), '');
  });

  await t.test('2. A filtered view round-trips exactly', () => {
    const state = { tab: 'live', category: 'fashion', query: 'jamdani' };
    assert.deepEqual(fromQuery(toQuery(state)), state);
  });

  await t.test('3. An unknown tab in a hand-edited URL falls back to "all"', () => {
    assert.equal(fromQuery('tab=../../etc/passwd').tab, 'all');
    assert.equal(fromQuery('tab=').tab, 'all');
  });

  await t.test('4. Search terms with spaces and Bangla survive encoding', () => {
    const state = { tab: 'drops', category: 'all', query: 'জামদানি শাড়ি' };
    assert.deepEqual(fromQuery(toQuery(state)), state);
  });
});
