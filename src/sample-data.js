const teams = {
  MIN: 'Minnesota Vikings', LAC: 'Los Angeles Chargers', NYJ: 'New York Jets', CIN: 'Cincinnati Bengals',
  BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', SF: 'San Francisco 49ers', HOU: 'Houston Texans',
  CLE: 'Cleveland Browns', NE: 'New England Patriots', NYG: 'New York Giants', PHI: 'Philadelphia Eagles',
  TB: 'Tampa Bay Buccaneers', NO: 'New Orleans Saints', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos'
};

function game(id, kickoff, away, home, homeSpread, status = 'scheduled', awayScore = null, homeScore = null) {
  return { id, kickoff, away, home, awayName: teams[away], homeName: teams[home], homeSpread, status, awayScore, homeScore, source: 'sample' };
}

const games = [
  game('2025w8-min-lac', '2025-10-24T00:15:00.000Z', 'MIN', 'LAC', 2.5, 'final', 10, 37),
  game('2025w8-nyj-cin', '2025-10-26T17:00:00.000Z', 'NYJ', 'CIN', -6.5, 'final', 39, 38),
  game('2025w8-buf-car', '2025-10-26T17:00:00.000Z', 'BUF', 'CAR', 7.5, 'final', 40, 9),
  game('2025w8-sf-hou', '2025-10-26T17:00:00.000Z', 'SF', 'HOU', -1.5, 'final', 15, 26),
  game('2025w8-cle-ne', '2025-10-26T17:00:00.000Z', 'CLE', 'NE', -7.5, 'final', 13, 32),
  game('2025w8-nyg-phi', '2025-10-26T17:00:00.000Z', 'NYG', 'PHI', -7, 'scheduled'),
  game('2025w8-tb-no', '2025-10-26T20:05:00.000Z', 'TB', 'NO', 4.5, 'scheduled'),
  game('2025w8-dal-den', '2025-10-26T20:25:00.000Z', 'DAL', 'DEN', -3.5, 'scheduled')
];

const pickPattern = {
  Moe: ['LAC', 'NYJ', 'BUF', 'HOU', 'NE', 'PHI', 'TB', 'DEN'],
  John: ['LAC', 'NYJ', 'CAR', 'HOU', 'CLE', 'PHI', 'TB', 'DAL'],
  Diane: ['MIN', 'CIN', 'BUF', 'SF', 'NE', 'NYG', 'NO', 'DEN'],
  Adam: ['LAC', 'NYJ', 'BUF', 'SF', 'CLE', 'PHI', 'NO', 'DAL']
};

const submissions = Object.entries(pickPattern).map(([name, choices], playerIndex) => ({
  id: `demo-${playerIndex + 1}`,
  name,
  submittedAt: `2025-10-23T${String(22 + Math.floor(playerIndex / 2)).padStart(2, '0')}:${String((playerIndex * 7) % 60).padStart(2, '0')}:00.000Z`,
  picks: Object.fromEntries(games.map((item, index) => [item.id, choices[index]]))
}));

export function createSampleState() {
  return {
    version: 1,
    activeSeason: 2025,
    activeWeek: 8,
    players: Object.keys(pickPattern),
    weeks: {
      '8': {
        season: 2025,
        week: 8,
        label: 'Week 8',
        status: 'live',
        source: 'sample',
        spreadCapturedAt: '2025-10-22T22:00:00.000Z',
        shareToken: 'w8-family',
        formUrl: '',
        publishedAt: '2025-10-22T22:00:00.000Z',
        picksLockedAt: '2025-10-24T00:15:00.000Z',
        games,
        submissions
      }
    },
    history: {
      Moe: [9, 10, 8, 11, 7, 9, 11],
      John: [7, 8, 9, 10, 8, 9, 9],
      Diane: [8, 9, 10, 8, 9, 10, 8],
      Adam: [8, 8, 7, 9, 8, 9, 7]
    },
    audit: [{ at: '2025-10-22T22:00:00.000Z', type: 'demo.loaded', detail: 'Sample Week 8 published' }]
  };
}

export function createBlankState(season = new Date().getFullYear()) {
  return {
    version: 1,
    activeSeason: Number(season),
    activeWeek: 1,
    players: ['Moe', 'John', 'Diane', 'Adam'],
    weeks: {},
    history: { Moe: [], John: [], Diane: [], Adam: [] },
    audit: [{ at: new Date().toISOString(), type: 'season.created', detail: `${season} pool created` }]
  };
}

export function sampleGamesForWeek(season, week) {
  if (Number(season) === 2025 && Number(week) === 8) return structuredClone(games);
  const base = Date.UTC(Number(season), 8, 4 + (Number(week) - 1) * 7, 0, 15);
  return [
    game(`${season}w${week}-buf-nyj`, new Date(base).toISOString(), 'BUF', 'NYJ', 4.5),
    game(`${season}w${week}-den-kc`, new Date(base + 3 * 86400000 + 17 * 3600000).toISOString(), 'DEN', 'KC', -3.5),
    game(`${season}w${week}-dal-phi`, new Date(base + 3 * 86400000 + 20 * 3600000).toISOString(), 'DAL', 'PHI', -2.5)
  ];
}
