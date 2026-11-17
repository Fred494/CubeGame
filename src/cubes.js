// Conta Cubos: server-authoritative state for the "count the cubes" mini game.
// Phones only send answers; the server owns the clock, the 20 s lock, the 3 min limit and the scores.
import crypto from 'node:crypto';
import { MAX_PLAYERS, CONNECTED_WINDOW_MS } from './config.js';
import { planGame, parseManual } from '../public/cubes/gen.js';

export const COUNTDOWN_MS = 3000;
export const ROUND_MS = 180000;
export const LOCK_MS = 20000;
export const PENALTY_MS = 30000;
export const MAX_ROUNDS = 10;
const AVATARS = ['#4F8EFF', '#2BD99F', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6'];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = () => crypto.randomBytes(24).toString('hex');

export class CubeError extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); } }
const fail = (code, msg, extra) => { throw new CubeError(code, msg, extra); };

export function createCubes({ code, rounds = 5, hostToken, testMode = false } = {}) {
  const ht = hostToken || token();
  return {
    game: {
      v: 1, kind: 'cubes', code, createdAt: Date.now(), status: 'lobby', phase: 'lobby',
      totalRounds: clampRounds(rounds), testMode: !!testMode, manual: [], hostHash: sha(ht), players: [],
      rounds: [], round: 0, revealAt: 0, endedAt: 0, rs: {}, history: [], ranking: null, usedTemplates: [], nextCode: null, updatedAt: Date.now(),
    },
    hostToken: ht,
  };
}
const clampRounds = (n) => Math.min(MAX_ROUNDS, Math.max(1, Math.round(Number(n)) || 5));

export const isHost = (g, t) => !!t && sha(t) === g.hostHash;
export const findPlayerByToken = (g, t) => (t ? g.players.find((p) => p.tokenHash === sha(t)) : null);
const isConnected = (p, now) => now - (p.lastSeen || 0) < CONNECTED_WINDOW_MS;
const cleanName = (raw) => String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

export function addPlayer(g, { name, avatar, token: existing }, now = Date.now()) {
  if (existing) {
    const p = findPlayerByToken(g, existing);
    if (p) { p.lastSeen = now; return { player: p, token: existing, reconnected: true }; }
  }
  if (g.status !== 'lobby') fail('started', 'Este jogo já começou.');
  const n = cleanName(name);
  if (n.length < 1) fail('bad_name', 'Escreve um nome.');
  if (g.players.length >= MAX_PLAYERS) fail('full', `Esta sala está cheia (${MAX_PLAYERS} jogadores).`);
  if (g.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) fail('name_taken', 'Esse nome já está a ser usado nesta sala.');
  const t = token();
  const p = { id: crypto.randomBytes(6).toString('hex'), name: n, avatar: AVATARS.includes(avatar) ? avatar : AVATARS[g.players.length % AVATARS.length], tokenHash: sha(t), lastSeen: now, joinedAt: now };
  g.players.push(p);
  return { player: p, token: t, reconnected: false };
}
export function removePlayer(g, id) {
  g.players = g.players.filter((p) => p.id !== id);
  delete g.rs[id];
}

// ------------------------------------------------------------------ host actions
export function setRounds(g, n) {
  if (g.status !== 'lobby') fail('locked', 'O número de rondas só pode mudar antes de começar.');
  g.totalRounds = clampRounds(n);
}
export function setTest(g, on) {
  if (g.status !== 'lobby') fail('locked', 'O modo de teste só pode mudar antes de começar.');
  g.testMode = !!on;
}
export function loadManual(g, text) {
  if (g.status !== 'lobby') fail('locked', 'Os diagramas manuais só podem ser carregados antes de começar.');
  const r = parseManual(text);
  if (!r.ok) fail('bad_manual', r.errors.slice(0, 3).join(' '), { errors: r.errors });
  g.manual = r.diagrams;
  g.totalRounds = Math.max(g.totalRounds, Math.min(MAX_ROUNDS, g.manual.length));
  return { count: g.manual.length };
}
export function clearManual(g) { g.manual = []; }

