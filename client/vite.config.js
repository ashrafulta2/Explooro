import { defineConfig } from 'vite';
import zlib from 'node:zlib';

/**
 * Performance Budget Plugin (Prompt 1.9).
 *
 * Hard build-failing quality gate:
 * - Initial/entry JS chunk <= 150 KB gzipped (PRD target)
 * - Initial/entry CSS chunk <= 40 KB gzipped
 */
function performanceBudgetPlugin() {
  const JS_BUDGET_GZIP_BYTES = 150 * 1024; // 150 KB = 153,600 bytes
  const CSS_BUDGET_GZIP_BYTES = 40 * 1024;  // 40 KB = 40,960 bytes

  return {
    name: 'explooro-performance-budget',
    apply: 'build',
    generateBundle(options, bundle) {
      const budgetResults = [];
      let hasViolations = false;

      for (const [fileName, file] of Object.entries(bundle)) {
        const isEntryJs = file.type === 'chunk' && file.isEntry;
        const isEntryCss = file.type === 'asset' && fileName.endsWith('.css') && fileName.startsWith('assets/index');

        if (!isEntryJs && !isEntryCss) continue;

        const content = file.type === 'chunk' ? file.code : file.source;
        const rawBytes = Buffer.byteLength(content, 'utf8');
        const gzipBytes = zlib.gzipSync(content).length;
        const budgetBytes = isEntryJs ? JS_BUDGET_GZIP_BYTES : CSS_BUDGET_GZIP_BYTES;
        const typeLabel = isEntryJs ? 'Initial JS' : 'Initial CSS';
        const passed = gzipBytes <= budgetBytes;

        if (!passed) {
          hasViolations = true;
        }

        budgetResults.push({
          type: typeLabel,
          file: fileName,
          rawKb: (rawBytes / 1024).toFixed(2),
          gzipKb: (gzipBytes / 1024).toFixed(2),
          budgetKb: (budgetBytes / 1024).toFixed(2),
          status: passed ? 'PASS' : 'FAIL',
        });
      }

      console.log('\n📊 ── Explooro Performance Budget Gate (Prompt 1.9) ──');
      console.table(budgetResults);

      if (hasViolations) {
        this.error(
          new Error(
            `❌ Performance Budget Exceeded! Build aborted. Initial JS must be <= 150KB gzip, CSS <= 40KB gzip.`
          )
        );
      } else {
        console.log('✅ All entry chunks are within the performance budget.\n');
      }
    },
  };
}

// WHY envDir points at the repo root: the monorepo keeps ONE .env at the root so the client and
// server can never drift out of sync. Vite still only exposes variables prefixed with VITE_.
export default defineConfig({
  envDir: '..',
  envPrefix: 'VITE_',
  plugins: [performanceBudgetPlugin()],

  server: {
    port: 3000,
    strictPort: true, // fail loudly rather than silently moving to 3001
    open: true,
    proxy: {
      // WHY proxy instead of CORS: in development the browser sees a single origin
      // (localhost:3000), so there is no preflight, no cookie SameSite friction, and the
      // production path shape (/api/v1/...) is identical to what nginx serves later.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
      },
      // WHY rewritten and not proxied 1:1 like /api: media URLs (driver.getPublicUrl()) are
      // deliberately version-agnostic — /storage/<key>, not /api/v1/storage/<key> — so a future CDN
      // or nginx rule can own that path without every stored URL baking in the API version. The
      // route itself lives under the /api/v1 prefix server-side (server/src/app.js), so dev has to
      // rewrite here instead of proxying the literal path.
      '/storage': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => `/api/v1${path}`,
      },
    },
  },

  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 150,
  },
});
