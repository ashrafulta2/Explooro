/**
 * qna.service.js — Product Q&A: ask, answer (seller/supplier only), upvote (Prompt 4.6).
 */

import * as qnaRepo from '../repositories/qna.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export async function askQuestion(db, { productId, userId, body }) {
  const trimmed = (body || '').trim();
  if (!trimmed) {
    throw new AppError('VALIDATION_FAILED', 'Question cannot be empty.', 'প্রশ্ন খালি রাখা যাবে না।');
  }
  return qnaRepo.insertQuestion(db, { productId, userId, body: trimmed });
}

/** `isSellerOrSupplier` is resolved by the controller from `req.user.roles` — kept out of this
 * function's own DB access so the rule reads in one place instead of re-querying roles here. */
export async function answerQuestion(db, { questionId, responderId, body, isSellerOrSupplier }) {
  if (!isSellerOrSupplier) {
    throw new AppError(
      'FORBIDDEN',
      'Only a seller or supplier can answer a product question.',
      'শুধুমাত্র সেলার বা সরবরাহকারী পণ্যের প্রশ্নের উত্তর দিতে পারবেন।'
    );
  }

  const trimmed = (body || '').trim();
  if (!trimmed) {
    throw new AppError('VALIDATION_FAILED', 'Answer cannot be empty.', 'উত্তর খালি রাখা যাবে না।');
  }

  const question = await qnaRepo.getQuestionById(db, questionId);
  if (!question) {
    throw new AppError('NOT_FOUND', 'Question not found.', 'প্রশ্ন পাওয়া যায়নি।');
  }

  return qnaRepo.insertAnswer(db, { questionId, responderId, body: trimmed });
}

export async function upvoteQuestion(db, questionId, userId) {
  const updated = await qnaRepo.upvoteQuestion(db, questionId, userId);
  if (!updated) {
    throw new AppError(
      'VALIDATION_FAILED',
      'You have already upvoted this question.',
      'আপনি ইতিমধ্যে এই প্রশ্নে ভোট দিয়েছেন।'
    );
  }
  return updated;
}

export async function listQuestions(db, productId, { page = 1, pageSize = 10 } = {}) {
  const limit = Math.min(Number(pageSize) || 10, 50);
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

  const [questions, totalCount] = await Promise.all([
    qnaRepo.listQuestionsByProduct(db, productId, { limit, offset }),
    qnaRepo.countQuestionsByProduct(db, productId),
  ]);

  return {
    questions,
    pagination: {
      page: Number(page) || 1,
      page_size: limit,
      total_count: totalCount,
      total_pages: Math.max(1, Math.ceil(totalCount / limit)),
    },
  };
}
