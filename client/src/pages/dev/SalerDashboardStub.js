/**
 * SalerDashboardStub — Prompt 1.5 router demo. Guarded by `requiresAuth` + `requiresPermission`;
 * only reachable after LoginStub's "Simulate login" flips appStore.auth. Temporary: real dashboard
 * is Prompt 4.7+.
 */
import { logOutMock } from '../../state/appStore.js';
import { t } from '../../services/i18n.js';
import { Button } from '../../components/ui/Button.js';

export default function SalerDashboardStub(root, { navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';

  const heading = document.createElement('h2');
  heading.textContent = t('pages.saler.heading');
  const desc = document.createElement('p');
  desc.className = 'text-sm text-muted';
  desc.textContent = t('pages.saler.description');
  wrap.append(heading, desc);

  const logout = Button({
    label: t('pages.saler.log_out'),
    variant: 'secondary',
    onClick: () => {
      logOutMock();
      navigate('/');
    },
  });
  wrap.append(logout);
  root.append(wrap);
}
