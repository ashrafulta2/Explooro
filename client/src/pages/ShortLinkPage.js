/**
 * ShortLinkPage — what a shop partner's tracked link (`/s/:code`) opens on the client origin.
 *
 * The server's own /s/:code redirect only answers when the server serves that origin; the dev
 * server proxies just /api, so the SPA handles the path itself: it remembers the partner as the
 * shopper's touch (services/attribution.ts), asks the API to count the click and name the target,
 * and replaces itself with that page so Back does not bounce through the link again.
 */
import { api } from '../core/api.ts';
import { t } from '../services/i18n.ts';
import { toast } from '../services/toast.ts';
import { recordTouch } from '../services/attribution.ts';

export default function ShortLinkPage(root, { params, navigate } = {}) {
  const code = String(params?.code || '').trim().toLowerCase();

  const status = document.createElement('p');
  status.className = 'container text-sm text-muted';
  status.setAttribute('role', 'status');
  status.textContent = t('social_kit.link_opening');
  root.append(status);

  // WHY before the request: the touch should survive even if counting the click fails.
  recordTouch('LINK', code);

  api.post(`/links/${encodeURIComponent(code)}/open`, { referrer: document.referrer || null }, { skipAuthRedirect: true })
    .then((res) => {
      const path = res?.path || res?.data?.path;
      navigate?.(typeof path === 'string' && path.startsWith('/') ? path : '/', { replace: true });
    })
    .catch(() => {
      toast.info(t('social_kit.link_unavailable'));
      navigate?.('/', { replace: true });
    });
}
