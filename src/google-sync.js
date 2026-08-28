import crypto from 'node:crypto';
import { standings, validatePicks, weekSnapshot } from './pool.js';

export function mergeGoogleResponses(state, week, responses = []) {
  let changed = 0;
  const players = state.players || [];
  for (const incoming of responses) {
    const name = players.find(player => player.toLowerCase() === String(incoming.name || '').trim().toLowerCase());
    if (!name || validatePicks(week, incoming.picks || {}).length) continue;
    const submission = {
      id: incoming.id || crypto.randomUUID(),
      name,
      submittedAt: incoming.submittedAt || new Date().toISOString(),
      picks: incoming.picks
    };
    const existing = week.submissions.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) {
      if (new Date(submission.submittedAt) < new Date(week.submissions[existing].submittedAt || 0)) continue;
      if (JSON.stringify(week.submissions[existing]) === JSON.stringify(submission)) continue;
      week.submissions[existing] = submission;
    } else {
      week.submissions.push(submission);
    }
    changed += 1;
  }
  return changed;
}

export function sheetPayload(state, week, config) {
  return { ...weekSnapshot(week, config), standings: standings(state, config) };
}
