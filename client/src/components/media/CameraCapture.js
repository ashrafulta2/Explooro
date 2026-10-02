/**
 * CameraCapture.js — take a photo with the device camera, on desktop as well as mobile.
 *
 * WHY this exists: <input type="file" capture> is only a hint. Mobile browsers honour it and open
 * the camera app, but every desktop browser ignores it and shows the ordinary file picker — so
 * the uploader's "Camera" button behaved exactly like "Browse Files" on a laptop. On desktop we
 * instead stream the webcam through getUserMedia into a <video>, and grab a frame onto a canvas.
 *
 * Invariants:
 *  - The camera is released (every track stopped) whenever the dialog closes, by any path —
 *    Escape, scrim, Cancel or Use photo. A leaked stream keeps the webcam light on.
 *  - The promise always settles: a File when a photo was accepted, null otherwise.
 */

import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { t } from '../../services/i18n.js';

// WHY 0.9: visually lossless for product photos, and a 1080p frame stays around 0.5–1MB —
// far under the uploader's 8MB image limit.
const JPEG_QUALITY = 0.9;

/**
 * Which camera path to use. Pure, so it can be tested without a DOM.
 *  - 'native' → click the <input capture> (mobile opens its camera app; the last-resort fallback).
 *  - 'webcam' → our getUserMedia dialog.
 */
export function pickCameraMode({ coarsePointer = false, hasGetUserMedia = false, secureContext = false } = {}) {
  // Touch devices get the OS camera app: it has focus, flash and lens switching that we don't.
  if (coarsePointer) return 'native';
  // getUserMedia only exists on secure origins (https or localhost).
  if (hasGetUserMedia && secureContext) return 'webcam';
  return 'native';
}

export function detectCameraMode() {
  return pickCameraMode({
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    secureContext: window.isSecureContext === true,
  });
}

/** Maps a getUserMedia DOMException to the message key shown inside the dialog. */
export function cameraErrorKey(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'media.camera.error_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'media.camera.error_not_found';
    case 'NotReadableError':
    case 'AbortError':
      return 'media.camera.error_in_use';
    default:
      return 'media.camera.error_generic';
  }
}

/**
 * Opens the webcam dialog.
 * @param {{ trigger?: HTMLElement|null }} [opts] element focus returns to when the dialog closes
 * @returns {Promise<File|null>}
 */
export function openCameraCapture({ trigger = null } = {}) {
  return new Promise((resolve) => {
    let stream = null;
    let captured = null; // File, once a frame has been taken
    let previewUrl = '';

    const stage = document.createElement('div');
    stage.className = 'camera-capture__stage';

    const video = document.createElement('video');
    video.className = 'camera-capture__video';
    // playsInline + muted are what let the stream autoplay without a user gesture on Safari.
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;

    const still = document.createElement('img');
    still.className = 'camera-capture__still';
    still.alt = t('media.camera.preview_alt');
    still.hidden = true;

    const status = document.createElement('p');
    status.className = 'camera-capture__status';
    status.setAttribute('role', 'status');
    status.textContent = t('media.camera.starting');

    stage.append(video, still, status);

    const cancelBtn = Button({
      label: t('media.camera.cancel'),
      variant: 'secondary',
      onClick: () => modal.closeModal(null),
    });
    const retakeBtn = Button({
      label: t('media.camera.retake'),
      variant: 'secondary',
      onClick: showLive,
    });
    const captureBtn = Button({
      label: t('media.camera.capture'),
      variant: 'primary',
      disabled: true,
      onClick: takePhoto,
    });
    const useBtn = Button({
      label: t('media.camera.use_photo'),
      variant: 'primary',
      onClick: () => modal.closeModal(captured),
    });
    retakeBtn.hidden = true;
    useBtn.hidden = true;

    const footer = document.createElement('div');
    footer.className = 'camera-capture__footer';
    footer.append(cancelBtn, retakeBtn, captureBtn, useBtn);

    const modal = Modal({
      title: t('media.camera.title'),
      description: t('media.camera.description'),
      content: stage,
      footer,
      size: 'md',
      closeLabel: t('media.camera.cancel'),
      onClose: (result) => {
        stopStream();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        modal.remove();
        resolve(result instanceof File ? result : null);
      },
    });

    modal.openModal(trigger);
    startStream();

    async function startStream() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `ideal`, never `exact`: a laptop has one front webcam, and an exact rear-camera or
          // resolution request would fail with OverconstrainedError instead of using it.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        // The user may have closed the dialog while the permission prompt was up.
        if (!modal.isOpen()) {
          stopStream();
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        showLive();
      } catch (err) {
        status.textContent = t(cameraErrorKey(err));
        status.hidden = false;
        stage.classList.add('camera-capture__stage--error');
        captureBtn.setDisabled(true);
      }
    }

    function stopStream() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    }

    function showLive() {
      captured = null;
      still.hidden = true;
      video.hidden = false;
      status.hidden = true;
      retakeBtn.hidden = true;
      useBtn.hidden = true;
      captureBtn.hidden = false;
      captureBtn.setDisabled(!stream);
      captureBtn.focus();
    }

    function takePhoto() {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return; // no frame decoded yet

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(video, 0, 0, width, height);

      captureBtn.setLoading(true);
      canvas.toBlob((blob) => {
        captureBtn.setLoading(false);
        if (!blob) {
          status.textContent = t('media.camera.capture_failed');
          status.hidden = false;
          return;
        }
        captured = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        still.src = previewUrl;
        still.hidden = false;
        video.hidden = true;
        captureBtn.hidden = true;
        retakeBtn.hidden = false;
        useBtn.hidden = false;
        useBtn.focus();
      }, 'image/jpeg', JPEG_QUALITY);
    }
  });
}
