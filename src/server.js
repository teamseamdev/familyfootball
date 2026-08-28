import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { JsonStore, audit } from './store.js';
import { chronological, gameChoices, standings, validatePicks, weekSnapshot } from './pool.js';
import { ingestWeek } from './providers.js';
import { pickSheetSvg } from './picksheet.js';
import { publishWeek, schedulerTick, startScheduler } from './scheduler.js';
import { timingSummary } from './timing.js';
import { SupabaseStore } from './supabase-store.js';
import { advanceMockWeek, createMockWeekOneState, finishMockWeek } from './mock-week.js';
import { MemoryStore } from './memory-store.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function sessionValue(passcode) {
  return crypto.createHash('sha256').update(`pool:${passcode}`).digest('hex');
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(parts => parts.length === 2));
}

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
    games: snapshot.games.map(({ awayScore, homeScore, status, ...game }) => game)
  };
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
  const authenticated = request => !config.dashboardPasscode || cookies(request).pool_session === sessionValue(config.dashboardPasscode);
  const admin = request => request.headers['x-admin-key'] === config.adminKey;

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url, config.baseUrl);
      const route = url.pathname;

      if (request.method === 'GET' && route === '/health') return json(response, 200, { ok: true, service: 'family-nfl-pool', now: new Date().toISOString() });

      if (request.method === 'POST' && route === '/login') {
        const input = await body(request);
        if (input.passcode !== config.dashboardPasscode) return text(response, 401, 'That passcode did not match.');
        return text(response, 303, '', 'text/plain', { 'set-cookie': `pool_session=${sessionValue(config.dashboardPasscode)}; HttpOnly; SameSite=Strict; Path=/`, location: '/' });
      }
      if (request.method === 'POST' && route === '/logout') {
        return text(response, 303, '', 'text/plain', { 'set-cookie': 'pool_session=; Max-Age=0; Path=/', location: '/login.html' });
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
        if (new Date() >= new Date(week.picksLockedAt)) return json(response, 409, { error: 'Picks are locked because the first game has started.' });
        const requestedName = String(input.name || '').trim().slice(0, 60);
        const name = (state.players || []).find(player => player.toLowerCase() === requestedName.toLowerCase());
        if (!name) return json(response, 400, { error: 'Choose one of the four registered players.' });
        const errors = validatePicks(week, input.picks || {});
        if (errors.length) return json(response, 400, { error: errors.join(' ') });
        const submission = { id: crypto.randomUUID(), name, submittedAt: new Date().toISOString(), picks: input.picks };
        const existing = week.submissions.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
        if (existing >= 0) week.submissions[existing] = submission;
        else week.submissions.push(submission);
        audit(state, 'picks.submitted', `${name} submitted Week ${week.week}`);
        await store.write(state);
        return json(response, 201, { ok: true, message: `Picks saved for ${name}.` });
      }

      const staticPublic = ['/login.html', '/pick.html', '/styles.css', '/app.js', '/pick.js'];
      if (request.method === 'GET' && staticPublic.includes(route)) {
        const file = safeStaticPath(route);
        if (!file || !fs.existsSync(file)) return text(response, 404, 'Not found');
        return text(response, 200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
      }

      if (!authenticated(request) && !route.startsWith('/api/admin/')) {
        if (route.startsWith('/api/')) return json(response, 401, { error: 'Dashboard login required' });
        return text(response, 302, '', 'text/plain', { location: '/login.html' });
      }

      if (request.method === 'GET' && route === '/api/week') {
        const state = await store.read();
        const number = url.searchParams.get('week') || state.activeWeek;
        const week = state.weeks[String(number)];
        if (!week) return json(response, 404, { error: `Week ${number} not found` });
        const shareUrl = week.formUrl || (week.shareToken ? `${config.baseUrl.replace(/\/$/, '')}/p/${week.shareToken}` : '');
        return json(response, 200, { ...weekSnapshot(week, config), timing: timingSummary(week, config), shareUrl, storageMode: config.storageProvider, poolMode: state.mode || 'live' });
      }
      if (request.method === 'GET' && route === '/api/standings') {
        const state = await store.read();
        return json(response, 200, { season: state.activeSeason, activeWeek: state.activeWeek, standings: standings(state, config) });
      }
      if (request.method === 'GET' && route === '/api/audit') return json(response, 200, (await store.read()).audit || []);
      if (request.method === 'GET' && route === '/api/picksheet.svg') {
        const state = await store.read();
        const week = state.weeks[String(url.searchParams.get('week') || state.activeWeek)];
        if (!week) return text(response, 404, 'Week not found');
        return text(response, 200, pickSheetSvg(week, state), 'image/svg+xml', { 'content-disposition': `inline; filename="week-${week.week}-picks.svg"` });
      }

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

      if (route.startsWith('/api/admin/') && !admin(request)) return json(response, 403, { error: 'Admin key required' });

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

      if (request.method === 'POST' && route === '/api/admin/scheduler-tick') return json(response, 200, await schedulerTick({ store, config }));

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
