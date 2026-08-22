/** NotFoundStub — the router's `notFound` fallback. Real 404 page is Prompt 1.7. */
import { t } from '../../services/i18n.js';
import { Button } from '../../components/ui/Button.js';

export default function NotFoundStub(root, { navigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'route-stub';
  const heading = document.createElement('h2');
  heading.textContent = t('pages.not_found.heading');
  const desc = document.createElement('p');
  desc.className = 'text-sm text-muted';
  desc.textContent = t('pages.not_found.description');
  wrap.append(heading, desc);
  wrap.append(Button({ label: t('common.back_to_marketplace'), variant: 'secondary', onClick: () => navigate('/') }));
  root.append(wrap);
}
