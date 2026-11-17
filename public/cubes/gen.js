// Conta Cubos: procedural diagram generator + fairness validator.
// Pure ES module (no DOM, no Node APIs): used by the server, the host screen and the preview page.
// A diagram is a matrix of column heights; the answer is ALWAYS the sum of the heights.

export const LEVELS = {
  1: { n: 5, min: 35, max: 90, sym: 'rot', label: 'Simetria total 5×5' },
  2: { n: 6, min: 90, max: 140, sym: 'rot', label: 'Simetria total 6×6' },
  3: { n: 7, min: 130, max: 180, sym: 'mirror', label: 'Espelho 7×7' },
  4: { n: 7, min: 140, max: 200, sym: 'free', label: 'Livre 7×7' },
  5: { n: 8, min: 220, max: 280, sym: 'free', label: 'Livre 8×8' },
};
export const VIEW_AZ = Array.from({ length: 12 }, (_, i) => i * 30);
export const VIEW_EL = [36, 41, 46];
export const MAX_PIT_DEPTH = 2;
export const MAX_HEIGHT = 12;
export const MAX_ATTEMPTS = 60;

// ------------------------------------------------------------------ rng + helpers
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const mk = (n, f) => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => f(r, c)));
const ringOf = (n, r, c) => Math.min(r, c, n - 1 - r, n - 1 - c);
const isCorner = (n, r, c) => (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
const mirror = (n, f) => mk(n, (r, c) => f(r, Math.min(c, n - 1 - c)));
const rotate = (g) => g[0].map((_, c) => g.map((row) => row[c]).reverse());
const flip = (g) => g.map((row) => [...row].reverse());

// ------------------------------------------------------------------ analysis
export const total = (g) => g.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
export const maxHeight = (g) => Math.max(0, ...g.flat());
/** Cubes per layer, from the floor up. */
export const layerCounts = (g) => {
  const out = [];
  for (let k = 1; k <= maxHeight(g); k++) out.push(g.flat().filter((h) => h >= k).length);
  return out;
};
export const formula = (g) => `${layerCounts(g).join(' + ')} = ${total(g)}`;

/** Water level of every column if it rained: columns on the border drain, enclosed ones are pits. */
export function waterLevels(g) {
  const R = g.length, C = g[0].length;
  const L = g.map((row, r) => row.map((h, c) => (r === 0 || c === 0 || r === R - 1 || c === C - 1 ? h : Infinity)));
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 1; r < R - 1; r++) for (let c = 1; c < C - 1; c++) {
      const nl = Math.max(g[r][c], Math.min(L[r - 1][c], L[r + 1][c], L[r][c - 1], L[r][c + 1]));
      if (nl < L[r][c]) { L[r][c] = nl; changed = true; }
    }
  }
  return L;
}
export function pitInfo(g) {
  const L = waterLevels(g);
  const pit = g.map((row, r) => row.map((h, c) => L[r][c] > h));
  let maxDepth = 0, cells = 0, thin = 0;
  const at = (r, c) => !!(pit[r] && pit[r][c]);
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) {
    if (!pit[r][c]) continue;
    cells++; maxDepth = Math.max(maxDepth, L[r][c] - g[r][c]);
    let in2x2 = false;
    for (const dr of [-1, 0]) for (const dc of [-1, 0]) if (at(r + dr, c + dc) && at(r + dr + 1, c + dc) && at(r + dr, c + dc + 1) && at(r + dr + 1, c + dc + 1)) in2x2 = true;
    if (!in2x2) thin++;
  }
  return { cells, maxDepth, thin };
}

