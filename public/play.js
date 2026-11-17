import { api, esc, $, toast, fx, fmtClock } from './common.js';

const AVATARS = ['#4F8EFF', '#2BD99F', '#F5C56B', '#F26B78', '#A78BFA', '#38BDF8', '#FB923C', '#F472B6'];
const KEY = 'cubes-session';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
const clear = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };
const fmtMs = (ms) => { const t = Math.round(ms / 100) / 10, m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const main = $('#main');

let session = load();
{ const want = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase(); if (session && want && want !== String(session.code).toUpperCase()) { clear(); session = null; } }
let S = null, sig = '', off = 0, lockAt = 0; // lockAt: local performance.now() when the lock ends
const NK = () => `cubes-notes-${session?.code}`;
const ui = { tab: 'answer', expr: '', res: '', notes: '', entry: '', avatar: AVATARS[0], joinErr: '', busy: false, justSolved: null };

async function poll() {
  if (!session) return;
  try {
    const t0 = Date.now();
    const s = await api(`/api/rooms/${session.code}/state`, { token: session.token });
    off = s.serverNow - (t0 + Date.now()) / 2;
    if (s.build) { if (window.__build && window.__build !== s.build) { location.reload(); return; } window.__build = s.build; }
    const prev = S; S = s;
    if (s.mine) lockAt = performance.now() + s.mine.lockMs;
    if (!prev || prev.round !== s.round || prev.phase !== s.phase) ui.entry = '';
    if (!prev || prev.round !== s.round) { ui.tab = 'answer'; ui.expr = ''; ui.res = ''; ui.notes = ''; try { localStorage.removeItem(NK()); } catch { /* ignore */ } }
    else if (!ui.notes) { try { ui.notes = localStorage.getItem(NK()) || ''; } catch { /* ignore */ } }
    const key = JSON.stringify({ ...S, serverNow: 0, build: 0, mine: S.mine && { ...S.mine, lockMs: S.mine.lockMs > 0 } });
    if (key !== sig) { sig = key; render(); }
  } catch (e) { if (e.status === 401 || e.status === 404) { clear(); session = null; S = null; render(); } }
}
setInterval(poll, 1000);

// local ticking: countdown digit, lock seconds, switch back to the keypad when the lock ends
let lastDigit = null, wasLocked = false;
setInterval(() => {
  if (!S) return;
  const now = Date.now() + off;
  if (S.phase === 'countdown') {
    const left = S.revealAt - now, d = Math.ceil(left / 1000);
    if (left > 0 && d !== lastDigit) { lastDigit = d; const el = $('#cd'); if (el) el.textContent = d; fx.beep(d === 1 ? 880 : 660, 100, 30); }
    if (left <= 0 && S.phase === 'countdown') { S = { ...S, phase: 'playing', revealAt: S.revealAt }; sig = ''; render(); }
  }
  if (S.phase === 'playing') {
    const t = $('#elapsed'); if (t) t.textContent = fmtClock(Math.max(0, S.revealAt + S.roundMs - now));
    const left = lockAt - performance.now();
    const locked = left > 0 && !S.mine?.solved;
    const l = $('#lockSec'); if (l) l.textContent = Math.ceil(left / 1000);
    if (locked !== wasLocked) { wasLocked = locked; sig = ''; render(); }
  }
}, 150);

// ------------------------------------------------------------------ views
function render() {
  const ta = document.activeElement?.id === 'notes' ? document.activeElement : null, caret = ta ? ta.selectionStart : 0;
  draw();
  if (ta) { const n = $('#notes'); if (n) { n.focus(); n.setSelectionRange(caret, caret); } }
}
function draw() {
  if (!session || !S) { main.innerHTML = joinView(); return; }
  const v = S.phase === 'lobby' ? lobbyView() : S.phase === 'rules' ? rulesView() : S.phase === 'countdown' ? countdownView() : S.phase === 'playing' ? playingView() : S.phase === 'roundend' ? roundEndView() : finalView();
  main.innerHTML = `<div class="row"><span class="brand">CONTA <b>CUBOS</b></span><span class="grow"></span>${S.round ? `<span class="chip">Ronda ${S.round}/${S.totalRounds}</span>` : ''}<span class="chip">${esc(S.me.name)}</span></div><div class="scr">${v}</div>`;
}
function joinView() {
  const p = new URLSearchParams(location.search);
  return `<div class="hero"><h1>CONTA <b style="color:var(--green)">CUBOS</b></h1><p class="muted">Entra no jogo com o código da sala do anfitrião.</p></div>
  <form class="card" id="joinForm" autocomplete="off">
    <label class="f" for="code">Código da sala</label><input id="code" class="code-in" maxlength="6" autocapitalize="characters" value="${esc((p.get('code') || '').toUpperCase())}" placeholder="ABC123">
    <label class="f" for="name">O teu nome</label><input id="name" maxlength="16" placeholder="ex.: Maria">
    <label class="f">Cor do avatar</label><div class="swatches">${AVATARS.map((c) => `<button type="button" class="sw ${c === ui.avatar ? 'sel' : ''}" data-act="avatar" data-v="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}</div>
    ${ui.joinErr ? `<p class="down" role="alert">${esc(ui.joinErr)}</p>` : ''}
    <button class="btn green" style="width:100%;margin-top:18px">Entrar no jogo</button></form>`;
}
const lobbyView = () => `<div class="hero"><h1>Estás dentro!</h1><p class="muted">Sala <b>${esc(S.code)}</b> · à espera que o anfitrião comece.</p></div>
  <div class="card"><h3>Jogadores (${S.players.length}/${S.maxPlayers})</h3><div class="pl-list" style="margin-top:10px">${S.players.map((p) => `<span class="chip" style="font-size:15px;padding:6px 12px">${esc(p.name)}${p.id === S.me.id ? ' (tu)' : ''}</span>`).join('')}</div></div>
  <div class="card"><h3>Como funciona</h3><p class="muted">Um diagrama 3D de cubos aparece no ecrã principal. Conta (ou calcula!) quantos cubos tem e escreve aqui o número. Ganha quem acertar mais depressa.</p></div>`;
const rulesView = () => `<div class="card"><h2>Regras</h2><ul style="line-height:1.7;padding-left:20px"><li>Olha sempre para o <b>ecrã principal</b>: o diagrama não aparece aqui.</li><li>As colunas são sempre <b>cheias até ao chão</b>, sem buracos escondidos.</li><li>Resposta errada: <b>bloqueio de 20 s</b>.</li><li>Cada ronda dura no máximo <b>3 minutos</b>.</li></ul></div><p class="tag">À espera que o anfitrião comece a ronda 1…</p>`;
const countdownView = () => `<div class="state ok" style="background:var(--blue);color:#fff;margin:auto 0"><div class="mid">Olha para o ecrã principal!</div><div class="huge" id="cd">${Math.max(1, Math.ceil((S.revealAt - (Date.now() + off)) / 1000))}</div></div>`;

function playingView() {
  const m = S.mine || { solved: false, attempts: 0 };
  if (m.solved) return `<div class="state ok" style="margin:auto 0"><div class="huge">Certo!</div><div class="mid">${fmtMs(m.solvedMs)}</div><p style="font-size:18px;font-weight:600">${m.attempts} tentativa${m.attempts === 1 ? '' : 's'} · à espera dos outros… (${S.solvedCount}/${S.players.length})</p></div>`;
  const left = Math.ceil((lockAt - performance.now()) / 1000), locked = left > 0;
  const tabs = `<div class="tabs"><button data-act="tab" data-v="answer" class="${ui.tab === 'answer' ? 'on' : ''}">🔢 Resposta</button><button data-act="tab" data-v="calc" class="${ui.tab === 'calc' ? 'on' : ''}">🧮 Calculadora e notas</button></div>`;
  const info = `<div class="tag">Quantos cubos tem o diagrama? · <span id="elapsed" class="num">${fmtClock(S.roundMs)}</span> · ${m.attempts ? `${m.attempts} tentativa${m.attempts === 1 ? '' : 's'}` : 'olha para o ecrã'}</div>`;
  if (ui.tab === 'calc') return tabs + info + calcView(locked, left);
  if (locked) return tabs + `<div class="state bad" style="margin:auto 0"><div class="mid">Errado!</div><div class="huge" id="lockSec">${left}</div><p style="font-size:18px;font-weight:600">Bloqueado. Usa a calculadora e as notas para pensar e tenta outra vez quando acabar.</p></div>`;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  return tabs + info + `
  <div class="display ${ui.entry ? '' : 'empty'}" id="disp">${ui.entry || 'Escreve a resposta'}</div>
  <div class="keys">${keys.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === '⌫' ? 'Apagar' : k === 'C' ? 'Limpar' : k}">${k}</button>`).join('')}</div>
  <button class="btn green send" data-act="send" ${ui.entry && !ui.busy ? '' : 'disabled'}>Enviar</button>`;
}

const CALC_KEYS = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '='];
function calcView(locked, left) {
  return `${locked ? `<div class="tag" style="color:var(--red)">Bloqueado: <span id="lockSec">${left}</span> s (ainda podes calcular)</div>` : ''}
  <div class="calc"><div class="cexpr" id="cexpr">${esc(ui.expr) || '&nbsp;'}</div><div class="cres" id="cres">${esc(ui.res)}</div>
  <div class="ckeys">${CALC_KEYS.map((k) => `<button data-act="ckey" data-k="${k}" class="${'÷×−+='.includes(k) ? 'op' : ''}">${k}</button>`).join('')}</div>
  <button class="btn ghost sm" data-act="useres" style="width:100%;margin-top:8px">Usar resultado como resposta</button></div>
  <label class="f" for="notes">Notas (só tu vês)</label><textarea id="notes" rows="5" placeholder="ex.: base 5×5×2 = 50; 4 torres de 3 = 12; fosso −4…">${esc(ui.notes)}</textarea>`;
}
/** Tiny safe expression evaluator: + − × ÷, parentheses, unary minus. */
function calcEval(src) {
  const norm = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const t = norm.match(/\d+\.?\d*|\.\d+|[-+*/()]/g) || [];
  if (t.join('').length !== norm.length) throw new Error('bad');
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const prim = () => {
    const x = next();
    if (x === undefined) throw new Error('bad');
    if (x === '(') { const v = expr(); if (next() !== ')') throw new Error('bad'); return v; }
    if (x === '-') return -prim();
    if (x === '+') return prim();
    const n = Number(x); if (Number.isNaN(n)) throw new Error('bad'); return n;
  };
  const term = () => { let v = prim(); while (peek() === '*' || peek() === '/') { const o = next(), r = prim(); v = o === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(), r = term(); v = o === '+' ? v + r : v - r; } return v; };
  const v = expr();
  if (i !== t.length || !Number.isFinite(v)) throw new Error('bad');
  return Math.round(v * 1e6) / 1e6;
}

function roundEndView() {
  const me = (S.lastResults || []).find((r) => r.id === S.me.id);
  const st = S.standings.find((r) => r.id === S.me.id);
  return `<div class="state ${me?.solved ? 'ok' : 'bad'}"><div class="mid">Ronda ${S.round} terminada</div><div class="huge">${me ? `${me.rank}.º` : '—'}</div><div class="mid">${me ? (me.solved ? fmtMs(me.ms) : 'não acertaste (3:30)') : ''}</div></div>
  <div class="card"><div class="row"><span class="muted grow">Resposta certa</span><b class="num" style="font-size:26px">${S.answer ?? ''}</b></div><p class="muted" style="margin:6px 0 0">${esc((S.layers || []).join(' + '))} = ${S.answer ?? ''}</p></div>
  <div class="card"><h3>Classificação acumulada</h3>${S.standings.map((r) => `<div class="lb-row ${r.id === S.me.id ? 'me' : ''}"><b>${r.rank}</b><span>${esc(r.name)}</span><span class="num">${fmtMs(r.totalMs)}</span></div>`).join('')}${st ? '' : ''}</div>
  <p class="tag">${S.round >= S.totalRounds ? 'À espera do resultado final…' : 'À espera que o anfitrião comece a próxima ronda…'}</p>`;
}
function finalView() {
  const me = S.standings.find((r) => r.id === S.me.id);
  return `<div class="state ${me?.rank === 1 ? 'ok' : ''}" style="${me?.rank === 1 ? '' : 'background:var(--bg2)'}"><div class="mid">${me?.rank === 1 ? '🏆 Ganhaste!' : 'Fim do jogo'}</div><div class="huge">${me ? me.rank + '.º' : ''}</div><div class="mid">${me ? fmtMs(me.totalMs) : ''}</div></div>
  <div class="card"><h3>Classificação final</h3>${S.standings.map((r) => `<div class="lb-row ${r.id === S.me.id ? 'me' : ''}"><b>${r.rank}</b><span>${esc(r.name)}</span><span class="num">${fmtMs(r.totalMs)}</span></div>`).join('')}</div>`;
}

// ------------------------------------------------------------------ events
async function submit() {
  if (!ui.entry || ui.busy || !S || S.phase !== 'playing') return;
  ui.busy = true; render();
  try {
    const r = await api(`/api/rooms/${session.code}/player`, { method: 'POST', token: session.token, body: { action: 'answer', value: Number(ui.entry) } });
    ui.entry = '';
    if (r.correct) { fx.beep(880, 250, 200); } else { lockAt = performance.now() + r.lockMs; fx.beep(220, 300, 300); }
  } catch (e) {
    if (e.code === 'locked' && e.lockMs) lockAt = performance.now() + e.lockMs; else toast(e.message, 'err');
  }
  ui.busy = false; sig = ''; await poll(); sig = ''; render();
}
main.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'avatar') { ui.avatar = el.dataset.v; const c = $('#code')?.value, n = $('#name')?.value; render(); if ($('#code')) { $('#code').value = c; $('#name').value = n; } }
  else if (a === 'key') {
    const k = el.dataset.k;
    if (k === 'C') ui.entry = ''; else if (k === '⌫') ui.entry = ui.entry.slice(0, -1); else if (ui.entry.length < 5) ui.entry += k;
    const d = $('#disp'); if (d) { d.textContent = ui.entry || 'Escreve a resposta'; d.classList.toggle('empty', !ui.entry); }
    const s = main.querySelector('[data-act=send]'); if (s) s.disabled = !ui.entry;
    if (navigator.vibrate) navigator.vibrate(10);
  } else if (a === 'send') submit();
  else if (a === 'tab') { ui.tab = el.dataset.v; render(); }
  else if (a === 'ckey') {
    const k = el.dataset.k;
    if (k === 'C') { ui.expr = ''; ui.res = ''; }
    else if (k === '⌫') ui.expr = ui.expr.slice(0, -1);
    else if (k === '=') { try { ui.res = String(calcEval(ui.expr)); ui.expr = ui.res; } catch { ui.res = 'Erro'; } }
    else if (ui.expr.length < 60) { if (ui.res && ui.expr === ui.res && !'÷×−+'.includes(k)) ui.expr = ''; ui.expr += k; ui.res = ''; }
    const ce = $('#cexpr'), cr = $('#cres'); if (ce) ce.innerHTML = esc(ui.expr) || '&nbsp;'; if (cr) cr.textContent = ui.res;
    if (navigator.vibrate) navigator.vibrate(8);
  } else if (a === 'useres') {
    let v; try { v = calcEval(ui.expr); } catch { v = NaN; }
    if (Number.isInteger(v) && v >= 0 && v <= 99999) { ui.entry = String(v); ui.tab = 'answer'; render(); } else toast('O resultado tem de ser um número inteiro positivo.', 'err');
  }
});
main.addEventListener('input', (e) => { if (e.target.id === 'notes') { ui.notes = e.target.value; try { localStorage.setItem(NK(), ui.notes); } catch { /* ignore */ } } });
main.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#code').value.trim().toUpperCase(), name = $('#name').value.trim();
  try {
    const old = load();
    const r = await api(`/api/rooms/${code}/join`, { method: 'POST', body: { name, avatar: ui.avatar, token: old && old.code === code ? old.token : undefined } });
    session = { code, token: r.token, id: r.playerId }; save(session); ui.joinErr = ''; sig = ''; await poll(); render();
  } catch (er) { ui.joinErr = er.message; render(); if ($('#code')) { $('#code').value = code; $('#name').value = name; } }
});
render();
poll();
