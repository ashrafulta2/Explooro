/**
 * GrowthAssistant.js — Prescriptive AI Next-Step Growth Recommendations (Prompt 11.2 / 10.3).
 *
 * Renders grounded advice with direct 1-click executable actions,
 * converting raw analytics into concrete daily seller tasks.
 */

import { salerApi } from '../../services/saler.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../ui/Button.js';
import { Badge } from '../ui/Badge.js';
import { Skeleton } from '../ui/Skeleton.js';
import { openAssistantPanel } from '../ai/AssistantPanel.js';

export function GrowthAssistant({ recommendations = null, onActionExecuted = null, onNavigate = null } = {}) {
  const container = document.createElement('div');
  container.className = 'growth-assistant rounded-2xl border border-primary/20 bg-gradient-to-br from-surface to-primary/5 p-5 shadow-sm space-y-4';

  // Header
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between gap-3 border-b border-subtle pb-3';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex items-center gap-2.5';
  titleWrap.innerHTML = `
    <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-lg">💡</div>
    <div>
      <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
        ${t('saler.growth_assistant.title', 'AI Growth Assistant')}
        <span class="badge badge--primary text-[10px] uppercase tracking-wider font-semibold">Live Advice</span>
      </h3>
      <p class="text-xs text-muted">
        ${t('saler.growth_assistant.subtitle', 'Grounded next-steps derived from your real catalog metrics and peer sales.')}
      </p>
    </div>
  `;

  const askAiBtn = Button({
    label: `✨ ${t('saler.growth_assistant.ask_assistant', 'Ask Sourcing Copilot')}`,
    variant: 'secondary',
    size: 'xs',
    onClick: () => {
      openAssistantPanel({
        initialRole: 'saler',
        initialQuery: 'What are the highest-margin trending products I should add to my store today?',
      });
    },
  });

  header.append(titleWrap, askAiBtn);
  container.append(header);

  // Cards List container
  const listContainer = document.createElement('div');
  listContainer.className = 'grid grid-cols-1 md:grid-cols-2 gap-3.5';
  container.append(listContainer);

  async function loadAndRender() {
    listContainer.innerHTML = '';
    listContainer.append(Skeleton({ width: '100%', height: '110px' }));

    try {
      let items = recommendations;
      if (!items) {
        const res = await salerApi.getGrowthRecommendations();
        items = res.data?.recommendations || [];
      }

      listContainer.innerHTML = '';

      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'col-span-full py-4 text-center text-xs text-muted';
        empty.textContent = t('saler.growth_assistant.all_caught_up', 'All performance metrics are optimal! Check back after new customer orders.');
        listContainer.append(empty);
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'flex flex-col justify-between rounded-xl border border-subtle bg-surface p-3.5 hover:border-primary/40 transition-colors shadow-xs space-y-3';

        // Badge & Title
        const cardTop = document.createElement('div');
        cardTop.className = 'space-y-1.5';

        const badgeType = item.type === 'PRICE_OPPORTUNITY' ? 'warning'
          : item.type === 'HERO_PRODUCT' ? 'success'
          : item.type === 'SLOW_MOVER' ? 'neutral'
          : 'primary';

        const badgeText = item.type === 'PRICE_OPPORTUNITY' ? '⚡ Price Optimization'
          : item.type === 'HERO_PRODUCT' ? '🏆 Top Hero Item'
          : item.type === 'SLOW_MOVER' ? '📣 Demand Boost'
          : '💡 Sourcing Opportunity';

        cardTop.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <span class="badge badge--${badgeType} text-[10px]">${badgeText}</span>
            <span class="text-[11px] font-bold text-foreground line-clamp-1">${item.title}</span>
          </div>
          <p class="text-xs text-muted leading-relaxed">${item.recommendation}</p>
        `;

        // 1-Click Action Button
        const cardAction = document.createElement('div');
        cardAction.className = 'pt-1 flex justify-end';

        const actionBtn = Button({
          label: item.action?.label_en || 'Take Action →',
          variant: 'primary',
          size: 'xs',
          onClick: () => {
            if (item.action?.url) {
              if (typeof onNavigate === 'function') {
                onNavigate(item.action.url);
              } else {
                history.pushState({}, '', item.action.url);
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
            } else {
              toast.success('Action initiated!');
            }
            if (onActionExecuted) onActionExecuted(item);
          },
        });
        cardAction.append(actionBtn);

        card.append(cardTop, cardAction);
        listContainer.append(card);
      });
    } catch (err) {
      listContainer.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'col-span-full text-xs text-danger py-2';
      errBox.textContent = t('saler.growth_assistant.load_failed', 'Unable to load growth recommendations.');
      listContainer.append(errBox);
    }
  }

  loadAndRender();

  return {
    element: container,
    reload: loadAndRender,
  };
}
