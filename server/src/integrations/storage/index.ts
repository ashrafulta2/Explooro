/**
 * index.ts — Storage driver factory (Prompt 4.2).
 */

import { localStorageDriver } from './local.ts';
import { r2StorageDriver } from './r2.ts';

export function getStorageDriver() {
  const driverType = (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
  if (driverType === 'r2') {
    return r2StorageDriver;
  }
  return localStorageDriver;
}

export { localStorageDriver, r2StorageDriver };
