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

export function gradePick(game, team, pushPoints = 0) {
  if (game.status !== 'final' || game.awayScore == null || game.homeScore == null) {
    return { result: 'pending', points: null };
  }
  if (team !== game.away && team !== game.home) return { result: 'invalid', points: 0 };
  const homeMargin = Number(game.homeScore) - Number(game.awayScore);
  const coverThreshold = -Number(game.homeSpread);
  if (homeMargin === coverThreshold) return { result: 'push', points: Number(pushPoints) };
  const coveringTeam = homeMargin > coverThreshold ? game.home : game.away;
  return coveringTeam === team ? { result: 'win', points: 1 } : { result: 'loss', points: 0 };
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
  const games = chronological(week.games).map(game => ({ ...game, choices: gameChoices(game) }));
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
    let current = 0;
    let decided = 0;
    for (const week of Object.values(state.weeks || {})) {
      const submission = week.submissions?.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (!submission) continue;
      const grade = gradeSubmission(week, submission, config.pushPoints ?? 0);
      current += grade.points;
      decided += grade.decided;
    }
    const total = history.reduce((sum, value) => sum + value, 0) + current;
    const possible = history.length * 16 + decided;
    return {
      name,
      total,
      current,
      weeksPlayed: history.length + (decided ? 1 : 0),
      winRate: possible ? total / possible : 0,
      trend: [...history, current]
    };
  });
  rows.sort((a, b) => b.total - a.total || b.current - a.current || a.name.localeCompare(b.name));
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function validatePicks(week, picks) {
  const errors = [];
  for (const game of week.games) {
    if (!picks[game.id]) errors.push(`Missing pick for ${game.away} @ ${game.home}`);
    else if (![game.away, game.home].includes(picks[game.id])) errors.push(`Invalid pick for ${game.away} @ ${game.home}`);
  }
  return errors;
}
