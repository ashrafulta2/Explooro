/**
 * RoleStubPage — generic placeholder every navigation.js item routes to until its real page is
 * built (Phases 2–11). Self-looks-up its own nav item by the current path rather than needing the
 * router to thread extra metadata through, so main.js can register all ~115 items with one loop.
 */
import { navItems } from '../../config/navigation.js';
import { t } from '../../services/i18n.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function RoleStubPage(root, { navigate }) {
  const item = navItems.find((i) => i.path === window.location.pathname);
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';

  wrap.append(
    EmptyState({
      title: item ? t(item.label_i18n_key) : window.location.pathname,
      description: t('shell.coming_soon'),
      action: Button({ label: t('shell.back_to_shell'), variant: 'secondary', onClick: () => navigate('/dev/shell') }),
    })
  );
  root.append(wrap);
}
