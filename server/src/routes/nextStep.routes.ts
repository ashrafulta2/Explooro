/**
 * nextStep.routes.ts — GET /me/next-step and the user's own opt-out (Prompt 13.2).
 *
 * Registered under /api/v1/me. Authenticated and module-gated, with no permission key on purpose:
 * like the rest of /me, every route answers only about the caller, so `authenticate` is the whole
 * authorization story. The service is what keeps the answer permission-aware: it never offers a
 * step whose page the caller's permissions refuse.
 */

import * as controller from '../controllers/nextStep.controller.ts';
import { MODULE_KEY } from '../services/nextStep.service.ts';

export default async function nextStepRoutes(app) {
  const requireGuidance = app.requireModule(MODULE_KEY);

  app.get('/next-step', { preHandler: [app.authenticate, requireGuidance] }, controller.getNextStep);

  app.get('/next-step/preference', { preHandler: [app.authenticate, requireGuidance] }, controller.getPreference);

  app.put(
    '/next-step/preference',
    {
      preHandler: [app.authenticate, requireGuidance],
      schema: {
        body: {
          type: 'object',
          required: ['show_next_steps'],
          additionalProperties: false,
          properties: { show_next_steps: { type: 'boolean' } },
        },
      },
    },
    controller.updatePreference
  );
}
