/**
 * qna.routes.js — Routes for product Q&A (Prompt 4.6).
 */

import * as qnaController from '../controllers/qna.controller.js';

export default async function qnaRoutes(app) {
  app.get('/products/:productId/questions', qnaController.listQuestions);

  app.post(
    '/products/:productId/questions',
    { preHandler: [app.authenticate] },
    qnaController.askQuestion
  );

  app.post(
    '/questions/:questionId/answers',
    { preHandler: [app.authenticate] },
    qnaController.answerQuestion
  );

  app.post(
    '/questions/:questionId/upvote',
    { preHandler: [app.authenticate] },
    qnaController.upvoteQuestion
  );
}
