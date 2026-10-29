/**
 * RoleStubPage — generic placeholder every navigation.ts item routes to until its real page is
 * built (Phases 2–11). Self-looks-up its own nav item by the current path rather than needing the
 * router to thread extra metadata through, so main.ts can register all ~115 items with one loop.
 */
import { navItems } from '../../config/navigation.ts';
import { t } from '../../services/i18n.ts';
import { Button } from '../../components/ui/Button.ts';
import { EmptyState } from '../../components/ui/EmptyState.ts';
import type { PageContext } from '../types.ts';

export default function RoleStubPage(root: HTMLElement, { navigate }: PageContext) {
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
