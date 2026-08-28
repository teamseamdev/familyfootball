export class GoogleBridge {
  constructor(config, fetchImpl = fetch) {
    this.url = config.googleBridgeUrl;
    this.secret = config.googleBridgeSecret;
    this.fetch = fetchImpl;
  }

  async call(action, payload = {}) {
    if (!this.url || !this.secret) throw new Error('Google bridge URL and secret are required');
    const response = await this.fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, secret: this.secret, ...payload })
    });
    if (!response.ok) throw new Error(`Google bridge returned ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Google bridge failed');
    return result;
  }

  upsertForm(week) {
    return this.call('upsertForm', {
      season: week.season,
      week: week.week,
      title: `NFL Pool — Week ${week.week}`,
      description: `Spreads captured ${week.spreadCapturedAt}. Choose the team that will cover the listed spread.`,
      games: week.games.map(game => ({ id: game.id, title: `${game.away} @ ${game.home}`, choices: game.choices }))
    });
  }

  responses(season, week) {
    return this.call('getResponses', { season, week });
  }
}