/** Is the top of column (r,c) visible from camera azimuth/elevation (degrees)? Orthographic ray towards the camera. */
export function topVisible(g, r, c, azDeg, elDeg, hmax = maxHeight(g)) {
  const n = g.length, m = g[0].length, A = (azDeg * Math.PI) / 180, E = (elDeg * Math.PI) / 180;
  const dx = Math.cos(E) * Math.sin(A), dy = Math.sin(E), dz = Math.cos(E) * Math.cos(A);
  const px = c + 0.5, py = g[r][c] + 1e-3, pz = r + 0.5;
  for (let t = 0.04; ; t += 0.04) {
    const x = px + dx * t, y = py + dy * t, z = pz + dz * t;
    if (y > hmax || x < 0 || x >= m || z < 0 || z >= n) return true;
    if (y < g[Math.floor(z)][Math.floor(x)]) return false;
  }
}
export function visibilityReport(g) {
  const hidden = []; let minViews = Infinity;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) {
    let views = 0;
    for (const az of VIEW_AZ) for (const el of VIEW_EL) if (topVisible(g, r, c, az, el)) views++;
    minViews = Math.min(minViews, views);
    if (views === 0) hidden.push([r, c]);
  }
  return { hidden, minViews };
}

/** Fairness rules: valid matrix, enclosed pits >=2x2 and <=2 deep, every column top visible in some view. */
export function validateGrid(g) {
  const errors = [];
  if (!Array.isArray(g) || !g.length || !Array.isArray(g[0]) || !g[0].length) return { ok: false, errors: ['A matriz está vazia.'] };
  const w = g[0].length;
  if (g.length > 12 || w > 12) errors.push('A grelha pode ter no máximo 12×12.');
  for (const row of g) {
    if (!Array.isArray(row) || row.length !== w) { errors.push('Todas as linhas têm de ter o mesmo comprimento.'); break; }
    if (row.some((h) => !Number.isInteger(h) || h < 0 || h > MAX_HEIGHT)) { errors.push(`As alturas têm de ser inteiros entre 0 e ${MAX_HEIGHT}.`); break; }
  }
  if (errors.length) return { ok: false, errors };
  if (total(g) < 1) return { ok: false, errors: ['O diagrama não tem cubos.'] };
  const pits = pitInfo(g);
  if (pits.maxDepth > MAX_PIT_DEPTH) errors.push(`Há um fosso com profundidade ${pits.maxDepth} (máximo ${MAX_PIT_DEPTH}).`);
  if (pits.thin > 0) errors.push('Há um fosso mais estreito do que 2×2.');
  const vis = visibilityReport(g);
  if (vis.hidden.length) errors.push(`O topo de ${vis.hidden.length} coluna(s) não é visível em nenhum ângulo (ex.: linha ${vis.hidden[0][0] + 1}, coluna ${vis.hidden[0][1] + 1}).`);
  return { ok: !errors.length, errors, pits, minViews: vis.minViews };
}

// ------------------------------------------------------------------ templates
function pitsOn(g, r, n, count, dmax, B) {
  for (let k = 0; k < count; k++) {
    let done = false;
    for (let tries = 0; tries < 60 && !done; tries++) {
      const pr = int(r, 1, n - 3), pc = int(r, 1, n - 3);
      let ok = true;
      for (let i = pr - 1; i <= pr + 2 && ok; i++) for (let j = pc - 1; j <= pc + 2; j++) if (g[i][j] < B) { ok = false; break; }
      if (!ok || [0, 1].some((i) => [0, 1].some((j) => g[pr + i][pc + j] !== B))) continue;
      const d = int(r, 1, dmax);
      for (const i of [0, 1]) for (const j of [0, 1]) g[pr + i][pc + j] = B - d;
      done = true;
    }
    if (!done) return false;
  }
  return true;
}
function freeBuild(n, r, { B, walls, wmax, stair, steps, pits, dmax }) {
  const g = mk(n, () => B);
  for (const s of walls) {
    const w = int(r, 1, wmax);
    for (let i = 0; i < n; i++) {
      const [rr, cc] = s === 'N' ? [0, i] : s === 'S' ? [n - 1, i] : s === 'W' ? [i, 0] : [i, n - 1];
      g[rr][cc] = Math.max(g[rr][cc], B + w);
    }
  }
  const mid = Math.floor(n / 2) - 1;
  for (let i = 0; i < steps; i++) {
    const h = B + 1 + i;
    const cells = stair === 'diag' ? [[i + 1, i + 1], [i + 1, i + 2]] : stair === 'diag1' ? [[i + 1, i + 1]] : [[mid, i + 1], [mid + 1, i + 1]];
    for (const [rr, cc] of cells) if (rr < n && cc < n) g[rr][cc] = Math.max(g[rr][cc], h);
  }
  if (!pitsOn(g, r, n, pits, dmax, B)) return null;
  let o = g;
  for (let k = int(r, 0, 3); k > 0; k--) o = rotate(o);
  return r() < 0.5 ? flip(o) : o;
}
const walls2 = (r) => pick(r, [['N', 'W'], ['N', 'E'], ['S', 'W'], ['S', 'E']]);
const walls3 = (r) => { const all = ['N', 'S', 'W', 'E']; all.splice(int(r, 0, 3), 1); return all; };
const wallsOpp = (r) => pick(r, [['N', 'S'], ['W', 'E']]);

