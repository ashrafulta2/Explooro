/**
 * Unit & Integration assertions for Prompt 1.9:
 * - In-Page Accessibility Auditor rules
 * - Performance Budget threshold checks
 * - QA Checklist completeness
 *
 * Run:  node scripts/verify-a11y-budget.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

let passed = 0;
function check(label, actual, expected) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed += 1;
  console.log(`  ok  ${label} → ${actual}`);
}

console.log('## 1. QA Checklist Verification');
const qaChecklistPath = path.resolve('docs/qa-checklist.md');
assert.ok(fs.existsSync(qaChecklistPath), 'docs/qa-checklist.md must exist');
const qaContent = fs.readFileSync(qaChecklistPath, 'utf8');

const requiredSections = [
  'Lighthouse Targets',
  'Keyboard Reachability',
  'Visible Custom Focus Ring',
  'Contrast AA Compliance',
  '44px Minimum Touch Targets',
  'ARIA Labelling & Semantics',
  'Reduced Motion Respect',
  'Designed Empty States',
  'Designed Loading States',
  'Designed Error States',
  'Dual-Language i18n',
  'Mobile 360px Responsiveness',
  'Performance Budget',
];

for (const section of requiredSections) {
  assert.ok(qaContent.includes(section), `docs/qa-checklist.md must contain section "${section}"`);
  console.log(`  ok  Found section: ${section}`);
  passed += 1;
}

console.log('\n## 2. Performance Budget & Production Assets Verification');
const distDir = path.resolve('client/dist');
assert.ok(fs.existsSync(distDir), 'client/dist must exist (run npm run build first)');

const assetsDir = path.join(distDir, 'assets');
const assetFiles = fs.readdirSync(assetsDir);

const jsEntry = assetFiles.find((f) => f.startsWith('index-') && f.endsWith('.js'));
const cssEntry = assetFiles.find((f) => f.startsWith('index-') && f.endsWith('.css'));

assert.ok(jsEntry, 'index-*.js entry chunk must exist in client/dist/assets');
assert.ok(cssEntry, 'index-*.css entry asset must exist in client/dist/assets');

const jsContent = fs.readFileSync(path.join(assetsDir, jsEntry));
const cssContent = fs.readFileSync(path.join(assetsDir, cssEntry));

const jsGzipSize = zlib.gzipSync(jsContent).length;
const cssGzipSize = zlib.gzipSync(cssContent).length;

// WHY these are read out of vite.config.js instead of written here: this script used to carry its
// own literals (150KB / 50KB) while the build enforced 150KB / 65KB. A second copy of a number
// that moves is a number that goes stale — this script was asserting a CSS budget the build had
// already left behind, so it would have failed a bundle the build called fine.
const viteConfigSrc = fs.readFileSync(path.resolve('client/vite.config.js'), 'utf8');

function budgetFromConfig(constName) {
  const match = viteConfigSrc.match(new RegExp(`const ${constName} = (\\d+) \\* 1024`));
  assert.ok(match, `${constName} not found in client/vite.config.js`);
  return Number(match[1]) * 1024;
}

const JS_BUDGET_GZIP = budgetFromConfig('JS_BUDGET_GZIP_BYTES');
const CSS_BUDGET_GZIP = budgetFromConfig('CSS_BUDGET_GZIP_BYTES');
const jsBudgetKb = JS_BUDGET_GZIP / 1024;
const cssBudgetKb = CSS_BUDGET_GZIP / 1024;

console.log(`  Entry JS: ${(jsGzipSize / 1024).toFixed(2)} KB gzipped (Budget: ${jsBudgetKb} KB)`);
console.log(`  Entry CSS: ${(cssGzipSize / 1024).toFixed(2)} KB gzipped (Budget: ${cssBudgetKb} KB)`);

check(`Entry JS is within ${jsBudgetKb}KB gzip budget`, jsGzipSize <= JS_BUDGET_GZIP, true);
check(`Entry CSS is within ${cssBudgetKb}KB gzip budget`, cssGzipSize <= CSS_BUDGET_GZIP, true);

console.log('\n## 3. Dead Code Elimination Verification');
// Verify a11y auditor code does NOT leak into production bundle
for (const file of assetFiles) {
  if (file.startsWith('a11y-audit-') || file.startsWith('CraftAuditPage-')) continue;
  const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  assert.ok(
    !content.includes('a11y-badge-root') && !content.includes('runA11yAudit'),
    `File ${file} should not contain dev-only a11y auditor code`
  );
}
console.log('  ok  Production bundle contains zero dev-only a11y auditor code');
passed += 1;

console.log(`\n========================================`);
console.log(`🎉 All ${passed} verification checks passed successfully!`);
console.log(`========================================`);
