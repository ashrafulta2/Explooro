/**
 * ConfirmDialog — promise-returning confirmation, with friction modes for dangerous actions.
 *
 *   if (await confirmDialog({ title: 'Delete product?', variant: 'danger' })) { ... }
 *
 *   await confirmDialog({
 *     title: 'Delete store',
 *     typeToConfirm: 'Rahim Fashion',   // user must type the name exactly
 *   });
 *
 *   const { confirmed, reason } = await confirmDialogWithReason({
 *     title: 'Disable Live Stream Commerce',
 *     reasonRequired: true,             // module toggles and admin restrictions need a reason
 *   });
 *
 * Invariants:
 *  - Resolves EXACTLY ONCE, on every exit path — confirm, cancel, scrim click, Escape. A promise
 *    that never settles because the user pressed Escape leaks the caller's await forever.
 *  - The friction is the point in `typeToConfirm` mode: the confirm button stays disabled until
 *    the typed text matches exactly. Comparison is trimmed but case-SENSITIVE — a destructive
 *    action should not accept an approximate match.
 *  - A rejected confirmation SHAKES the dialog (design-system §15) rather than failing silently.
 *    Silence reads as a broken button and gets clicked again harder.
 */

import { Button } from './Button.js';
import { Input } from './Input.js';
import { Modal } from './Modal.js';
import { Textarea } from './Textarea.js';

function baseConfirm({
  title = 'Are you sure?',
  description = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  typeToConfirm = '',
  typeToConfirmHint = '',
  reason = false,
  reasonRequired = false,
  reasonLabel = 'Reason',
  reasonHint = '',
  trigger = null,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let reasonField = null;
    let typeField = null;

    const content = document.createDocumentFragment();

    if (typeToConfirm) {
      typeField = Input({
        label: typeToConfirmHint || `Type “${typeToConfirm}” to confirm`,
        placeholder: typeToConfirm,
        autocomplete: 'off',
        onInput: () => validate(),
      });
      content.append(typeField);
    }

    if (reason || reasonRequired) {
      reasonField = Textarea({
        label: reasonLabel,
        hint: reasonHint,
        rows: 3,
        maxLength: 500,
        showCounter: true,
        required: reasonRequired,
        onInput: () => validate(),
      });
      content.append(reasonField);
    }

    const cancelBtn = Button({
      label: cancelLabel,
      variant: 'secondary',
      onClick: () => finish(false),
    });

    const confirmBtn = Button({
      label: confirmLabel,
      variant: variant === 'danger' ? 'danger' : 'primary',
      onClick: () => {
        if (!isValid()) {
          shake();
          return;
        }
        finish(true);
      },
    });

    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, confirmBtn);

    const modal = Modal({
      title,
      description,
      content: content.hasChildNodes() ? content : null,
      footer,
      size: 'sm',
      onClose: () => finish(false),
    });
    modal.classList.add('confirm');
    if (variant === 'danger') modal.dataset.variant = 'danger';

    function isValid() {
      if (typeToConfirm && typeField.value.trim() !== typeToConfirm) return false;
      if (reasonRequired && reasonField.value.trim().length === 0) return false;
      return true;
    }

    function validate() {
      confirmBtn.setDisabled(!isValid());
      // Clear a previous rejection message once the input becomes valid.
      if (isValid()) {
        typeField?.setError('');
        reasonField?.setError('');
      }
    }

    function shake() {
      // Re-trigger the animation by removing the flag and forcing a reflow before re-adding it;
      // without the reflow the browser coalesces both writes and nothing animates.
      modal.dataset.shake = 'false';
      void modal.offsetWidth;
      modal.dataset.shake = 'true';
      if (typeToConfirm && typeField.value.trim() !== typeToConfirm) {
        typeField.setError('The text does not match.');
        typeField.focus();
      } else if (reasonRequired && reasonField.value.trim().length === 0) {
        reasonField.setError('A reason is required.');
        reasonField.focus();
      }
    }

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(
        reason || reasonRequired
          ? { confirmed: value, reason: reasonField?.value.trim() ?? '' }
          : value
      );
      // onClose calls finish(false) too; settled guards the double-resolve, and closing an
      // already-closed dialog is a no-op.
      modal.closeModal(value);
      // Remove from the DOM after the exit transition so the next call starts fresh.
      setTimeout(() => modal.remove(), 400);
    }

    // Gate the confirm button before the dialog is ever shown, so a friction mode cannot be
    // bypassed by hitting Enter the instant it opens.
    validate();

    document.body.append(modal);
    modal.openModal(trigger);

    // Focus the field the user must act on; otherwise focus lands on the dialog and the extra
    // step of finding the input is friction that teaches nothing.
    requestAnimationFrame(() => {
      if (typeField) typeField.focus();
      else if (reasonField) reasonField.focus();
      else cancelBtn.focus();
    });
  });
}

/** Resolves to a boolean. */
export function confirmDialog(options = {}) {
  return baseConfirm({ ...options, reason: false, reasonRequired: false });
}

/** Resolves to `{ confirmed, reason }`. */
export function confirmDialogWithReason(options = {}) {
  return baseConfirm({ ...options, reason: true });
}

export default confirmDialog;
