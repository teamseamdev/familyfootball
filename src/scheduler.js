import crypto from 'node:crypto';
import { timingSummary } from './timing.js';
import { audit } from './store.js';
import { weekSnapshot } from './pool.js';
import { GoogleBridge } from './google-bridge.js';
import { sendPoolLink } from './notifier.js';
import { fetchEspnWeek, ingestWeek } from './providers.js';

export function shareToken() {
  return crypto.randomBytes(5).toString('base64url');
}

export async function publishWeek({ store, config, weekNumber, notify = true }) {
  const state = await store.read();
  const week = state.weeks[String(weekNumber)];
  if (!week) throw new Error(`Week ${weekNumber} not found`);
  if (week.source === 'espn') {
    const fresh = await fetchEspnWeek(week.season, week.week);
    const missing = fresh.games.filter(game => game.homeSpread == null);
    if (missing.length) throw new Error(`Publishing stopped: ESPN has no spread for ${missing.map(game => `${game.away} @ ${game.home}`).join(', ')}`);
    week.games = fresh.games;
    week.spreadCapturedAt = fresh.capturedAt;
  }
  week.shareToken ||= shareToken();
  const shortUrl = `${config.baseUrl.replace(/\/$/, '')}/p/${week.shareToken}`;
  let googleFormUrl = week.googleFormUrl || '';
  if (config.formProvider === 'google') {
    const bridge = new GoogleBridge(config);
    const result = await bridge.upsertForm(weekSnapshot(week, config));
    googleFormUrl = result.responderUrl;
  }
  week.formUrl = shortUrl;
  week.googleFormUrl = googleFormUrl;
  week.publishedAt ||= new Date().toISOString();
  week.status = week.status === 'draft' ? 'open' : week.status;
  const firstKickoff = [...week.games].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0]?.kickoff;
  week.picksLockedAt = firstKickoff;
  audit(state, 'week.published', `Week ${week.week}: ${shortUrl}`);
  await store.write(state);
  const notification = notify ? await sendPoolLink(config, `NFL Pool Week ${week.week} is ready: ${shortUrl}`) : null;
  return { week: weekSnapshot(week, config), shortUrl, googleFormUrl, notification };
}

export async function schedulerTick({ store, config, now = new Date() }) {
  const state = await store.read();
  const week = state.weeks[String(state.activeWeek)];
  if (!week || !week.games?.length) return { action: 'none' };
  if (week.publishedAt && week.source === 'espn' && week.status !== 'final' && now >= new Date(week.picksLockedAt || week.games[0].kickoff)) {
    const lastRefresh = week.lastScoreRefreshAt ? new Date(week.lastScoreRefreshAt) : new Date(0);
    if (now - lastRefresh >= Number(config.scoreRefreshMinutes || 5) * 60_000) {
      const live = await fetchEspnWeek(week.season, week.week);
      let changed = 0;
      for (const update of live.games) {
        const game = week.games.find(item => item.id === update.id);
        if (!game) continue;
        if (game.status !== update.status || game.awayScore !== update.awayScore || game.homeScore !== update.homeScore) changed += 1;
        game.status = update.status;
        game.awayScore = update.awayScore;
        game.homeScore = update.homeScore;
        if (update.homeSpread != null && game.homeSpread == null) game.homeSpread = update.homeSpread;
      }
      week.lastScoreRefreshAt = now.toISOString();
      week.status = week.games.every(game => game.status === 'final') ? 'final' : week.games.some(game => game.status === 'final') ? 'live' : week.status;
      if (changed) audit(state, 'scores.refreshed', `${changed} games changed for Week ${week.week}`);
      await store.write(state);
      if (week.status === 'final' && config.autoRollover) {
        const nextWeek = Number(week.week) + 1;
        if (!state.weeks[String(nextWeek)]) {
          const result = await ingestWeek({ season: week.season, week: nextWeek, provider: config.scheduleProvider, fallbackProvider: config.fallbackProvider });
          state.activeWeek = nextWeek;
          state.weeks[String(nextWeek)] = { season: week.season, week: nextWeek, label: `Week ${nextWeek}`, status: 'draft', source: result.source, spreadCapturedAt: result.capturedAt, shareToken: '', formUrl: '', publishedAt: '', picksLockedAt: '', games: result.games, submissions: [] };
          audit(state, 'week.rolled-over', `Automatically created Week ${nextWeek}`);
          await store.write(state);
          return { action: 'rolled-over', week: nextWeek, warnings: result.warnings || [] };
        }
      }
      return { action: 'scores-refreshed', changed };
    }
    return { action: 'waiting-for-score-refresh' };
  }
  if (week.publishedAt) return { action: 'none' };
  const timing = timingSummary(week, config);
  if (timing.publishAt && now >= new Date(timing.publishAt)) {
    const result = await publishWeek({ store, config, weekNumber: state.activeWeek, notify: true });
    return { action: 'published', ...result };
  }
  return { action: 'waiting', publishAt: timing.publishAt };
}

export function startScheduler(context) {
  const timer = setInterval(() => schedulerTick(context).catch(error => console.error('[scheduler]', error)), 60_000);
  timer.unref();
  schedulerTick(context).catch(error => console.error('[scheduler]', error));
  return timer;
}
