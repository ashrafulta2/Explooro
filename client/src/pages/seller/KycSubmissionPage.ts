/**
 * KycSubmissionPage.ts — Shop Partner & Supplier KYC Verification Wizard (Prompt 7.5).
 *
 * Implements:
 * 1. 4-step wizard for Suppliers (NID/Selfie -> Trade License -> Facility Photos -> Bank/MFS).
 * 2. 1-step wizard for Shop Partners (NID/Selfie).
 * 3. Status card with blue-tick badge when verified.
 * 4. Appeal workflow for rejected submissions.
 */

import { api, pickMessage } from '../../core/api.ts';
import { t } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import { formatDate } from '../../services/format.ts';
import { showActionResult } from '../../components/guide/ActionResult.ts';

export default function KycSubmissionPage(root: HTMLElement) {
  const container = document.createElement('div');
  container.className = 'page-container kyc-submission-page max-w-3xl mx-auto';

  let currentStep = 1;
  let userRole = 'supplier';
  let kycStatus = null;
  let loading = true;

  // Form State
  const formData = {
    nid_number: '',
    trade_license_no: '',
    vat_tin: '',
    business_name: '',
    business_address: '',
    documents: [], // [{ doc_type, storage_key, mime_type, size_bytes }]
  };

  async function init() {
    try {
      loading = true;
      render();
      const meRes = await api.get('/me');
      userRole = meRes.data?.role || 'supplier';

      const statusRes = await api.get('/kyc/status');
      kycStatus = statusRes.data;
      if (kycStatus?.current_step) {
        currentStep = kycStatus.current_step;
      }
    } catch (err) {
      toast.error(t('kyc.plain.load_failed'));
    } finally {
      loading = false;
      render();
    }
  }

  async function handleStepSubmit(stepNum, isFinal = false) {
    try {
      // Validate current step
      if (stepNum === 1 && !formData.nid_number && !kycStatus?.id) {
        toast.error(t('kyc.plain.nid_required'));
        return;
      }

      const res = await api.post('/kyc/submit', {
        kyc_type: userRole === 'supplier' ? 'SUPPLIER' : 'SALER',
        step: stepNum,
        nid_number: formData.nid_number || undefined,
        trade_license_no: formData.trade_license_no || undefined,
        vat_tin: formData.vat_tin || undefined,
        business_name: formData.business_name || undefined,
        business_address: formData.business_address || undefined,
        documents: formData.documents,
      });

      // Prompt 13.3: the final submit ends on a result panel that says who reviews it and what to do
      // meanwhile; a saved middle step keeps its toast.
      if (!isFinal) toast.success(t('kyc.step_saved'));
      const statusRes = await api.get('/kyc/status');
      kycStatus = statusRes.data;

      if (!isFinal) {
        currentStep++;
      }
      render();
      if (isFinal) showActionResult(root, userRole === 'supplier' ? 'kyc_supplier' : 'kyc_saler');
    } catch (err) {
      toast.error(pickMessage(err) || t('kyc.plain.submit_failed'));
    }
  }

  function openAppealModal() {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog card max-w-md p-6 animate-scale-in">
        <h3 class="text-lg font-bold mb-2">📜 ${t('kyc.appeal_modal_title')}</h3>
        <p class="text-xs text-secondary mb-4">${t('kyc.appeal_modal_desc')}</p>

        <div class="space-y-3 text-xs">
          <div>
            <label class="font-semibold block mb-1">${t('kyc.rejection_reason_received')}:</label>
            <p class="p-2 rounded bg-rose-subtle text-rose-dark border border-rose font-medium">
              ${kycStatus?.rejection_reason || t('kyc.plain.reason_mismatch')}
            </p>
          </div>

          <div>
            <label class="font-semibold block mb-1">${t('kyc.appeal_explanation')}:</label>
            <textarea id="txt-appeal-note" class="form-textarea w-full" rows="3" placeholder="${t('kyc.plain.appeal_placeholder')}"></textarea>
            <p class="field__hint">${t('kyc.plain.appeal_help')}</p>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button class="btn btn--secondary btn--sm" id="btn-cancel-appeal">${t('common.cancel')}</button>
          <button class="btn btn--primary btn--sm" id="btn-confirm-appeal">${t('kyc.submit_appeal')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    modalBackdrop.querySelector('#btn-cancel-appeal').addEventListener('click', () => modalBackdrop.remove());

    modalBackdrop.querySelector('#btn-confirm-appeal').addEventListener('click', async () => {
      const appealNote = modalBackdrop.querySelector<HTMLInputElement>('#txt-appeal-note').value.trim();
      modalBackdrop.remove();

      try {
        await api.post('/kyc/appeal', {
          kyc_id: kycStatus.id,
          appeal_note: appealNote,
        });
        toast.success(t('kyc.appeal_submitted_success'));
        const statusRes = await api.get('/kyc/status');
        kycStatus = statusRes.data;
        render();
      } catch (err) {
        toast.error(pickMessage(err) || t('kyc.plain.appeal_failed'));
      }
    });
  }

  function simulateDocumentUpload(docType, fileName) {
    const fakeKey = `kyc/${userRole}/${Date.now()}_${docType.toLowerCase()}.jpg`;
    formData.documents.push({
      doc_type: docType,
      storage_key: fakeKey,
      mime_type: 'image/jpeg',
      size_bytes: 245000,
    });
    toast.success(t('kyc.plain.uploaded', { name: fileName || docType }));
    render();
  }

  function renderStatusBanner() {
    if (!kycStatus || kycStatus.status === 'NOT_SUBMITTED') return '';

    if (kycStatus.status === 'VERIFIED') {
      return `
        <div class="p-4 mb-6 rounded-lg bg-emerald-subtle border border-emerald flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🛡️</span>
            <div>
              <h3 class="font-bold text-emerald-dark flex items-center gap-2">
                ${t('kyc.verified_title')} <span class="badge badge--emerald" title="${t('kyc.plain.verified_badge_tip')}">✓ ${t('kyc.plain.verified_badge')}</span>
              </h3>
              <p class="text-xs text-emerald-dark opacity-90">${t('kyc.verified_desc')} • ${t('kyc.plain.verified_on', { date: formatDate(kycStatus.verified_at) })}</p>
            </div>
          </div>
        </div>
      `;
    }

    if (kycStatus.status === 'UNDER_REVIEW' || kycStatus.status === 'PENDING') {
      return `
        <div class="p-4 mb-6 rounded-lg bg-amber-subtle border border-amber flex items-center gap-3">
          <span class="text-2xl">⏳</span>
          <div>
            <h3 class="font-bold text-amber-dark">${t('kyc.under_review_title')}</h3>
            <p class="text-xs text-amber-dark opacity-90">${t('kyc.under_review_desc')}</p>
          </div>
        </div>
      `;
    }

    if (kycStatus.status === 'REJECTED') {
      return `
        <div class="p-4 mb-6 rounded-lg bg-rose-subtle border border-rose flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-2xl">❌</span>
            <div>
              <h3 class="font-bold text-rose-dark">${t('kyc.rejected_title')}</h3>
              <p class="text-xs text-rose-dark opacity-90 mb-1">${t('kyc.plain.reason_label', { reason: kycStatus.rejection_reason || t('kyc.plain.reason_unclear') })}</p>
              <span class="text-xs text-secondary">${t('kyc.plain.rejected_next')}</span>
            </div>
          </div>
          <button class="btn btn--danger btn--sm" id="btn-open-appeal">📜 ${t('kyc.btn_appeal')}</button>
        </div>
      `;
    }

    if (kycStatus.status === 'APPEALED') {
      return `
        <div class="p-4 mb-6 rounded-lg bg-indigo-subtle border border-indigo flex items-center gap-3">
          <span class="text-2xl">⚖️</span>
          <div>
            <h3 class="font-bold text-indigo-dark">${t('kyc.appeal_in_progress_title')}</h3>
            <p class="text-xs text-indigo-dark opacity-90">${t('kyc.appeal_in_progress_desc')}</p>
          </div>
        </div>
      `;
    }

    return '';
  }

  function renderStepper() {
    if (userRole !== 'supplier') return '';
    const steps = [
      { num: 1, label: t('kyc.step_nid_selfie') },
      { num: 2, label: t('kyc.step_trade_license') },
      { num: 3, label: t('kyc.step_facility_photos') },
      { num: 4, label: t('kyc.step_bank_mfs') },
    ];

    return `
      <div class="grid grid-cols-4 gap-2 mb-6 text-xs">
        ${steps
          .map(
            (s) => `
          <div class="p-2 border-b-2 text-center ${currentStep === s.num ? 'border-primary font-bold text-primary' : currentStep > s.num ? 'border-emerald text-emerald' : 'border-border text-tertiary'}">
            <span class="block">${s.num < currentStep ? '✓' : `0${s.num}`}</span>
            <span>${s.label}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderStepForm() {
    if (kycStatus?.status === 'VERIFIED') {
      return `
        <div class="card p-6 text-center text-xs space-y-3">
          <div class="w-16 h-16 rounded-full bg-emerald-subtle text-emerald text-3xl flex items-center justify-center mx-auto">✓</div>
          <h3 class="text-base font-bold">${t('kyc.verified_headline')}</h3>
          <p class="text-secondary max-w-md mx-auto">${t('kyc.verified_details')}</p>
        </div>
      `;
    }

    // Step 1: NID & Selfie
    if (currentStep === 1) {
      return `
        <div class="card p-6 space-y-4 text-xs">
          <h3 class="text-base font-bold">${t('kyc.step1_heading')}</h3>
          <p class="text-secondary">${t('kyc.step1_desc')}</p>

          <div class="space-y-3">
            <div>
              <label class="font-semibold block mb-1">${t('kyc.nid_number_label')} *</label>
              <input type="text" id="inp-nid-number" class="form-input w-full" inputmode="numeric" placeholder="${t('kyc.plain.nid_placeholder')}" value="${formData.nid_number}"/>
              <p class="field__hint">${t('kyc.plain.nid_help')}</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="p-4 border border-dashed rounded text-center cursor-pointer bg-surface-subtle" id="drop-nid-front">
                <span class="text-2xl block mb-1">🪪</span>
                <span class="font-semibold block">${t('kyc.upload_nid_front')}</span>
                <span class="text-tertiary text-xxs">${t('kyc.plain.photo_hint')}</span>
              </div>
              <div class="p-4 border border-dashed rounded text-center cursor-pointer bg-surface-subtle" id="drop-nid-back">
                <span class="text-2xl block mb-1">🪪</span>
                <span class="font-semibold block">${t('kyc.upload_nid_back')}</span>
                <span class="text-tertiary text-xxs">${t('kyc.plain.photo_hint')}</span>
              </div>
            </div>

            <div class="p-4 border border-dashed rounded text-center cursor-pointer bg-surface-subtle" id="drop-selfie">
              <span class="text-2xl block mb-1">🤳</span>
              <span class="font-semibold block">${t('kyc.upload_selfie')}</span>
              <span class="text-tertiary text-xxs">${t('kyc.plain.selfie_hint')}</span>
            </div>
          </div>

          <div class="flex justify-end pt-4 border-t">
            <button class="btn btn--primary btn--sm" id="btn-next-step-1">
              ${userRole === 'supplier' ? t('kyc.btn_next_step') : t('kyc.btn_submit_verification')} →
            </button>
          </div>
        </div>
      `;
    }

    // Step 2: Trade License & VAT-TIN
    if (currentStep === 2) {
      return `
        <div class="card p-6 space-y-4 text-xs">
          <h3 class="text-base font-bold">${t('kyc.step2_heading')}</h3>
          <p class="text-secondary">${t('kyc.step2_desc')}</p>

          <div class="space-y-3">
            <div>
              <label class="font-semibold block mb-1">${t('kyc.business_name_label')} *</label>
              <input type="text" id="inp-business-name" class="form-input w-full" placeholder="${t('kyc.plain.business_name_placeholder')}" value="${formData.business_name}"/>
              <p class="field__hint">${t('kyc.plain.business_name_help')}</p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="font-semibold block mb-1">${t('kyc.trade_license_no_label')} *</label>
                <input type="text" id="inp-trade-license" class="form-input w-full" placeholder="${t('kyc.plain.licence_placeholder')}" value="${formData.trade_license_no}"/>
                <p class="field__hint">${t('kyc.plain.licence_help')}</p>
              </div>
              <div>
                <label class="font-semibold block mb-1">${t('kyc.vat_tin_label')} ${t('kyc.plain.optional')}</label>
                <input type="text" id="inp-vat-tin" class="form-input w-full" inputmode="numeric" placeholder="${t('kyc.plain.tin_placeholder')}" value="${formData.vat_tin}"/>
                <p class="field__hint">${t('kyc.plain.tin_help')}</p>
              </div>
            </div>

            <div class="p-4 border border-dashed rounded text-center cursor-pointer bg-surface-subtle" id="drop-trade-license">
              <span class="text-2xl block mb-1">📄</span>
              <span class="font-semibold block">${t('kyc.upload_trade_license_doc')}</span>
              <span class="text-tertiary text-xxs">${t('kyc.plain.licence_doc_hint')}</span>
            </div>
          </div>

          <div class="flex justify-between pt-4 border-t">
            <button class="btn btn--secondary btn--sm" id="btn-prev-step-2">← ${t('common.back')}</button>
            <button class="btn btn--primary btn--sm" id="btn-next-step-2">${t('kyc.btn_next_step')} →</button>
          </div>
        </div>
      `;
    }

    // Step 3: Facility Photos
    if (currentStep === 3) {
      return `
        <div class="card p-6 space-y-4 text-xs">
          <h3 class="text-base font-bold">${t('kyc.step3_heading')}</h3>
          <p class="text-secondary">${t('kyc.step3_desc')}</p>

          <div class="space-y-3">
            <div>
              <label class="font-semibold block mb-1">${t('kyc.business_address_label')} *</label>
              <textarea id="inp-business-address" class="form-textarea w-full" rows="2" placeholder="${t('kyc.plain.address_placeholder')}">${formData.business_address}</textarea>
              <p class="field__hint">${t('kyc.plain.address_help')}</p>
            </div>

            <div class="p-4 border border-dashed rounded text-center cursor-pointer bg-surface-subtle" id="drop-facility">
              <span class="text-2xl block mb-1">🏭</span>
              <span class="font-semibold block">${t('kyc.upload_facility_photos')}</span>
              <span class="text-tertiary text-xxs">${t('kyc.plain.facility_hint')}</span>
            </div>
          </div>

          <div class="flex justify-between pt-4 border-t">
            <button class="btn btn--secondary btn--sm" id="btn-prev-step-3">← ${t('common.back')}</button>
            <button class="btn btn--primary btn--sm" id="btn-next-step-3">${t('kyc.btn_next_step')} →</button>
          </div>
        </div>
      `;
    }

    // Step 4: Settlement Account
    if (currentStep === 4) {
      return `
        <div class="card p-6 space-y-4 text-xs">
          <h3 class="text-base font-bold">${t('kyc.step4_heading')}</h3>
          <p class="text-secondary">${t('kyc.step4_desc')}</p>

          <div class="space-y-3">
            <div class="p-3 bg-surface-subtle border rounded space-y-2">
              <span class="font-semibold block text-primary">⚠️ ${t('kyc.plain.name_match_title')}</span>
              <p class="text-secondary">${t('kyc.plain.name_match_body')}</p>
            </div>

            <div class="p-4 border border-dashed rounded text-center cursor-pointer bg-surface-subtle" id="drop-bank-statement">
              <span class="text-2xl block mb-1">🏦</span>
              <span class="font-semibold block">${t('kyc.upload_bank_cheque')}</span>
              <span class="text-tertiary text-xxs">${t('kyc.plain.bank_doc_hint')}</span>
            </div>
          </div>

          <div class="flex justify-between pt-4 border-t">
            <button class="btn btn--secondary btn--sm" id="btn-prev-step-4">← ${t('common.back')}</button>
            <button class="btn btn--primary btn--sm" id="btn-submit-final"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ${t('kyc.btn_final_submit')}</button>
          </div>
        </div>
      `;
    }

    return '';
  }

  function render() {
    container.innerHTML = `
      <div class="kyc-wizard pb-10">
        <!-- Header -->
        <div class="text-center mb-6">
          <h1 class="text-2xl font-bold flex items-center justify-center gap-2">
            🛡️ ${t('kyc.page_title')}
          </h1>
          <p data-page-info class="text-xs text-secondary mt-1">${t('kyc.page_subtitle')}</p>
        </div>

        ${renderStatusBanner()}
        ${renderStepper()}
        <div id="kyc-step-container">${renderStepForm()}</div>
      </div>
    `;

    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#btn-open-appeal')?.addEventListener('click', openAppealModal);

    // Step 1
    container.querySelector('#drop-nid-front')?.addEventListener('click', () => simulateDocumentUpload('NID_FRONT', 'NID Front Page'));
    container.querySelector('#drop-nid-back')?.addEventListener('click', () => simulateDocumentUpload('NID_BACK', 'NID Back Page'));
    container.querySelector('#drop-selfie')?.addEventListener('click', () => simulateDocumentUpload('SELFIE', 'Live Face Selfie'));

    container.querySelector('#btn-next-step-1')?.addEventListener('click', () => {
      const val = container.querySelector<HTMLInputElement>('#inp-nid-number')?.value.trim();
      if (val) formData.nid_number = val;
      handleStepSubmit(1, userRole !== 'supplier');
    });

    // Step 2
    container.querySelector('#drop-trade-license')?.addEventListener('click', () => simulateDocumentUpload('TRADE_LICENSE', 'Trade License Copy'));
    container.querySelector('#btn-prev-step-2')?.addEventListener('click', () => { currentStep = 1; render(); });
    container.querySelector('#btn-next-step-2')?.addEventListener('click', () => {
      formData.business_name = container.querySelector<HTMLInputElement>('#inp-business-name')?.value.trim();
      formData.trade_license_no = container.querySelector<HTMLInputElement>('#inp-trade-license')?.value.trim();
      formData.vat_tin = container.querySelector<HTMLInputElement>('#inp-vat-tin')?.value.trim();
      handleStepSubmit(2);
    });

    // Step 3
    container.querySelector('#drop-facility')?.addEventListener('click', () => simulateDocumentUpload('FACILITY_PHOTO', 'Facility Inventory Photo'));
    container.querySelector('#btn-prev-step-3')?.addEventListener('click', () => { currentStep = 2; render(); });
    container.querySelector('#btn-next-step-3')?.addEventListener('click', () => {
      formData.business_address = container.querySelector<HTMLInputElement>('#inp-business-address')?.value.trim();
      handleStepSubmit(3);
    });

    // Step 4
    container.querySelector('#drop-bank-statement')?.addEventListener('click', () => simulateDocumentUpload('BANK_STATEMENT', 'Bank Statement / Cheque'));
    container.querySelector('#btn-prev-step-4')?.addEventListener('click', () => { currentStep = 3; render(); });
    container.querySelector('#btn-submit-final')?.addEventListener('click', () => handleStepSubmit(4, true));
  }

  init();
  root.append(container);
}
