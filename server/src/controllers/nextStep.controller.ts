/**
 * nextStep.controller.ts — HTTP edge of the Next-Step engine (Prompt 13.2). The session decides whose
 * journey is answered; nothing in the request can ask for another user's.
 */

import * as nextStepService from '../services/nextStep.service.ts';

export async function getNextStep(req, reply) {
  const data = await nextStepService.getNextStep(req.server.db, req.server.cache, {
    id: req.user.id,
    roles: req.user.roles,
  });
  return reply.send({ success: true, data });
}

export async function getPreference(req, reply) {
  const data = await nextStepService.getPreference(req.server.db, req.user.id);
  return reply.send({ success: true, data });
}

export async function updatePreference(req, reply) {
  const data = await nextStepService.setShowNextSteps(req.server.db, req.server.cache, req.user.id, req.body.show_next_steps);
  return reply.send({ success: true, data });
}
