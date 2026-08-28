import { createBlankState } from './sample-data.js';

export class SupabaseStore {
  constructor({ supabaseUrl, supabaseServiceRoleKey, seedState = createBlankState, fetchImpl = fetch }) {
    if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase storage');
    this.url = supabaseUrl.replace(/\/$/, '');
    this.key = supabaseServiceRoleKey;
    this.seedState = seedState;
    this.fetch = fetchImpl;
  }

  headers(extra = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, 'content-type': 'application/json', ...extra };
  }

  async read() {
    const response = await this.fetch(`${this.url}/rest/v1/pool_state?id=eq.main&select=state`, { headers: this.headers(), cache: 'no-store' });
    if (!response.ok) throw new Error(`Supabase read failed (${response.status}): ${await response.text()}`);
    const rows = await response.json();
    if (rows[0]?.state) return rows[0].state;
    const state = this.seedState();
    await this.write(state);
    return state;
  }

  async write(state) {
    const response = await this.fetch(`${this.url}/rest/v1/pool_state?on_conflict=id`, {
      method: 'POST',
      headers: this.headers({ prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id: 'main', state, updated_at: new Date().toISOString() })
    });
    if (!response.ok) throw new Error(`Supabase write failed (${response.status}): ${await response.text()}`);
    return state;
  }

  async update(mutator) {
    const state = await this.read();
    const result = await mutator(state) ?? state;
    await this.write(state);
    return result;
  }
}
