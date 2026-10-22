import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DATA_DIR = process.env.SIFT_DATA_DIR
  ? path.resolve(process.env.SIFT_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const PORT = Number(process.env.SIFT_PORT || process.env.PORT || 8787);
export const HOST = process.env.SIFT_HOST || '0.0.0.0';
export const LAN_ENABLED = HOST !== '127.0.0.1' && HOST !== 'localhost';
export const APP_ORIGIN = process.env.SIFT_ORIGIN || `http://127.0.0.1:${PORT}`;
export const APK_PATH = path.join(ROOT_DIR, 'android', 'sift.apk');
export const NO_SYNC = process.env.SIFT_NO_SYNC === '1';
export const AUTO_SYNC_MS = Number(process.env.SIFT_SYNC_MS || 20 * 60 * 1000);
export const BILI_CUTOFF_DAYS = Number(process.env.SIFT_BILI_DAYS || 180);
export const ZHIHU_CUTOFF_DAYS = Number(process.env.SIFT_ZHIHU_DAYS || 180);
export const MAX_ITEMS = Number(process.env.SIFT_MAX_ITEMS || 1500);
