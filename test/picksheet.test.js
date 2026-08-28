import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockWeekOneState } from '../src/mock-week.js';
import { pickSheetSvg } from '../src/picksheet.js';

test('share image uses a spreadsheet grid with all four player columns and blank results', () => {
  const state = createMockWeekOneState();
  const week = state.weeks['1'];
  week.submissions.push({
    name: 'Moe',
    picks: Object.fromEntries(week.games.map(game => [game.id, game.away]))
  });
  const svg = pickSheetSvg(week, state);
  for (const player of ['Moe', 'John', 'Diane', 'Adam']) assert.match(svg, new RegExp(`>${player}<`));
  assert.match(svg, /Visitor vs Home/);
  assert.match(svg, /TOTAL WEEKLY WINS/);
  assert.match(svg, /TOTAL OVERALL WINS/);
  assert.match(svg, /Win\?/);
  assert.doesNotMatch(svg, /awayScore|homeScore|points|grade/i);
});
