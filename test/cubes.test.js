import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, LEVELS, generate, isSymmetric, validateGrid, total, formula, layerCounts, levelsFor, planGame, parseManual } from '../public/cubes/gen.js';
import * as C from '../src/cubes.js';

test('generator: every template is valid, in range and symmetric', () => {
  for (const t of TEMPLATES) for (let s = 1; s <= 4; s++) {
    const d = generate({ level: t.level, seed: s * 13, templateId: t.id });
    const L = LEVELS[t.level];
    assert.ok(!d.fallback, t.id);
    assert.equal(d.answer, d.grid.flat().reduce((a, b) => a + b, 0));
    assert.ok(d.answer >= L.min && d.answer <= L.max, `${t.id} ${d.answer}`);
    assert.ok(isSymmetric(d.grid, L.sym), `${t.id} symmetry`);
    assert.ok(validateGrid(d.grid).ok, t.id);
  }
});
test('formula and layers', () => {
  const g = [[1, 1, 1], [1, 2, 1], [1, 1, 1]];
  assert.deepEqual(layerCounts(g), [9, 1]);
  assert.equal(formula(g), '9 + 1 = 10');
});
test('validator rejects thin pits, deep pits and hidden columns', () => {
  const thin = [[3, 3, 3, 3, 3], [3, 3, 1, 3, 3], [3, 3, 3, 3, 3], [3, 3, 3, 3, 3], [3, 3, 3, 3, 3]];
  assert.ok(validateGrid(thin).errors.some((e) => /2×2/.test(e)));
  const deep = [[4, 4, 4, 4], [4, 0, 0, 4], [4, 0, 0, 4], [4, 4, 4, 4]];
  assert.ok(validateGrid(deep).errors.some((e) => /profundidade/.test(e)));
  const ok = [[3, 3, 3, 3], [3, 2, 2, 3], [3, 2, 2, 3], [3, 3, 3, 3]];
  assert.ok(validateGrid(ok).ok);
  assert.ok(!validateGrid([[1, 2], [1]]).ok);
  assert.ok(!validateGrid([[0, 0], [0, 0]]).ok);
  // a 1-wide slot deep inside a tall block is invisible from every angle
  const slot = [[9, 9, 9, 9, 9], [9, 9, 9, 9, 9], [9, 9, 0, 9, 9], [9, 9, 9, 9, 9], [9, 9, 9, 9, 9]];
  assert.ok(!validateGrid(slot).ok);
});
test('levels rise and molds differ within a game', () => {
  assert.deepEqual(levelsFor(5), [1, 2, 3, 4, 5]);
  assert.deepEqual(levelsFor(10), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  const lv = levelsFor(7); assert.deepEqual([...lv].sort(), lv);
  const plan = planGame({ rounds: 10, seed: 5 });
  assert.equal(new Set(plan.map((d) => d.templateId)).size, 10);
});
test('manual diagrams use the same validation', () => {
  assert.ok(parseManual('[[3,3,3,3],[3,2,2,3],[3,2,2,3],[3,3,3,3]]').ok);
  assert.ok(!parseManual('nope').ok);
  assert.ok(!parseManual('[[[9,9,9,9,9],[9,9,9,9,9],[9,9,0,9,9],[9,9,9,9,9],[9,9,9,9,9]]]').ok);
  assert.equal(parseManual({ diagrams: [{ name: 'A', grid: [[1, 2], [3, 4]] }] }).diagrams[0].name, 'A');
});

function room(opts = {}) {
  const { game } = C.createCubes({ code: 'T', ...opts });
  const toks = {};
  for (const n of ['Ana', 'Bruno', 'Carla']) { const r = C.addPlayer(game, { name: n }, 0); toks[n] = r.player; }
  return { game, toks };
}
const now0 = 1_000_000;
test('round flow: countdown, wrong answer locks 20 s, correct answer, end when all solved', () => {
  const { game, toks } = room({ rounds: 2 });
  C.start(game, now0);
  assert.equal(game.phase, 'rules');
  C.next(game, now0);
  assert.equal(game.phase, 'countdown');
  assert.throws(() => C.answer(game, toks.Ana, 1, now0 + 1000), /não está a decorrer/);
  const ans = game.rounds[0].answer;
  const t0 = now0 + 3000;
  C.step(game, t0);
  assert.equal(game.phase, 'playing');
  const r = C.answer(game, toks.Ana, ans + 1, t0 + 5000);
  assert.equal(r.correct, false);
  assert.throws(() => C.answer(game, toks.Ana, ans, t0 + 15000), (e) => e.code === 'locked' && e.lockMs === 10000);
  assert.equal(C.playerView(game, toks.Ana, t0 + 15000).mine.lockMs, 10000);
  assert.equal(C.answer(game, toks.Ana, ans, t0 + 25000).ms, 25000);
  assert.equal(C.hostView(game, t0 + 25000).answer, undefined); // answer hidden from host view during play
  assert.equal(C.playerView(game, toks.Bruno, t0 + 25000).answer, undefined);
  C.answer(game, toks.Bruno, ans, t0 + 30000);
  assert.equal(game.phase, 'playing');
  C.answer(game, toks.Carla, ans, t0 + 40000);
  assert.equal(game.phase, 'roundend');
  assert.deepEqual(game.history[0].results.map((x) => x.name), ['Ana', 'Bruno', 'Carla']);
  assert.equal(C.playerView(game, toks.Ana, t0 + 41000).answer, ans);
});
test('timeout: unsolved get 3:00 + 30 s, ordered by fewer attempts; final ranking sums times', () => {
  const { game, toks } = room({ rounds: 1 });
  C.start(game, now0); C.next(game, now0);
  const t0 = now0 + 3000, ans = game.rounds[0].answer;
  C.step(game, t0);
  C.answer(game, toks.Carla, ans, t0 + 90000);
  C.answer(game, toks.Ana, ans + 1, t0 + 1000); C.answer(game, toks.Ana, ans + 1, t0 + 22000);
  C.answer(game, toks.Bruno, ans + 1, t0 + 1000);
  C.step(game, t0 + 179999); assert.equal(game.phase, 'playing');
  C.step(game, t0 + 180000); assert.equal(game.phase, 'roundend');
  const res = game.history[0].results;
  assert.deepEqual(res.map((x) => x.name), ['Carla', 'Bruno', 'Ana']);
  assert.equal(res[1].ms, 210000);
  assert.throws(() => C.answer(game, toks.Bruno, ans, t0 + 181000), /não está a decorrer/);
  C.next(game, t0 + 200000);
  assert.equal(game.status, 'finished');
  assert.deepEqual(game.ranking.map((r) => [r.rank, r.name]), [[1, 'Carla'], [2, 'Bruno'], [3, 'Ana']]);
  assert.equal(game.ranking[0].totalMs, 90000);
});
test('start needs 2 players unless test mode; skip only in test mode; reconnect keeps state', () => {
  const solo = C.createCubes({ code: 'S', rounds: 1 }).game;
  const p = C.addPlayer(solo, { name: 'Solo' }).player;
  assert.throws(() => C.start(solo), /pelo menos 2/);
  assert.throws(() => C.skip(solo), /teste/);
  C.setTest(solo, true); C.start(solo, now0); C.next(solo, now0);
  C.step(solo, now0 + 3000);
  assert.throws(() => C.answer(solo, p, -5, now0 + 4000), /inteiro/);
  assert.equal(C.answer(solo, p, solo.rounds[0].answer + 1, now0 + 4000).correct, false);
  assert.equal(C.hostView(solo, now0 + 5000).answer, solo.rounds[0].answer); // test mode exposes the answer to the host
});
test('rounds are clamped to 1..10 and manual diagrams are used first', () => {
  const { game } = C.createCubes({ code: 'M', rounds: 99 });
  assert.equal(game.totalRounds, 10);
  C.setRounds(game, 0); assert.equal(game.totalRounds, 5); // invalid -> default
  C.setRounds(game, 3);
  C.loadManual(game, '[[3,3,3,3],[3,2,2,3],[3,2,2,3],[3,3,3,3]]');
  C.addPlayer(game, { name: 'a' }); C.addPlayer(game, { name: 'b' });
  C.start(game, now0);
  assert.equal(game.rounds[0].templateId, 'manual');
  assert.equal(game.rounds[0].answer, 44);
  assert.equal(game.rounds.length, 3);
});
