/**
 * sitemap.routes.js — Fastify routes for Dynamic Sitemaps, Robots.txt & Crawler Prerendering (Prompt 11.5).
 */

import * as controller from '../controllers/sitemap.controller.js';

export default async function sitemapRoutes(fastify) {
  // 1. Sitemap Index
  fastify.get('/sitemap.xml', controller.getSitemapIndex);

  // 2. Child XML Sitemaps
  fastify.get('/sitemaps/products.xml', controller.getProductsSitemap);
  fastify.get('/sitemaps/stores.xml', controller.getStoresSitemap);
  fastify.get('/sitemaps/categories.xml', controller.getCategoriesSitemap);
  fastify.get('/sitemaps/stories.xml', controller.getStoriesSitemap);
  fastify.get('/sitemaps/static.xml', controller.getStaticSitemap);

  // 3. Robots.txt
  fastify.get('/robots.txt', controller.getRobotsTxt);

  // 4. Crawler Prerender Interception for public product and storefront URLs
  fastify.get('/prerender/*', controller.crawlerPrerenderHandler);
}