export function start(g, now = Date.now(), { seed, excludeTemplates = [] } = {}) {
  if (g.status !== 'lobby') fail('started', 'O jogo já começou.');
  if (g.players.length < (g.testMode ? 1 : 2)) fail('few_players', g.testMode ? 'Precisas de pelo menos 1 jogador.' : 'Precisas de pelo menos 2 jogadores (ou ativa o modo de teste).');
  g.rounds = planGame({ rounds: g.totalRounds, seed: seed ?? crypto.randomInt(1, 2 ** 30), manual: g.manual, excludeTemplates });
  g.usedTemplates = g.rounds.map((d) => d.templateId);
  g.status = 'running'; g.phase = 'rules'; g.round = 0; g.history = []; g.updatedAt = now;
}
/** Rules screen -> first countdown, or round summary -> next countdown (or the end). */
export function next(g, now = Date.now()) {
  step(g, now);
  if (g.phase === 'rules' || g.phase === 'roundend') {
    if (g.phase === 'roundend' && g.round >= g.totalRounds) return finish(g, now);
    return beginRound(g, now);
  }
  fail('bad_phase', 'Ainda não dá para avançar.');
}
/** Test mode: end the current round right now. */
export function skip(g, now = Date.now()) {
  if (!g.testMode) fail('forbidden', 'Só disponível no modo de teste.');
  step(g, now);
  if (g.phase === 'countdown' || g.phase === 'playing') endRound(g, now);
  else next(g, now);
}
function beginRound(g, now) {
  g.round += 1; g.phase = 'countdown'; g.revealAt = now + COUNTDOWN_MS; g.endedAt = 0;
  g.rs = Object.fromEntries(g.players.map((p) => [p.id, { attempts: 0, lockUntil: 0, solvedMs: null, solvedOrder: 0 }]));
}
function finish(g, now) {
  g.phase = 'finished'; g.status = 'finished'; g.updatedAt = now;
  g.ranking = cumulative(g).map((r) => ({ rank: r.rank, playerId: r.id, name: r.name, totalMs: r.totalMs }));
}
export function restart(g) {
  g.status = 'lobby'; g.phase = 'lobby'; g.round = 0; g.rounds = []; g.history = []; g.rs = {}; g.ranking = null; g.revealAt = 0; g.endedAt = 0;
}

