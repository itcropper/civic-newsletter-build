import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tryGetCity } from '@/lib/city';
import { listStories, headline, formatDate } from '@/lib/stories';
import { SourceChip } from '@/components/SourceBadge';
import { ImpactPill } from '@/components/ImpactPill';
import type { StoryRow } from '@/lib/supabase';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

type Params = { city: string };

export default async function CityHomePage({ params }: { params: Params }) {
  const city = await tryGetCity(params.city);
  if (!city) notFound();

  const stories = await listStories(city.id, { limit: 50 });
  const slug = encodeURIComponent(city.subdomain);

  if (stories.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-emoji" aria-hidden>{'\u{1F4F0}'}</span>
        <h2 className="empty-state-title">It&rsquo;s quiet in {city.name} this week.</h2>
        <p className="empty-state-body">
          No new public-meeting coverage yet. Check back soon.
        </p>
      </div>
    );
  }

  const lead = pickLead(stories);
  const rest = stories.filter((s) => s.id !== lead.id);

  return (
    <div className="card-grid">
      <StoryCard story={lead} cityTimezone={city.timezone} citySlug={slug} variant="lead" />
      {rest.map((s) => (
        <StoryCard key={s.id} story={s} cityTimezone={city.timezone} citySlug={slug} />
      ))}
    </div>
  );
}

/** Pick the first High-impact story as the lead, falling back to the newest. */
function pickLead(stories: StoryRow[]): StoryRow {
  const high = stories.find((s) => (s.impact_score || '').toLowerCase() === 'high');
  return high || stories[0];
}

function StoryCard({
  story,
  cityTimezone,
  citySlug,
  variant,
}: {
  story: StoryRow;
  cityTimezone: string | null;
  citySlug: string;
  variant?: 'lead';
}) {
  const excerptLength = variant === 'lead' ? 280 : 180;
  const excerpt =
    (story.summary_text || '').slice(0, excerptLength) +
    ((story.summary_text || '').length > excerptLength ? '\u2026' : '');

  return (
    <article className={`story-card${variant === 'lead' ? ' card-lead' : ''}`}>
      <div className="story-card-meta">
        <time dateTime={story.published_at}>{formatDate(story.published_at, cityTimezone)}</time>
        <ImpactPill impact={story.impact_score} />
      </div>
      <h2 className="story-card-title">
        <Link href={`/${citySlug}/posts/${story.slug}`}>{headline(story)}</Link>
      </h2>
      <p className="story-card-excerpt">{excerpt}</p>
      <div className="story-card-footer">
        <div className="story-card-tag-row">
          {(story.tags || []).slice(0, 3).map((t) => (
            <Link
              key={t}
              href={`/${citySlug}/tags/${encodeURIComponent(t.toLowerCase())}`}
              className="tag-chip"
            >
              {t}
            </Link>
          ))}
        </div>
        <SourceChip url={story.source_url} name={story.source_name} />
      </div>
    </article>
  );
}
