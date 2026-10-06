/**
 * subscription.routes.js — a merchant's own Saler Pro subscription.
 *
 * Every route is behind the `subscription_fees` module, so with the admin's switch OFF these answer
 * 403 MODULE_DISABLED and the UI hides the page. The admin-side routes stay in finance.routes.js
 * under finance.subscription.manage.
 */

import * as subscriptionSelf from '../controllers/subscriptionSelf.controller.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function subscriptionRoutes(app) {
  const ownSubscription = [
    app.authenticate,
    app.requireModule('subscription_fees'),
    app.requirePermission('finance.subscription.subscribe_own'),
    // WHY can_sell: the restriction catalog has no subscription capability, and a merchant barred from
    // selling has no use for a seller plan. Inventing a key would need editor UI + locale strings.
    requireRestriction('can_sell'),
  ];

  app.get('/subscriptions/me', { preHandler: ownSubscription, handler: subscriptionSelf.getMine });

  app.post('/subscriptions/subscribe', {
    preHandler: ownSubscription,
    schema: {
      body: {
        type: 'object',
        required: ['plan_id'],
        additionalProperties: false,
        properties: {
          plan_id: { type: 'integer', minimum: 1 },
          auto_renew: { type: 'boolean' },
        },
      },
    },
    handler: subscriptionSelf.subscribe,
  });

  app.post('/subscriptions/cancel', { preHandler: ownSubscription, handler: subscriptionSelf.cancel });
  app.post('/subscriptions/resume', { preHandler: ownSubscription, handler: subscriptionSelf.resume });
}
