/**
 * media.service.js — Media upload pipeline, magic-byte sniffing & derivative generator (Prompt 4.2).
 */

import sharp from 'sharp';
import { getStorageDriver } from '../integrations/storage/index.js';
import * as mediaRepo from '../repositories/media.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;    // 8 MB
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;  // 100 MB

export const ALLOWED_PURPOSES = new Set([
  'PRODUCT',
  'AVATAR',
  'BANNER',
  'STORE_LOGO',
  'REVIEW',
  'UGC_VIDEO',
  'KYC',
  'FLYER',
  'STORY',
  'ACADEMY',
  'STREAM_RECORDING',
  'OG_IMAGE',
]);

/**
 * Sniffs binary magic bytes to determine authentic MIME type.
 * Blocks masqueraded executables (.exe, ELF, script headers).
 */
export function detectMimeType(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // Block executables immediately
  // MZ (Windows executable / DLL)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) return null;
  // ELF (Linux executable)
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) return null;
  // Shell script (#!)
  if (buffer[0] === 0x23 && buffer[1] === 0x21) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return 'image/png';
  }

  // GIF: 47 49 46 38 (GIF87a / GIF89a)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }

  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // AVIF & MP4: ....ftyp
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
    if (
      brand.startsWith('isom') ||
      brand.startsWith('mp42') ||
      brand.startsWith('qt  ') ||
      brand.startsWith('M4V ') ||
      brand.startsWith('dash')
    ) {
      return 'video/mp4';
    }
  }

  return null;
}

/**
 * Extracts width and height from binary header to prevent CLS.
 */
export function detectDimensions(buffer, mimeType) {
  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    if (mimeType === 'image/gif' && buffer.length >= 10) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
    }

    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker >= 0xC0 && marker <= 0xC3) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }

    if (mimeType === 'image/webp' && buffer.length >= 30) {
      if (buffer.toString('ascii', 12, 16) === 'VP8X') {
        const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        return { width, height };
      }
      if (buffer.toString('ascii', 12, 15) === 'VP8') {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width, height };
      }
    }
  } catch {
    // Fallback default
  }
  return { width: 800, height: 800 };
}

/**
 * Generates derivative URLs across thumb (200px), card (400px), and detail (1200px) breakpoints in WebP, AVIF, and JPG.
 */
export function generateDerivatives(key, storageDriver, width = 800, height = 800) {
  const basePublic = storageDriver.getPublicUrl(key);
  const extMatch = key.lastIndexOf('.');
  const baseNoExt = extMatch > -1 ? key.substring(0, extMatch) : key;

  const aspectRatio = width / (height || 1);

  const breakpoints = {
    thumb: 200,
    card: 400,
    detail: 1200,
  };

  const derivatives = {};

  for (const [name, targetWidth] of Object.entries(breakpoints)) {
    const targetHeight = Math.round(targetWidth / aspectRatio);
    derivatives[name] = {
      width: targetWidth,
      height: targetHeight,
      webp: `${storageDriver.getPublicUrl(`derivatives/${name}/${baseNoExt}.webp`)}`,
      avif: `${storageDriver.getPublicUrl(`derivatives/${name}/${baseNoExt}.avif`)}`,
      jpg: `${storageDriver.getPublicUrl(`derivatives/${name}/${baseNoExt}.jpg`)}`,
      fallback: basePublic,
    };
  }

  return derivatives;
}

/**
 * Pads an image onto a larger flat-color canvas (docs/dependency-ledger.md: `sharp` is isolated to
 * this file — every other caller, including creativeStudio.js's background-treatment tool, goes
 * through this function rather than importing `sharp` itself).
 */
export async function applyFlatBackgroundMatte(buffer, { backgroundHex, size = 1000, padding = 60 }) {
  return sharp(buffer)
    .resize(size, size, { fit: 'contain', background: backgroundHex })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: backgroundHex })
    .png()
    .toBuffer();
}

