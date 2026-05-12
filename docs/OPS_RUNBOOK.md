# OPS RUNBOOK — AI Civic Newsletter System
**Version:** 2026-04-14
**Intended reader:** Ops Cowork AI instance
**Author:** Build Cowork instance

---

## What This Document Is For

You are an Ops Cowork AI instance. This runbook gives you the full context you need to understand, monitor, and improve the civic newsletter system. Read it before taking any ops action.

This document is intentionally city-agnostic. Never hardcode city names in your work. Always query the `cities` table to determine which cities are active and what their configuration is.

---

## System Purpose and Business Model

This system automates the creation and distribution of AI-generated civic newsletters. It monitors city government meeting pages, extracts and summarizes agenda content, quality-checks every story, assembles weekly newsletters, and grows paid subscribers.

**Revenue model:** $4/month per subscriber (Beehiiv paid subscriptions) + local advertising/sponsorships. The $4/month price is deliberately low-friction. Do not use "free" language.

**Owner:** Ian Cropper (itcropper@gmail.com). Ian is the human decision-maker for anything that requires judgment, spending, or identity verification.

---

## Critical Rule: Your Role Is Observer-First

**The entire nightly and weekly pipeline runs externally — via pg_cron inside Supabase.** You do not need to trigger it. You do not need to run Edge Functions. You do not schedule pipeline steps. The pipeline runs on its own schedule whether or not a Cowork session is active.

Your primary local scheduled task (`pipeline-issue-review`) is the **Observer**. Its only job is to read the system state, identify improvement opportunities, and write recommendations to `docs/OBSERVER_REPORT.md`. It does not trigger pipelines, deploy code, or send messages.

If you find something that needs to be fixed:
- If it's a code/DB/prompt change an AI can do safely → add it to the "Action Items for Ops AI" section of `docs/OBSERVER_REPORT.md`
- If it requires Ian (configure Beehiiv, deploy landing pages, approve spending) → add it to "Action Items for Ian"
- Never act unilaterally on infrastructure changes based solely on Observer findings

---

## Infrastructure Overview

### External Services

| Service | Purpose | Project/ID |
|---------|---------|-----------|
| **Supabase** | Primary database + Edge Function hosting | Project: `yfynwejgbyeisharldyk` |
| **Upstash Redis** | Per-city story queues | Host: `present-sturgeon-97144.upstash.io` |
| **Beehiiv** | Newsletter platform (drafts, sends, subscribers) | Publication: `pub_89b58c84-c870-458f-a88a-58ef1682c7e6` |
| **Anthropic API** | All Claude model calls inside Edge Functions | Secret on civic-orchestrator |
| **AssemblyAI** | Audio/video transcription (meetings with recordings) | Secret on civic-transcribe |
| **Facebook Marketing API** | Ad campaigns (not yet configured) | Ian needs to set up |

### Supabase Edge Functions

All pipeline execution happens in these deployed Edge Functions. They are called by pg_cron automatically.

| Function | Current Version | Role in Pipeline |
|----------|----------------|-----------------|
| `civic-orchestrator` | v1 | Master scheduler — iterates active cities, calls other functions in sequence |
| `civic-crawler` | v11 | Crawls city meeting pages, stores new meetings to DB |
| `civic-transcribe` | v7 | Extracts text from HTML/PDF sources (including binary-safe PDF via Claude native document support) |
| `civic-transcription-webhook` | v2 | AssemblyAI async callback for video transcription |
| `civic-pipeline` | v4 | Source verification + summarization + QC |
| `civic-qc-one` | v1 | Single-story fact-check + tone-check |

**Base URL:** `https://yfynwejgbyeisharldyk.supabase.co/functions/v1/`

### pg_cron Schedule (Fully External — No Local Cowork Involvement)

| Job Name | UTC Schedule | Approximate CT | What It Does |
|----------|-------------|----------------|--------------|
| `civic-nightly-crawl` | 06:00 daily | ~1 AM | Crawls all active cities for new meetings |
| `civic-nightly-transcribe` | 08:00 daily | ~3 AM | Transcribes queued meetings |
| `civic-nightly-pipeline` | 09:30 daily | ~4:30 AM | Source verify + summarize + QC all transcribed meetings |
| `civic-weekly-newsletter` | 15:00 Monday | ~10 AM Mon | Newsletter assembly + Beehiiv draft + ad copy |

To inspect pg_cron history (run via Supabase MCP):
```sql
SELECT jobname, start_time, end_time, status, return_message
FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 20;
```

