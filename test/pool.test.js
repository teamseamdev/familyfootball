import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gameAtsOutcome, gameChoices, gradePick, standings } from '../src/pool.js';
import { publishTime } from '../src/timing.js';
import { createPoolServer } from '../src/server.js';
import { JsonStore } from '../src/store.js';

test('choice labels show equal and opposite spreads', () => {
  const choices = gameChoices({ away: 'DEN', home: 'BUF', homeSpread: -3 });
  assert.deepEqual(choices, [{ team: 'DEN', label: 'DEN +3' }, { team: 'BUF', label: 'BUF -3' }]);
});

test('ATS grading covers wins, losses, pushes, and tied games', () => {
  const favoriteCovers = { away: 'DEN', home: 'BUF', homeSpread: -3, awayScore: 20, homeScore: 27, status: 'final' };
  assert.deepEqual(gradePick(favoriteCovers, 'BUF'), { result: 'win', points: 1 });
  assert.deepEqual(gameAtsOutcome(favoriteCovers), { result: 'winner', team: 'BUF' });
  assert.deepEqual(gradePick(favoriteCovers, 'DEN'), { result: 'loss', points: 0 });
  const push = { ...favoriteCovers, awayScore: 20, homeScore: 23 };
  assert.deepEqual(gradePick(push, 'DEN'), { result: 'push', points: 0 });
  assert.deepEqual(gameAtsOutcome(push), { result: 'push', team: null });
  const tiedPickEm = { ...favoriteCovers, homeSpread: 0, awayScore: 17, homeScore: 17 };
  assert.deepEqual(gradePick(tiedPickEm, 'BUF'), { result: 'push', points: 0 });
});

test('publish time is 6 PM Eastern on the day before first kickoff across DST', () => {
  assert.equal(publishTime('2025-09-05T00:20:00.000Z', 'America/New_York', 18).toISOString(), '2025-09-03T22:00:00.000Z');
  assert.equal(publishTime('2025-12-05T01:15:00.000Z', 'America/New_York', 18).toISOString(), '2025-12-03T23:00:00.000Z');
});

test('full local flow: form, submission, result grading, and standings', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'family-pool-'));
  const store = new JsonStore(path.join(temp, 'pool.json'));
  const kickoff = new Date(Date.now() + 86400000).toISOString();
  store.write({
    version: 1, activeSeason: 2030, activeWeek: 1, players: ['Jordan'], history: {}, audit: [],
    weeks: { '1': { season: 2030, week: 1, label: 'Week 1', status: 'open', source: 'test', spreadCapturedAt: new Date().toISOString(), shareToken: 'test-link', formUrl: '', publishedAt: new Date().toISOString(), picksLockedAt: kickoff, games: [{ id: 'g1', kickoff, away: 'DEN', home: 'BUF', homeSpread: -3, status: 'scheduled', awayScore: null, homeScore: null, source: 'test' }], submissions: [] } }
  });
  const app = createPoolServer({ store, port: 0, baseUrl: 'http://127.0.0.1', adminKey: 'test-admin' });
  const address = await app.start(0);
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;

  const dashboard = await fetch(base);
  assert.equal(dashboard.status, 200);

  const form = await fetch(`${base}/api/public/week/test-link`);
  assert.equal(form.status, 200);
  assert.equal((await form.json()).games[0].choices[0].label, 'DEN +3');

  const rejected = await fetch(`${base}/api/public/week/test-link/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Not Registered', picks: { g1: 'BUF' } }) });
  assert.equal(rejected.status, 400);

  const submitted = await fetch(`${base}/api/public/week/test-link/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Jordan', picks: { g1: 'BUF' } }) });
  assert.equal(submitted.status, 201);

  const duplicate = await fetch(`${base}/api/public/week/test-link/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Jordan', picks: { g1: 'DEN' } }) });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already submitted/i);

  const graded = await fetch(`${base}/api/admin/results`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ week: 1, games: [{ id: 'g1', awayScore: 20, homeScore: 27, status: 'final' }] }) });
  assert.equal(graded.status, 200);
  assert.equal((await graded.json()).submissions[0].points, 1);
  assert.equal(standings(store.read(), { pushPoints: 0 })[0].total, 1);
});

test('full multi-week test flow: reset, picks, grade, and advance', async t => {
  const app = createPoolServer({ storageProvider: 'memory', port: 0, baseUrl: 'http://127.0.0.1', adminKey: 'test-admin' });
  const address = await app.start(0);
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const reset = await fetch(`${base}/api/simulation/reset-season`, { method: 'POST' });
  assert.equal(reset.status, 201);
  const resetBody = await reset.json();
  const week = resetBody.week;
  const picks = Object.fromEntries(week.games.map(game => [game.id, game.away]));
  const submitted = await fetch(`${base}/api/public/week/mock-week-1/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Moe', picks }) });
  assert.equal(submitted.status, 201);
  const finished = await fetch(`${base}/api/simulation/finish`, { method: 'POST' });
  assert.equal(finished.status, 200);
  const advanced = await fetch(`${base}/api/simulation/next-week`, { method: 'POST' });
  assert.equal(advanced.status, 201);
  const next = await advanced.json();
  assert.equal(next.week.week, 2);
  assert.match(next.shareUrl, /mock-week-2$/);
  const season = await (await fetch(`${base}/api/standings`)).json();
  assert.deepEqual(season.weeks.map(item => item.week), [1, 2]);
});
