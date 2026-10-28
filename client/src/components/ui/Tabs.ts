/**
 * Tabs — panel switcher implementing the WAI-ARIA tabs pattern.
 *
 * Invariants:
 *  - ROVING TABINDEX, not a tab stop per tab. Tab enters the tablist once and lands on the
 *    ACTIVE tab; arrow keys move between tabs. A tablist where Tab visits all eight tabs is the
 *    classic wrong implementation — it turns navigation into an obstacle course.
 *  - Arrow navigation wraps, and Home/End jump to the ends, per the ARIA pattern.
 *  - Panels of inactive tabs are `hidden`, which removes them from the accessibility tree AND
 *    from find-in-page. Visually hiding them with CSS alone would leave both misleading.
 */

let tabsSeq = 0;

export interface TabDef {
  id: string;
  label: string;
  disabled?: boolean;
  /** A small count or tag shown after the label. */
  badge?: string | number;
  /** Initial panel content; replace it later with `setPanel`. */
  panel?: Node | null;
}

/** The tablist root; the methods are attached after it is built. */
export interface TabsElement extends HTMLDivElement {
  select(id: string): void;
  getActive(): string;
  setPanel(id: string, node: Node): void;
}

export interface TabsOptions {
  tabs?: TabDef[];
  /** Initial tab id; defaults to the first enabled tab. */
  active?: string;
  variant?: 'line' | 'pill' | string;
  onChange?: ((id: string) => void) | null;
}

export function Tabs({
  tabs = [],
  active = '',
  variant = 'line',
  onChange = null,
}: TabsOptions = {}): TabsElement {
  tabsSeq += 1;
  const base = `tabs-${tabsSeq}`;

  const root = document.createElement('div') as TabsElement;
  root.className = `tabs tabs--${variant}`;

  const list = document.createElement('div');
  list.className = 'tabs__list';
  list.setAttribute('role', 'tablist');

  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'tabs__panels';

  const enabled = tabs.filter((t) => !t.disabled);
  let activeId = active || enabled[0]?.id || tabs[0]?.id || '';

  const buttons = new Map<string, HTMLButtonElement>();
  const panels = new Map<string, HTMLDivElement>();

  function select(id: string, { focus = false }: { focus?: boolean } = {}): void {
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.disabled) return;
    activeId = id;

    for (const [tabId, btn] of buttons) {
      const isActive = tabId === id;
      btn.setAttribute('aria-selected', String(isActive));
      // Only the active tab is in the tab order — this IS the roving tabindex.
      btn.tabIndex = isActive ? 0 : -1;
      btn.dataset.active = String(isActive);
    }
    for (const [tabId, panel] of panels) {
      panel.hidden = tabId !== id;
    }
    if (focus) buttons.get(id)?.focus();
    if (onChange) onChange(id);
  }

  function moveFocus(direction: 'next' | 'prev' | 'home' | 'end'): void {
    const order = tabs.filter((t) => !t.disabled).map((t) => t.id);
    if (order.length === 0) return;
    const current = order.indexOf(activeId);
    let nextIndex: number;
    if (direction === 'home') nextIndex = 0;
    else if (direction === 'end') nextIndex = order.length - 1;
    else {
      const step = direction === 'next' ? 1 : -1;
      nextIndex = (current + step + order.length) % order.length;
    }
    select(order[nextIndex], { focus: true });
  }

  list.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveFocus('next');
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveFocus('prev');
        break;
      case 'Home':
        event.preventDefault();
        moveFocus('home');
        break;
      case 'End':
        event.preventDefault();
        moveFocus('end');
        break;
      default:
        break;
    }
  });

  for (const tab of tabs) {
    const tabId = `${base}-tab-${tab.id}`;
    const panelId = `${base}-panel-${tab.id}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tabs__tab';
    btn.id = tabId;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', panelId);
    btn.textContent = tab.label;
    if (tab.disabled) btn.disabled = true;
    if (tab.badge) {
      const badge = document.createElement('span');
      badge.className = 'tabs__badge';
      badge.textContent = String(tab.badge);
      btn.append(badge);
    }
    btn.addEventListener('click', () => select(tab.id));
    buttons.set(tab.id, btn);
    list.append(btn);

    const panel = document.createElement('div');
    panel.className = 'tabs__panel';
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    // A panel with no focusable content still needs to be reachable, or keyboard users cannot
    // scroll it after activating its tab.
    panel.tabIndex = 0;
    if (tab.panel) panel.append(tab.panel);
    panels.set(tab.id, panel);
    panelsWrap.append(panel);
  }

  root.append(list, panelsWrap);
  select(activeId);

  root.select = (id) => select(id);
  root.getActive = () => activeId;
  root.setPanel = (id, node) => panels.get(id)?.replaceChildren(node);

  return root;
}
