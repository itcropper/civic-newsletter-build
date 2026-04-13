# HANDOFF DOCUMENT — AI Civic Newsletter System

**Build completed:** 2026-04-12 (updated 2026-04-13)
**Built by:** Build Cowork instance
**Handed to:** Ops Cowork instance
**Launch cities:** Birmingham AL, Savannah GA, Topeka KS

---

## System Overview

This is a fully autonomous, multi-city AI-powered civic newsletter system. It crawls government meeting pages, transcribes and summarizes content using a 10-agent Claude pipeline, quality-checks every story via fact-checking and tone-checking, assembles weekly newsletters via Beehiiv, and generates Facebook ad campaigns to grow subscribers.

The system is designed so that an **Ops Cowork instance** can run the entire pipeline without human intervention for routine operations, escalating only when quality thresholds aren't met or infrastructure issues arise.

---

## Business Model

**Revenue structure:** Hybrid — $4/month subscriber fee plus local advertising/sponsorships.

- **Subscriptions ($4/month):** Readers pay a monthly fee via Beehiiv's paid subscription feature. This is the primary revenue source and is intentional — it creates a direct financial relationship with readers rather than depending entirely on ad revenue.
- **Advertising:** Local business sponsorships (law firms, realtors, contractors, local services) placed within each newsletter. Advertisers pay to reach a civically-engaged, geographically-targeted audience. Ad slots should be sold manually at launch, then systematized as volume grows.

**Pricing rationale:** $4/month is deliberately low-friction — below the "do I really need this?" threshold — while still generating meaningful revenue at scale across multiple cities.

**What "free" means in this context:** Nothing. The newsletter is not free. Landing pages should reflect the $4/month price. Do not use "free" language in subscriber acquisition materials.

**Beehiiv configuration needed:** Enable paid subscriptions in Beehiiv dashboard for each publication and set the $4/month price tier before launch.

---

## Architecture

### Infrastructure

