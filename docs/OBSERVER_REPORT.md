# Civic Newsletter Observer Report
**Date:** 2026-05-13
**Observer run:** 2026-05-13 (scheduled task: pipeline-issue-review)

## Executive Summary

- **🔴 BLOCKING REVENUE:** All three published landing pages (`birmingham-al.html`, `savannah-ga.html`, `topeka-ks.html`) still carry the literal string `REPLACE_WITH_BEEHIIV_EMBED_URL`. Subscribers who click "Subscribe" get a JavaScript alert telling them the form is not configured. Zero signups are possible. This has been outstanding since at least 2026-04-13.
- **🔴 OPERATIONAL GAP:** 13 cities are marked `active=true` but only 5 have ever produced a meeting row, and only 3 have produced an approved story in the last 30 days (Birmingham 5, Savannah 2, Medford 1). Ashland, Brownsville, Fargo, Reno, Spokane, Springfield have **zero** meetings ever, despite being active. Fargo is the worst case — it has `archive_urls` configured and still 0 meetings.
- **⚠️ CONTENT QUALITY:** The single story produced in the last 24 hours (Medford, today) is a placeholder that explicitly admits in its own text that "No agenda, minutes, or discussion content were available." It was approved anyway. This is ISS-005 (thin placeholder stories) being approved at the rate of 100% of today's output.
- **⚠️ PIPELINE THROUGHPUT:** Today's run produced 6 new meetings (Medford 2, Redding 4) but only 1 story. Redding has 1 `source_verified` + 2 `queued` + 2 `skipped` meetings and no stories — the pipeline is leaving verified content on the floor.
- **⚠️ RELIABILITY BLIP:** civic-orchestrator returned 502 with a 145s execution time at ~04:02 UTC on 2026-05-13 (timeout). Subsequent runs at 06:02 and 07:32 UTC succeeded. Not currently failing, but worth a retry/timeout review.

---

## Domain 1: Operational Health

**Active cities (13):** Ashland, Birmingham, Brownsville, Fargo, Great Bend, Medford, Pueblo, Redding, Reno, Savannah, Spokane, Springfield, Twin Falls. *(Topeka is no longer active.)*

**Per-city status:**

| City | Status | Meetings (ever) | Stories (30d) | Notes |
|---|---|---|---|---|
| Birmingham | ✅ GREEN | 11 (4 verified, 7 flagged) | 5 approved / 3 dropped | Healthy. Latest crawl 2026-05-12. |
| Medford | ⚠️ YELLOW | 4 (all verified) | 1 approved (today) | Only 1 of 4 verified meetings became a story. Story is a hollow placeholder. |
| Savannah | ⚠️ YELLOW | 1 (flagged) | 2 approved / 1 dropped | No new meetings since 2026-04-13. Crawler not picking up fresh agendas. |
| Redding | ⚠️ YELLOW | 5 (1 verified, 2 queued, 2 skipped) | 0 | First successful crawl 2026-05-13. Pipeline did not advance verified meeting → story. |
| Great Bend | ⚠️ YELLOW | 2 (1 verified, 1 flagged) | 0 (last story 2026-04-13) | Stale. Last activity April. |
| Pueblo | 🔴 RED | 2 (flagged) | 0 | No verified meetings. ISS-001 (WAF) candidate. |
| Twin Falls | 🔴 RED | 1 (verified) | 0 | Verified meeting from April 13, never became a story. |
| Ashland | 🔴 RED | 0 | 0 | Never crawled. No `archive_urls` set. |
| Brownsville | 🔴 RED | 0 | 0 | Never crawled. ISS-001 (WAF) confirmed. |
| Fargo | 🔴 RED | 0 | 0 | **`archive_urls` ARE set** — still 0 meetings. Crawler is broken for fargond.gov pattern. |
| Reno | 🔴 RED | 0 | 0 | Never crawled. ISS-001 (WAF) confirmed. |
| Spokane | 🔴 RED | 0 | 0 | Never crawled. ISS-001 (WAF) confirmed. |
| Springfield | 🔴 RED | 0 | 0 | Never crawled. ISS-001 (WAF) confirmed. |

**Findings:**

