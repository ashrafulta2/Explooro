/**
 * walletTopup.routes.ts — adding money to one's own vault (migration 088, walletTopup.service.ts).
 *
 *   GET  /wallet/topups   finance.wallet.topup   balance, limits and own recent top-ups (paginated)
 *   POST /wallet/topups   finance.wallet.topup   open a top-up; answers where to pay
 *
 * Completing the payment needs no route of its own: the client calls the existing authenticated
 * POST /payments/execute (mock and redirect-less drivers), and live gateways confirm through the
 * existing signed webhook or callback. All of them end in payment.service.executePayment, which
 * credits the vault for a TOPUP transaction.
 *
 * WHY requireRestriction('can_place_order'): a top-up is money coming in from a card or wallet, the
 * same exposure as paying for an order, so an account stopped from ordering is stopped here too.
 * WHY no module: the vault is core; it works with every module off.
 */

import * as controller from '../controllers/walletTopup.controller.ts';
import { requireRestriction } from '../middlewares/requireRestriction.ts';

export default async function walletTopupRoutes(app) {
  const guard = [app.authenticate, app.requirePermission('finance.wallet.topup')];

  app.get('/wallet/topups', { preHandler: guard }, controller.getOwnView);

  app.post(
    '/wallet/topups',
    {
      preHandler: [...guard, requireRestriction('can_place_order')],
      schema: {
        body: {
          type: 'object',
          required: ['amount', 'method'],
          additionalProperties: false,
          properties: {
            // Types only: the bounds are the `wallet.topup` setting (walletTopup.service.ts).
            amount: { type: ['number', 'string'] },
            method: { type: 'string' },
            returnUrl: { type: ['string', 'null'] },
          },
        },
      },
    },
    controller.initiate
  );
}
