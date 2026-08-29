/**
 * customerAddress.controller.js — Fastify controller for Customer Address Book CRUD endpoints.
 */

import * as addressService from '../services/customerAddress.service.js';

export async function getAddresses(req, reply) {
  const userId = req.user?.id;
  const data = await addressService.getCustomerAddresses(req.server.db, userId);
  return reply.send({ success: true, data });
}

export async function createAddress(req, reply) {
  const userId = req.user?.id;
  const data = await addressService.createCustomerAddress(req.server.db, userId, req.body || {});
  return reply.status(201).send({ success: true, data });
}

export async function updateAddress(req, reply) {
  const userId = req.user?.id;
  const { id } = req.params;
  const data = await addressService.updateCustomerAddress(req.server.db, userId, id, req.body || {});
  return reply.send({ success: true, data });
}

export async function deleteAddress(req, reply) {
  const userId = req.user?.id;
  const { id } = req.params;
  const data = await addressService.deleteCustomerAddress(req.server.db, userId, id);
  return reply.send({ success: true, data });
}

export async function setDefaultAddress(req, reply) {
  const userId = req.user?.id;
  const { id } = req.params;
  const data = await addressService.setDefaultCustomerAddress(req.server.db, userId, id);
  return reply.send({ success: true, data });
}
