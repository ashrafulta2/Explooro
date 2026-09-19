/**
 * loadAdminCockpitStyles.js — dynamically loads admin-cockpit.css for AdminDashboardPage.
 *
 * Same pattern as loadCategoriesStyles.js: keeps the bytes out of main.css (70KB gzip budget) and
 * avoids a static .css import in a page module, which Node's test runner cannot load.
 */

let stylesPromise = null;

export function loadAdminCockpitStyles() {
  if (!stylesPromise) {
    stylesPromise = import('./components/admin-cockpit.css').catch(() => {
      stylesPromise = null;
    });
  }
  return stylesPromise;
}
