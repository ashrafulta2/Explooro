/**
 * CreativeStudioPage.js — AI Ad Copy Generator for Salers (Prompt 10.3).
 *
 * Route: /saler/creative-studio
 * Gated by: `ai_creative_studio` module flag, `ai.creative.use` permission.
 *
 * Generates a short, bilingual-ready ad caption grounded in a real product from the saler's own
 * store (POST /ai/creative/ad-copy) — never a fabricated price/feature. The draft is copy-only:
 * there is no "post" button, so "never auto-publish" holds by construction, not by a checkbox.
 */
import { api } from '../../core/api.js';
import { getSalerStoreItems } from '../../services/catalog.api.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { whyDenied } from '../../services/permissions.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

const TONES = ['friendly', 'urgent', 'premium'];

export default function CreativeStudioPage(root) {
  const container = document.createElement('div');
  container.className = 'creative-studio-page';
  container.setAttribute('data-module', 'ai_creative_studio');

  if (!isFeatureEnabled('ai_creative_studio') || whyDenied('ai.creative.use', 'ai_creative_studio') !== 'held') {
    container.append(
      EmptyState({
        title: t('ai.creative_studio_title'),
        description: t('ai.module_off_creative'),
      })
    );
    root.append(container);
    return () => {};
  }

  const header = document.createElement('header');
  header.className = 'creative-studio-page__header';
  const title = document.createElement('h1');
  title.textContent = t('ai.creative_studio_title');
  const subtitle = document.createElement('p');
  subtitle.className = 'creative-studio-page__subtitle';
  subtitle.textContent = t('ai.creative_studio_subtitle');
  header.append(title, subtitle);

  const disclaimer = document.createElement('p');
  disclaimer.className = 'creative-studio-page__disclaimer';
  disclaimer.textContent = t('ai.creative_disclaimer');

  const form = document.createElement('form');
  form.className = 'creative-studio-page__form';

  const productField = document.createElement('label');
  productField.className = 'creative-studio-page__field';
  const productLabel = document.createElement('span');
  productLabel.textContent = t('ai.select_product_label');
  const productSelect = document.createElement('select');
  productSelect.className = 'select';
  productSelect.disabled = true;
  productField.append(productLabel, productSelect);

  const toneField = document.createElement('label');
  toneField.className = 'creative-studio-page__field';
  const toneLabel = document.createElement('span');
  toneLabel.textContent = t('ai.tone_label');
  const toneSelect = document.createElement('select');
  toneSelect.className = 'select';
  for (const tone of TONES) {
    const opt = document.createElement('option');
    opt.value = tone;
    opt.textContent = t(`ai.tone_${tone}`);
    toneSelect.append(opt);
  }
  toneField.append(toneLabel, toneSelect);

  const langField = document.createElement('label');
  langField.className = 'creative-studio-page__field';
  const langLabel = document.createElement('span');
  langLabel.textContent = t('ai.language_label');
  const langSelect = document.createElement('select');
  langSelect.className = 'select';
  [
    ['bn', 'বাংলা'],
    ['en', 'English'],
  ].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    langSelect.append(opt);
  });
  langSelect.value = getLanguage() === 'bn' ? 'bn' : 'en';
  langField.append(langLabel, langSelect);

  const submitBtn = Button({ label: t('ai.generate_ad_copy'), variant: 'primary', type: 'submit' });
  const controls = document.createElement('div');
  controls.className = 'creative-studio-page__controls';
  controls.append(submitBtn);

  form.append(productField, toneField, langField, controls);

  const resultSection = document.createElement('section');
  resultSection.className = 'creative-studio-page__result';
  resultSection.hidden = true;

  const resultTitle = document.createElement('h2');
  resultTitle.textContent = t('ai.ad_copy_result_title');
  const resultText = document.createElement('p');
  resultText.className = 'creative-studio-page__draft-text';
  const copyBtn = Button({ label: t('ai.copy_to_clipboard'), variant: 'secondary' });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultText.textContent || '');
      toast.success(t('ai.copied_success'));
    } catch {
      // Clipboard API unavailable — the text is still visible and selectable, so this is a
      // silent no-op rather than a hard failure.
    }
  });
  resultSection.append(resultTitle, resultText, copyBtn);

  container.append(header, disclaimer, form, resultSection);

  getSalerStoreItems()
    .then((items) => {
      productSelect.innerHTML = '';
      if (items.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = t('ai.no_products_in_store');
        productSelect.append(opt);
        submitBtn.setDisabled(true);
        return;
      }
      for (const item of items) {
        const opt = document.createElement('option');
        opt.value = String(item.product_id);
        opt.textContent = item.title_en || item.title_bn || `#${item.product_id}`;
        productSelect.append(opt);
      }
      productSelect.disabled = false;
    })
    .catch(() => {
      const opt = document.createElement('option');
      opt.textContent = t('ai.no_products_in_store');
      productSelect.append(opt);
      submitBtn.setDisabled(true);
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!productSelect.value) return;

    submitBtn.setLoading(true);
    submitBtn.setLabel(t('ai.generating'));

    try {
      const res = await api.post('/ai/creative/ad-copy', {
        product_id: parseInt(productSelect.value, 10),
        tone: toneSelect.value,
      }, {
        headers: { 'Accept-Language': langSelect.value },
      });
      const draft = res?.data || res;
      resultText.textContent = draft.draft_text;
      resultSection.hidden = false;
    } catch {
      toast.error(t('ai.error_generic'));
    } finally {
      submitBtn.setLoading(false);
      submitBtn.setLabel(t('ai.generate_ad_copy'));
    }
  });

  root.append(container);
  return () => {};
}
