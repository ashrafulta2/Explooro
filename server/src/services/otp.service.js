/**
 * otp.service.js — 6-digit OTP lifecycle (Prompt 2.3).
 *
 * docs/erd.md's otp_codes table: 5-minute TTL, max 5 attempts, hashed at rest, single-use.
 * Rate limits (docs/api-contract.md §6): 3/hour per phone, 10/hour per IP on send.
 */

import { createHash, randomInt } from 'node:crypto';
import * as userRepo from '../repositories/user.repository.js';
import { checkBucket } from '../lib/rateBucket.js';
import { AppError } from '../plugins/errorHandler.js';

const OTP_TTL_SECONDS = 5 * 60;

function hashCode(code) {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function sendOtp(db, cache, smsSender, emailSender, { phone, email, purpose, ip, isDevelopment }) {
  if (!phone && !email) {
    throw new AppError('VALIDATION_ERROR', 'A phone number or email address is required to send OTP.', 'ওটিপি পাঠাতে ফোন নম্বর বা ইমেইল ঠিকানা আবশ্যক।');
  }

  if (phone) {
    await checkBucket(cache, `otp:phone:${phone}`, 3, 3600);
  }
  if (email) {
    await checkBucket(cache, `otp:email:${email.toLowerCase().trim()}`, 3, 3600);
  }
  await checkBucket(cache, `otp:ip:${ip}`, 10, 3600);

  const code = generateCode();
  await userRepo.createOtp(db, {
    phone: phone || null,
    email: email || null,
    codeHash: hashCode(code),
    purpose,
    expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
  });

  if (phone && smsSender) {
    await smsSender(phone, `Your Explooro verification code is ${code}. It expires in 5 minutes.`);
  }

  if (email && emailSender) {
    await emailSender(email, {
      subject: 'Your Explooro Verification Code',
      text: `Your Explooro verification code is ${code}. It expires in 5 minutes.`,
      html: `<p>Your Explooro verification code is <strong>${code}</strong>. It expires in 5 minutes.</p>`,
    });
  }

  return { expiresInS: OTP_TTL_SECONDS, devCode: isDevelopment ? code : undefined };
}

/** Throws OTP_EXPIRED / OTP_ATTEMPTS_EXCEEDED / OTP_INVALID; returns the consumed row on success. */
export async function verifyOtp(db, { phone, email, purpose, code }) {
  if (!phone && !email) {
    throw new AppError('VALIDATION_ERROR', 'A phone number or email address is required.', 'ফোন নম্বর বা ইমেইল ঠিকানা আবশ্যক।');
  }

  const otp = await userRepo.getLatestActiveOtp(db, { phone, email, purpose });
  if (!otp) {
    throw new AppError('OTP_EXPIRED', 'This code has expired.', 'এই কোডের মেয়াদ শেষ হয়ে গেছে।');
  }

  if (otp.attempts >= otp.max_attempts) {
    throw new AppError(
      'OTP_ATTEMPTS_EXCEEDED',
      'Too many incorrect attempts. Request a new code.',
      'অনেকবার ভুল হয়েছে। একটি নতুন কোড চান।'
    );
  }

  if (hashCode(code) !== otp.code_hash) {
    await userRepo.incrementOtpAttempts(db, otp.id);
    throw new AppError('OTP_INVALID', 'That code is not correct.', 'কোডটি সঠিক নয়।');
  }

  await userRepo.consumeOtp(db, otp.id);
  return otp;
}
