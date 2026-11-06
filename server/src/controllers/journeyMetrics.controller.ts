/**
 * journeyMetrics.controller.ts — HTTP edge of the guided-experience metrics (Prompt 13.7).
 */

import * as journeyMetricsService from '../services/journeyMetrics.service.ts';

export async function getReport(req, reply) {
  const data = await journeyMetricsService.getReport(req.db || req.server.db);
  return reply.send({ success: true, data });
}
