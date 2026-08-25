/**
 * saler.controller.js — Fastify Controller for Saler Dashboard & Analytics (Prompt 11.2).
 */

import * as salerService from '../services/salerDashboard.service.js';
import { AppError } from '../plugins/errorHandler.js';

export async function getDashboardOverview(req, reply) {
  const db = req.db || req.server.db;
  const salerId = req.user?.id;

  if (!salerId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const data = await salerService.getSalerOverview(db, salerId);
  return reply.send({
    success: true,
    data,
  });
}

export async function getAnalytics(req, reply) {
  const db = req.db || req.server.db;
  const salerId = req.user?.id;
  const { range = '30d' } = req.query || {};

  if (!salerId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const data = await salerService.getSalerAnalytics(db, salerId, { range });
  return reply.send({
    success: true,
    data,
  });
}

export async function getOnboardingStatus(req, reply) {
  const db = req.db || req.server.db;
  const salerId = req.user?.id;

  if (!salerId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const overview = await salerService.getSalerOverview(db, salerId);
  return reply.send({
    success: true,
    data: overview.onboarding,
  });
}

export async function getGrowthRecommendations(req, reply) {
  const db = req.db || req.server.db;
  const salerId = req.user?.id;
  const lang = req.headers['accept-language']?.includes('bn') ? 'bn' : 'en';

  if (!salerId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const data = await salerService.getSalerGrowthRecommendations(db, salerId, lang);
  return reply.send({
    success: true,
    data,
  });
}
