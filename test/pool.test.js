import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formStatusLabel, gameAtsOutcome, gameChoices, gradePick, picksAreRevealed, standings } from '../src/pool.js';
import { publishTime } from '../src/timing.js';
import { createPoolServer } from '../src/server.js';
import { JsonStore } from '../src/store.js';
import { fetchEspnWeek } from '../src/providers.js';

test('choice labels show equal and opposite spreads', () => {
  const choices = gameChoices({ away: 'DEN', home: 'BUF', homeSpread: -3 });
  assert.deepEqual(choices, [{ team: 'DEN', label: 'DEN +3' }, { team: 'BUF', label: 'BUF -3' }]);
});

test('ESPN ingestion falls back to the CDN scoreboard when the primary host is blocked', async () => {
  const event = { id: 'g1', date: '2030-09-08T17:00:00Z', competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'away', team: { abbreviation: 'DEN', displayName: 'Denver Broncos' } }, { homeAway: 'home', team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' } }], odds: [{ spread: -3, details: 'BUF -3', homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }] }] };
  let calls = 0;
  const fetchImpl = async () => ++calls === 1 ? { ok: false, status: 403 } : { ok: true, json: async () => ({ content: { sbData: { events: [event] } } }) };
  const result = await fetchEspnWeek(2030, 1, fetchImpl);
  assert.equal(calls, 2);
  assert.equal(result.games[0].homeSpread, -3);
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

test('picks remain private until all players submit, kickoff arrives, or games start', () => {
  const kickoff = '2030-09-08T17:00:00.000Z';
  const week = { status: 'open', picksLockedAt: kickoff, games: [{ status: 'scheduled' }], submissions: [{ name: 'Moe' }, { name: 'John' }] };
  const players = ['Moe', 'John', 'Diane', 'Adam'];
  assert.equal(picksAreRevealed(week, players, new Date('2030-09-07T17:00:00.000Z')), false);
  assert.equal(picksAreRevealed({ ...week, submissions: players.map(name => ({ name })) }, players, new Date('2030-09-07T17:00:00.000Z')), true);
  assert.equal(picksAreRevealed(week, players, new Date(kickoff)), true);
  assert.equal(picksAreRevealed({ ...week, status: 'final' }, players, new Date('2030-09-07T17:00:00.000Z')), true);
});

test('form status follows locked, open-hidden, and closed weekly states', () => {
  assert.equal(formStatusLabel({ week: 2, status: 'draft' }), 'Week 2 Form Locked');
  assert.equal(formStatusLabel({ week: 2, status: 'open' }, { acceptingSubmissions: true, picksRevealed: false }), 'Open - Picks Hidden');
  assert.equal(formStatusLabel({ week: 2, status: 'open' }, { acceptingSubmissions: false, picksRevealed: true }), 'Week 2 Form Closed');
  assert.equal(formStatusLabel({ week: 2, status: 'live' }, { acceptingSubmissions: false, picksRevealed: true }), 'Week 2 Form Closed');
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
  const app = createPoolServer({ store, port: 0, baseUrl: 'http://127.0.0.1', adminKey: 'test-admin', cronSecret: 'test-cron' });
  const address = await app.start(0);
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;

  const dashboard = await fetch(base);
  assert.equal(dashboard.status, 200);
  assert.doesNotMatch(await dashboard.text(), /data-section="setup"/);

  const setupPage = await fetch(`${base}/setup`);
  assert.equal(setupPage.status, 200);
  assert.match(await setupPage.text(), /PRODUCTION MODE/);

  assert.equal((await fetch(`${base}/api/cron`)).status, 403);
  assert.equal((await fetch(`${base}/api/cron`, { headers: { authorization: 'Bearer test-cron' } })).status, 200);

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

  const fractional = await fetch(`${base}/api/admin/results`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ week: 1, games: [{ id: 'g1', awayScore: 20, homeScore: 23.5, status: 'final' }] }) });
  assert.equal(fractional.status, 400);
  assert.match((await fractional.json()).error, /whole numbers/i);

  const graded = await fetch(`${base}/api/admin/results`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ week: 1, games: [{ id: 'g1', awayScore: 20, homeScore: 27, status: 'final' }] }) });
  assert.equal(graded.status, 200);
  assert.equal((await graded.json()).submissions[0].points, 1);
  assert.equal(standings(store.read(), { pushPoints: 0 })[0].total, 1);

  const cleanGame = { id: 'new-g1', kickoff, away: 'KC', home: 'DEN', homeSpread: 1.5, status: 'scheduled', awayScore: null, homeScore: null, source: 'manual' };
  const liveReset = await fetch(`${base}/api/admin/reset-live-season`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-cron' }, body: JSON.stringify({ season: 2031, week: 1, provider: 'manual', games: [cleanGame] }) });
  assert.equal(liveReset.status, 201);
  const cleanState = store.read();
  assert.equal(cleanState.mode, 'live');
  assert.equal(cleanState.activeSeason, 2031);
  assert.deepEqual(cleanState.history, { Jordan: [] });
  assert.equal(cleanState.weeks['1'].submissions.length, 0);
});

test('full multi-week test flow: reset, picks, grade, and advance', async t => {
  const app = createPoolServer({ storageProvider: 'memory', port: 0, baseUrl: 'http://127.0.0.1', adminKey: 'test-admin', simulationEnabled: true });
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
  const privateWeek = await (await fetch(`${base}/api/week`)).json();
  assert.equal(privateWeek.picksRevealed, false);
  assert.equal(privateWeek.submissions.length, 0);
  assert.deepEqual(privateWeek.pendingPlayers, ['John', 'Diane', 'Adam']);
  assert.equal(privateWeek.canSimulate, true);
  const finished = await fetch(`${base}/api/simulation/finish`, { method: 'POST' });
  assert.equal(finished.status, 200);
  const revealedWeek = await (await fetch(`${base}/api/week`)).json();
  assert.equal(revealedWeek.picksRevealed, true);
  assert.equal(revealedWeek.submissions.length, 1);
  const advanced = await fetch(`${base}/api/simulation/next-week`, { method: 'POST' });
  assert.equal(advanced.status, 201);
  const next = await advanced.json();
  assert.equal(next.week.week, 2);
  assert.match(next.shareUrl, /mock-week-2$/);
  const season = await (await fetch(`${base}/api/standings`)).json();
  assert.deepEqual(season.weeks.map(item => item.week), [1, 2]);
});

test('scheduled live reset is permanently idempotent after its first run', async t => {
  const app = createPoolServer({ storageProvider: 'memory', port: 0, baseUrl: 'http://127.0.0.1', cronSecret: 'test-cron', liveResetTarget: '2026:1', scheduleProvider: 'sample' });
  const address = await app.start(0);
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: 'Bearer test-cron' };
  assert.equal((await fetch(`${base}/api/cron`, { headers })).status, 200);
  const resetState = await app.store.read();
  assert.equal(resetState.mode, 'live');
  assert.deepEqual(resetState.completedMigrations, ['live-reset-v2:2026:1:sample']);
  resetState.activeWeek = 2;
  resetState.weeks['2'] = { season: 2026, week: 2, games: [], submissions: [] };
  await app.store.write(resetState);
  assert.equal((await fetch(`${base}/api/cron`, { headers })).status, 200);
  assert.equal((await app.store.read()).activeWeek, 2);
});
