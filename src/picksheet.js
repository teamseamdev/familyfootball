import { chronological } from './pool.js';

const PLAYERS = ['Moe', 'John', 'Diane', 'Adam'];
const COLUMN_WIDTHS = [80, 100, 105, 40, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 100, 100, 100, 100];
const ROW_HEIGHT = 28;
const LETTERS_HEIGHT = 26;
const ROWS = 37;
const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
const columnX = index => 30 + COLUMN_WIDTHS.slice(0, index).reduce((sum, width) => sum + width, 0);
const rowY = row => LETTERS_HEIGHT + (row - 1) * ROW_HEIGHT;
const rangeWidth = (start, end = start) => COLUMN_WIDTHS.slice(start, end + 1).reduce((sum, width) => sum + width, 0);

function spreadLabel(game) {
  const homeSpread = Number(game.homeSpread);
  if (!Number.isFinite(homeSpread) || homeSpread === 0) return 'PK';
  const favorite = homeSpread < 0 ? game.home : game.away;
  return `${favorite} -${Math.abs(homeSpread)}`;
}

function cell(column, row, value = '', options = {}) {
  const endColumn = options.endColumn ?? column;
  const x = columnX(column);
  const y = rowY(row);
  const width = rangeWidth(column, endColumn);
  const fill = options.fill || '#f3f3f3';
  const textX = options.align === 'left' ? x + 8 : x + width / 2;
  const anchor = options.align === 'left' ? 'start' : 'middle';
  return `<rect x="${x}" y="${y}" width="${width}" height="${ROW_HEIGHT}" fill="${fill}" stroke="#222" stroke-width="1"/>
    <text x="${textX}" y="${y + 19}" text-anchor="${anchor}" fill="${options.textFill || '#111'}" class="${options.bold === false ? 'cell-text' : 'cell-text bold'}">${escapeXml(value)}</text>`;
}

export function pickSheetSvg(week, state = {}) {
  const games = chronological(week.games);
  const submissions = new Map((week.submissions || []).map(entry => [String(entry.name).toLowerCase(), entry]));
  const sheetWidth = COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0);
  const width = 30 + sheetWidth;
  const height = LETTERS_HEIGHT + ROWS * ROW_HEIGHT;

  const verticalLines = COLUMN_WIDTHS.map((_, index) => `<line x1="${columnX(index)}" y1="0" x2="${columnX(index)}" y2="${height}" class="grid"/>`).join('')
    + `<line x1="${width}" y1="0" x2="${width}" y2="${height}" class="grid"/>`;
  const horizontalLines = Array.from({ length: ROWS + 1 }, (_, index) => `<line x1="0" y1="${LETTERS_HEIGHT + index * ROW_HEIGHT}" x2="${width}" y2="${LETTERS_HEIGHT + index * ROW_HEIGHT}" class="grid"/>`).join('');
  const letters = COLUMN_WIDTHS.map((columnWidth, index) => `<rect x="${columnX(index)}" y="0" width="${columnWidth}" height="${LETTERS_HEIGHT}" class="heading"/>
    <text x="${columnX(index) + columnWidth / 2}" y="18" text-anchor="middle" class="axis-text">${String.fromCharCode(65 + index)}</text>`).join('');
  const rowNumbers = Array.from({ length: ROWS }, (_, index) => `<rect x="0" y="${rowY(index + 1)}" width="30" height="${ROW_HEIGHT}" class="heading"/>
    <text x="15" y="${rowY(index + 1) + 19}" text-anchor="middle" class="axis-text">${index + 1}</text>`).join('');

  const title = cell(0, 1, `Week ${week.week} Football Bets`, { endColumn: 15, fill: '#ffffff' });
  const headers = [
    cell(2, 2, 'Visitor vs Home', { endColumn: 3, fill: '#ffffff' }),
    cell(4, 2, 'Spread', { fill: '#ffffff' }),
    cell(6, 2, 'Moe', { fill: '#ffffff' }), cell(7, 2, 'Win?', { fill: '#dbe8f4' }),
    cell(8, 2, 'John', { fill: '#ffffff' }), cell(9, 2, 'Win?', { fill: '#dbe8f4' }),
    cell(10, 2, 'Diane', { fill: '#ffffff' }), cell(11, 2, 'Win?', { fill: '#dbe8f4' }),
    cell(12, 2, 'Adam', { fill: '#ffffff' }), cell(13, 2, 'Win?', { fill: '#dbe8f4' })
  ].join('');

  const gameRows = games.map((game, index) => {
    const row = index + 3;
    const picks = PLAYERS.flatMap((player, playerIndex) => {
      const submission = submissions.get(player.toLowerCase());
      const team = submission?.picks?.[game.id] || '';
      const pickColumn = 6 + playerIndex * 2;
      return [
        cell(pickColumn, row, team, { fill: '#f1f1f1' }),
        cell(pickColumn + 1, row, '', { fill: '#dbe8f4' })
      ];
    }).join('');
    return cell(2, row, `${game.away} @ ${game.home}`, { endColumn: 3, fill: '#f1f1f1' })
      + cell(4, row, spreadLabel(game), { fill: '#f1f1f1' })
      + picks;
  }).join('');

  const totalsRow = Math.max(24, games.length + 8);
  const weeklyTotals = cell(2, totalsRow, 'TOTAL WEEKLY WINS', { endColumn: 4, fill: '#f1f1f1' })
    + [7, 9, 11, 13].map(column => cell(column, totalsRow, '', { fill: '#dbe8f4' })).join('');
  const overallTitleRow = totalsRow + 2;
  const previousWeek = Math.max(0, Number(week.week) - 1);
  const overallTitle = cell(2, overallTitleRow, 'TOTAL OVERALL WINS', { endColumn: 4, fill: '#f1f1f1' });
  const overallHeaders = cell(3, overallTitleRow + 1, `Wk${previousWeek}`, { fill: '#4285e8', textFill: '#ffffff', bold: false })
    + cell(4, overallTitleRow + 1, `Wk${week.week}`, { fill: '#4285e8', textFill: '#ffffff', bold: false });
  const overallRows = PLAYERS.map((player, index) => {
    const priorTotal = (state.history?.[player] || []).reduce((sum, score) => sum + Number(score || 0), 0);
    const row = overallTitleRow + 2 + index;
    return cell(2, row, player.toUpperCase(), { fill: '#f1f1f1' })
      + cell(3, row, priorTotal, { fill: '#f1f1f1' })
      + cell(4, row, '', { fill: '#f1f1f1' });
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
      .sheet{fill:#fff}.grid{stroke:#d7d7d7;stroke-width:1}.heading{fill:#edf2f7;stroke:#c7d0d9;stroke-width:1}.axis-text{fill:#202124;font:12px Arial}.cell-text{font:14px Calibri,Arial,sans-serif}.cell-text.bold{font-weight:700}
    </style>
    <rect width="100%" height="100%" class="sheet"/>
    ${verticalLines}${horizontalLines}${letters}${rowNumbers}
    ${title}${headers}${gameRows}${weeklyTotals}${overallTitle}${overallHeaders}${overallRows}
  </svg>`;
}
