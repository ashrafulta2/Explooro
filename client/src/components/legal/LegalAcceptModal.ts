/**
 * LegalAcceptModal.ts — asks a signed-in account to agree to new or updated legal documents.
 *
 * Shown on boot when GET /me/legal/pending lists anything: a first agreement (an account made before
 * the documents existed, or one whose sign-up box was not recorded) or a new version published with
 * "everyone must agree again" (/admin/platform/legal).
 *
 * WHY it cannot be dismissed: agreeing is the point. No close button, no scrim click, and Escape
 * reopens it. The way out is Sign out. The box is never pre-ticked and the button stays disabled
 * until it is ticked (docs/super-admin-audit.md §5 invariant 9). Each document opens in a new tab,
 * so reading it does not lose the dialog.
 */

import { Modal } from '../ui/Modal.ts';
import { Button } from '../ui/Button.ts';
import { Checkbox } from '../ui/Checkbox.ts';
import { acceptLegal, getPendingLegal, type PendingLegalDoc } from '../../services/legal.api.ts';
import { logout } from '../../services/session.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import '../../styles/components/legal.css';

export interface LegalAcceptOptions {
  /** Called once everything is agreed. */
  onAccepted?: () => void;
  /** Where Sign out goes. Defaults to a full reload of /login. */
  onSignedOut?: () => void;
  /** Overrides the network calls (gallery, tests). */
  acceptFn?: (ids: number[]) => Promise<PendingLegalDoc[]>;
  logoutFn?: () => Promise<void>;
}

/** Builds the dialog for these documents. Exported for the gallery; boot uses checkAndPromptLegal. */
export function LegalAcceptModal(initial: PendingLegalDoc[], {
  onAccepted,
  onSignedOut = () => window.location.assign('/login'),
  acceptFn = acceptLegal,
  logoutFn = logout,
}: LegalAcceptOptions = {}) {
  let pending = initial;
  let done = false;
  let leaving = false;

  const body = document.createElement('div');
  const footer = document.createElement('div');
  footer.className = 'legal-accept__actions';

  const modal = Modal({
    title: t('legal.accept.title'),
    content: body,
    footer,
    size: 'md',
    showClose: false,
    closeOnScrim: false,
    important: true,
    onClose: () => {
      // Escape closes a <dialog> natively; put it straight back until the person agrees or leaves.
      if (!done && !leaving) setTimeout(() => modal.openModal(), 0);
    },
  });

  function draw() {
    const bn = getLanguage() === 'bn';
    const isUpdate = pending.some((d) => d.change_note_en || d.change_note_bn);
    body.replaceChildren();
    footer.replaceChildren();

    const intro = document.createElement('p');
    intro.className = 'legal-accept__intro';
    intro.textContent = t(isUpdate ? 'legal.accept.intro_update' : 'legal.accept.intro_first');

    const list = document.createElement('ul');
    list.className = 'legal-accept__list';
    for (const d of pending) {
      const li = document.createElement('li');
      li.className = 'legal-accept__item';
      const a = document.createElement('a');
      a.href = d.path;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `${bn ? d.title_bn : d.title_en} · ${t('legal.accept.version', { version: d.version })}`;
      li.append(a);
      const note = bn ? d.change_note_bn : d.change_note_en;
      if (note) {
        const p = document.createElement('p');
        p.className = 'legal-accept__note';
        p.textContent = t('legal.accept.what_changed', { note });
        li.append(p);
      }
      list.append(li);
    }

    const agree = Button({ label: t('legal.accept.agree'), variant: 'primary', size: 'sm', disabled: true });
    const box = Checkbox({
      label: t('legal.accept.checkbox'),
      checked: false,
      required: true,
      onChange: (checked) => { agree.disabled = !checked; },
    });

    agree.addEventListener('click', async () => {
      if (!box.checked) return;
      agree.disabled = true;
      try {
        pending = await acceptFn(pending.map((d) => d.document_id));
        if (pending.length === 0) {
          done = true;
          modal.closeModal(true, { force: true });
          toast.success(t('legal.accept.thanks'));
          onAccepted?.();
          return;
        }
        draw();
      } catch (err) {
        // A version published while the dialog was open: show the new one instead.
        if (err?.code === 'PRECONDITION_CHANGED') {
          try {
            pending = await getPendingLegal();
          } catch {
            // Keep the old list; the next click shows the error again.
          }
          draw();
        } else {
          agree.disabled = false;
        }
        toast.error(err?.message || t('common.error_generic'));
      }
    });

    const signOut = Button({
      label: t('legal.accept.sign_out'),
      variant: 'ghost',
      size: 'sm',
      onClick: async () => {
        leaving = true;
        modal.closeModal(false, { force: true });
        await logoutFn().catch(() => {});
        onSignedOut();
      },
    });

    body.append(intro, list, box);
    footer.append(signOut, agree);
  }

  draw();
  return modal;
}

let open = false;

/** Boot: asks the signed-in account to agree to anything pending. Never throws. True if it asked. */
export async function checkAndPromptLegal(options: LegalAcceptOptions = {}): Promise<boolean> {
  if (open) return true;
  let pending: PendingLegalDoc[] = [];
  try {
    pending = await getPendingLegal();
  } catch {
    // WHY silent: an unreachable endpoint must not block the app; the next visit asks again.
    return false;
  }
  if (pending.length === 0) return false;
  open = true;
  LegalAcceptModal(pending, {
    ...options,
    onAccepted: () => { open = false; options.onAccepted?.(); },
    onSignedOut: () => { open = false; (options.onSignedOut ?? (() => window.location.assign('/login')))(); },
  }).openModal();
  return true;
}
