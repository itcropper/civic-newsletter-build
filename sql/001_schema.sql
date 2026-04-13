-- ============================================================
-- AI Civic Newsletter System — Schema Migration
-- Run this in Supabase SQL Editor (or any Postgres 14+)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. cities
-- ============================================================
CREATE TABLE cities (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            text NOT NULL,
    seed_url        text NOT NULL,
    timezone        text NOT NULL DEFAULT 'America/Los_Angeles',
    send_schedule   text NOT NULL DEFAULT 'weekly'
                    CHECK (send_schedule IN ('weekly', 'biweekly', 'monthly')),
    reliability_score float NOT NULL DEFAULT 1.0,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cities_active ON cities (active) WHERE active = true;

-- ============================================================
-- 2. meetings
-- ============================================================
CREATE TABLE meetings (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    city_id         uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    url             text NOT NULL,
    content_hash    text NOT NULL,
    source_url      text NOT NULL,
    meeting_date    date,
    meeting_type    text CHECK (meeting_type IN (
                        'city_council', 'school_board', 'parks_rec',
                        'planning', 'other'
                    )),
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'ingestion_passed', 'processed', 'skipped')),
    ingestion_score float,
    transcript_text text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_city_status ON meetings (city_id, status);
CREATE INDEX idx_meetings_content_hash ON meetings (content_hash);
CREATE INDEX idx_meetings_city_date ON meetings (city_id, meeting_date DESC);

-- ============================================================
-- 3. stories
-- ============================================================
CREATE TABLE stories (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id          uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    summary_text        text NOT NULL,
    category            text CHECK (category IN (
                            'Budget', 'Safety', 'Schools', 'Roads',
                            'Zoning', 'Parks', 'Utilities', 'Other'
                        )),
    impact_score        text CHECK (impact_score IN ('High', 'Medium', 'Low')),
    votes_json          jsonb,
    qc_status           text NOT NULL DEFAULT 'pending'
                        CHECK (qc_status IN ('pending', 'approved', 'revised', 'dropped')),
    qc_revision_count   int NOT NULL DEFAULT 0,
    used_in_issue_id    uuid,  -- FK added after issues table created
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stories_city_qc ON stories (city_id, qc_status);
CREATE INDEX idx_stories_meeting ON stories (meeting_id);
CREATE INDEX idx_stories_unused ON stories (city_id, used_in_issue_id) WHERE used_in_issue_id IS NULL;

-- ============================================================
-- 4. issues
-- ============================================================
CREATE TABLE issues (
    id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    city_id                     uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    sent_at                     timestamptz,
    story_ids                   uuid[] NOT NULL DEFAULT '{}',
    beehiiv_post_id             text,
    subscriber_count_at_send    int,
    style_config_version        int,
    subject_line_variants_json  jsonb,
    created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_issues_city ON issues (city_id, created_at DESC);

-- Add FK from stories to issues now that issues exists
ALTER TABLE stories
    ADD CONSTRAINT fk_stories_issue
    FOREIGN KEY (used_in_issue_id) REFERENCES issues(id) ON DELETE SET NULL;

-- ============================================================
-- 5. qc_log
-- ============================================================
CREATE TABLE qc_log (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    city_id         uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    meeting_id      uuid REFERENCES meetings(id) ON DELETE SET NULL,
    story_topic     text,
    flagging_agent  text NOT NULL,
    reason          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qc_log_city ON qc_log (city_id, created_at DESC);

-- ============================================================
-- 6. ad_campaigns
-- ============================================================
CREATE TABLE ad_campaigns (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    city_id                 uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    issue_id                uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    facebook_campaign_id    text,
    ad_copy_variants_json   jsonb,
    targeting_brief         text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_campaigns_city ON ad_campaigns (city_id);

-- ============================================================
-- 7. style_config
-- ============================================================
CREATE TABLE style_config (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope               text NOT NULL CHECK (scope IN ('global', 'city')),
    city_id             uuid REFERENCES cities(id) ON DELETE CASCADE,
    version             int NOT NULL DEFAULT 1,
    voice               text NOT NULL DEFAULT 'neutral'
                        CHECK (voice IN ('neutral', 'warm', 'authoritative')),
    formality           text NOT NULL DEFAULT 'professional'
                        CHECK (formality IN ('casual', 'professional', 'formal')),
    sentence_length     text NOT NULL DEFAULT 'medium'
                        CHECK (sentence_length IN ('short', 'medium', 'long')),
    pov                 text NOT NULL DEFAULT 'third_person'
                        CHECK (pov IN ('third_person', 'community')),
    banned_phrases      jsonb NOT NULL DEFAULT '["contentious","alarming","residents were upset","sparked controversy"]'::jsonb,
    custom_prompt_suffix text NOT NULL DEFAULT '',
    active              boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- city_id required when scope = city
    CONSTRAINT chk_city_scope CHECK (
        (scope = 'global' AND city_id IS NULL) OR
        (scope = 'city' AND city_id IS NOT NULL)
    )
);

CREATE INDEX idx_style_config_lookup ON style_config (scope, city_id, active) WHERE active = true;

-- ============================================================
-- 8. ops_config
-- ============================================================
CREATE TABLE ops_config (
    key         text PRIMARY KEY,
    value       text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
