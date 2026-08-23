/**
 * AssistantPanel.js — AI Shopping Concierge / Sourcing Intelligence chat panel (Prompt 10.2).
 *
 * Streams a server-sent-events turn from `POST /ai/{concierge|sourcing}/messages` — deliberately
 * not routed through core/api.js's `request()`, which awaits a full JSON body; this reads the
 * response as a live ReadableStream instead. Product cards are rendered strictly from the
 * structured `products` event, never parsed out of the streamed text, so a prompt-injection
 * attempt in catalog text cannot change what a card shows (docs/ai-strategy.md §9.1).
 *
 * Two entry points:
 *   AssistantPanel({ agentType })   — the panel content, for inline embedding or the gallery.
 *   openAssistantPanel({ agentType, trigger }) — wraps it in a Drawer and opens it, self-gating
 *     on the permission/module state so a disabled AI module degrades to a toast, never a crash.
 */
import { API_BASE, getAccessToken, api } from '../../core/api.js';
import { Button } from '../ui/Button.js';
import { Drawer } from '../ui/Drawer.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { whyDenied } from '../../services/permissions.js';

const AGENT_CONFIG = {
  concierge: {
    permission: 'ai.concierge.use',
    module: 'ai_concierge',
    endpoint: '/ai/concierge/messages',
    titleKey: 'ai.concierge_title',
    emptyKey: 'ai.empty_concierge',
    suggestionKeys: ['ai.suggestion_concierge_1', 'ai.suggestion_concierge_2'],
  },
  sourcing: {
    permission: 'ai.sourcing.use',
    module: 'ai_sourcing_chat',
    endpoint: '/ai/sourcing/messages',
    titleKey: 'ai.sourcing_title',
    emptyKey: 'ai.empty_sourcing',
    suggestionKeys: ['ai.suggestion_sourcing_1', 'ai.suggestion_sourcing_2'],
  },
};

