import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockWeekOneState, finishMockWeek } from '../src/mock-week.js';
import { gradeSubmission } from '../src/pool.js';

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