1. **`archive_urls` coverage is poor.** Only 3 of 13 active cities (Birmingham, Fargo, Savannah) have `archive_urls` populated. Per `feedback_city_onboarding_friction.md`, new cities should be added with name + details + archive URLs only — the 10 cities without archive URLs were activated against that policy and are relying on the unreliable Mode B autonomous crawl. Recommendation: either populate `archive_urls` for all 10 (Ashland, Brownsville, Great Bend, Medford, Pueblo, Redding, Reno, Spokane, Springfield, Twin Falls) or flip `active=false` on the cities that won't be launched in the next two weeks.
2. **Fargo is a regression.** Fargo has `archive_urls` set to fargond.gov agendas/minutes pages, yet 0 meetings exist. Crawler is finding no meetings on that domain pattern. Recommendation: a developer should manually run `civic-crawler` against Fargo and capture the response — either the page structure changed or `fargond.gov` is not in CIVIC_PORTAL_PATTERNS.
3. **Approve/drop ratio:** Birmingham 5/8 = 63% approve, Savannah 2/3 = 67%, Medford 1/1 = 100%, Great Bend (April) 1/2 = 50%. Overall recent: 9/14 = 64% approved. Healthier than the April baseline of ~36% drop, but largely because the dropped Birmingham stories from April are no longer regenerating.
4. **Stuck meetings:** Redding has 2 meetings in `queued` status created 2026-05-13 06:03 — about 4 hours old at observer run time. Not yet stuck (threshold is >24h) but Redding's `source_verified` meeting from the same crawl should already have produced a story attempt. The pipeline did not chain crawl → transcribe → story for Redding.
5. **502 timeout on civic-orchestrator (2026-05-13 04:02 UTC, 145s):** Orchestrator hit a timeout once before two later runs succeeded. The 2-minute orchestrator runs (127s and 128s) are close to the Edge Function timeout ceiling. Recommendation: split orchestrator into per-city invocations or move orchestration to a queue-driven model before adding more cities.
6. **401 errors on civic-crawler (2026-05-12 ~14:33 UTC):** Two 401s on civic-crawler appear before the function transitioned to authenticated invocations. Self-resolved; no action needed unless they recur.
7. **No `issues` table activity:** The `issues` table has 0 rows — no newsletter has ever been published. Beehiiv send pipeline either has not run or has not been built. Combined with the embed-URL placeholder finding, there is no end-to-end revenue path live.

---

## Domain 2: Content Quality

**Recent approved-story sample (all 9 approved across the cohort):**

Strong, substantive content (3 stories, all Birmingham, 2026-04-13):
- **Justice Grant $363K** — names the program (Edward Byrne Memorial JAG), the agency (US DOJ), the exact dollar amount ($363,353), a secondary recipient (Jefferson County, $77,636), and the policy point (no local match required). Excellent.
- **Network Upgrade $348K** — names the vendor (PC Connection Sales Corporation), the contract term (3 years), exact ceiling ($348,575.55), and the submitting department (Information Management Services). Excellent.
- **Graymont School $790K** — names the counterparty (Jefferson County), the exact figure ($790,000), the legal mechanism (restrictive covenant and reversionary interest), and the trigger date (April 21, 2032). Excellent.

Thin/hollow content (3 stories that were approved despite being placeholders):
- Birmingham **Budget and Finance Committee notice** (2026-04-13, approved Medium/Budget) — summary literally states "No specific agenda items were listed."
- Birmingham **Public Safety Committee E** (2026-04-14, approved Medium/Safety) — "The agenda has not been detailed in the available source material."
- Medford **Study Session April 8** (2026-05-13, approved Medium/Other) — "No agenda, minutes, or discussion content were available in the provided source material. The actual topics considered during the session cannot be reported without access to the corresponding agenda or transcript."

**The Medford story is the most egregious example yet.** It admits inside its own body text that there is nothing to report, then gets approved. This is ISS-005 in production. The QC pipeline is approving stories that explicitly say they have no content.

**Drop reasons sample (from qc_log):** All 4 dropped stories with detailed reasons came from `fact_checker`, all related to imprecision rather than incorrectness. ISS-008 (fact-checker too strict on imprecise-but-accurate) is still active but has not produced new drops in the last 30 days because no new Birmingham budget meetings have been transcribed since April 14.

**Recommendations:**

