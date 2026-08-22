/**
 * LoginStub — Prompt 1.5 router demo target for the `requiresAuth` guard's redirect. Real login
 * (OTP/password) is Prompt 2.3. "Simulate login" exists only so the guard-pass path is visible
 * without a backend.
 */
import { setMockRole } from '../../state/appStore.js';
import { t } from '../../services/i18n.js';
import { Button } from '../../components/ui/Button.js';

export default function LoginStub(root, { query, navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';
  const redirect = query.redirect || '/';

  const heading = document.createElement('h2');
  heading.textContent = t('pages.login.heading');
  const desc = document.createElement('p');
  desc.className = 'text-sm text-muted';
  desc.textContent = query.redirect
    ? t('pages.login.description', { redirect })
    : t('pages.login.description_no_redirect');
  wrap.append(heading, desc);

  const login = Button({
    label: t('pages.login.simulate_login'),
    onClick: () => {
      setMockRole('saler');
      navigate(redirect, { replace: true });
    },
  });
  wrap.append(login);
  root.append(wrap);
}
