/**
 * journeys.ts — each role's ordered steps from first login to its first real success, as DATA
 * (docs/prompt.md Prompt 13.1). docs/journeys.md is the same map in prose, with the reasoning.
 *
 * The Next-Step engine (Prompt 13.2) reads this file and the server mirrors it; no page may hold its
 * own copy of "what comes next". A step is done when its `doneWhen` fact is true in the database,
 * never because the user ticked it, so progress cannot drift from reality.
 *
 * client/test/journeys.test.js fails if a step points at a route the router does not register or
 * the role cannot see, names a fact, block or skip rule that is not defined here, or uses an i18n
 * key missing from either locale.
 *
 * Field shape (Prompt 13.1 REQUIREMENT 2): { id, role, order, route, doneWhen, nextHint_key }, plus
 * `title_key` (the card's heading in 13.2), `blockedBy` (who the user waits on before this step can
 * be done) and `skipWhen` (the documented rules under which the step is left out).
 */

export const JOURNEY_ROLES = ['customer', 'saler', 'supplier', 'moderator', 'editor', 'admin', 'super_admin'] as const;
export type JourneyRole = (typeof JOURNEY_ROLES)[number];

/** Staff permissions are delegated person by person, so only these roles may use `not_delegated`. */
export const STAFF_ROLES: JourneyRole[] = ['moderator', 'editor', 'admin'];

/**
 * A fact is one yes/no question about real data. `user` facts are about the signed-in user; `platform`
 * facts are about the whole platform (a setting saved, a first category), so any admin completing
 * them completes them for every admin. `proof` is what the server's evaluator checks.
 */
export interface JourneyFact {
  scope: 'user' | 'platform';
  proof: string;
}

export const JOURNEY_FACTS: Record<string, JourneyFact> = {
  'user.phone_verified': { scope: 'user', proof: 'users.is_phone_verified is true' },
  'user.address_saved': { scope: 'user', proof: 'at least one user_addresses row' },
  'staff.two_factor_enrolled': { scope: 'user', proof: 'a staff_2fa row with enrolled_at set' },
  // WHY "or ordered": checkout empties the cart, and a done step must never become undone.
  'customer.cart_started': { scope: 'user', proof: 'a cart_items row in their cart, or any orders row as customer_id' },
  'customer.order_placed': { scope: 'user', proof: 'any orders row as customer_id' },
  'customer.order_delivered': { scope: 'user', proof: 'a sub_orders row with status DELIVERED on one of their orders' },
  'customer.review_written': { scope: 'user', proof: 'a reviews row as user_id, not deleted' },
  'kyc.submitted': { scope: 'user', proof: 'a kyc_verifications row as user_id, in any status' },
  'saler.store_named': { scope: 'user', proof: 'their virtual_stores row has both slug and shop_name' },
  'saler.three_products': { scope: 'user', proof: 'at least 3 active saler_store_items rows' },
  'saler.link_created': { scope: 'user', proof: 'at least one short_links row as saler_id' },
  'saler.order_received': { scope: 'user', proof: 'a sub_orders row as saler_id' },
  'wallet.payout_requested': { scope: 'user', proof: 'a payout_requests row as user_id' },
  'supplier.product_listed': { scope: 'user', proof: 'a products row as supplier_id, not ARCHIVED' },
  'supplier.product_live': { scope: 'user', proof: 'a products row as supplier_id with status ACTIVE and stock_qty > 0' },
  'supplier.order_received': { scope: 'user', proof: 'a sub_orders row as supplier_id' },
  'supplier.order_shipped': { scope: 'user', proof: 'a shipments row on one of their sub_orders' },
  'moderation.item_claimed': { scope: 'user', proof: 'a moderation_queue row with claimed_by or decided_by = the user' },
  'moderation.item_decided': { scope: 'user', proof: 'a moderation_queue row with decided_by = the user' },
  'moderation.dispute_decided': { scope: 'user', proof: "an audit_logs row by the user with action 'orders.dispute.arbitrate' or 'orders.dispute.arbitrate_proposed'" },
  // Moderators and admins decide returns through the same actions, so they share one fact.
  'staff.return_decided': { scope: 'user', proof: "an audit_logs row by the user with action 'returns.request.approve' or 'returns.request.reject'" },
  // WHY platform scope: banners and release notes carry no author column, so "this editor did it"
  // cannot be proven; "the platform has one" can. See docs/journeys.md §4 finding F3.
  'content.banner_live': { scope: 'platform', proof: 'a banners row with is_active true' },
  'content.story_published': { scope: 'user', proof: "a stories row as author_id with status 'PUBLISHED'" },
  'content.release_note_published': { scope: 'platform', proof: 'a release_notes row with published_at set' },
  'content.translation_saved': { scope: 'user', proof: "an audit_logs row by the user with action 'translation.upsert'" },
  'admin.kyc_reviewed': { scope: 'user', proof: 'a kyc_verifications row with reviewed_by = the user' },
  'admin.product_reviewed': { scope: 'user', proof: 'a moderation_queue row with item_type PRODUCT_NEW or PRODUCT_EDIT and decided_by = the user' },
  'admin.payout_reviewed': { scope: 'user', proof: "an audit_logs row by the user with action 'finance.payout.approve_request' or 'finance.payout.reject'" },
  // WHY an audit row and not the settings row: migrations seed defaults, so the row always exists;
  // an audit row proves someone actually chose the value.
  'platform.language_chosen': { scope: 'platform', proof: "an audit_logs row with action 'platform.localization.update'" },
  'platform.delivery_set': { scope: 'platform', proof: "an audit_logs row with action 'platform.delivery.update'" },
  'platform.operations_set': { scope: 'platform', proof: "an audit_logs row with action 'platform.operations.update'" },
  'platform.category_exists': { scope: 'platform', proof: 'at least one categories row' },
  'platform.staff_invited': { scope: 'platform', proof: "an audit_logs row with action 'staff.account.create'" },
  'platform.supplier_verified': { scope: 'platform', proof: "a kyc_verifications row with kyc_type SUPPLIER and status VERIFIED" },
  'platform.product_live': { scope: 'platform', proof: 'a products row with status ACTIVE' },
};

