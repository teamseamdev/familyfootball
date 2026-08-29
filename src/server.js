import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { JsonStore, audit } from './store.js';
import { chronological, formStatusLabel, gameChoices, overallTotalsThroughWeek, picksAreRevealed, standings, validatePicks, weekSnapshot } from './pool.js';
import { ingestWeek } from './providers.js';
import { publishWeek, schedulerTick, startScheduler } from './scheduler.js';
import { timingSummary } from './timing.js';
import { SupabaseStore } from './supabase-store.js';
import { advanceMockWeek, createMockWeekOneState, finishMockWeek } from './mock-week.js';
import { MemoryStore } from './memory-store.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function json(response, status, data, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}

function text(response, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  response.end(body);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if ((request.headers['content-type'] || '').includes('application/json')) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
}

function safeStaticPath(urlPath) {
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const resolved = path.resolve(publicDir, requested);
  return resolved.startsWith(publicDir) ? resolved : null;
}

function publicWeek(week, config, players = []) {
  const snapshot = weekSnapshot(week, config);
  return {
    season: snapshot.season,
    week: snapshot.week,
    label: snapshot.label,
    status: snapshot.status,
    spreadCapturedAt: snapshot.spreadCapturedAt,
    picksLockedAt: snapshot.picksLockedAt,
    players,
    submittedPlayers: snapshot.submissions.map(submission => submission.name),
    games: snapshot.games.map(({ awayScore, homeScore, status, ...game }) => game)
  };
}

async function resetLiveSeason({ store, config, season, weekNumber = 1, provider, manualGames = [], migrationKey = '' }) {
  const previous = await store.read();
  const result = await ingestWeek({ season, week: weekNumber, provider, fallbackProvider: config.fallbackProvider, manualGames });
  const players = previous.players?.length ? previous.players : ['Moe', 'John', 'Diane', 'Adam'];
  const clean = {
    version: 1,
    mode: 'live',
    activeSeason: season,
    activeWeek: weekNumber,
    players,
    weeks: {
      [String(weekNumber)]: {
        season, week: weekNumber, label: `Week ${weekNumber}`, status: 'draft', source: result.source,
        spreadCapturedAt: result.capturedAt, shareToken: '', formUrl: '', publishedAt: '', picksLockedAt: '',
        games: chronological(result.games), submissions: []
      }
    },
    history: Object.fromEntries(players.map(name => [name, []])),
    completedMigrations: [...new Set([...(previous.completedMigrations || []), ...(migrationKey ? [migrationKey] : [])])],
    audit: []
  };
  audit(clean, 'season.reset-live', `Clean ${season} Week ${weekNumber} created from ${result.source}`);
  await store.write(clean);
  return { action: 'live-season-reset', week: weekSnapshot(clean.weeks[String(weekNumber)], config), warnings: result.warnings || [], timing: timingSummary(clean.weeks[String(weekNumber)], config) };
}

async function runScheduledTask({ store, config }) {
  if (config.liveResetTarget) {
    const match = String(config.liveResetTarget).match(/^(\d{4}):(\d{1,2})$/);
    if (!match) throw new Error('POOL_LIVE_RESET_TARGET must use YYYY:WEEK format.');
    const season = Number(match[1]);
    const weekNumber = Number(match[2]);
    const migrationKey = `live-reset-v2:${season}:${weekNumber}:${config.scheduleProvider}`;
    const current = await store.read();
    const alreadyReset = (current.completedMigrations || []).includes(migrationKey);
    if (!alreadyReset) return resetLiveSeason({ store, config, season, weekNumber, provider: config.scheduleProvider, migrationKey });
  }
  return schedulerTick({ store, config });
}

