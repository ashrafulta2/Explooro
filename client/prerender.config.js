/**
 * prerender.config.js — Build-Time Prerendering Configuration & Route Manifest (Prompt 11.5).
 */

export const prerenderConfig = {
  baseUrl: 'https://explooro.com',
  outDir: 'client/dist',

  /**
   * Static public routes pre-rendered at build time.
   */
  routes: [
    {
      path: '/',
      title: 'Explooro — Bangladesh\'s #1 Social Commerce Platform',
      description: 'Buy from verified suppliers with zero-markup wholesale sourcing. Sell from your own branded store with zero upfront capital.',
      heading: 'Bangladesh\'s Premier Social Commerce & Dropshipping Platform',
      bodyText: 'Explooro empowers suppliers, resellers, and consumers with wholesale catalog sourcing, AI store builder, 1-click bKash payouts, and digital escrow protection.',
      ogType: 'website',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Explooro',
        url: 'https://explooro.com',
      },
    },
    {
      path: '/categories',
      title: 'Product Categories — Explooro Wholesale & Retail',
      description: 'Browse authentic Bangladesh handlooms, organic honey, electronics, beauty, and home crafts directly from verified manufacturers.',
      heading: 'All Wholesale & Retail Categories',
      bodyText: 'Discover thousands of verified products across Traditional Handloom, Electronics, Pure Foods, Beauty, and Handcrafted Brass.',
      ogType: 'website',
    },
    {
      path: '/stories',
      title: 'Seller Stories & Community Feed — Explooro',
      description: 'Read authentic stories, merchant craft breakdowns, and product video reels from top social sellers in Bangladesh.',
      heading: 'Explooro Merchant Stories & UGC Feed',
      bodyText: 'Watch master weavers, organic beekeepers, and digital artisans showcase authentic Bangladeshi goods.',
      ogType: 'blog',
    },
    {
      path: '/products/jamdani-saree',
      title: 'Authentic Handwoven Jamdani Saree (Dhakai) — Explooro',
      description: '100% Cotton Handwoven Dhakai Jamdani Saree crafted by traditional weavers in Narayanganj. Direct manufacturer wholesale price ৳3,400.',
      heading: 'Authentic Handwoven Jamdani Saree (Dhakai)',
      price: '৳3,400.00',
      brand: 'Narayanganj Weavers Guild',
      sku: 'SKU-JAM-001',
      bodyText: 'Traditional floral jaal motifs woven on handlooms with 84-count combed cotton yarn. Includes 1-year authentic weave warranty and direct door delivery across Bangladesh.',
      ogType: 'product',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Authentic Handwoven Jamdani Saree (Dhakai)',
        sku: 'SKU-JAM-001',
        description: '100% Cotton Handwoven Dhakai Jamdani Saree with intricate floral jaal motifs.',
        brand: { '@type': 'Brand', name: 'Narayanganj Weavers Guild' },
        offers: {
          '@type': 'Offer',
          price: '3400.00',
          priceCurrency: 'BDT',
          availability: 'https://schema.org/InStock',
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.9',
          reviewCount: '28',
        },
      },
    },
    {
      path: '/products/silk-tangail-saree',
      title: 'Pure Tangail Silk Saree — Explooro',
      description: 'Exquisite Pure Tangail Silk Saree with zari border. Direct wholesale price ৳2,850.',
      heading: 'Pure Tangail Silk Saree with Zari Border',
      price: '৳2,850.00',
      brand: 'Tangail Handloom Heritage',
      sku: 'SKU-TANG-002',
      bodyText: 'Handcrafted by Tangail master artisans. Features soft Mulberry silk and delicate metallic zari pallu work.',
      ogType: 'product',
    },
    {
      path: '/products/brass-tea-set',
      title: 'Handmade Antique Brass Tea Set — Explooro',
      description: 'Artisanal solid brass 6-cup tea serving set crafted in Dhamrai. Wholesale price ৳1,800.',
      heading: 'Artisanal Solid Brass 6-Cup Tea Set',
      price: '৳1,800.00',
      brand: 'Dhamrai Metalcraft',
      sku: 'SKU-BRS-003',
      bodyText: 'Hand-hammered traditional brass tableware with tarnish-resistant coating. Authentic Bangladeshi heritage product.',
      ogType: 'product',
    },
    {
      path: '/store/heritage-crafts',
      title: 'Heritage Crafts BD — Verified Merchant Storefront — Explooro',
      description: 'Explore curated Bangladeshi handmade textiles, brass crafts, and organic goods from Heritage Crafts BD. Fast COD & bKash checkout.',
      heading: 'Heritage Crafts BD Online Storefront',
      salerName: 'Farhana Sultana',
      bodyText: 'Specializing in authentic Jamdani sarees, Tangail handlooms, and traditional brassware. Verified blue-tick seller on Explooro.',
      ogType: 'profile',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Store',
        name: 'Heritage Crafts BD',
        description: 'Authentic handmade textiles and artisanal brass crafts.',
        url: 'https://explooro.com/store/heritage-crafts',
        address: { '@type': 'PostalAddress', addressCountry: 'BD' },
      },
    },
  ],
};
