/**
 * paymentMethods.service.ts — which ways to pay a shopper is offered right now.
 *
 * Two switches decide, and both must say yes:
 *   1. PAYMENT_DRIVER (integrations/payments onlineMethodsForDriver): can this deployment take money
 *      online at all, and through which gateways. `none` at launch.
 *   2. The payment modules at /admin/platform/modules: `mfs_payment` (with its bkash_enabled /
 *      nagad_enabled / rocket_enabled settings), `card_payment` and `cod_payment`.
 *
 * WHY this file: the checkout page used to hide a method by feature flags named `bkash`, `nagad`,
 * `rocket`, `cards` and `cod`, none of which is a module key, so they always read "on"; and the
 * server never looked at the modules at all. Switching bKash off in Module Control changed nothing.
 * Checkout, top-up and GET /payments/methods all ask here now.
 *
 * The vault (WALLET) is not a gateway and has no module; it is always offered to a signed-in
 * shopper whose balance covers the order (vaultCheckout.service).
 */

import { onlineMethodsForDriver, ONLINE_METHODS } from '../integrations/payments/index.ts';
import { isEnabled } from './module.service.ts';
import * as moduleRepo from '../repositories/module.repository.ts';

/** The MFS module's own switches, with the defaults its settings schema declares. */
const MFS_SETTING = Object.freeze({ BKASH: ['bkash_enabled', true], NAGAD: ['nagad_enabled', true], ROCKET: ['rocket_enabled', false] });

export interface PaymentAvailability {
  online_methods: string[];
  cod: boolean;
}

async function safeEnabled(db, cache, key, context) {
  try {
    return await isEnabled(db, cache, key, context);
  } catch {
    // WHY fail closed for online methods only: see availableMethods.
    return null;
  }
}

/**
 * The methods offered to this shopper. `context` is the module targeting context (userId, role,
 * district), so a module switched on only for some districts or users is respected.
 */
export async function availableMethods(db, cache = null, context: Record<string, any> = {}): Promise<PaymentAvailability> {
  const driverMethods = onlineMethodsForDriver();
  const [mfsOn, cardOn, codOn, mfsRow] = await Promise.all([
    driverMethods.length ? safeEnabled(db, cache, 'mfs_payment', context) : false,
    driverMethods.includes('CARD') ? safeEnabled(db, cache, 'card_payment', context) : false,
    safeEnabled(db, cache, 'cod_payment', context),
    driverMethods.length ? moduleRepo.getModuleByKey(db, 'mfs_payment').catch(() => null) : null,
  ]);
  const mfsSettings = mfsRow?.settings_json && typeof mfsRow.settings_json === 'object' ? mfsRow.settings_json : {};

  const online = ONLINE_METHODS.filter((m) => {
    if (!driverMethods.includes(m)) return false;
    if (m === 'CARD') return cardOn === true;
    const [field, fallback] = MFS_SETTING[m];
    return mfsOn === true && (typeof mfsSettings[field] === 'boolean' ? mfsSettings[field] : fallback);
  });

  // WHY COD fails open and online methods fail closed: an unreadable module table must not stop
  // every order (COD is how the platform launches), while offering a gateway the admin switched off
  // could take money through a channel nobody is watching.
  return { online_methods: online, cod: codOn !== false };
}

/** True if the shopper may pay this way now. WALLET is decided by vaultCheckout.service. */
export function isMethodAvailable(method: string, availability: PaymentAvailability): boolean {
  const m = String(method || '').toUpperCase();
  if (m === 'WALLET') return true;
  if (m === 'COD') return availability.cod;
  return availability.online_methods.includes(m);
}
