import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceMockWeek, createMockWeekOneState, finishMockWeek } from '../src/mock-week.js';
import { gradeSubmission, standings } from '../src/pool.js';

test('Mock Week 1 contains 16 games and produces wins, losses, and a push', () => {
  const state = createMockWeekOneState();
  const week = state.weeks['1'];
  assert.equal(week.games.length, 16);
  const picks = Object.fromEntries(week.games.map(game => [game.id, game.home]));
  week.submissions.push({ id: 'mock-entry', name: 'Moe', submittedAt: new Date().toISOString(), picks });
  finishMockWeek(state);
  const grade = gradeSubmission(week, week.submissions[0], 0);
  const results = Object.values(grade.grades).map(item => item.result);
  assert.ok(results.includes('win'));
  assert.ok(results.includes('loss'));
  assert.ok(results.includes('push'));
  assert.ok(Object.values(grade.grades).some(item => item.result === 'push' && item.points === 0));
  assert.equal(week.status, 'final');
});

test('multi-week test season keeps each week and produces accurate standings trends', () => {
  const state = createMockWeekOneState();
  const weekOne = state.weeks['1'];
  weekOne.submissions.push({ id: 'w1', name: 'Moe', submittedAt: new Date().toISOString(), picks: Object.fromEntries(weekOne.games.map(game => [game.id, game.home])) });
  finishMockWeek(state);
  advanceMockWeek(state);
  const weekTwo = state.weeks['2'];
  weekTwo.submissions.push({ id: 'w2', name: 'Moe', submittedAt: new Date().toISOString(), picks: Object.fromEntries(weekTwo.games.map(game => [game.id, game.away])) });
  finishMockWeek(state);
  const moe = standings(state, { pushPoints: 0 }).find(row => row.name === 'Moe');
  assert.equal(state.activeWeek, 2);
  assert.equal(Object.keys(state.weeks).length, 2);
  assert.equal(moe.weeksPlayed, 2);
  assert.equal(moe.trend.length, 2);
  assert.equal(moe.total, moe.trend[0] + moe.trend[1]);
  assert.equal(moe.current, moe.trend[1]);
});
