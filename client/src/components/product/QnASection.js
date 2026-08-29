/**
 * QnASection — ask, answer (seller/supplier only), upvote (Prompt 4.6).
 *
 * Returns `{ el, cleanup }` — same async component contract as ReviewList.js.
 */
import { t } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';
import { Button } from '../ui/Button.js';
import { Textarea } from '../ui/Textarea.js';
import { Skeleton } from '../ui/Skeleton.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Pagination } from '../ui/Pagination.js';
import { toast } from '../../services/toast.js';
import { appStore } from '../../state/appStore.js';
import * as catalogApi from '../../services/catalog.api.js';

function answerBlock(answer, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'qna-answer';
  const meta = document.createElement('p');
  meta.className = 'qna-answer__meta';
  meta.textContent = t('product_detail.qna.answered_by', {
    name: answer.responder_name || t('product_detail.qna.seller_fallback'),
  });
  const date = document.createElement('span');
  date.className = 'qna-answer__date';
  date.textContent = formatRelativeTime(answer.created_at, { lang });
  meta.append(document.createTextNode(' · '), date);
  const body = document.createElement('p');
  body.className = 'qna-answer__body';
  body.textContent = answer.body;
  wrap.append(meta, body);
  return wrap;
}

function questionCard(question, lang, { onUpvote, canAnswer, onAnswer }) {
  const card = document.createElement('article');
  card.className = 'qna-question';

  const header = document.createElement('div');
  header.className = 'qna-question__header';
  const asker = document.createElement('span');
  asker.className = 'qna-question__asker';
  asker.textContent = question.asker_name || t('product_detail.review.anonymous');
  const date = document.createElement('span');
  date.className = 'qna-question__date';
  date.textContent = formatRelativeTime(question.created_at, { lang });
  header.append(asker, date);
  card.append(header);

  const body = document.createElement('p');
  body.className = 'qna-question__body';
  body.textContent = question.body;
  card.append(body);

  const footer = document.createElement('div');
  footer.className = 'qna-question__footer';
  const upvoteBtn = Button({
    label: t('product_detail.qna.upvote_count', { count: question.upvote_count }),
    variant: 'ghost',
    size: 'sm',
    onClick: () => onUpvote(question),
  });
  footer.append(upvoteBtn);
  card.append(footer);

  for (const answer of question.answers || []) card.append(answerBlock(answer, lang));

  if (canAnswer) {
    const answerToggle = Button({ label: t('product_detail.qna.answer_cta'), variant: 'secondary', size: 'sm' });
    const answerForm = document.createElement('form');
    answerForm.className = 'qna-answer-form';
    answerForm.hidden = true;
    const textField = Textarea({ placeholder: t('product_detail.qna.answer_placeholder'), rows: 2 });
    const submitBtn = Button({ label: t('product_detail.qna.answer_submit'), type: 'submit', size: 'sm' });
    answerForm.append(textField, submitBtn);

    answerToggle.addEventListener('click', () => {
      answerForm.hidden = !answerForm.hidden;
      if (!answerForm.hidden) textField.focus();
    });

    answerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!textField.value.trim()) return;
      submitBtn.setLoading(true);
      try {
        await onAnswer(question, textField.value);
        answerForm.hidden = true;
        textField.value = '';
      } catch (err) {
        toast.error(err.message_en || t('product_detail.qna.answer_failed'));
      } finally {
        submitBtn.setLoading(false);
      }
    });

    card.append(answerToggle, answerForm);
  }

  return card;
}

export function QnASection({ productId, lang = 'en' } = {}) {
  const el = document.createElement('section');
  el.className = 'qna-section';
  let destroyed = false;
  let page = 1;

  const heading = document.createElement('h2');
  heading.className = 'qna-section__heading';
  heading.textContent = t('product_detail.qna.heading');
  el.append(heading);

  const askSlot = document.createElement('div');
  askSlot.className = 'qna-section__ask';
  el.append(askSlot);

  const listSlot = document.createElement('div');
  listSlot.className = 'qna-section__list';
  el.append(listSlot);

  const paginationSlot = document.createElement('div');
  el.append(paginationSlot);

  function currentRole() {
    return appStore.get().auth?.role;
  }

  function renderAskForm() {
    const auth = appStore.get().auth;
    if (!auth?.isAuthenticated) {
      const note = document.createElement('p');
      note.className = 'qna-section__gate-note';
      note.textContent = t('product_detail.qna.sign_in_to_ask');
      askSlot.replaceChildren(note);
      return;
    }

    const form = document.createElement('form');
    form.className = 'qna-ask-form';
    const field = Textarea({ placeholder: t('product_detail.qna.ask_placeholder'), rows: 2 });
    const submitBtn = Button({ label: t('product_detail.qna.ask_submit'), type: 'submit' });
    form.append(field, submitBtn);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!field.value.trim()) return;
      submitBtn.setLoading(true);
      try {
        await catalogApi.askQuestion(productId, field.value);
        toast.success(t('product_detail.qna.ask_success'));
        field.value = '';
        page = 1;
        load();
      } catch (err) {
        toast.error(err.message_en || t('product_detail.qna.ask_failed'));
      } finally {
        submitBtn.setLoading(false);
      }
    });

    askSlot.replaceChildren(form);
  }

  async function handleUpvote(question) {
    try {
      const result = await catalogApi.upvoteQuestion(question.id);
      question.upvote_count = result.upvote_count;
      load();
    } catch (err) {
      toast.error(err.message_en || t('product_detail.qna.upvote_failed'));
    }
  }

  async function handleAnswer(question, body) {
    const answer = await catalogApi.answerQuestion(question.id, body);
    question.answers = [...(question.answers || []), answer];
    load();
  }

  async function load() {
    listSlot.replaceChildren(Skeleton({ variant: 'text', lines: 2 }), Skeleton({ variant: 'text', lines: 2 }));
    let result;
    try {
      result = await catalogApi.listQuestions(productId, { page, pageSize: 5 });
    } catch {
      if (destroyed) return;
      listSlot.replaceChildren(EmptyState({ title: t('product_detail.qna.load_failed') }));
      return;
    }
    if (destroyed) return;

    const questionsList = Array.isArray(result?.questions) ? result.questions : [];
    const pagination = result?.pagination || { total_pages: 1 };

    if (questionsList.length === 0) {
      listSlot.replaceChildren(
        EmptyState({
          title: t('product_detail.qna.empty_title'),
          description: t('product_detail.qna.empty_description'),
        })
      );
      paginationSlot.replaceChildren();
      return;
    }

    const canAnswer = currentRole() === 'saler' || currentRole() === 'supplier';
    listSlot.replaceChildren(
      ...questionsList.map((q) => questionCard(q, lang, { onUpvote: handleUpvote, canAnswer, onAnswer: handleAnswer }))
    );

    if (pagination.total_pages > 1) {
      paginationSlot.replaceChildren(
        Pagination({
          mode: 'offset',
          page: pagination.page || 1,
          totalPages: pagination.total_pages,
          totalItems: pagination.total_count || questionsList.length,
          pageSize: pagination.page_size || 5,
          onChange: ({ page: nextPage }) => { page = nextPage; load(); window.scrollTo({ top: listSlot.offsetTop, behavior: 'smooth' }); },
        })
      );
    } else {
      paginationSlot.replaceChildren();
    }
  }

  renderAskForm();
  load();

  return {
    el,
    cleanup: () => { destroyed = true; },
  };
}
