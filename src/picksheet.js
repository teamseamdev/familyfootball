import { chronological, gameChoices } from './pool.js';

const PLAYERS = ['Moe', 'John', 'Diane', 'Adam'];
const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

export function pickSheetSvg(week) {
  const games = chronological(week.games);
  const submissions = new Map((week.submissions || []).map(entry => [entry.name, entry]));
  const gutter = 42;
  const columns = [
    ['Game', 72], ['Kickoff', 150], ['Matchup', 135], ['Spread choices', 220],
    ...PLAYERS.map(name => [name, 130]), ['Result', 105]
  ];
  const sheetWidth = columns.reduce((sum, [, width]) => sum + width, 0);
  const width = gutter + sheetWidth + 36;
  const titleHeight = 54;
  const lettersHeight = 28;
  const headerHeight = 44;
  const rowHeight = 43;
  const top = 24;
  const gridTop = top + titleHeight + lettersHeight;
  const height = gridTop + headerHeight + games.length * rowHeight + 42;
  const positions = columns.map(([, columnWidth], index) => ({
    x: gutter + columns.slice(0, index).reduce((sum, [, itemWidth]) => sum + itemWidth, 0),
    width: columnWidth
  }));

  const cells = (values, y, heightValue, className, rowClass = '') => values.map((value, index) => {
    const { x, width: columnWidth } = positions[index];
    const centered = index >= 4;
    return `<rect x="${x}" y="${y}" width="${columnWidth}" height="${heightValue}" class="cell ${rowClass}"/>
      <text x="${centered ? x + columnWidth / 2 : x + 10}" y="${y + heightValue / 2 + 5}" text-anchor="${centered ? 'middle' : 'start'}" class="${className}">${escapeXml(value)}</text>`;
  }).join('');

  const letters = columns.map(([, columnWidth], index) => {
    const { x } = positions[index];
    return `<rect x="${x}" y="${top + titleHeight}" width="${columnWidth}" height="${lettersHeight}" class="letters"/>
      <text x="${x + columnWidth / 2}" y="${top + titleHeight + 19}" text-anchor="middle" class="letter-text">${String.fromCharCode(65 + index)}</text>`;
  }).join('');

  const rows = games.map((game, index) => {
    const y = gridTop + headerHeight + index * rowHeight;
    const kickoff = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    }).format(new Date(game.kickoff));
    const choices = gameChoices(game);
    const values = [
      index + 1,
      kickoff,
      `${game.away} @ ${game.home}`,
      choices.map(choice => choice.label).join(' / '),
      ...PLAYERS.map(name => {
        const team = submissions.get(name)?.picks?.[game.id];
        return choices.find(choice => choice.team === team)?.label || '';
      }),
      ''
    ];
    return `<rect x="0" y="${y}" width="${gutter}" height="${rowHeight}" class="row-number"/>
      <text x="${gutter / 2}" y="${y + 27}" text-anchor="middle" class="row-number-text">${index + 3}</text>
      ${cells(values, y, rowHeight, 'body-text', index % 2 ? 'alternate' : '')}`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
      .canvas{fill:#f3f5f6}.sheet{fill:#fff;stroke:#c7cdd1;stroke-width:1}.title{fill:#188038}.title-text{fill:#fff;font:700 22px Arial}.subtitle{fill:#dff0e3;font:12px Arial}.letters,.row-number{fill:#f1f3f4;stroke:#d5d9dc;stroke-width:1}.letter-text,.row-number-text{fill:#5f6368;font:600 12px Arial}.cell{fill:#fff;stroke:#d8dde1;stroke-width:1}.cell.alternate{fill:#f8fbf9}.cell.header-cell{fill:#e6f4ea;stroke:#b9d8c0}.header-text{fill:#153b25;font:700 13px Arial}.body-text{fill:#202124;font:13px Arial}.note{fill:#6b7378;font:12px Arial}
    </style>
    <rect width="100%" height="100%" class="canvas"/>
    <rect x="${gutter}" y="${top}" width="${sheetWidth}" height="${height - top - 24}" class="sheet"/>
    <rect x="${gutter}" y="${top}" width="${sheetWidth}" height="${titleHeight}" class="title"/>
    <text x="${gutter + 18}" y="${top + 24}" class="title-text">Family Football Pool — Week ${escapeXml(week.week)}</text>
    <text x="${gutter + 18}" y="${top + 43}" class="subtitle">Selections sheet • scores and grading intentionally blank</text>
    ${letters}
    <rect x="0" y="${top + titleHeight}" width="${gutter}" height="${lettersHeight}" class="letters"/>
    <rect x="0" y="${gridTop}" width="${gutter}" height="${headerHeight}" class="row-number"/>
    <text x="${gutter / 2}" y="${gridTop + 28}" text-anchor="middle" class="row-number-text">2</text>
    ${cells(columns.map(([name]) => name), gridTop, headerHeight, 'header-text', 'header-cell')}
    ${rows}
    <text x="${gutter}" y="${height - 13}" class="note">Blank cells mean picks have not been submitted. Result cells remain empty on the share copy.</text>
  </svg>`;
}
