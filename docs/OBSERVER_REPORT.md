# Civic Newsletter Observer Report
**Date:** 2026-05-12
**Observer run:** Automated scheduled task (pipeline-issue-review)

## Executive Summary

- 🔴 **PIPELINE SILENTLY BROKEN.** pg_cron has fired the orchestrator successfully every day for 28+ days, but ZERO new meetings and ZERO new stories have been created since 2026-04-14. The HTTP 200s in `civic-orchestrator` logs (1–2s execution) hide the fact that nothing is actually getting done downstream. Root cause must be diagnosed in `civic-orchestrator` (v2) — either it's returning early, swallowing worker errors, or `civic-crawler`/`civic-transcribe`/`civic-pipeline` are failing internally.
- 🔴 **ZERO NEWSLETTERS SENT.** The `issues` table is empty. The `civic-weekly-newsletter` cron has fired four Mondays in a row (Apr 20, Apr 27, May 4, May 11) and produced no Beehiiv issue, no `beehiiv_post_id`, no subscriber send.
- 🔴 **REVENUE BLOCKED — Beehiiv CTAs still placeholders.** `birmingham-al.html`, `savannah-ga.html`, and `topeka-ks.html` all still contain `const BEEHIIV_EMBED_URL = 'REPLACE_WITH_BEEHIIV_EMBED_URL'`. Any visitor who clicks "Subscribe — $4/month" hits a JavaScript `alert()` saying "Beehiiv embed URL not configured yet." No conversion is possible.
- ⚠️ **CITY ROSTER EXPANDED FROM 3 TO 13, BUT 9 CITIES HAVE PRODUCED ZERO MEETINGS.** The DB now lists 13 active cities (Ashland, Birmingham, Brownsville, Fargo, Great Bend, Medford, Pueblo, Redding, Reno, Savannah, Spokane, Springfield, Twin Falls). Only 6 have any meetings on record; 9 have nothing at all (including Ashland, which prior project memory says Ian had tested successfully).
- ⚠️ **Most active cities lack `archive_urls`.** Only 3 of 13 (Birmingham, Fargo, Savannah) have archive URLs set. The other 10 are relying on Mode B autonomous crawl, which the task spec flags as unreliable.

---

## Domain 1: Operational Health

### City-by-city status (queried `cities` joined to `meetings`)

| City | archive_urls | Total meetings | Last meeting | Stories approved | Status |
|---|---|---|---|---|---|
| Ashland | (none) | 0 | — | 0 | 🔴 RED — no data ever, despite prior successful test |
| Birmingham | ✅ set | 7 | 2026-04-14 | 5 | ⚠️ YELLOW — data is stale (28 days old) |
| Brownsville | (none) | 0 | — | 0 | 🔴 RED — no archive_urls, no data |
| Fargo | ✅ set | 0 | — | 0 | 🔴 RED — has archive_urls but produced nothing |
| Great Bend | (none) | 2 | 2026-04-13 | 1 | 🔴 RED — stale, Mode B only |
| Medford | (none) | 2 | 2026-04-13 | 0 | 🔴 RED — stuck in `queued` (never transcribed) |
| Pueblo | (none) | 2 | 2026-04-13 | 0 | 🔴 RED — stuck in `queued` |
| Redding | (none) | 0 | — | 0 | 🔴 RED — no archive_urls, no data |
| Reno | (none) | 0 | — | 0 | 🔴 RED — no archive_urls, no data |
| Savannah | ✅ set | 1 | 2026-04-13 | 2 | ⚠️ YELLOW — stale |
| Spokane | (none) | 0 | — | 0 | 🔴 RED — no archive_urls, no data |
| Springfield | (none) | 0 | — | 0 | 🔴 RED — no archive_urls, no data |
| Twin Falls | (none) | 1 | 2026-04-13 | 0 | 🔴 RED — stuck in `queued` |

### Pipeline cadence
- pg_cron jobs (`civic-nightly-crawl` 06:00 UTC, `civic-nightly-transcribe` 08:00 UTC, `civic-nightly-pipeline` 09:30 UTC, `civic-weekly-newsletter` Mon 15:00 UTC) are all `active=true` and have run on schedule every day — confirmed via `cron.job_run_details` for May 3–12. All show `succeeded` with `return_message='1 row'` (the net.http_post insert succeeded; the orchestrator response is not inspected).
- `civic-orchestrator` Edge Function logs show three 200 OK responses in the last 24h with execution times of **1.1s, 1.4s, 2.1s**. Real pipeline work would take much longer (crawler alone runs ~12 steps per city; PDF transcription is multi-second per meeting). Those completion times suggest the orchestrator is either returning early (no-op) or dispatching async fire-and-forget calls that are failing without surfacing errors.

