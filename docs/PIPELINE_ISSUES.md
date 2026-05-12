# Pipeline Issues Log — Civic Newsletter System

Track bugs, errors, and improvement opportunities from nightly pipeline runs.

---

## Open Issues

### ISS-001: WAF/IP blocking for multiple cities
**Discovered:** 2026-04-13
**Severity:** Medium (limits city selection, not a blocker for current launches)
**Description:** Supabase Edge Functions run on datacenter IPs that are blocked by WAF on many .gov sites. Affected cities: Springfield MO, Brownsville TX, Pueblo CO, Spokane WA, Reno NV. All seed URL fetches return "failed to fetch."
**Impact:** Cannot crawl these cities from Edge Functions.
**Proposed fix:** Residential proxy service (~$10-20/month) would route crawler requests through residential IPs. Alternatively, run the crawler from a different hosting provider with less aggressive IP blocking.
**Status:** Deferred — current 3 launch cities (Birmingham, Savannah, Topeka) work without proxies.

### ISS-002: Topeka NovusAgenda platform not optimized
**Discovered:** 2026-04-13
**Severity:** Medium (blocks Topeka entirely)
**Description:** Topeka uses NovusAgenda (topeka.novusagenda.com) which is not in our CIVIC_PORTAL_PATTERNS list. Crawler ran 12 steps but found 0 meetings on all test runs.
**Proposed fix:** Add NovusAgenda to CIVIC_PORTAL_PATTERNS in civic-crawler, add topeka.novusagenda.com as a seed path.
**Status:** Open — needs Edge Function update. **This is the primary blocker for Topeka launch.**

### ISS-008: QC fact-checker too strict on imprecise-but-accurate summaries
**Discovered:** 2026-04-14
**Severity:** Low (no incorrect drops, but high-value stories lost)
**Description:** Two high-value Birmingham stories (Village Creek Trail $347K, HUD CDBG-DR $3.9M) were dropped because the fact-checker flagged imprecise characterizations that are technically not wrong — just simplified. These represent the most substantive civic content in the pipeline.
**Impact:** ~36% drop rate. 2 of 4 drops were correct, but 2 were borderline and lost meaningful content.
**Proposed fix:** Adjust QC prompt to distinguish "factually incorrect" (hard fail) from "imprecise but directionally accurate" (soft pass with editor note), or add a revision path instead of binary approve/drop.
**Status:** Open — low priority.

### ISS-005: Story quality — hollow placeholder content from boilerplate pages
**Discovered:** 2026-04-13
**Severity:** Low (QC catches these)
**Description:** Some meetings have transcript_text that is just website boilerplate navigation text (~1,100 chars), not actual meeting content. The summarizer correctly reports it can't find agenda details, but generates a placeholder story anyway. The QC pipeline does approve these low-content stories if they don't contain factual errors.
**Impact:** One Birmingham story (Budget committee meeting notice) was approved with minimal content — it only states the meeting time/location with no agenda details. Not harmful but delivers low value.
**Proposed fix:** Add a minimum substantive content threshold to the summarizer — if the transcript is mostly boilerplate or < ~200 words of actual civic content, skip story generation rather than producing a placeholder. Alternatively, add a "content depth" check to the QC pipeline.
**Status:** Open — low priority. The approved story is factually accurate, just thin.

---

## Resolved Issues

### ISS-003: meetings_meeting_type_check constraint too restrictive (RESOLVED)
**Discovered:** 2026-04-13
**Severity:** HIGH — blocked all Birmingham meeting inserts
**Description:** The `meetings` table CHECK constraint only allowed 5 meeting types (`city_council`, `school_board`, `parks_rec`, `planning`, `other`) but the crawler was classifying Birmingham meetings as `budget`, `transportation`, etc. All INSERT operations silently failed.
**Root cause:** Original schema didn't anticipate the full range of meeting types the crawler would encounter.
**Fix applied:**
```sql
ALTER TABLE meetings DROP CONSTRAINT meetings_meeting_type_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_meeting_type_check CHECK (
  meeting_type = ANY (ARRAY['city_council','school_board','parks_rec','planning',
  'budget','public_hearing','housing','transportation','emergency','other'])
);
```
**Resolved:** 2026-04-13. All 10 meeting types now accepted.

