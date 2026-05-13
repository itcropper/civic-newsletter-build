# Deploying a city blog to Vercel

City resolution is data-driven. The code asks the `cities` table which city a request belongs to, using the request's `Host` header. Two deployment modes use the same code:

- **Multi-tenant (production):** one Vercel project serves every city. `birmingham.civicwire.com`, `savannah.civicwire.com`, etc. all hit the same deployment and resolve their city from the Host header against the database. Requires a custom domain with wildcard DNS and Vercel Pro.
- **Single-tenant (MVP / free-tier):** one Vercel project per city, each at its own `*.vercel.app` URL. The Host header doesn't expose a usable subdomain on free tier, so the `CITY_SUBDOMAIN` env var fills that role for one city at a time. The cities table is still the source of truth — the env var just names which row this deployment renders.

This guide covers the MVP single-tenant path (no domain purchase, no Pro plan). The multi-tenant config is at the bottom.

Total time: ~10 minutes for the first city, ~5 minutes for each subsequent city.

> **As of Phase C (2026-05-13):** the root `civic-newsletter-build.vercel.app` is now the **splash page**. It renders when the request resolves to no city — i.e. when `CITY_SUBDOMAIN` is unset on a project (and there's no `UMBRELLA_DOMAIN` match). Each city lives at its own Vercel project. See "Phase C: splash + Birmingham move" below for the cutover steps.

## One-time prerequisites

- A Vercel account (free).
- The repo pushed to GitHub (Vercel imports from a git provider).
- The `web/` folder must be in the repo. It's already there — no separate repo needed.

## Step 1 — Push the repo to GitHub

If the project isn't on GitHub yet:

```
gh repo create civic-newsletter --private --source=. --push
```

Or use the GitHub website to add a new remote and push.

## Step 2 — Import to Vercel

1. Go to https://vercel.com/new
2. Pick the `civic-newsletter` repo.
3. **Root Directory** — set to `web` (not the repo root). This tells Vercel to build the Next.js app, not the pipeline code.
4. Framework Preset auto-detects Next.js.
5. Project name: `birmingham-al-civic` (becomes `birmingham-al-civic.vercel.app`).
6. Add environment variables (Settings → Environment Variables — set for Production, Preview, and Development):

   | Name | Value |
   |---|---|
   | `CITY_SUBDOMAIN` | `birmingham-al` |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://yfynwejgbyeisharldyk.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (paste the legacy JWT anon key — see note below) |
   | `BEEHIIV_API_KEY` | (Beehiiv API key — required for the on-page subscribe form) |
   | `BEEHIIV_PUBLICATION_ID` | (fallback Beehiiv publication id, used when `cities.beehiiv_publication_id` is null) |
   | `REQUEST_HASH_SALT` | any 32+ char random string (used to hash IPs for rate-limiting) |

   The site URL is derived from the request `Host` header at runtime, so there's no `NEXT_PUBLIC_SITE_URL` to set. RSS/Atom feeds, canonical tags, and OG metadata all build their absolute URLs from whatever hostname the visitor used to reach the site.

   **Per-city Beehiiv publication** — `cities.beehiiv_publication_id` overrides `BEEHIIV_PUBLICATION_ID` when set. During the Birmingham-only phase you can leave the column null on every city and rely on the env-var fallback. When you spin up a second city's Beehiiv publication, set the column for that city to keep audiences separate.

   **Anon key note** — Use the **legacy** anon key (starts with `eyJ`), not the new `sb_publishable_...` format. Find it in Supabase Dashboard → Project Settings → API → "Legacy API keys" (or via the `get_publishable_keys` MCP call). Anon keys are designed to be public-facing — they identify the project, and Row Level Security on the database is what actually gates access.

7. Click **Deploy**. First build takes 1-2 minutes.

## Step 3 — Verify

Once the deploy completes:

- Open `https://birmingham-al-civic.vercel.app/` — should show the latest Birmingham approved stories in reverse chronological order.
- Open `/posts/<slug>` — individual story page.
- Open `/rss.xml` — RSS feed with the latest 25 stories.
- Open `/atom.xml` — Atom feed.
- Open `/about` — about page for Birmingham.
- Open `/tags/budget` (or `/tags/safety`) — tag filter page.

If the homepage shows "No published stories yet", check that the env vars are set correctly and that there are rows in `stories` where `city_id` matches Birmingham's id, `qc_status='approved'`, and `published_at IS NOT NULL`.

## Step 4 — Adding the next city

For Savannah (or any other city):

1. Vercel → New Project → import the same repo.
2. Root Directory: `web`.
3. Project name: `savannah-civic`.
4. Same env vars **but** `CITY_SUBDOMAIN=savannah`. Also `UPDATE cities SET site_url='https://savannah-civic.vercel.app' WHERE name='Savannah';` in Supabase so the ad-creative script knows where to point ads for that city.
5. Deploy.

That's it. Same codebase, different env vars per project. No code shared between cities at runtime — each deployment loads only its own city's data. There is no cross-city navigation anywhere in the codebase.

## Step 5 — Auto-redeploy on new content

Vercel can rebuild when new stories are approved. Two options:

**Option A — Use the built-in `revalidate = 300`** (default for now). Pages re-fetch from Supabase every 5 minutes on the first request after that window. Simplest. No webhook setup. The 5-minute lag is acceptable for civic content.

**Option B — Supabase webhook to Vercel deploy hook** (set up later). Each Vercel project has a deploy hook URL (Settings → Git → Deploy Hooks). Add a Supabase database webhook on `stories` UPDATE WHERE `qc_status='approved'` that POSTs to the deploy hook. Triggers a full rebuild within ~30 seconds of approval. Skip for MVP.

## Manual steps that still exist (future automation)

These are acceptable for MVP but should be scripted by Phase 4:

- Creating the Vercel project per city → automatable via Vercel API. The future `scripts/onboard-city.js` script can hit `POST /v9/projects` programmatically.
- Setting env vars per project → also Vercel API (`POST /v10/projects/{id}/env`).
- Initial branding bootstrap → already scripted (`node --env-file=.env scripts/bootstrap-branding.mjs --city Birmingham`).
- DNS for a real domain → not needed until you buy `civicwire.com` and upgrade to Vercel Pro.

## Free tier limits to know

- 100 GB bandwidth/month per Vercel account (plenty for early-stage city blogs).
- One `*.vercel.app` subdomain per project (we use one project per city).
- Build minutes are not metered on Hobby plan.
- No wildcard domain support — that's the only reason Pro would be needed at scale.

## Phase C: splash + Birmingham move

The cutover is two manual Vercel steps. The code already supports both modes
from the same deploy:

1. **Create the new Birmingham project.**
   - Vercel → New Project → import the same `civic-newsletter` repo.
   - Root Directory: `web`.
   - Project name: `birmingham-al-civic-newsletter-build` (becomes
     `birmingham-al-civic-newsletter-build.vercel.app`).
   - Env vars (Production + Preview + Development):

     | Name | Value |
     |---|---|
     | `CITY_SUBDOMAIN` | `birmingham-al` |
     | `NEXT_PUBLIC_SUPABASE_URL` | `https://yfynwejgbyeisharldyk.supabase.co` |
     | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | legacy anon JWT (see anon-key note above) |
     | `REQUEST_HASH_SALT` | any 32+ char random string |

   - Deploy. Verify `birmingham-al-civic-newsletter-build.vercel.app/` shows
     the Birmingham home with the new card grid and source chips.

2. **Convert the original project into the splash page.**
   - Vercel → existing `civic-newsletter-build` project → Settings →
     Environment Variables.
   - **Remove** `CITY_SUBDOMAIN`.
   - Keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **Add** `REQUEST_HASH_SALT` (any 32+ char random string).
   - Redeploy. With no `CITY_SUBDOMAIN` and no `UMBRELLA_DOMAIN` match,
     `isSplashRequest()` returns true and the root URL renders `SplashHome`
     instead of a city blog.

3. **Update Birmingham's `site_url` in Supabase** so the splash page's
   "Live cities" cards and the ad pipeline both point readers to the new
   subdomain:

   ```sql
   update public.cities
   set site_url = 'https://birmingham-al-civic-newsletter-build.vercel.app'
   where subdomain = 'birmingham-al';
   ```

4. **Verify end-to-end.**
   - `civic-newsletter-build.vercel.app/` → splash, search works, "Live
     cities" shows Birmingham, submitting the request form returns
     `{ ok: true }` and a row appears in `city_requests`.
   - `birmingham-al-civic-newsletter-build.vercel.app/` → city home as before.
   - `/api/search?q=bir` → returns Birmingham.

Adding a city after Phase C: same as the per-city section above. Spin up a
new Vercel project per city, set `CITY_SUBDOMAIN`, set `cities.site_url`.

## Multi-tenant config (future, once you own civicwire.com + Vercel Pro)

When you're ready to consolidate cities onto one deployment:

1. Buy `civicwire.com` (or whatever umbrella you choose).
2. Add it to the Vercel project as a custom domain. Add `*.civicwire.com` as a wildcard. Vercel auto-provisions an SSL cert per requested subdomain.
3. In Vercel env vars, **add** `UMBRELLA_DOMAIN=civicwire.com` and **remove** `CITY_SUBDOMAIN`.
4. Point DNS so `*.civicwire.com` resolves to Vercel (CNAME or A record per Vercel's instructions).
5. Done. From that point on, adding a new city means inserting a row in `cities` with a new `subdomain` value — no code change, no env var change, no redeploy.

If both `UMBRELLA_DOMAIN` and `CITY_SUBDOMAIN` are set, the umbrella host match wins when the request matches the wildcard, and the env var only resolves requests that don't match (useful during cutover).