### Meeting backlog
6 meetings are stuck in `queued` (never transcribed): Great Bend (1), Medford (2), Pueblo (2), Twin Falls (1). 4 are in `source_flagged` and 5 in `source_verified` — both terminal per ISS-007.

### Drop reasons (from `qc_log`)
- 2× `source_verifier` rejections for unreadable/corrupted source material (likely PDF re-fetch issue tail of ISS-007)
- 5× `fact_checker` flags for imprecision (the ISS-008 pattern: borderline-but-accurate stories dropped for omitted submitter names, paraphrased fund labels, "full agenda available" claims unverifiable)

### Findings + recommendations
1. **🔴 P0 — Diagnose silent orchestrator failure.** This is the single most important issue. Recommendation: read source of `civic-orchestrator` (function id `801dc952-fae1-4656-a2cb-2f86b0af2b7d`, version 2). Look specifically for: (a) does it actually invoke `civic-crawler` / `civic-transcribe` / `civic-pipeline`, or just return 200 immediately? (b) is it iterating over `cities WHERE active = true`, or hardcoded to Birmingham/Savannah/Topeka? (c) does it `await` each downstream invocation or `.catch(()=>{})` the result? Add proper error capture into a new `orchestrator_runs` table or into `qc_log` with `flagging_agent='orchestrator'` so future runs leave a trace.
2. **🔴 P0 — Backfill `archive_urls` for the 10 active cities lacking them.** Per project memory `feedback_city_onboarding_friction.md`, onboarding must be zero-friction, but `archive_urls=null` forces Mode B autonomous crawl which is documented as unreliable. Cities needing archive URLs: Ashland, Brownsville, Great Bend, Medford, Pueblo, Redding, Reno, Spokane, Springfield, Twin Falls. The Ops AI should research each city's agenda page and `UPDATE cities SET archive_urls = ARRAY[...] WHERE name = '...'`.
3. **🔴 P1 — Investigate why 6 meetings are stuck in `queued`.** They were created 2026-04-13 and never advanced. Either the transcribe step never picked them up, or it failed and didn't update status. Read `civic-transcribe` recent invocations for those `meeting_id` values, or just kick the affected meetings back through with a one-off targeted invocation (after the orchestrator is fixed).

---

## Domain 2: Content Quality

### Sample of approved stories (13 total, 8 approved, 5 dropped — **38% drop rate, above the 30% threshold**)

**Good — substantive, dollar-anchored:**
- Birmingham, "Graymont School Property Deal $790K" — names Jefferson County, names a date (April 21, 2032), states the deal mechanics
- Birmingham, "$348K Network Upgrade" — names PC Connection Sales Corporation, dollar amount $348,575.55, contract term 3 years
- Birmingham, "$363K Federal Justice Grant" — names FY2025 Edward Byrne Memorial JAG Program, dollar amount $363,353, names Jefferson County share

**Thin — placeholder/meeting-notice content (ISS-005 pattern):**
- Birmingham, "Budget and Finance Committee Convenes April 13" — *"No specific agenda items were listed in the available meeting notice. Details on topics to be discussed were not provided in the published agenda."* This is a calendar entry, not a story.
- Birmingham, "Public Safety Committee E Convenes April 14" — *"The agenda has not been detailed in the available source material..."* Same problem.
- 2 of 8 approved stories (25%) are non-substantive notices.

**Borderline drops (ISS-008 pattern still costing high-value stories):**
- Birmingham HUD CDBG-DR ($3.9M reallocation) — dropped because summary said "combined total exceeding $3.9 million" while exact figure was $3,967,621.66, AND because submitter name (Chris Ngigi) was omitted. Fact-checker explicitly noted "No factual error." This was the highest-impact story in the pipeline that week and it was dropped.
- Birmingham Village Creek Trail ($347K Parks reallocation) — dropped over fund-category labeling nuance ("four budget categories" vs. exact fund names like Tuxedo Park Development Donations Fund).

