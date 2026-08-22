/**
 * search.routes.js — Routes for Full-Text Search, Typeahead & Merchandising Logs (Prompt 4.4).
 */

import * as searchController from '../controllers/search.controller.js';

export default async function searchRoutes(app) {
  // Public search & typeahead
  app.get('/search', searchController.search);
  app.get('/search/suggest', searchController.suggest);

  // Admin merchandising intelligence
  app.get('/admin/search/zero-results', searchController.getZeroResultLog);
}