// ---- shape helpers: a shape is f(i,j) -> height offset; `based` adds a base so the total lands in the level's range.
const U = (n, i) => Math.abs(2 * i - (n - 1)); // distance from the centre, in half cells
function based(level, r, n, f, { pits = 0, free = false } = {}) {
  const L = LEVELS[level], s = mk(n, f), mn = Math.min(...s.flat()), mx = Math.max(...s.flat()), sum = total(s), ok = [];
  for (let B = Math.max(1, 1 - mn); B + mx <= MAX_HEIGHT; B++) { const t = sum + B * n * n; if (t >= L.min && t <= L.max) ok.push(B); }
  if (!ok.length) return null;
  const B = pick(r, ok), g = mk(n, (i, j) => B + s[i][j]);
  if (pits) pitsOn(g, r, n, pits, 2, Math.min(...g.flat()));
  if (!free) return g;
  let o = g;
  for (let k = int(r, 0, 3); k > 0; k--) o = rotate(o);
  return r() < 0.5 ? flip(o) : o;
}

// Four-fold symmetric motifs (levels 1 and 2): functions of the distance from the centre only.
const ROT = [
  ['rings', 'Pirâmide em degraus', (r, n) => { const s = int(r, 1, 2); return (i, j) => s * ringOf(n, i, j); }],
  ['diamond', 'Diamante', (r, n) => { const K = int(r, 3, n); return (i, j) => Math.max(0, K - (U(n, i) + U(n, j)) / 2); }],
  ['corner-towers', 'Torres nos cantos', (r, n) => { const t = int(r, 2, 4); return (i, j) => (isCorner(n, i, j) ? t : 0); }],
  ['corner-blocks', 'Blocos 2×2 nos cantos', (r, n) => { const t = int(r, 1, 3); return (i, j) => (Math.min(i, n - 1 - i) < 2 && Math.min(j, n - 1 - j) < 2 ? t : 0); }],
  ['frame', 'Muralha', (r, n) => { const h = int(r, 1, 3); return (i, j) => (ringOf(n, i, j) === 0 ? h : 0); }],
  ['plus', 'Cruz', (r, n) => { const h = int(r, 1, 3); return (i, j) => (U(n, i) <= 1 || U(n, j) <= 1 ? h : 0); }],
  ['x', 'Cruz em X', (r, n) => { const h = int(r, 1, 3); return (i, j) => (i === j || i + j === n - 1 ? h : 0); }],
  ['stripes', 'Anéis alternados', (r, n) => { const h = int(r, 1, 2); return (i, j) => (ringOf(n, i, j) % 2) * h; }],
  ['gates', 'Portões ao centro', (r, n) => { const t = int(r, 1, 3); return (i, j) => (Math.max(U(n, i), U(n, j)) === n - 1 && Math.min(U(n, i), U(n, j)) <= 1 ? t : 0); }],
  ['keep', 'Torre central', (r, n) => { const t = int(r, 2, 4); return (i, j) => (ringOf(n, i, j) >= 2 ? t : 0); }],
  ['castle', 'Castelo de muralha', (r, n) => { const h = int(r, 1, 2), t = int(r, 1, 3); return (i, j) => (ringOf(n, i, j) === 0 ? h + (isCorner(n, i, j) ? t : 0) : 0); }],
  ['star', 'Estrela', (r, n) => { const K = int(r, 3, 5); return (i, j) => Math.max(0, K - Math.abs(U(n, i) - U(n, j)) / 2); }],
  ['quad-pyramids', 'Quatro pirâmides', (r, n) => { const K = int(r, 2, 3), q = n === 5 ? [1, 3] : [1, 4]; return (i, j) => Math.max(0, K - Math.min(...q.flatMap((a) => q.map((b) => Math.max(Math.abs(i - a), Math.abs(j - b)))))); }],
  ['thick-x', 'Grande X', (r, n) => { const h = int(r, 1, 3); return (i, j) => (Math.abs(i - j) <= 1 || Math.abs(i + j - (n - 1)) <= 1 ? h : 0); }],
  ['corner-stairs', 'Escadas nos cantos', (r, n) => { const K = int(r, 3, 5); return (i, j) => Math.max(0, K - Math.min(i, n - 1 - i) - Math.min(j, n - 1 - j)); }],
  ['plateau', 'Praça elevada', (r, n) => { const h = int(r, 1, 3); return (i, j) => (ringOf(n, i, j) >= 1 ? h : 0); }],
  ['pillars', 'Pilares interiores', (r, n) => { const t = int(r, 2, 4); return (i, j) => (ringOf(n, i, j) === 1 && U(n, i) === U(n, j) ? t : 0); }],
  ['bowl', 'Taça', (r, n) => { const s = int(r, 1, 2), m = Math.floor((n - 1) / 2); return (i, j) => s * (m - ringOf(n, i, j)); }],
  ['sun', 'Sol', (r, n) => { const t = int(r, 1, 2); return (i, j) => ringOf(n, i, j) + (U(n, i) <= 1 || U(n, j) <= 1 ? t : 0); }],
];

