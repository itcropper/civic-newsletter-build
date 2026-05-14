-- Migration 012: Video archive auto-discovery
-- Adds columns to cities to track the video-archive index URL(s) for each
-- city, plus a status enum so the crawler/observer can tell discovered vs
-- manually-set vs awaiting-operator state.
--
-- Why: the crawler walks operator-supplied archive_urls, which typically
-- point at minutes/agenda pages and miss the city's video portal (Granicus,
-- Legistar, iQM2, etc.). The new 01a-video-archive-discoverer agent probes
-- canonical platform URLs + the city's own domain for a "watch all past
-- meetings" index and persists what it finds here. After 3 failed attempts
-- the discoverer flags the city for manual intervention.

alter table public.cities
  add column if not exists video_archive_urls text[],
  add column if not exists video_archive_discovery_status text
    not null default 'unknown'
    check (video_archive_discovery_status in (
      'unknown',          -- never tried
      'discovered',       -- auto-discovery succeeded
      'manual_needed',    -- 3 failed attempts; operator action required
      'manual_set'        -- operator populated video_archive_urls themselves
    )),
  add column if not exists video_archive_attempts int not null default 0,
  add column if not exists video_archive_last_attempt_at timestamptz;

comment on column public.cities.video_archive_urls is
  'URLs of pages listing the collection of past meeting videos. Discovered by 01a-video-archive-discoverer or set by an operator. Crawler treats these as priority-0 seeds (above operator archive_urls).';
comment on column public.cities.video_archive_discovery_status is
  'unknown | discovered | manual_needed | manual_set. Manual_set is sticky: once an operator populates video_archive_urls, the discoverer stops auto-trying.';
comment on column public.cities.video_archive_attempts is
  'Counter incremented per discovery strategy attempted. Capped at 3 by the discoverer before transitioning to manual_needed.';

-- Convenience view: cities awaiting manual video-archive intervention.
-- The observer report can select * from this view.
create or replace view public.cities_awaiting_video_archive as
select
  id, name, subdomain, seed_url, video_archive_attempts,
  video_archive_last_attempt_at, archive_urls
from public.cities
where active = true
  and video_archive_discovery_status = 'manual_needed';

grant select on public.cities_awaiting_video_archive to anon, authenticated;