export function createPoolServer(overrides = {}) {
  const config = loadConfig(overrides);
  const store = overrides.store || (
    config.storageProvider === 'supabase'
      ? new SupabaseStore(config)
      : config.storageProvider === 'memory'
        ? new MemoryStore(createMockWeekOneState(config.baseUrl))
        : new JsonStore(config.dataFile)
  );
  const admin = request => request.headers['x-admin-key'] === config.adminKey;
  const cronAuthorized = request => Boolean(config.cronSecret) && request.headers.authorization === `Bearer ${config.cronSecret}`;

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url, config.baseUrl);
      const route = url.pathname;

      if (request.method === 'GET' && route === '/health') return json(response, 200, { ok: true, service: 'family-nfl-pool', now: new Date().toISOString() });

      if (request.method === 'GET' && route === '/api/cron') {
        if (!config.cronSecret || request.headers.authorization !== `Bearer ${config.cronSecret}`) return json(response, 403, { error: 'Cron authorization required' });
        return json(response, 200, await runScheduledTask({ store, config }));
      }

      if (request.method === 'GET' && (route === '/setup' || route === '/setup/')) {
        return text(response, 200, fs.readFileSync(path.join(publicDir, 'index.html')), mime['.html']);
      }

      const shortMatch = route.match(/^\/p\/([A-Za-z0-9_-]+)$/);
      if (request.method === 'GET' && shortMatch) {
        const state = await store.read();
        const week = Object.values(state.weeks).find(item => item.shareToken === shortMatch[1]);
        if (!week) return text(response, 404, 'This pool link is not active.');
        return text(response, 302, '', 'text/plain', { location: `/pick.html?token=${encodeURIComponent(shortMatch[1])}` });
      }

      const publicApiMatch = route.match(/^\/api\/public\/week\/([A-Za-z0-9_-]+)$/);
      if (request.method === 'GET' && publicApiMatch) {
        const state = await store.read();
        const week = Object.values(state.weeks).find(item => item.shareToken === publicApiMatch[1]);
        if (!week) return json(response, 404, { error: 'Pool link not found' });
        return json(response, 200, publicWeek(week, config, state.players || []));
      }

      const submitMatch = route.match(/^\/api\/public\/week\/([A-Za-z0-9_-]+)\/submit$/);
      if (request.method === 'POST' && submitMatch) {
        const input = await body(request);
        const state = await store.read();
        const week = Object.values(state.weeks).find(item => item.shareToken === submitMatch[1]);
        if (!week) return json(response, 404, { error: 'Pool link not found' });
        const requestedName = String(input.name || '').trim().slice(0, 60);
        const name = (state.players || []).find(player => player.toLowerCase() === requestedName.toLowerCase());
        if (!name) return json(response, 400, { error: 'Choose one of the four registered players.' });
        const existing = week.submissions.find(item => item.name.toLowerCase() === name.toLowerCase());
        if (existing) return json(response, 409, { error: `${name} already submitted picks for Week ${week.week}. Only the first submission is accepted.` });
        if (new Date() >= new Date(week.picksLockedAt)) return json(response, 409, { error: 'Picks are locked because the first game has started.' });
        const errors = validatePicks(week, input.picks || {});
        if (errors.length) return json(response, 400, { error: errors.join(' ') });
        const submission = { id: crypto.randomUUID(), name, submittedAt: new Date().toISOString(), picks: input.picks };
        week.submissions.push(submission);
        audit(state, 'picks.submitted', `${name} submitted Week ${week.week}`);
        await store.write(state);
        return json(response, 201, { ok: true, message: `Picks saved for ${name}.` });
      }

      const staticPublic = ['/pick.html', '/styles.css', '/app.js', '/pick.js'];
      if (request.method === 'GET' && staticPublic.includes(route)) {
        const file = safeStaticPath(route);
        if (!file || !fs.existsSync(file)) return text(response, 404, 'Not found');
        return text(response, 200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
      }

      if (request.method === 'GET' && route === '/api/week') {
        const state = await store.read();
        const number = url.searchParams.get('week') || state.activeWeek;
        const week = state.weeks[String(number)];
        if (!week) return json(response, 404, { error: `Week ${number} not found` });
        const shareUrl = week.formUrl || (week.shareToken ? `${config.baseUrl.replace(/\/$/, '')}/p/${week.shareToken}` : '');
        const players = state.players || [];
        const picksRevealed = picksAreRevealed(week, players);
        const snapshot = weekSnapshot(week, config);
        if (!picksRevealed) snapshot.submissions = [];
        const submittedNames = new Set((week.submissions || []).map(item => item.name.toLowerCase()));
        const pendingPlayers = players.filter(name => !submittedNames.has(name.toLowerCase()));
        const acceptingSubmissions = week.status === 'open' && new Date() < new Date(week.picksLockedAt) && players.some(name => !submittedNames.has(name.toLowerCase()));
        const formStatus = formStatusLabel(week, { picksRevealed, acceptingSubmissions });
        return json(response, 200, { ...snapshot, players, pendingPlayers, picksRevealed, acceptingSubmissions, formStatus, canSimulate: (week.submissions || []).length > 0, overallTotals: overallTotalsThroughWeek(state, number, config), timing: timingSummary(week, config), shareUrl, storageMode: config.storageProvider, poolMode: state.mode || 'live' });
      }
      if (request.method === 'GET' && route === '/api/standings') {
        const state = await store.read();
        const weeks = Object.values(state.weeks || {}).map(week => ({ week: Number(week.week), label: week.label || `Week ${week.week}`, status: week.status })).sort((a, b) => a.week - b.week);
        return json(response, 200, { season: state.activeSeason, activeWeek: state.activeWeek, weeks, standings: standings(state, config) });
      }

      if (route.startsWith('/api/simulation/') && !config.simulationEnabled) return json(response, 404, { error: 'Test mode is disabled.' });

      if (request.method === 'POST' && route === '/api/simulation/reset-season') {
        const state = createMockWeekOneState(config.baseUrl);
        await store.write(state);
        return json(response, 201, { ok: true, week: weekSnapshot(state.weeks['1'], config), shareUrl: state.weeks['1'].formUrl });
      }

      if (request.method === 'POST' && route === '/api/simulation/finish') {
        const state = await store.read();
        const week = state.weeks[String(state.activeWeek)];
        if (!week?.submissions?.length) return json(response, 409, { error: 'Submit at least one player’s picks before simulating results.' });
        finishMockWeek(state, state.activeWeek);
        await store.write(state);
        return json(response, 200, { ok: true, week: weekSnapshot(week, config), standings: standings(state, config) });
      }

      if (request.method === 'POST' && route === '/api/simulation/next-week') {
        const state = await store.read();
        advanceMockWeek(state, config.baseUrl);
        await store.write(state);
        const week = state.weeks[String(state.activeWeek)];
        return json(response, 201, { ok: true, week: weekSnapshot(week, config), shareUrl: week.formUrl });
      }

      if (route.startsWith('/api/admin/') && !admin(request) && !(route === '/api/admin/reset-live-season' && cronAuthorized(request))) return json(response, 403, { error: 'Admin key required' });

      if (request.method === 'POST' && route === '/api/admin/reset-live-season') {
        const input = await body(request);
        const season = Number(input.season);
        const weekNumber = Number(input.week || 1);
        if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(weekNumber) || weekNumber < 1) return json(response, 400, { error: 'A valid season and week are required.' });
        const provider = input.provider || config.scheduleProvider;
        return json(response, 201, await resetLiveSeason({ store, config, season, weekNumber, provider, manualGames: input.games || [] }));
      }

      if (request.method === 'POST' && route === '/api/admin/ingest') {
        const input = await body(request);
        const state = await store.read();
        const season = Number(input.season || state.activeSeason);
        const weekNumber = Number(input.week || state.activeWeek);
        const provider = input.provider || config.scheduleProvider;
        const result = await ingestWeek({ season, week: weekNumber, provider, fallbackProvider: config.fallbackProvider, manualGames: input.games || [] });
        state.activeSeason = season;
        state.activeWeek = weekNumber;
        state.weeks[String(weekNumber)] = {
          season, week: weekNumber, label: `Week ${weekNumber}`, status: 'draft', source: result.source,
          spreadCapturedAt: result.capturedAt, shareToken: '', formUrl: '', publishedAt: '', picksLockedAt: '',
          games: chronological(result.games), submissions: state.weeks[String(weekNumber)]?.submissions || []
        };
        audit(state, 'week.ingested', `${season} Week ${weekNumber} from ${provider}`);
        await store.write(state);
        return json(response, 201, { ...weekSnapshot(state.weeks[String(weekNumber)], config), warnings: result.warnings || [] });
      }

      if (request.method === 'POST' && route === '/api/admin/publish') {
        const input = await body(request);
        const currentState = await store.read();
        const result = await publishWeek({ store, config, weekNumber: Number(input.week || currentState.activeWeek), notify: input.notify !== false });
        return json(response, 200, result);
      }

      if (request.method === 'POST' && route === '/api/admin/results') {
        const input = await body(request);
        const state = await store.read();
        const week = state.weeks[String(input.week || state.activeWeek)];
        if (!week) return json(response, 404, { error: 'Week not found' });
        const invalidScore = (input.games || []).find(update => (update.awayScore != null && !Number.isInteger(Number(update.awayScore))) || (update.homeScore != null && !Number.isInteger(Number(update.homeScore))));
        if (invalidScore) return json(response, 400, { error: 'NFL scores must be whole numbers. Fractional values are only valid for spreads.' });
        for (const update of input.games || []) {
          const game = week.games.find(item => item.id === update.id);
          if (!game) continue;
          if (update.awayScore != null) game.awayScore = Number(update.awayScore);
          if (update.homeScore != null) game.homeScore = Number(update.homeScore);
          if (update.status) game.status = update.status;
        }
        if (week.games.every(game => game.status === 'final')) week.status = 'final';
        else if (week.games.some(game => game.status === 'final')) week.status = 'live';
        audit(state, 'results.updated', `Results updated for Week ${week.week}`);
        await store.write(state);
        return json(response, 200, weekSnapshot(week, config));
      }

      if (request.method === 'POST' && route === '/api/admin/rollover') {
        const state = await store.read();
        const current = state.weeks[String(state.activeWeek)];
        if (current && current.status !== 'final') return json(response, 409, { error: 'Finish grading the active week before rollover.' });
        const nextWeek = Number(state.activeWeek) + 1;
        const result = await ingestWeek({ season: state.activeSeason, week: nextWeek, provider: config.scheduleProvider, fallbackProvider: config.fallbackProvider });
        state.activeWeek = nextWeek;
        state.weeks[String(nextWeek)] = { season: state.activeSeason, week: nextWeek, label: `Week ${nextWeek}`, status: 'draft', source: result.source, spreadCapturedAt: result.capturedAt, shareToken: '', formUrl: '', publishedAt: '', picksLockedAt: '', games: chronological(result.games), submissions: [] };
        audit(state, 'week.rolled-over', `Created Week ${nextWeek}`);
        await store.write(state);
        return json(response, 201, weekSnapshot(state.weeks[String(nextWeek)], config));
      }

      if (request.method === 'POST' && route === '/api/admin/scheduler-tick') return json(response, 200, await runScheduledTask({ store, config }));

      const file = safeStaticPath(route);
      if (request.method === 'GET' && file && fs.existsSync(file) && fs.statSync(file).isFile()) return text(response, 200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
      return text(response, 404, 'Not found');
    } catch (error) {
      console.error(error);
      return json(response, 500, { error: error.message });
    }
  };

  const server = http.createServer(handler);
  let scheduler;
  return {
    config,
    store,
    handler,
    server,
    start(port = config.port) {
      return new Promise(resolve => server.listen(port, () => {
        scheduler = startScheduler({ store, config });
        resolve(server.address());
      }));
    },
    stop() {
      if (scheduler) clearInterval(scheduler);
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

let defaultApp;

export default function handler(request, response) {
  defaultApp ||= createPoolServer();
  return defaultApp.handler(request, response);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  defaultApp = createPoolServer();
  defaultApp.start().then(() => console.log(`Family NFL Pool running at ${defaultApp.config.baseUrl}`));
}