// Left-right mirrored motifs (level 3, 7x7): f(row, w) where w = 0 (outer) .. 3 (centre column).
const MIR = [
  ['spine', 'Espinha central em rampa', (r) => { const K = int(r, 4, 6); return (i, w) => (w === 3 ? Math.max(0, K - i) : 0); }],
  ['side-walls', 'Muros laterais', (r) => { const t = int(r, 1, 3); return (i, w) => (w === 0 ? t : 0); }],
  ['terraces', 'Terraços', (r) => { const s = int(r, 1, 2); return (i, w) => s * Math.min(w, i); }],
  ['tiers', 'Bancadas', (r) => { const s = int(r, 1, 2); return (i) => s * Math.floor(i / 2); }],
  ['twin-towers', 'Torres gémeas', (r) => { const t = int(r, 2, 4); return (i, w) => (w === 0 && (i === 0 || i === 6) ? t : 0); }],
  ['pit-bridge', 'Ponte e fossos', (r) => { const k = int(r, 2, 3), d = int(r, 1, 2), p = int(r, 2, 3); return (i, w) => (w === 3 ? k : w >= 1 && (i === p || i === p + 1) ? -d : 0); }],
  ['gatehouse', 'Portão', (r) => { const t = int(r, 2, 3); return (i, w) => (i === 0 && w !== 3 ? t : i === 6 && w === 0 ? 1 : 0); }],
  ['cross', 'Cruz', (r) => { const h = int(r, 1, 3); return (i, w) => (i === 3 || w === 3 ? h : 0); }],
  ['chevron', 'Seta', (r) => { const K = int(r, 3, 4); return (i, w) => Math.max(0, K - Math.abs(i - (3 - w))); }],
  ['diamond', 'Diamante', (r) => { const K = int(r, 4, 5); return (i, w) => Math.max(0, K - (Math.abs(i - 3) + (3 - w))); }],
  ['corner-pillar', 'Torres e pilar', (r) => { const t = int(r, 2, 4), c = int(r, 2, 4); return (i, w) => (w === 0 && (i === 0 || i === 6) ? t : w === 3 && i === 3 ? c : 0); }],
  ['moat', 'Muralha fechada', (r) => { const h = int(r, 1, 3); return (i, w) => (i === 0 || i === 6 || w === 0 ? h : 0); }],
  ['u-shape', 'Ferradura', (r) => { const h = int(r, 2, 3); return (i, w) => (i === 0 || w === 0 ? h : 0); }],
  ['ziggurat', 'Zigurate', (r) => { const s = int(r, 1, 2); return (i, w) => s * Math.min(i, 6 - i, w); }],
  ['diag-ramp', 'Rampa diagonal', (r) => { const s = int(r, 2, 3); return (i, w) => Math.floor((i + w) / s); }],
  ['pillars', 'Pilares', (r) => { const t = int(r, 2, 4); return (i, w) => (i % 2 === 0 && w % 2 === 0 ? t : 0); }],
  ['hourglass', 'Ampulheta', (r) => { const s = int(r, 1, 2); return (i) => s * Math.abs(i - 3); }],
  ['bleachers', 'Anfiteatro', (r) => { const s = int(r, 1, 2); return (i, w) => s * Math.floor((6 - i + (3 - w)) / 3); }],
  ['gutter', 'Calha', (r) => { const h = int(r, 2, 3); return (i, w) => (w === 3 ? 0 : h) + (i === 0 ? 1 : 0); }],
  ['rows', 'Filas de blocos', (r) => { const h = int(r, 1, 2); return (i, w) => (i % 2 === 0 ? h : 0) + (w === 3 ? 1 : 0); }],
];

