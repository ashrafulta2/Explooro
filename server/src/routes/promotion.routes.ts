/**
 * promotion.routes.ts — Fastify routes for Coupons & Flash Sales Promotion Engine (Prompt 9.2).
 */

import * as promotionController from '../controllers/promotion.controller.ts';

export default async function promotionRoutes(app) {
  const requireCouponsModule = app.requireModule('coupons');
  const requireFlashSaleModule = app.requireModule('flash_sale');

  const requireCreateCoupon = app.requirePermission('growth.coupon.create_own');
  const requireManageCoupons = app.requirePermission('growth.coupon.manage');
  const requireManageCampaigns = app.requirePermission('growth.campaign.manage');
  const requireEmergencyStop = app.requirePermission('growth.campaign.emergency_stop');

  // 1. Customer & Public Promotion Endpoints
  app.post('/promotions/coupons/validate', {
    preHandler: [requireCouponsModule],
  }, promotionController.validateCoupon);

  app.get('/promotions/flash-sales', {
    preHandler: [requireFlashSaleModule],
  }, promotionController.getActiveFlashSales);

  // 2. Creator Coupon Management (Shop Partner / Supplier)
  app.post('/promotions/coupons', {
    preHandler: [app.authenticate, requireCouponsModule, requireCreateCoupon],
  }, promotionController.createCoupon);

  app.get('/promotions/coupons', {
    preHandler: [app.authenticate, requireCouponsModule],
  }, promotionController.listCoupons);

  // 3. Admin Governance & Campaign Oversight
  app.get('/admin/growth/coupons', {
    preHandler: [app.authenticate, requireCouponsModule, requireManageCoupons],
  }, promotionController.adminListCoupons);

  app.post('/admin/growth/coupons', {
    preHandler: [app.authenticate, requireCouponsModule, requireManageCoupons],
  }, promotionController.createCoupon);

  app.post('/admin/growth/coupons/:id/toggle', {
    preHandler: [app.authenticate, requireCouponsModule, requireManageCoupons],
  }, promotionController.toggleCouponActive);

  app.get('/admin/growth/campaigns/flash-sales', {
    preHandler: [app.authenticate, requireFlashSaleModule, requireManageCampaigns],
  }, promotionController.listAllFlashSales);

  // Supplier price, retail and partner profit of one product, so the form warns about a deal price
  // before it is saved. Same guard as creating the sale.
  app.get('/admin/growth/campaigns/flash-sales/price-context', {
    preHandler: [app.authenticate, requireFlashSaleModule, requireManageCampaigns],
  }, promotionController.getFlashSalePriceContext);

  app.post('/admin/growth/campaigns/flash-sales', {
    preHandler: [app.authenticate, requireFlashSaleModule, requireManageCampaigns],
  }, promotionController.createFlashSale);

  app.post('/admin/growth/campaigns/flash-sales/:id/emergency-stop', {
    preHandler: [app.authenticate, requireFlashSaleModule, requireEmergencyStop],
  }, promotionController.emergencyStopFlashSale);
}
