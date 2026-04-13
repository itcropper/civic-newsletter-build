# BUILD PROGRESS — AI Civic Newsletter System

**Started:** 2026-04-11
**First city:** Ashland, Oregon
**Target:** Full autonomous pipeline with Supabase + Redis + Beehiiv

---

## COMPLETED

### Phase 1 — Database & Infrastructure
- [x] Project directory structure created (sql/, src/agents/, src/utils/, src/config/, docs/, tests/)
- [x] BUILD_PROGRESS.md initialized
- [x] Postgres schema migration SQL (001_schema.sql): 8 tables — cities, meetings, stories, issues, qc_log, ad_campaigns, style_config, ops_config — with all columns, constraints, indexes per spec
- [x] Seed data SQL (002_seed_data.sql): ops_config defaults (8 rows), global style_config, Ashland city row
- [x] ops_user role SQL (003_ops_user_role.sql): restricted DML-only (SELECT/INSERT/UPDATE/DELETE), no DDL
- [x] Supabase setup guide (docs/SUPABASE_SETUP.md)
- [x] Redis setup guide (docs/REDIS_SETUP.md) — Upstash recommended
- [x] Project scaffolding: package.json, .env.example, config modules (db.js, redis.js, anthropic.js)
- [x] Utility modules: style-config.js (resolve + inject), ops-config.js (read single/batch)

### Phase 2 — Core Pipeline Agents (1–6)
- [x] Agent 1 — Crawler (01-crawler.js): Playwright crawl, Haiku classifier, SHA-256 dedup, robots.txt respect, 1.5s delay, depth-3 recursive, 200-page safety cap
- [x] Agent 2 — Ingestion QC (02-ingestion-qc.js): 3-check scoring (date/length/match = 100pts), adjusted threshold via reliability_score, qc_log on skip
- [x] Agent 3 — Transcription (03-transcription.js): HTML/PDF/video routing, Sonnet coherence check, metadata extraction (governing body, date, officials), min word count gate
- [x] Agent 4 — Summarizer (04-summarizer.js): style_config injection, 2-5 stories per meeting, category/impact/votes extraction, revision support for verdict loop
- [x] Agent 5a — Fact-checker (05a-fact-checker.js): Opus model, exhaustive claim verification against transcript, vote count exact match
- [x] Agent 5b — Tone checker (05b-tone-checker.js): Haiku model, banned phrase detection, editorial/sensational language flagging
- [x] Agent 6 — Verdict (06-verdict.js): parallel 5a+5b, approve/revise/drop logic, revision loop capped at max_revision_loops, Redis queue push on approve

### Phase 3 — Newsletter & Marketing Agents (7–10)
- [x] Agent 7 — Newsletter builder (07-newsletter-builder.js): story ranking (impact → date), lede generation, full newsletter HTML assembly (header/lede/cards/snapshot/upcoming/footer), Beehiiv draft API, issues row creation, Redis queue clear
- [x] Agent 8 — Story selector (08-story-selector.js): priority scoring (impact + category + dollar mention), top 2-3 selection
- [x] Agent 9a — Ad copy writer (09a-ad-copy.js): 3 variants (civic_fact/resident_impact/curiosity), 40-char headline + 90-char body limits, style_config injection
- [x] Agent 9b — Audience targeting (09b-audience-targeting.js): Facebook targeting brief (geo + age + interests + exclusions)
- [x] Agent 9c — Subject line tester (09c-subject-lines.js): 2 variants (specific_fact/civic_hook), 50-char limit, issues row update
- [x] Agent 10 — Campaign assembler (10-campaign-assembler.js): Facebook Ads API campaign structure, A/B test config, Beehiiv draft → scheduled

### Phase 4 — Integration
- [x] Pipeline orchestrator (pipeline.js): nightly (agents 1-6) + weekly (agents 7-10), 8-min city stagger, reliability scoring (EMA), city deactivation at <0.4 after 5 runs
- [x] Cleanup job (jobs/cleanup.js): nightly transcript_text purge per ops_config.transcript_purge_days

## TODO

