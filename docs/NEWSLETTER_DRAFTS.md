# Newsletter Drafts — Civic Weekly

This document collects approved stories from the nightly pipeline, formatted as newsletter-ready content. Each section represents what _would_ go into a weekly newsletter for that city. When Beehiiv is configured, these stories will be assembled by Agent 7 (Newsletter Builder) automatically.

---

## Birmingham, AL — Birmingham Civic Weekly

_Stories accumulate here until weekly send._

### Approved Stories — Week of 2026-04-13

**Source:** Budget and Finance Committee Meeting, April 13, 2026
**Meeting agenda PDF:** birminghamal.gov (S3-hosted)

---

#### 1. Birmingham Seeks $363K Federal Justice Grant — No Local Match Required
**Category:** Safety | **Impact:** High

The committee will consider a resolution authorizing the mayor to apply for and expend funds under the FY2025 Edward Byrne Memorial Justice Assistance Grant Program, administered by the U.S. Department of Justice. Birmingham's share of the 2025 allocation is $363,353, with Jefferson County receiving an additional $77,636. No local matching funds are required for this grant opportunity.

---

#### 2. City Eyes $348K Network Upgrade Over Three Years
**Category:** Budget | **Impact:** High

The committee will review a proposed three-year software agreement with PC Connection Sales Corporation to replace Cisco networking components that support internet, data, and voice communications across city facilities. The agreement would not exceed $348,575.55 over its term. The contract is submitted by the Information Management Services department.

---

#### 3. Graymont School Property Deal: $790K County Buyout on the Table
**Category:** Budget | **Impact:** High

The committee will consider an agreement with Jefferson County to release a restrictive covenant and reversionary interest on the former Graymont School property. In exchange, the city would agree to pay the county $790,000 — representing the fair market value of the county's 50% interest — if the city no longer owns the property or ceases to use it for a public purpose on or before April 21, 2032.

---

#### 4. Budget and Finance Committee Convenes April 13
**Category:** Budget | **Impact:** Medium

The Birmingham City Council's Budget and Finance Committee is scheduled to meet on April 13, 2026, from 3:30 to 5:00 PM at City Hall, 710 20th Street North, Third Floor. No specific agenda items were listed in the available meeting notice. Details on topics to be discussed were not provided in the published agenda.

---

**QC Summary (Birmingham):**
- 6 stories generated from 3 meetings (1 transportation, 2 budget)
- 4 approved, 2 dropped
- Drop reasons: Parks funding reallocation story had imprecise fund source characterization; HUD CDBG-DR story had unverifiable combined total claim
- Source verifier flagged binary PDF content but pipeline proceeded with extracted text

---

## Savannah, GA — Savannah Civic Weekly

_Stories accumulate here until weekly send._

### Approved Stories — Week of 2026-04-09

**Source:** City Council Mobile Workshop + Meeting, April 9, 2026
**Meeting agenda:** savannahga.gov AgendaCenter

---

#### 1. Savannah Leaders Tour City to Tackle Housing Affordability
**Category:** Zoning | **Impact:** High

The Mayor and Aldermen of Savannah will conduct a mobile workshop on April 9, 2026, departing from the rear of City Hall at 10:00 a.m. The tour will include discussions on zoning, development standards, licensing, and related ordinances aimed at promoting housing affordability, as well as best practices and alternative approaches to support affordable housing development and funding.

---

#### 2. Zoning and Development Standards Under Review for Affordability
**Category:** Zoning | **Impact:** Medium

As part of the mobile workshop agenda, the Mayor and Aldermen are scheduled to discuss potential changes to zoning regulations, development standards, and licensing ordinances with the goal of promoting housing affordability. The session will also examine best practices and alternative funding and development approaches, though no specific proposals or vote items are identified in the posted agenda.

---

**QC Summary (Savannah):**
- 3 stories generated from 1 meeting (city council)
- 2 approved, 1 dropped
- Drop reason: Afternoon council meeting summary claimed "full agenda" was available, but source only provided contact info — fact-checker flagged as unverifiable
- Source verifier flagged binary PDF content (ISS-004) but civic-transcribe v7 successfully extracted readable text via Claude's native PDF support

---

## Topeka, KS — Topeka Civic Weekly

_Stories accumulate here until weekly send._

### Pipeline Status — 2026-04-13

**Meetings found:** 0
**Stories approved:** 0
**Blocker:** Topeka uses NovusAgenda platform (topeka.novusagenda.com) which is not yet in CIVIC_PORTAL_PATTERNS. See ISS-002. Crawler ran 12 steps but found no meetings until NovusAgenda patterns are added to civic-crawler.

---

## Pipeline Run Summary — 2026-04-13

| City | Meetings | Stories Generated | Approved | Dropped | Pending |
|---|---|---|---|---|---|
| Birmingham | 3 (budget x2, transportation x1) | 6 | 4 | 2 | 0 |
| Savannah | 1 (city_council) | 3 | 2 | 1 | 0 |
| Topeka | 0 | 0 | 0 | 0 | 0 |
| **Total** | **4** | **9** | **6** | **3** | **0** |

**Edge Function versions used:** civic-crawler v11, civic-transcribe v7, civic-pipeline v4, civic-qc-one v1

**Key fixes deployed this session:**
1. Expanded `meeting_type` CHECK constraint to support all 10 types (was blocking Birmingham inserts)
2. Added null byte sanitization to civic-transcribe (was silently failing Postgres updates)
3. Rewrote PDF extraction to use Claude's native document support via base64 encoding (was storing binary garbage)
4. Updated source verifier to flag (not reject) when PDF sources can't be re-fetched as readable text
