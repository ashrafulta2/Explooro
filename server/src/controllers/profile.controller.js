/**
 * profile.controller.js — HTTP surface for the signed-in user's own profile.
 *
 * Thin by design: the only thing this layer decides is that the subject is `req.user.id` and never
 * a value from the request body or params. Everything else is profile.service.js.
 */

import * as profileService from '../services/profile.service.js';

export async function getMyProfile(req, reply) {
  const data = await profileService.getMyProfile(req.server.db, req.server.config, req.user.id);
  return reply.send({ data });
}

export async function updateMyProfile(req, reply) {
  const data = await profileService.updateMyProfile(
    req.server.db,
    req.server.config,
    req.user.id,
    req.body || {}
  );
  return reply.send({ data });
}
