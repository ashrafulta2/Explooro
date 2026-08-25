/**
 * b2bEscrow.routes.js — Fastify routes for B2B Wholesale Escrow & Milestone Settlement (Prompt 10.6).
 */

import * as b2bController from '../controllers/b2bEscrow.controller.js';

export default async function b2bEscrowRoutes(app) {
  const requireB2bModule = app.requireModule('b2b_escrow');

  // 1. Deals CRUD & Discovery
  app.post('/b2b-escrow/deals', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.createDeal);

  app.get('/b2b-escrow/deals', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.listDeals);

  app.get('/b2b-escrow/deals/:idOrRef', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.getDeal);

  // 2. Terms Agreement & Lock
  app.post('/b2b-escrow/deals/:id/accept', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.acceptDealTerms);

  // 3. Milestone Staged Release & Evidence
  app.post('/b2b-escrow/milestones/:id/evidence', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.submitMilestoneEvidence);

  app.post('/b2b-escrow/milestones/:id/release', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.releaseMilestone);

  // 4. Disputes & Freezing
  app.post('/b2b-escrow/deals/:id/dispute', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.raiseDispute);

  // 5. Refunds & Cancellations
  app.post('/b2b-escrow/milestones/:id/refund', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.refundMilestone);

  app.post('/b2b-escrow/deals/:id/cancel', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.cancelDeal);

  // 6. Contract Summary PDF Export
  app.get('/b2b-escrow/deals/:id/contract.pdf', {
    preHandler: [app.authenticate, requireB2bModule],
  }, b2bController.downloadContractPdf);
}