/** Who or what the user waits on. 13.2 reports these as `blocked_by`, never as a dead button. */
export const BLOCK_REASONS = {
  kyc_review: 'An admin must approve the KYC before this step can start.',
  product_review: 'A moderator must approve the product before it goes live.',
  waiting_for_buyer: 'Only a shopper can complete this; the user can promote meanwhile.',
  waiting_for_delivery: 'The supplier and courier must deliver first.',
  balance_empty: 'There is nothing to withdraw until money reaches the vault.',
  // Never written on a step: the engine reports it when the user lacks the step page's permission.
  no_permission: "The user's account cannot open this step's page yet.",
} as const;
export type BlockReason = keyof typeof BLOCK_REASONS;

/** The only reasons a step may be left out (Prompt 13.1 REQUIREMENT 3). */
export const SKIP_RULES = {
  module_off: "The step's page belongs to a module that is switched off.",
  not_delegated: "Staff only: the user was never given the permission the step's page needs.",
} as const;
export type SkipRule = keyof typeof SKIP_RULES;

export interface JourneyStep {
  id: string;
  role: JourneyRole;
  order: number;
  route: string;
  doneWhen: string;
  title_key: string;
  nextHint_key: string;
  blockedBy?: BlockReason[];
  skipWhen?: SkipRule[];
}

/**
 * Journey routes that are not sidebar items. Each is still a registered route (the test checks it);
 * these are reached from the topbar, the auth flow or a page link instead.
 */
export const NON_SIDEBAR_ROUTES: Record<string, string> = {
  '/': 'the marketplace home, reached from the logo',
  '/checkout': 'reached from the cart',
  '/auth/otp': 'the phone OTP screen of sign-up and login',
  '/auth/2fa': 'the staff 2FA screen; it enrols a staff member who has not set up 2FA yet',
  '/seller/kyc': 'KYC; today linked only from the profile page (docs/journeys.md §4 finding F1)',
};

function step(
  role: JourneyRole,
  order: number,
  id: string,
  route: string,
  doneWhen: string,
  extra: Pick<JourneyStep, 'blockedBy' | 'skipWhen'> = {}
): JourneyStep {
  const base = `journey.${role}.${id}`;
  return { id, role, order, route, doneWhen, title_key: `${base}.title`, nextHint_key: `${base}.next`, ...extra };
}

