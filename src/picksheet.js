import { chronological, gameChoices } from './pool.js';

const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

export function pickSheetSvg(week) {
  const entrants = week.submissions || [];
  const games = chronological(week.games);
  const left = 230;
  const columnWidth = Math.max(118, Math.min(155, Math.floor(850 / Math.max(entrants.length, 1))));
  const width = Math.max(960, left + entrants.length * columnWidth + 56);
  const rowHeight = 56;
  const headerHeight = 184;
  const height = headerHeight + games.length * rowHeight + 54;
  const rows = games.map((game, index) => {
    const y = headerHeight + index * rowHeight;
    const kickoff = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(game.kickoff));
    const cells = entrants.map((submission, playerIndex) => {
      const team = submission.picks?.[game.id] || '—';
      const label = gameChoices(game).find(choice => choice.team === team)?.label || team;
      return `<text x="${left + playerIndex * columnWidth + columnWidth / 2}" y="${y + 35}" text-anchor="middle" class="pick">${escapeXml(label)}</text>`;
    }).join('');
    return `<rect x="36" y="${y}" width="${width - 72}" height="${rowHeight}" class="${index % 2 ? 'row alt' : 'row'}"/>
      <text x="58" y="${y + 23}" class="matchup">${escapeXml(game.away)} @ ${escapeXml(game.home)}</text>
      <text x="58" y="${y + 42}" class="kickoff">${escapeXml(kickoff)}</text>${cells}`;
  }).join('');
  const headers = entrants.map((submission, index) => `<text x="${left + index * columnWidth + columnWidth / 2}" y="158" text-anchor="middle" class="player">${escapeXml(submission.name)}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
      .bg{fill:#071a23}.panel{fill:#0e2a35}.row{fill:#123541}.row.alt{fill:#102f3a}.title{fill:#f7fbf9;font:700 30px Arial}.meta{fill:#7fe0b7;font:600 14px Arial;letter-spacing:1.5px}.player{fill:#fff;font:700 15px Arial}.matchup{fill:#fff;font:700 16px Arial}.kickoff{fill:#8daab4;font:12px Arial}.pick{fill:#effaf6;font:700 14px Arial}.rule{stroke:#28505c;stroke-width:1}
    </style>
    <rect width="100%" height="100%" class="bg"/>
    <rect x="24" y="22" width="${width - 48}" height="${height - 44}" rx="22" class="panel"/>
    <text x="52" y="67" class="meta">FAMILY FOOTBALL POOL</text>
    <text x="52" y="104" class="title">Week ${escapeXml(week.week)} Pick Sheet</text>
    <text x="52" y="133" class="kickoff">Selections only • results intentionally hidden</text>
    ${headers}${rows}
    <text x="${width - 48}" y="${height - 26}" text-anchor="end" class="kickoff">Generated ${escapeXml(new Date().toLocaleString('en-US'))}</text>
  </svg>`;
}