export function generateMediaRef() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MED-${timestamp}-${rand}`;
}

/**
 * Initiates direct presigned upload request.
 */
export async function requestUploadUrl({ userId, purpose, mimeType, sizeBytes, filename = 'file.jpg' }) {
  const upperPurpose = (purpose || 'PRODUCT').toUpperCase();
  if (!ALLOWED_PURPOSES.has(upperPurpose)) {
    throw new AppError('VALIDATION_FAILED', `Invalid media purpose: ${purpose}`, `অকার্যকর মিডিয়া পারপাস: ${purpose}`);
  }

  const isVideo = mimeType?.startsWith('video/') || upperPurpose === 'UGC_VIDEO' || upperPurpose === 'STREAM_RECORDING';
  const maxSize = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;

  if (sizeBytes && sizeBytes > maxSize) {
    throw new AppError(
      'MEDIA_TOO_LARGE',
      `File size (${(sizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the ${isVideo ? '100MB' : '8MB'} limit.`,
      `ফাইলের আকার (${(sizeBytes / (1024 * 1024)).toFixed(1)} মেগাবাইট) অনুমোদিত সর্বোচ্চ ${isVideo ? '১০০' : '৮'} মেগাবাইটের বেশি।`
    );
  }

  const driver = getStorageDriver();
  const ref = generateMediaRef();
  const ext = filename.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
  const storageKey = `${upperPurpose.toLowerCase()}/${Date.now()}_${ref}.${ext}`;

  const uploadMeta = await driver.getUploadUrl({
    key: storageKey,
    contentType: mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
    sizeBytes,
  });

  return {
    ref,
    storageKey,
    purpose: upperPurpose,
    uploadUrl: uploadMeta.uploadUrl,
    method: uploadMeta.method,
    headers: uploadMeta.headers,
    publicUrl: uploadMeta.publicUrl,
  };
}

/**
 * Validates direct upload on server, creates media_assets row.
 */
export async function processAndSaveMedia(
  db,
  { userId, purpose, buffer, storageKey, userRestrictions = [] }
) {
  if (!buffer || buffer.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Uploaded media payload is empty.', 'আপলোডকৃত ফাইল খালি।');
  }

  const detectedMime = detectMimeType(buffer);
  if (!detectedMime) {
    throw new AppError(
      'MEDIA_TYPE_REJECTED',
      'Forbidden or unsupported media file format. Only valid images (JPEG, PNG, WebP, GIF, AVIF) and videos (MP4) are allowed.',
      'অসমর্থিত বা নিষিদ্ধ ফাইল ফরম্যাট। শুধুমাত্র বৈধ ছবি (জেপিজি, পিএনজি, ওয়েবপি, গিফ, আভিফ) এবং ভিডিও (এমপি৪) সমর্থিত।'
    );
  }

  const isVideo = detectedMime.startsWith('video/');
  const maxSize = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;

  if (buffer.length > maxSize) {
    throw new AppError(
      'MEDIA_TOO_LARGE',
      `File size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum allowed ${isVideo ? '100MB' : '8MB'} limit.`,
      `ফাইলের আকার (${(buffer.length / (1024 * 1024)).toFixed(1)} মেগাবাইট) অনুমোদিত সর্বোচ্চ ${isVideo ? '১০০' : '৮'} মেগাবাইটের বেশি।`
    );
  }

  const driver = getStorageDriver();
  const upperPurpose = (purpose || 'PRODUCT').toUpperCase();
  const ref = generateMediaRef();

  let finalKey = storageKey;
  if (!finalKey) {
    const ext = detectedMime.split('/')[1].replace('jpeg', 'jpg');
    finalKey = `${upperPurpose.toLowerCase()}/${Date.now()}_${ref}.${ext}`;
  }

  // Save original object to storage
  await driver.putObject({
    key: finalKey,
    buffer,
    contentType: detectedMime,
  });

  const { width, height } = detectDimensions(buffer, detectedMime);
  const derivatives = !isVideo ? generateDerivatives(finalKey, driver, width, height) : {};

  // Check if user has FORCE_REVIEW_QUEUE restriction
  const hasForceReview = (userRestrictions || []).some(
    (r) => r.mode === 'FORCE_REVIEW_QUEUE' && (r.capability_key === 'can_upload_media' || r.capability_key === 'can_publish_products')
  );

  const moderationStatus = hasForceReview ? 'PENDING' : 'APPROVED';

  const asset = await mediaRepo.insertMediaAsset(db, {
    ref,
    ownerId: userId,
    purpose: upperPurpose,
    storageDriver: driver.name,
    storageKey: finalKey,
    mimeType: detectedMime,
    sizeBytes: buffer.length,
    width,
    height,
    durationSeconds: isVideo ? 10 : null,
    derivativesJson: derivatives,
    moderationStatus,
    qualityScore: 100,
  });

  return {
    ...asset,
    url: driver.getPublicUrl(finalKey),
    derivatives,
  };
}
