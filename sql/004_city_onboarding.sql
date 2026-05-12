-- Migration 004: City onboarding improvements
-- Adds archive_urls (operator-configured URL list) to cities table
-- Adds context_note column to stories table for AI-enriched context
-- Run date: 2026-04-14

-- ─────────────────────────────────────────────────────────────────────────────
-- cities.archive_urls
-- ─────────────────────────────────────────────────────────────────────────────
-- An array of URLs pointing to the city's meeting archive/agenda pages.
-- Provided by the operator during city onboarding (not auto-discovered).
--
-- Example values:
--   ARRAY[
--     'https://cityname.gov/AgendaCenter',
--     'https://cityname.legistar.com/Calendar.aspx',
--     'https://cityname.novusagenda.com/agendapublic/'
--   ]
--
-- When this column is populated, the crawler operates in "archive_urls" mode:
-- it visits exactly these pages each nightly run and follows links found
-- on them (one level deep). No autonomous wide-area discovery is performed.
--
-- If NULL or empty, the crawler falls back to legacy autonomous mode
-- starting from seed_url (less reliable, not recommended for new cities).

ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS archive_urls text[] DEFAULT NULL;

COMMENT ON COLUMN cities.archive_urls IS
  'Operator-provided list of meeting archive/agenda page URLs for this city. '
  'Set during city onboarding. When present, the crawler visits only these pages '
  'instead of performing autonomous site-wide discovery. '
  'Example: ARRAY[''https://cityname.gov/AgendaCenter'', ''https://cityname.legistar.com/Calendar.aspx'']';


-- ─────────────────────────────────────────────────────────────────────────────
-- stories.context_note
-- ─────────────────────────────────────────────────────────────────────────────
-- An AI-generated context note that supplements the meeting transcript summary
-- with relevant external context: local news coverage, community sentiment,
-- historical background, or broader policy significance.
--
-- This is written by Agent 4 (Summarizer) from transcript context, and may
-- be enriched or replaced by Agent 4b (Context Enricher) after web research.
--
-- Displayed in the newsletter as a "Context:" section beneath the story.
-- NULL or empty string means no context is available and no section is shown.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS context_note text DEFAULT NULL;

COMMENT ON COLUMN stories.context_note IS
  'AI-generated context note adding background beyond the meeting transcript. '
  'Written by the Summarizer (from transcript context) and optionally enriched '
  'by the Context Enricher (from web research). Displayed as a Context section '
  'in the newsletter. NULL or empty = no context section shown.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Update existing Birmingham and Savannah cities with archive_urls
-- (Replace these with actual archive URL values when known)
-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE cities
--   SET archive_urls = ARRAY[
--     'https://www.birminghamal.gov/government/city-council/city-council-agendas-minutes'
--   ]
--   WHERE name = 'Birmingham';

-- UPDATE cities
--   SET archive_urls = ARRAY[
--     'https://www.savannahga.gov/AgendaCenter'
--   ]
--   WHERE name = 'Savannah';

-- UPDATE cities
--   SET archive_urls = ARRAY[
--     'https://topeka.novusagenda.com/agendapublic/'
--   ]
--   WHERE name = 'Topeka';
