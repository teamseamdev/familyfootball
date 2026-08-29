# Family NFL ATS Pool — local prototype

This is a working, dependency-free Node.js app for the annual family against-the-spread pool. The production version runs on Vercel, stores the season in Supabase, and uses its own mobile picks form.

For the free production architecture using GitHub, Vercel, and Supabase, see `DEPLOYMENT.md`.

## What works now

- ESPN weekly NFL schedule and spread ingestion. The adapter was live-tested against 2026 Week 1: 16 games and 16 spreads were returned.
- A sample provider for offline testing and a manual JSON provider for emergency line entry.
- Chronological slates with choices such as `DEN +3` and `BUF -3`.
- A short pool route such as `/p/w8-family`, which opens the app's active pick form.
- A mobile-friendly picks form with a dashboard button, success confirmation, and automatic return after submission.
- A fixed four-person selector for Moe, John, Diane, and Adam, preventing duplicate name spellings.
- Local JSON response storage for offline development.
- Supabase persistence for the hosted family season.
- First-submission-only enforcement for each player in each week.
- Picks lock automatically at the first kickoff.
- ATS grading for completed games: win = 1, loss = 0, push = 0.
- Automatic ESPN score polling every five minutes after kickoff, with totals recalculated immediately.
- Weekly standings, season totals, leaderboard, trends, current-week cards, game results, and pick splits.
- Week-selectable standings records with each weekly total shown before the individual pick results.
- Week rollover after all ESPN games are final. The new slate is prepared, then spreads are refreshed again at publish time.
- A scheduler that publishes at 6:00 PM in `America/New_York` on the calendar day before the first kickoff.
- Modular notifications: console preview by default and a Twilio SMS adapter when credentials are supplied.
- Family dashboard with separate admin-key protection for automation routes.

## Run the demo

Requirements: Node.js 20 or newer. No package installation is required.

```powershell
cd "C:\Users\jmini\OneDrive\Desktop\WebApps\familyfootball"
npm run demo:reset
npm test
npm start
```

Open `http://localhost:4173`.

The demo uses a partially completed 2025 Week 8 with the four canonical entrants: Moe, John, Diane, and Adam. `npm run demo:reset` restores it after testing.

For an interactive multi-week accuracy check, open Setup → **Start over at Week 1**. Have two or more people submit the app form, simulate that week, and open the next test week. Every test week stays in Supabase so the leaderboard, weeks played, and season trend can be verified before resetting for the live season.

## How the weekly automation flows

1. After the previous week becomes final, the app creates the next week from ESPN.
2. At 6 PM Eastern on the day before the first kickoff, it fetches ESPN again. This second fetch is the official spread snapshot used on the form.
3. If any ESPN line is missing, publishing stops and reports the matchup instead of silently creating a broken form.
4. The app publishes its mobile pick form, generates the short pool link, and sends a notification through the selected SMS provider.
5. Picks lock at first kickoff, and only each player’s first submission is accepted.
6. ESPN scores refresh every five minutes. Grading, weekly totals, and season standings update from the stored spread snapshot.
7. When every game is final, the next week is prepared automatically.

The server must stay running for its built-in scheduler to fire. A hosted deployment or an always-on home computer is required for production reliability.

## SMS setup

Console preview mode is fully functional without credentials. To send a real text to the pool organizer, set `smsProvider` to `twilio` and provide:

- `twilioAccountSid`
- `twilioAuthToken`
- `twilioFrom` (the Twilio number)
- `smsTo` (the organizer’s mobile number)

These can be stored in `config/local.json`, but environment variables are safer for a hosted deployment: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, and `POOL_SMS_TO`.

## Configuration

Copy `config/local.example.json` to `config/local.json`. Important settings:

| Setting | Purpose |
|---|---|
| `baseUrl` | Public HTTPS origin used in the short link; localhost only works on the same computer. |
| `timeZone` | Pool scheduling zone; default is `America/New_York`. |
| `publishHour` | Local hour for publishing; default is 18 (6 PM). |
| `scheduleProvider` | `espn`, `manual`, or `sample`. ESPN supplies both schedule and spread. |
| `fallbackProvider` | `sample` for demos or blank in production. Never use sample fallback for real picks. |
| `pushPoints` | Points awarded on an ATS push; this pool uses 0. |
| `scoreRefreshMinutes` | ESPN result polling interval after kickoff. |
| `autoRollover` | Creates the next week after all current games are final. |
| `adminKey` | Secret header used by ingestion, publishing, result, and rollover routes. |

Every setting also supports the environment-variable form shown in `src/config.js`.

## Manual emergency slate

If ESPN is unavailable, post a checked slate to `/api/admin/ingest` with header `x-admin-key`. Each game needs `id`, `kickoff` (ISO timestamp), `away`, `home`, and `homeSpread`. A negative home spread means the home team is favored.

```json
{
  "season": 2026,
  "week": 3,
  "provider": "manual",
  "games": [
    {
      "id": "2026-w3-den-buf",
      "kickoff": "2026-09-25T00:15:00Z",
      "away": "DEN",
      "home": "BUF",
      "homeSpread": -3,
      "status": "scheduled",
      "awayScore": null,
      "homeScore": null,
      "source": "manual"
    }
  ]
}
```

## Tests and verification completed

- Unit tests cover spread labels, favorites, underdogs, pushes, tied games, and Eastern-time scheduling across daylight-saving changes.
- An end-to-end test creates a future week, loads its public form, submits an entrant, posts a final score, verifies ATS grading, and verifies season standings.
- The dashboard, matchup view, short redirect, weekly pick form, and week-selectable standings were checked in the local browser.
- `npm test` covers ten unit and end-to-end flows.

## Still needed before the live season

1. Complete the multi-week Supabase test with at least two players.
2. Confirm whether the four live names remain Moe, John, Diane, and Adam.
3. Choose whether to enable real SMS delivery. Console notification mode remains free.
4. Decide when the test season should be cleared and the real ESPN Week 1 slate loaded.

## Important prototype limits

- ESPN’s JSON response is technically feasible and live-tested, but it is an undocumented public endpoint and can change.
- The local JSON file is a test substitute, not a multi-user production database.
- Sample fallback data is intentionally obvious and must be disabled for a real week.
