const $ = selector => document.querySelector(selector);
const colors = ['#7FE0B7', '#FFB35B', '#6EC7FF', '#E88CFF', '#FFE16B', '#FF7D86'];

function points(value) { return Number.isInteger(value) ? value : value.toFixed(1); }
function localDate(value, options = {}) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(new Date(value)); }

async function load() {
  const [weekResponse, standingsResponse] = await Promise.all([fetch('/api/week'), fetch('/api/standings')]);
  if (weekResponse.status === 401) return location.assign('/login.html');
  if (!weekResponse.ok || !standingsResponse.ok) throw new Error('Dashboard data could not be loaded.');
  const week = await weekResponse.json();
  const season = await standingsResponse.json();
  render(week, season);
}

function render(week, season) {
  const environmentBanner = $('#environment-banner');
  if (week.storageMode === 'memory') {
    environmentBanner.hidden = false;
    environmentBanner.innerHTML = '<strong>Live preview mode</strong><span>Picks may reset between visits until Supabase storage is connected.</span>';
  }
  $('#season-label').textContent = `${season.season} NFL SEASON • WEEK ${season.activeWeek}`;
  $('#week-status').textContent = `${week.status.toUpperCase()} • ${week.submissions.length} entries`;
  $('#week-pill').textContent = `Through Week ${season.activeWeek}`;
  $('#week-heading').textContent = `Week ${week.week} matchups`;
  $('#share-link').href = week.shareUrl || '#';
  $('#form-mode').textContent = week.formProvider === 'google' ? 'Google Form + Sheet' : 'Local mode';
  const googleSheetLink = $('#google-sheet-link');
  if (week.googleSheetUrl) {
    googleSheetLink.href = week.googleSheetUrl;
    googleSheetLink.hidden = false;
  }
  $('#publish-time').textContent = week.timing.publishAt ? localDate(week.timing.publishAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Waiting for slate';

  const leader = season.standings[0];
  const finalGames = week.games.filter(game => game.status === 'final').length;
  const totalPicks = week.submissions.length * week.games.length;
  $('#stat-grid').innerHTML = [
    ['Current leader', leader?.name || '—', `${points(leader?.total || 0)} season points`, 'leader'],
    ['Week progress', `${finalGames}/${week.games.length}`, 'games graded', 'progress'],
    ['Entries', week.submissions.length, `${totalPicks} picks on file`, 'entries'],
    ['Next kickoff', nextKickoff(week.games), nextMatchup(week.games), 'kickoff']
  ].map(([label, value, note, cls]) => `<article class="stat-card ${cls}"><p>${label}</p><strong>${value}</strong><span>${note}</span></article>`).join('');

  $('#leaderboard').classList.remove('skeleton');
  $('#leaderboard').innerHTML = season.standings.map((row, index) => `<div class="leader-row ${index === 0 ? 'first' : ''}"><span class="rank">${row.rank}</span><span class="avatar" style="--avatar:${colors[index % colors.length]}">${row.name.slice(0, 1)}</span><span class="player-name">${row.name}<small>${row.weeksPlayed} weeks played</small></span><span class="week-score">+${points(row.current)}<small>this week</small></span><strong>${points(row.total)}<small>PTS</small></strong></div>`).join('');
  renderTrend(season.standings);
  renderGames(week.games, week.submissions);
  renderGradeAudit(week);
}

function nextKickoff(games) {
  const next = games.find(game => game.status !== 'final');
  return next ? localDate(next.kickoff, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Complete';
}
function nextMatchup(games) { const next = games.find(game => game.status !== 'final'); return next ? `${next.away} @ ${next.home}` : 'All games final'; }

function renderTrend(rows) {
  const shown = rows.slice(0, 4);
  const width = 640, height = 280, pad = 28;
  const cumulative = shown.map(row => row.trend.reduce((acc, value) => [...acc, (acc.at(-1) || 0) + value], []));
  const max = Math.max(...cumulative.flat(), 1);
  const paths = cumulative.map((values, index) => {
    const points = values.map((value, i) => `${pad + i * ((width - pad * 2) / Math.max(values.length - 1, 1))},${height - pad - value / max * (height - pad * 2)}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${colors[index]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const grid = [0, .25, .5, .75, 1].map(level => `<line x1="${pad}" y1="${height - pad - level * (height-pad*2)}" x2="${width-pad}" y2="${height-pad-level*(height-pad*2)}" stroke="#24434e" stroke-width="1"/>`).join('');
  $('#trend-chart').classList.remove('skeleton');
  $('#trend-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative season point trends">${grid}${paths}</svg>`;
  $('#trend-legend').innerHTML = shown.map((row, index) => `<span><i style="background:${colors[index]}"></i>${row.name}</span>`).join('');
}

function renderGames(games, submissions) {
  $('#games').innerHTML = games.map(game => {
    const awayChoice = game.choices[0], homeChoice = game.choices[1];
    const awayPicks = submissions.filter(item => item.picks[game.id] === game.away).length;
    const homePicks = submissions.filter(item => item.picks[game.id] === game.home).length;
    const result = game.status === 'final' ? `<div class="game-score"><strong>${game.awayScore}</strong><span>FINAL</span><strong>${game.homeScore}</strong></div>` : `<div class="game-time">${localDate(game.kickoff, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>`;
    return `<article class="game-card"><div class="game-top"><span>${game.status}</span><small>${game.source || 'pool'}</small></div><div class="teams"><div><strong>${game.away}</strong><span>${awayChoice.label}</span></div>${result}<div class="home"><strong>${game.home}</strong><span>${homeChoice.label}</span></div></div><div class="pick-split"><span style="width:${submissions.length ? awayPicks/submissions.length*100 : 50}%"></span></div><div class="pick-counts"><span>${awayPicks} picks</span><span>${homePicks} picks</span></div></article>`;
  }).join('');
}

function renderGradeAudit(week) {
  const target = $('#grade-audit');
  if (!week.submissions.length) {
    target.innerHTML = '<p class="muted empty-audit">No picks yet. Submit a mock entry and return here to inspect its grades.</p>';
    return;
  }
  const headings = week.games.map(game => `<th title="${game.away} @ ${game.home}">${game.away}<br>@ ${game.home}</th>`).join('');
  const rows = week.submissions.map(entry => {
    const cells = week.games.map(game => {
      const grade = entry.grades?.[game.id] || { result: 'pending', points: null };
      const symbol = { win: 'W', loss: 'L', push: 'P', pending: '—', invalid: '!' }[grade.result] || '—';
      const picked = entry.picks[game.id] || '—';
      const score = grade.points == null ? '' : `<small>${points(grade.points)}</small>`;
      return `<td class="grade-${grade.result}" title="${picked}: ${grade.result}"><span>${picked}</span><b>${symbol}</b>${score}</td>`;
    }).join('');
    return `<tr><th>${entry.name}</th>${cells}<td class="grade-total"><strong>${points(entry.points)}</strong></td></tr>`;
  }).join('');
  target.innerHTML = `<table><thead><tr><th>Player</th>${headings}<th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function simulationAction(path, workingMessage) {
  const message = $('#simulation-message');
  message.className = 'simulation-message';
  message.textContent = workingMessage;
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const result = await response.json();
  if (!response.ok) {
    message.classList.add('error-message');
    message.textContent = result.error;
    return;
  }
  location.reload();
}

$('#mock-reset').addEventListener('click', () => simulationAction('/api/simulation/reset-week1', 'Preparing a clean Mock Week 1…'));
$('#mock-finish').addEventListener('click', () => simulationAction('/api/simulation/finish', 'Applying final scores and grading every pick…'));

document.querySelectorAll('.nav-link').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-link,.dashboard-section').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.getElementById(button.dataset.section).classList.add('active');
}));

load().catch(error => { document.body.innerHTML = `<main class="error-card"><h1>Dashboard unavailable</h1><p>${error.message}</p></main>`; });
