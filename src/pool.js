export function signedSpread(value) {
  const numeric = Number(value);
  if (numeric === 0) return 'PK';
  return `${numeric > 0 ? '+' : ''}${Number.isInteger(numeric) ? numeric : numeric.toFixed(1)}`;
}

export function gameChoices(game) {
  const home = Number(game.homeSpread);
  const away = -home;
  return [
    { team: game.away, label: away === 0 ? `${game.away} PK` : `${game.away} ${signedSpread(away)}` },
    { team: game.home, label: home === 0 ? `${game.home} PK` : `${game.home} ${signedSpread(home)}` }
  ];
}

export function chronological(games) {
  return [...games].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.id.localeCompare(b.id));
}

export function gameAtsOutcome(game) {
  if (game.status !== 'final' || game.awayScore == null || game.homeScore == null) return { result: 'pending', team: null };
  if (!Number.isInteger(Number(game.awayScore)) || !Number.isInteger(Number(game.homeScore))) return { result: 'invalid', team: null };
  const homeMargin = Number(game.homeScore) - Number(game.awayScore);
  const coverThreshold = -Number(game.homeSpread);
  if (homeMargin === coverThreshold) return { result: 'push', team: null };
  return { result: 'winner', team: homeMargin > coverThreshold ? game.home : game.away };
}

export function gradePick(game, team, pushPoints = 0) {
  const outcome = gameAtsOutcome(game);
  if (outcome.result === 'pending') return { result: 'pending', points: null };
  if (outcome.result === 'invalid') return { result: 'invalid', points: 0 };
  if (team !== game.away && team !== game.home) return { result: 'invalid', points: 0 };
  if (outcome.result === 'push') return { result: 'push', points: Number(pushPoints) };
  return outcome.team === team ? { result: 'win', points: 1 } : { result: 'loss', points: 0 };
}

export function gradeSubmission(week, submission, pushPoints = 0) {
  const grades = {};
  let points = 0;
  let decided = 0;
  for (const game of chronological(week.games)) {
    const grade = gradePick(game, submission.picks[game.id], pushPoints);
    grades[game.id] = grade;
    if (grade.points != null) {
      points += grade.points;
      decided += 1;
    }
  }
  return { grades, points, decided };
}

export function weekSnapshot(week, config = {}) {
  const pushPoints = config.pushPoints ?? 0;
  const games = chronological(week.games).map(game => ({ ...game, choices: gameChoices(game), atsOutcome: gameAtsOutcome(game) }));
  const submissions = week.submissions.map(submission => ({
    ...submission,
    ...gradeSubmission(week, submission, pushPoints)
  }));
  return { ...week, games, submissions };
}

export function standings(state, config = {}) {
  const names = new Set(state.players || []);
  for (const week of Object.values(state.weeks || {})) {
    for (const submission of week.submissions || []) names.add(submission.name);
  }
  const rows = [...names].map(name => {
    const history = [...(state.history?.[name] || [])];
    const weekly = [];
    let decided = history.length * 16;
    const orderedWeeks = Object.values(state.weeks || {}).sort((a, b) => Number(a.week) - Number(b.week));
    for (const week of orderedWeeks) {
      const submission = week.submissions?.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (!submission) continue;
      const grade = gradeSubmission(week, submission, config.pushPoints ?? 0);
      decided += grade.decided;
      if (grade.decided) weekly.push({ week: Number(week.week), points: grade.points });
    }
    const activeScore = weekly.find(item => item.week === Number(state.activeWeek));
    const current = activeScore?.points || 0;
    const total = history.reduce((sum, value) => sum + value, 0) + weekly.reduce((sum, item) => sum + item.points, 0);
    const possible = decided;
    return {
      name,
      total,
      current,
      weeksPlayed: history.length + weekly.length,
      winRate: possible ? total / possible : 0,
      trend: [...history, ...weekly.map(item => item.points)]
    };
  });
  rows.sort((a, b) => b.total - a.total || b.current - a.current || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function overallTotalsThroughWeek(state, throughWeek, config = {}) {
  const names = new Set(state.players || []);
  const totals = {};
  for (const name of names) totals[name] = (state.history?.[name] || []).reduce((sum, value) => sum + Number(value || 0), 0);
  const weeks = Object.values(state.weeks || {}).filter(week => Number(week.week) <= Number(throughWeek));
  for (const week of weeks) {
    for (const submission of week.submissions || []) {
      totals[submission.name] = Number(totals[submission.name] || 0) + gradeSubmission(week, submission, config.pushPoints ?? 0).points;
    }
  }
  return totals;
}

export function picksAreRevealed(week, players = [], now = new Date()) {
  const submitted = new Set((week.submissions || []).map(item => item.name.toLowerCase()));
  const allSubmitted = players.length > 0 && players.every(name => submitted.has(name.toLowerCase()));
  const kickoffReached = Boolean(week.picksLockedAt) && now >= new Date(week.picksLockedAt);
  const gameStarted = week.status === 'live' || week.status === 'final' || (week.games || []).some(game => game.status === 'live' || game.status === 'final');
  return allSubmitted || kickoffReached || gameStarted;
}

export function validatePicks(week, picks) {
  const errors = [];
  for (const game of week.games) {
    if (!picks[game.id]) errors.push(`Missing pick for ${game.away} @ ${game.home}`);
    else if (![game.away, game.home].includes(picks[game.id])) errors.push(`Invalid pick for ${game.away} @ ${game.home}`);
  }
  return errors;
}
