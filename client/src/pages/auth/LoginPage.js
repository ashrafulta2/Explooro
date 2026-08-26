/**
 * LoginPage.js — Unified authentication page (Prompt 2.8).
 *
 * Supports:
 * 1. Password login flow.
 * 2. Phone OTP login flow (requests OTP and transitions to /auth/otp).
 * 3. 2FA challenge interception for staff accounts.
 * 4. Bengali-first copy & accessible 44px touch targets.
 */

import { loginWithPassword, sendOtp } from '../../services/session.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { getExplooroLogoSvg, formatExplooroBrandText } from '../../components/ui/icons.js';

export default function LoginPage(container, { query = {}, navigate }) {
  container.replaceChildren();

  const redirectPath = query.redirect ? decodeURIComponent(query.redirect) : '/';

  const wrapper = document.createElement('div');
  wrapper.className = 'auth-container';

  const card = document.createElement('div');
  card.className = 'auth-card';

  // Header
  const header = document.createElement('div');
  header.className = 'auth-header';

  const brand = document.createElement('div');
  brand.className = 'auth-brand';
  brand.innerHTML = `${getExplooroLogoSvg({ size: 30 })} <span>${formatExplooroBrandText('Explooro')}</span>`;

  const title = document.createElement('h1');
  title.className = 'auth-title';
  title.textContent = t('auth.login.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'auth-subtitle';
  subtitle.textContent = t('auth.login.subtitle');

  header.append(brand, title, subtitle);

  // Mode Switch Tabs (Password vs OTP)
  let activeTab = 'password';

  const tabs = document.createElement('div');
  tabs.className = 'auth-tabs';
  tabs.setAttribute('role', 'tablist');

  const tabPassword = document.createElement('button');
  tabPassword.type = 'button';
  tabPassword.className = 'auth-tab';
  tabPassword.textContent = t('auth.login.tab_password');
  tabPassword.setAttribute('role', 'tab');
  tabPassword.setAttribute('aria-selected', 'true');

  const tabOtp = document.createElement('button');
  tabOtp.type = 'button';
  tabOtp.className = 'auth-tab';
  tabOtp.textContent = t('auth.login.tab_otp');
  tabOtp.setAttribute('role', 'tab');
  tabOtp.setAttribute('aria-selected', 'false');

  tabs.append(tabPassword, tabOtp);

  // Form container
  const form = document.createElement('form');
  form.className = 'auth-form';

  const identifierField = document.createElement('div');
  identifierField.className = 'auth-field';
  const identifierLabel = document.createElement('label');
  identifierLabel.className = 'auth-field__label';
  identifierLabel.htmlFor = 'login-identifier';
  identifierLabel.textContent = t('auth.login.identifier_label');
  const identifierInput = document.createElement('input');
  identifierInput.id = 'login-identifier';
  identifierInput.className = 'auth-field__input';
  identifierInput.type = 'text';
  identifierInput.required = true;
  identifierInput.placeholder = t('auth.login.identifier_placeholder');
  identifierInput.setAttribute('aria-label', t('auth.login.identifier_label'));
  identifierField.append(identifierLabel, identifierInput);

  const EYE_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>';

  const EYE_OFF_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>' +
    '<line x1="1" y1="1" x2="23" y2="23"></line>' +
    '</svg>';

  const passwordField = document.createElement('div');
  passwordField.className = 'auth-field';
  const passwordLabel = document.createElement('label');
  passwordLabel.className = 'auth-field__label';
  passwordLabel.htmlFor = 'login-password';
  passwordLabel.textContent = t('auth.login.password_label');

  const passwordWrap = document.createElement('div');
  passwordWrap.className = 'auth-password-wrap';

  const passwordInput = document.createElement('input');
  passwordInput.id = 'login-password';
  passwordInput.className = 'auth-field__input';
  passwordInput.type = 'password';
  passwordInput.required = true;
  passwordInput.placeholder = t('auth.login.password_placeholder');
  passwordInput.setAttribute('aria-label', t('auth.login.password_label'));

  const togglePasswordBtn = document.createElement('button');
  togglePasswordBtn.type = 'button';
  togglePasswordBtn.className = 'auth-password-toggle';
  togglePasswordBtn.setAttribute('aria-label', t('auth.show_password'));
  togglePasswordBtn.title = t('auth.show_password');
  togglePasswordBtn.innerHTML = EYE_ICON_SVG;

  let isPasswordVisible = false;
  togglePasswordBtn.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    passwordInput.type = isPasswordVisible ? 'text' : 'password';
    const label = isPasswordVisible ? t('auth.hide_password') : t('auth.show_password');
    togglePasswordBtn.setAttribute('aria-label', label);
    togglePasswordBtn.title = label;
    togglePasswordBtn.innerHTML = isPasswordVisible ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
  });

  passwordWrap.append(passwordInput, togglePasswordBtn);
  passwordField.append(passwordLabel, passwordWrap);

  const errorDiv = document.createElement('div');
  errorDiv.className = 'text-sm text-danger';
  errorDiv.style.display = 'none';

  const submitBtn = Button({
    label: t('auth.login.submit_password'),
    variant: 'primary',
    type: 'submit',
  });

  function updateTabUi() {
    if (activeTab === 'password') {
      tabPassword.setAttribute('aria-selected', 'true');
      tabOtp.setAttribute('aria-selected', 'false');
      passwordField.style.display = 'flex';
      passwordInput.required = true;
      submitBtn.textContent = t('auth.login.submit_password');
    } else {
      tabPassword.setAttribute('aria-selected', 'false');
      tabOtp.setAttribute('aria-selected', 'true');
      passwordField.style.display = 'none';
      // WHY: display:none alone doesn't reliably exempt a field from the browser's native
      // constraint validation — a hidden-but-required password input silently blocks the form's
      // submit event from ever firing on the OTP tab.
      passwordInput.required = false;
      submitBtn.textContent = t('auth.login.submit_otp');
    }
  }

  tabPassword.addEventListener('click', () => {
    activeTab = 'password';
    updateTabUi();
  });

  tabOtp.addEventListener('click', () => {
    activeTab = 'otp';
    updateTabUi();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.style.display = 'none';
    submitBtn.setLoading(true);

    const identifier = identifierInput.value.trim();
    const isEmail = identifier.includes('@');
    const phone = isEmail ? null : identifier;
    const email = isEmail ? identifier : null;

    try {
      if (activeTab === 'password') {
        const password = passwordInput.value;
        const res = await loginWithPassword({ identifier, phone, email, password });

        if (res.twoFactorRequired) {
          navigate(
            `/auth/2fa?challenge_token=${encodeURIComponent(res.challengeToken)}&enrolled=${Boolean(res.enrolled)}&redirect=${encodeURIComponent(redirectPath)}`
          );
          return;
        }

        if (res.success) {
          toast.success(t('auth.login.success'));
          navigate(redirectPath);
        }
      } else {
        await sendOtp({ phone, email, purpose: 'LOGIN' });
        const identifierQuery = phone
          ? `phone=${encodeURIComponent(phone)}`
          : `email=${encodeURIComponent(email)}`;
        navigate(
          `/auth/otp?${identifierQuery}&purpose=LOGIN&redirect=${encodeURIComponent(redirectPath)}`
        );
      }
    } catch (err) {
      errorDiv.textContent = pickMessage(err) || err.message || t('common.error_generic');
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.setLoading(false);
    }
  });

  form.append(identifierField, passwordField, errorDiv, submitBtn);

  // Footer / Register link
  const footer = document.createElement('div');
  footer.className = 'auth-footer';
  const noAccountSpan = document.createElement('span');
  noAccountSpan.textContent = `${t('auth.login.no_account')} `;
  const registerLink = document.createElement('a');
  registerLink.href = `/auth/register?redirect=${encodeURIComponent(redirectPath)}`;
  registerLink.textContent = t('auth.login.register_link');

  footer.append(noAccountSpan, registerLink);

  card.append(header, tabs, form, footer);
  wrapper.append(card);
  container.append(wrapper);

  return () => {};
}