To manually trigger a pipeline mode (for testing or recovery):
```
POST https://yfynwejgbyeisharldyk.supabase.co/functions/v1/civic-orchestrator
Body: {"mode": "crawl"}   -- or "transcribe", "pipeline", "weekly"
```

---

## Database Reference

**Project ID:** `yfynwejgbyeisharldyk`

Use the Supabase MCP tool (`execute_sql`) to query this project.

### Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `cities` | City registry | `id`, `name`, `active`, `timezone`, `seed_url`, `archive_urls` |
| `meetings` | Crawled meeting pages | `city_id`, `title`, `status`, `transcript_text`, `source_url`, `content_hash` |
| `stories` | Extracted newsletter stories | `city_id`, `meeting_id`, `headline`, `summary`, `context_note`, `category`, `impact_level`, `status`, `drop_reason` |
| `issues` | Assembled newsletter issues | `city_id`, `beehiiv_post_id`, `subject_line`, `subscriber_count_at_send` |
| `qc_log` | QC audit trail | `story_id`, `check_type`, `result`, `reason` |
| `ad_campaigns` | Facebook campaign data | `city_id`, `issue_id`, `campaign_status` |
| `style_config` | Writing style rules | `city_id` (NULL = global), `voice`, `pov`, `banned_phrases` |
| `ops_config` | Operational parameters | `key`, `value` (e.g., `ingestion_threshold`, `max_revision_loops`) |

### Key story statuses (pipeline flow)

`meetings`: `queued` → `transcription_ready` → `source_verified` / `source_flagged` / `source_rejected`

`stories`: `pending` → `approved` / `dropped` / `revised`

### Useful diagnostic queries

```sql
-- Which cities are active and what mode are they crawling in?
SELECT name, active, timezone, seed_url,
  CASE WHEN archive_urls IS NOT NULL THEN 'archive_urls (preferred)' ELSE 'legacy_autonomous (warn)' END as crawl_mode
FROM cities WHERE active = true ORDER BY name;

-- Last 7 days story health per city
SELECT c.name, COUNT(*) total, 
  SUM(CASE WHEN s.status='approved' THEN 1 ELSE 0 END) approved,
  SUM(CASE WHEN s.status='dropped' THEN 1 ELSE 0 END) dropped
FROM stories s JOIN cities c ON s.city_id = c.id
WHERE s.created_at > NOW() - INTERVAL '7 days'
GROUP BY c.name ORDER BY c.name;

-- Stuck meetings (queued >24h)
SELECT c.name, m.title, m.status, m.created_at
FROM meetings m JOIN cities c ON m.city_id = c.id
WHERE m.status NOT IN ('approved', 'dropped', 'source_rejected', 'story_approved')
  AND m.created_at < NOW() - INTERVAL '24 hours'
ORDER BY m.created_at;

-- pg_cron history
SELECT jobname, start_time, status, return_message
FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

---

## Pipeline Architecture

### Nightly flow (Agents 1–6)

```
civic-orchestrator (mode=crawl)
  └── civic-crawler (v11)
        ├── Mode A: archive_urls — visits exact pages from cities.archive_urls array (PREFERRED)
        └── Mode B: legacy autonomous — crawls from seed_url (fallback, unreliable — warns in logs)
        → Inserts new meetings with SHA-256 content_hash dedup

civic-orchestrator (mode=transcribe)
  └── civic-transcribe (v7)
        ├── HTML path: fetch → sanitize null bytes → store transcript_text
        ├── PDF path: arrayBuffer() → magic bytes detect → base64 encode → Claude document API
        └── Video path: AssemblyAI submission → webhook callback

civic-orchestrator (mode=pipeline)
  └── civic-pipeline (v4)
        ├── Agent 03b: Source verifier — transcript vs raw source, flags (not rejects) PDF sources
        ├── Agent 04:  Summarizer — generates 2–5 stories per meeting
        │              Requires: named officials, exact vote tallies, dollar amounts, "what happens next"
        │              Output: {headline, summary, category, impact_level, votes[], context_note}
        ├── Agent 04b: Context enricher — adds neutral factual background to context_note
        │              Uses: Brave Search API (optional) + Claude Sonnet
        │              Rule: neutral language only, max 60 words, NO_CONTEXT if nothing reliable
        ├── Agent 05a: Fact-checker (Opus) — exhaustive claim verification vs transcript
        ├── Agent 05b: Tone-checker (Haiku) — banned phrases, editorial language
        └── Agent 06:  Verdict — approve/revise/drop (max 2 revision loops), approved → Redis queue