### Structural problems
- **No `context_note` populated on ANY approved story.** All 8 approved stories have `context_note IS NULL`. The pipeline writes the field but the summarizer never fills it.
- **No vote tallies appear in any summary.** Every approved story is a forward-looking "the committee will consider..." item — no story covers a meeting after a vote occurred. This is partly because the source data is agendas (not minutes), but the summarizer prompt should still extract any historical vote references the source includes.
- **No officials named beyond department names.** Mayors, council members, and committee chairs are absent from all 8 approved summaries.

### Findings + recommendations
1. **🟡 Fix the placeholder-notice issue (ISS-005).** Update the summarizer prompt (in `civic-pipeline` v5) to add a hard gate: *"If the source contains no agenda items beyond meeting time/location, return `{generate: false, reason: 'meeting_notice_only'}` instead of producing a story. A story must reference at least one specific agenda item (a proposal, a dollar amount, a named resolution, a vote, or a named official)."*
2. **🟡 Loosen the fact-checker on imprecision-without-error (ISS-008).** In `civic-pipeline` QC step, distinguish: (a) **hard fail** — summary states a fact contradicted by the source (e.g., wrong dollar amount, swapped names, fabricated vote); (b) **soft fail with revision** — summary is technically accurate but omits a key detail (submitter name, exact figure). Soft-fail stories should be sent through one revision pass (`max_revision_loops` is already configured at 2 in `ops_config`) rather than dropped.
3. **🟡 Require `context_note` to be non-empty for approved stories.** Add to summarizer prompt: *"Every story must include a one-sentence `context_note` that explains why this matters to a resident — e.g., 'This is the city's third grant application in 18 months,' or 'Birmingham last reallocated CDBG-DR funds in 2023.' If no context can be sourced, return `context_note: 'Background context unavailable.'`"* Then add a QC check that rejects stories with `context_note IS NULL`.
4. **🟡 Add a mandatory-fields check in QC.** Reject any approved story that has zero of {dollar amount, named official, named department, vote tally, specific date}. The two thin Birmingham notices would have been caught.

---

## Domain 3: Growth and Subscriber Acquisition

### Findings
**The single highest-priority issue in this entire report: subscriber acquisition is impossible right now.**

- `landing-pages/birmingham-al.html` line 41: `const BEEHIIV_EMBED_URL = 'REPLACE_WITH_BEEHIIV_EMBED_URL';`
- `landing-pages/savannah-ga.html`: same placeholder
- `landing-pages/topeka-ks.html`: same placeholder (Topeka was removed from `cities WHERE active=true` but the landing page still exists)
- The `handleSubscribe` JS function explicitly detects the placeholder and shows `alert('Beehiiv embed URL not configured yet...')`. Any visitor who clicks subscribe gets a JS alert and no signup happens.
- The new active cities (Ashland, Brownsville, Fargo, Great Bend, Medford, Pueblo, Redding, Reno, Spokane, Springfield, Twin Falls) have **no landing page at all** in `landing-pages/`.

### Growth experiment recommendation for this week (Ian)
**Pick one launch-ready city and ship a working signup flow end-to-end before adding more cities or fixing the pipeline.** Suggested target: **Birmingham**, because it has the most approved-story inventory.

Step-by-step:
1. Log into Beehiiv → create the Birmingham publication (if not done) → Grow → Forms → New Embedded Form. Use a simple email-only form.
2. Copy the embed URL (format `https://embeds.beehiiv.com/<uuid>`).
3. In `landing-pages/birmingham-al.html`, replace `'REPLACE_WITH_BEEHIIV_EMBED_URL'` (line 41) with that URL. Push to Netlify (the `netlify-deploy/` folder exists and `birmingham-netlify-drop.zip` is staged).
4. Once that flow works, repeat for Savannah and one new city.
5. Post one Reddit thread in r/Birmingham titled "I'm building an AI-curated weekly digest of city council decisions — want to help me beta test?" Link to the landing page. Aim for 5 signups by week-end. This is enough to validate the funnel without spam.

### Other growth channels appropriate for civic newsletters (defer until signup works)
Reddit threads in city-specific subs, Nextdoor neighborhood posts, local Facebook groups (especially "What's happening in [city]" community pages), neighborhood-association email lists, the local-news subreddit cross-post, and reaching out to civic-engagement Twitter/X accounts that follow city government decisions.

