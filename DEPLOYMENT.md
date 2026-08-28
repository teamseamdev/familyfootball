# Free GitHub + Vercel deployment

## Recommended architecture

- **GitHub:** stores the code and triggers deployments.
- **Vercel Hobby:** hosts the private dashboard, short pick links, mobile pick form, and API.
- **Supabase Free:** stores the season permanently and invokes the scheduler every five minutes.
- **ESPN:** supplies the schedule, captured spreads, and completed scores.

This remains event-driven rather than keeping a paid server running continuously. Supabase wakes the Vercel API every five minutes; most checks immediately return without changing anything.

Before Supabase is connected, Vercel may be deployed with `POOL_STORAGE_PROVIDER=memory` for a clearly labeled visual preview. That mode is intentionally temporary and does not guarantee that submitted picks survive a cold start.

Vercel Hobby cron is not used because it only supports daily jobs and may run up to 59 minutes late. Relevant official documentation:

- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/pricing

At five-minute intervals, the scheduler makes about 105,120 checks per year. That is below the currently published Supabase Free allowance of 500,000 Edge Function invocations and Vercel Hobby allowance of 1,000,000 Function invocations. Free-tier policies can change, so recheck them before each season.

## 1. Create the Supabase project

1. Create a free project at https://supabase.com/dashboard.
2. Open **SQL Editor** and run `supabase/migrations/001_pool_state.sql` from this repository.
3. From **Project Settings → API**, record:
   - Project URL
   - `service_role` key
4. Never expose the service-role key in browser JavaScript or commit it to GitHub. It belongs only in Vercel’s encrypted environment settings.

The database begins empty. The server creates a clean season containing Moe, John, Diane, and Adam on its first read.

## 2. Put the code on GitHub

Create an empty private repository, then run these commands from the project folder:

```powershell
git init
git add .
git commit -m "Initial family football pool"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/familyfootball.git
git push -u origin main
```

The included `.gitignore` excludes local picks, local secrets, and Vercel metadata.

## 3. Import the repository into Vercel

1. At https://vercel.com/new, import the GitHub repository.
2. Keep the root directory as the repository root.
3. Add these environment variables to Production, Preview, and Development where appropriate:

| Variable | Value |
|---|---|
| `POOL_BASE_URL` | Final Vercel URL, such as `https://familyfootball.vercel.app` |
| `POOL_TIME_ZONE` | `America/New_York` |
| `POOL_PASSCODE` | Family dashboard passcode |
| `POOL_ADMIN_KEY` | Long random server/scheduler secret |
| `POOL_STORAGE_PROVIDER` | `supabase` |
| `POOL_SCHEDULE_PROVIDER` | `espn` |
| `POOL_FALLBACK_PROVIDER` | Leave blank in production |
| `POOL_SMS_PROVIDER` | `console` until SMS is configured |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; server only |

4. Deploy. Vercel reads `vercel.json` and sends all app routes through the included Node function.
5. If the first deployment receives a generated URL different from `POOL_BASE_URL`, update that variable and redeploy once.

## 4. Deploy the free scheduler

Install the Supabase CLI or use its documented GitHub Action. From this repository:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set POOL_APP_URL=https://YOUR-PROJECT.vercel.app
supabase secrets set POOL_ADMIN_KEY=THE_SAME_ADMIN_KEY_USED_IN_VERCEL
supabase functions deploy pool-tick
```

In the Supabase dashboard, open **Integrations → Cron** and schedule the `pool-tick` Edge Function with:

```text
*/5 * * * *
```

Supabase records each run so failures can be checked from the dashboard. The app’s scheduler is idempotent: repeated calls do nothing until a publish or score-refresh action is actually due.

## 5. Create the first live week

After deployment, ingest the NFL slate once using the protected admin endpoint. Replace the URL, key, season, and week:

```powershell
$headers = @{ 'x-admin-key' = 'YOUR_ADMIN_KEY' }
$body = @{ season = 2026; week = 1; provider = 'espn' } | ConvertTo-Json
Invoke-RestMethod -Uri 'https://YOUR-PROJECT.vercel.app/api/admin/ingest' -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```

The scheduler will refresh the ESPN lines and publish the short picks link at 6 PM Eastern on the day before the first kickoff. To test immediately without sending SMS:

```powershell
$body = @{ week = 1; notify = $false } | ConvertTo-Json
Invoke-RestMethod -Uri 'https://YOUR-PROJECT.vercel.app/api/admin/publish' -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```

## Free-tier caveats

- Vercel Hobby is for personal, non-commercial projects.
- Supabase Free currently lists project pausing after inactivity. The scheduled job should generate regular activity during the season, but monitor the project before Week 1.
- ESPN’s endpoint is not a contracted odds feed. Publishing stops if a spread is missing instead of substituting fake data.
- No real SMS is sent until a provider is configured. The short link remains available from the dashboard.
