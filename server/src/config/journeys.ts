/**
 * journeys.ts — the server's copy of each role's journey (Prompt 13.1/13.2), read by
 * services/nextStep.service.ts.
 *
 * The client keeps the same steps in client/src/config/journeys.ts with their strings; this copy
 * adds what only the server needs: the permission and module of each step's page, taken from
 * client/src/config/navigation.ts (or the router, for the few non-sidebar pages).
 * server/test/nextStep.test.js fails if the two copies, or the permission/module, ever disagree.
 *
 * WHY a copy and not an import: the server runs and deploys without the client workspace.
 */

export interface ServerJourneyStep {
  role: string;
  id: string;
  order: number;
  route: string;
  fact: string;
  permission: string | null;
  module: string;
  blockedBy: string[];
  skipWhen: string[];
}

export const STAFF_ROLES = ['moderator', 'editor', 'admin'];

function s(
  role: string,
  order: number,
  id: string,
  route: string,
  fact: string,
  permission: string | null,
  module: string,
  { blockedBy = [], skipWhen = [] }: { blockedBy?: string[]; skipWhen?: string[] } = {}
): ServerJourneyStep {
  return { role, id, order, route, fact, permission, module, blockedBy, skipWhen };
}

const OFF = { skipWhen: ['module_off'] };
const STAFF_OFF = { skipWhen: ['module_off', 'not_delegated'] };

