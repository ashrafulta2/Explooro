/**
 * search.controller.js — Handlers for search & typeahead suggest endpoints (Prompt 4.4).
 */

import * as searchService from '../services/search.service.js';

export async function search(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;

  const {
    q,
    query,
    category_id,
    category_slug,
    min_price,
    max_price,
    in_stock,
    min_rating,
    limit,
    offset,
  } = req.query || {};

  const searchTerm = q || query || '';

  const results = await searchService.executeSearch(db, cache, {
    query: searchTerm,
    filters: {
      categoryId: category_id ? parseInt(category_id, 10) : undefined,
      categorySlug: category_slug,
      minPrice: min_price ? parseFloat(min_price) : undefined,
      maxPrice: max_price ? parseFloat(max_price) : undefined,
      inStock: in_stock === 'true' || in_stock === true,
      minRating: min_rating ? parseFloat(min_rating) : undefined,
    },
    limit: limit ? parseInt(limit, 10) : 20,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send(results);
}

export async function suggest(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { q, query, limit } = req.query || {};

  const searchTerm = q || query || '';

  const results = await searchService.executeSuggest(db, cache, {
    query: searchTerm,
    limit: limit ? parseInt(limit, 10) : 6,
  });

  return reply.send(results);
}

export async function getZeroResultLog(req, reply) {
  return reply.send({
    zero_result_searches: searchService.zeroResultSearchLog,
  });
}
