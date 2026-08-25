/**
 * ThemeStudioPage.js — Granular Component-Level Color Studio with 6 Sections, 5 Presets & Live Preview (Prompt 3.5).
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { THEME_PRESETS } from '../../config/theme-presets.js';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../../config/master-themes.js';
import {
  applyTheme,
  getContrastRatio,
  validatePaletteContrast,
  validateNoGradients,
  themeFromMaster,
  themeFromLegacyTokens,
} from '../../services/themePalette.js';
import {
  generatePalette, BRAND_STEPS, NEUTRAL_STEPS, MASTER_RANGES,
} from '../../services/colorRamp.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { appStore } from '../../state/appStore.js';

export default function ThemeStudioPage(root) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'theme-studio';

  const authState = appStore.get()?.auth || {};
  const isSuperAdmin = (authState.roles || []).includes('super_admin') || authState.role === 'super_admin';

  let activePresetKey = DEFAULT_MASTER_PRESET;
  let masterConfig = { ...MASTER_PRESETS[DEFAULT_MASTER_PRESET].master };
  let workingTokens = themeFromMaster(masterConfig);
  let publishedTokens = JSON.parse(JSON.stringify(workingTokens));
  let activePaletteId = null;

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
    label: `🚀 ${t('theme_studio.btn_publish')}`,
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

  // Master Colour Section - the one control that re-themes the whole product.
  const masterWrap = document.createElement('div');
  masterWrap.className = 'theme-master';

  // Presets Section
  const presetsWrap = document.createElement('div');
  presetsWrap.className = 'theme-presets';

  const presetsHeading = document.createElement('h2');
  presetsHeading.className = 'text-sm font-semibold';
  presetsHeading.textContent = t('theme_studio.presets_title');

  const presetsGrid = document.createElement('div');
  presetsGrid.className = 'theme-presets__grid';
  renderPresetsGrid(presetsGrid);

  presetsWrap.append(presetsHeading, presetsGrid);

  // 6 Section Color Controls
  const sectionsWrap = document.createElement('div');
  sectionsWrap.className = 'theme-sections';

  const sectionsHeading = document.createElement('h2');
  sectionsHeading.className = 'text-sm font-semibold';
  sectionsHeading.textContent = t('theme_studio.sections_title');

  sectionsWrap.append(sectionsHeading);
  renderSectionAccordions(sectionsWrap);

  leftCol.append(masterWrap, presetsWrap, sectionsWrap);

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
  container.append(header, layout);

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
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      const seed = preset.tokens.brand?.primary || preset.preview_swatch || '#333333';
      const card = document.createElement('div');
      card.className = `theme-preset-card ${activePresetKey === key ? 'theme-preset-card--active' : ''}`;

      const swatch = document.createElement('div');
      swatch.className = 'theme-preset-card__swatch';
      swatch.style.background = preset.preview_swatch || seed;
      swatch.textContent = preset.key.toUpperCase().substring(0, 3);

      const name = document.createElement('span');
      name.className = 'theme-preset-card__name';
      name.textContent = isBn ? preset.name_bn : preset.name_en;

      card.append(swatch, name);

      card.addEventListener('click', () => {
        activePresetKey = key;
        workingTokens = themeFromLegacyTokens(preset.tokens);
        masterConfig = { ...workingTokens.master };
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
          { token: 'navbar.text', label: 'Navbar Text / Icons', fgOrBg: 'fg', compareToken: 'navbar.bg' },
          { token: 'navbar.border', label: 'Navbar Border', fgOrBg: 'other' },
          { token: 'navbar.search_bg', label: 'Search Input BG', fgOrBg: 'other' },
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
    const currentValue = workingTokens[secKey]?.[propKey] || '#ffffff';

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

    control.append(picker, hexInput, contrastBadge);
    row.append(info, control);

    return row;
  }

  function updateRowContrastBadge(badgeEl, item, val) {
    if (!item.compareToken) {
      badgeEl.style.display = 'none';
      return;
    }
    const [cSec, cProp] = item.compareToken.split('.');
    const compareVal = workingTokens[cSec]?.[cProp] || '#ffffff';
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
    const val = validatePaletteContrast(workingTokens);
    bannerEl.innerHTML = '';

    if (val.isValid) {
      bannerEl.className = 'grant-preview-box';
      bannerEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      bannerEl.style.background = 'rgba(16, 185, 129, 0.08)';
      bannerEl.style.color = '#065f46';
      bannerEl.textContent = `🛡️ All 6 UI section pairings satisfy WCAG AA standards.`;
      publishBtn.disabled = !isSuperAdmin;
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
          <span style="font-weight: 700;">Explooro</span>
          <span style="font-size: 10px; opacity: 0.7;">Marketplace</span>
        </div>
        <div style="padding: 3px 10px; background: var(--navbar-search-bg); border: 1px solid var(--navbar-border); border-radius: 4px; font-size: 10px; color: var(--navbar-text);">
          Search products, brands…
        </div>
        <div style="display: flex; gap: 6px;">
          <span>🛒 Cart</span>
          <span>👤 Profile</span>
        </div>
      </div>

      <div class="mini-content">
        <div class="mini-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; color: var(--text-primary);">Cotton Casual Shirt</span>
            <span style="padding: 2px 6px; background: var(--success-bg); color: var(--success); border-radius: 4px; font-size: 10px; font-weight: 600;">In Stock</span>
          </div>
          <span style="color: var(--text-secondary); font-size: 11px;">Premium 100% combed cotton. Fast delivery across 64 districts.</span>

          <input class="mini-input" placeholder="Quantity — input border uses --border-interactive" />

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
          <span style="padding: 2px 6px; background: var(--accent-100); color: var(--accent-700); border-radius: 4px; font-size: 10px; font-weight: 600;">Accent · 2h left</span>
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

        <div class="mini-scroll" tabindex="0" aria-label="Scrollbar preview">
          <div class="mini-scroll__inner">
            <span>Scroll this strip sideways — the thumb paints with --border-strong.</span>
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
    regenerateFromMaster();
    toast.info(isBn ? 'ডিফল্ট থিমে ফিরিয়ে নেওয়া হয়েছে' : 'Reset to default theme');
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

    try {
      const res = await api.post('/admin/theme/draft', {
        name: `${activePresetKey.toUpperCase()} Draft`,
        preset_key: activePresetKey,
        tokens: workingTokens,
      });
      activePaletteId = res.draft?.id || activePaletteId;
      toast.success(t('theme_studio.draft_success'));
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

    const conf = await confirmDialogWithReason({
      title: t('theme_studio.confirm_publish_title'),
      description: t('theme_studio.confirm_publish_desc'),
      reasonRequired: true,
      trigger: publishBtn,
    });

    if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

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
        activePresetKey = res.theme.preset_key || DEFAULT_MASTER_PRESET;
        const stored = JSON.parse(JSON.stringify(publishedTokens));
        // A palette published before the master engine existed has no `master` block. The same
        // migration initTheme() uses on boot runs here, so the studio opens showing exactly what
        // the live site renders rather than a second interpretation of the same stored palette.
        workingTokens = stored.master ? stored : themeFromLegacyTokens(stored);
        masterConfig = { ...workingTokens.master };
        refreshAll();
      }
    } catch {
      // Offline fallback
    }
  }

  loadActiveThemeFromServer();

  root.append(container);
}
