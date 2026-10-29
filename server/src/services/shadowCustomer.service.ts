/**
 * shadowCustomer.service.ts — Finds the customer account behind a phone number, creating a bare one
 * when nobody has signed up with it yet.
 *
 * Used where someone else brings a customer to the platform: a WhatsApp/Messenger message
 * (whatsappCommerce.service.ts) and a partner placing an order through the public API
 * (partnerOrder.service.ts). The account has no password; the customer claims it later by signing
 * up with the same phone, which is UNIQUE on users.
 */

import { generateRef } from '../lib/ref.ts';

/**
 * @param {*} db a pool or a transaction client
 * @param {{ phone: string, name: string }} input phone exactly as it is stored on users (E.164 for new callers)
 * @returns {Promise<{ id: number, created: boolean }>}
 */
export async function findOrCreateCustomerByPhone(db: any, { phone, name }: { phone: string; name: string }) {
  const { rows: existing } = await db.query(`SELECT id FROM users WHERE phone = $1 LIMIT 1`, [phone]);
  if (existing.length > 0) return { id: Number(existing[0].id), created: false };

  // WHY three statements: `users` holds neither the name nor the role. The display name lives
  // on `user_profiles` and the role is a row in `user_roles` -> `roles`, the same shape
  // auth.service.ts creates a signup with. `ref` is NOT NULL with no default, so it is minted
  // here rather than left to the database.
  // WHY ON CONFLICT: two requests for the same new phone can both miss the SELECT above; the loser
  // must reuse the winner's account, not fail on the UNIQUE phone.
  const { rows: created } = await db.query(
    `INSERT INTO users (ref, phone, status)
     VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (phone) DO NOTHING
     RETURNING id`,
    [generateRef('USR'), phone]
  );
  if (!created.length) {
    const { rows } = await db.query(`SELECT id FROM users WHERE phone = $1 LIMIT 1`, [phone]);
    return { id: Number(rows[0].id), created: false };
  }
  const userId = Number(created[0].id);

  await db.query(
    `INSERT INTO user_profiles (user_id, full_name, display_name)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, name]
  );

  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.key = 'customer'
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId]
  );

  return { id: userId, created: true };
}
