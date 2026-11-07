/**
 * flyerDesign.controller.ts — Request handlers for a person's saved Flyer Studio designs.
 */

import * as flyerDesignService from '../services/flyerDesign.service.ts';

function dbOf(req) {
  return req.db || req.server?.db;
}

export async function listSaved(req, reply) {
  return reply.send({ data: await flyerDesignService.list(dbOf(req), req.user.id) });
}

export async function saveDesign(req, reply) {
  return reply.send({ data: await flyerDesignService.save(dbOf(req), req.user.id, req.params.key) });
}

export async function removeDesign(req, reply) {
  return reply.send({ data: await flyerDesignService.remove(dbOf(req), req.user.id, req.params.key) });
}

export async function mergeSaved(req, reply) {
  return reply.send({ data: await flyerDesignService.merge(dbOf(req), req.user.id, req.body?.keys) });
}