| Service | Purpose | Credentials Location |
|---------|---------|---------------------|
| **Supabase** (Postgres) | Primary database — 8 tables, all city-scoped | `.env` → `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| **Supabase Edge Functions** | Cloud execution of pipeline agents | Deployed to project `yfynwejgbyeisharldyk` |
| **Upstash Redis** | Per-city story queues between QC and newsletter assembly | `.env` → `REDIS_URL` |
| **Beehiiv** | Newsletter draft/publish/scheduling | `.env` → `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID` |
| **Anthropic API** | All Claude model calls (Haiku/Sonnet/Opus) | `.env` → `ANTHROPIC_API_KEY` |
| **Facebook Marketing API** | Ad campaign creation (not yet configured) | `.env` → `FACEBOOK_ACCESS_TOKEN`, `FACEBOOK_AD_ACCOUNT_ID` |

### Database (Supabase Postgres)

8 tables, all scoped by `city_id` for multi-city scaling:

1. **cities** — City registry with seed URL, timezone, send schedule, reliability score
2. **meetings** — Crawled meeting pages with content hash (dedup), status pipeline, transcript text
3. **stories** — Extracted story summaries with category, impact score, votes, QC status
4. **issues** — Assembled newsletter issues with Beehiiv post ID, subject line variants
5. **qc_log** — Audit trail for skipped/flagged content
6. **ad_campaigns** — Facebook campaign metadata, ad copy variants, targeting briefs
7. **style_config** — Writing style rules (voice, formality, POV, banned phrases) — global + per-city
8. **ops_config** — Operational parameters (thresholds, limits, schedule settings)

Schema: `sql/001_schema.sql` | Seed data: `sql/002_seed_data.sql` | Permissions: `sql/003_ops_user_role.sql`

### 10-Agent Pipeline

**Nightly run (Agents 1–6) — Crawl + Process + QC:**

| Agent | File | Model | Purpose |
|-------|------|-------|---------|
| 1. Crawler | `src/agents/01-crawler.js` | Haiku | Playwright crawl, URL classification, SHA-256 dedup, robots.txt respect |
| 2. Ingestion QC | `src/agents/02-ingestion-qc.js` | — | 3-check scoring (date/length/content match), threshold adjusted by reliability_score |
| 3. Transcription | `src/agents/03-transcription.js` | Sonnet | HTML/PDF/video routing, coherence check, metadata extraction |
| 3b. Source Verifier | `src/agents/03b-source-verifier.js` | Haiku | Re-fetches source URL, compares transcript against raw HTML for fabricated names/figures/votes. Rejects or flags meetings with ungrounded entities. Critical anti-hallucination guard. |
| 4. Summarizer | `src/agents/04-summarizer.js` | Sonnet | 2–5 stories per meeting, category/impact/votes, style_config injection. Only processes `source_verified` or `source_flagged` meetings. |
| 5a. Fact-checker | `src/agents/05a-fact-checker.js` | Opus | Exhaustive claim verification against transcript, exact vote count match |
| 5b. Tone-checker | `src/agents/05b-tone-checker.js` | Haiku | Banned phrase detection, editorial/sensational language flagging |
| 6. Verdict | `src/agents/06-verdict.js` | Sonnet | Parallel 5a+5b, approve/revise/drop, revision loop (max 2), Redis queue push |

**Weekly run (Agents 7–10) — Newsletter + Marketing:**

| Agent | File | Model | Purpose |
|-------|------|-------|---------|
| 7. Newsletter Builder | `src/agents/07-newsletter-builder.js` | Sonnet | Story ranking, lede generation, full HTML assembly, Beehiiv draft, Redis queue clear |
| 8. Story Selector | `src/agents/08-story-selector.js` | Sonnet | Priority scoring (impact + category + dollar mentions), top 2–3 for ads |
| 9a. Ad Copy Writer | `src/agents/09a-ad-copy.js` | Haiku | 3 variants (civic_fact/resident_impact/curiosity), 40-char headline + 90-char body |
| 9b. Audience Targeting | `src/agents/09b-audience-targeting.js` | Haiku | Facebook targeting brief (geo + age + interests + exclusions) |
| 9c. Subject Lines | `src/agents/09c-subject-lines.js` | Haiku | 2 variants (specific_fact/civic_hook), 50-char limit |
| 10. Campaign Assembler | `src/agents/10-campaign-assembler.js` | Sonnet | Facebook Ads API campaign structure, A/B config, Beehiiv draft → scheduled |

**Orchestration:** `src/pipeline.js` — Exports `runNightlyPipeline(cityId)`, `runWeeklyPipeline(cityId)`, `runAllCities()` with 8-minute city stagger and reliability scoring (EMA).

**Cleanup:** `src/jobs/cleanup.js` — Nightly transcript_text purge per `ops_config.transcript_purge_days`.

### Supabase Edge Functions (Deployed)

| Function | Version | Purpose |
|----------|---------|---------|
| `civic-crawler` | v11 | AI-guided web navigation with civic portal auto-detection (CivicClerk, Granicus, Legistar, etc.), video platform detection, `isCivicSubdomain()` false-positive prevention. MAX_STEPS=12. |
| `civic-transcribe` | **v7** | Text extraction for agenda/minutes pages (text path) + AssemblyAI submission for video content. **v7 adds:** native Claude PDF support (base64), null byte sanitization, `isReadableText()` validation, binary-safe PDF detection via magic bytes, DB error checking. Accepts `step=submit\|fetch\|all`, `city_name`. |
| `civic-transcription-webhook` | v2 | AssemblyAI async callback handler. Updates meeting status to `transcription_ready`. No JWT required. |
| `civic-pipeline` | **v4** | Runs source verification, summarizer, and/or QC steps. **v4 adds:** PDF-aware `fetchRawSource()`, flag-not-reject for unreadable PDF sources, updated summarizer/fact-checker prompts for agenda content. Accepts `step=verify\|summarize\|qc\|all`, `city_name`. |
| `civic-qc-one` | v1 | Processes one pending story through fact-check + tone-check. |

All Edge Functions accept `anthropic_key` (and `assemblyai_key` for transcribe) in POST body for testing. Production should use Supabase Edge Function secrets.

---

## Current State

### Great Bend, Kansas (End-to-End Test — Completed)

Full pipeline test ran entirely via Edge Functions on 2026-04-13:

1. **Crawler** (v11) → Found 2 city_council meetings (2026-04-06)
2. **Transcribe** (v2, text path) → Extracted 3706 chars from CivicAlerts page
3. **Source Verify** → fabrication_risk=none, recommendation=pass → VERIFIED
4. **Summarize** (Sonnet) → 2 stories generated (both Utilities category)
5. **QC** → 1 APPROVED (nitrate water warning, High impact), 1 DROPPED (unverifiable details)

This confirms the full pipeline works autonomously from crawl to QC-approved stories.

### Launch Cities (Selected 2026-04-13)

Three cities chosen for initial launch based on population (100K-400K), website accessibility, meeting frequency, and civic engagement:

#### Birmingham, AL
- **Seed URL:** birminghamal.gov
- **Meetings crawled:** 3 (2 budget, 1 transportation — April 13, 2026)
- **Stories approved:** 4 (justice grant $363K, network upgrade $348K, Graymont property $790K, meeting notice)
- **Stories dropped:** 2 (parks funding imprecise, HUD CDBG unverifiable)
- **Status:** GREEN — pipeline working end-to-end

#### Savannah, GA
- **Seed URL:** savannahga.gov
- **Meetings crawled:** 1 (city council mobile workshop, April 9, 2026)
- **Stories approved:** 2 (housing affordability tour, zoning review)
- **Stories dropped:** 1 (afternoon meeting summary had unverifiable claims)
- **Status:** GREEN — pipeline working end-to-end

#### Topeka, KS
- **Seed URL:** topeka.org
- **Meetings crawled:** 0
- **Stories approved:** 0
- **Status:** RED — blocked by ISS-002 (NovusAgenda platform not in CIVIC_PORTAL_PATTERNS)

### Other Cities in Database

- **Ashland OR** — Original test city. 2 meetings reset to `queued`.
- **Great Bend KS** — E2E test city. 1 approved story (nitrate water warning).
- **Medford OR, Redding CA, Twin Falls ID** — Crawler tested successfully.
- **Reno NV, Spokane WA** — WAF/IP blocked (ISS-001).

### Database Row Counts (as of 2026-04-13)

| Table | Count |
|-------|-------|
| cities | 11 (Ashland + 7 test + 3 launch) |
| meetings | ~8 (3 Birmingham, 1 Savannah, 2 Great Bend, 2 Ashland) |
| stories | 9 (6 Birmingham, 3 Savannah) — 6 approved, 3 dropped |
| issues | 0 |
| qc_log | 5+ (drop reasons + source verifier flags) |
| ad_campaigns | 0 |
| style_config | 1 (global) |
| ops_config | 8+ |

---

## Ops Cowork Responsibilities

### Daily Operations

1. **Nightly pipeline** — Invoke `runNightlyPipeline(cityId)` or the `civic-crawler` + `civic-pipeline` Edge Functions for each active city
2. **Monitor qc_log** — Review any flagged/skipped content for patterns
3. **Reliability scores** — Cities below 0.4 after 5 runs are auto-deactivated; review and re-enable if appropriate
4. **Transcript cleanup** — Run `src/jobs/cleanup.js` to purge old transcript_text per `transcript_purge_days` setting

### Weekly Operations

1. **Newsletter send** — Invoke `runWeeklyPipeline(cityId)` which assembles newsletter, creates Beehiiv draft, generates ad campaigns
2. **Review Beehiiv drafts** — Verify newsletter quality before publishing (initially; can move to auto-publish once confidence is high)
3. **Monitor subscriber metrics** — Track `subscriber_count_at_send` in issues table

### Adding a New City

1. Insert a row into `cities` table: `name`, `seed_url`, `timezone`, `send_schedule`
2. Optionally add a city-scoped `style_config` row (otherwise global style applies)
3. The pipeline will pick it up on the next `runAllCities()` call with 8-minute stagger

### Key ops_config Parameters

| Key | Default | Purpose |
|-----|---------|---------|
| `ingestion_threshold` | 60 | Minimum ingestion QC score to pass |
| `max_revision_loops` | 2 | Max tone revision attempts before dropping a story |
| `min_stories_for_issue` | 3 | Minimum approved stories needed to assemble a newsletter |
| `transcript_purge_days` | 30 | Days before transcript_text is purged |
| `stagger_minutes` | 8 | Minutes between city pipeline starts |
| `crawl_max_pages` | 200 | Safety cap on pages crawled per city |
| `crawl_delay_ms` | 1500 | Politeness delay between page fetches |
| `weekly_send_day` | monday | Day of week for newsletter send |

All are tunable via UPDATE on the `ops_config` table — no code changes needed.

---

## Known Issues & Production Considerations

### Scheduled automation (pg_cron — configured 2026-04-13)

The pipeline runs fully autonomously via pg_cron + pg_net inside Supabase. No external server or cron job needed.

| Job | Schedule (UTC) | Pacific equiv. | Mode |
|-----|---------------|----------------|------|
| `civic-nightly-crawl` | 06:00 daily | ~11 PM | Crawl all active cities |
| `civic-nightly-transcribe` | 08:00 daily | ~1 AM | Transcribe crawled meetings |
| `civic-nightly-pipeline` | 09:30 daily | ~2:30 AM | Verify + summarize + QC |
| `civic-weekly-newsletter` | 15:00 Monday | ~8 AM Mon | Newsletter + marketing |

All four jobs call the `civic-orchestrator` Edge Function with a `mode` parameter. The orchestrator iterates through all `status='active'` cities, calls the appropriate edge functions sequentially, and returns a results summary. It uses a 5-second stagger between cities.

**civic-orchestrator Edge Function (v1):**
- `verify_jwt = false` (auth handled internally via CRON_SECRET env var if set)
- Reads `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID` from Deno.env secrets
- Passes API keys to existing edge functions in POST body (preserving backward compatibility)
- Modes: `crawl` | `transcribe` | `pipeline` | `weekly`

**Secrets required on civic-orchestrator** (set in Supabase Dashboard > Edge Functions > civic-orchestrator > Secrets):
- `ANTHROPIC_API_KEY`
- `ASSEMBLYAI_API_KEY`
- `BEEHIIV_API_KEY`
- `BEEHIIV_PUBLICATION_ID`

To view cron job history: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`

