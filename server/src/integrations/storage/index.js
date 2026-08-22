/**
 * index.js — Storage driver factory (Prompt 4.2).
 */

import { localStorageDriver } from './local.js';
import { r2StorageDriver } from './r2.js';

export function getStorageDriver() {
  const driverType = (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
  if (driverType === 'r2') {
    return r2StorageDriver;
  }
  return localStorageDriver;
}

export { localStorageDriver, r2StorageDriver };
