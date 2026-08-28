const token = new URLSearchParams(location.search).get('token');
const gameContainer = document.querySelector('#pick-games');
const form = document.querySelector('#pick-form');
const message = document.querySelector('#form-message');

function when(value) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

async function load() {
  if (!token) throw new Error('This pick link is missing its week token.');
  const response = await fetch(`/api/public/week/${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error((await response.json()).error || 'This pick link is not active.');
  const week = await response.json();
  document.querySelector('#pick-title').textContent = `Week ${week.week} picks`;
  document.querySelector('#pick-note').textContent = `Spreads captured ${when(week.spreadCapturedAt)}. Picks lock ${when(week.picksLockedAt)}.`;
  document.querySelector('#player-name').innerHTML = `<option value="">Choose your name</option>${week.players.map(name => `<option value="${name}">${name}</option>`).join('')}`;
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
  if (response.ok) message.textContent += ' You can change the name and submit another player.';
});

load().catch(error => { gameContainer.innerHTML = `<p class="error-message">${error.message}</p>`; form.querySelector('button').disabled = true; });
