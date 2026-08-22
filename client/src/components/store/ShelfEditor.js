/**
 * ShelfEditor.js — Curated shelves & item reordering manager with live synchronization (Prompt 4.8).
 */

import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { Input } from '../ui/Input.js';

export function ShelfEditor({ initialShelves = [], onUpdate = null } = {}) {
  const container = document.createElement('div');
  container.className = 'shelf-editor';

  let shelves = JSON.parse(JSON.stringify(initialShelves || []));
  if (shelves.length === 0) {
    shelves = [{ name: 'Featured Products', items: [] }];
  }

  // Header with Add Shelf button
  const header = document.createElement('div');
  header.className = 'shelf-editor__header';

  const title = document.createElement('h4');
  title.className = 'store-builder__section-title';
  title.textContent = t('shelf_editor.title');

  const addShelfBtn = Button({
    label: `+ ${t('shelf_editor.add_shelf')}`,
    size: 'sm',
    variant: 'secondary',
    onClick: () => {
      openAddShelfModal((name) => {
        shelves.push({ name, items: [] });
        renderShelves();
        notifyChanges();
      });
    },
  });

  header.append(title, addShelfBtn);
  container.append(header);

  const shelvesList = document.createElement('div');
  shelvesList.className = 'shelf-editor__shelves-list';
  container.append(shelvesList);

  function notifyChanges() {
    // Flatten items for backend saving
    const flattened = [];
    shelves.forEach((shelf) => {
      (shelf.items || []).forEach((item, idx) => {
        flattened.push({
          product_id: item.product_id,
          collection_name: shelf.name,
          display_order: idx,
          custom_retail_price: item.custom_retail_price,
        });
      });
    });
    if (onUpdate) onUpdate({ shelves, flattenedItems: flattened });
  }

  function renderShelves() {
    shelvesList.replaceChildren();

    shelves.forEach((shelf, sIdx) => {
      const card = document.createElement('div');
      card.className = 'shelf-card';

      // Header: Shelf Name + Move Up/Down + Delete
      const cardHeader = document.createElement('div');
      cardHeader.className = 'shelf-card__header';

      const shelfTitle = document.createElement('span');
      shelfTitle.className = 'shelf-card__title';
      shelfTitle.innerHTML = `<span>📚</span> <strong>${shelf.name}</strong> <span class="text-muted text-xs">(${shelf.items.length} items)</span>`;

      const controls = document.createElement('div');
      controls.className = 'shelf-item-row__controls';

      if (sIdx > 0) {
        const upBtn = document.createElement('button');
        upBtn.className = 'btn btn--ghost btn--xs';
        upBtn.innerHTML = '▲';
        upBtn.title = t('shelf_editor.move_up');
        upBtn.addEventListener('click', () => {
          const temp = shelves[sIdx];
          shelves[sIdx] = shelves[sIdx - 1];
          shelves[sIdx - 1] = temp;
          renderShelves();
          notifyChanges();
        });
        controls.append(upBtn);
      }

      if (sIdx < shelves.length - 1) {
        const downBtn = document.createElement('button');
        downBtn.className = 'btn btn--ghost btn--xs';
        downBtn.innerHTML = '▼';
        downBtn.title = t('shelf_editor.move_down');
        downBtn.addEventListener('click', () => {
          const temp = shelves[sIdx];
          shelves[sIdx] = shelves[sIdx + 1];
          shelves[sIdx + 1] = temp;
          renderShelves();
          notifyChanges();
        });
        controls.append(downBtn);
      }

      if (shelves.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn--danger btn--xs';
        delBtn.innerHTML = '✕';
        delBtn.title = t('common.delete');
        delBtn.addEventListener('click', () => {
          shelves.splice(sIdx, 1);
          renderShelves();
          notifyChanges();
        });
        controls.append(delBtn);
      }

      cardHeader.append(shelfTitle, controls);
      card.append(cardHeader);

      // Items list
      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'shelf-card__items';

      if (shelf.items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-muted';
        empty.style.padding = 'var(--space-2)';
        empty.textContent = t('shelf_editor.empty_shelf');
        itemsContainer.append(empty);
      } else {
        shelf.items.forEach((item, iIdx) => {
          const row = document.createElement('div');
          row.className = 'shelf-item-row';

          const info = document.createElement('div');
          info.className = 'shelf-item-row__info';

          const handle = document.createElement('span');
          handle.className = 'text-muted';
          handle.textContent = '⋮⋮';
          handle.style.cursor = 'grab';

          const titleEl = document.createElement('span');
          titleEl.className = 'shelf-item-row__title';
          titleEl.textContent = getLanguage() === 'bn' ? (item.title_bn || item.title_en) : (item.title_en || item.title_bn);

          const priceEl = document.createElement('span');
          priceEl.className = 'shelf-item-row__price';
          priceEl.textContent = formatCurrency(item.custom_retail_price || item.default_retail_price || 0);

          info.append(handle, titleEl, priceEl);

          // Item Move Controls
          const itemControls = document.createElement('div');
          itemControls.className = 'shelf-item-row__controls';

          if (iIdx > 0) {
            const iUp = document.createElement('button');
            iUp.className = 'btn btn--ghost btn--xs';
            iUp.textContent = '↑';
            iUp.addEventListener('click', () => {
              const temp = shelf.items[iIdx];
              shelf.items[iIdx] = shelf.items[iIdx - 1];
              shelf.items[iIdx - 1] = temp;
              renderShelves();
              notifyChanges();
            });
            itemControls.append(iUp);
          }

          if (iIdx < shelf.items.length - 1) {
            const iDown = document.createElement('button');
            iDown.className = 'btn btn--ghost btn--xs';
            iDown.textContent = '↓';
            iDown.addEventListener('click', () => {
              const temp = shelf.items[iIdx];
              shelf.items[iIdx] = shelf.items[iIdx + 1];
              shelf.items[iIdx + 1] = temp;
              renderShelves();
              notifyChanges();
            });
            itemControls.append(iDown);
          }

          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn btn--ghost btn--xs text-danger';
          removeBtn.textContent = '✕';
          removeBtn.title = t('shelf_editor.remove_item');
          removeBtn.addEventListener('click', () => {
            shelf.items.splice(iIdx, 1);
            renderShelves();
            notifyChanges();
          });
          itemControls.append(removeBtn);

          row.append(info, itemControls);
          itemsContainer.append(row);
        });
      }

      card.append(itemsContainer);
      shelvesList.append(card);
    });
  }

  function openAddShelfModal(onAdd) {
    const input = Input({
      label: t('shelf_editor.shelf_name_label'),
      placeholder: 'e.g. Summer Specials / Trending Now',
      required: true,
    });

    const modal = Modal({
      title: t('shelf_editor.create_new_shelf'),
      content: input,
      primaryAction: {
        label: t('common.add'),
        onClick: () => {
          const val = input.querySelector('input')?.value?.trim();
          if (val) {
            onAdd(val);
            modal.close();
          }
        },
      },
      secondaryAction: {
        label: t('common.cancel'),
        onClick: () => modal.close(),
      },
    });

    modal.open();
  }

  renderShelves();
  return container;
}
