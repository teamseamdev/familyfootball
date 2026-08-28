# Family NFL ATS Pool — local prototype

This is a working, dependency-free Node.js prototype for the annual family against-the-spread pool. It runs locally with sample data, and its live integrations are isolated behind small adapters so the pool math and dashboard can be tested before any paid account or Google credentials are added.

For the free production architecture using GitHub, Vercel, and Supabase, see `DEPLOYMENT.md`. For the familiar Google Form and original-style weekly Sheet workflow, see `GOOGLE_SETUP.md`.

## What works now

- ESPN weekly NFL schedule and spread ingestion. The adapter was live-tested against 2026 Week 1: 16 games and 16 spreads were returned.
- A sample provider for offline testing and a manual JSON provider for emergency line entry.
- Chronological slates with choices such as `DEN +3` and `BUF -3`.
- A short pool route such as `/p/w8-family`, which redirects to the active local or Google form.
- A mobile-friendly local picks form, including required name and required selection for every game.
- A fixed four-person selector for Moe, John, Diane, and Adam, preventing duplicate name spellings.
- Local JSON response storage as the no-credential substitute for Google Sheets.
- Optional Supabase persistence for Vercel deployments.
- A two-way Google Apps Script bridge that creates/updates the weekly Google Form and original-style `WK#` Sheet, mirrors Form responses into the dashboard, and writes grades/totals back to Google Sheets.
- Picks lock automatically at the first kickoff.
- ATS grading for completed games: win = 1, loss = 0, push = 0.
- Automatic ESPN score polling every five minutes after kickoff, with totals recalculated immediately.
- Weekly standings, season totals, leaderboard, trends, current-week cards, game results, and pick splits.
- A clean selections-only SVG/PNG pick sheet with no scores or grades.
- Week rollover after all ESPN games are final. The new slate is prepared, then spreads are refreshed again at publish time.
- A scheduler that publishes at 6:00 PM in `America/New_York` on the calendar day before the first kickoff.
- Modular notifications: console preview by default and a Twilio SMS adapter when credentials are supplied.
- Passcode-protected dashboard and separate admin-key protection for automation routes.

## Run the demo

Requirements: Node.js 20 or newer. No package installation is required.

```powershell
cd "C:\Users\jmini\OneDrive\Desktop\WebApps\familyfootball"
npm run demo:reset
npm test
npm start
```

Open `http://localhost:4173` and use the demo passcode `family-demo`.

The demo uses a partially completed 2025 Week 8 with the four canonical entrants: Moe, John, Diane, and Adam. `npm run demo:reset` restores it after testing.

For an interactive first-week accuracy check, run `npm run mock:reset`. Open Setup → Mock the first week, submit picks through the mock form, then choose **Simulate final scores**. The Pick sheet section includes a separate grading-audit table showing every W, L, push, and point value while keeping the shareable pick-sheet image results-free.

## How the weekly automation flows

1. After the previous week becomes final, the app creates the next week from ESPN.
2. At 6 PM Eastern on the day before the first kickoff, it fetches ESPN again. This second fetch is the official spread snapshot used on the form.
3. If any ESPN line is missing, publishing stops and reports the matchup instead of silently creating a broken form.
4. The app creates or updates the selected form provider, generates the short pool link, and sends a notification through the selected SMS provider.
5. Picks lock at first kickoff. The selections-only image is then ready for the group chat.
6. ESPN scores refresh every five minutes. Grading, weekly totals, and season standings update from the stored spread snapshot.
7. When every game is final, the next week is prepared automatically.

The server must stay running for its built-in scheduler to fire. A hosted deployment or an always-on home computer is required for production reliability.

## Google Forms and Sheets setup

Follow `GOOGLE_SETUP.md`. The supplied Apps Script bridge preserves the screenshot's C:E game area, G/I/K/M pick columns, H/J/L/N result columns, weekly totals, and overall totals. It also keeps Google's raw Form Responses tab as another backup.

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
| `dashboardPasscode` | Shared family passcode for private stats. |
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
- The dashboard, matchup view, short redirect, weekly pick form, and selections-only pick sheet were checked in the local browser.
- `npm test` currently passes all four tests.

## Still needed from the pool organizer

1. **Google access:** the example Sheet currently returns “You need access” to the available Google account. Grant viewer access if exact tab layout, names, formulas, and historical data should be migrated. The example Form was inspectable and is reflected in this prototype.
2. **Push rule:** confirmed—an exact ATS push is recorded as a push and awards 0 points.
3. **Spread display:** confirm whether both sides should always show their number (`DEN +3 / BUF -3`) or whether the underdog should sometimes appear without a number, as in the supplied playoff Form.
4. **Entrants:** the canonical players are Moe, John, Diane, and Adam. Their existing weekly-sheet columns are G, I, K, and M respectively; provide any accepted aliases if needed.
5. **Google destination:** choose the production Sheet and decide whether to reuse it or create a new season workbook.
6. **Hosting:** choose an always-on home computer, a private server, or a cloud host and provide the final HTTPS domain. Localhost links cannot be opened by family members on other phones.
7. **Texting:** choose Twilio or another SMS provider and provide its credentials, sending number, and organizer number. The current module texts only the organizer, matching the described workflow.
8. **Dashboard privacy:** choose the family passcode; for stronger privacy, decide whether individual Google sign-in should replace the shared passcode.
9. **Season behavior:** confirm playoff weeks, whether late/missed entries receive zero, and whether picks may be corrected before kickoff. The prototype lets a same-name submission replace its earlier entry before lock.
10. **ESPN backup:** ESPN works today but the JSON endpoint is not a contracted data feed. Choose a licensed odds provider if guaranteed uptime or auditability is important.

## Important prototype limits

- ESPN’s JSON response is technically feasible and live-tested, but it is an undocumented public endpoint and can change.
- The local JSON file is a test substitute, not a multi-user production database.
- The shared dashboard passcode is appropriate for a family prototype, not high-security data.
- Google’s Apps Script bridge is designed for the user’s own account and must be deployed by that account.
- Sample fallback data is intentionally obvious and must be disabled for a real week.
