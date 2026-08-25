/**
 * prerender.js — Headless Build-Time Prerender Generator (Prompt 11.5).
 *
 * Runs after `vite build` to generate static pre-rendered HTML files for all
 * public indexable routes. Injects SEO head metadata, OpenGraph, JSON-LD, and
 * semantic readable DOM content into `client/dist/[route]/index.html`.
 *
 * Result: `curl` / non-JS crawlers receive complete readable HTML and 100 SEO score,
 * while browsers seamlessly hydrate into the client SPA.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prerenderConfig } from '../client/prerender.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'client', 'dist');

async function runPrerender() {
  console.log('\n🚀 ── Explooro Static Prerender Pipeline (Prompt 11.5) ──');

  const baseHtmlPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(baseHtmlPath)) {
    console.error(`❌ Base template not found at ${baseHtmlPath}. Please run "npm run build --workspace client" first.`);
    process.exit(1);
  }

  const baseHtml = fs.readFileSync(baseHtmlPath, 'utf8');
  const results = [];

  for (const route of prerenderConfig.routes) {
    const routePath = route.path === '/' ? '' : route.path.replace(/^\//, '');
    const targetDir = path.join(DIST_DIR, routePath);
    const targetFile = path.join(targetDir, 'index.html');

    // 1. Build Head Metadata Injections
    const canonicalUrl = `${prerenderConfig.baseUrl}${route.path}`;
    const headInjections = `
    <title>${escapeHtml(route.title)}</title>
    <meta name="description" content="${escapeHtml(route.description)}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="alternate" hreflang="en" href="${canonicalUrl}" />
    <link rel="alternate" hreflang="bn" href="${prerenderConfig.baseUrl}/bn${route.path === '/' ? '' : route.path}" />
    <link rel="alternate" hreflang="x-default" href="${canonicalUrl}" />
    <meta property="og:title" content="${escapeHtml(route.title)}" />
    <meta property="og:description" content="${escapeHtml(route.description)}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:type" content="${route.ogType || 'website'}" />
    <meta property="og:site_name" content="Explooro" />
    <meta property="og:locale" content="en_BD" />
    <meta property="og:image" content="${prerenderConfig.baseUrl}/og-banner.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(route.title)}" />
    <meta name="twitter:description" content="${escapeHtml(route.description)}" />
    <meta name="twitter:image" content="${prerenderConfig.baseUrl}/og-banner.png" />
    ${route.jsonLd ? `<script type="application/ld+json" id="seo-structured-data">\n${JSON.stringify(route.jsonLd, null, 2)}\n</script>` : ''}
    `;

    // 2. Build Fallback DOM Content
    const bodyContent = `
      <main class="prerender-fallback max-w-5xl mx-auto p-6 space-y-6" style="min-height: 80vh;">
        <header class="space-y-2 border-b border-gray-200 pb-4">
          <h1 class="text-3xl font-extrabold text-gray-900 tracking-tight">${escapeHtml(route.heading || route.title)}</h1>
          ${route.price ? `<p class="text-2xl font-bold text-emerald-600">${escapeHtml(route.price)}</p>` : ''}
          ${route.brand ? `<p class="text-sm text-gray-500 font-semibold">Brand / Supplier: ${escapeHtml(route.brand)} ${route.sku ? `(SKU: ${escapeHtml(route.sku)})` : ''}</p>` : ''}
          ${route.salerName ? `<p class="text-sm text-gray-500 font-semibold">Store Merchant: ${escapeHtml(route.salerName)}</p>` : ''}
        </header>

        <section class="prose prose-lg text-gray-700 leading-relaxed">
          <p>${escapeHtml(route.bodyText || route.description)}</p>
        </section>

        <footer class="pt-6 text-xs text-gray-400 border-t border-gray-100">
          <p>© 2026 Explooro Social Commerce Platform · Verified Bangladeshi Marketplace · Cash on Delivery & bKash Supported</p>
        </footer>
      </main>
    `;

    // 3. Inject Head & Body into Base HTML
    let renderedHtml = baseHtml;

    // Replace Title & Meta in Head
    if (renderedHtml.includes('<title>')) {
      renderedHtml = renderedHtml.replace(/<title>.*?<\/title>/s, '');
    }
    renderedHtml = renderedHtml.replace(/<meta name="description".*?>/s, '');
    renderedHtml = renderedHtml.replace('</head>', `${headInjections}\n  </head>`);

    // Inject into router-outlet
    renderedHtml = renderedHtml.replace(
      '<div id="router-outlet"></div>',
      `<div id="router-outlet">${bodyContent}</div>`
    );

    // 4. Save to target location
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetFile, renderedHtml, 'utf8');

    results.push({
      route: route.path,
      file: path.relative(DIST_DIR, targetFile),
      title: route.title.slice(0, 40) + '...',
      sizeKb: (Buffer.byteLength(renderedHtml, 'utf8') / 1024).toFixed(2),
    });
  }

  console.table(results);
  console.log(`✅ Successfully pre-rendered ${results.length} public static routes into client/dist/!\n`);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

runPrerender();