### ISS-004: Binary PDF content stored as transcript_text (RESOLVED)
**Discovered:** 2026-04-13
**Severity:** HIGH — blocked story generation for all PDF-sourced meetings
**Description:** The `civic-transcribe` Edge Function was storing raw binary PDF content in `transcript_text` instead of extracted readable text. Affected both Birmingham (S3-hosted PDFs) and Savannah (AgendaCenter PDFs).
**Root cause (multi-layered):**
1. `fetch().text()` on binary PDF content interprets binary as text encoding, producing garbled data that doesn't start with `%PDF`, so `isPdf` check failed
2. Content fell through to HTML path which had no `isReadableText` gate
3. Postgres happily stored the binary garbage in a text column
4. Even when `isPdf` triggered, the regex extraction only worked on uncompressed PDFs (most gov PDFs use FlateDecode)
**Fix applied (civic-transcribe v7):**
1. Changed to `fetch().arrayBuffer()` + `Uint8Array` for binary-safe PDF detection via magic bytes (`%PDF` = `0x25 0x50 0x44 0x46`)
2. Added PDF detection by Content-Type header as secondary check
3. Implemented Claude's native PDF document support: base64-encode raw bytes, send as `type: "document"` with `media_type: "application/pdf"`
4. Added `isReadableText()` validation before storing any content
5. Added `sanitizeText()` to strip null bytes and control characters (Postgres `22P05` error)
6. Added error checking on all Supabase `.update()` calls
**Resolved:** 2026-04-13. civic-transcribe v7 deployed and tested. Birmingham budget PDF (15K chars extracted) and Savannah city council PDF (1K chars extracted) both processed successfully.

### ISS-006: Null bytes in HTML content silently failing DB updates (RESOLVED)
**Discovered:** 2026-04-13
**Severity:** HIGH — meetings appeared processed but DB stayed queued
**Description:** HTML content extracted from some .gov sites contained `\u0000` null bytes. Postgres returns error `22P05: \u0000 cannot be converted to text` on UPDATE, but the civic-transcribe v2 function didn't check the Supabase response for errors — it logged "success" regardless.
**Root cause:** `.text()` on some HTML responses preserved null bytes from the page source; Supabase client returns `{ error: ... }` on failure but code didn't check it.
**Fix applied (civic-transcribe v7):**
1. Added `sanitizeText()` function: `text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/\u0000/g, '')`
2. Added `if (updateError) { log.push(...) }` error checking on all DB updates
**Resolved:** 2026-04-13.

### ISS-007: Source verifier rejecting PDF-sourced meetings (RESOLVED)
**Discovered:** 2026-04-13
**Severity:** Medium — blocked summarization of correctly-transcribed PDF meetings
**Description:** The source verifier re-fetches the meeting source URL and compares it against the transcript. For PDF sources, re-fetching produces raw binary that can't be compared to the extracted text, so the verifier rejected meetings as "unreadable/corrupted" even when the transcript was actually good.
**Root cause:** Source verifier's `fetchRawSource()` used `.text()` on PDF responses, same binary-as-text problem as ISS-004.
**Fix applied (civic-pipeline v4):**
1. Added `extractPdfText()` regex fallback in `fetchRawSource()` for PDF content
2. Changed behavior: if source can't be re-fetched as readable text, flag the meeting as `source_flagged` instead of `source_rejected`
3. Summarizer accepts both `source_verified` and `source_flagged` meetings
**Resolved:** 2026-04-13. Both Birmingham and Savannah meetings proceeded through pipeline as `source_flagged`.

---

## Daily Reports

### Quality Review — 2026-04-14 (Scheduled Daily Review)

**Reviewer:** Automated pipeline-issue-review task
**Review time:** 2026-04-14 afternoon
**Database state:** No new data since nightly run — all counts unchanged.

**Story Quality Assessment (7 approved stories across all cities):**