// Free (asymmetric) motifs for levels 4 and 5: random placement, random rotation/flip.
const FREE = [
  ['diag-ramp', 'Rampa diagonal', (r) => { const s = int(r, 2, 3); return (i, j) => Math.floor((i + j) / s); }],
  ['ridge', 'Cordilheira', (r, n) => { const rr = int(r, 1, n - 2), K = int(r, 3, 4); return (i) => Math.max(0, K - Math.abs(i - rr)); }],
  ['corner-pyramid', 'Pirâmide de canto', (r, n) => { const K = int(r, n - 1, n + 1); return (i, j) => Math.max(0, K - Math.max(i, j)); }],
  ['off-pyramid', 'Pirâmide descentrada', (r, n) => { const a = int(r, 1, n - 2), b = int(r, 1, n - 2), K = int(r, 3, 4); return (i, j) => Math.max(0, K - Math.max(Math.abs(i - a), Math.abs(j - b))); }],
  ['off-diamond', 'Diamante descentrado', (r, n) => { const a = int(r, 1, n - 2), b = int(r, 1, n - 2), K = int(r, 4, 5); return (i, j) => Math.max(0, K - Math.abs(i - a) - Math.abs(j - b)); }],
  ['terraces', 'Socalcos', (r) => { const s = int(r, 2, 3); return (i, j) => Math.floor(j / s); }],
  ['valley', 'Vale', (r, n) => { const c = Math.floor(n / 2); return (i, j) => Math.abs(j - c); }],
  ['plateau', 'Planalto', (r) => { const i0 = int(r, 0, 2), j0 = int(r, 0, 2), h = int(r, 2, 3), s = int(r, 3, 4); return (i, j) => (i >= i0 && i < i0 + s && j >= j0 && j < j0 + s ? h : 0); }],
  ['two-towers', 'Duas torres', (r, n) => { const a = int(r, 3, 5), b = int(r, 2, 4); return (i, j) => (i === 0 && j === 0 ? a : i === n - 1 && j === n - 1 ? b : 0); }],
  ['l-wall', 'Muro em L', (r) => { const h = int(r, 2, 4); return (i, j) => (i === 0 || j === 0 ? h : 0); }],
  ['patches', 'Manchas 2×2', (r) => { const h = int(r, 1, 2); return (i, j) => ((Math.floor(i / 2) + Math.floor(j / 2)) % 2) * h; }],
  ['wave', 'Onda', (r) => { const h = int(r, 1, 2); return (i, j) => (((i + 2 * j) % 4) >> 1) * h; }],
  ['scattered', 'Torres dispersas', (r, n) => {
    const t = Array.from({ length: int(r, 4, 6) }, () => [int(r, 0, n - 1), int(r, 0, n - 1), int(r, 2, 4)]);
    return (i, j) => Math.max(0, ...t.map(([a, b, h]) => (i === a && j === b ? h : 0)));
  }],
  ['diag-wall', 'Muro diagonal', (r) => { const h = int(r, 2, 4), w = int(r, 0, 1); return (i, j) => (Math.abs(i - j) <= w ? h : 0); }],
  ['rings-off', 'Anéis descentrados', (r, n) => { const a = int(r, 1, n - 2), b = int(r, 1, n - 2), s = int(r, 1, 2); return (i, j) => s * Math.floor(Math.max(Math.abs(i - a), Math.abs(j - b)) / 2); }],
  ['half-pipe', 'Meio tubo', (r, n) => { const c = Math.floor(n / 2); return (i, j) => Math.floor(Math.abs(j - c) / 2) * 2; }],
  ['crossing', 'Cumes cruzados', (r, n) => { const a = int(r, 1, n - 2), b = int(r, 1, n - 2), h = int(r, 2, 3); return (i, j) => (i === a || j === b ? h : 0); }],
  ['twin-hills', 'Duas colinas', (r, n) => { const a = int(r, 1, n - 2), b = int(r, 1, 3), K = int(r, 3, 4); return (i, j) => Math.max(0, K - Math.max(Math.abs(i - a), Math.abs(j - b)), K - Math.max(Math.abs(i - (n - 1 - a)), Math.abs(j - (n - 1 - b)))); }],
  ['arena', 'Arena', (r) => { const h = int(r, 2, 3), a = int(r, 1, 2); return (i, j) => (i >= a && i < a + 4 && j >= a && j < a + 4 ? 0 : h); }],
  ['stairs-s', 'Escada em S', (r, n) => (i, j) => (i < n / 2 ? Math.floor(j / 2) : Math.floor((n - 1 - j) / 2))],
];