// ------------------------------------------------------------------ clock
const cur = (g) => g.rounds[g.round - 1];
const solvedCount = (g) => Object.values(g.rs).filter((s) => s.solvedMs != null).length;
/** Lazy state machine: called on every read/write and by the server tick. Returns true if the phase changed. */
export function step(g, now = Date.now()) {
  if (g.phase === 'countdown' && now >= g.revealAt) g.phase = 'playing';
  if (g.phase === 'playing' && (now >= g.revealAt + ROUND_MS || (g.players.length > 0 && solvedCount(g) >= g.players.length))) { endRound(g, now); return true; }
  return false;
}
function endRound(g, now) {
  const results = g.players.map((p) => {
    const s = g.rs[p.id] || { attempts: 0, solvedMs: null, solvedOrder: 0 };
    const solved = s.solvedMs != null;
    return { id: p.id, name: p.name, solved, ms: solved ? s.solvedMs : ROUND_MS + PENALTY_MS, attempts: s.attempts, order: s.solvedOrder };
  });
  results.sort((a, b) => a.ms - b.ms || a.attempts - b.attempts || a.order - b.order || a.name.localeCompare(b.name));
  results.forEach((r, i) => { r.rank = i + 1; });
  g.history.push({ round: g.round, results });
  g.phase = 'roundend'; g.endedAt = now; g.updatedAt = now;
}
function cumulative(g) {
  const rows = g.players.map((p) => {
    const per = g.history.map((h) => h.results.find((r) => r.id === p.id) || null);
    return { id: p.id, name: p.name, avatar: p.avatar, totalMs: per.reduce((s, r) => s + (r ? r.ms : ROUND_MS + PENALTY_MS), 0), attempts: per.reduce((s, r) => s + (r ? r.attempts : 0), 0), solved: per.filter((r) => r?.solved).length, rounds: per.map((r) => (r ? { ms: r.ms, solved: r.solved, rank: r.rank } : null)) };
  });
  rows.sort((a, b) => a.totalMs - b.totalMs || a.attempts - b.attempts || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ------------------------------------------------------------------ player answer
export function answer(g, p, value, now = Date.now()) {
  step(g, now);
  if (g.phase !== 'playing') fail('not_playing', 'A ronda não está a decorrer.');
  const s = g.rs[p.id] || fail('no_state', 'Sem estado de ronda.');
  if (s.solvedMs != null) fail('already', 'Já acertaste!');
  if (now < s.lockUntil) fail('locked', 'Ainda estás bloqueado.', { lockMs: s.lockUntil - now });
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 99999) fail('bad_value', 'Escreve um número inteiro.');
  s.attempts += 1;
  if (n === cur(g).answer) {
    s.solvedMs = Math.max(0, now - g.revealAt); s.solvedOrder = solvedCount(g);
    step(g, now); // may close the round if this was the last one
    return { correct: true, ms: s.solvedMs };
  }
  s.lockUntil = now + LOCK_MS;
  return { correct: false, lockMs: LOCK_MS };
}

// ------------------------------------------------------------------ views
const publicPlayer = (p, now) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: isConnected(p, now) });
const constants = { countdownMs: COUNTDOWN_MS, roundMs: ROUND_MS, lockMs: LOCK_MS, penaltyMs: PENALTY_MS };
function common(g, now) {
  const solvedNames = g.phase === 'playing' || g.phase === 'roundend'
    ? g.players.filter((p) => g.rs[p.id]?.solvedMs != null).sort((a, b) => g.rs[a.id].solvedOrder - g.rs[b.id].solvedOrder).map((p) => p.name) : [];
  return {
    kind: 'cubes', code: g.code, status: g.status, phase: g.phase, round: g.round, totalRounds: g.totalRounds, testMode: g.testMode,
    serverNow: now, revealAt: g.revealAt, ...constants, maxPlayers: MAX_PLAYERS,
    players: g.players.map((p) => publicPlayer(p, now)), solvedCount: solvedCount(g), solvedNames,
    manualCount: g.manual.length,
    lastResults: g.history.length ? g.history[g.history.length - 1].results : [],
    standings: g.history.length ? cumulative(g) : [], ranking: g.ranking,
  };
}
export function hostView(g, now = Date.now()) {
  step(g, now);
  const v = common(g, now);
  const d = g.round > 0 ? cur(g) : null;
  if (d && ['playing', 'roundend'].includes(g.phase)) { // never sent before the reveal moment
    v.diagram = { grid: d.grid, level: d.level, name: d.name };
    if (g.phase === 'roundend' || g.testMode) { v.answer = d.answer; v.layers = d.layers; }
  }
  return v;
}
export function playerView(g, p, now = Date.now()) {
  p.lastSeen = now; step(g, now);
  const v = common(g, now);
  const s = g.rs[p.id];
  v.me = { id: p.id, name: p.name, avatar: p.avatar };
  if (s) v.mine = { attempts: s.attempts, solved: s.solvedMs != null, solvedMs: s.solvedMs, lockMs: Math.max(0, s.lockUntil - now) };
  if (g.phase === 'roundend' && cur(g)) { v.answer = cur(g).answer; v.layers = cur(g).layers; }
  return v;
}
export function tick(g, now = Date.now()) { return step(g, now); }
export const results = (g) => ({ code: g.code, ranking: g.ranking, standings: cumulative(g), rounds: g.history });