export const JOURNEYS: ServerJourneyStep[] = [
  s('customer', 1, 'verify_phone', '/auth/otp', 'user.phone_verified', null, 'core'),
  s('customer', 2, 'add_address', '/account/addresses', 'user.address_saved', null, 'core'),
  s('customer', 3, 'fill_cart', '/', 'customer.cart_started', null, 'core'),
  s('customer', 4, 'place_order', '/checkout', 'customer.order_placed', null, 'core'),
  s('customer', 5, 'receive_order', '/account/orders', 'customer.order_delivered', null, 'core', { blockedBy: ['waiting_for_delivery'] }),
  s('customer', 6, 'write_review', '/account/reviews', 'customer.review_written', null, 'ugc_video_wall', OFF),

  s('saler', 1, 'verify_phone', '/auth/otp', 'user.phone_verified', null, 'core'),
  s('saler', 2, 'submit_kyc', '/seller/kyc', 'kyc.submitted', null, 'supplier_verification', OFF),
  s('saler', 3, 'name_store', '/saler/store-builder', 'saler.store_named', 'saler.store.manage', 'virtual_storefront', OFF),
  s('saler', 4, 'add_products', '/saler/sourcing', 'saler.three_products', 'saler.sourcing.view', 'sourcing', OFF),
  s('saler', 5, 'share_store', '/saler/social-kit', 'saler.link_created', null, 'social_seller_kit', OFF),
  s('saler', 6, 'first_order', '/saler/orders', 'saler.order_received', 'saler.order.view', 'core', { blockedBy: ['waiting_for_buyer'] }),
  s('saler', 7, 'first_withdrawal', '/saler/vault/payouts', 'wallet.payout_requested', 'finance.payout.request', 'core', { blockedBy: ['balance_empty'] }),

  s('supplier', 1, 'verify_phone', '/auth/otp', 'user.phone_verified', null, 'core'),
  s('supplier', 2, 'submit_kyc', '/seller/kyc', 'kyc.submitted', null, 'supplier_verification', OFF),
  s('supplier', 3, 'add_product', '/supplier/products', 'supplier.product_listed', 'catalog.product.manage_own', 'core', { blockedBy: ['kyc_review'] }),
  s('supplier', 4, 'stock_product', '/supplier/inventory', 'supplier.product_live', 'catalog.inventory.manage', 'core', { blockedBy: ['product_review'] }),
  s('supplier', 5, 'first_order', '/supplier/orders', 'supplier.order_received', 'supplier.order.view', 'core', { blockedBy: ['waiting_for_buyer'] }),
  s('supplier', 6, 'ship_order', '/supplier/fulfilment', 'supplier.order_shipped', 'logistics.consignment.create', 'courier_hub', OFF),
  s('supplier', 7, 'first_withdrawal', '/supplier/vault', 'wallet.payout_requested', 'finance.wallet.view_own', 'core', { blockedBy: ['balance_empty'] }),

  s('moderator', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled', null, 'core'),
  s('moderator', 2, 'claim_item', '/moderator/queue', 'moderation.item_claimed', 'moderation.product.approve', 'product_moderation', STAFF_OFF),
  s('moderator', 3, 'decide_item', '/moderator/queue', 'moderation.item_decided', 'moderation.product.approve', 'product_moderation', STAFF_OFF),
  s('moderator', 4, 'decide_dispute', '/moderator/disputes', 'moderation.dispute_decided', 'orders.dispute.arbitrate', 'dispute_panel', STAFF_OFF),
  s('moderator', 5, 'decide_return', '/moderator/returns', 'staff.return_decided', 'orders.return.review', 'returns_engine', STAFF_OFF),

  s('editor', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled', null, 'core'),
  s('editor', 2, 'publish_banner', '/editor/banners', 'content.banner_live', 'content.banner.publish', 'core', { skipWhen: ['not_delegated'] }),
  s('editor', 3, 'publish_story', '/editor/stories', 'content.story_published', 'content.story.curate', 'content_commerce', STAFF_OFF),
  s('editor', 4, 'publish_whats_new', '/editor/whats-new', 'content.release_note_published', 'content.announcement.publish', 'whats_new', STAFF_OFF),
  s('editor', 5, 'save_translation', '/editor/translations', 'content.translation_saved', 'content.i18n.update', 'i18n', STAFF_OFF),

  s('admin', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled', null, 'core'),
  s('admin', 2, 'review_kyc', '/admin/verification', 'admin.kyc_reviewed', 'users.kyc.approve', 'supplier_verification', STAFF_OFF),
  s('admin', 3, 'review_product', '/admin/catalog/moderation', 'admin.product_reviewed', 'moderation.product.approve', 'product_moderation', STAFF_OFF),
  s('admin', 4, 'review_payout', '/admin/finance/payouts', 'admin.payout_reviewed', 'finance.payout.approve', 'core', { skipWhen: ['not_delegated'] }),
  s('admin', 5, 'decide_return', '/admin/returns', 'staff.return_decided', 'orders.return.view_all', 'returns_engine', STAFF_OFF),

  s('super_admin', 1, 'enable_2fa', '/auth/2fa', 'staff.two_factor_enrolled', null, 'core'),
  s('super_admin', 2, 'choose_language', '/admin/platform/language', 'platform.language_chosen', 'platform.localization.view', 'core'),
  s('super_admin', 3, 'set_delivery', '/admin/platform/delivery', 'platform.delivery_set', 'platform.delivery.view', 'core'),
  s('super_admin', 4, 'set_operations', '/admin/platform/operations', 'platform.operations_set', 'platform.operations.view', 'core'),
  s('super_admin', 5, 'add_category', '/admin/catalog/categories', 'platform.category_exists', 'catalog.category.manage', 'core'),
  s('super_admin', 6, 'invite_staff', '/admin/staff', 'platform.staff_invited', 'staff.account.view', 'core'),
  s('super_admin', 7, 'verify_supplier', '/admin/verification', 'platform.supplier_verified', 'users.kyc.approve', 'supplier_verification', OFF),
  s('super_admin', 8, 'first_product_live', '/admin/catalog/moderation', 'platform.product_live', 'moderation.product.approve', 'product_moderation', OFF),
];

export function journeyFor(role: string): ServerJourneyStep[] {
  return JOURNEYS.filter((step) => step.role === role).sort((a, b) => a.order - b.order);
}
