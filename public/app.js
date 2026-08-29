const $ = selector => document.querySelector(selector);
const colors = ['#7FE0B7', '#FFB35B', '#6EC7FF', '#E88CFF', '#FFE16B', '#FF7D86'];

function points(value) { return Number.isInteger(value) ? value : Number(value || 0).toFixed(1); }
function localDate(value, options = {}) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(new Date(value)); }
function submittedKey(week) { return `family-pool-submitted-${week.season}-${week.week}`; }
function playerColor(name, players = []) { const index = players.findIndex(player => player.toLowerCase() === name.toLowerCase()); return colors[(index < 0 ? 0 : index) % colors.length]; }

async function load() {
  const [weekResponse, standingsResponse] = await Promise.all([fetch('/api/week'), fetch('/api/standings')]);
  if (!weekResponse.ok || !standingsResponse.ok) throw new Error('Dashboard data could not be loaded.');
  const week = await weekResponse.json();
  const season = await standingsResponse.json();
  render(week, season);
  populateWeekSelector(season.weeks, week.week);
  renderWeekRecords(week);
}

function render(week, season) {
  const environmentBanner = $('#environment-banner');
  if (week.poolMode === 'test') {
    environmentBanner.hidden = false;
    environmentBanner.innerHTML = '<strong>Test season active</strong><span>These picks are stored in Supabase, but they are not the live family season.</span>';
  } else if (week.storageMode === 'memory') {
    environmentBanner.hidden = false;
    environmentBanner.innerHTML = '<strong>Live preview mode</strong><span>Picks may reset between visits until Supabase storage is connected.</span>';
  }
  $('#season-label').textContent = `${season.season} NFL SEASON`;
  $('#summary-week').textContent = `Week ${season.activeWeek}`;
  $('#week-status').textContent = week.picksRevealed ? `${week.status.toUpperCase()} • ${week.submissions.length} entries` : `${week.status.toUpperCase()} • PICKS HIDDEN`;
  $('#week-pill').textContent = `Through Week ${season.activeWeek}`;
  $('#week-heading').textContent = `Week ${week.week} matchups`;
  $('#mock-form').href = week.shareUrl || '#';
  $('#test-heading').textContent = week.poolMode === 'test' ? `Test Week ${week.week}` : 'Test the season flow';
  $('#mock-finish').disabled = week.poolMode !== 'test' || week.status === 'final' || !week.canSimulate;
  $('#mock-next').disabled = week.poolMode !== 'test' || week.status !== 'final';
  $('#publish-time').textContent = week.timing.publishAt ? localDate(week.timing.publishAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Waiting for slate';

  const pickLink = $('#top-pick-link');
  const submittedHere = localStorage.getItem(submittedKey(week));
  const formOpen = week.acceptingSubmissions && week.shareUrl;
  pickLink.href = week.shareUrl || '#';
  pickLink.hidden = !formOpen || Boolean(submittedHere);
  $('#mock-form').hidden = !formOpen || Boolean(submittedHere);

  const leader = season.standings[0];
  const finalGames = week.games.filter(game => game.status === 'final').length;
  const totalPicks = week.submissions.length * week.games.length;
  $('#stat-grid').innerHTML = [
    ['Current leader', leader?.name || '—', `${points(leader?.total || 0)} season points`, 'leader'],
    ['Week progress', `${finalGames}/${week.games.length}`, 'games graded', 'progress'],
    ['Entries', week.picksRevealed ? week.submissions.length : 'Hidden', week.picksRevealed ? `${totalPicks} picks on file` : 'Reveals when complete or at kickoff', 'entries'],
    ['Next kickoff', nextKickoff(week.games), nextMatchup(week.games), 'kickoff']
  ].map(([label, value, note, cls]) => `<article class="stat-card ${cls}"><p>${label}</p><strong>${value}</strong><span>${note}</span></article>`).join('');

  $('#leaderboard').classList.remove('skeleton');
  $('#leaderboard').innerHTML = season.standings.map((row, index) => `<div class="leader-row ${index === 0 ? 'first' : ''}"><span class="rank">${row.rank}</span><span class="avatar" style="--avatar:${playerColor(row.name, week.players)}">${row.name.slice(0, 1)}</span><span class="player-name">${row.name}<small>${row.weeksPlayed} weeks played</small></span><span class="week-score">+${points(row.current)}<small>this week</small></span><strong>${points(row.total)}<small>PTS</small></strong></div>`).join('');
  renderTrend(season.standings, week.players);
  renderSubmissionStatus(week);
  renderGames(week.games, week.submissions, week.players, week.picksRevealed);
}

function nextKickoff(games) {
  const next = games.find(game => game.status !== 'final');
  return next ? localDate(next.kickoff, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Complete';
}
function nextMatchup(games) { const next = games.find(game => game.status !== 'final'); return next ? `${next.away} @ ${next.home}` : 'All games final'; }

function renderTrend(rows, players) {
  const shown = rows.slice(0, 4);
  const width = 640, height = 280, pad = 28;
  const cumulative = shown.map(row => row.trend.reduce((acc, value) => [...acc, (acc.at(-1) || 0) + value], []));
  const max = Math.max(...cumulative.flat(), 1);
  const paths = cumulative.map((values, index) => {
    const line = values.map((value, i) => `${pad + i * ((width - pad * 2) / Math.max(values.length - 1, 1))},${height - pad - value / max * (height - pad * 2)}`).join(' ');
    return `<polyline points="${line}" fill="none" stroke="${playerColor(shown[index].name, players)}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const grid = [0, .25, .5, .75, 1].map(level => `<line x1="${pad}" y1="${height - pad - level * (height-pad*2)}" x2="${width-pad}" y2="${height-pad-level*(height-pad*2)}" stroke="#24434e" stroke-width="1"/>`).join('');
  $('#trend-chart').classList.remove('skeleton');
  $('#trend-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative season point trends">${grid}${paths}</svg>`;
  $('#trend-legend').innerHTML = shown.map(row => `<span><i style="background:${playerColor(row.name, players)}"></i>${row.name}</span>`).join('');
}

function renderSubmissionStatus(week) {
  const pending = week.pendingPlayers || [];
  const target = $('#submission-status');
  if (!pending.length) {
    target.innerHTML = '<strong>Everyone is in</strong><span>All four weekly submissions have been received.</span>';
    target.classList.add('complete');
    return;
  }
  target.classList.remove('complete');
  target.innerHTML = `<strong>Still waiting on</strong><span>${pending.map(name => `<i style="--avatar:${playerColor(name, week.players)}">${name.slice(0, 1)}</i>${name}`).join('')}</span>`;
}

function renderGames(games, submissions, players, picksVisible) {
  $('#games').innerHTML = games.map(game => {
    const awayChoice = game.choices[0], homeChoice = game.choices[1];
    const awayPicks = submissions.filter(item => item.picks[game.id] === game.away);
    const homePicks = submissions.filter(item => item.picks[game.id] === game.home);
    const awayArrow = game.atsOutcome?.result === 'winner' && game.atsOutcome.team === game.away ? '<i class="winner-arrow away" title="ATS winner" aria-label="ATS winner">←</i>' : '';
    const homeArrow = game.atsOutcome?.result === 'winner' && game.atsOutcome.team === game.home ? '<i class="winner-arrow home" title="ATS winner" aria-label="ATS winner">→</i>' : '';
    const push = game.atsOutcome?.result === 'push' ? '<small class="push-label">PUSH</small>' : '';
    const result = game.status === 'final' ? `<div class="game-result">${push}<div class="game-score"><strong>${game.awayScore}</strong><span>FINAL</span><strong>${game.homeScore}</strong></div></div>` : `<div class="game-time">${localDate(game.kickoff, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>`;
    const marker = entry => `<span class="pick-avatar" style="--avatar:${playerColor(entry.name, players)}" title="${entry.name}" aria-label="${entry.name}">${entry.name.slice(0, 1)}</span>`;
    const pickDisplay = picksVisible ? `<div class="team-picks"><div>${awayPicks.map(marker).join('')}</div><div>${homePicks.map(marker).join('')}</div></div>` : '<div class="picks-hidden">Selections hidden until all four entries are in or kickoff begins.</div>';
    return `<article class="game-card"><div class="game-top"><span>${game.status}</span><small>${game.source || 'pool'}</small></div><div class="teams"><div><strong>${game.away}${awayArrow}</strong><span>${awayChoice.label}</span></div>${result}<div class="home"><strong>${homeArrow}${game.home}</strong><span>${homeChoice.label}</span></div></div>${pickDisplay}</article>`;
  }).join('');
}

function populateWeekSelector(weeks, selectedWeek) {
  const selector = $('#records-week');
  selector.innerHTML = weeks.map(item => `<option value="${item.week}" ${Number(item.week) === Number(selectedWeek) ? 'selected' : ''}>Week ${item.week} • ${item.status}</option>`).join('');
}

function renderWeekRecords(week) {
  $('#records-heading').textContent = `Week ${week.week} standings`;
  const target = $('#week-records');
  if (!week.picksRevealed) {
    target.innerHTML = '<p class="picks-hidden standings-hidden">Selections and weekly results will appear after all four entries are in or kickoff begins.</p>';
    return;
  }
  const headings = week.games.map(game => `<th title="${game.away} @ ${game.home}">${game.away}<br>@ ${game.home}</th>`).join('');
  const byName = new Map(week.submissions.map(entry => [entry.name, entry]));
  const players = week.players || [...byName.keys()];
  const showOverall = Number(week.week) > 1;
  const rows = players.map(name => {
    const entry = byName.get(name);
    const cells = week.games.map(game => {
      if (!entry) return '<td class="grade-pending"><span>—</span><b>—</b></td>';
      const grade = entry.grades?.[game.id] || { result: 'pending', points: null };
      const symbol = { win: 'W', loss: 'L', push: 'P', pending: '—', invalid: '!' }[grade.result] || '—';
      const score = grade.points == null ? '' : `<small>${points(grade.points)}</small>`;
      return `<td class="grade-${grade.result}" title="${entry.picks[game.id]}: ${grade.result}"><span>${entry.picks[game.id]}</span><b>${symbol}</b>${score}</td>`;
    }).join('');
    const overall = showOverall ? `<td class="grade-total overall-total"><strong>${points(week.overallTotals?.[name] || 0)}</strong></td>` : '';
    return `<tr><th>${name}</th>${overall}<td class="grade-total"><strong>${entry ? points(entry.points) : '—'}</strong></td>${cells}</tr>`;
  }).join('');
  const overallHeading = showOverall ? '<th>Overall wins</th>' : '';
  target.innerHTML = `<table><thead><tr><th>Player</th>${overallHeading}<th>Weekly wins</th>${headings}</tr></thead><tbody>${rows}</tbody></table>`;
}

$('#records-week').addEventListener('change', async event => {
  const response = await fetch(`/api/week?week=${encodeURIComponent(event.target.value)}`);
  if (!response.ok) return;
  renderWeekRecords(await response.json());
});

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

$('#mock-reset').addEventListener('click', () => {
  if (confirm('Start the test season over? This clears every existing test week and its picks.')) simulationAction('/api/simulation/reset-season', 'Preparing a clean Test Week 1…');
});
$('#mock-finish').addEventListener('click', () => simulationAction('/api/simulation/finish', 'Applying final scores and grading every pick…'));
$('#mock-next').addEventListener('click', () => simulationAction('/api/simulation/next-week', 'Opening the next test week while keeping the standings…'));

document.querySelectorAll('.nav-link').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-link,.dashboard-section').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.getElementById(button.dataset.section).classList.add('active');
}));

if (location.pathname.replace(/\/$/, '') === '/setup') {
  document.querySelectorAll('.nav-link,.dashboard-section').forEach(item => item.classList.remove('active'));
  $('#setup').classList.add('active');
  document.title = 'Family Pool Setup';
}

load().catch(error => { document.body.innerHTML = `<main class="error-card"><h1>Dashboard unavailable</h1><p>${error.message}</p></main>`; });
