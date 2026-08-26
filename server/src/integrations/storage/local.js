/**
 * local.js — Local filesystem storage driver (Prompt 4.2).
 *
 * Default in development so no cloud credentials are required.
 * Writes files to server storage directory and serves via /storage/:filename.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.resolve(__dirname, '../../../storage');

// Ensure storage directory exists
async function ensureDir() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

export class LocalStorageDriver {
  constructor(options = {}) {
    this.name = 'local';
    this.baseDir = options.baseDir || STORAGE_DIR;
    this.baseUrl = options.baseUrl || '/storage';
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  getFilePath(key) {
    const safeKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.baseDir, safeKey);
  }

  async putObject({ key, buffer, contentType }) {
    await this.init();
    const filePath = this.getFilePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return {
      key,
      url: this.getPublicUrl(key),
      sizeBytes: buffer.length,
      contentType,
    };
  }

  async getObject({ key }) {
    const filePath = this.getFilePath(key);
    try {
      const buffer = await fs.readFile(filePath);
      return { key, buffer };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteObject({ key }) {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  getPublicUrl(key) {
    return `${this.baseUrl}/${key.replace(/\\/g, '/')}`;
  }

  async getUploadUrl({ key, contentType, sizeBytes }) {
    return {
      uploadUrl: `/api/v1/media/upload?key=${encodeURIComponent(key)}`,
      method: 'PUT',
      key,
      publicUrl: this.getPublicUrl(key),
      headers: {
        'Content-Type': contentType,
      },
    };
  }
}

export const localStorageDriver = new LocalStorageDriver();