const FREE_BUILDS = [
  ['diagonal', 'Escada diagonal e muros', (n, r) => ({ walls: walls2(r), stair: 'diag', steps: n === 7 ? int(r, 3, 4) : 6 })],
  ['three-walls', 'Três muros e escada reta', (n, r) => ({ walls: walls3(r), stair: 'line', steps: n === 7 ? 4 : 6 })],
  ['corridor', 'Corredor com escada fina', (n, r) => ({ walls: wallsOpp(r), stair: 'diag1', steps: n === 7 ? 4 : 6 })],
];

const mkTpl = (level, id, name, build) => ({ id: `l${level}-${id}`, level, name, build });
export const TEMPLATES = [
  ...[1, 2].flatMap((level) => ROT.filter(([id]) => !(level === 1 && ['stripes', 'bowl', 'corner-stairs'].includes(id))).map(([id, name, f]) => mkTpl(level, id, name, (r) => { const n = LEVELS[level].n; return based(level, r, n, f(r, n)); }))),
  ...MIR.map(([id, name, f]) => mkTpl(3, id, name, (r) => { const g = f(r); return based(3, r, 7, (i, j) => g(i, Math.min(j, 6 - j)), ); })),
  ...[4, 5].flatMap((level) => [
    ...FREE.filter(([id]) => id !== 'wave').map(([id, name, f]) => mkTpl(level, id, name, (r) => { const n = LEVELS[level].n; return based(level, r, n, f(r, n), { free: true, pits: r() < 0.5 ? 1 : 0 }); })),
    ...FREE_BUILDS.filter(([id]) => !(level === 4 && id === 'three-walls')).map(([id, name, spec]) => mkTpl(level, id, name, (r) => { const n = LEVELS[level].n; return freeBuild(n, r, { B: level === 4 ? int(r, 2, 3) : 3, wmax: level === 4 ? 3 : 4, pits: 2, dmax: level === 4 ? 1 : 2, ...spec(n, r) }); })),
  ]),
];

export const templatesFor = (level) => TEMPLATES.filter((t) => t.level === level);

/** Symmetry check used by the tests: 'rot' = 4-fold rotation, 'mirror' = left/right. */
export function isSymmetric(g, kind) {
  if (kind === 'free') return true;
  const n = g.length;
  if (kind === 'mirror') return g.every((row) => row.every((h, c) => h === row[n - 1 - c]));
  return g.every((row, r) => row.every((h, c) => h === g[c][n - 1 - r] && h === g[n - 1 - r][n - 1 - c] && h === g[n - 1 - c][r]));
}

