/**
 * auth.routes.js — Auth endpoint registration (Prompt 2.3).
 *
 * Every route declares a JSON Schema with `additionalProperties: false` per
 * docs/api-contract.md §7. Registered under the `/api/v1/auth` prefix by app.js.
 */

import * as controller from '../controllers/auth.controller.js';

const PHONE = { type: 'string', pattern: '^\\+8801[3-9]\\d{8}$' };
const OTP_PURPOSE = { type: 'string', enum: ['LOGIN', 'REGISTER', 'COD_CONFIRM', 'PAYOUT_CONFIRM', 'RESET'] };
const OTP_CODE = { type: 'string', pattern: '^\\d{6}$' };
// Self-registration only ever grants one of these three — staff/admin roles are assigned by an
// admin action (docs/prompt.md Phase 3), never chosen by the registering user.
const SELF_SERVICE_ROLE = { type: 'string', enum: ['customer', 'saler', 'supplier'], nullable: true };

export default async function authRoutes(app) {
  app.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['phone'],
        additionalProperties: false,
        properties: {
          phone: PHONE,
          password: { type: 'string', minLength: 8, maxLength: 128, nullable: true },
          full_name: { type: 'string', minLength: 1, maxLength: 200, nullable: true },
          role: SELF_SERVICE_ROLE,
        },
      },
    },
    handler: controller.register,
  });

  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'password'],
        additionalProperties: false,
        properties: { phone: PHONE, password: { type: 'string', minLength: 1 } },
      },
    },
    handler: controller.login,
  });

  app.post('/send-otp', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'purpose'],
        additionalProperties: false,
        properties: { phone: PHONE, purpose: OTP_PURPOSE },
      },
    },
    handler: controller.sendOtp,
  });

  app.post('/verify-otp', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'purpose', 'code'],
        additionalProperties: false,
        properties: { phone: PHONE, purpose: OTP_PURPOSE, code: OTP_CODE },
      },
    },
    handler: controller.verifyOtp,
  });

  app.post('/refresh', { handler: controller.refresh });

  app.post('/logout', { handler: controller.logout });

  app.get('/me', { preHandler: app.authenticate, handler: controller.me });

  app.post('/2fa/setup', {
    preHandler: app.authenticateOptional,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { challenge_token: { type: 'string', nullable: true } },
      },
    },
    handler: controller.setup2fa,
  });

  app.post('/2fa/verify', {
    preHandler: app.authenticateOptional,
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        additionalProperties: false,
        properties: {
          code: OTP_CODE,
          challenge_token: { type: 'string', nullable: true },
        },
      },
    },
    handler: controller.verify2fa,
  });
}
