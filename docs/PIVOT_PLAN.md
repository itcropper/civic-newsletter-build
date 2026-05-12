# Pivot plan — newsletter to per-city blog with RSS

Last updated: 2026-05-12

This plan addresses both finishing the website pivot and resolving the operational issues found while auditing current state (data stale since 2026-04-14, newsletter cron still firing, 10 cities seeded without archive URLs, ad agents never invoked).

The phases are ordered by dependency, not by ambition. Phase 0 is operational hygiene that should happen before any new code is written. Phase 2 is the bulk of the build. Phases 3 and 4 can run in parallel once the blog is live for at least one city.

---

## Phase 0 — Stop the bleeding (half a day)

Three small things first, so the rest of the work happens on a clean foundation.

**Disable the newsletter cron.** `civic-weekly-newsletter` (jobid 4) ran yesterday at 15:00 UTC and will run again next Monday. Set `active = false` in `cron.job` for that one job. Leave the crawl/transcribe/pipeline crons alone — those are still doing useful work. This is a one-line SQL change and makes the intent ("email is dormant") match reality.

**Diagnose the stale-data issue.** The cron jobs report `succeeded` and the `civic-orchestrator` edge function returns 200 in ~1 second, but no new approved story has landed since 2026-04-14. The 1-second execution time is suspicious — a real pipeline pass over the cities with archive URLs (Birmingham, Savannah, Fargo) should take meaningfully longer. Fargo is the loudest signal: it has archive URLs configured but has produced zero stories ever. Likely causes, in descending order of probability:

1. `civic-orchestrator` is a thin wrapper that returns 200 without actually dispatching the per-city work, or dispatches it asynchronously to something that's failing silently.
2. The crawler is running but the archive URLs are exhausted (no new agendas published since mid-April for Birmingham/Savannah) and Fargo's archive URL was misconfigured.
3. Downstream QC (agents 05a/05b/06) is rejecting everything coming out of summarizer, so the funnel runs but the verdict is always reject.

The diagnostic path is: tail the orchestrator logs during a manual invocation, check whether per-city queues in Upstash Redis have any backlog, look at `stories` rows where `qc_status != 'approved'` to see what's getting rejected and why. A single afternoon should resolve this.

**Decide the city portfolio.** Right now there are 13 cities marked `active = true` but only 3 have archive URLs (Birmingham, Savannah, Fargo) and only 3 have any stories at all (the same minus Fargo, which has zero). The other 10 are dormant rows that show up in counts and dashboards but do nothing. The decision: either trim them to a starter set of 3-4 cities and focus, or commit to onboarding archive URLs for the rest. The pivot plan from here on assumes a starter set of 3 (Birmingham, Savannah, Ashland — Ashland gets archive URLs added in Phase 1 since it was the original target city).

---

## Phase 1 — Restore the acquire pipeline (1-2 days, depends on Phase 0 diagnosis)

Once Phase 0 has identified the root cause, the work here is whichever subset of the following applies.

If the orchestrator was a stub, replace it with a real implementation that loops over active cities, invokes civic-crawler for each, queues the results for transcription, and waits for completion before invoking the pipeline. If the orchestrator was real but failing silently, add error capture and a Redis-backed run log so each invocation leaves a trail.

Configure archive URLs for Ashland (the original target city) and verify Birmingham/Savannah/Fargo URLs still resolve. Wikipedia, the cities' own websites, and NovusAgenda/Granicus systems sometimes change URL schemes; the URLs that worked in April may now 404.

Run the pipeline manually for one city end to end and verify at least one new approved story lands. Until that smoke test passes, no further work on the publish side is worth doing.

---

## Phase 2 — Build the blog (3-5 days, the bulk of the work)

This is the actual pivot. The shape is a single Next.js application that reads the `Host` header at request time, derives the city from the subdomain, and renders only that city's content. Same codebase, one deployment, infinite cities.

**Schema additions.** Three new columns. `stories.slug` (text, unique per city) for URL paths like `/posts/council-passes-tot-increase`. `stories.tags` (text array) for category pages — start with a small fixed set (council, planning, schools, public-safety, budget, housing). `cities.subdomain` (text, unique) so we don't have to derive it from `name`. `cities.branding_json` (jsonb) to hold the auto-fetched palette and image URL.

**Next.js app.** New project at the repo root, sibling to `src/`. Pages: `/` (reverse-chronological homepage), `/posts/[slug]` (individual story), `/tags/[tag]` (filter view), `/archive/[year]/[month]` (date archive), `/about` (city-specific static page), `/rss.xml` and `/atom.xml` (feed routes). Middleware reads the `Host` header on every request, looks up the city by subdomain, attaches it to the request context, and 404s if the subdomain doesn't match an active city. All Supabase queries filter by that city ID — there is no code path that returns another city's content.

**RSS and Atom.** Generated at request time from the latest 25 approved stories. Full text in the feed by default (per the earlier decision — friendlier to readers and gets the content syndicated). One feed per city, no master feed.

**Branding bootstrapper.** A new node script in `src/jobs/bootstrap-branding.js` invoked when a city is added. It calls the Wikipedia REST API (`/page/summary/{city}`), pulls the `thumbnail` URL from the response, downloads the image, runs it through `node-vibrant` or similar to extract two dominant colors, writes the result to `cities.branding_json` as `{ hero_url, primary, secondary }`. Failures fall through to a default neutral palette — never blocks publication.

