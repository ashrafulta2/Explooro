/**
 * codGate.service.js — the Cash on Delivery trust / OTP gate, shared by checkout and team purchase.
 *
 * A COD order from a low-trust account, or one above the platform's COD value limit, must be
 * confirmed with an SMS code before it is placed (trustScore.service.js `evaluateCodRisk` decides).
 * The first attempt sends the code and answers COD_OTP_REQUIRED; the shopper sends the same request
 * again with `otp_code`.
 *
 * WHY the OTP is sent and checked on the pool (`db`), never on the order's transaction client:
 *   - Sending happens right before COD_OTP_REQUIRED is thrown, and that throw rolls the order's
 *     transaction back. A code inserted on the transaction client was rolled back with it, so the
 *     shopper could never enter a valid one (this is how checkout behaved before).
 *   - A wrong code increments the attempt counter. On the transaction client the increment was rolled
 *     back with the failed order, so the 5-attempt limit never held.
 * The trust read stays on the transaction client, so it sees the same snapshot as the order.
 */

import { AppError } from '../plugins/errorHandler.js';
import * as trustScoreService from './trustScore.service.js';
import * as otpService from './otp.service.js';

export const OTP_PURPOSE = 'COD_CONFIRM';

/** "+8801712345678" -> "+880171****678", so an error body never carries the whole number. */
export function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 8) return s;
  return `${s.slice(0, 7)}****${s.slice(-3)}`;
}

/**
 * @param {object} db          the pool — OTP rows are written here (see the WHY above)
 * @param {object} cache
 * @param {object} params
 * @param {object} params.client        the order's transaction client (trust read)
 * @param {number} params.userId
 * @param {string} params.phone         E.164 number the code goes to
 * @param {number} params.orderAmount   BDT, what the shopper would pay on delivery
 * @param {string} [params.otpCode]     the code, on the second attempt
 * @param {Function} [params.smsSender] (phone, message) => Promise; app.smsSender
 * @param {boolean} [params.isDevelopment] echo the code as `otp_debug`, like POST /auth/otp/send
 * @param {string} [params.ip]
 * @returns {Promise<{isOtpVerified: boolean, trustScore: number}>}
 */
export async function enforceCodGate(db, cache, {
  client = null,
  userId,
  phone,
  orderAmount,
  otpCode = null,
  smsSender = null,
  isDevelopment = false,
  ip = null,
}) {
  const risk = await trustScoreService.evaluateCodRisk(client || db, { userId, orderAmount });
  if (!risk.requiresOtp) {
    return { isOtpVerified: false, trustScore: risk.trustScore };
  }

  if (!phone) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Add a phone number to your account to pay Cash on Delivery for this order.',
      'এই অর্ডারে ক্যাশ অন ডেলিভারি দিতে আপনার অ্যাকাউন্টে একটি ফোন নম্বর যোগ করুন।',
      { field: 'phone' }
    );
  }

  if (!otpCode) {
    let devCode;
    try {
      const sent = await otpService.sendOtp(db, cache, smsSender, null, {
        phone,
        purpose: OTP_PURPOSE,
        ip: ip || 'unknown',
        isDevelopment,
      });
      devCode = sent.devCode;
    } catch (err) {
      // A rate-limited or failed send must say so, not pretend a code is on its way.
      if (err instanceof AppError) throw err;
      throw new AppError(
        'UPSTREAM_UNAVAILABLE',
        'We could not send the confirmation code. Try again in a minute.',
        'নিশ্চিতকরণ কোড পাঠানো যায়নি। এক মিনিট পর আবার চেষ্টা করুন।'
      );
    }

    throw new AppError(
      'COD_OTP_REQUIRED',
      'SMS OTP verification is required for this Cash on Delivery order.',
      'এই ক্যাশ অন ডেলিভারি অর্ডারের জন্য এসএমএস ওটিপি যাচাইকরণ প্রয়োজন।',
      {
        phone: maskPhone(phone),
        trust_score: risk.trustScore,
        reason: risk.reason,
        ...(devCode ? { otp_debug: devCode } : {}),
      }
    );
  }

  await otpService.verifyOtp(db, { phone, code: String(otpCode).trim(), purpose: OTP_PURPOSE });
  return { isOtpVerified: true, trustScore: risk.trustScore };
}
