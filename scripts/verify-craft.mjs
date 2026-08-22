/**
 * Unit & Integration assertions for Prompt 1.10:
 * - Craft Layer styles
 * - Motion & Optical helpers
 * - Design Review Log & Squint Test documentation
 *
 * Run:  node scripts/verify-craft.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { opticalCircleCompensation, isSingleWord } from '../client/src/lib/optical.js';

let passed = 0;
function check(label, actual, expected) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed += 1;
  console.log(`  ok  ${label} → ${actual}`);
}

console.log('## 1. Optical Helpers Verification');
check('opticalCircleCompensation(100) (+4% compensation)', opticalCircleCompensation(100), 104);
check('opticalCircleCompensation(48)', opticalCircleCompensation(48), 50);
check('isSingleWord("Save")', isSingleWord('Save'), true);
check('isSingleWord("Place Order")', isSingleWord('Place Order'), false);
check('isSingleWord("")', isSingleWord(''), false);

console.log('\n## 2. Craft CSS Verification');
const craftCssPath = path.resolve('client/src/styles/craft.css');
assert.ok(fs.existsSync(craftCssPath), 'client/src/styles/craft.css must exist');
const craftCss = fs.readFileSync(craftCssPath, 'utf8');

const requiredCraftTokens = [
  '::selection',
  'scrollbar-width: thin',
  ':focus-visible',
  'caret-color: var(--brand)',
  'text-wrap: balance',
  'text-wrap: pretty',
  'tabular-nums',
  '.btn--single-word',
  '.nested-surface',
  '@media print',
];

for (const token of requiredCraftTokens) {
  assert.ok(craftCss.includes(token), `craft.css must contain "${token}"`);
  console.log(`  ok  Found in craft.css: ${token}`);
  passed += 1;
}

console.log('\n## 3. Motion Utility Verification');
const motionJsPath = path.resolve('client/src/lib/motion.js');
assert.ok(fs.existsSync(motionJsPath), 'client/src/lib/motion.js must exist');
const motionJs = fs.readFileSync(motionJsPath, 'utf8');

const requiredMotionExports = [
  'prefersReducedMotion',
  'press',
  'stagger',
  'originTransition',
  'countUp',
];

for (const fn of requiredMotionExports) {
  assert.ok(motionJs.includes(`function ${fn}`) || motionJs.includes(`export function ${fn}`), `motion.js must export "${fn}"`);
  console.log(`  ok  Found export in motion.js: ${fn}`);
  passed += 1;
}

console.log('\n## 4. Design Review Log Verification');
const reviewLogPath = path.resolve('docs/design-review-log.md');
assert.ok(fs.existsSync(reviewLogPath), 'docs/design-review-log.md must exist');
const reviewLog = fs.readFileSync(reviewLogPath, 'utf8');

const requiredReviewSections = [
  'The Squint Test Protocol',
  'Marketplace Home',
  'Product Detail',
  'Checkout Surface',
  'Stripe Dashboard',
  'Linear',
  'Vercel',
  'Shopify Polaris',
  'Amazon',
  'Apple Store',
  'bKash / Pathao',
];

for (const section of requiredReviewSections) {
  assert.ok(reviewLog.includes(section), `docs/design-review-log.md must contain section "${section}"`);
  console.log(`  ok  Found in design-review-log: ${section}`);
  passed += 1;
}

console.log(`\n========================================`);
console.log(`🎉 All ${passed} verification checks passed successfully!`);
console.log(`========================================`);