**Override folder.** `/branding/{city_slug}/` checked into git. If `hero.jpg` exists there, it takes precedence over the Wikipedia thumbnail. If `colors.json` exists, it takes precedence over the extracted palette. The Next.js app reads both at build time (or via `next/image` and `fs` at request time, depending on whether you want hot-reload on override changes).

**Deployment.** One Vercel project for the entire codebase. Add a wildcard DNS record `*.civicwire.com` pointing to Vercel. Vercel handles the subdomain routing automatically based on the configured custom domain. SSL certs auto-provision for each subdomain on first request.

**Roll-out.** Deploy with Birmingham first (it has 8 approved stories and a configured archive URL — the only city with enough content to look real). Validate everything works on `birmingham.civicwire.com`. Then add Savannah, then Ashland. After three cities are live and visibly working, the marginal cost of adding city N is small.

---

## Phase 3 — Wire ads (2-3 days, can start once Phase 2 has 1 city live)

The ad agents (09a copy, 09b targeting) were written in April but never invoked. The work here is finishing them and putting them on a real platform.

**Facebook identity verification.** Still pending from the original plan. This is a manual step that only Ian can do — log into Business Manager, complete the verification flow, confirm the ad account is eligible for API access. Until this completes, no Facebook ads can run.

**UTM tagging in 09a.** Add a step that appends `?utm_source={platform}&utm_medium=cpc&utm_campaign={city}_{date}&utm_content={story_slug}` to every link in the generated copy. This is what makes attribution work — without it there's no way to tell which platform/campaign drove which traffic.

**First test campaign.** $20/day in Birmingham, single ad set, audience = adults 25+ within 25 miles of Birmingham city center, single creative pulling the top story's headline + the city hero image. Run for 5 days. The success criterion is not conversions — it's that the funnel works end-to-end (ad serves, click attributes via UTM, lands on the right post, post renders correctly). Optimization comes after.

**Nextdoor decision.** Nextdoor Ads is a separate integration with its own API, its own creative spec, and its own audience model. It's meaningfully cheaper per click for civic content and the audience overlap with target readers is strong. But it's also additional engineering work. Recommendation: defer to Phase 4 unless Facebook returns disappointing numbers — Facebook's broader reach makes it the better single bet for validation.

**Analytics.** Install Plausible or Vercel Analytics (privacy-friendly, no cookie banner needed) so there's something to measure beyond ad-platform-reported clicks. Configure a goal for "post view" so the conversion funnel is visible.

---

## Phase 4 — Scale to N cities (1-2 days, only after the above lands)

Once the pattern is proven for 3 cities, the constraint is onboarding speed. The current onboarding flow requires touching multiple things — adding a row in `cities`, providing archive URLs, configuring DNS, etc. The goal here matches the existing zero-friction rule: a new city = name + details + archive URLs, and everything else is automatic.

Build a single script `scripts/onboard-city.js` that takes a city name and a list of archive URLs, then: inserts the `cities` row, runs the branding bootstrapper, creates the Cloudflare DNS record for the subdomain via API, kicks off an initial crawl, and writes the city to a deploy manifest that Vercel reads. One command, no manual steps.

This is the point at which the business becomes interesting — adding city #4 takes 5 minutes instead of a day. Adding city #50 takes the same 5 minutes.

---

## What requires Ian, what doesn't

The handoff points where the work pauses for a human action:

- Facebook Business Manager identity verification (Phase 3, blocking)
- Purchase or confirm ownership of `civicwire.com` (Phase 2, before DNS setup)
- Cloudflare account creation + API token (Phase 2, can be Vercel-managed DNS instead if preferred)
- Approve any Vercel project / git connection auth
- Decision on whether to keep all 13 cities or trim to a starter set (Phase 0)
- Review of one auto-generated branding output before assuming the bootstrapper is good enough (Phase 2)

Everything else — code, migrations, edge function deploys, cron edits, log diagnosis — proceeds without intervention.

---

## What gets touched, what doesn't

The acquire pipeline (agents 01-06, civic-crawler, civic-transcribe, civic-pipeline edge functions, the Supabase schema for `stories` and `cities`) is preserved as-is. It produces the data the blog renders. The only schema changes are additive.

The email pipeline (agents 07, 10, Beehiiv integration, landing-pages folder) is kept in the repo and on the Beehiiv account but is unscheduled and unwired. If email comes back later, it's a re-enable, not a rebuild.

The Observer task (`pipeline-issue-review` Cowork scheduled task) keeps running daily and keeps writing to `docs/OBSERVER_REPORT.md`. That's the operational health signal during the build.

---

## Risk register

The branding bootstrapper will not produce a good result for every city. Small towns without Wikipedia infoboxes get a generic palette. Plan on manually overriding ~25% of cities, which is the override folder's whole purpose.

Vercel free-tier limits matter at scale. The single-app-with-subdomain-middleware pattern stays within limits indefinitely. The one-project-per-city pattern would hit the team project cap quickly. The plan above uses the former.

Wildcard DNS + automatic SSL works on Vercel for paid plans only. The free tier requires manually adding each subdomain as a configured domain in the Vercel project UI. Adding 50 subdomains by hand defeats the zero-friction onboarding rule. Plan on a Vercel Pro plan ($20/mo) before scaling past ~5 cities.

The "no association between cities" constraint is best-effort, not absolute. A determined visitor can guess `civicwire.com`, can compare WHOIS records, can find the umbrella. If true non-association ever matters more than convenience (legal, brand, or competitive reasons), the migration path is to swap individual cities to separate domains per the original "subdomains now, separate domains later" decision.
