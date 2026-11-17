import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
export const MAX_PLAYERS = 8;
export const CONNECTED_WINDOW_MS = 12000;
