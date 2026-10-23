/**
 * walletTopup.controller.ts — vault top-ups (/wallet/topups).
 */

import * as walletTopup from '../services/walletTopup.service.ts';
import { safeInternalPath } from '../services/adDestination.service.ts';

const dbOf = (req) => req.db || req.server?.db;

export async function getOwnView(req, reply) {
  const data = await walletTopup.getOwnView(dbOf(req), req.user.id, { page: req.query?.page, limit: req.query?.limit });
  return reply.send({ data });
}

export async function initiate(req, reply) {
  const body = req.body || {};
  // WHY only a path on this site: the gateway sends the payer back to this URL, and an open redirect
  // to any host would make the top-up page a phishing relay.
  const path = safeInternalPath(body.returnUrl) || '/wallet/top-up';
  // WHY the configured web URL, not the Host header: behind the dev proxy (and any production proxy)
  // the request arrives addressed to the API, and the payer must come back to the web app.
  const origin = String(req.server?.config?.core?.publicWebUrl || process.env.PUBLIC_WEB_URL || '').replace(/\/+$/, '');
  const data = await walletTopup.initiateTopUp(dbOf(req), {
    userId: req.user.id,
    amount: body.amount,
    method: body.method,
    returnUrl: `${origin}${path}`,
    idempotencyKey: req.headers['idempotency-key'] || null,
    customer: { name: req.user.full_name || undefined, phone: req.user.phone || undefined },
  });
  return reply.code(201).send({ data });
}
