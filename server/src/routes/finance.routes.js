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
    // `config.page` is read by the onRoute hook in middlewares/requirePage.js: when this page is
    // parked at /admin/platform/pages, these endpoints answer 403 PAGE_UNAVAILABLE instead of data.
    config: { page: '/admin/finance/escrow' },
    preHandler: [app.authenticate, app.requirePermission('finance.escrow.view')],
    handler: controller.listEscrowHoldings,
  });

  // 4b. Release one sub-order's escrow before its return window ends (CRITICAL: super admin only)
  app.post('/admin/finance/escrow/:subOrderId/release', {
    config: { page: '/admin/finance/escrow' },
    preHandler: [app.authenticate, app.requirePermission('finance.escrow.release_manual')],
    schema: {
      params: {
        type: 'object',
        required: ['subOrderId'],
        properties: { subOrderId: { type: 'string', pattern: '^[0-9]+$' } },
      },
      body: {
        type: 'object',
        required: ['reason'],
        additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 10, maxLength: 500 } },
      },
    },
    handler: controller.releaseEscrowHolding,
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
    config: { page: '/admin/finance' },
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
    config: { page: '/admin/finance/payouts' },
    preHandler: [app.authenticate, app.requirePermission('finance.payout.view')],
    handler: payoutController.listPayoutQueue,
  });

  // 11. Admin Approve Payout (Maker-Checker / Execution)
  app.post('/admin/finance/payouts/:id/approve', {
    config: { page: '/admin/finance/payouts' },
    preHandler: [
      app.authenticate,
      app.requirePermission('finance.payout.approve', {
        // A standing grant may cap this at { max_amount } — see server/src/lib/grantScope.js.
        scopeFacts: payoutController.payoutScopeFacts,
      }),
    ],
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
    config: { page: '/admin/finance/payouts' },
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
    config: { page: '/admin/finance/payouts' },
    preHandler: [app.authenticate, app.requirePermission('finance.payout.batch')],
    handler: payoutController.batchDisburse,
  });

  // 14. COD Settlement Report Ingest (CSV / JSON)
  app.post('/admin/finance/cod/upload', {
    config: { page: '/admin/cod-reconciliation' },
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    handler: codController.uploadSettlementReport,
  });

  // 15. List COD Reconciliation Discrepancy Queue
  app.get('/admin/finance/cod', {
    config: { page: '/admin/cod-reconciliation' },
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    handler: codController.listReconciliations,
  });

  // 16. COD Aging Matrix Report
  app.get('/admin/finance/cod/aging', {
    config: { page: '/admin/cod-reconciliation' },
    preHandler: [app.authenticate, app.requirePermission('orders.cod.reconcile')],
    handler: codController.getAgingReport,
  });

  // 17. Resolve COD Discrepancy (Maker-Checker HIGH tier)
  app.post('/admin/finance/cod/:id/resolve', {
    config: { page: '/admin/cod-reconciliation' },
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
    config: { page: '/admin/finance' },
    preHandler: [app.authenticate, app.requirePermission('finance.overview.view')],
    handler: controller.getFinanceOverview,
  });

  // 21. Profit Splits Governance
  app.get('/admin/finance/splits', {
    config: { page: '/admin/finance/splits' },
    preHandler: [app.authenticate, app.requirePermission('finance.split.view')],
    handler: controller.getProfitSplits,
  });

  // 22. Update Global Profit Split (CRITICAL tier)
  app.put('/admin/finance/splits/default', {
    config: { page: '/admin/finance/splits' },
    preHandler: [app.authenticate, app.requirePermission('finance.split.update')],
    handler: controller.updateGlobalSplit,
  });

  // 23. Update Category Split Override
  app.put('/admin/finance/splits/categories/:id', {
    config: { page: '/admin/finance/splits' },
    preHandler: [app.authenticate, app.requirePermission('finance.split.update')],
    handler: controller.updateCategorySplit,
  });

  // 24. Delete / Reset Category Split Override
  app.delete('/admin/finance/splits/categories/:id', {
    config: { page: '/admin/finance/splits' },
    preHandler: [app.authenticate, app.requirePermission('finance.split.update')],
    handler: controller.deleteCategorySplit,
  });

  // 25. Update Saler Trust Tier Split Bonuses
  app.put('/admin/finance/splits/tiers', {
    preHandler: [app.authenticate, app.requirePermission('finance.split.update')],
    handler: controller.updateTierBonuses,
  });

  // 26. Simulate Profit Split Calculation
  app.post('/admin/finance/splits/simulate', {
    preHandler: [app.authenticate, app.requirePermission('finance.split.view')],
    handler: controller.simulateSplit,
  });

  // 27. Merchant Subscriptions Overview & Subscriber Roster
  app.get('/admin/finance/subscriptions', {
    config: { page: '/admin/finance/subscriptions' },
    preHandler: [app.authenticate, app.requirePermission('finance.subscription.manage')],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'PAST_DUE', 'WAIVED'] },
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: controller.getSubscriptions,
  });

  // 28. Update Subscription Engine Settings
  app.put('/admin/finance/subscriptions/settings', {
    config: { page: '/admin/finance/subscriptions' },
    preHandler: [app.authenticate, app.requirePermission('finance.subscription.manage')],
    handler: controller.updateSubscriptionSettings,
  });

  // 29. Create Subscription Plan
  app.post('/admin/finance/subscriptions/plans', {
    config: { page: '/admin/finance/subscriptions' },
    preHandler: [app.authenticate, app.requirePermission('finance.subscription.manage')],
    handler: controller.createSubscriptionPlan,
  });

  // 30. Update Subscription Plan
  app.put('/admin/finance/subscriptions/plans/:id', {
    config: { page: '/admin/finance/subscriptions' },
    preHandler: [app.authenticate, app.requirePermission('finance.subscription.manage')],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^\\d+$' } } } },
    handler: controller.updateSubscriptionPlan,
  });

  // 31. Update Subscriber Status / Grant Fee Waiver
  app.patch('/admin/finance/subscriptions/subscribers/:id', {
    config: { page: '/admin/finance/subscriptions' },
    preHandler: [app.authenticate, app.requirePermission('finance.subscription.manage')],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^\\d+$' } } } },
    handler: controller.updateSubscriberStatus,
  });
}
