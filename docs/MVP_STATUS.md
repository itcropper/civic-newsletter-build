# MVP status — civic city blog pivot

Last updated: 2026-05-12

## What ships today

A complete end-to-end flow exists for Birmingham, from city.gov crawling to ad creative ready for submission. Five things are fully built; one external step (Facebook identity verification) blocks live ad submission.

### Functional now

The acquire pipeline runs daily via pg_cron and now actually fires (a one-character schema bug in the orchestrator had been silently skipping every run since April 14 — fixed today). Today's crawl found 4 new Birmingham meetings dated 2026-05-12. Five approved stories sit in the `stories` table ready to render.

The Next.js blog app lives in `web/`. It renders one city per deployment via the `CITY_SUBDOMAIN` env var. Pages built: homepage (reverse chronological), individual posts, tag filter, about, 404. RSS feed at `/rss.xml`, Atom at `/atom.xml`, both full-text. No code path exposes content from other cities — each Vercel project is single-tenant by design.

City branding has two paths. The auto path (`scripts/bootstrap-branding.mjs`) pulls a city's Wikipedia thumbnail and stores a derived palette in `cities.branding_json`. The override path (`web/branding/{subdomain}/`) lets you drop a `hero.jpg` and `colors.json` to override the auto result. Birmingham already has an override colors.json checked in (navy + gold).

Ad creative generation works end-to-end. `scripts/generate-ad-creative.mjs` picks a city's top approved story, generates 3 creative variants and an audience brief via Claude, wraps every link with UTM tags per platform, writes a machine-readable `payload.json` and a human-reviewable `preview.md`. An example for today's top Birmingham story (the Graymont School $790K covenant) is at `output/ads/birmingham/2026-05-12/`.

### Blocked on you

Facebook Business Manager identity verification. Without it, Marketing API submissions are rejected, so the last 100 yards of the ad path is manual UI work (the AD_SUBMISSION.md walks through it). Verification typically clears within a few business days.

Vercel deployment of the Birmingham site. The codebase is ready, the deploy guide is in `docs/DEPLOY_VERCEL.md`, but pushing it to Vercel requires your GitHub + Vercel account. About 10 minutes of clicking once the repo is on GitHub.

## What's preserved but dormant

The newsletter cron (`civic-weekly-newsletter`) is `active = false`. Agents 07 and 10 are still in the repo. The Beehiiv publication exists. No data flows to any of it. Re-enabling email is a one-line SQL update plus restoring the cron schedule.

## Manual steps that still exist (Phase 4 — automate later)

Three things remain manual and they're acceptable for MVP, but each should become a single script as soon as a second or third city joins.

Creating a Vercel project per city. Today: ~10 minutes per city in the UI. Future: `scripts/onboard-city.mjs` hits `POST /v9/projects` plus the env-var endpoint. Same outcome, zero clicks.

Setting Vercel env vars per project. Today: paste from `.env.example`. Future: same script writes them via Vercel API at project creation.

Submitting ads to Facebook + Nextdoor. Today: paste from `preview.md` into Ads Manager. Future: `scripts/submit-facebook.mjs` once identity verification clears (Nextdoor stays manual until their Ads API exits invite-only).

These three combined turn city N's onboarding from a 30-minute task into a 30-second one. Worth building once you're past city 3.

## The 4 fresh meetings still in transcribe queue

Today's crawl found 4 new Birmingham meetings (council, public safety committee, planning, council agenda PDF). They are in `meetings.status='queued'` waiting for the transcribe step to extract their agenda text. That step was kicked off in the background; it's expected to complete within an hour and the resulting stories will flow through the QC pipeline overnight. Nothing blocks the MVP — there are already 5 approved stories to render.

## How to launch the first city, end to end

1. Push the repo to GitHub.
2. Follow `docs/DEPLOY_VERCEL.md` to create the `birmingham-civic` Vercel project. ~10 min.
3. Open `https://birmingham-civic.vercel.app/` — verify stories render, RSS works, branding looks right.
4. Run `node --env-file=.env scripts/generate-ad-creative.mjs --city Birmingham` to refresh the ad payload with the latest top story. (Or use the existing example at `output/ads/birmingham/2026-05-12/`.)
5. Review `output/ads/birmingham/{date}/preview.md`.
6. Once Facebook identity verification clears, follow `docs/AD_SUBMISSION.md` to launch the campaign.

Total time from "today" to "ads running": as soon as Facebook verifies, ~30 minutes of hands-on work.

## File inventory of what was added today

- `sql/migrations/005_blog_pivot_columns` (slug, tags, published_at on stories; subdomain, branding_json on cities)
- `sql/migrations/006_auto_publish_on_approve` (trigger that sets slug + published_at when qc_status goes to approved)
- Edge function: `civic-orchestrator` v5 (fixed the schema-mismatch and JWT-format bugs)
- `web/` — entire Next.js app (package.json, configs, lib/, app/, branding/)
- `scripts/bootstrap-branding.mjs` (Wikipedia → palette → DB)
- `scripts/generate-ad-creative.mjs` (top story → variants + targeting + UTMs)
- `output/ads/birmingham/2026-05-12/payload.json` + `preview.md` (example output)
- `docs/DEPLOY_VERCEL.md`
- `docs/AD_SUBMISSION.md`
- `docs/MVP_STATUS.md` (this file)
- `docs/PIVOT_PLAN.md` (the master plan from earlier in the session)