export const JOURNEYS: JourneyStep[] = [
  // Customer: first real success is a delivered order they have reviewed. No KYC: shoppers are never asked.
  step('customer', 1, 'verify_phone', '/auth/otp', 'user.phone_verified'),
  step('customer', 2, 'add_address', '/account/addresses', 'user.address_saved'),
  step('customer', 3, 'fill_cart', '/', 'customer.cart_started'),
  step('customer', 4, 'place_order', '/checkout', 'customer.order_placed'),
  step('customer', 5, 'receive_order', '/account/orders', 'customer.order_delivered', { blockedBy: ['waiting_for_delivery'] }),
  step('customer', 6, 'write_review', '/account/reviews', 'customer.review_written', { skipWhen: ['module_off'] }),

  // Shop Partner: first real success is the first withdrawal.
  step('saler', 1, 'verify_phone', '/auth/otp', 'user.phone_verified'),
  step('saler', 2, 'submit_kyc', '/seller/kyc', 'kyc.submitted', { skipWhen: ['module_off'] }),
  step('saler', 3, 'name_store', '/saler/store-builder', 'saler.store_named', { skipWhen: ['module_off'] }),
  step('saler', 4, 'add_products', '/saler/sourcing', 'saler.three_products', { skipWhen: ['module_off'] }),
  step('saler', 5, 'share_store', '/saler/social-kit', 'saler.link_created', { skipWhen: ['module_off'] }),
  step('saler', 6, 'first_order', '/saler/orders', 'saler.order_received', { blockedBy: ['waiting_for_buyer'] }),
  step('saler', 7, 'first_withdrawal', '/saler/vault/payouts', 'wallet.payout_requested', { blockedBy: ['balance_empty'] }),

  // Supplier: first real success is the first withdrawal of money from a shipped order.
  step('supplier', 1, 'verify_phone', '/auth/otp', 'user.phone_verified'),
  step('supplier', 2, 'submit_kyc', '/seller/kyc', 'kyc.submitted', { skipWhen: ['module_off'] }),
  // WHY kyc_review: product.service refuses a listing with KYC_REQUIRED until the KYC is VERIFIED.
  step('supplier', 3, 'add_product', '/supplier/products', 'supplier.product_listed', { blockedBy: ['kyc_review'] }),
  step('supplier', 4, 'stock_product', '/supplier/inventory', 'supplier.product_live', { blockedBy: ['product_review'] }),
  step('supplier', 5, 'first_order', '/supplier/orders', 'supplier.order_received', { blockedBy: ['waiting_for_buyer'] }),
  step('supplier', 6, 'ship_order', '/supplier/fulfilment', 'supplier.order_shipped', { skipWhen: ['module_off'] }),
  step('supplier', 7, 'first_withdrawal', '/supplier/vault', 'wallet.payout_requested', { blockedBy: ['balance_empty'] }),

  // Moderator: first real success is a decided queue item; disputes and returns follow if delegated.
  step('moderator', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled'),
  step('moderator', 2, 'claim_item', '/moderator/queue', 'moderation.item_claimed', { skipWhen: ['module_off', 'not_delegated'] }),
  step('moderator', 3, 'decide_item', '/moderator/queue', 'moderation.item_decided', { skipWhen: ['module_off', 'not_delegated'] }),
  step('moderator', 4, 'decide_dispute', '/moderator/disputes', 'moderation.dispute_decided', { skipWhen: ['module_off', 'not_delegated'] }),
  step('moderator', 5, 'decide_return', '/moderator/returns', 'staff.return_decided', { skipWhen: ['module_off', 'not_delegated'] }),

  // Editor: first real success is published content shoppers can see.
  step('editor', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled'),
  step('editor', 2, 'publish_banner', '/editor/banners', 'content.banner_live', { skipWhen: ['not_delegated'] }),
  step('editor', 3, 'publish_story', '/editor/stories', 'content.story_published', { skipWhen: ['module_off', 'not_delegated'] }),
  step('editor', 4, 'publish_whats_new', '/editor/whats-new', 'content.release_note_published', { skipWhen: ['module_off', 'not_delegated'] }),
  step('editor', 5, 'save_translation', '/editor/translations', 'content.translation_saved', { skipWhen: ['module_off', 'not_delegated'] }),

  // Admin: first real success is clearing the queues that hold sellers back.
  step('admin', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled'),
  step('admin', 2, 'review_kyc', '/admin/verification', 'admin.kyc_reviewed', { skipWhen: ['module_off', 'not_delegated'] }),
  step('admin', 3, 'review_product', '/admin/catalog/moderation', 'admin.product_reviewed', { skipWhen: ['module_off', 'not_delegated'] }),
  step('admin', 4, 'review_payout', '/admin/finance/payouts', 'admin.payout_reviewed', { skipWhen: ['not_delegated'] }),
  step('admin', 5, 'decide_return', '/admin/returns', 'staff.return_decided', { skipWhen: ['module_off', 'not_delegated'] }),

  // Super Admin: platform set-up, then the first verified supplier and the first live product.
  step('super_admin', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled'),
  step('super_admin', 2, 'choose_language', '/admin/platform/language', 'platform.language_chosen'),
  step('super_admin', 3, 'set_delivery', '/admin/platform/delivery', 'platform.delivery_set'),
  step('super_admin', 4, 'set_operations', '/admin/platform/operations', 'platform.operations_set'),
  step('super_admin', 5, 'add_category', '/admin/catalog/categories', 'platform.category_exists'),
  step('super_admin', 6, 'invite_staff', '/admin/staff', 'platform.staff_invited'),
  step('super_admin', 7, 'verify_supplier', '/admin/verification', 'platform.supplier_verified', { skipWhen: ['module_off'] }),
  step('super_admin', 8, 'first_product_live', '/admin/catalog/moderation', 'platform.product_live', { skipWhen: ['module_off'] }),
];

/** One role's steps in order. */
export function journeyFor(role: JourneyRole): JourneyStep[] {
  return JOURNEYS.filter((s) => s.role === role).sort((a, b) => a.order - b.order);
}

/**
 * Today's dead ends (Prompt 13.1 REQUIREMENT 4): actions that finish on a bare toast or a plain list
 * with no suggested action. Prompt 13.3 must clear each one; until a journey step says otherwise its
 * result panel offers `followUp`. `where` is the file that ends the action today. `role` is the role
 * the user holds once the action is done (becoming a Shop Partner starts as a customer).
 */
export interface DeadEnd {
  id: string;
  role: JourneyRole;
  action: string;
  where: string;
  today: string;
  followUp: string;
  hint_key: string;
}

function deadEnd(id: string, role: JourneyRole, action: string, where: string, today: string, followUp: string): DeadEnd {
  return { id, role, action, where, today, followUp, hint_key: `journey.dead_end.${id}` };
}

export const DEAD_ENDS: DeadEnd[] = [
  deadEnd('checkout', 'customer', 'order placed', 'pages/CheckoutPage.ts', 'toast, then the order page with no word on what happens next', '/account/orders'),
  deadEnd('address_saved', 'customer', 'address saved', 'pages/customer/AddressesPage.ts', 'toast; stays on the address list', '/'),
  deadEnd('become_saler', 'saler', 'became a Shop Partner', 'pages/customer/BecomeSalerPage.ts', 'toast "your digital store is active"; stays on the upgrade page', '/saler/store-builder'),
  deadEnd('kyc_saler', 'saler', 'KYC submitted', 'pages/seller/KycSubmissionPage.ts', 'toast; stays on the KYC form', '/saler/store-builder'),
  deadEnd('kyc_supplier', 'supplier', 'KYC submitted', 'pages/seller/KycSubmissionPage.ts', 'toast; stays on the KYC form with no word that listing waits on approval', '/supplier/store-status'),
  deadEnd('product_added_saler', 'saler', 'product added to store', 'components/saler/AddToStoreDrawer.ts', 'toast; the drawer closes on the sourcing list', '/saler/social-kit'),
  deadEnd('product_added_supplier', 'supplier', 'product added', 'pages/admin/CatalogProductsPage.ts', 'toast "Product registered in catalog!"; no word that it waits on review', '/supplier/inventory'),
  deadEnd('withdrawal_requested', 'saler', 'withdrawal requested', 'pages/saler/WithdrawalsPage.ts', 'toast; stays on the withdrawal form', '/saler/vault'),
  deadEnd('order_shipped', 'supplier', 'order shipped', 'pages/supplier/FulfilmentPage.ts', 'toast "consignment booked"; stays on the fulfilment list', '/supplier/shipments'),
];