```

### Weekly flow (Agents 7–10)

```
civic-orchestrator (mode=weekly)
  ├── Agent 07: Newsletter builder — story ranking, HTML assembly, Beehiiv draft
  ├── Agent 08: Story selector — top 2–3 stories for ad campaigns
  ├── Agent 09a/b/c: Ad copy + audience targeting + subject lines
  └── Agent 10: Campaign assembler — Facebook Ads API + Beehiiv schedule
```

### Models used

| Stage | Model | Reason |
|-------|-------|--------|
| Crawl classification | Haiku | High volume, simple classification |
| Transcription | Sonnet | Medium complexity, HTML/PDF |
| Source verification | Haiku | Pattern matching, low cost |
| Summarization | Sonnet | Substantive writing quality |
| Context enrichment | Sonnet | Research synthesis |
| Fact-checking | Opus | Highest accuracy for truth claims |
| Tone-checking | Haiku | Fast, rule-based |
| Verdict | Sonnet | Synthesis of QC outputs |
| Newsletter / ad copy | Sonnet / Haiku | Balanced quality/cost |

---

## City Onboarding

**Always query the DB** to know what cities are active. Never assume.

```sql
SELECT id, name, active, timezone, archive_urls FROM cities WHERE active = true;
```

### Adding a new city

```sql
INSERT INTO cities (name, active, timezone, seed_url, archive_urls)
VALUES (
  'City Name',
  true,
  'America/Chicago',   -- use IANA timezone
  'https://citywebsite.gov',
  ARRAY[
    'https://citywebsite.gov/meetings/agendas',
    'https://citywebsite.gov/meetings/minutes'
  ]
);
```

**Important:** Always provide `archive_urls` if the city's meeting archive is at known stable URLs. This is Mode A (preferred crawl mode). Mode B (autonomous crawl from `seed_url`) is unreliable and produces unpredictable results. If a new city only has `seed_url`, add a warning to `OBSERVER_REPORT.md` and research the correct archive URL.

### Deactivating a city

```sql
UPDATE cities SET active = false WHERE id = 'city-uuid-here';
```

### When a city is blocked or broken

Cities with WAF/IP blocking from datacenter IPs: consider residential proxy service (~$10-20/month). Currently deferred for non-launch cities.

Cities with unsupported meeting platforms (e.g., NovusAgenda): requires civic-crawler update to CIVIC_PORTAL_PATTERNS. Flag in PIPELINE_ISSUES.md and OBSERVER_REPORT.md.

---

## Key Files

All files are in the workspace folder (`civic-newsletter-build/`):

| File | Purpose |
|------|---------|
| `src/agents/01-crawler.js` | Crawler agent — archive_urls Mode A + legacy Mode B |
| `src/agents/04-summarizer.js` | Summarizer — includes context_note field, requires officials/votes/dollars |
| `src/agents/04b-context-enricher.js` | Context enricher — Brave Search + Claude enrichment |
| `src/pipeline.js` | Local orchestrator (reference only — actual runs via Edge Functions) |
| `sql/001_schema.sql` | Database schema |
| `sql/002_seed_data.sql` | Seed data + defaults |
| `sql/004_city_onboarding.sql` | archive_urls + context_note columns (applied 2026-04-14) |
| `docs/PIPELINE_ISSUES.md` | All bugs found and resolved — canonical issue tracker |
| `docs/OBSERVER_REPORT.md` | Latest Observer run output — overwritten each run |
| `docs/NEWSLETTER_DRAFTS.md` | Approved stories ready for newsletter assembly |
| `docs/HANDOFF_DOCUMENT.md` | Detailed build history and technical reference |
| `landing-pages/*.html` | City landing pages (Birmingham, Savannah, Fargo) |
| `.env` | All credentials (never commit) |

---

## Open Issues (as of 2026-04-14)

See `docs/PIPELINE_ISSUES.md` for full details. Summary:

| Issue | Severity | Status | Blocking? |
|-------|---------|--------|-----------|
| ISS-001: WAF/IP blocking for some cities | Medium | Deferred | No |
| ISS-002: Topeka NovusAgenda not supported | Medium | Closed (Topeka deactivated 2026-04-14) | N/A |
| ISS-005: Thin placeholder stories from boilerplate pages | Low | Open | No |
| ISS-008: QC too strict on imprecise-but-accurate summaries | Low | Open | No |

**ISS-002 resolution:** Topeka was replaced by Fargo, ND (archive_urls: city-commission agendas + planning commission). Fargo uses static HTML archives with no WAF issues.

---

## Actions Only Ian Can Do

Do not attempt these. Add them to "Action Items for Ian" in `OBSERVER_REPORT.md` if they are blocking.

- **Beehiiv embed URL:** Landing pages have `REPLACE_WITH_BEEHIIV_EMBED_URL` placeholder. Ian must get the embed URL from Beehiiv Dashboard → Grow → Forms → Embed URL and replace it in all landing pages. This is blocking all subscriber signups.
- **Netlify deploy:** The Birmingham landing page zip (`birmingham-netlify-drop.zip`) is ready for drag-and-drop at netlify.com/drop. Ian must deploy it.
- **Beehiiv paid tier:** The $4/month subscription tier requires Beehiiv Scale plan upgrade. Ian must enable this.
- **Facebook Marketing API:** Ian needs to complete identity verification on Facebook before the API credentials can be obtained.
- **Anthropic / Beehiiv / AssemblyAI billing:** Any API spending decisions.

---

## What Good Ops Looks Like

**Daily (Observer runs automatically at 8 AM local):**
- Observer reads DB, checks story pipeline health, looks for improvement opportunities
- Writes findings + recommendations to `docs/OBSERVER_REPORT.md`
- Ian reviews OBSERVER_REPORT.md and acts on "Action Items for Ian" as needed

**Weekly (Observer on Monday):**
- Special focus on newsletter assembly output and subscriber metrics
- Review approved stories for lead story nomination
- Suggest subject line and ad copy angle

**When something breaks:**
1. Check `docs/OBSERVER_REPORT.md` for the latest findings
2. Check `docs/PIPELINE_ISSUES.md` for known issues
3. Run the pg_cron history query to see if scheduled jobs failed
4. Check Edge Function logs via Supabase MCP `get_logs`
5. Fix if it's a code/prompt/DB change within your capabilities
6. Escalate to Ian if it requires credentials, spending, or external service changes

---

## Observer Task Configuration

The local Cowork scheduled task `pipeline-issue-review` is configured as the Observer. It runs daily at 8 AM.

**What it does:**
- Queries Supabase DB for pipeline health
- Reads PIPELINE_ISSUES.md and NEWSLETTER_DRAFTS.md
- Checks Edge Function logs for errors
- Analyzes content quality across approved stories
- Looks for growth, marketing, tone, and content improvement opportunities
- Writes a structured report to `docs/OBSERVER_REPORT.md`

**What it does NOT do:**
- Trigger Edge Functions or pipeline runs
- Deploy code changes
- Send emails or messages
- Modify any system state

The Observer output file (`docs/OBSERVER_REPORT.md`) is overwritten each run. It represents the current state of the system as of the last run.

---

## ops_config Parameters

Tuneable via SQL — no code changes needed:

```sql
-- View all
SELECT key, value, description FROM ops_config ORDER BY key;

-- Update a parameter
UPDATE ops_config SET value = '90' WHERE key = 'ingestion_threshold';
```

| Key | Default | Purpose |
|-----|---------|---------|
| `ingestion_threshold` | 60 | Min QC score to pass ingestion (0–100) |
| `max_revision_loops` | 2 | Max tone revision attempts before dropping |
| `min_stories_for_issue` | 3 | Min approved stories to assemble a newsletter |
| `transcript_purge_days` | 30 | Days to keep transcript_text before purge |
| `stagger_minutes` | 8 | Minutes between city pipeline starts |
| `crawl_max_pages` | 200 | Safety cap on pages crawled per city |
| `crawl_delay_ms` | 1500 | Politeness delay between page fetches |
| `weekly_send_day` | monday | Newsletter send day |

---

## Quick Reference

```
Supabase project:  yfynwejgbyeisharldyk
Supabase URL:      https://yfynwejgbyeisharldyk.supabase.co
Edge Functions:    https://yfynwejgbyeisharldyk.supabase.co/functions/v1/
Redis host:        present-sturgeon-97144.upstash.io
Beehiiv pub ID:    pub_89b58c84-c870-458f-a88a-58ef1682c7e6
Observer task ID:  pipeline-issue-review (Cowork scheduled tasks)
Workspace path:    civic-newsletter-build/
```

**To manually trigger pipeline for a specific city:**
```sql
-- Get city ID first
SELECT id, name FROM cities WHERE active = true;
-- Then trigger orchestrator via Edge Function call with city_id in body
```

**To pause the nightly crawl:**
```sql
SELECT cron.unschedule('civic-nightly-crawl');
```

**To resume:**
```sql
SELECT cron.schedule('civic-nightly-crawl', '0 6 * * *',
  $$SELECT net.http_post(url:='https://yfynwejgbyeisharldyk.supabase.co/functions/v1/civic-orchestrator',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:='{"mode": "crawl"}'::jsonb)$$);
```

---

*This runbook was written by the Build Cowork instance on 2026-04-14. Update it when architecture or city configuration changes materially.*
