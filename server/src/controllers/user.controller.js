/**
 * user.controller.js — Request handlers for user and permission introspection admin APIs (Prompt 3.3).
 */

import * as userRepo from '../repositories/user.repository.js';
import * as rbacService from '../services/rbac.service.js';

export async function listUsers(req, reply) {
  const db = req.db || req.server?.db;
  const { q, role, tier, verification, restriction, district, limit, offset } = req.query || {};

  const users = await userRepo.listUsersForAdmin(db, {
    query: q,
    role,
    tier,
    verification,
    restriction,
    district,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({ users, total: users.length });
}

export async function getUserDetail(req, reply) {
  const db = req.db || req.server?.db;
  const { id } = req.params;

  const user = await userRepo.getUserDetailForAdmin(db, id);
  if (!user) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message_en: `User "${id}" not found.` },
    });
  }

  return reply.send({ user });
}

export async function getUserPermissions(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { id } = req.params;

  const user = await userRepo.findUserById(db, id);
  if (!user) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message_en: `User "${id}" not found.` },
    });
  }

  const payload = await rbacService.getPermissionsPayload(db, cache, user.id);
  return reply.send({ data: payload });
}

export async function getRolesPermissions(req, reply) {
  const db = req.db || req.server?.db;
  const matrix = await userRepo.getRolesAndPermissionMatrix(db);
  return reply.send(matrix);
}
