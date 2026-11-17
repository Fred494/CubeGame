import { API, api, esc, $, toast, fx, fmtClock } from './common.js';
import { CubeStage } from './cubes/view.js';

const KEY = 'cubes-host';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
if (new URLSearchParams(location.search).has('new')) { try { localStorage.removeItem(KEY); } catch {} history.replaceState(null, '', location.pathname); }
let host = load();
let S = null, sig = '', off = 0; // off = server clock - local clock
let showAns = false, stage = null, stageRound = 0;
let anim = null; // layer-by-layer build at the end of a round
const app = $('#app'), game = $('#game'), chTop = $('#chTop'), chBody = $('#chBody'), chOv = $('#chOverlay');
const joinUrl = () => `${location.origin}${location.pathname.replace(/host.html$/, '')}play.html?code=${host.code}`;
const srvNow = () => Date.now() + off;
const fmtMs = (ms) => { const t = Math.round(ms / 100) / 10, m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };

// ------------------------------------------------------------------ polling
async function poll() {
  if (!host) return;
  try {
    const t0 = Date.now();
    const s = await api(`/api/rooms/${host.code}/state`, { token: host.token });
    off = s.serverNow - (t0 + Date.now()) / 2;
    if (s.build) { if (window.__build && window.__build !== s.build) { location.reload(); return; } window.__build = s.build; }
    S = s;
    const key = JSON.stringify({ ...S, serverNow: 0, build: 0, players: S.players.map((p) => ({ ...p })) }) + showAns;
    if (key !== sig) { sig = key; render(); }
  } catch (e) { if (e.status === 401 || e.status === 404) { localStorage.removeItem(KEY); host = null; S = null; render(); } }
}
setInterval(poll, 800);
const hostCall = async (body, okMsg) => {
  try { const r = await api(`/api/rooms/${host.code}/host`, { method: 'POST', body, token: host.token }); if (okMsg) toast(okMsg); await poll(); sig = ''; render(); return r; }
  catch (e) { toast(e.message, 'err'); return null; }
};

// ------------------------------------------------------------------ local clock (countdown digits, round timer)
let lastDigit = null, lastSolved = 0;
setInterval(() => {
  if (!S) return;
  const now = srvNow();
  if (S.phase === 'countdown') {
    const left = S.revealAt - now;
    if (left <= 0) { if (chOv.innerHTML) chOv.innerHTML = ''; if (!S.diagram) poll(); return; }
    const d = Math.ceil(left / 1000);
    if (d !== lastDigit) { lastDigit = d; chOv.innerHTML = `<div class="cd-big"><div>${d}<small>Prepara-te… o diagrama aparece já a seguir</small></div></div>`; fx.beep(d === 1 ? 880 : 660, 120); }
  } else if (chOv.innerHTML) { chOv.innerHTML = ''; lastDigit = null; }
  const clock = $('#clock');
  if (clock && S.phase === 'playing') {
    const left = Math.max(0, S.revealAt + S.roundMs - now);
    clock.textContent = fmtClock(Math.min(S.roundMs, left)); clock.classList.toggle('low', left < 30000);
  }
}, 100);

// ------------------------------------------------------------------ views
function render() {
  const inGame = host && S && ['countdown', 'playing', 'roundend'].includes(S.phase);
  game.hidden = !inGame; document.body.classList.toggle('cubes-host', !!inGame);
  app.hidden = inGame;
  if (!inGame) { stopStage(); app.innerHTML = !host || !S ? createView() : S.phase === 'lobby' ? lobbyView() : S.phase === 'rules' ? rulesView() : S.phase === 'finished' ? finalView() : ''; return; }
  gameView();
}
function stopStage() { if (anim) { clearInterval(anim.timer); anim = null; } if (stage) { stage.dispose(); stage = null; stageRound = 0; } }