---

## Domain 4: Marketing and Positioning

### Findings
- **Price**: $4/month, displayed on the subscribe button. For a hyper-local weekly digest of city council decisions, this is defensible but not yet justified by the content — three substantive stories and two placeholder notices per week is not yet a $4 product. Consider a "first month free" trial.
- **Name**: "Birmingham Civic Weekly" is on-brand and clear. The header uses an "uppercase tracking-wide" styling that reads professional. No changes recommended for the name itself.
- **No newsletter has actually been sent yet** (`issues` table empty). All marketing copy on the landing page promises a product that has not shipped.
- **Recommended lead story for the next Birmingham send** (whenever the pipeline runs again): Graymont School Property Deal — $790K, names Jefferson County, has a specific 2032 deadline, and shows the city is willing to pay to preserve property control. This is the most substantive story in inventory.

### Subject line suggestion for the first Birmingham send
*"Birmingham just put $790K on the line for the old Graymont School — and 4 other things your council decided this week"*

Pattern: lead with a single dollar-anchored decision, then promise the rest as a list. This is a high-CTR format for hyper-local newsletters and forces the editorial team to keep the lead story substantive.

### Seasonal hooks (for May 2026)
- Local budget cycles for FY2026–27 are typically finalized May–June in most US cities. Watch for budget hearings in Birmingham, Savannah, Fargo — these are high-CTR content. Update the summarizer to look for budget-meeting keywords as a priority signal.
- Many cities hold primary elections in May–June. If any active city has an upcoming primary, that's a natural growth moment (residents are paying attention).

---

## Domain 5: Tone and Editorial Quality

### Findings
Every approved summary reads like a government press release, not a newsletter. Pervasive patterns:
- *"The committee will consider..."* — appears in 6 of 8 approved summaries. Passive, process-focused.
- *"The agreement would not exceed $348,575.55 over its term."* — bureaucratic phrasing.
- *"No specific agenda items were listed in the available meeting notice. Details on topics to be discussed were not provided in the published agenda."* — Two-sentence apology.
- No use of second person ("your council," "your tax dollars," "your neighborhood").
- No use of impact-first openings ("Birmingham could spend $790K to keep control of the old Graymont School").

### Recommendation: revise the summarizer prompt's tone section
Replace the current summarizer prompt's tone guidance with this (or add it as a new section if no tone block exists):

> **Tone requirements (mandatory):**
> 1. **Lead with impact, not process.** Open with what changes for residents, not with "the committee will consider." Example: ❌ "The committee will consider an agreement..." → ✅ "Birmingham could pay Jefferson County $790,000 to keep control of the former Graymont School site."
> 2. **Use active voice and present tense where the source allows.** ❌ "An agreement would be considered..." → ✅ "The council is weighing..."
> 3. **Address the reader directly when natural.** Use "your city," "your tax dollars," or the city name with possessive framing. Do not overuse — once per story is plenty.
> 4. **No bureaucratic placeholders.** If the source only contains meeting time/location with no agenda detail, return `{generate: false, reason: 'meeting_notice_only'}` instead of writing a notice-style summary.
> 5. **Lead sentence must contain at least one of:** a dollar amount, a named person, a named place residents would recognize, or a specific deadline. If none of these is available in the source, do not generate a story.

### Sample rewrite (Graymont story)
- **Current (approved):** "The committee will consider an agreement with Jefferson County to release a restrictive covenant and reversionary interest on the former Graymont School property. In exchange, the city would agree to pay the county $790,000..."
- **Rewritten:** "Birmingham could pay Jefferson County $790,000 this month to lock in long-term control of the old Graymont School site. Under the proposed agreement, the city only owes the money if it stops using the property for a public purpose before April 21, 2032 — giving the council seven years of flexibility on what comes next for the site. The Budget and Finance Committee takes up the deal Monday."

---

## Action Items for Ian (human-only)

