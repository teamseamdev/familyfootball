function partsAt(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const actual = partsAt(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desiredAsUtc - actualAsUtc;
  }
  return new Date(guess);
}

export function publishTime(firstKickoff, timeZone = 'America/New_York', publishHour = 18) {
  const local = partsAt(new Date(firstKickoff), timeZone);
  const previous = new Date(Date.UTC(local.year, local.month - 1, local.day));
  previous.setUTCDate(previous.getUTCDate() - 1);
  return zonedTimeToUtc({
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
    hour: Number(publishHour)
  }, timeZone);
}

export function timingSummary(week, config) {
  const firstKickoff = [...week.games].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0]?.kickoff;
  if (!firstKickoff) return { firstKickoff: null, publishAt: null };
  return { firstKickoff, publishAt: publishTime(firstKickoff, config.timeZone, config.publishHour).toISOString() };
}
