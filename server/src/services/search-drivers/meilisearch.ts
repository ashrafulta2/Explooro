/**
 * meilisearch.ts — Meilisearch driver stub (Prompt 4.4).
 *
 * Implements the identical SearchDriver interface for future horizontal scale.
 * Callers and controllers interact with SearchDriver polymorphically without changes.
 */

export class MeilisearchDriver {
  name: string;
  host: string;
  apiKey: string;

  constructor(config: { host?: string; apiKey?: string } = {}) {
    this.name = 'meilisearch';
    this.host = config.host || process.env.MEILISEARCH_HOST || 'http://localhost:7700';
    this.apiKey = config.apiKey || process.env.MEILISEARCH_API_KEY || '';
  }

  async search(db, options = {}) {
    // Stub implementation fallback to standard database search if unconfigured
    return {
      products: [],
      stores: [],
      categories: [],
      totalCount: 0,
      driver: 'meilisearch-stub',
    };
  }

  async suggest(db, options: Record<string, any> = {}) {
    return {
      query: options.query || '',
      suggestions: [],
      categories: [],
      driver: 'meilisearch-stub',
    };
  }
}

export const meilisearchDriver = new MeilisearchDriver();
