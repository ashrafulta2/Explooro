/**
 * SupplierMarketingKitsPage.js — A supplier writes the promotion a saler can copy for each product:
 * captions in both languages, hashtags, selling points and a video link.
 *
 * Route: /supplier/marketing-kits  (module: sourcing, read: supplier.analytics.view, write: supplier.sample.manage)
 *
 * WHY one <details> per product: a supplier may have hundreds of products, and a form per product open
 * at once is unusable. Closed, each row still says in words whether it has a kit and whether salers
 * can see it.
 */
import { sampleKitApi } from '../../services/sampleKit.api.js';
import { Button } from '../../components/ui/Button.js';
import { Switch } from '../../components/ui/Switch.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { toast } from '../../services/toast.js';
import { pickMessage } from '../../core/api.js';
import { t } from '../../services/i18n.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(labelText, control, hint) {
  const wrap = el('label', 'incentive-field');
  wrap.append(el('span', 'incentive-field__label', labelText), control);
  if (hint) wrap.append(el('span', 'incentive-card__note', hint));
  return wrap;
}

function textInput(value, { rows = 0, placeholder = '', maxLength } = {}) {
  const node = document.createElement(rows ? 'textarea' : 'input');
  if (rows) node.rows = rows;
  else node.type = 'text';
  node.className = rows ? 'incentive-input kit-textarea' : 'incentive-input';
  node.value = value ?? '';
  if (placeholder) node.placeholder = placeholder;
  if (maxLength) node.maxLength = maxLength;
  return node;
}

/** One hashtag or selling point per entry; commas and new lines both separate. */
export function splitEntries(value, separator) {
  return String(value || '').split(separator).map((s) => s.trim()).filter(Boolean);
}

export default function SupplierMarketingKitsPage(root) {
  const container = el('div', 'supplier-page-container');

  const header = el('header', 'supplier-header');
  header.append(el('h1', '', t('kit.supplier_title', 'Marketing Kits')), el('p', 'supplier-header__sub', t('kit.supplier_subtitle')));

  const body = el('div', 'incentive-stack');
  body.setAttribute('aria-live', 'polite');
  body.append(Skeleton({ height: '220px' }));
  container.append(header, body);
  // WHY mounted here: the router calls `page(root)` and does not append a returned node.
  root.append(container);

  let view = null;

  async function load() {
    const res = await sampleKitApi.getSupplierKits();
    view = res?.data ?? res;
    render();
  }

  function kitState(p) {
    if (!p.kit_id) return t('kit.state_none');
    return p.is_published ? t('kit.state_published') : t('kit.state_hidden');
  }

  function productForm(p) {
    const form = el('form', 'incentive-form');
    form.noValidate = true;

    const rules = view.rules;
    const captionEn = textInput(p.caption_en, { rows: 3, maxLength: rules.caption_max_chars });
    const captionBn = textInput(p.caption_bn, { rows: 3, maxLength: rules.caption_max_chars });
    const hashtags = textInput((p.hashtags || []).join(', '), { placeholder: '#eid, #panjabi' });
    const points = textInput((p.selling_points || []).join('\n'), { rows: 4 });
    const video = textInput(p.video_url, { placeholder: 'https://' });
    let published = p.kit_id ? Boolean(p.is_published) : true;

    form.append(
      field(t('kit.caption_en'), captionEn),
      field(t('kit.caption_bn'), captionBn),
      field(t('kit.hashtags'), hashtags, t('kit.hashtags_hint', { max: rules.max_hashtags })),
      field(t('kit.points'), points, t('kit.points_hint', { max: rules.max_selling_points })),
      field(t('kit.video'), video),
      Switch({ label: t('kit.publish'), checked: published, onChange: (on) => { published = on; } })
    );

    // WHY never created busy: a save re-renders the list (via load()) while `saving` is still true, so a
    // new button must not inherit it. The `saving` guard in the submit handler stops a double submit.
    const save = Button({ label: t('kit.save'), type: 'submit' });
    const actions = el('div', 'incentive-actions');
    actions.append(save);
    form.append(actions);

    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      save.setLoading(true);
      try {
        await sampleKitApi.saveKit(p.product_id, {
          caption_en: captionEn.value,
          caption_bn: captionBn.value,
          hashtags: splitEntries(hashtags.value, /[,\s]+/),
          selling_points: splitEntries(points.value, /\n/),
          video_url: video.value,
          is_published: published,
        });
        await load();
        toast.success(t('kit.saved'));
      } catch (err) {
        toast.error(pickMessage(err) || t('kit.save_failed'));
      } finally {
        saving = false;
        save.setLoading(false);
      }
    });
    return form;
  }

  function render() {
    if (!view.products.length) {
      body.replaceChildren(EmptyState({ title: t('kit.no_products'), compact: true }));
      return;
    }
    const intro = el('section', 'incentive-card');
    intro.append(el('h2', 'incentive-card__title', t('kit.how_title')), el('p', 'incentive-card__text', t('kit.how_body')));

    const list = el('div', 'kit-list');
    for (const p of view.products) {
      const details = el('details', 'incentive-card kit-item');
      const summary = el('summary', 'kit-item__summary');
      summary.append(el('span', 'kit-item__title', p.title_en), el('span', 'incentive-status incentive-status--info', kitState(p)));
      details.append(summary, productForm(p));
      list.append(details);
    }
    body.replaceChildren(intro, list);
  }

  (async () => {
    try {
      await load();
    } catch (err) {
      console.error('Failed to load marketing kits:', err);
      toast.error(t('kit.load_failed'));
      body.replaceChildren(EmptyState({ title: t('kit.load_failed') }));
    }
  })();

  return () => container.remove();
}
