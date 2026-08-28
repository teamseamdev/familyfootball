# Google Form + original weekly Sheet setup

This is the family-facing workflow. The app remains the dashboard and grading engine, while Google Forms and Google Sheets provide the familiar entry method and a separate backup.

## What happens each week

1. The app gets the NFL schedule and spreads from ESPN.
2. At 6 PM Eastern on the day before the first game, it creates or updates both `WK#` in Google Sheets and that week's Google Form.
3. Moe, John, Diane, and Adam submit the Google Form. Each submission immediately fills the correct player column in `WK#`; Google also retains its normal raw Form Responses tab.
4. The hosted app checks the Form every five minutes and mirrors the latest valid submission for each player into Supabase and the private dashboard.
5. After games finish, the app grades ATS picks. Wins are 1; losses and pushes are 0. It writes those values back to H/J/L/N, updates row 24, and updates the season totals block.
6. The app creates the next week, and the same cycle repeats.

## One-time setup in the Google account that owns the Sheet

1. Make a new season copy of the old workbook so the historical workbook remains untouched.
2. In the new workbook, copy the best-looking old weekly tab and rename the copy `TEMPLATE`. Keep the formatting, merged cells, and column positions. The bridge uses C:E for games/spreads, G/I/K/M for picks, and H/J/L/N for Win values.
3. Open [Google Apps Script](https://script.google.com), create a project, and replace its editor contents with `integrations/google-apps-script/Code.gs` from this repository.
4. Under **Project settings → Script properties**, add:
   - `SPREADSHEET_ID`: the text between `/d/` and `/edit` in the new workbook URL.
   - `TEMPLATE_SHEET_NAME`: `TEMPLATE`.
   - `BRIDGE_SECRET`: a long random value that you keep private.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to yourself. The Vercel server must be allowed to call the URL; if Google requires **Anyone**, the long secret still protects every bridge action.
6. Approve the requested Forms, Sheets, and trigger permissions. Copy the final Web app URL ending in `/exec`.
7. In Vercel → Project → Settings → Environment Variables, add:
   - `POOL_FORM_PROVIDER=google`
   - `GOOGLE_BRIDGE_URL=` followed by the `/exec` URL
   - `GOOGLE_BRIDGE_SECRET=` followed by the same private secret
8. Redeploy the latest GitHub commit. Do not put either secret in GitHub or send it in chat.

## Safe first test

Keep the app on mock Week 1. Publish with notifications off, open the generated short link, submit one player, and confirm:

- a Google Form opens;
- the pick appears in the matching player column on `WK1`;
- within five minutes the app shows that submission;
- after **Simulate final scores**, H/J/L/N and the totals update in the Sheet;
- a push displays `0`.

The current Codex Google connection cannot read the old workbook (Google returns permission denied), so the final Apps Script deployment and authorization must be performed while signed into the workbook-owning Google account.
