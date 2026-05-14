import { supabase, type StoryRow } from './supabase';

const STORY_SELECT =
  'id, city_id, slug, headline, summary_text, category, impact_score, ' +
  'votes_json, tags, published_at, qc_status, context_note, ' +
  'meetings(source_url, url)';

type RawStoryRow = Omit<StoryRow, 'source_url' | 'source_name'> & {
  meetings?: { source_url: string | null; url: string | null } | null;
};

/** Latest approved stories for `cityId`, most recent first. */
export async function listStories(
  cityId: string,
  opts: { limit?: number; tag?: string } = {}
): Promise<StoryRow[]> {
  let q = supabase
    .from('stories')
    .select(STORY_SELECT)
    .eq('city_id', cityId)
    .eq('qc_status', 'approved')
    .not('published_at', 'is', null)
    .not('slug', 'is', null)
    .order('published_at', { ascending: false });

  if (opts.tag) q = q.contains('tags', [opts.tag]);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`Failed to list stories: ${error.message}`);
  return ((data as unknown as RawStoryRow[]) || []).map(flattenStory);
}

export async function getStoryBySlug(cityId: string, slug: string): Promise<StoryRow | null> {
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_SELECT)
    .eq('city_id', cityId)
    .eq('slug', slug)
    .eq('qc_status', 'approved')
    .maybeSingle();
  if (error) throw new Error(`Failed to load story: ${error.message}`);
  if (!data) return null;
  return flattenStory(data as unknown as RawStoryRow);
}

/**
 * Lift the joined `meetings.source_url` (and a derived `source_name` from its
 * host) onto the top level so the rest of the web app doesn't have to think
 * about the join shape.
 */
function flattenStory(row: RawStoryRow): StoryRow {
  const sourceUrl = row.meetings?.source_url || row.meetings?.url || null;
  const { meetings: _drop, ...rest } = row;
  return {
    ...rest,
    source_url: sourceUrl,
    source_name: sourceNameFromUrl(sourceUrl),
  };
}

/**
 * Friendly source label derived from a URL host. We strip "www." and any
 * known archive-redirect prefixes, then return the bare host. Returns null
 * if the URL is unparseable.
 */
export function sourceNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export async function listAllTags(cityId: string): Promise<{ tag: string; count: number }[]> {
  const stories = await listStories(cityId);
  const counts = new Map<string, number>();
  for (const s of stories) {
    for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Headline for a story. Prefers the Claude-generated `headline` column added
 * in migration 008; falls back to the legacy first-sentence-of-summary for
 * any pre-008 rows that still have a null headline.
 */
export function headline(s: StoryRow, max = 110): string {
  if (s.headline) {
    return s.headline.length > max
      ? s.headline.slice(0, max - 1).trimEnd() + '\u2026'
      : s.headline;
  }
  const first = (s.summary_text || '').split(/(?<=[.!?])\s+/)[0] || s.summary_text || '';
  return first.length > max ? first.slice(0, max - 1).trimEnd() + '\u2026' : first;
}

export function formatDate(iso: string, tz: string | null = 'America/Chicago'): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: tz || 'America/Chicago',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