1. **Add a content-depth gate in the summarizer.** Before generating a story, count substantive tokens in `transcript_text` (exclude boilerplate, navigation, headers). If fewer than ~200 substantive words remain after stripping, return a `skipped` signal instead of generating a placeholder. Specifically:
   - File: civic-pipeline Edge Function, summarizer step
   - Logic: `if (substantive_word_count(transcript) < 200) { return { skip: true, reason: 'insufficient_content' } }`
   - The QC fact-checker is the wrong place — it can only validate factual claims, not subjective "is this worth reading."
2. **Add a self-disqualifying phrase filter at the approval step.** If a generated summary contains phrases like "no agenda items were listed," "no content was available," "agenda has not been detailed," "topics cannot be reported" — auto-drop with reason `placeholder_content`. Today's Medford story would have been caught by this filter.
3. **Re-examine `context_note` usage.** Every story in the sample has `context_note = null`. The column exists, the summarizer is not populating it. This is the field where the editorial note (significance, what's at stake) belongs. If the prompt does not request a context note, add it.

---

## Domain 3: Growth and Subscriber Acquisition

**Findings:**

1. **🔴 CTAs are placeholder.** Every landing page in `landing-pages/` (Birmingham, Savannah, Topeka) still contains `BEEHIIV_EMBED_URL = 'REPLACE_WITH_BEEHIIV_EMBED_URL'`. The `handleSubscribe` function in each file explicitly checks for this placeholder and shows a JavaScript `alert()` instead of submitting. **Every visitor who tries to subscribe is told the form is not configured.** This is the single highest-leverage thing to fix.
2. **Landing pages are not deployed.** No deploy artifacts beyond a `netlify-deploy/` folder and a `birmingham-netlify-drop.zip`. No record of subscribers because there is no live form. Per `feedback_deploy_to_match_expectations.md`, code expected in production must actually be in production.
3. **No paid acquisition has run.** `ad_campaigns` table has 0 rows. `AD_SUBMISSION.md` exists in docs but no Facebook campaign IDs in the DB. Plus, MEMORY notes the project is blocked on FB verification.
4. **No reference to Topeka landing page being retired.** `topeka-ks.html` still exists in the landing pages folder even though Topeka is no longer an active city. This is a confusing artifact for any reader.

**This week's growth experiment recommendation (specific, low-effort):**

**Birmingham subreddit organic post.** Birmingham has 3 high-quality, dollar-specific stories ready to publish (Justice Grant $363K, Network Upgrade $348K, Graymont $790K). Total dollar figure across stories: $1.5M — that's a strong hook for r/Birmingham.

Step-by-step:
1. Fix Beehiiv embed URL in `birmingham-al.html` (this is a prerequisite — without it, the post drives no signups).
2. Deploy `birmingham-al.html` to a stable URL (e.g., `birmingham.civicweekly.com` if Vercel deploy is unblocked, otherwise a Netlify drop).
3. Write a single Reddit post in r/Birmingham titled something like: *"Three big city council items I'm tracking this week: $363K federal grant, $790K Graymont school deal, $348K network contract"*. Body: 1–2 sentences per item with the dollar figure and the question "Worth following?" Link to the landing page at the bottom as "I'm building a free weekly digest if you want this every Monday."
4. Engage in the comments. Do not link-drop.
5. Track signups for 48 hours. Target: 25 signups from a single post.

Why this works: Reddit moderators in city subs generally ban open promotion but tolerate genuine civic-engagement content with one soft link. The dollar figures are concrete and clickable. The newsletter offers something the subreddit cannot (curation + summary).

---

## Domain 4: Marketing and Positioning

**Findings:**

1. **Newsletter naming is generic.** "Civic Weekly" / "Birmingham Civic Weekly" tests as low-distinction. No tagline in the landing page title beyond "Stay Informed on City Hall."
2. **Value proposition is strong but buried.** The landing page meta description is good: "A free weekly digest of Birmingham city council decisions, budget votes, zoning changes, and public safety updates — fact-checked and clearly explained." Recommendation: surface "fact-checked" higher — the QC pipeline is a real differentiator vs. the noise on Nextdoor and Facebook groups.
3. **$4/month price point is not visible on the landing pages.** The pages read as a free signup. If the long-term plan is paid, the free vs. paid distinction should appear before launch — or the price should be confirmed as $0 for the MVP.

**Lead story for next Birmingham send:** **Graymont School Property Deal: $790K County Buyout on the Table** — biggest single dollar figure, clearest stakes (city pays $790K to clear a covenant on a former school), specific named counterparty (Jefferson County), and a real future deadline (April 21, 2032). Bigger civic question (what happens to old school buildings) gives the story long legs.

**Subject line suggestion for that lead:** *"Birmingham could pay $790K to keep an old school — here's the deal on the table"* — concrete dollar figure, local specificity, curiosity gap, no clickbait. Apply this formula to future leads: *"[City] could [action] $[dollar figure] for [thing] — [why now]"*.

---

## Domain 5: Tone and Editorial Quality

**Findings:**

Every approved story this cohort opens with one of these construction patterns:
- "The committee will consider…"
- "The Birmingham City Council's [Committee] is scheduled to meet…"
- "The Mayor and Aldermen of Savannah will conduct…"
- "The City of Medford City Council held…"

This is press-release voice. Passive, agenda-style, no impact framing. Compare to a newsletter voice for the Graymont story:

Current (passive): *"The committee will consider an agreement with Jefferson County to release a restrictive covenant and reversionary interest on the former Graymont School property. In exchange, the city would agree to pay the county $790,000…"*

Newsletter voice (recommended): *"Birmingham could pay Jefferson County $790,000 to clear the last legal strings on the former Graymont School. If the city stops using the property for a public purpose before April 2032, the county collects."*

**Specific tone adjustment for the summarizer prompt.** In the civic-pipeline summarizer system prompt, add the following section (current `style_config` has `voice='neutral'`, `pov='third_person'` — these should be loosened):

```
TONE REQUIREMENTS:
- Lead with the impact, not the agenda. Start with what could happen, not what the committee will discuss.
- Use active voice with the city or the official as the subject. ("Birmingham could pay..." not "An agreement will be considered...")
- Name the dollar figure in the opening sentence whenever one exists.
- Avoid "the committee will consider" / "is scheduled to meet" / "will discuss" as opening constructions.
- Keep the second sentence concrete: who, when, the consequence if approved.
- Maintain factual neutrality. Do not editorialize beyond what the source supports.
```

The `style_config` row should also be updated: change `voice` from `neutral` to `warm` and add a `custom_prompt_suffix` reinforcing the active-voice rule.

---

## Action Items for Ian

1. **Fix the Beehiiv embed URL.** Open `birmingham-al.html`, `savannah-ga.html`, and `topeka-ks.html`. Replace `'REPLACE_WITH_BEEHIIV_EMBED_URL'` with the actual Beehiiv embed URL from Dashboard → Grow → Forms → [Form] → Embed URL. Until this is done, no subscriber acquisition is possible.
2. **Decide on Topeka landing page.** Topeka is no longer an active city. Either delete `topeka-ks.html` or move it into an `archive/` subfolder so it doesn't ship with the deploy.
3. **Deploy the Birmingham landing page.** Vercel deploy is reportedly blocked (per MEMORY). Either resolve the Vercel block or do a Netlify drop using the existing `birmingham-netlify-drop.zip`. Without a live URL there is no place to send subscribers.
4. **Resolve the Facebook verification block** (per MEMORY) or decide to skip paid acquisition for v1 and lean on the Reddit experiment in Domain 3.
5. **Decide whether to keep 10 cities active without `archive_urls`.** Either populate their archive URLs or flip them to `active=false` to keep the operational picture honest.

## Action Items for Ops AI

1. **Add a content-depth gate before story generation.**
   - Where: civic-pipeline Edge Function, summarizer entry point.
   - What: Reject transcripts with fewer than 200 substantive words (after stripping nav/boilerplate) before calling Claude. Mark the meeting `skipped` with a reason like `insufficient_content`.
   - Why: Three of three placeholder approvals (Birmingham Budget notice, Birmingham Public Safety E, Medford Study Session) all came from boilerplate-only transcripts. The summarizer correctly notes the lack of content; the QC pipeline incorrectly approves it.
2. **Add a self-disqualifying-phrase filter at the QC approval step.**
   - Where: civic-qc-one Edge Function, fact_checker or final approval logic.
   - What: If the generated summary contains any of these strings — "no agenda items were listed", "no content was available", "agenda has not been detailed", "topics cannot be reported", "no actual topics considered" — auto-drop with reason `placeholder_content`.
3. **Diagnose and fix Fargo crawler.**
   - Where: civic-crawler Edge Function, CIVIC_PORTAL_PATTERNS list.
   - What: Run civic-crawler manually for Fargo and capture the trace. Most likely `fargond.gov` (which uses a CivicPlus pattern under `/city-government/departments/city-commission/agendas-minutes`) needs to be added to or refined in CIVIC_PORTAL_PATTERNS. Compare to the patterns that work for Birmingham (also CivicPlus-like) for the fix shape.
4. **Update the summarizer prompt to use active voice and impact-first leads.**
   - Where: civic-pipeline summarizer, system prompt.
   - What: Append the TONE REQUIREMENTS block from Domain 5 above.
   - Also: `UPDATE style_config SET voice = 'warm', custom_prompt_suffix = 'Lead each story with the impact and dollar figure. Use active voice. Never open with "The committee will consider".' WHERE scope = 'global';`
5. **Populate `context_note` on story generation.**
   - Where: civic-pipeline summarizer.
   - What: Have the summarizer emit a one-sentence `context_note` per story explaining *why this matters now* (e.g., for the Graymont story: "Birmingham has reused several former school properties for civic use; this clears the legal path for future redevelopment.").
6. **Trigger story generation for stranded `source_verified` meetings.**
   - Where: civic-orchestrator, post-transcribe step.
   - What: Redding has a `source_verified` meeting from 2026-05-13 06:02 UTC with no corresponding story attempt. Twin Falls has had one stuck since 2026-04-13. The orchestrator should ensure every `source_verified` meeting either has a story row or a logged failure within 4 hours. Add a backfill query: `SELECT m.id FROM meetings m LEFT JOIN stories s ON s.meeting_id = m.id WHERE m.status = 'source_verified' AND s.id IS NULL AND m.created_at < NOW() - INTERVAL '4 hours';` — process any rows it returns.
7. **Soften the fact-checker for imprecise-but-accurate claims (ISS-008).**
   - Where: civic-qc-one Edge Function, fact_checker prompt.
   - What: Distinguish "factually incorrect" (hard drop) from "imprecise but directionally correct" (approve with `context_note` flag). The two Birmingham stories ($347K Village Creek, $3.9M HUD CDBG) that were lost in April fell in the second bucket and would have been the strongest content of the week.
8. **Add Redding (`reddingca.granicus.com`) and Medford (`medfordoregon.gov`) to `archive_urls`.**
   - Where: `UPDATE cities SET archive_urls = ARRAY[...] WHERE name IN ('Redding', 'Medford');`
   - What: Both cities crawled successfully on 2026-05-13 without `archive_urls`, but Mode B is unreliable per project history. Lock in the source URLs that worked: Redding → `https://reddingca.granicus.com/ViewPublisher.php?view_id=4`; Medford → `https://www.medfordoregon.gov/Government/Agendas-and-Minutes/Parks-and-Recreation-Commission` and `https://www.medfordoregon.gov/Government/Agendas-and-Minutes/Site-Plan-and-Architectural-Commission`.

---

## Unchanged Open Issues

- **ISS-001** (WAF/IP blocking for Springfield, Brownsville, Pueblo, Spokane, Reno) — Deferred. Now affects 5 of 13 active cities; pressure is increasing as the cohort grows. Residential proxy or alternate hosting recommended.
- **ISS-002** (Topeka NovusAgenda) — Effectively closed: Topeka is no longer in the active city list. Remove from PIPELINE_ISSUES.md.
- **ISS-005** (Thin placeholder stories) — Still open. Now demonstrably worsening — 100% of today's stories (1 of 1) hit this pattern. Recommended fix above (Ops AI items 1 and 2).
- **ISS-008** (Fact-checker too strict on imprecise summaries) — Still open. No new violations in 30 days because the affected meeting types (Birmingham budget) have not re-crawled. Will surface again on the next Birmingham Budget and Finance run.

---

*Note on RLS:* The Supabase advisory flags that 8 public tables (cities, meetings, stories, issues, qc_log, ad_campaigns, style_config, ops_config) have Row Level Security disabled. Anyone with the anon key can read or modify every row. This is a deployment-time concern, not a pipeline issue, but it should be addressed before any public-facing app reads from these tables.
