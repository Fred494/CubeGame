import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { PORT, ROOT, CORS_ORIGIN } from './config.js';
import * as C from './cubes.js';
import { saveRoom, loadRooms } from './store.js';

const rooms = loadRooms();
const dirty = new Set();
const PUBLIC = path.join(ROOT, 'public');
const BUILD = String(Date.now()); // changes on every server start: open pages reload themselves
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => { for (;;) { let c = ''; for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; if (!rooms.has(c)) return c; } };

const send = (res, code, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 50000) { reject(new C.CubeError('too_big', 'Pedido demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new C.CubeError('bad_json', 'JSON inválido')); } });
  });
}
const hits = new Map();
function limited(ip, max = 60) {
  const now = Date.now(); const h = (hits.get(ip) || []).filter((t) => now - t < 60000);
  h.push(now); hits.set(ip, h); return h.length > max;
}
const mark = (g) => dirty.add(g.code);

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const ip = req.socket.remoteAddress || '?';
  const tok = req.headers['x-token'] || '';

  if (req.method === 'GET' && parts[1] === 'health') return send(res, 200, { ok: true, rooms: rooms.size });
  if (req.method === 'GET' && parts[1] === 'qr') {
    const text = String(url.searchParams.get('text') || '').slice(0, 300);
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#0B1321', light: '#ffffff' } });
    return send(res, 200, svg, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
  }

  if (parts[1] === 'rooms') {
    if (req.method === 'POST' && parts.length === 2) {
      if (limited(ip, 20)) return send(res, 429, { error: 'Mais devagar', code: 'rate' });
      const body = await readBody(req);
      const code = makeCode();
      const { game, hostToken } = C.createCubes({ code, rounds: body.rounds, testMode: body.testMode });
      rooms.set(code, game); mark(game);
      return send(res, 200, { code, hostToken });
    }
    const game = parts[2] && rooms.get(String(parts[2]).toUpperCase());
    if (!game) return send(res, 404, { error: 'Sala não encontrada', code: 'no_room' });
    const sub = parts[3];
    if (req.method === 'POST' && sub === 'join') {
      if (limited(ip, 40)) return send(res, 429, { error: 'Mais devagar', code: 'rate' });
      const b = await readBody(req);
      const { player, token, reconnected } = C.addPlayer(game, { name: b.name, avatar: b.avatar, token: b.token });
      mark(game);
      return send(res, 200, { playerId: player.id, token, reconnected });
    }
    if (req.method === 'GET' && sub === 'state') {
      if (C.isHost(game, tok)) { const v = C.hostView(game); mark(game); return send(res, 200, { ...v, build: BUILD }); }
      const p = C.findPlayerByToken(game, tok);
      if (p) return send(res, 200, { ...C.playerView(game, p), build: BUILD });
      return send(res, 401, { error: 'Sessão desconhecida', code: 'unauthorized' });
    }
    if (req.method === 'GET' && sub === 'results' && game.status === 'finished') return send(res, 200, C.results(game));
    if (req.method === 'POST' && sub === 'host') {
      if (!C.isHost(game, tok)) return send(res, 403, { error: 'Só o anfitrião', code: 'forbidden' });
      const b = await readBody(req);
      let extra = {};
      switch (b.action) {
        case 'setRounds': C.setRounds(game, b.rounds); break;
        case 'setTest': C.setTest(game, b.on); break;
        case 'loadManual': extra = C.loadManual(game, b.json); break;
        case 'clearManual': C.clearManual(game); break;
        case 'start': C.start(game); break;
        case 'next': C.next(game); break;
        case 'skip': C.skip(game); break;
        case 'removePlayer': C.removePlayer(game, b.playerId); break;
        case 'restart': C.restart(game); break;
        default: return send(res, 400, { error: 'Ação desconhecida', code: 'bad_action' });
      }
      mark(game);
      return send(res, 200, { ok: true, ...extra });
    }
    if (req.method === 'POST' && sub === 'player') {
      const p = C.findPlayerByToken(game, tok);
      if (!p) return send(res, 401, { error: 'Sessão desconhecida', code: 'unauthorized' });
      const b = await readBody(req);
      if (b.action !== 'answer') return send(res, 400, { error: 'Ação desconhecida', code: 'bad_action' });
      const out = C.answer(game, p, b.value);
      mark(game);
      return send(res, 200, { ok: true, ...out });
    }
  }
  return send(res, 404, { error: 'Não encontrado', code: 'not_found' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Não encontrado');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof C.CubeError) return send(res, e.code === 'locked' && e.lockMs ? 429 : 400, { error: e.message, code: e.code, lockMs: e.lockMs, errors: e.errors });
    console.error(e);
    return send(res, 500, { error: 'Erro do servidor', code: 'server' });
  }
});

// clock tick (ends rounds on time even if nobody polls) + persistence
setInterval(() => { const now = Date.now(); for (const g of rooms.values()) { try { if (C.tick(g, now)) mark(g); } catch (e) { console.error(e); } } }, 250).unref();
setInterval(() => { for (const code of dirty) { try { saveRoom(rooms.get(code)); } catch (e) { console.error(e); } } dirty.clear(); }, 2000).unref();
const flush = () => { for (const g of rooms.values()) { try { saveRoom(g); } catch { /* ignore */ } } process.exit(0); };
process.on('SIGINT', flush); process.on('SIGTERM', flush);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'src/server.js')) {
  server.listen(PORT, () => console.log(`Conta Cubos running on http://localhost:${PORT}`));
}
