/**
 * writeOutcome.js — what the reply to an admin write means.
 *
 * core/api.js resolves a 202 "deferred" reply as `{ deferred }` instead of throwing. That is not an
 * error, but it is not a change either: requirePermission parks a delegated Admin's HIGH-tier request
 * (resetting someone's 2FA, say) in pending_admin_actions for a Super Admin to approve, and nothing
 * has happened yet. A page that toasts "done" and reloads for that reply tells the admin something
 * false that they will act on — so every admin write should read its reply through this.
 *
 *   const outcome = describeWriteOutcome(await api.post(...), { bn, fallback, deferredFallback });
 *   if (outcome.deferred) toast.info(outcome.message); else toast.success(outcome.message);
 *
 * Kept free of DOM and CSS imports so it runs under `node --test`.
 */

export function describeWriteOutcome(res, { bn = false, fallback = '', deferredFallback = '' } = {}) {
  if (res?.deferred) {
    const d = res.deferred;
    return { deferred: true, message: (bn ? d.message_bn : d.message_en) || deferredFallback };
  }
  return { deferred: false, message: (bn ? res?.message_bn : res?.message_en) || fallback };
}
