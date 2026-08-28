import { audit } from './store.js';

const MOCK_GAMES = [
  ['401872656','2026-09-10T00:20:00.000Z','NE','SEA','New England Patriots','Seattle Seahawks',-3.5],
  ['401872657','2026-09-11T00:35:00.000Z','SF','LAR','San Francisco 49ers','Los Angeles Rams',-3.5],
  ['401872925','2026-09-13T17:00:00.000Z','TB','CIN','Tampa Bay Buccaneers','Cincinnati Bengals',-3.5],
  ['401872923','2026-09-13T17:00:00.000Z','NO','DET','New Orleans Saints','Detroit Lions',-7],
  ['401872924','2026-09-13T17:00:00.000Z','NYJ','TEN','New York Jets','Tennessee Titans',-3],
  ['401872659','2026-09-13T17:00:00.000Z','BAL','IND','Baltimore Ravens','Indianapolis Colts',3.5],
  ['401872658','2026-09-13T17:00:00.000Z','ATL','PIT','Atlanta Falcons','Pittsburgh Steelers',-3],
  ['401872661','2026-09-13T17:00:00.000Z','CHI','CAR','Chicago Bears','Carolina Panthers',2.5],
  ['401872922','2026-09-13T17:00:00.000Z','CLE','JAX','Cleveland Browns','Jacksonville Jaguars',-7.5],
  ['401872660','2026-09-13T17:00:00.000Z','BUF','HOU','Buffalo Bills','Houston Texans',1.5],
  ['401872928','2026-09-13T20:25:00.000Z','MIA','LV','Miami Dolphins','Las Vegas Raiders',-3.5],
  ['401872927','2026-09-13T20:25:00.000Z','GB','MIN','Green Bay Packers','Minnesota Vikings',-1.5],
  ['401872929','2026-09-13T20:25:00.000Z','WSH','PHI','Washington Commanders','Philadelphia Eagles',-4.5],
  ['401872926','2026-09-13T20:25:00.000Z','ARI','LAC','Arizona Cardinals','Los Angeles Chargers',-10.5],
  ['401872930','2026-09-14T00:20:00.000Z','DAL','NYG','Dallas Cowboys','New York Giants',2.5],
  ['401872931','2026-09-15T00:15:00.000Z','DEN','KC','Denver Broncos','Kansas City Chiefs',-3]
];

export function mockWeekOneGames() {
  return MOCK_GAMES.map(([id, kickoff, away, home, awayName, homeName, homeSpread]) => ({
    id, kickoff, away, home, awayName, homeName, homeSpread,
    status: 'scheduled', awayScore: null, homeScore: null, source: 'mock-espn'
  }));
}

export function createMockWeekOneState(baseUrl = 'http://localhost:4173') {
  const games = mockWeekOneGames();
  const now = new Date().toISOString();
  return {
    version: 1,
    activeSeason: 2026,
    activeWeek: 1,
    players: ['Moe', 'John', 'Diane', 'Adam'],
    weeks: {
      '1': {
        season: 2026,
        week: 1,
        label: 'Mock Week 1',
        status: 'open',
        source: 'mock',
        spreadCapturedAt: now,
        shareToken: 'mock-week-1',
        formUrl: `${baseUrl.replace(/\/$/, '')}/p/mock-week-1`,
        googleFormUrl: '',
        publishedAt: now,
        picksLockedAt: games[0].kickoff,
        games,
        submissions: []
      }
    },
    history: { Moe: [], John: [], Diane: [], Adam: [] },
    audit: [{ at: now, type: 'simulation.started', detail: 'Clean 2026 Mock Week 1 created' }]
  };
}

export function finishMockWeek(state) {
  const week = state.weeks['1'];
  if (!week || week.source !== 'mock') throw new Error('Start Mock Week 1 before simulating results.');
  week.games.forEach((game, index) => {
    const awayScore = 20;
    const threshold = -Number(game.homeSpread);
    const homeMargin = index === 4 ? threshold : index % 2 === 0 ? Math.ceil(threshold + 3) : Math.floor(threshold - 3);
    game.awayScore = awayScore;
    game.homeScore = awayScore + homeMargin;
    game.status = 'final';
  });
  week.status = 'final';
  audit(state, 'simulation.finished', `Mock results applied to ${week.games.length} games`);
  return state;
}
