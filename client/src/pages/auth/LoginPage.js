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
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';

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
  brand.textContent = '⚡ Explooro';

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

  const phoneField = document.createElement('div');
  phoneField.className = 'auth-field';
  const phoneLabel = document.createElement('label');
  phoneLabel.className = 'auth-field__label';
  phoneLabel.htmlFor = 'login-phone';
  phoneLabel.textContent = t('auth.login.phone_label');
  const phoneInput = document.createElement('input');
  phoneInput.id = 'login-phone';
  phoneInput.className = 'auth-field__input';
  phoneInput.type = 'tel';
  phoneInput.required = true;
  phoneInput.placeholder = t('auth.login.phone_placeholder');
  phoneInput.value = '+8801';
  phoneInput.setAttribute('aria-label', t('auth.login.phone_label'));
  phoneField.append(phoneLabel, phoneInput);

  const passwordField = document.createElement('div');
  passwordField.className = 'auth-field';
  const passwordLabel = document.createElement('label');
  passwordLabel.className = 'auth-field__label';
  passwordLabel.htmlFor = 'login-password';
  passwordLabel.textContent = t('auth.login.password_label');
  const passwordInput = document.createElement('input');
  passwordInput.id = 'login-password';
  passwordInput.className = 'auth-field__input';
  passwordInput.type = 'password';
  passwordInput.required = true;
  passwordInput.placeholder = t('auth.login.password_placeholder');
  passwordInput.setAttribute('aria-label', t('auth.login.password_label'));
  passwordField.append(passwordLabel, passwordInput);

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

    const phone = phoneInput.value.trim();

    try {
      if (activeTab === 'password') {
        const password = passwordInput.value;
        const res = await loginWithPassword({ phone, password });

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
        await sendOtp({ phone, purpose: 'LOGIN' });
        navigate(
          `/auth/otp?phone=${encodeURIComponent(phone)}&purpose=LOGIN&redirect=${encodeURIComponent(redirectPath)}`
        );
      }
    } catch (err) {
      errorDiv.textContent = err.message_bn || err.message_en || err.message || t('common.error_generic');
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.setLoading(false);
    }
  });

  form.append(phoneField, passwordField, errorDiv, submitBtn);

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