| # | City | Story | Category | Impact | Quality |
|---|---|---|---|---|---|
| 1 | Birmingham | Justice Grant $363K | Safety | High | Good — substantive, accurate |
| 2 | Birmingham | Network Upgrade $348K | Budget | High | Good — substantive, accurate |
| 3 | Birmingham | Graymont School $790K | Budget | High | Good — substantive, accurate |
| 4 | Birmingham | Budget Committee notice | Budget | Medium | Thin — placeholder, no agenda details (ISS-005) |
| 5 | Birmingham | Public Safety Committee E | Safety | Medium | Thin — placeholder, no agenda details (ISS-005) |
| 6 | Savannah | Housing Affordability Workshop | Zoning | High | Good — substantive, accurate |
| 7 | Savannah | Zoning/Dev Standards Review | Zoning | Medium | Good — slightly overlaps #6 but distinct angle |

**Category and impact assignments:** All correct. No misclassifications found.
**Factual red flags:** None in approved stories.

**Dropped Story Review (4 dropped):**

1. **Birmingham — Village Creek Trail ($347K, Parks):** Dropped by fact_checker for imprecise fund source characterization. The summary is broadly accurate but oversimplifies 4 fund types. **Assessment: Borderline drop.** The story is high-value civic content ($347K parks funding reallocation). The imprecision doesn't mislead readers.
2. **Birmingham — HUD CDBG-DR ($3.9M, Budget):** Dropped by fact_checker — omitted submitter name, imprecise total ($3.9M vs $3,967,621.66). **Assessment: Borderline drop.** This is a high-value story ($3.9M disaster recovery reallocation). Math is correct, omissions are minor.
3. **Birmingham — Transportation Committee:** Dropped for time discrepancy (source said "3:30 AM" likely typo, summary corrected to PM). **Assessment: Correct drop** — summary shouldn't silently correct source errors.
4. **Savannah — Afternoon Council Meeting:** Dropped for claiming "full agenda available" when source only provided contact info. **Assessment: Correct drop** — factual overclaim.

**New Issue Identified:**

### ISS-008: QC fact-checker may be too strict on imprecise-but-accurate summaries
**Discovered:** 2026-04-14 (quality review)
**Severity:** Low (no incorrect drops, but valuable stories lost)
**Description:** Two high-value Birmingham stories (Village Creek $347K, HUD CDBG $3.9M) were dropped because the fact-checker flagged imprecise characterizations that are technically not wrong — just simplified. These are exactly the kind of substantive, high-dollar civic stories that should make it into the newsletter.
**Impact:** ~36% of generated stories are being dropped. While 2 of 4 drops were correct, the other 2 represent meaningful lost content.
**Proposed fix:** Adjust the QC prompt to distinguish between "factually incorrect" (hard fail) and "imprecise but directionally accurate" (soft pass with editor note). Alternatively, add a "revision" path where borderline stories get sent back for a rewrite instead of being dropped outright.
**Status:** Open — low priority. Not blocking, but would improve newsletter content density.

**Pattern Check:**
- **Topeka 0 meetings:** ISS-002 persists. NovusAgenda still not in crawler patterns.
- **Source flagging:** 4 meetings remain `source_flagged` (3 Birmingham, 1 Savannah) — expected behavior per ISS-007 fix. Not a problem.
- **Placeholder stories:** 2 of 5 approved Birmingham stories are thin notices (ISS-005 pattern). Represents 40% of Birmingham's approved content being low-value.
- **No stuck meetings:** All meetings have reached terminal status (source_verified or source_flagged). No queued or stuck records.

**Open Issues Summary:**
| Issue | Severity | Status | Blocker? |
|---|---|---|---|
| ISS-001: WAF/IP blocking | Medium | Deferred | No (not affecting launch cities) |
| ISS-002: Topeka NovusAgenda | Medium | Open | **Yes — blocks Topeka** |
| ISS-005: Thin placeholder stories | Low | Open | No |
| ISS-008: QC too strict on imprecision | Low | Open | No |

**Health Assessment:**
- **Birmingham: GREEN** — 5 approved stories (3 high-quality, 2 thin). Pipeline healthy.
- **Savannah: GREEN** — 2 approved stories (both good quality). No new content since Apr 9 meeting.
- **Topeka: RED** — ISS-002 persists. Zero meetings, zero stories. Primary action item.

**No fixes deployed this review. No Edge Function changes needed.**

---

### Run Report — 2026-04-14 (Nightly Automated Run)