To pause a job: `SELECT cron.unschedule('civic-nightly-crawl');`

To manually trigger a mode (e.g. for testing):
```bash
curl -X POST https://yfynwejgbyeisharldyk.supabase.co/functions/v1/civic-orchestrator \
  -H "Content-Type: application/json" \
  -d '{"mode": "crawl"}'
```

---

### Must address before scaling

1. **Crawler timeout on Edge Functions** — Supabase Edge Functions have a ~150s execution limit. The crawler needs chunked execution (crawl N pages per invocation, resume via cursor) for cities with large meeting archives. Current MAX_STEPS=12 works for the 3 launch cities but may need tuning for larger archives.

2. **Anthropic API key as Edge Function secret** — Currently passed in POST body for testing. For production, store as a Supabase Edge Function secret (`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`) and read from `Deno.env.get('ANTHROPIC_API_KEY')` in the function code.

3. **Beehiiv API key** — Still a placeholder in `.env`. Need a real API key from Beehiiv dashboard before newsletter assembly will work end-to-end.

4. **Facebook Marketing API** — Not yet configured. Need `FACEBOOK_ACCESS_TOKEN` and `FACEBOOK_AD_ACCOUNT_ID` in `.env` before ad campaign creation works. Agent 10 will gracefully skip if credentials are missing.

