import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleBridge } from '../src/google-bridge.js';
import { mergeGoogleResponses, sheetPayload } from '../src/google-sync.js';

function fixture() {
  const kickoff = '2030-09-01T20:00:00.000Z';
  const week = {
    season: 2030, week: 1, label: 'Week 1', status: 'open', submissions: [],
    games: [{ id: 'g1', kickoff, away: 'DEN', home: 'BUF', homeSpread: -3, status: 'scheduled', awayScore: null, homeScore: null }]
  };
  return { activeWeek: 1, players: ['Moe', 'John', 'Diane', 'Adam'], history: {}, weeks: { '1': week } };
}

test('Google Form responses replace only the latest valid submission for a registered player', () => {
  const state = fixture();
  const week = state.weeks['1'];
  assert.equal(mergeGoogleResponses(state, week, [{ id: 'one', name: 'moe', submittedAt: '2030-08-30T12:00:00Z', picks: { g1: 'BUF' } }]), 1);
  assert.equal(week.submissions[0].name, 'Moe');
  assert.equal(mergeGoogleResponses(state, week, [{ id: 'old', name: 'Moe', submittedAt: '2030-08-29T12:00:00Z', picks: { g1: 'DEN' } }]), 0);
  assert.equal(mergeGoogleResponses(state, week, [{ id: 'bad', name: 'Guest', submittedAt: '2030-08-31T12:00:00Z', picks: { g1: 'DEN' } }]), 0);
  assert.equal(week.submissions[0].picks.g1, 'BUF');
});

test('Google bridge sends the full sheet payload with game fields, grades, and standings', async () => {
  let sent;
  const fakeFetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, sheetUrl: 'https://docs.google.com/test' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const state = fixture();
  state.weeks['1'].submissions.push({ id: 'one', name: 'Moe', submittedAt: '2030-08-30T12:00:00Z', picks: { g1: 'BUF' } });
  const bridge = new GoogleBridge({ googleBridgeUrl: 'https://example.test/exec', googleBridgeSecret: 'secret' }, fakeFetch);
  await bridge.syncWeek(sheetPayload(state, state.weeks['1'], { pushPoints: 0 }));
  assert.equal(sent.action, 'syncWeek');
  assert.equal(sent.games[0].homeSpread, -3);
  assert.equal(sent.submissions[0].grades.g1.points, null);
  assert.equal(sent.standings.find(row => row.name === 'Moe').name, 'Moe');
});