const head = (extra = '') => `<div class="hbar"><span class="brand" style="font-size:20px">CONTA <b>CUBOS</b></span>${S ? `<span class="chip">Sala ${esc(S.code)}</span>` : ''}${S?.testMode ? '<span class="chip paused">MODO DE TESTE</span>' : ''}<span class="grow"></span>${extra}</div>`;

const createView = () => '<p class="muted" style="text-align:center;margin-top:20vh;font-size:22px">A criar o jogo…</p>';

function lobbyView() {
  const n = S.players.length, need = S.testMode ? 1 : 2, ok = n >= need;
  const showTest = /test/.test(location.search); // hidden developer switch: host.html?test
  return `${head()}<div class="grid">
  <div class="card"><div class="muted" style="font-size:18px">Entra em <b>${esc(location.host)}</b> com o código</div><div class="code">${esc(S.code)}</div>
    <div class="row" style="align-items:flex-start"><img class="qr" alt="QR code" src="${API}/api/qr?text=${encodeURIComponent(joinUrl())}"><div class="grow muted" style="font-size:17px">Lê o QR code com o telemóvel<br>ou abre <b style="word-break:break-all;color:var(--text)">${esc(joinUrl())}</b></div></div>
    <h2 style="font-size:22px;margin-top:20px">Jogadores (${n}/${S.maxPlayers})</h2>
    ${S.players.map((p) => `<div class="prow" style="grid-template-columns:36px 1fr 36px"><span class="avatar" style="background:${esc(p.avatar)}">${esc(p.name[0].toUpperCase())}</span><div><b style="font-size:18px">${esc(p.name)}</b> <span class="dot ${p.connected ? 'on' : ''}"></span></div><button class="btn ghost sm" data-act="kick" data-id="${esc(p.id)}" aria-label="Remover ${esc(p.name)}">✕</button></div>`).join('') || '<p class="muted">À espera de jogadores…</p>'}</div>
  <div class="card"><h2 style="font-size:22px">Quantas rondas?</h2>
    <div class="ctl" style="margin-top:12px">${Array.from({ length: 10 }, (_, i) => i + 1).map((r) => `<button class="btn ${S.totalRounds === r ? 'green' : 'ghost'}" style="min-width:56px;min-height:56px;font-size:20px" data-act="rounds" data-v="${r}" aria-pressed="${S.totalRounds === r}">${r}</button>`).join('')}</div>
    <p class="muted" style="margin-top:12px">Cada ronda é mais difícil do que a anterior.</p>
    ${showTest ? `<button class="btn ${S.testMode ? 'gold' : 'ghost'} sm" data-act="test" aria-pressed="${S.testMode}">${S.testMode ? '✓ Modo de teste ligado' : 'Modo de teste'}</button>` : ''}
    <button class="btn green" style="width:100%;margin-top:26px;font-size:22px;min-height:68px" data-act="start" ${ok ? '' : 'disabled'}>${ok ? 'Começar o jogo' : `À espera de ${need} jogador(es)…`}</button>
  </div></div>`;
}

function rulesView() {
  return `${head()}<div class="card" style="max-width:900px;margin:24px auto;border-color:var(--gold)"><h1 style="font-size:44px">Regras</h1>
  <ul class="rules-list">
    <li>Adivinha quantos cubos tem o diagrama.</li>
    <li>Ganha quem acertar mais rápido.</li>
    <li>Tens <b>3 minutos</b> para cada ronda.</li>
    <li>Ao errares uma resposta ficas <b>20 segundos</b> bloqueado de responder. Não há limite de tentativas, só o tempo.</li></ul>
  <div class="ctl" style="margin-top:20px"><button class="btn green" data-act="next" style="font-size:24px;padding:18px 32px">Começar a ronda 1</button></div></div>`;
}