### Phase 4 — Infrastructure & Testing
- [x] Supabase project created (yfynwejgbyeisharldyk), schema migrated via MCP
- [x] ops_user role created with DML-only permissions (password: CivicOps2026!Secure)
- [x] Seed data loaded: Ashland city, 8 ops_config rows, global style_config
- [x] Redis set up (Upstash: present-sturgeon-97144.upstash.io)
- [x] .env configured with all credentials
- [x] npm install completed (node_modules present)
- [x] Ashland seed URL updated to ashlandoregon.gov (redirect from ashland.or.us)
- [x] Edge Functions deployed: civic-crawler (v4), civic-pipeline (v2), civic-qc-one (v1)
- [x] Agent 4 (Summarizer) tested via Edge Function — 5 stories extracted from 2 meetings (17.3s)
- [!] TEST DATA PURGED (2026-04-12): Investigation found transcript_text was AI-generated during testing, not scraped from real sources. Fabricated name "Samuel Coleman" (fake superintendent) was present. All 5 stories and transcript data purged. Meetings reset to `queued`.
- [x] NEW: Agent 3b — Source Verifier (03b-source-verifier.js) added to prevent transcript fabrication. Re-fetches source URL, compares entities (names, dollar amounts, votes) against raw HTML. Rejects meetings with ungrounded entities.
- [x] Pipeline updated: Agent 3b runs between Transcription (3) and Summarizer (4). Summarizer now only processes `source_verified` or `source_flagged` meetings.
- [x] Edge Function civic-pipeline updated to v2 with source verification step
- [x] Database schema updated: meetings.status CHECK constraint now includes source_verified, source_flagged, source_rejected
- [ ] Crawler timeout issue: Edge Functions have ~150s limit; crawler needs chunked execution for production
- [ ] QC agents need to be invoked server-side (not browser) due to CORS/timeout; works fine for scheduled Ops
- [x] End-to-end re-test completed with Great Bend, KS (see session 2 notes below)

### Session 2 — Multi-city Crawler Testing & E2E Pipeline (2026-04-12/13)
- [x] Crawler rewritten with civic portal auto-detection: CivicClerk, Granicus, Legistar, Boarddocs, PrimeGov, Novus Agenda, CivicPlus, Municode, iQM2
- [x] Video platform detection: YouTube, Vimeo, Telvue, Panopto, Facebook Videos
- [x] `isCivicSubdomain()` added to prevent false positives on marketing sites (e.g., granicus.com)
- [x] `robustParseJSON()` with brace-depth matching and graceful fallback instead of throwing
- [x] Expanded `mapMeetingType()` with budget, public_hearing, housing, transportation, emergency
- [x] Common seed paths expanded: /agendas-minutes, /AgendaCenter, /meetings, /government/agendas-minutes, /boards-commissions, /public-meetings
- [x] Edge Function civic-crawler deployed to v11
- [x] Edge Function civic-transcribe deployed (v2) — TEXT PATH added for non-video content (agendas/minutes)
- [x] Edge Function civic-transcription-webhook deployed (v2) — AssemblyAI async callback handler
- [x] Edge Function civic-pipeline updated to v3 — city_name parameter (was hardcoded to Ashland)
- [x] Tested crawler on 7 cities: Medford OR, Redding CA, Reno NV, Spokane WA, Twin Falls ID, Great Bend KS, Birmingham AL
- [x] WAF/IP blocking identified for Spokane & Reno (datacenter IPs blocked by .gov sites) — deferred, not a launch blocker
- [x] 7 test cities inserted into DB
- [x] **Full end-to-end pipeline test completed for Great Bend, KS** — all via Edge Functions:
  - Crawler (v11): Found 2 city_council meetings (04/06/2026)
  - Transcribe (v2, text path): Extracted 3706 chars from CivicAlerts page
  - Source Verify: fabrication_risk=none, recommendation=pass → VERIFIED
  - Summarize (Sonnet): 2 stories generated (Utilities category)
  - QC: 1 story APPROVED (nitrate water warning, High impact), 1 DROPPED (factual issues with wastewater tour details)
  - Pipeline correctly drops stories with unverifiable claims — QC working as designed

### Phase 5 — Handoff
- [x] Write HANDOFF_DOCUMENT.md (docs/HANDOFF_DOCUMENT.md)
- [x] HANDOFF_DOCUMENT.md updated with session 2 results
- [ ] Schedule Ops Cowork instance
- [ ] Send owner completion summary
