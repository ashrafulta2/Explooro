/**
 * plainLanguage.test.js — customers, Explooro partners and suppliers never read internal vocabulary
 * (Prompt 13.6, docs/glossary.md).
 *
 * Which strings count as theirs is decided by the files that read them, not by locale namespace,
 * because several namespaces (payout, kyc, returns, dispute) are shared with staff screens. A string
 * is checked when a customer / Explooro partner / supplier source file reads its key literally, reads a
 * key under a `${...}` prefix, labels one of their sidebar items, or is one of their journey strings.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { navItemsForRole, navGroups } from '../src/config/navigation.ts';
import { DEAD_ENDS } from '../src/config/journeys.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(repo, 'client', 'src');
const en = JSON.parse(readFileSync(join(src, 'locales/en.json'), 'utf8'));
const bn = JSON.parse(readFileSync(join(src, 'locales/bn.json'), 'utf8'));
const glossary = readFileSync(join(repo, 'docs', 'glossary.md'), 'utf8');
const resolve = (dict, key) => key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);

/** The ✗ rows of docs/glossary.md, as the words users must never read. Vault is kept on purpose. */
export const BANNED_EN = [
  /escrow/i,
  /\bfefo\b/i,
  /maker[- ]checker/i,
  /risk tier/i,
  /sub[- ]?order/i,
  /clearing wallet/i,
  /idempoten/i,
  /\bledger\b/i,
  /double[- ]entry/i,
  /\bjit\b/i,
  /\bsku/i,
  /consignment/i,
  /\bkyc\b/i,
  /payout/i,
  /\b3pl\b/i,
  /\bt\+\d/i,
  /\bsla\b/i,
];
export const BANNED_BN = [/এসক্রো|এস্ক্রো/, /লেজার/, /এফইএফও|ফিফো|FEFO/, /সাব-?অর্ডার/, /কেওয়াইসি|KYC/, /পে-?আউট/, /SKU|এসকেইউ/, /কনসাইনমেন্ট/, /৩পিএল|3PL/, /এসএলএ/, /ডাবল-এন্ট্রি/, /[Ee]scrow|[Pp]ayout/];

const USER_ROLES = ['customer', 'saler', 'supplier'];
const STAFF_DIRS = ['pages/admin', 'pages/moderator', 'pages/editor', 'pages/dev', 'components/admin', 'components/moderator', 'components/editor', 'mocks', 'locales'];
// The supplier's add-product form lives in the admin catalog page.
const ALSO = ['pages/admin/CatalogProductsPage.ts'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function flatKeys(node, prefix) {
  if (typeof node === 'string') return [prefix];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([k, v]) => flatKeys(v, `${prefix}.${k}`));
}

