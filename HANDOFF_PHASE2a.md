# Phase 2a — morning handoff

Shipped overnight while you slept. **Everything is on `main` and pushed to GitHub.** Cloudflare and Convex pick up the changes automatically once `npx convex dev` is running on your machine.

## What it does

- **Session gate**: visiting `/app.html` without a Convex session token now bounces you to `/signin.html` immediately. (Use `/app.html?demo=1` to bypass for offline testing.)
- **Hydrate**: on every page load, the app fetches your full org snapshot from Convex (one query, `data:listAll`) and pours it into the in-memory `S` object before the UI renders. The existing render functions still work unchanged.
- **Auto-sync**: every change to `S` (any wrapped save function) schedules a debounced 3-second push that fires *all* per-entity sync mutations in parallel. The sidebar backup indicator becomes a live sync indicator: `✓ Synced 12s ago` / `⋯ Saving in 3s…` / `↻ Saving…` / `⚠ Sync failed`.
- **Sign out**: now actually signs out — flushes any pending changes, deletes the session in Convex, clears `localStorage`, redirects to `/signin.html`.
- **Beforeunload guard**: the browser warns if you try to close the tab while a sync is still pending.

## Files added / changed

| File | What |
|---|---|
| `convex/data.ts` (new) | `listAll(sessionToken)` — single bulk-fetch returning everything in legacy `S` shape |
| `convex/sync.ts` (new) | 14 per-entity upsert-by-legacyId mutations + chunked attendance sync |
| `convex/import.ts` | tiny type fix (dropped `obligations` from `LookupTable` since the table has no `by_org_legacyId` index) |
| `public/app.html` | head session-gate, end-of-body Convex bridge module, neutralized legacy backup indicator |

## Test sequence (5 min)

1. **Make sure `npx convex dev` is running** (or run it once: `cd C:\Users\alasi\covenant; npx convex dev`). It auto-pushes the new `data:listAll` and `sync:*` functions. Confirm in https://dashboard.convex.dev/d/standing-quail-556/functions.

2. **Cloudflare deploy**: should be green within a minute of your wake-up. Check at https://dash.cloudflare.com → Workers & Pages → covenant.

3. **Hard-refresh** your `/app.html` tab (Ctrl+Shift+R) to drop any cached version.

4. **Load `/app.html`**:
   - You should see the dark "✝ Covenant — Loading your workspace…" overlay for 1-2 seconds.
   - Then the app shell paints **with all your TrueVine data already populated** (16 partners, 16 clients, ~163 payments, etc.).
   - Sidebar bottom-left should show: `✓ Synced` (followed by an age once you make a change).

5. **Sanity-test a write**:
   - Add a partner, edit a payment, or any small change.
   - Sidebar shows `⋯ Saving in 3s…`, then `↻ Saving…`, then `✓ Synced 0s ago`.
   - Open https://dashboard.convex.dev/d/standing-quail-556/data → relevant table should reflect the change within ~5 seconds.

6. **Sanity-test sign-out**:
   - Click the ⏻ icon next to your name.
   - You should land on `/signin.html`.
   - Hitting `/app.html` directly now redirects back to `/signin.html` (session cleared).

7. **Sanity-test reload after change**:
   - Sign in again via magic link.
   - The change you made in step 5 should still be there (came from Convex, not localStorage).

## Known limitations / things to verify carefully

- **Auto-sync re-pushes everything per entity, every 3 seconds after a change.** Wasteful but bulletproof. If your data grows large (10× current size), this will get slow. Phase 2b can optimize to per-row diffs.
- **Attendance is chunked into 400-row batches.** Should comfortably handle your ~2400 rows. If you hit Convex transaction-limit errors, lower the chunk size in `app.html` (search for `const CHUNK = 400`).
- **`computeAll()` runs after hydration.** It re-derives obligations from payments/salaries. Imported obligation balances *should* survive (computeAll matches by `key` like `ti-1-2026-04`), but **verify**: open Obligations and confirm balances look right (especially the partial-paid ones).
- **The login screen's email/password form is dead code now.** It still renders briefly under the loading overlay if you bypass the redirect, but with no Convex bridge you can't get past it. Phase 2b can delete it.
- **No member-edit sync.** The `members` table is read by `data:listAll` but no mutation exists yet to update it. Editing your role/name in the legacy Users page won't sync. Phase 2b adds this.
- **Two tabs editing simultaneously**: last write wins. No conflict resolution. Acceptable for v1 single-user-per-org.
- **Closing tab during a 3-second debounce**: the beforeunload guard warns you, but if you click "Leave anyway" the last edit is lost. Workaround: click the sync indicator in the sidebar to force-flush before closing.

## If something breaks

- **Loading overlay never disappears**: open browser devtools (F12) → Console. Most likely `data:listAll` failed. Check `npx convex dev` for the error. If it says functions don't exist, `npx convex dev` isn't running.
- **"Could not load your data: ..." overlay**: the error message is shown verbatim. Common causes:
  - Session expired → click overlay link or open `/signin.html` and re-sign-in.
  - Convex deployment URL wrong → check `app.html` line for `CONVEX_URL` constant.
- **Auto-save shows "Sync failed" repeatedly**: open devtools → Console. The full error is logged with `[covBridge]` prefix.
- **You need to roll back**: `git revert b1238b1` then `git push`. Cloudflare will redeploy the pre-Phase-2 app.html. Your imported Convex data stays intact.
- **Emergency demo mode**: append `?demo=1` to `/app.html` to bypass everything and use the legacy login (joshua/maria/ruth demo accounts). For testing only — no Convex sync in this mode.

## What's NOT in Phase 2a (deferred to 2b / 1.3 / 1.4)

- Removing `orgs:devCreateLicenseForEmail` (security — Phase 1.3 cleanup)
- Removing the legacy login screen markup
- Real PayMongo wiring (Phase 1.3)
- Resend email (Phase 1.4)
- Member invite flow (Phase 2b)
- Per-row sync optimization (Phase 2b)
- Real-time subscriptions (Phase 2c — replace polling with `client.onUpdate`)

## Quick reference

| Thing | Where |
|---|---|
| App | https://covenant.asignacionalp.workers.dev/app.html |
| Sign-in | https://covenant.asignacionalp.workers.dev/signin.html |
| Import | https://covenant.asignacionalp.workers.dev/import.html |
| Convex data | https://dashboard.convex.dev/d/standing-quail-556/data |
| Convex functions | https://dashboard.convex.dev/d/standing-quail-556/functions |
| Convex logs | https://dashboard.convex.dev/d/standing-quail-556/logs |
| GitHub | https://github.com/asignacionalp-prog/Covenant |

When you've poked at the app and confirmed it's reading/writing Convex correctly, message me and I'll start Phase 2b (cleanup + member invites) or Phase 1.3 (PayMongo) — whichever you'd rather tackle first.
