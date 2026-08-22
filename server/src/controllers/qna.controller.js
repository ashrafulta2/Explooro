/**
 * qna.controller.js — Handlers for product Q&A endpoints (Prompt 4.6).
 */

import * as qnaService from '../services/qna.service.js';
import * as productRepo from '../repositories/product.repository.js';
import { AppError } from '../plugins/errorHandler.js';

async function resolveProduct(db, idOrRef) {
  const product = /^\d+$/.test(idOrRef)
    ? await productRepo.getProductById(db, parseInt(idOrRef, 10))
    : await productRepo.getProductByRef(db, idOrRef);
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }
  return product;
}

export async function listQuestions(req, reply) {
  const db = req.db || req.server?.db;
  const product = await resolveProduct(db, req.params.productId);
  const { page, page_size } = req.query || {};

  const result = await qnaService.listQuestions(db, product.id, {
    page: page ? parseInt(page, 10) : 1,
    pageSize: page_size ? parseInt(page_size, 10) : 10,
  });

  return reply.send({ data: { questions: result.questions }, meta: { pagination: result.pagination } });
}

export async function askQuestion(req, reply) {
  const db = req.db || req.server?.db;
  const product = await resolveProduct(db, req.params.productId);

  const question = await qnaService.askQuestion(db, {
    productId: product.id,
    userId: req.user.id,
    body: req.body?.body,
  });

  return reply.status(201).send({ data: { question } });
}

export async function answerQuestion(req, reply) {
  const db = req.db || req.server?.db;
  const { questionId } = req.params;
  const roles = req.user?.roles || [];
  const isSellerOrSupplier = roles.includes('saler') || roles.includes('supplier');

  const answer = await qnaService.answerQuestion(db, {
    questionId: parseInt(questionId, 10),
    responderId: req.user.id,
    body: req.body?.body,
    isSellerOrSupplier,
  });

  return reply.status(201).send({ data: { answer } });
}

export async function upvoteQuestion(req, reply) {
  const db = req.db || req.server?.db;
  const { questionId } = req.params;
  const updated = await qnaService.upvoteQuestion(db, parseInt(questionId, 10), req.user.id);
  return reply.send({ data: updated });
}
