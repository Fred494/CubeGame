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
export const VIEW_EL = [28, 42, 56];
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

export const TEMPLATES = [
  // ---- level 1: 5x5, four equal sides
  { id: 'l1-pyramid', level: 1, name: 'Pirâmide em degraus', build: (r) => { const B = int(r, 1, 3); return mk(5, (i, j) => B + ringOf(5, i, j)); } },
  { id: 'l1-towers', level: 1, name: 'Castelo de 4 torres', build: (r) => { const B = int(r, 1, 3), t = int(r, 2, 4); return mk(5, (i, j) => B + (isCorner(5, i, j) ? t : 0)); } },
  { id: 'l1-courtyard', level: 1, name: 'Castelo com pátio', build: (r) => { const B = int(r, 1, 2), t = int(r, 1, 3); return mk(5, (i, j) => (ringOf(5, i, j) === 0 ? B + 1 + (isCorner(5, i, j) ? t : 0) : B)); } },
  { id: 'l1-crater', level: 1, name: 'Cratera', build: (r) => { const B = int(r, 1, 2), h = int(r, 1, 2); return mk(5, (i, j) => (ringOf(5, i, j) === 0 ? B + h : B)); } },
  // ---- level 2: 6x6, four equal sides
  { id: 'l2-temple', level: 2, name: 'Templo em anéis', build: (r) => { const B = int(r, 2, 3), s = int(r, 1, 2); return mk(6, (i, j) => B + s * ringOf(6, i, j)); } },
  { id: 'l2-corner-towers', level: 2, name: 'Torres 2×2 nos cantos', build: (r) => {
    const B = int(r, 2, 4), t = int(r, 1, 3), pit = r() < 0.5, d = int(r, 1, Math.min(2, B)), k = int(r, 1, 3);
    return mk(6, (i, j) => { const cor = (i < 2 || i > 3) && (j < 2 || j > 3); const mid = i >= 2 && i <= 3 && j >= 2 && j <= 3; return cor ? B + t : mid ? (pit ? B - d : B + k) : B; });
  } },
  { id: 'l2-amphitheatre', level: 2, name: 'Anfiteatro', build: (r) => { const B = int(r, 1, 2), e0 = int(r, 2, 3), e1 = int(r, 1, 2); return mk(6, (i, j) => { const k = ringOf(6, i, j); return k === 0 ? B + e0 : k === 1 ? B + e1 : B; }); } },
  // ---- level 3: 7x7, mirror left = right
  { id: 'l3-fortress', level: 3, name: 'Fortaleza com rampa', build: (r) => {
    const B = pick(r, [2, 3, 3]), w = int(r, 1, 3), d = int(r, 1, 2), tw = r() < 0.5;
    return mirror(7, (i, j) => (i === 0 ? B + w : j === 3 && i <= 5 ? B + Math.min(3, 5 - i) : j >= 1 && j <= 2 && (i === 3 || i === 4) ? B - d : tw && i === 6 && j === 0 ? B + 2 : B));
  } },
  { id: 'l3-theatre', level: 3, name: 'Teatro de muros laterais', build: (r) => {
    const B = pick(r, [2, 3, 3]), w = int(r, 1, 3), d = int(r, 1, 2), p = int(r, 1, 4);
    return mirror(7, (i, j) => (j === 0 ? B + w : j === 3 ? B + (i < 2 ? 3 : i < 4 ? 2 : 1) : j <= 2 && (i === p || i === p + 1) ? B - d : B));
  } },
  { id: 'l3-bridge', level: 3, name: 'Ponte entre fossos', build: (r) => {
    const B = pick(r, [2, 3, 3]), k = int(r, 2, 4), d = int(r, 1, 2), p = int(r, 2, 3), cap = int(r, 1, 2);
    return mirror(7, (i, j) => (j === 3 ? B + k : j <= 2 && (i === p || i === p + 1) && j >= 1 ? B - d : i === 0 || i === 6 ? B + cap : B));
  } },
  // ---- level 4: 7x7 free
  { id: 'l4-diagonal', level: 4, name: 'Escada diagonal e muros', build: (r) => freeBuild(7, r, { B: int(r, 2, 3), walls: walls2(r), wmax: 3, stair: 'diag', steps: int(r, 3, 4), pits: 2, dmax: 1 }) },
  { id: 'l4-three-walls', level: 4, name: 'Três muros e escada reta', build: (r) => freeBuild(7, r, { B: int(r, 2, 3), walls: walls3(r), wmax: 2, stair: 'line', steps: 4, pits: 2, dmax: 1 }) },
  { id: 'l4-corridor', level: 4, name: 'Corredor com escada fina', build: (r) => freeBuild(7, r, { B: int(r, 2, 3), walls: wallsOpp(r), wmax: 3, stair: 'diag1', steps: 4, pits: 2, dmax: 1 }) },
  // ---- level 5: 8x8 free, base 3
  { id: 'l5-diagonal', level: 5, name: 'Grande escada diagonal', build: (r) => freeBuild(8, r, { B: 3, walls: walls2(r), wmax: 4, stair: 'diag', steps: 6, pits: 2, dmax: 2 }) },
  { id: 'l5-three-walls', level: 5, name: 'Cidadela de três muros', build: (r) => freeBuild(8, r, { B: 3, walls: walls3(r), wmax: 3, stair: 'line', steps: 6, pits: 2, dmax: 2 }) },
  { id: 'l5-corridor', level: 5, name: 'Desfiladeiro', build: (r) => freeBuild(8, r, { B: 3, walls: wallsOpp(r), wmax: 4, stair: 'diag1', steps: 6, pits: 2, dmax: 2 }) },
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
