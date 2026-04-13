-- ============================================================
-- Seed data — run after 001_schema.sql
-- ============================================================

-- ops_config defaults
INSERT INTO ops_config (key, value) VALUES
    ('nightly_crawl_time',          '02:00'),
    ('weekly_send_day',             'sunday'),
    ('weekly_send_time',            '07:00'),
    ('max_revision_loops',          '2'),
    ('min_ingestion_score',         '70'),
    ('min_transcript_words',        '500'),
    ('ad_spend_per_city_monthly',   '100'),
    ('transcript_purge_days',       '60');

-- Global style_config default
INSERT INTO style_config (scope, city_id, version, voice, formality, sentence_length, pov, banned_phrases, custom_prompt_suffix, active)
VALUES (
    'global',
    NULL,
    1,
    'neutral',
    'professional',
    'medium',
    'third_person',
    '["contentious","alarming","residents were upset","sparked controversy"]'::jsonb,
    '',
    true
);

-- First city: Ashland, Oregon
INSERT INTO cities (name, seed_url, timezone, send_schedule)
VALUES (
    'Ashland',
    'https://www.ashland.or.us',
    'America/Los_Angeles',
    'weekly'
);
