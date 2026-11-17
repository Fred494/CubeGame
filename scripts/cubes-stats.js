// Dev helper: acceptance rate, totals and attempts per template.  node scripts/cubes-stats.js [samples]
import { TEMPLATES, LEVELS, generate, isSymmetric, validateGrid } from '../public/cubes/gen.js';
const N = Number(process.argv[2] || 30);
for (const t of TEMPLATES) {
  const L = LEVELS[t.level]; const tot = []; let att = 0, fb = 0, asym = 0, bad = 0;
  const t0 = Date.now();
  for (let s = 1; s <= N; s++) {
    const d = generate({ level: t.level, seed: s * 7 + 1, templateId: t.id });
    if (d.fallback) fb++;
    tot.push(d.answer); att += d.attempts;
    if (!isSymmetric(d.grid, L.sym)) asym++;
    if (!validateGrid(d.grid).ok) bad++;
  }
  console.log(`${t.id.padEnd(18)} L${t.level} total ${Math.min(...tot)}-${Math.max(...tot)} (range ${L.min}-${L.max}) avgAttempts ${(att / N).toFixed(1)} fallback ${fb} asym ${asym} invalid ${bad} ${Date.now() - t0}ms`);
}
