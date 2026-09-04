/**
 * TwoFactorPage.js — Staff 2FA challenge and enrollment screen (Prompt 2.8).
 *
 * Implements Prompt 2.8 Requirement 1:
 * - 2FA challenge step for staff.
 * - Handles initial setup enrollment if user is not yet enrolled.
 */

import { completeTwoFactor, setupTwoFactor } from '../../services/session.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { homePathForRoles } from '../../config/navigation.js';
import { Button } from '../../components/ui/Button.js';
import { getExplooroLogoSvg, formatExplooroBrandText } from '../../components/ui/icons.js';

export default function TwoFactorPage(container, { query = {}, navigate }) {
  container.replaceChildren();

  const challengeToken = query.challenge_token ? decodeURIComponent(query.challenge_token) : '';
  const isEnrolled = query.enrolled === 'true';
  // WHY: this defaulted to '/', so signing in without an explicit ?redirect dropped staff on
  // the customer marketplace — a super admin had to navigate to their own console by hand every
  // session. `landingPath()` is resolved AFTER sign-in, when the roles are actually known.
  const explicitRedirect = query.redirect ? decodeURIComponent(query.redirect) : null;
  const landingPath = (session) => explicitRedirect || homePathForRoles(session?.roles || session?.user?.roles || []);
  /** `&redirect=…` only when the user actually asked for a destination; otherwise the final auth
   *  step resolves the role's own home. */
  const redirectQuery = explicitRedirect ? `&redirect=${encodeURIComponent(explicitRedirect)}` : '';
  const redirectQueryFirst = explicitRedirect ? `?redirect=${encodeURIComponent(explicitRedirect)}` : '';

  const wrapper = document.createElement('div');
  wrapper.className = 'auth-container';

  const card = document.createElement('div');
  card.className = 'auth-card';

  // Header
  const header = document.createElement('div');
  header.className = 'auth-header';

  const brand = document.createElement('div');
  brand.className = 'auth-brand';
  brand.innerHTML = `${getExplooroLogoSvg({ size: 30 })} <span>${formatExplooroBrandText('Explooro Staff 2FA')}</span>`;

  const title = document.createElement('h1');
  title.className = 'auth-title';
  title.textContent = isEnrolled ? t('auth.two_factor.title') : t('auth.two_factor.setup_title');

  const subtitle = document.createElement('p');
  subtitle.className = 'auth-subtitle';
  subtitle.textContent = isEnrolled ? t('auth.two_factor.subtitle') : t('auth.two_factor.setup_subtitle');

  header.append(brand, title, subtitle);

  // Form
  const form = document.createElement('form');
  form.className = 'auth-form';

  const setupSection = document.createElement('div');
  setupSection.style.display = 'none';

  if (!isEnrolled && challengeToken) {
    setupTwoFactor({ challengeToken })
      .then((res) => {
        if (res?.data?.secret) {
          setupSection.style.display = 'block';
          const secretLabel = document.createElement('div');
          secretLabel.className = 'auth-field__label';
          secretLabel.textContent = t('auth.two_factor.secret_label');

          const secretBox = document.createElement('div');
          secretBox.className = 'auth-2fa-secret';
          secretBox.textContent = res.data.secret;

          setupSection.append(secretLabel, secretBox);
        }
      })
      .catch(() => {});
  }

  // 6-digit code input
  const codeField = document.createElement('div');
  codeField.className = 'auth-field';
  const codeLabel = document.createElement('label');
  codeLabel.className = 'auth-field__label';
  codeLabel.htmlFor = 'twofa-code';
  codeLabel.textContent = t('auth.two_factor.code_label');
  const codeInput = document.createElement('input');
  codeInput.id = 'twofa-code';
  codeInput.className = 'auth-field__input';
  codeInput.type = 'text';
  codeInput.inputMode = 'numeric';
  codeInput.pattern = '[0-9]*';
  codeInput.maxLength = 6;
  codeInput.required = true;
  codeInput.placeholder = '123456';
  codeInput.style.letterSpacing = '4px';
  codeInput.style.fontSize = 'var(--text-xl)';
  codeInput.style.textAlign = 'center';
  codeInput.setAttribute('aria-label', t('auth.two_factor.code_label'));
  codeField.append(codeLabel, codeInput);

  const errorDiv = document.createElement('div');
  errorDiv.className = 'text-sm text-danger';
  errorDiv.style.display = 'none';

  const submitBtn = Button({
    label: t('auth.two_factor.submit'),
    variant: 'primary',
    type: 'submit',
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.style.display = 'none';

    const code = codeInput.value.trim();
    if (code.length < 6) {
      errorDiv.textContent = 'Please enter a 6-digit authenticator code.';
      errorDiv.style.display = 'block';
      return;
    }

    submitBtn.setLoading(true);

    try {
      const res = await completeTwoFactor({ challengeToken, code });
      if (res.success) {
        toast.success(t('auth.two_factor.success'));
        navigate(landingPath(res.user));
      }
    } catch (err) {
      errorDiv.textContent = pickMessage(err) || err.message || t('common.error_generic');
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.setLoading(false);
    }
  });

  form.append(setupSection, codeField, errorDiv, submitBtn);

  card.append(header, form);
  wrapper.append(card);
  container.append(wrapper);

  setTimeout(() => codeInput.focus(), 50);

  return () => {};
}
