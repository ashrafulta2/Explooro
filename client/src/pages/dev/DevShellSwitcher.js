/**
 * DevShellSwitcher — Prompt 1.7 PREVIEW: "A role switcher ... lets the developer preview all six
 * role shells live." The PREVIEW text places this in /dev/gallery, which doesn't exist until
 * Prompt 1.8 — this is the interim home, same pattern Prompts 1.3/1.4 used (render on a plain
 * page now, migrate into the real gallery next prompt). Also the router's `loginPath`: any guarded
 * route hit while logged out lands here instead of a single fixed role's login stub.
 */
import { NAV_ROLES, navItems } from '../../config/navigation.js';
import { getRoleMeta } from '../../config/permissions.mock.js';
import { setMockRole, logOutMock, appStore } from '../../state/appStore.js';
import { t, getLanguage } from '../../services/i18n.js';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';

const ROLE_HOME = {
  super_admin: '/admin',
  moderator: '/moderator',
  editor: '/editor',
  supplier: '/supplier',
  saler: '/saler',
  customer: '/',
};

export default function DevShellSwitcher(root, { query, navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';

  const heading = document.createElement('h2');
  heading.textContent = 'Shell preview — Prompt 1.7';
  const desc = document.createElement('p');
  desc.className = 'text-sm text-muted';
  desc.textContent =
    'Pick a role to preview its sidebar, top bar, mobile nav, and the command palette (Ctrl/Cmd+K). Each role grants its default permissions minus a couple withheld ones, so locked nav items (ia-sitemap.md §5.1) are visible too.';
  wrap.append(heading, desc);

  const grid = document.createElement('div');
  grid.className = 'route-stub__cards';

  for (const role of NAV_ROLES) {
    const meta = getRoleMeta(role);
    const label = getLanguage() === 'bn' ? meta?.label_bn ?? role : meta?.label_en ?? role;
    const itemCount = navItems.filter((i) => i.roles.includes(role)).length;
    const body = document.createElement('p');
    body.className = 'text-sm text-muted';
    body.textContent = `${itemCount} nav items`;
    grid.append(
      Card({
        title: label,
        body,
        interactive: true,
        onClick: () => {
          setMockRole(role);
          navigate(query.redirect || ROLE_HOME[role]);
        },
      })
    );
  }
  wrap.append(grid);

  const currentRole = appStore.get().auth.role;
  if (currentRole) {
    const logoutBtn = Button({
      label: t('shell.log_out'),
      variant: 'secondary',
      onClick: () => {
        logOutMock();
        navigate('/dev/shell');
      },
    });
    wrap.append(logoutBtn);
  }

  root.append(wrap);
}
