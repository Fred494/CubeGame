import { CubeStage } from './cubes/view.js';
import { LEVELS, TEMPLATES, templatesFor, generate, formula, validateGrid, parseManual, total, isSymmetric, pitInfo, visibilityReport, layerCounts } from './cubes/gen.js';

const $ = (s) => document.querySelector(s);
const stage = new CubeStage($('#stage'));
stage.start();
$('#level').innerHTML = Object.entries(LEVELS).map(([k, L]) => `<option value="${k}">${k} · ${L.label} (${L.min}–${L.max})</option>`).join('');
const fillTpl = () => { $('#tpl').innerHTML = '<option value="">(aleatório)</option>' + templatesFor(Number($('#level').value)).map((t) => `<option value="${t.id}">${t.name}</option>`).join(''); };
fillTpl();
$('#level').onchange = () => { fillTpl(); gen(); };
$('#tpl').onchange = () => gen();

let cur = null, timer = null;
function show(d) {
  cur = d;
  clearInterval(timer); stage.setGrid(d.grid);
  const L = LEVELS[d.level];
  const v = validateGrid(d.grid), pits = pitInfo(d.grid), vis = visibilityReport(d.grid);
  $('#formula').innerHTML = `<span class="big">${formula(d.grid)}</span><span class="muted">${d.grid.length}×${d.grid[0].length} · ${d.name}</span>`;
  $('#info').innerHTML = `<table>
    <tr><td>Resposta</td><td class="r num">${total(d.grid)}</td></tr>
    <tr><td>Camadas</td><td class="r num">${layerCounts(d.grid).length}</td></tr>
    <tr><td>Molde</td><td class="r">${d.name}</td></tr>
    <tr><td>Validação</td><td class="r ${v.ok ? 'up' : 'down'}">${v.ok ? 'OK' : 'FALHOU'}</td></tr>
    <tr><td>Tentativas</td><td class="r num">${d.attempts ?? '—'}${d.fallback ? ' (fallback!)' : ''}</td></tr>
    <tr><td>Vistas mín. por topo</td><td class="r num">${vis.minViews} / 36</td></tr>
    <tr><td>Fossos</td><td class="r num">${pits.cells} cél. · prof. máx ${pits.maxDepth}</td></tr>
    ${L ? `<tr><td>Simetria (${L.sym})</td><td class="r ${isSymmetric(d.grid, L.sym) ? 'up' : 'down'}">${isSymmetric(d.grid, L.sym) ? 'sim' : 'não'}</td></tr>` : ''}
  </table>${v.errors.map((e) => `<p class="down" style="font-size:13px">${e}</p>`).join('')}`;
  if (d.templateId !== 'manual') {
    const u = new URL(location); u.searchParams.set('level', d.level); u.searchParams.set('seed', d.seed); u.searchParams.set('tpl', d.templateId);
    history.replaceState(null, '', u);
  }
}
function gen() {
  show(generate({ level: Number($('#level').value), seed: Number($('#seed').value) || 1, templateId: $('#tpl').value || undefined }));
}
$('#gen').onclick = gen;
$('#nextSeed').onclick = () => { $('#seed').value = (Number($('#seed').value) || 0) + 1; gen(); };
$('#rand').onclick = () => { $('#seed').value = 1 + Math.floor(Math.random() * 1e6); gen(); };
$('#spin').onclick = (e) => { stage.spin = !stage.spin; e.target.textContent = stage.spin ? '⏸ Parar rotação' : '▶ Rodar'; };
$('#build').onclick = () => {
  if (!cur) return;
  clearInterval(timer);
  const H = Math.max(...cur.grid.flat()), f = layerCounts(cur.grid), parts = [];
  let k = 0; stage.showLayers(0);
  timer = setInterval(() => {
    k++; stage.showLayers(k, true); parts.push(f[k - 1]);
    $('#formula .big').textContent = k < H ? parts.join(' + ') : formula(cur.grid);
    if (k >= H) clearInterval(timer);
  }, 900);
};
$('#loadManual').onclick = () => {
  const r = parseManual($('#manual').value);
  if (!r.ok) { $('#info').innerHTML = r.errors.map((e) => `<p class="down">${e}</p>`).join(''); return; }
  show({ level: 0, name: r.diagrams[0].name, templateId: 'manual', grid: r.diagrams[0].grid, seed: 0, attempts: 0 });
};
$('#stats').onclick = async () => {
  const out = $('#statsOut'); out.textContent = 'A gerar…';
  await new Promise((r) => setTimeout(r, 30));
  let html = '<table><tr><th>Molde</th><th>Nível</th><th class="r">Cubos mín</th><th class="r">média</th><th class="r">máx</th><th class="r">Tentativas (média)</th><th class="r">Fallback</th></tr>';
  for (const t of TEMPLATES) {
    const tot = []; let att = 0, fb = 0;
    for (let s = 1; s <= 40; s++) { const d = generate({ level: t.level, seed: s * 7919, templateId: t.id }); tot.push(d.answer); att += d.attempts; if (d.fallback) fb++; }
    html += `<tr><td>${t.name}</td><td>${t.level}</td><td class="r num">${Math.min(...tot)}</td><td class="r num">${Math.round(tot.reduce((a, b) => a + b, 0) / tot.length)}</td><td class="r num">${Math.max(...tot)}</td><td class="r num">${(att / 40).toFixed(1)}</td><td class="r num ${fb ? 'down' : ''}">${fb}</td></tr>`;
    await new Promise((r) => setTimeout(r, 0));
  }
  out.innerHTML = html + '</table>';
};

const q = new URLSearchParams(location.search);
if (q.get('level')) $('#level').value = q.get('level');
fillTpl();
if (q.get('tpl')) $('#tpl').value = q.get('tpl');
if (q.get('seed')) $('#seed').value = q.get('seed');
gen();
window.__stage = stage;
