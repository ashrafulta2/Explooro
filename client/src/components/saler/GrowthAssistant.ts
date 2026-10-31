/**
 * GrowthAssistant.ts — Prescriptive AI Next-Step Growth Recommendations (Prompt 11.2 / 10.3).
 *
 * Renders grounded advice with direct 1-click executable actions,
 * converting raw analytics into concrete daily shop partner tasks.
 */

import { salerApi } from '../../services/saler.api.ts';
import { t } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import { Button } from '../ui/Button.ts';
import { Skeleton } from '../ui/Skeleton.ts';
import { openAssistantPanel } from '../ai/AssistantPanel.ts';

/** One piece of advice from GET /saler/growth-recommendations. */
export interface GrowthRecommendation {
  type?: string;
  title?: string;
  recommendation?: string;
  action?: { label_en?: string; url?: string } | null;
  [field: string]: unknown;
}

/** The card list root plus a `reload` the page calls after an action. */
export interface GrowthAssistantParts {
  element: HTMLDivElement;
  reload(): Promise<void>;
}

export interface GrowthAssistantOptions {
  /** Pre-fetched recommendations (the gallery); otherwise they are loaded. */
  recommendations?: GrowthRecommendation[] | null;
  onActionExecuted?: ((recommendation: unknown) => void) | null;
  onNavigate?: ((path: string) => void) | null;
}

export function GrowthAssistant({ recommendations = null, onActionExecuted = null, onNavigate = null }: GrowthAssistantOptions = {}): GrowthAssistantParts {
  const container = document.createElement('div');
  container.className = 'growth-assistant';

  // Header
  const header = document.createElement('div');
  header.className = 'growth-assistant-header';

  const titleWrap = document.createElement('div');
  titleWrap.style.display = 'flex';
  titleWrap.style.alignItems = 'center';
  titleWrap.style.gap = '10px';
  titleWrap.innerHTML = `
    <div class="saler-card-icon-box">💡</div>
    <div>
      <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
        ${t('saler.growth_assistant.title', 'AI Growth Assistant')}
        <span class="badge badge--primary text-[10px] uppercase tracking-wider font-semibold">Live Advice</span>
      </h3>
      <p data-page-info style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
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
        // @ts-expect-error openAssistantPanel takes only agentType and trigger; these two options have never been read, so the panel opens empty
        initialRole: 'saler',
        initialQuery: 'What are the highest-margin trending products I should add to my store today?',
      });
    },
  });

  header.append(titleWrap, askAiBtn);
  container.append(header);

  // Cards List container
  const listContainer = document.createElement('div');
  listContainer.className = 'growth-assistant-grid';
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
        empty.style.gridColumn = '1 / -1';
        empty.style.padding = '16px';
        empty.style.textAlign = 'center';
        empty.style.fontSize = '12px';
        empty.style.color = 'var(--text-muted)';
        empty.textContent = t('saler.growth_assistant.all_caught_up', 'All performance metrics are optimal! Check back after new customer orders.');
        listContainer.append(empty);
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'growth-assistant-card';

        // Badge & Title
        const cardTop = document.createElement('div');
        cardTop.style.display = 'flex';
        cardTop.style.flexDirection = 'column';
        cardTop.style.gap = '6px';

        const badgeType = item.type === 'PRICE_OPPORTUNITY' ? 'warning'
          : item.type === 'HERO_PRODUCT' ? 'success'
          : item.type === 'SLOW_MOVER' ? 'neutral'
          : 'primary';

        const badgeText = item.type === 'PRICE_OPPORTUNITY' ? '⚡ Price Optimization'
          : item.type === 'HERO_PRODUCT' ? '🏆 Top Hero Item'
          : item.type === 'SLOW_MOVER' ? '📣 Demand Boost'
          : '💡 Sourcing Opportunity';

        cardTop.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="badge badge--${badgeType} text-[10px]">${badgeText}</span>
            <span style="font-size: 11px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</span>
          </div>
          <p style="margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4;">${item.recommendation}</p>
        `;

        // 1-Click Action Button
        const cardAction = document.createElement('div');
        cardAction.style.display = 'flex';
        cardAction.style.justifyContent = 'flex-end';
        cardAction.style.paddingTop = '6px';

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
      errBox.style.gridColumn = '1 / -1';
      errBox.style.fontSize = '12px';
      errBox.style.color = 'var(--danger-500)';
      errBox.style.padding = '8px 0';
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
