import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formStatusLabel, gameAtsOutcome, gameChoices, gamePicksAreRevealed, gradePick, picksAreRevealed, standings } from '../src/pool.js';
import { publishTime } from '../src/timing.js';
import { createPoolServer } from '../src/server.js';
import { JsonStore } from '../src/store.js';
import { fetchEspnWeek } from '../src/providers.js';

test('choice labels show equal and opposite spreads', () => {
  const choices = gameChoices({ away: 'DEN', home: 'BUF', homeSpread: -3 });
  assert.deepEqual(choices, [{ team: 'DEN', label: 'DEN +3' }, { team: 'BUF', label: 'BUF -3' }]);
});

test('Vercel rewrite preserves the original API route', async t => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pool-route-')), 'pool.json');
  const app = createPoolServer({ dataFile, storageProvider: 'json', port: 0 });
  const address = await app.start(0);
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/api/index?__route=health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, 'family-nfl-pool');
});

test('ESPN ingestion falls back to the CDN scoreboard and includes its TV network', async () => {
  const event = { id: 'g1', date: '2030-09-08T17:00:00Z', competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: 'away', team: { abbreviation: 'DEN', displayName: 'Denver Broncos' } }, { homeAway: 'home', team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' } }], broadcasts: [{ market: 'national', names: ['CBS'] }], odds: [{ spread: -3, details: 'BUF -3', homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }] }] };
  let calls = 0;
  const fetchImpl = async () => ++calls === 1 ? { ok: false, status: 403 } : { ok: true, json: async () => ({ content: { sbData: { events: [event] } } }) };
  const result = await fetchEspnWeek(2030, 1, fetchImpl);
  assert.equal(calls, 2);
  assert.equal(result.games[0].homeSpread, -3);
  assert.equal(result.games[0].broadcast, 'CBS');
});

test('ESPN ingestion includes live scores, clock, quarter, and timeouts', async () => {
  const event = { id: 'live-1', date: '2030-09-08T17:00:00Z', competitions: [{ status: { displayClock: '8:21', period: 3, type: { completed: false, state: 'in', shortDetail: '8:21 - 3rd' } }, situation: { awayTimeouts: 2, homeTimeouts: 1 }, competitors: [{ homeAway: 'away', score: '17', team: { abbreviation: 'DEN', displayName: 'Denver Broncos' } }, { homeAway: 'home', score: '20', team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' } }], broadcasts: [{ names: ['CBS'] }], odds: [{ spread: -3, details: 'BUF -3', homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }] }] };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ events: [event] }) });
  const game = (await fetchEspnWeek(2030, 1, fetchImpl)).games[0];
  assert.equal(game.status, 'live');
  assert.equal(game.awayScore, 17);
  assert.equal(game.homeScore, 20);
  assert.equal(game.period, 3);
  assert.equal(game.displayClock, '8:21');
  assert.equal(game.awayTimeouts, 2);
  assert.equal(game.homeTimeouts, 1);
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

test('picks reveal independently when everyone picks a game or that game starts', () => {
  const kickoff = '2030-09-08T17:00:00.000Z';
  const laterKickoff = '2030-09-09T17:00:00.000Z';
  const first = { id: 'g1', kickoff, status: 'scheduled' };
  const later = { id: 'g2', kickoff: laterKickoff, status: 'scheduled' };
  const week = { status: 'open', picksLockedAt: kickoff, games: [first, later], submissions: [{ name: 'Moe', picks: { g1: 'A' } }, { name: 'John', picks: { g1: 'A' } }] };
  const players = ['Moe', 'John', 'Diane', 'Adam'];
  assert.equal(picksAreRevealed(week, players, new Date('2030-09-07T17:00:00.000Z')), false);
  const allPickedFirst = { ...week, submissions: players.map(name => ({ name, picks: { g1: 'A' } })) };
  assert.equal(gamePicksAreRevealed(first, allPickedFirst, players, new Date('2030-09-07T17:00:00.000Z')), true);
  assert.equal(gamePicksAreRevealed(later, allPickedFirst, players, new Date(kickoff)), false);
  assert.equal(gamePicksAreRevealed(first, week, players, new Date(kickoff)), true);
  assert.equal(picksAreRevealed(week, players, new Date(kickoff)), false);
  assert.equal(picksAreRevealed(week, players, new Date(laterKickoff)), true);
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
  const pastKickoff = new Date(Date.now() - 60000).toISOString();
  store.write({
    version: 1, activeSeason: 2030, activeWeek: 1, players: ['Jordan'], history: {}, audit: [],
    weeks: { '1': { season: 2030, week: 1, label: 'Week 1', status: 'open', source: 'test', spreadCapturedAt: new Date().toISOString(), shareToken: 'test-link', formUrl: '', publishedAt: new Date().toISOString(), picksLockedAt: pastKickoff, games: [{ id: 'g0', kickoff: pastKickoff, away: 'KC', home: 'DEN', homeSpread: 1.5, status: 'scheduled', awayScore: null, homeScore: null, source: 'test' }, { id: 'g1', kickoff, away: 'DEN', home: 'BUF', homeSpread: -3, status: 'scheduled', awayScore: null, homeScore: null, source: 'test' }], submissions: [] } }
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
  const formData = await form.json();
  assert.equal(formData.games[0].pickable, false);
  assert.equal(formData.games[1].choices[0].label, 'DEN +3');

  const rejected = await fetch(`${base}/api/public/week/test-link/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Not Registered', picks: { g1: 'BUF' } }) });
  assert.equal(rejected.status, 400);

  const rosterUpdate = await fetch(`${base}/api/admin/players`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ players: ['Jordan', 'Alex'] }) });
  assert.equal(rosterUpdate.status, 200);
  assert.deepEqual((await rosterUpdate.json()).players, ['Jordan', 'Alex']);

  const submitted = await fetch(`${base}/api/public/week/test-link/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Jordan', picks: { g1: 'BUF' } }) });
  assert.equal(submitted.status, 201);
  assert.deepEqual(store.read().weeks['1'].submissions[0].picks, { g1: 'BUF' });

  const unsafeRemoval = await fetch(`${base}/api/admin/players`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ players: ['Alex'] }) });
  assert.equal(unsafeRemoval.status, 409);

  const mergedRoster = await fetch(`${base}/api/admin/players`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ players: ['Jordan & Alex'], renames: { Jordan: 'Jordan & Alex' } }) });
  assert.equal(mergedRoster.status, 200);
  assert.equal(store.read().weeks['1'].submissions[0].name, 'Jordan & Alex');

  const duplicate = await fetch(`${base}/api/public/week/test-link/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Jordan & Alex', picks: { g1: 'DEN' } }) });
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
  assert.deepEqual(cleanState.history, { 'Jordan & Alex': [] });
  assert.equal(cleanState.weeks['1'].submissions.length, 0);
});

test('full multi-week test flow: reset, picks, grade, and advance', async t => {
  const app = createPoolServer({ storageProvider: 'memory', port: 0, baseUrl: 'http://127.0.0.1', adminKey: 'test-admin', simulationEnabled: true });
  const address = await app.start(0);
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const reset = await fetch(`${base}/api/simulation/reset-season`, { method: 'POST' });
  assert.equal(reset.status, 201);
  await reset.json();
  const testState = await app.store.read();
  testState.weeks['1'].games.forEach((game, index) => { game.kickoff = new Date(Date.now() + (index + 1) * 3_600_000).toISOString(); });
  await app.store.write(testState);
  const week = testState.weeks['1'];
  const picks = Object.fromEntries(week.games.map(game => [game.id, game.away]));
  const submitted = await fetch(`${base}/api/public/week/mock-week-1/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Moe', picks }) });
  assert.equal(submitted.status, 201);
  const privateWeek = await (await fetch(`${base}/api/week`)).json();
  assert.equal(privateWeek.picksRevealed, false);
  assert.equal(privateWeek.submissions.length, 1);
  assert.deepEqual(privateWeek.submissions[0].picks, {});
  assert.deepEqual(privateWeek.pendingPlayers, ['John', 'Diane', 'Adam', 'Connor & Kohen']);
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
