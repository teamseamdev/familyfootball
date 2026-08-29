const token = new URLSearchParams(location.search).get('token');
const gameContainer = document.querySelector('#pick-games');
const form = document.querySelector('#pick-form');
const message = document.querySelector('#form-message');
let loadedWeek;

function when(value) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

async function load() {
  if (!token) throw new Error('This pick link is missing its week token.');
  const response = await fetch(`/api/public/week/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error((await response.json()).error || 'This pick link is not active.');
  const week = await response.json();
  loadedWeek = week;
  document.querySelector('#pick-title').textContent = `Week ${week.week} picks`;
  document.querySelector('#pick-note').textContent = `Spreads captured ${when(week.spreadCapturedAt)}. Picks lock ${when(week.picksLockedAt)}.`;
  const submitted = new Set(week.submittedPlayers || []);
  document.querySelector('#player-name').innerHTML = `<option value="">Choose your name</option>${week.players.map(name => `<option value="${name}" ${submitted.has(name) ? 'disabled' : ''}>${name}${submitted.has(name) ? ' — already submitted' : ''}</option>`).join('')}`;
  gameContainer.innerHTML = week.games.map((game, index) => `<fieldset class="pick-game"><legend><span>${String(index + 1).padStart(2, '0')}</span><strong>${game.away} @ ${game.home}</strong><small>${when(game.kickoff)}</small></legend><div class="choice-grid">${game.choices.map(choice => `<label class="pick-choice"><input type="radio" name="${game.id}" value="${choice.team}" required><span><b>${choice.team}</b><small>${choice.label.replace(choice.team, '').trim()}</small></span></label>`).join('')}</div></fieldset>`).join('');
  form.dataset.games = JSON.stringify(week.games.map(game => game.id));
}

form.addEventListener('submit', async event => {
  event.preventDefault(); message.textContent = 'Saving picks…';
  const data = new FormData(form);
  const gameIds = JSON.parse(form.dataset.games || '[]');
  const payload = { name: data.get('name'), picks: Object.fromEntries(gameIds.map(id => [id, data.get(id)])) };
  const response = await fetch(`/api/public/week/${encodeURIComponent(token)}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  message.textContent = result.message || result.error;
  message.className = response.ok ? 'success-message' : 'error-message';
  if (response.ok) {
    localStorage.setItem(`family-pool-submitted-${loadedWeek.season}-${loadedWeek.week}`, String(payload.name));
    form.querySelector('button').disabled = true;
    document.querySelector('#success-overlay').hidden = false;
    setTimeout(() => {
      if (window.opener && !window.opener.closed) {
        window.opener.location.href = '/';
        window.close();
      } else {
        location.assign('/');
      }
    }, 1400);
  }
});

load().catch(error => { gameContainer.innerHTML = `<p class="error-message">${error.message}</p>`; form.querySelector('button').disabled = true; });
