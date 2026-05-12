import { supabase, type StoryRow } from './supabase';
import { getCity } from './city';

/** Latest approved stories, most recent first. */
export async function listStories(opts: { limit?: number; tag?: string } = {}): Promise<StoryRow[]> {
  const city = await getCity();
  let q = supabase
    .from('stories')
    .select('id, city_id, slug, summary_text, category, impact_score, votes_json, tags, published_at, qc_status, context_note')
    .eq('city_id', city.id)
    .eq('qc_status', 'approved')
    .not('published_at', 'is', null)
    .not('slug', 'is', null)
    .order('published_at', { ascending: false });

  if (opts.tag) q = q.contains('tags', [opts.tag]);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`Failed to list stories: ${error.message}`);
  return (data as StoryRow[]) || [];
}

export async function getStoryBySlug(slug: string): Promise<StoryRow | null> {
  const city = await getCity();
  const { data, error } = await supabase
    .from('stories')
    .select('id, city_id, slug, summary_text, category, impact_score, votes_json, tags, published_at, qc_status, context_note')
    .eq('city_id', city.id)
    .eq('slug', slug)
    .eq('qc_status', 'approved')
    .maybeSingle();
  if (error) throw new Error(`Failed to load story: ${error.message}`);
  return data as StoryRow | null;
}

export async function listAllTags(): Promise<{ tag: string; count: number }[]> {
  const stories = await listStories({});
  const counts = new Map<string, number>();
  for (const s of stories) {
    for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/** Plain-text headline from the first sentence of summary_text, truncated. */
export function headline(s: StoryRow, max = 110): string {
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
