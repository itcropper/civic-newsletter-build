# Deploying Civic Weekly to Vercel

Routing is **path-based** as of 2026-05-14. One Vercel project serves the
splash page **and** every city. Each city lives at `/{cities.subdomain}` on
the same host — e.g. `civic-newsletter-build.vercel.app/birmingham-al` and
`civic-newsletter-build.vercel.app/medford-or`. No subdomain DNS, no Vercel
Pro plan required, no per-city Vercel project.

> Migrated from subdomain routing (each city had its own Vercel project +
> `CITY_SUBDOMAIN` env var) because subdomain routing on free-tier Vercel
> kept breaking the request-time city resolution. Path routing makes the
> slug part of the URL, so there's nothing left to misconfigure.

Total time: ~5 minutes for the initial project. Adding a new city after
that is a single SQL `INSERT` into `cities` — no Vercel changes.

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
3. **Root Directory** — set to `web` (not the repo root). This tells Vercel
   to build the Next.js app, not the pipeline code.
4. Framework Preset auto-detects Next.js.
5. Project name: `civic-newsletter-build` (becomes
   `civic-newsletter-build.vercel.app`).
6. Add environment variables (Settings → Environment Variables — set for
   Production, Preview, and Development):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://yfynwejgbyeisharldyk.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | legacy anon JWT (see note below) |
   | `REQUEST_HASH_SALT` | any 32+ char random string (used to hash IPs for rate-limiting on the splash request form) |

   **Do NOT set `CITY_SUBDOMAIN`** on this project. If it's set, the legacy
   middleware will 308-redirect `/` to `/{CITY_SUBDOMAIN}`, which hides the
   splash. The env var only exists for transitional compatibility with old
   per-city projects; remove it everywhere it's set.

   **No newsletter env vars yet.** Beehiiv-related env vars
   (`BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`) are NOT required — there
   is no on-blog subscribe form in the current build. The "tell me when my
   city is added" flow lives on the splash page and writes to
   `public.city_requests` directly. When per-city newsletter signup is
   reintroduced, the env vars will be added back here.

   **Anon key note** — Use the **legacy** anon key (starts with `eyJ`), not
   the new `sb_publishable_...` format. Find it in Supabase Dashboard →
   Project Settings → API → "Legacy API keys" (or via the
   `get_publishable_keys` MCP call). Anon keys are designed to be
   public-facing — they identify the project, and Row Level Security on the
   database is what actually gates access.

7. Click **Deploy**. First build takes 1-2 minutes.

## Step 3 — Verify

Once the deploy completes:

- `https://civic-newsletter-build.vercel.app/` — splash page with search,
  "Live cities" grid, and request-coverage form.
- `https://civic-newsletter-build.vercel.app/birmingham-al` — Birmingham
  city home with the latest approved stories in reverse chronological
  order.
- `https://civic-newsletter-build.vercel.app/birmingham-al/posts/<slug>` —
  individual story page.
- `https://civic-newsletter-build.vercel.app/birmingham-al/rss.xml` — RSS
  feed with the latest 25 stories.
- `https://civic-newsletter-build.vercel.app/birmingham-al/atom.xml` —
  Atom feed.
- `https://civic-newsletter-build.vercel.app/birmingham-al/tags/budget` —
  tag filter page.
- `https://civic-newsletter-build.vercel.app/about` — about the platform.

If a city home shows "It's quiet in {city} this week", check that there
are rows in `stories` where `city_id` matches that city's id,
`qc_status='approved'`, and `published_at IS NOT NULL`.

## Step 4 — Adding the next city

The new city onboarding flow is entirely data-driven:

1. Insert the city row in Supabase:

   ```sql
   insert into public.cities (name, subdomain, state, state_code, country, timezone, active)
   values ('Medford', 'medford-or', 'Oregon', 'OR', 'USA', 'America/Los_Angeles', true);
   ```

2. (Optional) bootstrap branding:

   ```
   node --env-file=.env scripts/bootstrap-branding.mjs --city Medford
   ```

3. The new city is live immediately at
   `civic-newsletter-build.vercel.app/medford-or`. No Vercel changes. No
   redeploy. The splash search picks it up automatically. The "Live
   cities" grid shows it as soon as it has one approved story.

`cities.site_url` is now only needed when a city has its own custom domain.
For everything served from the main Vercel project, leave `site_url` NULL
and the path-based default kicks in.

## Step 5 — Auto-refresh on new content

Pages already use `revalidate = 300`, so the city home and story pages
re-fetch from Supabase every 5 minutes on the first request after that
window. The 5-minute lag is acceptable for civic content. If you want
faster propagation later, add a Supabase database webhook on `stories`
UPDATE WHERE `qc_status='approved'` that POSTs to a Vercel deploy hook —
triggers a full rebuild within ~30 seconds of approval.

## Manual steps that still exist (future automation)

- Inserting the city row → trivial SQL today; can be a `scripts/onboard-city.js`
  CLI wrapper later.
- Initial branding bootstrap → already scripted (`scripts/bootstrap-branding.mjs`).

## Free tier limits to know

- 100 GB bandwidth/month per Vercel account (plenty for early-stage city blogs).
- Build minutes are not metered on Hobby plan.
- No wildcard DNS required anymore — every city shares one project, one
  domain, one cert.

## Cutting over from the old subdomain setup

The path-based code includes a transitional `middleware.ts` that honors the
old `CITY_SUBDOMAIN` env var. While the var is set on a deployment,
requests for `/` are 308-redirected to `/{CITY_SUBDOMAIN}`, so old single-
tenant projects keep working without breaking inbound links.

To finish the cutover:

1. Delete `CITY_SUBDOMAIN` from every Vercel project. Redeploy so the
   redirect goes away and the splash renders at `/`.
2. Update `cities.site_url` for any city whose `site_url` still points at
   an old single-tenant subdomain. Either set it to NULL (use the path-
   based default) or to the new path-based URL:

   ```sql
   update public.cities set site_url = null where subdomain = 'birmingham-al';
   ```

3. Delete the old per-city Vercel projects once nothing links to them.
4. Eventually delete `middleware.ts` from the repo — it's only there for
   the transition.

## Per-city custom domains (later)

If you ever want a city to live at its own domain (e.g.
`birminghamcivic.com`), you can:

1. Add the domain to the main Vercel project.
2. Add a Vercel rewrite: `birminghamcivic.com/*` → `/birmingham-al/*`.
3. Set `cities.site_url = 'https://birminghamcivic.com'` so internal links
   and feeds use the custom domain.

Path-based routing means no subdomain DNS wildcard is ever required.