function userFacingKeys() {
  const keys = new Map();
  const add = (key, from) => {
    if (!keys.has(key)) keys.set(key, from);
  };
  const files = walk(src).filter((path) => {
    const rel = relative(src, path).replace(/\\/g, '/');
    // main.ts holds route titles for every portal; a page's own heading is what users read.
    return rel !== 'main.ts' && (ALSO.includes(rel) || !STAFF_DIRS.some((d) => rel.startsWith(`${d}/`)));
  });
  for (const file of files) {
    const rel = relative(src, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([a-z0-9_]+\.[a-zA-Z0-9_.]+)'/g)) add(m[1], rel);
    // `t(\`ns.status_${x}\`)`: every key under the literal prefix may be read.
    for (const m of text.matchAll(/\bt\(\s*`([a-z0-9_]+\.[a-zA-Z0-9_.]*)\$\{/g)) {
      const prefix = m[1];
      const parent = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix.slice(0, prefix.lastIndexOf('.'));
      const leaf = prefix.endsWith('.') ? '' : prefix.slice(prefix.lastIndexOf('.') + 1);
      for (const key of flatKeys(resolve(en, parent), parent)) {
        if (key.slice(parent.length + 1).startsWith(leaf)) add(key, `${rel} (dynamic)`);
      }
    }
  }
  for (const role of USER_ROLES) {
    for (const item of navItemsForRole(role)) add(item.label_i18n_key, `nav:${role}`);
  }
  for (const group of navGroups) {
    if ([group.role, ...(group.roles || [])].some((r) => USER_ROLES.includes(r))) add(group.label_i18n_key, 'nav group');
  }
  for (const ns of [...USER_ROLES.map((r) => `journey.${r}`), 'journey.block', 'journey.card', 'journey.checklist', 'journey.settings']) {
    for (const key of flatKeys(resolve(en, ns), ns)) add(key, 'journey');
  }
  for (const d of DEAD_ENDS.filter((x) => USER_ROLES.includes(x.role))) {
    for (const key of [d.hint_key, d.title_key, d.follow_up_key]) add(key, 'journey result');
  }
  return keys;
}

/** Banned terms in prose written straight into source files (not through a translation key). */
function proseHits(files) {
  const banned = (p) => BANNED_EN.some((re) => re.test(p)) || BANNED_BN.some((re) => re.test(p));
  const found = [];
  for (const file of files) {
    const rel = relative(src, file).replace(/\\/g, '/');
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/class="[^"]*"/g, '');
      if (/^\s*(\/\/|\*|\/\*|import )/.test(line)) return;
      const pieces = [...line.matchAll(/>([^<>]+)</g), ...line.matchAll(/'([^'\n]+)'|"([^"\n]+)"/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ''));
      // A template line holding nothing but text (its tags on the lines around it).
      if (/^[^<>=(){};'"`]+$/.test(line.trim()) && !/^\w+:\s/.test(line.trim())) pieces.push(line.trim());
      // WHY only text with a space that is not all identifiers: one-word values, class lists and
      // CSV column names are data (ESCROW:CUSTOMER_HOLD, 'JIT', escrow-page, sub_order_ref).
      const prose = (p) => /\s/.test(p.trim()) && !/`|\bt\(/.test(p) && !p.trim().split(/[\s,]+/).filter(Boolean).every((w) => /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(w));
      // A URL path such as /saler/b2b-escrow is an address, not a word.
      const hit = pieces.map((p) => p.replace(/(^|\s)\/[\w/-]+/g, '$1')).find((p) => prose(p) && banned(p));
      if (hit) found.push(`${rel}:${i + 1}: ${hit.trim().slice(0, 80)}`);
    });
  }
  return found;
}

describe('plain language', () => {
  const keys = userFacingKeys();

  it('finds a large set of customer, Explooro partner and supplier strings to check', () => {
    assert.ok(keys.size > 2000, `only ${keys.size} keys found; the scan may have broken`);
  });

  it('no banned internal term in any string those users read, in English or Bangla', () => {
    const found = [];
    // WHY strip {{...}}: a placeholder's name (`{{sla}}`) is code, never shown; its value is.
    const shown = (s) => (typeof s === 'string' ? s.replace(/\{\{\w+\}\}/g, '') : s);
    for (const [key, from] of keys) {
      const e = shown(resolve(en, key));
      const b = shown(resolve(bn, key));
      const enHit = typeof e === 'string' && BANNED_EN.find((re) => re.test(e));
      const bnHit = typeof b === 'string' && BANNED_BN.find((re) => re.test(b));
      if (enHit || bnHit) found.push(`${key} (${from}): ${enHit ? `en ${enHit}` : ''} ${bnHit ? `bn ${bnHit}` : ''}`.trim());
    }
    assert.deepEqual(found, []);
  });

  it('no banned term in prose written straight into a customer, partner or supplier page', () => {
    const files = walk(src).filter((path) => {
      const rel = relative(src, path).replace(/\\/g, '/');
      // config/journeys.ts holds developer notes mirrored in docs/journeys.md; users read its i18n keys.
      return rel !== 'main.ts' && rel !== 'config/journeys.ts' && (ALSO.includes(rel) || !STAFF_DIRS.some((d) => rel.startsWith(`${d}/`)));
    });
    assert.deepEqual(proseHits(files), []);
  });

  it('every one of those strings exists in both locales', () => {
    const missing = [];
    for (const key of keys.keys()) {
      const e = resolve(en, key);
      const b = resolve(bn, key);
      if (typeof e === 'string' && typeof b !== 'string') missing.push(`bn: ${key}`);
      if (typeof b === 'string' && typeof e !== 'string') missing.push(`en: ${key}`);
    }
    assert.deepEqual(missing, []);
  });

  // REQUIREMENTS 3 and 4 for the four flows the acceptance reads through: every field has a
  // one-line helper, and an error says what to do instead of passing on the raw failure.
  const FLOWS = {
    checkout: 'components/checkout/AddressForm.ts',
    kyc: 'pages/seller/KycSubmissionPage.ts',
    withdrawal_partner: 'pages/saler/WithdrawalsPage.ts',
    withdrawal_supplier: 'components/vault/PayoutRequestModal.ts',
  };

  it('every field in checkout, KYC and both withdrawal forms has a helper line', () => {
    for (const [flow, file] of Object.entries(FLOWS)) {
      const text = readFileSync(join(src, file), 'utf8');
      const fields = (text.match(/<(input|textarea|select)\b/g) || []).length;
      const hints = (text.match(/class="field__hint"|amount_min_hint/g) || []).length;
      assert.ok(fields > 0, `${flow}: no fields found`);
      assert.ok(hints >= fields, `${flow}: ${fields} fields but ${hints} helpers`);
    }
  });

  it('the add-product form has a helper under each of its eight fields', () => {
    const text = readFileSync(join(src, 'pages/admin/CatalogProductsPage.ts'), 'utf8');
    for (const f of ['title_en', 'title_bn', 'category', 'brand', 'supplier_price', 'stock', 'description_en', 'description_bn']) {
      assert.ok(text.includes(`admin_catalog.plain.${f}_help`), f);
    }
  });

  it('errors in the four flows say what to do, never just the raw failure or hard-coded English', () => {
    for (const [flow, file] of Object.entries({ ...FLOWS, product: 'pages/admin/CatalogProductsPage.ts' })) {
      const text = readFileSync(join(src, file), 'utf8');
      assert.doesNotMatch(text, /toast\.error\(err\.message \|\|/, `${flow} shows a raw error`);
      assert.doesNotMatch(text, /toast\.(error|success|warning)\('[A-Z]/, `${flow} has a hard-coded English toast`);
    }
  });

  it('no customer, Explooro partner or supplier page title (the browser tab) uses a banned term', () => {
    const main = readFileSync(join(src, 'main.ts'), 'utf8');
    const bad = [...main.matchAll(/\{\s*path:\s*'([^']+)',\s*title:\s*'([^']+)'/gs)]
      .filter(([, path]) => !/^\/(admin|moderator|editor|dev)\b/.test(path))
      .filter(([, , title]) => BANNED_EN.some((re) => re.test(title)))
      .map(([, path, title]) => `${path}: ${title}`);
    assert.deepEqual(bad, []);
  });

  it('the partner withdrawal page never shows a demo balance or demo account', () => {
    const text = readFileSync(join(src, FLOWS.withdrawal_partner), 'utf8');
    assert.doesNotMatch(text, /\|\| 24500|\|\| 17000|value="01711223344"|value="Tanvir Ahmed"/);
  });

  it('the glossary documents every banned term, and keeps Vault on purpose', () => {
    for (const term of ['Escrow', 'Payout', 'Ledger', 'Sub-order', 'SKU', 'FEFO', 'Consignment', '3PL', 'KYC', 'SLA', 'Maker-checker', 'Risk tier', 'Clearing wallet', 'Idempotency', 'JIT']) {
      assert.ok(glossary.includes(`| ${term}`), `glossary lacks ${term}`);
    }
    assert.match(glossary, /\| Vault \| kept \|/);
  });
});

// REQUIREMENT 2, admin second: staff screens use the same plain words. A technical term may stay
// only as data (an account code, a CSV column, a header name), never in prose a person reads.
describe('plain language on staff screens', () => {
  const STAFF_ROLES = ['super_admin', 'admin', 'moderator', 'editor'];
  // The dev gallery is a developer tool, not a staff screen.
  const STAFF_ONLY = ['pages/admin', 'pages/moderator', 'pages/editor', 'components/admin', 'components/moderator', 'components/editor'];
  const staffFiles = walk(src).filter((path) => STAFF_ONLY.some((d) => relative(src, path).replace(/\\/g, '/').startsWith(`${d}/`)));
  const shown = (s) => (typeof s === 'string' ? s.replace(/\{\{\w+\}\}/g, '') : s);
  const banned = (e, b) => (typeof e === 'string' && BANNED_EN.find((re) => re.test(e))) || (typeof b === 'string' && BANNED_BN.find((re) => re.test(b)));

  function staffKeys() {
    const keys = new Map();
    for (const file of staffFiles) {
      const rel = relative(src, file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-z0-9_]+\.[a-zA-Z0-9_.]+)'/g)) if (!keys.has(m[1])) keys.set(m[1], rel);
      for (const m of text.matchAll(/\bt\(\s*`([a-z0-9_]+\.[a-zA-Z0-9_.]*)\$\{/g)) {
        const prefix = m[1];
        const parent = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix.slice(0, prefix.lastIndexOf('.'));
        const leaf = prefix.endsWith('.') ? '' : prefix.slice(prefix.lastIndexOf('.') + 1);
        for (const key of flatKeys(resolve(en, parent), parent)) {
          if (key.slice(parent.length + 1).startsWith(leaf) && !keys.has(key)) keys.set(key, `${rel} (dynamic)`);
        }
      }
    }
    for (const role of STAFF_ROLES) for (const item of navItemsForRole(role)) if (!keys.has(item.label_i18n_key)) keys.set(item.label_i18n_key, `nav:${role}`);
    return keys;
  }

  it('no banned term in any translated string a staff screen reads', () => {
    const keys = staffKeys();
    assert.ok(keys.size > 2000, `only ${keys.size} staff keys found; the scan may have broken`);
    const found = [...keys].filter(([key]) => banned(shown(resolve(en, key)), shown(resolve(bn, key)))).map(([key, from]) => `${key} (${from})`);
    assert.deepEqual(found, []);
  });

  it('no banned term in prose written straight into a staff page', () => {
    assert.deepEqual(proseHits(staffFiles), []);
  });

  it('no staff page title (the browser tab) uses a banned term', () => {
    const main = readFileSync(join(src, 'main.ts'), 'utf8');
    const bad = [...main.matchAll(/\{\s*path:\s*'([^']+)',\s*title:\s*'([^']+)'/gs)]
      .filter(([, path]) => /^\/(admin|moderator|editor)\b/.test(path))
      .filter(([, , title]) => BANNED_EN.some((re) => re.test(title)))
      .map(([, path, title]) => `${path}: ${title}`);
    assert.deepEqual(bad, []);
  });

  it('the approval inbox and identity checks never fill an empty queue with made-up rows', () => {
    for (const file of ['pages/admin/ApprovalInboxPage.ts', 'pages/admin/VerificationCenterPage.ts']) {
      assert.doesNotMatch(readFileSync(join(src, file), 'utf8'), /defaultSample/, file);
    }
  });
});