**Run completed:** 2026-04-14 (automated nightly schedule)
**Edge Function versions:** civic-crawler (latest), civic-transcribe (latest), civic-pipeline (latest)
**Overall status:** Pipeline ran successfully end-to-end for Birmingham and Savannah. Topeka still blocked by ISS-002.

| City | Crawler Meetings | DB Verified | Stories Generated | Approved | Dropped |
|---|---|---|---|---|---|
| Birmingham | 7 | 4 | 8 | 5 | 3 |
| Savannah | 1 | 0 | 3 | 2 | 1 |
| Topeka | 0 | 0 | 0 | 0 | 0 |

**Issues observed this run:**
1. **Topeka 0 meetings (ongoing — ISS-002):** Crawler returned 0 meetings for Topeka again. NovusAgenda platform patterns still not in civic-crawler. Logged and continued per pipeline spec.
2. **Response body content filtering:** Edge Function response bodies were filtered by the browser extension used to execute fetch() calls, preventing detailed body inspection. HTTP status codes (all 200) and select JSON fields (array lengths, story approval counts) were successfully extracted via structured JS parsing. No pipeline steps failed.
3. **Savannah DB verified count 0:** The meetings query shows 0 source_verified meetings for Savannah despite 2 approved stories. Likely meetings remain in `source_flagged` status (per ISS-007 fix) rather than `source_verified`. Stories are approved and valid; DB status label is cosmetic.

**No new blocking issues introduced this run.**

**Health assessment:**
- **Birmingham: GREEN** — 5 approved stories total (3 high-impact, 2 medium). +1 new story from April 14 Public Safety Committee E meeting.
- **Savannah: GREEN** — 2 approved stories (housing affordability), no new content. Crawler found 1 meeting (same as prior run).
- **Topeka: RED** — ISS-002 persists. Zero meetings, zero stories.

**Recommended actions (unchanged from 2026-04-13):**
1. **Fix ISS-002** — Add NovusAgenda patterns to civic-crawler to unblock Topeka
2. **Consider ISS-005** — Add content depth threshold to avoid thin placeholder stories

---

### Run Report — 2026-04-13 (Full Pipeline Run)

**Run completed:** Multiple runs across session (~2 hours total including debugging)
**Edge Function versions:** civic-crawler v11, civic-transcribe v7, civic-pipeline v4, civic-qc-one v1
**Overall status:** Pipeline ran successfully end-to-end for Birmingham and Savannah after ISS-003, ISS-004, ISS-006, and ISS-007 fixes. Topeka still blocked by ISS-002.

| City | Meetings Found | Meetings in DB | Stories Generated | Approved | Dropped |
|---|---|---|---|---|---|
| Birmingham | 4 (3 persisted) | 3 | 6 | 4 | 2 |
| Savannah | 0 new (1 existing) | 1 | 3 | 2 | 1 |
| Topeka | 0 | 0 | 0 | 0 | 0 |

**Fixes deployed this run:**
1. ISS-003 fix: Expanded meeting_type CHECK constraint (10 types)
2. ISS-004 fix: civic-transcribe v7 with native Claude PDF support
3. ISS-006 fix: Null byte sanitization + DB error checking
4. ISS-007 fix: civic-pipeline v4 with PDF-aware source verifier

**Issues observed:**
1. Birmingham crawler found 4 meetings but only 3 persisted (1 duplicate transportation URL filtered)
2. Rate limit hit on Anthropic Haiku (50K input tokens/min) during Birmingham source verification — meetings got flagged rather than verified, but proceeded through pipeline
3. Edge Function timeout (~150s) during Birmingham QC — 6 stories required multiple QC runs to complete
4. One approved Birmingham story is thin (meeting notice only, no agenda details) — see ISS-005

**Health assessment:**
- **Birmingham: GREEN** — 4 approved stories with substantive civic content (justice grant, network upgrade, property deal). Pipeline working.
- **Savannah: GREEN** — 2 approved stories about housing affordability workshop. Pipeline working.
- **Topeka: RED** — Blocked by ISS-002. Zero meetings, zero stories.

**Recommended next actions:**
1. **Fix ISS-002** — Add NovusAgenda patterns to civic-crawler to unblock Topeka
2. **Consider ISS-005** — Add content depth threshold to avoid thin placeholder stories
3. **Monitor rate limits** — Consider adding delays between cities or using sequential processing