1. **🔴 Configure the Beehiiv embed URL for Birmingham (and Savannah).** Specifically: in Beehiiv, create the publication if needed → Grow → Forms → New Embedded Form → copy the embed URL → replace `'REPLACE_WITH_BEEHIIV_EMBED_URL'` on line 41 of `landing-pages/birmingham-al.html` (and the equivalent line in `savannah-ga.html`). Without this, no subscriber acquisition is possible. **This is the #1 revenue blocker.**
2. **🔴 Decide whether to deactivate the 9 zero-meeting cities or commit to filling in archive_urls for them.** Per project memory, onboarding should be zero-friction, but `archive_urls = NULL` forces unreliable Mode B crawling. If you don't want to provide URLs, you should mark those cities `active = false` until the autonomous crawler is reliable enough.
3. **🟡 Confirm Topeka removal is intentional.** Topeka is not in the active cities list, but `landing-pages/topeka-ks.html` still exists. If Topeka is dead, delete the page or redirect.
4. **🟡 Decide on a "first month free" or trial flow** before the first newsletter ships. Sending a paywall behind unproven content is a high-friction conversion path.

## Action Items for Ops AI (autonomous)

1. **🔴 Read `civic-orchestrator` source (function id `801dc952-fae1-4656-a2cb-2f86b0af2b7d`, version 2) and diagnose why nightly runs produce no new meetings or stories.** Specific things to check: (a) does it loop over `cities WHERE active=true`, or is it hardcoded to a 3-city list? (b) does it actually invoke `civic-crawler` / `civic-transcribe` / `civic-pipeline` via `fetch`, or is it stubbed? (c) does it await/log errors from the worker calls? Add structured error logging into a new `pipeline_runs` table (`run_id, mode, city_id, started_at, finished_at, status, error_message`) so future Observer runs can see what happened.
2. **🔴 Re-run the pipeline for the 6 stuck `queued` meetings** (Great Bend × 1, Medford × 2, Pueblo × 2, Twin Falls × 1) once the orchestrator is fixed. Specifically: invoke `civic-transcribe` with the affected `meeting_id` values. If the transcribe step fails repeatedly, log the error and downgrade the meeting to `transcribe_failed` status (will need a new constraint value if not present).
3. **🔴 Update the summarizer prompt in `civic-pipeline` (function id `75f55d2d-69f3-428d-8623-94a0b60e7cf4`, version 5) with the tone changes in Domain 5 above, the mandatory-fields rule in Domain 2 rec #4, and the `context_note` requirement in Domain 2 rec #3.** Also add the `meeting_notice_only` skip rule from Domain 2 rec #1.
4. **🟡 Loosen the fact-checker to add a soft-fail revision path** instead of dropping on imprecision-without-error. `max_revision_loops` in `ops_config` is already set to 2 but the pipeline does not appear to use it for QC; route soft-fail stories through one revision instead of straight to `dropped`.
5. **🟡 Add a content-depth gate to the summarizer** (ISS-005): if `LENGTH(transcript_text) < 200` of substantive civic content (after stripping boilerplate nav), skip story generation rather than producing a placeholder.
6. **🟡 Populate `archive_urls` for active cities lacking them.** Where Ops AI can autonomously identify a city's agenda page (e.g., via search), update the row: `UPDATE cities SET archive_urls = ARRAY['<url1>','<url2>'] WHERE name = '<city>'`. Cities to research: Ashland, Brownsville, Great Bend, Medford, Pueblo, Redding, Reno, Spokane, Springfield, Twin Falls.
7. **🟡 Add a story-quality monitoring view.** Create a SQL view `story_quality_audit` that flags approved stories where summary lacks any dollar amount, named person, or named place. This gives the Observer a deterministic content-quality signal next run.

---

## Unchanged Open Issues (from `PIPELINE_ISSUES.md`)

- **ISS-001** — WAF/IP blocking on Edge Function datacenter IPs (Springfield, Brownsville, Pueblo, Spokane, Reno). Status: Deferred. **Re-evaluate now** — those cities are no longer "deferred" because they're now in the active set.
- **ISS-002** — Topeka NovusAgenda not in CIVIC_PORTAL_PATTERNS. Status: Open. **Likely moot** — Topeka is no longer in active cities. Recommend closing.
- **ISS-005** — Hollow placeholder stories from boilerplate pages. Status: Open. Addressed in Domain 2 rec #1 and Ops AI item #5.
- **ISS-008** — QC fact-checker too strict on imprecise-but-accurate summaries. Status: Open. Addressed in Domain 2 rec #2 and Ops AI item #4.
