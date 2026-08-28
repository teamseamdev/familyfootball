import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/memory-store.js';

test('memory preview storage accepts writes without mutating returned snapshots', async () => {
  const store = new MemoryStore({ activeWeek: 1, players: ['Moe'] });
  const first = await store.read();
  first.activeWeek = 2;
  assert.equal((await store.read()).activeWeek, 1);
  await store.write(first);
  assert.equal((await store.read()).activeWeek, 2);
});
