/**
 * finance.routes.js — Route definitions for Finance, Ledger, Escrow, Clawbacks, Payouts, COD Reconciliation & Dashboards (Prompts 6.1, 6.2, 6.3, 6.4 & 6.5).
 */

import * as controller from '../controllers/finance.controller.js';
import * as payoutController from '../controllers/payout.controller.js';
import * as codController from '../controllers/codReconciliation.controller.js';

export default async function financeRoutes(app) {
  // 1. Ledger Integrity Check across all wallets
  app.get('/admin/finance/integrity', {
    preHandler: [app.authenticate, app.requirePermission('finance.integrity.check')],
    handler: controller.getIntegrity,
  });

  // 2. View current user's wallet
  app.get('/finance/wallet/me', {
    preHandler: [app.authenticate],
    handler: controller.getMyWallet,
  });

  // 3. View any wallet by ID (Admin)
  app.get('/admin/finance/wallets/:id', {
    preHandler: [app.authenticate, app.requirePermission('finance.wallet.view_any')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getWalletById,
  });

  // 4. Admin Escrow Holdings Dashboard with live countdowns
  app.get('/admin/finance/escrow', {
    preHandler: [app.authenticate, app.requirePermission('finance.escrow.view')],
    handler: controller.listEscrowHoldings,
  });

  // 5. Escrow Dead-Letter Queue (Failed releases)
  app.get('/admin/finance/dead-letters', {
    preHandler: [app.authenticate, app.requirePermission('finance.escrow.view')],
    handler: controller.listDeadLetters,
  });

  // 6. Negative Balance Deficit Recovery Queue
  app.get('/admin/finance/recoveries', {
    preHandler: [app.authenticate, app.requirePermission('finance.overview.view')],
    handler: controller.listRecoveries,
  });

  // 7. Manual trigger for Escrow Release Sweep
  app.post('/admin/finance/escrow/sweep', {
    preHandler: [app.authenticate, app.requirePermission('finance.escrow.release_manual')],
    handler: controller.triggerEscrowSweep,
  });

  // 8. User Payout Requests (Vault Withdrawals)
  app.post('/vault/withdraw', {
    preHandler: [app.authenticate, app.requirePermission('finance.payout.request')],
    handler: payoutController.requestWithdrawal,
  });

  // 9. Current User Payout History
  app.get('/vault/payouts/me', {
    preHandler: [app.authenticate],
    handler: payoutController.getMyPayouts,
  });

  // 10. Admin Payout Queue
  app.get('/admin/finance/payouts', {
    preHandler: [app.authenticate, app.requirePermission('finance.payout.view')],
    handler: payoutController.listPayoutQueue,
  });

  // 11. Admin Approve Payout (Maker-Checker / Execution)
  app.post('/admin/finance/payouts/:id/approve', {
    preHandler: [app.authenticate, app.requirePermission('finance.payout.approve')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: payoutController.approvePayout,
  });

  // 12. Admin Reject Payout
  app.post('/admin/finance/payouts/:id/reject', {
    preHandler: [app.authenticate, app.requirePermission('finance.payout.reject')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: payoutController.rejectPayout,
  });

  // 13. Admin Batch Disbursal
  app.post('/admin/finance/payouts/batch-disburse', {
    preHandler: [app.authenticate, app.requirePermission('finance.payout.batch')],
    handler: payoutController.batchDisburse,
  });

  // 14. COD Settlement Report Ingest (CSV / JSON)
  app.post('/admin/finance/cod/upload', {
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    handler: codController.uploadSettlementReport,
  });

  // 15. List COD Reconciliation Discrepancy Queue
  app.get('/admin/finance/cod', {
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    handler: codController.listReconciliations,
  });

  // 16. COD Aging Matrix Report
  app.get('/admin/finance/cod/aging', {
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    handler: codController.getAgingReport,
  });

  // 17. Resolve COD Discrepancy (Maker-Checker HIGH tier)
  app.post('/admin/finance/cod/:id/resolve', {
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: codController.resolveDiscrepancy,
  });

  // 18. Prompt 6.5: User Vault Overview (Balance Summary, Active Escrow Timeline, Recent Ledger)
  app.get('/vault/overview', {
    preHandler: [app.authenticate],
    handler: controller.getVaultOverview,
  });

  // 19. Prompt 6.5: User Ledger Audit Trail (Double-Entry Log with filtering & pagination)
  app.get('/vault/ledger', {
    preHandler: [app.authenticate],
    handler: controller.getMyLedger,
  });

  // 20. Prompt 6.5: Admin Financial Health Overview & Inline Trend Metrics
  app.get('/admin/finance/overview', {
    preHandler: [app.authenticate, app.requirePermission('finance.overview.view')],
    handler: controller.getFinanceOverview,
  });
}
