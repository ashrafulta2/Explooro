/**
 * OtpPage.js — 6-digit OTP verification screen (Prompt 2.8).
 *
 * Implements Prompt 2.8 Requirement 1:
 * - 6-digit OTP input with seamless auto-advance, backspace handling, and clean clipboard paste.
 * - 60s resend timer and Bengali-first messaging.
 */

import { verifyOtp, sendOtp } from '../../services/session.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';

export default function OtpPage(container, { query = {}, navigate }) {
  container.replaceChildren();

  const phone = query.phone ? decodeURIComponent(query.phone) : '';
  const purpose = query.purpose ? decodeURIComponent(query.purpose) : 'LOGIN';
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
  title.textContent = t('auth.otp.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'auth-subtitle';
  subtitle.textContent = t('auth.otp.subtitle', { phone });

  header.append(brand, title, subtitle);

  // Form
  const form = document.createElement('form');
  form.className = 'auth-form';

  const otpLabel = document.createElement('label');
  otpLabel.className = 'auth-field__label';
  otpLabel.textContent = t('auth.otp.enter_code');

  const otpContainer = document.createElement('div');
  otpContainer.className = 'otp-container';

  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.maxLength = 1;
    input.className = 'otp-box';
    input.dataset.index = String(i);
    input.setAttribute('aria-label', `Digit ${i + 1}`);
    boxes.push(input);
    otpContainer.append(input);
  }

  // Key navigation & paste logic
  boxes.forEach((box, idx) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      box.value = val ? val[val.length - 1] : '';
      if (box.value) {
        box.classList.add('otp-box--filled');
        if (idx < 5) boxes[idx + 1].focus();
      } else {
        box.classList.remove('otp-box--filled');
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && idx > 0) {
        boxes[idx - 1].focus();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      const digits = pasted.replace(/[^0-9]/g, '').slice(0, 6);
      if (!digits) return;

      for (let i = 0; i < 6; i++) {
        if (digits[i]) {
          boxes[i].value = digits[i];
          boxes[i].classList.add('otp-box--filled');
        }
      }
      const targetIndex = Math.min(digits.length, 5);
      boxes[targetIndex].focus();
    });
  });

  const errorDiv = document.createElement('div');
  errorDiv.className = 'text-sm text-danger';
  errorDiv.style.display = 'none';

  const submitBtn = Button({
    label: t('auth.otp.submit'),
    variant: 'primary',
    type: 'submit',
  });

  // Resend Timer
  let cooldown = 60;
  let timerInterval = null;

  const resendRow = document.createElement('div');
  resendRow.className = 'auth-extra-row';

  const timerText = document.createElement('span');
  timerText.className = 'text-sm text-muted';

  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.className = 'button button--ghost';
  resendBtn.style.padding = '0';
  resendBtn.style.fontSize = 'var(--text-sm)';
  resendBtn.textContent = t('auth.otp.resend_btn');
  resendBtn.style.display = 'none';

  resendBtn.addEventListener('click', async () => {
    try {
      await sendOtp({ phone, purpose });
      toast.success(t('auth.otp.resend_success'));
      startTimer();
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    }
  });

  function updateTimerUi() {
    if (cooldown > 0) {
      timerText.textContent = t('auth.otp.resend_in', { seconds: cooldown });
      timerText.style.display = 'inline';
      resendBtn.style.display = 'none';
    } else {
      timerText.style.display = 'none';
      resendBtn.style.display = 'inline';
      if (timerInterval) clearInterval(timerInterval);
    }
  }

  function startTimer() {
    cooldown = 60;
    updateTimerUi();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      cooldown--;
      updateTimerUi();
    }, 1000);
  }

  startTimer();
  resendRow.append(timerText, resendBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.style.display = 'none';

    const otpCode = boxes.map((b) => b.value).join('');
    if (otpCode.length !== 6) {
      errorDiv.textContent = t('auth.otp.enter_code');
      errorDiv.style.display = 'block';
      return;
    }

    submitBtn.setLoading(true);

    try {
      const res = await verifyOtp({ phone, otp: otpCode, purpose });

      if (res.twoFactorRequired) {
        navigate(
          `/auth/2fa?challenge_token=${encodeURIComponent(res.challengeToken)}&enrolled=${Boolean(res.enrolled)}&redirect=${encodeURIComponent(redirectPath)}`
        );
        return;
      }

      if (res.success) {
        toast.success(t('auth.login.success'));
        navigate(redirectPath);
        return;
      }

      if (res.verified) {
        toast.success(t('auth.otp.register_verified'));
        navigate(`/login?redirect=${encodeURIComponent(redirectPath)}`);
      }
    } catch (err) {
      errorDiv.textContent = pickMessage(err) || err.message || t('common.error_generic');
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.setLoading(false);
    }
  });

  form.append(otpLabel, otpContainer, resendRow, errorDiv, submitBtn);

  // Footer / Change phone link
  const footer = document.createElement('div');
  footer.className = 'auth-footer';
  const changePhoneLink = document.createElement('a');
  changePhoneLink.href = `/login?redirect=${encodeURIComponent(redirectPath)}`;
  changePhoneLink.textContent = t('auth.otp.change_phone');
  footer.append(changePhoneLink);

  card.append(header, form, footer);
  wrapper.append(card);
  container.append(wrapper);

  // Focus first OTP box
  setTimeout(() => boxes[0]?.focus(), 50);

  return () => {
    if (timerInterval) clearInterval(timerInterval);
  };
}
