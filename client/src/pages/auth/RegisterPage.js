/**
 * RegisterPage.js — User registration page (Prompt 2.8).
 *
 * Supports account creation for Customer, Saler, and Supplier roles.
 * Advances to OTP verification on submission.
 */

import { register, sendOtp } from '../../services/session.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { Button } from '../../components/ui/Button.js';

export default function RegisterPage(container, { query = {}, navigate }) {
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
  title.textContent = t('auth.register.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'auth-subtitle';
  subtitle.textContent = t('auth.register.subtitle');

  header.append(brand, title, subtitle);

  // Form
  const form = document.createElement('form');
  form.className = 'auth-form';

  // Role selector
  let selectedRole = 'customer';
  const roleSection = document.createElement('div');
  roleSection.className = 'auth-field';
  const roleLabel = document.createElement('label');
  roleLabel.className = 'auth-field__label';
  roleLabel.textContent = t('auth.register.role_label');

  const rolesGrid = document.createElement('div');
  rolesGrid.className = 'auth-roles';

  const roles = [
    { key: 'customer', title: t('auth.register.role_customer') },
    { key: 'saler', title: t('auth.register.role_saler') },
    { key: 'supplier', title: t('auth.register.role_supplier') },
  ];

  const roleCards = roles.map((r) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'auth-role-card';
    cardEl.dataset.selected = r.key === selectedRole ? 'true' : 'false';

    const cardTitle = document.createElement('div');
    cardTitle.className = 'auth-role-card__title';
    cardTitle.textContent = r.title;

    cardEl.append(cardTitle);

    cardEl.addEventListener('click', () => {
      selectedRole = r.key;
      roleCards.forEach((c, idx) => {
        c.dataset.selected = roles[idx].key === selectedRole ? 'true' : 'false';
      });
    });

    return cardEl;
  });

  rolesGrid.append(...roleCards);
  roleSection.append(roleLabel, rolesGrid);

  // Phone
  const phoneField = document.createElement('div');
  phoneField.className = 'auth-field';
  const phoneLabel = document.createElement('label');
  phoneLabel.className = 'auth-field__label';
  phoneLabel.htmlFor = 'register-phone';
  phoneLabel.textContent = t('auth.register.phone_label');
  const phoneInput = document.createElement('input');
  phoneInput.id = 'register-phone';
  phoneInput.className = 'auth-field__input';
  phoneInput.type = 'tel';
  phoneInput.required = true;
  phoneInput.placeholder = '017XXXXXXXX';
  phoneInput.value = '+8801';
  phoneInput.setAttribute('aria-label', t('auth.register.phone_label'));
  phoneField.append(phoneLabel, phoneInput);

  // Name
  const nameField = document.createElement('div');
  nameField.className = 'auth-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'auth-field__label';
  nameLabel.htmlFor = 'register-name';
  nameLabel.textContent = t('auth.register.name_label');
  const nameInput = document.createElement('input');
  nameInput.id = 'register-name';
  nameInput.className = 'auth-field__input';
  nameInput.type = 'text';
  nameInput.placeholder = 'Full Name';
  nameInput.setAttribute('aria-label', t('auth.register.name_label'));
  nameField.append(nameLabel, nameInput);

  // Password
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
  passwordLabel.htmlFor = 'register-password';
  passwordLabel.textContent = t('auth.register.password_label');

  const passwordWrap = document.createElement('div');
  passwordWrap.className = 'auth-password-wrap';

  const passwordInput = document.createElement('input');
  passwordInput.id = 'register-password';
  passwordInput.className = 'auth-field__input';
  passwordInput.type = 'password';
  passwordInput.required = true;
  passwordInput.placeholder = '••••••••';
  passwordInput.setAttribute('aria-label', t('auth.register.password_label'));

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
    label: t('auth.register.submit'),
    variant: 'primary',
    type: 'submit',
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.style.display = 'none';
    submitBtn.setLoading(true);

    const phone = phoneInput.value.trim();
    const name = nameInput.value.trim();
    const password = passwordInput.value;

    try {
      await register({
        phone,
        role: selectedRole,
        name,
        password,
      });

      // register() only creates the account — it doesn't send a code, so the OTP screen would
      // otherwise sit with nothing sent until the 60s resend timer expires.
      await sendOtp({ phone, purpose: 'REGISTER' });

      navigate(
        `/auth/otp?phone=${encodeURIComponent(phone)}&purpose=REGISTER&redirect=${encodeURIComponent(redirectPath)}`
      );
    } catch (err) {
      errorDiv.textContent = pickMessage(err) || err.message || t('common.error_generic');
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.setLoading(false);
    }
  });

  form.append(roleSection, phoneField, nameField, passwordField, errorDiv, submitBtn);

  // Footer / Login link
  const footer = document.createElement('div');
  footer.className = 'auth-footer';
  const hasAccountSpan = document.createElement('span');
  hasAccountSpan.textContent = `${t('auth.register.has_account')} `;
  const loginLink = document.createElement('a');
  loginLink.href = `/login?redirect=${encodeURIComponent(redirectPath)}`;
  loginLink.textContent = t('auth.register.login_link');

  footer.append(hasAccountSpan, loginLink);

  card.append(header, form, footer);
  wrapper.append(card);
  container.append(wrapper);

  return () => {};
}
