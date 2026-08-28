import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore } from '../src/supabase-store.js';

test('Supabase storage seeds once and persists the state document', async () => {
  let saved;
  const fakeFetch = async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') {
      return new Response(JSON.stringify(saved ? [{ state: saved }] : []), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    saved = JSON.parse(options.body).state;
    return new Response('', { status: 201 });
  };
  const store = new SupabaseStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceRoleKey: 'server-only-test-key',
    seedState: () => ({ players: ['Moe', 'John', 'Diane', 'Adam'], weeks: {} }),
    fetchImpl: fakeFetch
  });
  const initial = await store.read();
  assert.deepEqual(initial.players, ['Moe', 'John', 'Diane', 'Adam']);
  initial.activeWeek = 2;
  await store.write(initial);
  assert.equal((await store.read()).activeWeek, 2);
});
