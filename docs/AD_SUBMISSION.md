# Ad submission — Facebook + Nextdoor

This doc covers the manual steps to submit a generated `payload.json` to each platform. The submission step is intentionally kept manual for MVP for two reasons: Facebook Marketing API requires identity verification that's still pending, and a one-time manual review per campaign is a useful guardrail before money goes out the door.

## Prerequisites (one-time per platform)

### Facebook

1. **Identity verification** — currently pending. In Business Manager, complete the verification flow (driver's license / passport scan, business address confirmation). Without this, the Marketing API will reject any campaign creation request.
2. **Ad account ID** — Business Manager → Ad Accounts → copy the numeric ID. Looks like `act_1234567890`.
3. **Access token** — System User → generate a long-lived token with `ads_management` scope. Store in `.env` as `FB_ACCESS_TOKEN`.
4. **Page ID** — Facebook page that owns the ad. Create or pick an existing page that fronts the {City} Civic brand. Store in `.env` as `FB_PAGE_ID`.

### Nextdoor

1. **Nextdoor Business account** — sign up at https://business.nextdoor.com. Verify business address.
2. **Ads API access** — request via partner portal. As of 2026 Nextdoor's ad API is invite-only for partners; for MVP you can use the self-serve Ads Manager UI and skip the API path entirely.
3. **For MVP: paste-and-submit in the Ads Manager UI.** API integration is Phase 4 work.

## Submission today (manual, takes ~10 minutes per campaign)

Once `payload.json` exists for a city + date:

### Facebook (UI path until API is ready)

1. Open Facebook Ads Manager → Create Campaign.
2. Objective: **Traffic** (link clicks to website).
3. Campaign name: paste `campaign_id` from `payload.json` (e.g., `birmingham-al_the-committee-will-consider-an_2026-05-12`).
4. Ad set:
   - Audience: paste the values from `audience` in the payload (geo city + radius, age, interests, behaviors).
   - Budget: paste `budget.daily_usd` and `budget.duration_days`.
5. Ads — create 3 ad variants:
   - For each `creative_variants[i]`, paste `headline`, `body`, `cta`, `link` (with UTM tags).
   - Image: pull the city's hero image from `web/branding/{subdomain}/hero.{jpg,png}` or use a stock image of city hall.
6. Submit. Facebook reviews in 1-24 hours.

### Nextdoor (Ads Manager UI)

1. Open Nextdoor Business → Ads → Create Ad.
2. Choose "Sponsored Post" objective with link.
3. Audience: paste geo + age from the `nextdoor` payload section. Nextdoor's geo is neighborhood-based, so the 5-mile radius matters less.
4. Creative: paste one of the three variants (Nextdoor only takes one creative per ad — pick the one that performed best in Facebook, or start with `civic_fact`).
5. Budget: `nextdoor` section has `daily_usd: 15` (lower than Facebook because Nextdoor CPC is cheaper for civic content).
6. Submit. Nextdoor reviews in ~1 hour.

## Tracking what's working

UTM tags are on every link in the payload. After ads run, check `birmingham-al-civic.vercel.app` analytics (Vercel Analytics or Plausible if added) and filter by:

- `utm_source=facebook` vs `utm_source=nextdoor` — which platform drove more traffic
- `utm_campaign=birmingham-al_*` — which story drew the most clicks

Report after 5 days. If one platform is clearly outperforming, shift budget. If one creative angle (`civic_fact` vs `resident_impact` vs `curiosity`) is winning, generate the next campaign with that angle weighted higher.

## Manual steps still in this flow (Phase 4 to automate)

- Manually creating the Facebook campaign → automatable via `POST /act_{id}/campaigns`, `POST /act_{id}/adsets`, `POST /act_{id}/ads`. Will write a `scripts/submit-facebook.mjs` once identity verification clears.
- Pasting Nextdoor ads → blocked on Ads API access (invite-only). Manual UI submission is the only path for now.
- Picking the hero image per ad → currently grab from `web/branding/{subdomain}/`. The branding bootstrapper already saves this. A future enhancement is to generate per-story OG images automatically (story title overlaid on city hero), which improves CTR on social.
- Reviewing each creative variant for quality → keep this manual. Even when the API call is automated, the variants should be human-reviewed before submission. The `preview.md` file is designed exactly for this.

## Cost expectations for MVP

A reasonable first run for Birmingham:

- Facebook: $20/day × 5 days = $100. Expect 200-800 clicks at $0.12-$0.50 CPC.
- Nextdoor: $15/day × 5 days = $75. Expect 50-200 clicks at $0.30-$1.00 CPC.

Total: ~$175 for the first 5-day test. The success criterion is not conversions — it's that the full funnel works end-to-end: ad serves, click attributes via UTM, lands on the city site, page renders correctly. Optimization comes after baseline numbers exist.