5. **Topeka NovusAgenda support (ISS-002)** — Topeka's meeting platform is not yet in CIVIC_PORTAL_PATTERNS. Needs civic-crawler update before Topeka can produce any content.

### Good to address eventually

6. **QC agents need server-side invocation** — Browser-based Edge Function calls hit CORS/timeout issues. Not a problem for scheduled ops (cron/server), but limits dashboard-style manual triggering.

7. **Scheduled execution** — Cowork scheduled tasks configured for nightly pipeline (4am CT) and pipeline issue review. See scheduled tasks list for details.

8. **Error alerting** — No notification system for pipeline failures. Consider adding a webhook (Slack/email) on pipeline error.

9. **Rate limiting** — Anthropic Haiku has 50K input tokens/min limit. Running multiple cities in parallel can hit this. Sequential processing with delays recommended.

10. **Content depth threshold (ISS-005)** — Summarizer generates placeholder stories from thin boilerplate pages. A minimum content threshold would improve story quality.

### Resolved during 2026-04-13 session

- **ISS-003:** `meeting_type` CHECK constraint expanded to 10 types (was blocking inserts)
- **ISS-004:** PDF text extraction rewritten with Claude native document support (was storing binary garbage)
- **ISS-006:** Null byte sanitization added to civic-transcribe (was silently failing DB updates)
- **ISS-007:** Source verifier updated to flag (not reject) PDF sources (was blocking valid meetings)