function finalView() {
  const st = S.standings, medal = ['🥇', '🥈', '🥉'];
  return `${head('<button class="btn ghost sm" data-act="restart">↺ Jogar outra vez</button>')}
  <div class="card" style="text-align:center;border-color:var(--gold)"><div style="font-size:54px">🏆</div><div class="muted">CONTA CUBOS · VENCEDOR</div><h1 style="font-size:48px">${esc(st[0]?.name || '')}</h1><div class="num gold" style="font-size:30px">${st[0] ? fmtMs(st[0].totalMs) : ''} no total</div></div>
  <div class="card" style="margin-top:16px"><h2 style="font-size:22px">Classificação final</h2><table class="rank-table"><tr><th>#</th><th>Jogador</th>${Array.from({ length: S.totalRounds }, (_, i) => `<th class="r">R${i + 1}</th>`).join('')}<th class="r">Total</th></tr>
  ${st.map((r) => `<tr><td>${medal[r.rank - 1] || r.rank}</td><td><b>${esc(r.name)}</b></td>${r.rounds.map((x) => `<td class="r num ${x && !x.solved ? 'down' : ''}">${x ? fmtMs(x.ms) : '—'}</td>`).join('')}<td class="r num">${fmtMs(r.totalMs)}</td></tr>`).join('')}</table>
  <p class="muted" style="font-size:13px">Tempos a vermelho: não acertou dentro de 3 minutos (3:00 + 30 s).</p></div>`;
}

// ---- in-game overlay on top of the 3D stage
function gameView() {
  if (!stage) { stage = new CubeStage($('#stage')); stage.start(); stageRound = 0; }
  if (S.diagram && stageRound !== S.round) {
    stageRound = S.round; if (anim) { clearInterval(anim.timer); anim = null; }
    stage.setGrid(S.diagram.grid);
    lastSolved = 0;
  }
  const over = S.phase === 'roundend';
  // while counting down the stage is hidden (it would still show the previous round)
  $('#chStage').style.visibility = S.phase === 'countdown' ? 'hidden' : 'visible';
  if (S.phase === 'countdown' && !chOv.innerHTML) { lastDigit = null; chOv.innerHTML = '<div class="cd-big"><div>' + Math.max(1, Math.ceil((S.revealAt - srvNow()) / 1000)) + '</div></div>'; }
  if (over && !anim && S.layers) startBuild();
  if (!over && anim) { clearInterval(anim.timer); anim = null; }
  const done = over && anim?.done;
  $('#chStage').classList.toggle('shrunk', !!done);

  chTop.innerHTML = `<span class="brand" style="font-size:18px">CONTA <b>CUBOS</b></span><b style="font-size:20px">Ronda ${S.round}/${S.totalRounds}</b><span class="chip">Nível ${esc(S.diagram?.level || 'manual')}</span><span class="chip">Sala ${esc(S.code)}</span>${S.testMode ? '<span class="chip paused">TESTE</span>' : ''}<span class="grow"></span>
    ${S.testMode ? `<button class="btn ghost sm" data-act="ans">${showAns ? 'Esconder' : 'Mostrar'} resposta (A)</button>${over ? '' : '<button class="btn ghost sm" data-act="skip">⏭ Saltar ronda (N)</button>'}` : ''}
    ${over ? `<button class="btn green sm" data-act="next">${S.round >= S.totalRounds ? '🏁 Ver resultado final' : `▶ Ronda ${S.round + 1}`}</button>` : ''}`;

  let body = '';
  if (S.phase === 'playing' || S.phase === 'countdown') {
    body = `<div class="hud"><div class="clock num" id="clock">${fmtClock(S.roundMs)}</div>
      <div class="solved">${S.solvedCount}/${S.players.length} acertaram</div>
      <div class="names">${S.solvedNames.map((n) => `<span class="chip">✓ ${esc(n)}</span>`).join('')}</div></div>`;
  } else if (over) {
    const rr = S.lastResults || [];
    body = `<div style="flex:1"></div><div class="bottom"><div class="formula-line" id="formulaLine">${esc(anim?.text || '')}</div></div>`;
    if (done) {
      body = `<div class="panel res"><h2 style="font-size:26px">Ronda ${S.round}</h2><div class="formula-line" style="font-size:34px;margin:6px 0 12px;background:none;padding:0">${esc(S.layers.join(' + '))} = <span class="gold">${S.answer}</span></div>
        <table class="rank-table"><tr><th>#</th><th>Jogador</th><th class="r">Tempo</th><th class="r">Tent.</th></tr>
        ${rr.map((r) => `<tr><td>${r.rank}</td><td><b>${esc(r.name)}</b></td><td class="r num ${r.solved ? '' : 'down'}">${r.solved ? fmtMs(r.ms) : fmtMs(r.ms) + ' ✗'}</td><td class="r num">${r.attempts}</td></tr>`).join('')}</table>
        <h2 style="font-size:22px;margin-top:16px">Classificação acumulada</h2>
        <table class="rank-table"><tr><th>#</th><th>Jogador</th><th class="r">Total</th></tr>
        ${S.standings.map((r) => `<tr><td>${r.rank}</td><td><b>${esc(r.name)}</b></td><td class="r num">${fmtMs(r.totalMs)}</td></tr>`).join('')}</table></div>`;
    }
  }
  chBody.innerHTML = body + (S.answer != null && showAns && !over ? `<div class="ans-badge">Resposta: ${S.answer}</div>` : '');
  chBody.classList.toggle('with-panel', !!done);
}

