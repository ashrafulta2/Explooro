/**
 * Mock handlers for product Q&A (Prompt 4.6). Same mutable-copy-of-fixture contract as reviews.js.
 */
import seedQuestions from '../fixtures/questions.json';
import { appStore } from '../../state/appStore.js';

let questions = seedQuestions.map((q) => ({ ...q, answers: q.answers.map((a) => ({ ...a })) }));
let nextQuestionId = Math.max(...questions.map((q) => q.id)) + 1;
let nextAnswerId = Math.max(...questions.flatMap((q) => q.answers.map((a) => a.id)), 0) + 1;

function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

export default [
  {
    method: 'GET',
    path: '/products/:productId/questions',
    handler({ params, query }) {
      const list = questions
        .filter((q) => q.product_ref === params.productId)
        .sort((a, b) => b.upvote_count - a.upvote_count || new Date(b.created_at) - new Date(a.created_at));

      const page = Number(query.page) || 1;
      const pageSize = Math.min(Number(query.page_size) || 10, 50);
      const start = (page - 1) * pageSize;
      const pageItems = list.slice(start, start + pageSize);

      return {
        status: 200,
        body: {
          data: { questions: pageItems },
          meta: {
            pagination: {
              page,
              page_size: pageSize,
              total_count: list.length,
              total_pages: Math.max(1, Math.ceil(list.length / pageSize)),
            },
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/products/:productId/questions',
    handler({ params, body }) {
      const auth = appStore.get().auth || {};
      if (!auth.isAuthenticated) {
        return { status: 401, body: { error: { code: 'AUTH_REQUIRED', message_en: 'Sign in required.', message_bn: 'সাইন ইন করা প্রয়োজন।', trace_id: traceId() } } };
      }
      const text = (body?.body || '').trim();
      if (!text) {
        return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en: 'Question cannot be empty.', message_bn: 'প্রশ্ন খালি রাখা যাবে না।', trace_id: traceId() } } };
      }
      const question = {
        id: nextQuestionId++,
        product_ref: params.productId,
        body: text,
        asker_name: 'Dev Customer',
        upvote_count: 0,
        created_at: new Date().toISOString(),
        answers: [],
      };
      questions = [question, ...questions];
      return { status: 201, body: { data: { question } } };
    },
  },
  {
    method: 'POST',
    path: '/questions/:questionId/answers',
    handler({ params, body }) {
      const auth = appStore.get().auth || {};
      const role = auth.role;
      if (role !== 'saler' && role !== 'supplier') {
        return {
          status: 403,
          body: {
            error: {
              code: 'FORBIDDEN',
              message_en: 'Only a seller or supplier can answer a product question.',
              message_bn: 'শুধুমাত্র সেলার বা সরবরাহকারী পণ্যের প্রশ্নের উত্তর দিতে পারবেন।',
              trace_id: traceId(),
            },
          },
        };
      }
      const question = questions.find((q) => String(q.id) === params.questionId);
      if (!question) {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Question not found.', message_bn: 'প্রশ্ন পাওয়া যায়নি।', trace_id: traceId() } } };
      }
      const text = (body?.body || '').trim();
      if (!text) {
        return { status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en: 'Answer cannot be empty.', message_bn: 'উত্তর খালি রাখা যাবে না।', trace_id: traceId() } } };
      }
      const answer = {
        id: nextAnswerId++,
        body: text,
        responder_name: role === 'saler' ? 'Dhaka Fashion House' : 'Verified Supplier',
        created_at: new Date().toISOString(),
      };
      question.answers = [...question.answers, answer];
      return { status: 201, body: { data: { answer } } };
    },
  },
  {
    method: 'POST',
    path: '/questions/:questionId/upvote',
    handler({ params }) {
      const question = questions.find((q) => String(q.id) === params.questionId);
      if (!question) {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: 'Question not found.', message_bn: 'প্রশ্ন পাওয়া যায়নি।', trace_id: traceId() } } };
      }
      question.upvote_count += 1;
      return { status: 200, body: { data: { id: question.id, upvote_count: question.upvote_count } } };
    },
  },
];
