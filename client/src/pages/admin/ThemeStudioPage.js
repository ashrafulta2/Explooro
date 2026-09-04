/**
 * ThemeStudioPage.js — Granular Component-Level Color Studio with 6 Sections, 5 Presets & Live Preview (Prompt 3.5).
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Input } from '../../components/ui/Input.js';
import { Modal } from '../../components/ui/Modal.js';
import { confirmDialog, confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { THEME_PRESETS } from '../../config/theme-presets.js';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../../config/master-themes.js';
import {
  applyTheme,
  getContrastRatio,
  validatePaletteContrast,
  validateNoGradients,
  themeFromMaster,
  themeFromLegacyTokens,
  getCurrentTokens,
  getCurrentMaster,
  cacheActiveTheme,
} from '../../services/themePalette.js';
import {
  generatePalette, paletteToSectionTokens, BRAND_STEPS, NEUTRAL_STEPS, MASTER_RANGES,
} from '../../services/colorRamp.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';
import { appStore } from '../../state/appStore.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';

export default function ThemeStudioPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'theme-studio';

  const authState = appStore.get()?.auth || {};
  const isSuperAdmin = (authState.roles || []).includes('super_admin') || authState.role === 'super_admin';
  const isAdmin = isSuperAdmin || (authState.roles || []).includes('admin') || authState.role === 'admin';
  const isModerator = (authState.roles || []).includes('moderator') || authState.role === 'moderator' || (authState.roles || []).includes('editor') || authState.role === 'editor';

  // Seed from whatever the site is ALREADY showing, not the shipped default — applyTheme() below
  // writes CSS custom properties onto document.documentElement, which is global, site-wide state.
  // Bootstrapping from DEFAULT_MASTER_PRESET here used to force-repaint the live site to the
  // default palette the instant this page mounted, before the async fetch below could correct it.
  const liveMaster = getCurrentMaster();
  const liveTokens = getCurrentTokens();

  let activePresetKey = DEFAULT_MASTER_PRESET;
  if (liveMaster?.seed) {
    const matchedMaster = Object.entries(MASTER_PRESETS).find(
      ([, p]) => p.master?.seed?.toLowerCase() === liveMaster.seed.toLowerCase()
    );
    if (matchedMaster) {
      activePresetKey = matchedMaster[0];
    } else {
      const matchedLegacy = Object.entries(THEME_PRESETS).find(
        ([, p]) => (p.tokens?.brand?.primary || p.preview_swatch)?.toLowerCase() === liveMaster.seed.toLowerCase()
      );
      activePresetKey = matchedLegacy ? matchedLegacy[0] : 'custom';
    }
  }

  let masterConfig = liveMaster
    ? { ...liveMaster }
    : { ...MASTER_PRESETS[DEFAULT_MASTER_PRESET].master };
  let workingTokens = liveMaster
    ? JSON.parse(JSON.stringify(liveTokens))
    : themeFromMaster(masterConfig);
  let publishedTokens = JSON.parse(JSON.stringify(workingTokens));
  let activePaletteId = null;
  let savedThemes = [];

  // Header
  const header = document.createElement('div');
  header.className = 'theme-studio__header';

  const titleRow = document.createElement('div');
  titleRow.className = 'theme-studio__title-row';

  const title = document.createElement('h1');
  title.className = 'theme-studio__title';
  title.textContent = t('theme_studio.title');

  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'theme-studio__actions';

  const resetBtn = Button({
    label: t('theme_studio.btn_reset'),
    variant: 'ghost',
    size: 'sm',
    onClick: handleResetDefault,
  });

  const revertBtn = Button({
    label: t('theme_studio.btn_revert'),
    variant: 'secondary',
    size: 'sm',
    onClick: handleRevertPublished,
  });

  const draftBtn = Button({
    label: t('theme_studio.btn_draft'),
    variant: 'secondary',
    size: 'sm',
    onClick: handleSaveDraft,
  });

  const publishBtn = Button({
    label: isAdmin
      ? `🚀 ${t('theme_studio.btn_publish')}`
      : `📝 ${t('theme_studio.btn_submit_approval') || 'Submit for Admin Approval'}`,
    variant: 'primary',
    size: 'sm',
    onClick: handlePublishTheme,
  });

  actionsWrap.append(resetBtn, revertBtn, draftBtn, publishBtn);
  titleRow.append(title, actionsWrap);

  const subtitle = document.createElement('p');
  subtitle.className = 'theme-studio__subtitle';
  subtitle.textContent = t('theme_studio.subtitle');

  header.append(titleRow, subtitle);

  // Main Layout Grid: Left (Presets + 6 Sections) | Right (Sticky Preview Pane)
  const layout = document.createElement('div');
  layout.className = 'theme-studio__layout';

  // Left Column
  const leftCol = document.createElement('div');
  leftCol.style.display = 'flex';
  leftCol.style.flexDirection = 'column';
  leftCol.style.gap = 'var(--space-6)';

  // 1. Primary: 1-Click Clean Marketplace Themes (Standard)
  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'theme-presets';

  const presetsHeading = document.createElement('h2');
  presetsHeading.className = 'text-sm font-semibold';
  presetsHeading.textContent = t('theme_studio.presets_title');

  const presetsGrid = document.createElement('div');
  presetsGrid.className = 'theme-presets__grid';
  renderPresetsGrid(presetsGrid);

  presetsWrap.append(presetsHeading, presetsGrid);

  // 2. Primary: Section Color Controls (Navbar/Logo, Sidebar, Action Buttons, Badges, etc.)
  const sectionsWrap = document.createElement('div');
  sectionsWrap.className = 'theme-sections';

  const sectionsHeading = document.createElement('h2');
  sectionsHeading.className = 'text-sm font-semibold';
  sectionsHeading.textContent = t('theme_studio.sections_title');

  sectionsWrap.append(sectionsHeading);
  renderSectionAccordions(sectionsWrap);

  // 3. Secondary / Advanced: Master Seed & Procedural Palette Engine (Optional)
  const masterCard = document.createElement('div');
  masterCard.className = 'theme-section-card';

  const masterHeader = document.createElement('div');
  masterHeader.className = 'theme-section-card__header';
  masterHeader.innerHTML = `<span>${t('theme_studio.master_advanced_title')}</span> <span>▶</span>`;

  const masterBody = document.createElement('div');
  masterBody.className = 'theme-section-card__body';
  masterBody.style.display = 'none';

  masterHeader.addEventListener('click', () => {
    const isHidden = masterBody.style.display === 'none';
    masterBody.style.display = isHidden ? 'flex' : 'none';
    masterHeader.querySelector('span:last-child').textContent = isHidden ? '▼' : '▶';
  });

  const masterWrap = document.createElement('div');
  masterWrap.className = 'theme-master';
  masterWrap.style.padding = '0';
  masterWrap.style.border = 'none';
  masterWrap.style.background = 'transparent';

  masterBody.append(masterWrap);
  masterCard.append(masterHeader, masterBody);

  // 4. My Saved Themes — custom palettes the admin has named and saved for reuse.
  const savedWrap = document.createElement('div');
  savedWrap.className = 'theme-section-card';

  const savedHeader = document.createElement('div');
  savedHeader.className = 'theme-section-card__header';
  savedHeader.innerHTML = `<span>${t('theme_studio.saved_title')}</span> <span>▶</span>`;

  const savedBody = document.createElement('div');
  savedBody.className = 'theme-section-card__body';
  savedBody.style.display = 'none';

  savedHeader.addEventListener('click', () => {
    const isHidden = savedBody.style.display === 'none';
    savedBody.style.display = isHidden ? 'flex' : 'none';
    savedHeader.querySelector('span:last-child').textContent = isHidden ? '▼' : '▶';
  });

  const savedDesc = document.createElement('p');
  savedDesc.className = 'theme-saved__desc';
  savedDesc.textContent = t('theme_studio.saved_desc');

  const savedThemesList = document.createElement('div');
  savedThemesList.className = 'theme-saved__list';
  renderSavedThemesList(savedThemesList);

  savedBody.append(savedDesc, savedThemesList);
  savedWrap.append(savedHeader, savedBody);

  leftCol.append(presetsWrap, sectionsWrap, masterCard, savedWrap);

  // Right Column: Live Site Component Preview
  const rightCol = document.createElement('div');
  rightCol.className = 'theme-preview-pane';

  const previewHeading = document.createElement('h3');
  previewHeading.className = 'theme-preview-pane__title';
  previewHeading.textContent = `👁️ ${t('theme_studio.preview_title')}`;

  const contrastStatusBanner = document.createElement('div');
  updateContrastStatusBanner(contrastStatusBanner);

  const previewViewport = document.createElement('div');
  previewViewport.className = 'theme-mini-viewport';
  renderMiniViewport(previewViewport);

  rightCol.append(previewHeading, contrastStatusBanner, previewViewport);

  layout.append(leftCol, rightCol);
  container.append(header, PlatformSubnav({ activeKey: 'theme', navigate }), layout);

  // Initial paint: refreshAll() renders the master panel, preset grid, section accordions and
  // contrast banner from the same working tokens it applies, so nothing can start out of sync.
  refreshAll();

  /**
   * The marketplace presets. Each now routes through the master engine using its own signature
   * colour as the seed, so picking one re-themes borders, hovers, scrollbars and dark mode too —
   * previously they repainted 33 semantic tokens and left the pink ramp underneath untouched.
   * Only the navbar and footer keep their hand-authored values, because a dark obsidian header on
   * an amber system IS the identity being quoted, not a colour the generator should second-guess.
   */
  function renderPresetsGrid(wrap) {
    wrap.innerHTML = '';
    for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
      const seed = preset.master?.seed || '#334155';
      const card = document.createElement('div');
      card.className = `theme-preset-card ${activePresetKey === key ? 'theme-preset-card--active' : ''}`;

      const swatch = document.createElement('div');
      swatch.className = 'theme-preset-card__swatch';
      swatch.style.background = seed;
      swatch.textContent = preset.key.toUpperCase().substring(0, 3);

      const name = document.createElement('span');
      name.className = 'theme-preset-card__name';
      name.textContent = isBn ? preset.name_bn : preset.name_en;

      card.append(swatch, name);

      card.addEventListener('click', () => {
        activePresetKey = key;
        masterConfig = { ...preset.master };
        workingTokens = themeFromMaster(masterConfig);
        refreshAll();
        toast.info(isBn ? `প্রিসেট প্রয়োগ করা হয়েছে: ${preset.name_bn}` : `Applied preset: ${preset.name_en}`);
      });

      wrap.append(card);
    }
  }

  /** Single re-render path: apply, then rebuild every control that reflects the working tokens. */
  function refreshAll() {
    applyTheme(workingTokens);
    renderMasterPanel(masterWrap);
    renderPresetsGrid(presetsGrid);
    renderSectionAccordions(sectionsWrap);
    updateContrastStatusBanner(contrastStatusBanner);
  }

  /**
   * Regenerates the entire palette from the current master config. Section-level hand-edits are
   * intentionally discarded: they were derived from the previous seed, and silently carrying a
   * stale pink border onto a cobalt system is exactly the bug this panel exists to remove.
   */
  function regenerateFromMaster() {
    workingTokens = themeFromMaster(masterConfig);
    refreshAll();
  }

  function renderMasterPanel(wrap) {
    wrap.innerHTML = '';
    const palette = generatePalette(masterConfig);

    const heading = document.createElement('h2');
    heading.className = 'text-sm font-semibold';
    heading.textContent = t('theme_studio.master_title');

    const blurb = document.createElement('p');
    blurb.className = 'theme-master__blurb';
    blurb.textContent = t('theme_studio.master_desc');

    const presetRow = document.createElement('div');
    presetRow.className = 'theme-master__presets';
    for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `theme-master-chip ${masterConfig.seed === preset.master.seed ? 'theme-master-chip--active' : ''}`;
      chip.title = isBn ? preset.description_bn : preset.description_en;

      const dot = document.createElement('span');
      dot.className = 'theme-master-chip__dot';
      dot.style.background = preset.master.seed;

      const label = document.createElement('span');
      label.textContent = isBn ? preset.name_bn : preset.name_en;

      chip.append(dot, label);
      chip.addEventListener('click', () => {
        activePresetKey = key;
        masterConfig = { ...preset.master };
        regenerateFromMaster();
        toast.info(isBn ? `মাস্টার কালার: ${preset.name_bn}` : `Master colour: ${preset.name_en}`);
      });
      presetRow.append(chip);
    }

    const seedRow = document.createElement('div');
    seedRow.className = 'theme-master__seed';

    const seedLabel = document.createElement('label');
    seedLabel.className = 'theme-master__seed-label';
    seedLabel.setAttribute('for', 'master-seed-picker');
    seedLabel.textContent = t('theme_studio.master_seed');

    const seedPicker = document.createElement('input');
    seedPicker.type = 'color';
    seedPicker.id = 'master-seed-picker';
    seedPicker.className = 'theme-master__picker';
    seedPicker.value = masterConfig.seed;

    const seedHex = document.createElement('input');
    seedHex.type = 'text';
    seedHex.className = 'theme-hex-input';
    seedHex.value = masterConfig.seed;
    seedHex.setAttribute('aria-label', t('theme_studio.master_seed_hex'));

    const seedMeta = document.createElement('span');
    seedMeta.className = 'theme-master__meta';
    seedMeta.textContent = t('theme_studio.master_meta', {
      hue: palette.meta.seedHue,
      step: palette.meta.anchorStep,
    });

    const commitSeed = (raw) => {
      const next = raw.startsWith('#') ? raw : `#${raw}`;
      if (!/^#[0-9a-fA-F]{6}$/.test(next)) return;
      if (next.toLowerCase() === masterConfig.seed) return;
      activePresetKey = 'custom';
      masterConfig = { ...masterConfig, seed: next.toLowerCase() };
      regenerateFromMaster();
    };

    seedPicker.addEventListener('change', (e) => commitSeed(e.target.value));
    seedHex.addEventListener('change', (e) => commitSeed(e.target.value.trim()));

    seedRow.append(seedLabel, seedPicker, seedHex, seedMeta);

    const controls = document.createElement('div');
    controls.className = 'theme-master__controls';

    controls.append(
      buildSelect('theme_studio.master_neutral_mode', masterConfig.neutralMode, [
        ['cool', t('theme_studio.neutral_cool')],
        ['match', t('theme_studio.neutral_match')],
        ['complement', t('theme_studio.neutral_complement')],
      ], (v) => updateMaster({ neutralMode: v })),

      buildSelect('theme_studio.master_accent', masterConfig.accentHarmony, [
        ['complement', t('theme_studio.harmony_complement')],
        ['analogous', t('theme_studio.harmony_analogous')],
        ['triad', t('theme_studio.harmony_triad')],
        ['mono', t('theme_studio.harmony_mono')],
      ], (v) => updateMaster({ accentHarmony: v })),

      buildSlider('theme_studio.master_tint', masterConfig.neutralTint, MASTER_RANGES.neutralTint,
        (v) => updateMaster({ neutralTint: v })),
      buildSlider('theme_studio.master_vividness', masterConfig.vividness, MASTER_RANGES.vividness,
        (v) => updateMaster({ vividness: v })),
      buildSlider('theme_studio.master_status_pull', masterConfig.statusPull, MASTER_RANGES.statusPull,
        (v) => updateMaster({ statusPull: v })),

      buildToggle('theme_studio.master_surface_wash', masterConfig.surfaceWash,
        (v) => updateMaster({ surfaceWash: v })),
      buildToggle('theme_studio.master_border_tint', masterConfig.borderTint,
        (v) => updateMaster({ borderTint: v })),
    );

    // Generated ramp readout — visible proof that the whole system moved, not just the buttons.
    const rampsWrap = document.createElement('div');
    rampsWrap.className = 'theme-master__ramps';
    rampsWrap.append(
      buildRampStrip(t('theme_studio.ramp_brand'), BRAND_STEPS.map((k) => [k, palette.brand[k]])),
      buildRampStrip(t('theme_studio.ramp_neutral'), NEUTRAL_STEPS.map((k) => [k, palette.neutral[k]])),
      buildRampStrip(t('theme_studio.ramp_status'), [
        ['success', palette.success[500]],
        ['warning', palette.warning[500]],
        ['danger', palette.danger[500]],
        ['info', palette.info[500]],
        ['accent', palette.accent[300]],
      ]),
    );

    wrap.append(heading, blurb, presetRow, seedRow, controls, rampsWrap);
  }

  function updateMaster(patch) {
    activePresetKey = 'custom';
    masterConfig = { ...masterConfig, ...patch };
    regenerateFromMaster();
  }

  function buildSelect(labelKey, value, options, onChange) {
    const field = document.createElement('label');
    field.className = 'theme-master__field';
    const span = document.createElement('span');
    span.textContent = t(labelKey);
    const select = document.createElement('select');
    select.className = 'theme-master__select';
    for (const [val, text] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      if (val === value) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', (e) => onChange(e.target.value));
    field.append(span, select);
    return field;
  }

  // WHY the range is passed in as MASTER_RANGES[field] rather than literals: the server validates
  // writes against that same constant, so a slider can never offer a value the API would reject.
  function buildSlider(labelKey, value, { min, max, step }, onChange) {
    const field = document.createElement('label');
    field.className = 'theme-master__field';
    const span = document.createElement('span');
    span.textContent = `${t(labelKey)} · ${Number(value).toFixed(2)}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'theme-master__slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    // WHY `change` and not `input`: dragging fires input per pixel, and each one regenerates the
    // palette AND rebuilds this panel — which would tear the slider out from under the pointer.
    // The label still tracks live on `input` so the drag is not silent.
    input.addEventListener('input', (e) => {
      span.textContent = `${t(labelKey)} · ${Number(e.target.value).toFixed(2)}`;
    });
    input.addEventListener('change', (e) => onChange(Number(e.target.value)));
    field.append(span, input);
    return field;
  }

  function buildToggle(labelKey, value, onChange) {
    const field = document.createElement('label');
    field.className = 'theme-master__field theme-master__field--toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.addEventListener('change', (e) => onChange(e.target.checked));
    const span = document.createElement('span');
    span.textContent = t(labelKey);
    field.append(input, span);
    return field;
  }

  function buildRampStrip(label, entries) {
    const row = document.createElement('div');
    row.className = 'theme-ramp-strip';
    const name = document.createElement('span');
    name.className = 'theme-ramp-strip__label';
    name.textContent = label;
    const swatches = document.createElement('div');
    swatches.className = 'theme-ramp-strip__swatches';
    for (const [step, hex] of entries) {
      const sw = document.createElement('span');
      sw.className = 'theme-ramp-strip__swatch';
      sw.style.background = hex;
      sw.title = `${step} — ${hex}`;
      swatches.append(sw);
    }
    row.append(name, swatches);
    return row;
  }

  function renderSectionAccordions(wrap) {
    // Retain only header
    while (wrap.children.length > 1) {
      wrap.removeChild(wrap.lastChild);
    }

    const sections = [
      {
        id: 'navbar',
        title: t('theme_studio.section_navbar'),
        items: [
          { token: 'navbar.bg', label: 'Navbar Background', fgOrBg: 'bg', compareToken: 'navbar.text' },
          { token: 'navbar.text', label: 'Navbar Text', fgOrBg: 'fg', compareToken: 'navbar.bg' },
          { token: 'navbar.logo_text', label: 'Logo Brand Text ("EXPLOORO")', fgOrBg: 'fg', compareToken: 'navbar.bg' },
          { token: 'navbar.logo_bg', label: 'Logo Badge BG', fgOrBg: 'other' },
          { token: 'navbar.logo_star', label: 'Logo Sparkle Star', fgOrBg: 'other' },
          { token: 'navbar.icon_color', label: 'Header Icons Color', fgOrBg: 'other' },
          { token: 'navbar.icon_hover', label: 'Header Icons Hover Color', fgOrBg: 'other' },
          { token: 'navbar.border', label: 'Navbar Border', fgOrBg: 'other' },
          { token: 'navbar.search_bg', label: 'Search Input BG', fgOrBg: 'other' },
        ],
      },
      {
        id: 'sidebar',
        title: t('theme_studio.section_sidebar') || 'Left Sidebar & Navigation Icons',
        items: [
          { token: 'sidebar.bg', label: 'Sidebar Background', fgOrBg: 'bg', compareToken: 'sidebar.text' },
          { token: 'sidebar.text', label: 'Sidebar Item Text', fgOrBg: 'fg', compareToken: 'sidebar.bg' },
          { token: 'sidebar.icon_color', label: 'Sidebar Icons Color', fgOrBg: 'other' },
          { token: 'sidebar.icon_hover', label: 'Sidebar Icons Hover Color', fgOrBg: 'other' },
          { token: 'sidebar.active_bg', label: 'Sidebar Active Item BG', fgOrBg: 'bg', compareToken: 'sidebar.active_text' },
          { token: 'sidebar.active_text', label: 'Sidebar Active Item Text & Icon', fgOrBg: 'fg', compareToken: 'sidebar.active_bg' },
          { token: 'sidebar.border', label: 'Sidebar Separator Border', fgOrBg: 'other' },
        ],
      },
      {
        id: 'surfaces',
        title: t('theme_studio.section_surfaces'),
        items: [
          { token: 'surfaces.page', label: 'Page Canvas BG', fgOrBg: 'bg', compareToken: 'typography.primary' },
          { token: 'surfaces.card', label: 'Card Surface', fgOrBg: 'bg', compareToken: 'typography.primary' },
          { token: 'surfaces.subtle', label: 'Subtle Surface', fgOrBg: 'bg', compareToken: 'typography.secondary' },
          { token: 'surfaces.border', label: 'Border Subtle', fgOrBg: 'other' },
        ],
      },
      {
        id: 'brand',
        title: t('theme_studio.section_brand'),
        items: [
          { token: 'brand.primary', label: 'Primary Brand Fill', fgOrBg: 'bg', compareToken: 'brand.contrast' },
          { token: 'brand.hover', label: 'Brand Hover Fill', fgOrBg: 'other' },
          { token: 'brand.contrast', label: 'Button Contrast Text', fgOrBg: 'fg', compareToken: 'brand.primary' },
          { token: 'brand.secondary_bg', label: 'Secondary Button BG', fgOrBg: 'bg', compareToken: 'brand.secondary_text' },
          { token: 'brand.secondary_text', label: 'Secondary Button Text', fgOrBg: 'fg', compareToken: 'brand.secondary_bg' },
        ],
      },
      {
        id: 'typography',
        title: t('theme_studio.section_typography'),
        items: [
          { token: 'typography.primary', label: 'Primary Text', fgOrBg: 'fg', compareToken: 'surfaces.card' },
          { token: 'typography.secondary', label: 'Secondary Text', fgOrBg: 'fg', compareToken: 'surfaces.card' },
          { token: 'typography.muted', label: 'Muted Text', fgOrBg: 'fg', compareToken: 'surfaces.card' },
          { token: 'typography.inverse', label: 'Inverse Text', fgOrBg: 'other' },
        ],
      },
      {
        id: 'badges',
        title: t('theme_studio.section_badges'),
        items: [
          { token: 'badges.success_bg', label: 'Success BG', fgOrBg: 'bg', compareToken: 'badges.success_text' },
          { token: 'badges.success_text', label: 'Success Text', fgOrBg: 'fg', compareToken: 'badges.success_bg' },
          { token: 'badges.warning_bg', label: 'Warning BG', fgOrBg: 'bg', compareToken: 'badges.warning_text' },
          { token: 'badges.warning_text', label: 'Warning Text', fgOrBg: 'fg', compareToken: 'badges.warning_bg' },
          { token: 'badges.danger_bg', label: 'Danger BG', fgOrBg: 'bg', compareToken: 'badges.danger_text' },
          { token: 'badges.danger_text', label: 'Danger Text', fgOrBg: 'fg', compareToken: 'badges.danger_bg' },
          { token: 'badges.info_bg', label: 'Info BG', fgOrBg: 'bg', compareToken: 'badges.info_text' },
          { token: 'badges.info_text', label: 'Info Text', fgOrBg: 'fg', compareToken: 'badges.info_bg' },
        ],
      },
      {
        id: 'footer',
        title: t('theme_studio.section_footer'),
        items: [
          { token: 'footer.bg', label: 'Footer Background', fgOrBg: 'bg', compareToken: 'footer.text' },
          { token: 'footer.text', label: 'Footer Text', fgOrBg: 'fg', compareToken: 'footer.bg' },
          { token: 'footer.muted', label: 'Footer Muted Text', fgOrBg: 'fg', compareToken: 'footer.bg' },
          { token: 'footer.border', label: 'Footer Border', fgOrBg: 'other' },
        ],
      },
      {
        // The countdown chip is compared against flash_sale.text, not a foreground of its own:
        // the digits inherit the header's ink, so those are the two colours that actually meet.
        id: 'flash_sale',
        title: t('theme_studio.section_flash'),
        items: [
          { token: 'flash_sale.bg', label: 'Flash Strip Background', fgOrBg: 'bg', compareToken: 'flash_sale.text' },
          { token: 'flash_sale.text', label: 'Flash Strip Text & Countdown', fgOrBg: 'fg', compareToken: 'flash_sale.bg' },
          { token: 'flash_sale.chip_bg', label: 'Countdown Chip BG', fgOrBg: 'bg', compareToken: 'flash_sale.text' },
          { token: 'flash_sale.tag_bg', label: 'Product FLASH Tag BG', fgOrBg: 'bg', compareToken: 'flash_sale.tag_text' },
          { token: 'flash_sale.tag_text', label: 'Product FLASH Tag Text', fgOrBg: 'fg', compareToken: 'flash_sale.tag_bg' },
        ],
      },
    ];

    for (const sec of sections) {
      const card = document.createElement('div');
      card.className = 'theme-section-card';

      const secHeader = document.createElement('div');
      secHeader.className = 'theme-section-card__header';
      secHeader.innerHTML = `<span>${sec.title}</span> <span>▼</span>`;

      const secBody = document.createElement('div');
      secBody.className = 'theme-section-card__body';

      secHeader.addEventListener('click', () => {
        const isHidden = secBody.style.display === 'none';
        secBody.style.display = isHidden ? 'flex' : 'none';
        secHeader.querySelector('span:last-child').textContent = isHidden ? '▼' : '▶';
      });

      for (const item of sec.items) {
        const row = createColorRow(item);
        secBody.append(row);
      }

      card.append(secHeader, secBody);
      wrap.append(card);
    }
  }

  function createColorRow(item) {
    const row = document.createElement('div');
    row.className = 'theme-color-row';

    const [secKey, propKey] = item.token.split('.');
    const fallbackPalette = paletteToSectionTokens(generatePalette(masterConfig));
    const currentValue = workingTokens[secKey]?.[propKey] || fallbackPalette[secKey]?.[propKey] || '#ffffff';

    const info = document.createElement('div');
    info.className = 'theme-color-row__info';

    const label = document.createElement('span');
    label.className = 'theme-color-row__label';
    label.textContent = item.label;

    const tokenCode = document.createElement('span');
    tokenCode.className = 'theme-color-row__token';
    tokenCode.textContent = `--${secKey}-${propKey}`;

    info.append(label, tokenCode);

    // Color picker & hex text input & contrast badge
    const control = document.createElement('div');
    control.className = 'theme-color-row__control';

    const labelText = isBn ? item.label_bn : item.label_en;

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'theme-color-picker';
    picker.value = currentValue.startsWith('#') && currentValue.length === 7 ? currentValue : '#ffffff';
    picker.setAttribute('aria-label', `${labelText} color picker`);

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'theme-hex-input';
    hexInput.value = currentValue;
    hexInput.setAttribute('aria-label', `${labelText} hex code`);

    // Contrast readout badge if pair comparison exists
    const contrastBadge = document.createElement('span');
    updateRowContrastBadge(contrastBadge, item, currentValue);

    const onColorChange = (newHex) => {
      if (!newHex.startsWith('#')) newHex = `#${newHex}`;
      picker.value = newHex.length === 7 ? newHex : picker.value;
      hexInput.value = newHex;

      if (!workingTokens[secKey]) workingTokens[secKey] = {};
      workingTokens[secKey][propKey] = newHex;

      // Update runtime DOM CSS custom properties instantly!
      applyTheme(workingTokens);
      updateRowContrastBadge(contrastBadge, item, newHex);
      updateContrastStatusBanner(contrastStatusBanner);
    };

    picker.addEventListener('input', (e) => onColorChange(e.target.value));
    hexInput.addEventListener('input', (e) => onColorChange(e.target.value));

    // 1-Click quick presets / swatches
    const quickSwatchesWrap = document.createElement('div');
    quickSwatchesWrap.className = 'theme-quick-swatches';

    // 1-Click Reset to Default Preset button
    const defaultVal = fallbackPalette[secKey]?.[propKey] || '#ffffff';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'theme-quick-btn';
    resetBtn.title = isBn ? `ডিফল্ট রঙে ফিরুন: ${defaultVal}` : `Reset to default preset: ${defaultVal}`;
    resetBtn.innerHTML = `<span>↺</span> <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${defaultVal};border:1px solid rgba(0,0,0,0.25);"></span>`;
    resetBtn.addEventListener('click', () => {
      onColorChange(defaultVal);
      toast.info(isBn ? `রং ডিফল্টে রিসেট করা হয়েছে: ${defaultVal}` : `Reset color to default: ${defaultVal}`);
    });
    quickSwatchesWrap.append(resetBtn);

    // 1-Click Quick Swatches: Solid Black, Pure White, Brand Seed
    const quickPresetsList = [
      { title: isBn ? 'সলিড ব্ল্যাক (#192026)' : 'Solid Black (#192026)', hex: '#192026' },
      { title: isBn ? 'পিওর হোয়াইট (#ffffff)' : 'Pure White (#ffffff)', hex: '#ffffff' },
      { title: isBn ? 'ব্র্যান্ড অ্যাকসেন্ট' : 'Brand Accent', hex: masterConfig.seed || '#1d4ed8' },
    ];

    for (const qp of quickPresetsList) {
      const swatchBtn = document.createElement('button');
      swatchBtn.type = 'button';
      swatchBtn.className = 'theme-quick-swatch';
      swatchBtn.title = qp.title;
      swatchBtn.style.backgroundColor = qp.hex;
      swatchBtn.addEventListener('click', () => {
        onColorChange(qp.hex);
        toast.info(isBn ? `রং সেট করা হয়েছে: ${qp.hex}` : `Set color to: ${qp.hex}`);
      });
      quickSwatchesWrap.append(swatchBtn);
    }

    control.append(picker, hexInput, quickSwatchesWrap, contrastBadge);
    row.append(info, control);

    return row;
  }

  function updateRowContrastBadge(badgeEl, item, val) {
    if (!item.compareToken) {
      badgeEl.style.display = 'none';
      return;
    }
    const [cSec, cProp] = item.compareToken.split('.');
    const fallbackPalette = paletteToSectionTokens(generatePalette(masterConfig));
    const compareVal = workingTokens[cSec]?.[cProp] || fallbackPalette[cSec]?.[cProp] || '#ffffff';
    const ratio = getContrastRatio(val, compareVal);
    const passes = ratio >= 4.5;

    badgeEl.style.display = 'inline-block';
    badgeEl.style.fontSize = '10px';
    badgeEl.style.padding = '2px 6px';
    badgeEl.style.borderRadius = 'var(--radius-sm)';
    badgeEl.style.fontWeight = '600';

    if (passes) {
      badgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
      badgeEl.style.color = '#047857';
      badgeEl.textContent = `${ratio}:1 ✓`;
    } else {
      badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
      badgeEl.style.color = '#b91c1c';
      badgeEl.textContent = `${ratio}:1 ✗`;
    }
  }

  function updateContrastStatusBanner(bannerEl) {
    const fallbackPalette = paletteToSectionTokens(generatePalette(masterConfig));
    const mergedTokens = { ...workingTokens };
    for (const [secKey, secVals] of Object.entries(fallbackPalette)) {
      mergedTokens[secKey] = { ...secVals, ...(mergedTokens[secKey] || {}) };
    }
    const val = validatePaletteContrast(mergedTokens);
    bannerEl.innerHTML = '';

    if (val.isValid) {
      bannerEl.className = 'grant-preview-box';
      bannerEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      bannerEl.style.background = 'rgba(16, 185, 129, 0.08)';
      bannerEl.style.color = '#065f46';
      bannerEl.textContent = `🛡️ All UI section pairings satisfy WCAG AA standards.`;
      publishBtn.disabled = false;
    } else {
      bannerEl.className = 'grant-preview-box';
      bannerEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      bannerEl.style.background = 'rgba(239, 68, 68, 0.08)';
      bannerEl.style.color = '#991b1b';
      const first = val.failures[0];
      bannerEl.textContent = `⚠️ WCAG AA Failure: ${first.pairing} ratio is ${first.ratio}:1 (required ${first.required}:1). Publishing blocked.`;
      publishBtn.disabled = true;
    }
  }

  /**
   * The preview deliberately includes the surfaces the old preset system could NOT re-theme —
   * input boundaries, hover fills, a live scrollbar, brand-tinted chips and a secondary button.
   * If any of them stays pink after switching seed, the master engine has a gap and this pane is
   * where it shows up first.
   */
  function renderMiniViewport(wrap) {
    wrap.innerHTML = `
      <div class="mini-navbar">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--logo-bg, var(--neutral-900)); color: var(--logo-star, #ffbc00);">
            <svg viewBox="0 0 100 100" width="16" height="16" aria-hidden="true">
              <path d="M50,4 C58,34 66,42 96,50 C66,58 58,66 50,96 C42,66 34,58 4,50 C34,42 42,34 50,4 Z" fill="var(--logo-star, #ffbc00)" />
              <circle cx="50" cy="50" r="9" fill="var(--logo-hole, var(--neutral-900))" />
            </svg>
          </div>
          <span style="font-weight: 700; color: var(--logo-text, var(--navbar-text)); font-size: 13px;">EXPL<span style="color: var(--brand, #ffbc00);">O</span>ORO</span>
        </div>
        <div style="padding: 3px 10px; background: var(--navbar-search-bg); border: 1px solid var(--navbar-border); border-radius: 4px; font-size: 10px; color: var(--navbar-text);">
          Search products, brands…
        </div>
        <div style="display: flex; gap: 8px; align-items: center; color: var(--navbar-icon-color, var(--brand-800)); font-size: 12px;">
          <span>🛒</span>
          <span>🔔</span>
          <span>👤</span>
        </div>
      </div>

      <div class="mini-body">
        <div class="mini-sidebar">
          <div class="mini-sidebar__item mini-sidebar__item--active">
            <span class="mini-sidebar__icon">📊</span>
            <span>Dashboard</span>
          </div>
          <div class="mini-sidebar__item">
            <span class="mini-sidebar__icon">📦</span>
            <span>Products</span>
          </div>
          <div class="mini-sidebar__item">
            <span class="mini-sidebar__icon">🛒</span>
            <span>Orders</span>
          </div>
          <div class="mini-sidebar__item">
            <span class="mini-sidebar__icon">⚙️</span>
            <span>Settings</span>
          </div>
        </div>

        <div class="mini-content">
          <div class="mini-card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700; color: var(--text-primary);">Cotton Casual Shirt</span>
              <span style="padding: 2px 6px; background: var(--success-bg); color: var(--success); border-radius: 4px; font-size: 10px; font-weight: 600;">In Stock</span>
            </div>
            <span style="color: var(--text-secondary); font-size: 11px;">Premium 100% combed cotton. Fast delivery across 64 districts.</span>

            <input class="mini-input" aria-label="Quantity — input border uses --border-interactive" placeholder="Quantity — input border uses --border-interactive" />

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; gap: 8px;">
              <strong style="font-size: 14px; color: var(--text-primary);">৳1,450</strong>
              <div style="display: flex; gap: 6px;">
                <button class="mini-btn mini-btn--secondary">Wishlist</button>
                <button class="mini-btn mini-btn--primary">Buy Now</button>
              </div>
            </div>
            <span class="mini-hint">Hover either button — the fill steps to --brand-hover / --brand-200.</span>
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <span style="padding: 2px 6px; background: var(--warning-bg); color: var(--warning); border-radius: 4px; font-size: 10px; font-weight: 600;">Low Stock</span>
            <span style="padding: 2px 6px; background: var(--danger-bg); color: var(--danger); border-radius: 4px; font-size: 10px; font-weight: 600;">Flash Sale</span>
            <span style="padding: 2px 6px; background: var(--info-bg); color: var(--info); border-radius: 4px; font-size: 10px; font-weight: 600;">Verified Merchant</span>
          </div>

          <div class="mini-flash">
            <div class="mini-flash__header">
              <span class="mini-flash__title">⚡ FLASH SALE</span>
              <span class="mini-flash__timer">
                <span class="mini-flash__chip">02</span>:<span class="mini-flash__chip">14</span>:<span class="mini-flash__chip">09</span>
              </span>
            </div>
            <div class="mini-flash__body">
              <span class="mini-flash__tag">FLASH</span>
              <span>Product cards in the strip carry the tag above.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mini-footer">
        <div style="display: flex; justify-content: space-between;">
          <span>© 2026 Explooro Technologies.</span>
          <span style="color: var(--footer-muted);">Dhaka, Bangladesh</span>
        </div>
      </div>
    `;
  }

  function handleResetDefault() {
    activePresetKey = DEFAULT_MASTER_PRESET;
    masterConfig = { ...MASTER_PRESETS[DEFAULT_MASTER_PRESET].master };
    workingTokens = themeFromMaster(masterConfig);
    refreshAll();
    toast.info(t('theme_studio.reset_info'));
  }

  function handleRevertPublished() {
    workingTokens = JSON.parse(JSON.stringify(publishedTokens));
    masterConfig = workingTokens.master
      ? { ...workingTokens.master }
      : { ...MASTER_PRESETS[DEFAULT_MASTER_PRESET].master };
    refreshAll();
    toast.info(isBn ? 'পাবলিশড অবস্থায় ফিরিয়ে নেওয়া হয়েছে' : 'Reverted to published theme');
  }

  async function handleSaveDraft() {
    if (!validateNoGradients(workingTokens)) {
      toast.error(t('theme_studio.gradient_error'));
      return;
    }

    const name = await promptForThemeName(isBn ? 'আমার থিম' : 'My Theme');
    if (!name) return;

    try {
      const res = await api.post('/admin/theme/draft', {
        name,
        preset_key: activePresetKey,
        tokens: workingTokens,
      });
      activePaletteId = res.draft?.id || activePaletteId;
      toast.success(t('theme_studio.draft_success'));
      loadSavedThemes();
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    }
  }

  /** Small text-entry dialog so a saved theme can be found again by name, not by guesswork. */
  function promptForThemeName(defaultValue = '') {
    return new Promise((resolve) => {
      let settled = false;

      const nameField = Input({
        label: t('theme_studio.save_name_label'),
        placeholder: t('theme_studio.save_name_placeholder'),
        value: defaultValue,
        maxLength: 60,
        showCounter: true,
      });

      const cancelBtn = Button({
        label: t('common.cancel'),
        variant: 'secondary',
        onClick: () => finish(null),
      });

      const confirmBtn = Button({
        label: t('theme_studio.save_name_confirm'),
        variant: 'primary',
        onClick: () => {
          const value = nameField.value.trim();
          if (!value) {
            nameField.setError(t('theme_studio.save_name_required'));
            return;
          }
          finish(value);
        },
      });

      const footer = document.createDocumentFragment();
      footer.append(cancelBtn, confirmBtn);

      const modal = Modal({
        title: t('theme_studio.save_name_title'),
        content: nameField,
        footer,
        size: 'sm',
        onClose: () => finish(null),
      });

      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value);
        modal.closeModal(Boolean(value));
        setTimeout(() => modal.remove(), 400);
      }

      document.body.append(modal);
      modal.openModal(draftBtn);
      requestAnimationFrame(() => nameField.focus());
    });
  }

  async function loadSavedThemes() {
    try {
      const res = await api.get('/admin/theme/palettes');
      savedThemes = res.palettes || [];
    } catch {
      savedThemes = [];
    }
    renderSavedThemesList(savedThemesList);
  }

  function renderSavedThemesList(wrap) {
    wrap.innerHTML = '';

    if (!savedThemes.length) {
      const empty = document.createElement('p');
      empty.className = 'theme-saved__empty';
      empty.textContent = t('theme_studio.saved_empty');
      wrap.append(empty);
      return;
    }

    for (const palette of savedThemes) {
      const row = document.createElement('div');
      row.className = 'theme-saved__row';

      const info = document.createElement('div');
      info.className = 'theme-saved__info';

      const nameRow = document.createElement('div');
      nameRow.className = 'theme-saved__name-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'theme-saved__name';
      nameEl.textContent = palette.name;
      nameRow.append(nameEl);

      if (palette.is_active) {
        nameRow.append(Badge({ label: t('theme_studio.saved_badge_live'), variant: 'success', size: 'sm' }));
      } else if (palette.is_published) {
        nameRow.append(Badge({ label: t('theme_studio.saved_badge_published'), variant: 'neutral', size: 'sm' }));
      }

      const meta = document.createElement('span');
      meta.className = 'theme-saved__meta';
      meta.textContent = formatRelativeTime(palette.updated_at, { lang: isBn ? 'bn' : 'en' });

      info.append(nameRow, meta);

      const actions = document.createElement('div');
      actions.className = 'theme-saved__actions';

      const applyBtn = Button({
        label: t('theme_studio.saved_apply'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => applySavedTheme(palette),
      });

      const editBtn = Button({
        label: `✏️ ${t('theme_studio.saved_edit')}`,
        variant: 'ghost',
        size: 'sm',
        onClick: () => handleRenameTheme(palette),
      });

      const deleteBtn = Button({
        label: `🗑️ ${t('theme_studio.saved_delete')}`,
        variant: 'ghost',
        size: 'sm',
        onClick: () => handleDeleteTheme(palette),
      });

      actions.append(applyBtn, editBtn, deleteBtn);
      row.append(info, actions);
      wrap.append(row);
    }
  }

  function applySavedTheme(palette) {
    const stored = typeof palette.tokens_json === 'string'
      ? JSON.parse(palette.tokens_json)
      : palette.tokens_json;

    activePaletteId = palette.id;
    activePresetKey = palette.preset_key || 'custom';
    workingTokens = stored.master ? stored : themeFromLegacyTokens(stored);
    masterConfig = { ...workingTokens.master };
    refreshAll();
    toast.info(isBn ? `থিম প্রয়োগ করা হয়েছে: ${palette.name}` : `Applied theme: ${palette.name}`);
  }

  async function handleRenameTheme(palette) {
    const name = await promptForThemeName(palette.name);
    if (!name || name === palette.name) return;

    try {
      await api.patch(`/admin/theme/${palette.id}`, { name });
      toast.success(t('theme_studio.saved_rename_success'));
      loadSavedThemes();
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    }
  }

  async function handleDeleteTheme(palette) {
    const confirmed = await confirmDialog({
      title: t('theme_studio.saved_delete_confirm_title'),
      description: t('theme_studio.saved_delete_confirm_desc', { name: palette.name }),
      confirmLabel: t('theme_studio.saved_delete'),
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/admin/theme/${palette.id}`);
      toast.success(t('theme_studio.saved_delete_success'));
      loadSavedThemes();
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    }
  }

  async function handlePublishTheme() {
    const contrastRes = validatePaletteContrast(workingTokens);
    if (!contrastRes.isValid) {
      const first = contrastRes.failures[0];
      toast.error(`${t('theme_studio.contrast_error_title')}: ${first.message}`);
      return;
    }

    if (!validateNoGradients(workingTokens)) {
      toast.error(t('theme_studio.gradient_error'));
      return;
    }

    if (!isAdmin) {
      // Moderator / non-admin Maker-Checker elevation request flow
      const conf = await confirmDialogWithReason({
        title: t('theme_studio.mod_request_title') || (isBn ? 'থিম পরিবর্তনের অনুমতি আবেদন' : 'Submit Theme Change Request'),
        description: t('theme_studio.mod_request_desc') || (isBn ? 'মডারেটর হিসেবে আপনার থিম পরিবর্তনটি অ্যাডমিনের Approval Inbox-এ অনুমোদনের জন্য জমা হবে।' : 'As a moderator, your theme customization will be submitted to the Admin Approval Inbox for verification before going live.'),
        reasonRequired: true,
        trigger: publishBtn,
      });

      if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 5) return;

      try {
        publishBtn.setLoading(true);
        // Save draft first to get/update palette id
        const draftRes = await api.post('/admin/theme/draft', {
          name: `${activePresetKey.toUpperCase()} Proposed Palette`,
          preset_key: activePresetKey,
          tokens: workingTokens,
        });

        await api.post('/access-requests/action', {
          action_key: 'platform.theme.publish',
          target_entity_type: 'THEME_PALETTE',
          target_entity_id: activePresetKey,
          reason: conf.reason.trim(),
          payload_json: {
            preset_key: activePresetKey,
            tokens: workingTokens,
            draft_id: draftRes.draft?.id,
          },
        }).catch(() => ({}));

        toast.info(isBn ? 'থিম পরিবর্তনের আবেদন এডমিনের অনুমোদনের জন্য পাঠানো হয়েছে।' : 'Theme publish request submitted to Admin Approval Inbox.');
      } catch (err) {
        toast.error(err.message || t('common.error_generic'));
      } finally {
        publishBtn.setLoading(false);
      }
      return;
    }

    // Admin / SuperAdmin direct publish flow
    const conf = await confirmDialogWithReason({
      title: t('theme_studio.confirm_publish_title'),
      description: t('theme_studio.confirm_publish_desc'),
      reasonRequired: true,
      trigger: publishBtn,
    });

    if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 5) return;

    try {
      publishBtn.setLoading(true);
      // Save draft first to get/update palette id
      const draftRes = await api.post('/admin/theme/draft', {
        name: `${activePresetKey.toUpperCase()} Published Palette`,
        preset_key: activePresetKey,
        tokens: workingTokens,
      });

      const paletteId = draftRes.draft?.id || 1;

      // Publish target palette
      await api.post(`/admin/theme/${paletteId}/publish`, {
        reason: conf.reason.trim(),
      });

      publishedTokens = JSON.parse(JSON.stringify(workingTokens));
      cacheActiveTheme(workingTokens, activePresetKey);
      loadSavedThemes();
      toast.success(t('theme_studio.publish_success'));
    } catch (err) {
      toast.error(err.message || t('common.error_generic'));
    } finally {
      publishBtn.setLoading(false);
    }
  }

  async function loadActiveThemeFromServer() {
    try {
      const res = await api.get('/theme/active');
      if (res?.theme?.tokens_json) {
        publishedTokens = res.theme.tokens_json;
        activePaletteId = res.theme.id;
        // Only initialise workingTokens from server if there was no theme already loaded in the client runtime.
        // Overwriting workingTokens when a theme is already applied would wipe out the user's active theme on nav click.
        if (!liveMaster && !liveTokens) {
          activePresetKey = res.theme.preset_key || DEFAULT_MASTER_PRESET;
          const stored = JSON.parse(JSON.stringify(publishedTokens));
          workingTokens = stored.master ? stored : themeFromLegacyTokens(stored);
          masterConfig = { ...workingTokens.master };
          refreshAll();
        }
      }
    } catch {
      // Offline fallback
    }
  }

  loadActiveThemeFromServer();
  loadSavedThemes();

  root.append(container);
}
