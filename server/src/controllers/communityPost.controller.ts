/**
 * communityPost.controller.ts — HTTP in, HTTP out for the community timeline. Rules live in
 * services/communityPost.service.ts.
 */

import * as service from '../services/communityPost.service.ts';

const dbOf = (req) => req.db || req.server?.db;

export async function listPosts(req, reply) {
  const { type, role, sort, mine, limit, offset } = req.query || {};
  const { posts, counts, meta } = await service.listTimeline(dbOf(req), req.user ?? null, {
    type, role, sort, mine: mine === '1' || mine === 'true', limit, offset,
  });
  return reply.send({ data: { posts, counts }, meta });
}

export async function composerProducts(req, reply) {
  return reply.send({ data: await service.listComposerProducts(dbOf(req), req.user) });
}

export async function createPost(req, reply) {
  const post = await service.createPost(dbOf(req), req.user, req.body);
  return reply.status(201).send({ data: { post } });
}

export async function createAnnouncement(req, reply) {
  const post = await service.createAnnouncement(dbOf(req), req.user, req.body);
  return reply.status(201).send({ data: { post } });
}

export async function toggleLike(req, reply) {
  const result = await service.toggleLike(dbOf(req), req.user, Number(req.params.id));
  return reply.send({ data: { liked: result.liked, like_count: result.likeCount } });
}

export async function reportPost(req, reply) {
  const result = await service.reportPost(dbOf(req), req.user, Number(req.params.id), req.body);
  return reply.send({ data: result });
}

export async function getQueue(req, reply) {
  const { limit, offset } = req.query || {};
  return reply.send({ data: await service.getQueue(dbOf(req), { limit, offset }) });
}

export async function moderatePost(req, reply) {
  const result = await service.moderatePost(dbOf(req), req.user, Number(req.params.id), req.body.action);
  return reply.send({ data: result });
}