function startBuild() {
  const H = S.layers.length, parts = [];
  anim = { round: S.round, k: 0, text: '', done: false };
  stage.showLayers(0);
  anim.timer = setInterval(() => {
    anim.k += 1;
    if (anim.k <= H) {
      stage.showLayers(anim.k, true); parts.push(S.layers[anim.k - 1]);
      anim.text = anim.k < H ? parts.join(' + ') : `${parts.join(' + ')} = ${S.answer}`;
      fx.beep(440 + anim.k * 60, 80);
      const fl = $('#formulaLine'); if (fl) fl.textContent = anim.text;
    } else if (anim.k >= H + 2) { clearInterval(anim.timer); anim.done = true; sig = ''; render(); }
  }, 900);
}

// ---- events
game.addEventListener('click', onClick);
app.addEventListener('click', onClick);
async function onClick(e) {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'create') {
    try { const r = await api('/api/rooms', { method: 'POST', body: {} }); host = { code: r.code, token: r.hostToken }; localStorage.setItem(KEY, JSON.stringify(host)); sig = ''; await poll(); render(); } catch (er) { toast(er.message, 'err'); }
  }
  else if (a === 'rounds') await hostCall({ action: 'setRounds', rounds: Number(el.dataset.v) });
  else if (a === 'test') await hostCall({ action: 'setTest', on: !S.testMode });
  else if (a === 'kick') await hostCall({ action: 'removePlayer', playerId: el.dataset.id });
  else if (a === 'start') await hostCall({ action: 'start' });
  else if (a === 'next') await hostCall({ action: 'next' });
  else if (a === 'skip') await hostCall({ action: 'skip' });
  else if (a === 'restart') { if (window.confirm('Voltar ao lobby com os mesmos jogadores?')) await hostCall({ action: 'restart' }); }
  else if (a === 'ans') { showAns = !showAns; sig = ''; render(); }
}
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !S?.testMode) return;
  if (e.key === 'a' || e.key === 'A') { showAns = !showAns; sig = ''; render(); }
  if ((e.key === 'n' || e.key === 'N') && ['countdown', 'playing'].includes(S.phase)) hostCall({ action: 'skip' });
});

async function boot() {
  if (!host) { try { const r = await api('/api/rooms', { method: 'POST', body: {} }); host = { code: r.code, token: r.hostToken }; localStorage.setItem(KEY, JSON.stringify(host)); } catch (er) { toast(er.message, 'err'); } }
  render(); poll();
}
boot();
window.__host = () => ({ S, anim, stage });
