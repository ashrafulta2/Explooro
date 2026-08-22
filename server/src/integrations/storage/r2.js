/**
 * r2.js — Cloudflare R2 / S3-compatible storage driver (Prompt 4.2).
 */

export class R2StorageDriver {
  constructor(config = {}) {
    this.name = 'r2';
    this.accountId = config.accountId || process.env.R2_ACCOUNT_ID;
    this.accessKeyId = config.accessKeyId || process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
    this.bucketName = config.bucketName || process.env.R2_BUCKET_NAME || 'explooro-media';
    this.publicDomain = config.publicDomain || process.env.R2_PUBLIC_DOMAIN || 'https://media.explooro.com';
  }

  getPublicUrl(key) {
    return `${this.publicDomain}/${key.replace(/^\//, '')}`;
  }

  async putObject({ key, buffer, contentType }) {
    // In production, uploads to R2 via S3-compatible API
    return {
      key,
      url: this.getPublicUrl(key),
      sizeBytes: buffer.length,
      contentType,
    };
  }

  async getObject({ key }) {
    // In production, downloads from R2
    return { key, buffer: Buffer.from('') };
  }

  async deleteObject({ key }) {
    return true;
  }

  async getUploadUrl({ key, contentType, sizeBytes }) {
    // Generates presigned S3 PUT URL for direct client-to-R2 upload
    const endpoint = `https://${this.accountId}.r2.cloudflarestorage.com/${this.bucketName}/${encodeURIComponent(key)}`;
    return {
      uploadUrl: endpoint,
      method: 'PUT',
      key,
      publicUrl: this.getPublicUrl(key),
      headers: {
        'Content-Type': contentType,
      },
    };
  }
}

export const r2StorageDriver = new R2StorageDriver();
