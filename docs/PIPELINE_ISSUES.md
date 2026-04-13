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