---

## File Structure

```
civic-newsletter-build/
├── .env                          # All credentials (DO NOT commit)
├── .env.example                  # Template with placeholder values
├── BUILD_PROGRESS.md             # Build session tracker
├── package.json                  # Node.js project config
├── package-lock.json
├── node_modules/
├── sql/
│   ├── 001_schema.sql            # 8 tables, indexes, constraints
│   ├── 002_seed_data.sql         # ops_config defaults, global style, Ashland
│   └── 003_ops_user_role.sql     # Restricted DML-only role
├── src/
│   ├── pipeline.js               # Orchestrator (nightly + weekly + all cities)
│   ├── config/
│   │   ├── db.js                 # Supabase client + SQL helper
│   │   ├── redis.js              # Redis connection + key helpers
│   │   └── anthropic.js          # Anthropic client + model constants + callClaude helpers
│   ├── utils/
│   │   ├── style-config.js       # Style resolution (city → global fallback) + prompt injection
│   │   └── ops-config.js         # ops_config reader (single + batch)
│   ├── agents/
│   │   ├── 01-crawler.js         # Playwright crawl + Haiku classify + dedup
│   │   ├── 02-ingestion-qc.js    # 3-check scoring + threshold gate
│   │   ├── 03-transcription.js   # HTML/PDF/video → text + metadata
│   │   ├── 03b-source-verifier.js # Anti-hallucination: transcript vs raw source
│   │   ├── 04-summarizer.js      # Meeting → 2–5 stories (source_verified only)
│   │   ├── 05a-fact-checker.js   # Opus claim verification
│   │   ├── 05b-tone-checker.js   # Haiku banned phrase + editorial detection
│   │   ├── 06-verdict.js         # Approve/revise/drop + Redis queue
│   │   ├── 07-newsletter-builder.js  # HTML assembly + Beehiiv draft
│   │   ├── 08-story-selector.js  # Priority scoring for ads
│   │   ├── 09a-ad-copy.js        # 3 ad copy variants
│   │   ├── 09b-audience-targeting.js # Facebook targeting brief
│   │   ├── 09c-subject-lines.js  # 2 subject line variants
│   │   └── 10-campaign-assembler.js  # Facebook campaign + Beehiiv schedule
│   └── jobs/
│       └── cleanup.js            # Transcript purge
├── docs/
│   ├── SUPABASE_SETUP.md         # Setup guide
│   ├── REDIS_SETUP.md            # Setup guide
│   └── HANDOFF_DOCUMENT.md       # This file
└── tests/
```

---

## Quick Reference

**Supabase project:** `yfynwejgbyeisharldyk` → https://yfynwejgbyeisharldyk.supabase.co
**Redis:** Upstash `present-sturgeon-97144.upstash.io`
**Beehiiv publication:** `pub_89b58c84-c870-458f-a88a-58ef1682c7e6`
**Edge Functions:** `civic-crawler` (v11), `civic-transcribe` (v7), `civic-transcription-webhook` (v2), `civic-pipeline` (v4), `civic-qc-one` (v1)

### Run the nightly pipeline for Ashland

```js
import { runNightlyPipeline } from './src/pipeline.js';
// Get Ashland's city ID from the cities table first
await runNightlyPipeline('ASHLAND_CITY_UUID');
```

### Run the weekly newsletter + marketing pipeline

```js
import { runWeeklyPipeline } from './src/pipeline.js';
await runWeeklyPipeline('ASHLAND_CITY_UUID');
```

### Add a new city

```sql
INSERT INTO cities (name, seed_url, timezone, send_schedule)
VALUES ('Bend', 'bendoregon.gov', 'America/Los_Angeles', 'weekly');
```

---

*This document was generated by the Build Cowork instance on 2026-04-12. For questions or issues, refer to BUILD_PROGRESS.md for the full build history.*
