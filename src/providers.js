import { sampleGamesForWeek } from './sample-data.js';

function competitor(competition, side) {
  return competition.competitors?.find(item => item.homeAway === side);
}

function homeSpreadFromOdds(competition) {
  const odds = competition.odds?.[0];
  if (!odds) return null;
  const home = competitor(competition, 'home');
  const away = competitor(competition, 'away');
  const magnitude = Math.abs(Number(odds.spread));
  if (Number.isNaN(magnitude)) return null;
  if (odds.homeTeamOdds?.favorite === true) return -magnitude;
  if (odds.awayTeamOdds?.favorite === true) return magnitude;
  const detail = String(odds.details || '').toUpperCase();
  if (detail.includes(home?.team?.abbreviation?.toUpperCase())) return -magnitude;
  if (detail.includes(away?.team?.abbreviation?.toUpperCase())) return magnitude;
  return magnitude === 0 ? 0 : null;
}

export function normalizeEspnEvent(event) {
  const competition = event.competitions?.[0];
  const home = competitor(competition || {}, 'home');
  const away = competitor(competition || {}, 'away');
  if (!competition || !home || !away) return null;
  const completed = competition.status?.type?.completed === true;
  return {
    id: String(event.id),
    kickoff: event.date,
    away: away.team.abbreviation,
    home: home.team.abbreviation,
    awayName: away.team.displayName,
    homeName: home.team.displayName,
    homeSpread: homeSpreadFromOdds(competition),
    status: completed ? 'final' : 'scheduled',
    awayScore: completed ? Number(away.score) : null,
    homeScore: completed ? Number(home.score) : null,
    source: 'espn',
    spreadDetails: competition.odds?.[0]?.details || null
  };
}

export async function fetchEspnWeek(season, week, fetchImpl = fetch) {
  const params = new URLSearchParams({ dates: String(season), seasontype: '2', week: String(week), limit: '100' });
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${params}`;
  const response = await fetchImpl(url, { headers: {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    origin: 'https://www.espn.com',
    referer: 'https://www.espn.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36'
  } });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  const data = await response.json();
  const games = (data.events || []).map(normalizeEspnEvent).filter(Boolean);
  if (!games.length) throw new Error(`ESPN returned no NFL games for ${season} week ${week}`);
  const invalidScores = games.filter(game => game.status === 'final' && (!Number.isInteger(game.awayScore) || !Number.isInteger(game.homeScore)));
  if (invalidScores.length) throw new Error(`ESPN returned a non-integer NFL score for ${invalidScores.map(game => `${game.away} @ ${game.home}`).join(', ')}`);
  return { source: 'espn', capturedAt: new Date().toISOString(), games };
}

export async function ingestWeek({ season, week, provider = 'sample', fallbackProvider = '', manualGames = [], fetchImpl = fetch }) {
  if (provider === 'manual') {
    if (!Array.isArray(manualGames) || !manualGames.length) throw new Error('Manual provider requires a non-empty games array');
    if (manualGames.some(game => (game.awayScore != null && !Number.isInteger(Number(game.awayScore))) || (game.homeScore != null && !Number.isInteger(Number(game.homeScore))))) throw new Error('NFL scores must be whole numbers');
    return { source: 'manual', capturedAt: new Date().toISOString(), games: manualGames, warnings: [] };
  }
  if (provider === 'espn') {
    try {
      const result = await fetchEspnWeek(season, week, fetchImpl);
      const gamesWithLines = result.games.filter(game => game.homeSpread != null);
      if (gamesWithLines.length !== result.games.length) {
        const missing = result.games.filter(game => game.homeSpread == null).map(game => `${game.away} @ ${game.home}`);
        return { ...result, warnings: [`Missing ESPN spread for: ${missing.join(', ')}`] };
      }
      return result;
    } catch (error) {
      if (fallbackProvider === 'sample') {
        return { source: 'sample', capturedAt: new Date().toISOString(), games: sampleGamesForWeek(season, week), warnings: [`ESPN unavailable; sample fallback used: ${error.message}`] };
      }
      throw error;
    }
  }
  return { source: 'sample', capturedAt: new Date().toISOString(), games: sampleGamesForWeek(season, week), warnings: [] };
}
