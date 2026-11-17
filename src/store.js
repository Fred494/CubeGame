import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const DIR = path.join(DATA_DIR, 'rooms');

export function saveRoom(game) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = path.join(DIR, `${game.code}.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(game));
  fs.renameSync(`${f}.tmp`, f); // atomic replace
}

export function loadRooms() {
  const rooms = new Map();
  if (!fs.existsSync(DIR)) return rooms;
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try { const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); rooms.set(g.code, g); } catch { /* skip corrupt file */ }
  }
  return rooms;
}
