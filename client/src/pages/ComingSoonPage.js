/**
 * ComingSoonPage — what a page set to COMING_SOON renders instead of itself.
 *
 * core/router.js swaps this in for the matched route (keeping its title, so the browser tab still
 * names the page the user clicked) when services/pageAccess.js resolves COMING_SOON for them. The
 * nav item stays visible with a badge, which is the difference between this state and HIDDEN: the
 * user is being told "this is coming", not being left to wonder whether it exists.
 *
 * Distinct from pages/dev/RoleStubPage.js, which stands in for a page that has not been BUILT.
 * This one stands in for a page that is built and deliberately not released yet, so it never
 * offers the dev shell as an escape hatch — it sends the user back where they came from.
 */
import { navItems } from '../config/navigation.js';
import { t } from '../services/i18n.js';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';

const CLOCK_ICON =
  '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle>' +
  '<path d="M12 7.5V12l3 2"></path></svg>';

export default function ComingSoonPage(root, { navigate } = {}) {
  const path = window.location.pathname;
  const item = navItems.find((i) => i.path === path);

  const wrap = document.createElement('div');
  wrap.className = 'coming-soon-page';

  const icon = document.createElement('span');
  icon.innerHTML = CLOCK_ICON;
  icon.setAttribute('aria-hidden', 'true');

  wrap.append(
    EmptyState({
      icon,
      title: item ? t(item.label_i18n_key) : t('page_availability.coming_soon_title', 'Coming soon'),
      description: t(
        'page_availability.coming_soon_body',
        'This feature is being prepared and will open soon. Nothing is wrong on your side.'
      ),
      action: Button({
        label: t('common.back', 'Back'),
        variant: 'secondary',
        onClick: () => {
          // history.back() rather than a hard '/' so a user two pages into a portal does not get
          // thrown out to the marketplace for clicking something that is not ready.
          if (window.history.length > 1) window.history.back();
          else navigate?.('/');
        },
      }),
    })
  );

  root.append(wrap);
}