/** Reads a fetch Response body as a stream of SSE `data:` frames, parsed as JSON. */
async function* streamSseEvents(path, body) {
  const headers = { 'Content-Type': 'application/json', 'Accept-Language': getLanguage() };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    throw new Error(`AI request failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim());
      } catch {
        // malformed frame — skip rather than break the whole stream
      }
    }
  }
}

function buildProductCard({ card, agentType, isBn, onAddToStore }) {
  const el = document.createElement('div');
  el.className = 'assistant-panel__product-card';

  const title = document.createElement('div');
  title.className = 'assistant-panel__product-title';
  title.textContent = (isBn && card.title_bn) ? card.title_bn : card.title_en;

  const price = document.createElement('div');
  price.className = 'assistant-panel__product-price';
  price.textContent = formatCurrency(card.price, { lang: isBn ? 'bn' : 'en' });

  const meta = document.createElement('div');
  meta.className = 'assistant-panel__product-meta';
  const bits = [];
  if (card.rating_avg) bits.push(`★ ${card.rating_avg.toFixed(1)}`);
  if (agentType === 'sourcing' && card.margin_pct !== null && card.margin_pct !== undefined) {
    bits.push(`+${Math.round(card.margin_pct)}%`);
  }
  if (!card.stock_qty) bits.push(t('ai.out_of_stock'));
  meta.textContent = bits.join(' · ');

  el.append(title, price, meta);

  if (agentType === 'sourcing') {
    const addBtn = Button({
      label: t('ai.add_to_store'),
      variant: 'primary',
      size: 'sm',
      disabled: !card.id,
      onClick: () => onAddToStore(card, addBtn),
    });
    el.append(addBtn);
  }

  return el;
}

export function AssistantPanel({ agentType = 'concierge' } = {}) {
  const config = AGENT_CONFIG[agentType] || AGENT_CONFIG.concierge;
  const isBn = getLanguage() === 'bn';

  const root = document.createElement('div');
  root.className = 'assistant-panel';

  const disclaimer = document.createElement('div');
  disclaimer.className = 'assistant-panel__disclaimer';
  disclaimer.textContent = `✨ ${t('ai.disclaimer')}`;

  const messagesEl = document.createElement('div');
  messagesEl.className = 'assistant-panel__messages';

  const emptyState = document.createElement('div');
  emptyState.className = 'assistant-panel__empty';
  emptyState.textContent = t(config.emptyKey);
  messagesEl.append(emptyState);

  const suggestionsEl = document.createElement('div');
  suggestionsEl.className = 'assistant-panel__suggestions';
  const suggestLabel = document.createElement('span');
  suggestLabel.className = 'assistant-panel__suggestions-label';
  suggestLabel.textContent = t('ai.suggested_prompts_label');
  suggestionsEl.append(suggestLabel);
  config.suggestionKeys.forEach((key) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'assistant-panel__suggestion-chip';
    chip.textContent = t(key);
    chip.addEventListener('click', () => sendMessage(t(key)));
    suggestionsEl.append(chip);
  });

  const composerForm = document.createElement('form');
  composerForm.className = 'assistant-panel__composer';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'assistant-panel__input';
  input.placeholder = t('ai.composer_placeholder');
  const sendBtn = Button({ label: t('ai.send'), variant: 'primary', size: 'sm', type: 'submit' });
  composerForm.append(input, sendBtn);

  root.append(disclaimer, messagesEl, suggestionsEl, composerForm);

  let conversationId = null;
  let sending = false;

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendUserBubble(text) {
    const bubble = document.createElement('div');
    bubble.className = 'assistant-panel__bubble assistant-panel__bubble--user';
    bubble.textContent = text;
    messagesEl.append(bubble);
    scrollToBottom();
  }

  function appendAssistantBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'assistant-panel__bubble assistant-panel__bubble--assistant';
    const textEl = document.createElement('div');
    textEl.className = 'assistant-panel__bubble-text';
    bubble.append(textEl);
    messagesEl.append(bubble);
    scrollToBottom();
    return { bubble, textEl };
  }

  async function handleAddToStore(card, btn) {
    try {
      btn.disabled = true;
      await api.post('/sourcing/add-to-store', { product_id: card.id });
      toast.success(t('ai.added_to_store_success'));
    } catch (err) {
      toast.error(err.message);
      btn.disabled = false;
    }
  }

  async function sendMessage(rawText) {
    const trimmed = (rawText ?? input.value).trim();
    if (!trimmed || sending) return;
    sending = true;
    input.value = '';
    sendBtn.disabled = true;
    emptyState.remove();
    suggestionsEl.classList.add('assistant-panel__suggestions--hidden');

    appendUserBubble(trimmed);
    const { bubble, textEl } = appendAssistantBubble();

    try {
      for await (const evt of streamSseEvents(config.endpoint, { conversation_id: conversationId, message: trimmed })) {
        if (evt.type === 'meta') {
          conversationId = evt.conversation_id;
        } else if (evt.type === 'text_delta') {
          textEl.textContent += evt.text;
          scrollToBottom();
        } else if (evt.type === 'degraded') {
          const banner = document.createElement('div');
          banner.className = 'assistant-panel__degraded-banner';
          banner.textContent = t('ai.degraded_banner');
          bubble.append(banner);
        } else if (evt.type === 'products' && evt.items?.length) {
          const cardsWrap = document.createElement('div');
          cardsWrap.className = 'assistant-panel__product-cards';
          evt.items.forEach((card) => {
            cardsWrap.append(buildProductCard({ card, agentType, isBn, onAddToStore: handleAddToStore }));
          });
          bubble.append(cardsWrap);
          scrollToBottom();
        } else if (evt.type === 'error') {
          textEl.textContent = isBn ? evt.message_bn : evt.message_en;
        }
      }
    } catch {
      textEl.textContent = t('ai.error_generic');
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  }

  composerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  return root;
}

/** Opens the panel in a right-side Drawer, self-gating on permission/module state. */
export function openAssistantPanel({ agentType = 'concierge', trigger = null } = {}) {
  const config = AGENT_CONFIG[agentType] || AGENT_CONFIG.concierge;
  const status = whyDenied(config.permission, config.module);

  if (status === 'module_off') {
    toast.warning(t('ai.module_disabled'));
    return null;
  }
  if (status !== 'held') {
    toast.warning(t('ai.module_disabled'));
    return null;
  }

  const content = AssistantPanel({ agentType });
  const drawer = Drawer({ title: t(config.titleKey), content, side: 'right', size: 'md' });
  drawer.openDrawer(trigger);
  return drawer;
}
