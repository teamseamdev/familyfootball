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

async function fetchEspnCoreWeek(season, week, fetchImpl, headers) {
  const fetchJson = async url => {
    const secureUrl = String(url).replace(/^http:/, 'https:');
    const response = await fetchImpl(secureUrl, { headers });
    if (!response.ok) throw new Error(`ESPN core returned ${response.status}`);
    return response.json();
  };
  const listUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/weeks/${week}/events?lang=en&region=us&limit=100`;
  const list = await fetchJson(listUrl);
  const games = await Promise.all((list.items || []).map(async item => {
    const event = await fetchJson(item.$ref);
    const competition = await fetchJson(event.competitions?.[0]?.$ref);
    const [status, oddsList] = await Promise.all([fetchJson(competition.status?.$ref), fetchJson(competition.odds?.$ref)]);
    const [away, home] = String(event.shortName || '').split(/\s+(?:@|VS)\s+/i);
    const [awayName, homeName] = String(event.name || '').split(/\s+(?:at|vs\.?)\s+/i);
    const homeId = String(competition.competitors?.[0]?.$ref || '').match(/competitors\/(\d+)/)?.[1];
    const awayId = String(competition.competitors?.[1]?.$ref || '').match(/competitors\/(\d+)/)?.[1];
    const state = status.type?.state;
    const completed = status.type?.completed === true;
    let awayScore = null, homeScore = null;
    if (state !== 'pre' && homeId && awayId) {
      const base = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${event.id}/competitions/${competition.id}/competitors`;
      const [awayScoreData, homeScoreData] = await Promise.all([fetchJson(`${base}/${awayId}/score?lang=en&region=us`), fetchJson(`${base}/${homeId}/score?lang=en&region=us`)]);
      awayScore = Number(awayScoreData.value);
      homeScore = Number(homeScoreData.value);
    }
    const odds = oddsList.items?.[0];
    return {
      id: String(event.id), kickoff: event.date, away, home, awayName, homeName,
      homeSpread: odds?.spread == null ? null : Number(odds.spread),
      status: completed ? 'final' : state === 'in' ? 'live' : 'scheduled',
      awayScore, homeScore, source: 'espn', spreadDetails: odds?.details || null
    };
  }));
  return games.filter(game => game.id && game.away && game.home);
}

export async function fetchEspnWeek(season, week, fetchImpl = fetch) {
  const params = new URLSearchParams({ dates: String(season), seasontype: '2', week: String(week), limit: '100' });
  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    origin: 'https://www.espn.com',
    referer: 'https://www.espn.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36'
  };
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${params}`,
    `https://cdn.espn.com/core/nfl/scoreboard?xhr=1&${params}`
  ];
  let events;
  const failures = [];
  for (const url of urls) {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      failures.push(`${new URL(url).host} ${response.status}`);
      continue;
    }
    try {
      const data = await response.json();
      const candidate = data.events || data.content?.sbData?.events || [];
      if (candidate.length) {
        events = candidate;
        break;
      }
      failures.push(`${new URL(url).host} returned no events`);
    } catch {
      failures.push(`${new URL(url).host} returned invalid JSON`);
    }
  }
  const games = events ? events.map(normalizeEspnEvent).filter(Boolean) : await fetchEspnCoreWeek(season, week, fetchImpl, headers);
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
