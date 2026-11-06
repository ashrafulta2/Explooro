/**
 * LegalPage.ts — /legal/:doc, the terms, privacy policy, refund policy and Explooro partner agreement.
 *
 * Public: no sign-in, no module, and locked LIVE in page availability (services/pageAccess.ts),
 * because the platform must never take an order with its terms hidden. The text, version and date
 * come from GET /legal/documents/:key; `?version=N` shows an older version, labelled as such, so
 * anyone can read exactly what they agreed to.
 */

import { getLegalDocument, type LegalDocument } from '../services/legal.api.ts';
import { renderLegalText } from '../services/legalText.ts';
import { LEGAL_DOCS, legalDocBySlug } from '../config/legal.ts';
import { t, getLanguage } from '../services/i18n.ts';
import { formatDate } from '../services/format.ts';
import type { PageContext } from './types.ts';
import '../styles/components/legal.css';

export default function LegalPage(root: HTMLElement, { params = {}, query = {}, navigate }: PageContext = {}) {
  const def = legalDocBySlug(params.doc);
  const container = document.createElement('div');
  container.className = 'legal-page';
  root.replaceChildren(container);

  const link = (href: string, text: string, cls = '') => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (cls) a.className = cls;
    a.addEventListener('click', (e) => {
      if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(href);
    });
    return a;
  };

  function otherDocs() {
    const nav = document.createElement('nav');
    nav.className = 'legal-page__others';
    nav.setAttribute('aria-label', t('legal.other_documents'));
    for (const d of LEGAL_DOCS) {
      const a = link(d.path, t(d.labelKey), 'legal-page__other');
      if (d.key === def?.key) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    return nav;
  }

  function message(text: string) {
    container.replaceChildren();
    const p = document.createElement('p');
    p.className = 'legal-page__message';
    p.textContent = text;
    container.append(p, otherDocs());
  }

  function render(doc: LegalDocument) {
    const bn = getLanguage() === 'bn';
    const title = bn ? doc.title_bn : doc.title_en;
    const { html, headings } = renderLegalText(bn ? doc.body_bn : doc.body_en);
    document.title = `${title} — Explooro`;
    container.replaceChildren();

    const header = document.createElement('header');
    header.className = 'legal-page__header';
    const h1 = document.createElement('h1');
    h1.className = 'legal-page__title';
    h1.textContent = title;
    const meta = document.createElement('p');
    meta.className = 'legal-page__meta';
    meta.textContent = t('legal.meta', {
      version: doc.version,
      date: formatDate(doc.published_at, { lang: bn ? 'bn' : 'en', dateStyle: 'long' }),
    });
    header.append(h1, meta);

    if (!doc.is_current) {
      const old = document.createElement('p');
      old.className = 'legal-page__old';
      old.setAttribute('role', 'note');
      old.append(document.createTextNode(`${t('legal.old_version', { version: doc.version })} `),
        link(def!.path, t('legal.read_current', { version: doc.current_version })));
      header.append(old);
    }

    if (doc.versions.length > 1) {
      const wrap = document.createElement('div');
      wrap.className = 'legal-page__versions';
      const label = document.createElement('label');
      label.htmlFor = 'legal-version';
      label.textContent = t('legal.version_label');
      const select = document.createElement('select');
      select.id = 'legal-version';
      select.className = 'legal-page__version-select';
      for (const v of doc.versions) {
        const opt = document.createElement('option');
        opt.value = String(v.version);
        opt.textContent = t('legal.version_option', {
          version: v.version,
          date: formatDate(v.published_at, { lang: bn ? 'bn' : 'en', dateStyle: 'medium' }),
        });
        opt.selected = v.version === doc.version;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        const v = Number(select.value);
        const href = v === doc.current_version ? def!.path : `${def!.path}?version=${v}`;
        if (navigate) navigate(href);
        else window.location.assign(href);
      });
      wrap.append(label, select);
      header.append(wrap);
    }

    const layout = document.createElement('div');
    layout.className = 'legal-page__layout';

    if (headings.length > 2) {
      const toc = document.createElement('nav');
      toc.className = 'legal-page__toc';
      toc.setAttribute('aria-label', t('legal.contents'));
      const tocTitle = document.createElement('p');
      tocTitle.className = 'legal-page__toc-title';
      tocTitle.textContent = t('legal.contents');
      const ol = document.createElement('ol');
      for (const h of headings) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `#${h.id}`;
        a.textContent = h.text;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        li.append(a);
        ol.append(li);
      }
      toc.append(tocTitle, ol);
      layout.append(toc);
    }

    const article = document.createElement('article');
    article.className = 'legal-page__body';
    // Safe: renderLegalText escapes every character of the text before adding its own tags.
    article.innerHTML = html;
    layout.append(article);

    container.append(header, layout, otherDocs());
  }

  if (!def) {
    message(t('legal.not_found'));
    return () => {};
  }

  const loading = document.createElement('p');
  loading.className = 'legal-page__message';
  loading.textContent = t('common.loading');
  container.append(loading);

  const version = query.version ? Number(query.version) : null;
  let alive = true;
  getLegalDocument(def.key, Number.isInteger(version) && version > 0 ? version : null)
    .then((doc) => { if (alive) render(doc); })
    .catch((err) => { if (alive) message(err?.status === 404 ? t('legal.not_found') : (err?.message || t('legal.load_failed'))); });

  return () => { alive = false; };
}