const FALLBACK = mk(5, (i, j) => 2 + ringOf(5, i, j));

/**
 * Generate one validated diagram.
 * @returns {{level, templateId, name, grid, answer, layers, seed, attempts, fallback?}}
 */
export function generate({ level = 1, seed = 1, templateId, tries = MAX_ATTEMPTS } = {}) {
  const L = LEVELS[level] || LEVELS[1];
  const tpl = TEMPLATES.find((t) => t.id === templateId) || pick(rng(seed), templatesFor(level));
  const R = rng(seed * 2654435761 + 12345);
  let attempts = 0;
  for (let pass = 0; pass < 20; pass++) {
    // Cheap rejections (shape, total) are free; every full visibility check counts as one of the attempts.
    for (let k = 0; k < 400; k++) {
      const g = tpl.build(R);
      if (!g) continue;
      const t = total(g);
      if (t < L.min || t > L.max) continue;
      attempts++;
      const v = validateGrid(g);
      if (v.ok) return pack(L, level, tpl, g, seed, attempts);
      if (attempts >= tries * (pass + 1)) break;
    }
  }
  return { ...pack(LEVELS[1], 1, TEMPLATES[0], FALLBACK, seed, attempts), fallback: true };
}
function pack(L, level, tpl, g, seed, attempts) {
  return { level, templateId: tpl.id, name: tpl.name, grid: g, answer: total(g), layers: layerCounts(g), seed, attempts };
}

/** Levels for `rounds` rounds, always rising, spread over 1..5 (at most 2 per level). */
export function levelsFor(rounds) {
  if (rounds <= 1) return [3];
  return Array.from({ length: rounds }, (_, i) => Math.round(1 + (i * 4) / (rounds - 1)));
}

/** Diagrams for a whole game: a different mold every round. `manual` diagrams take the first rounds. */
export function planGame({ rounds = 5, seed = 1, manual = [], excludeTemplates = [] } = {}) {
  const lv = levelsFor(rounds), used = new Set(excludeTemplates), r = rng(seed);
  const out = [];
  for (let i = 0; i < rounds; i++) {
    if (manual[i]) { out.push({ level: 0, templateId: 'manual', name: manual[i].name || `Manual ${i + 1}`, grid: manual[i].grid, answer: total(manual[i].grid), layers: layerCounts(manual[i].grid), seed: 0, attempts: 0 }); continue; }
    let options = templatesFor(lv[i]).filter((t) => !used.has(t.id));
    if (!options.length) options = templatesFor(lv[i]);
    const tpl = pick(r, options);
    used.add(tpl.id);
    out.push(generate({ level: lv[i], seed: int(r, 1, 2 ** 30), templateId: tpl.id }));
  }
  return out;
}

/** Hand-made diagrams from JSON: a matrix, a list of matrices, or {diagrams:[...]}; each item may be {name, grid}. */
export function parseManual(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { return { ok: false, errors: ['O ficheiro não é JSON válido.'], diagrams: [] }; }
  if (data && !Array.isArray(data) && Array.isArray(data.diagrams)) data = data.diagrams;
  if (Array.isArray(data) && data.length && Array.isArray(data[0]) && data[0].every((x) => typeof x === 'number')) data = [data];
  if (!Array.isArray(data) || !data.length) return { ok: false, errors: ['Esperava uma matriz de alturas ou uma lista de matrizes.'], diagrams: [] };
  const diagrams = [], errors = [];
  data.slice(0, 10).forEach((item, i) => {
    const grid = Array.isArray(item) ? item : item?.grid;
    const v = validateGrid(grid);
    if (!v.ok) errors.push(...v.errors.map((e) => `Diagrama ${i + 1}: ${e}`));
    else diagrams.push({ name: (!Array.isArray(item) && item.name) || `Manual ${i + 1}`, grid });
  });
  if (data.length > 10) errors.push('Máximo de 10 diagramas; os restantes foram ignorados.');
  return { ok: !errors.length, errors, diagrams };
}
