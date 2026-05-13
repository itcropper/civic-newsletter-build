import Link from 'next/link';
import { getCity, isSplashRequest, listActiveCitiesWithStories, cityUrl } from '@/lib/city';
import { listStories, headline, formatDate } from '@/lib/stories';
import { SourceChip } from '@/components/SourceBadge';
import { ImpactPill } from '@/components/ImpactPill';
import SplashHome from '@/components/SplashHome';
import SubscribeForm from '@/components/SubscribeForm';
import { supabase } from '@/lib/supabase';
import type { StoryRow } from '@/lib/supabase';

export const revalidate = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (isSplashRequest()) {
    return <SplashView />;
  }
  return <CityHomeView />;
}

async function SplashView() {
  const cities = await listActiveCitiesWithStories().catch(() => []);
  const topRequested = await fetchTopRequested().catch(() => []);

  // Resolve URLs server-side; pass as a plain map (functions aren't
  // serializable across the server -> client boundary).
  const cityUrls: Record<string, string> = {};
  const cityCards = cities.map((c) => {
    const url = cityUrl(c);
    cityUrls[c.subdomain] = url;
    return {
      id: c.id,
      name: c.name,
      state: c.state,
      state_code: c.state_code,
      subdomain: c.subdomain,
      latest_at: c.latest_at,
      url,
    };
  });

  return (
    <SplashHome
      cities={cityCards}
      topRequested={topRequested}
      cityUrls={cityUrls}
    />
  );
}

async function fetchTopRequested(): Promise<
  Array<{ city_name: string; state: string; request_count: number }>
> {
  const { data, error } = await supabase.rpc('top_requested_cities', { top_n: 5 });
  if (error || !data) return [];
  // The RPC returns the typed columns we defined in the function.
  return (data as Array<{ city_name: string; state: string; request_count: number }>) || [];
}

async function CityHomeView() {
  const city = await getCity();
  const stories = await listStories({ limit: 50 });

  if (stories.length === 0) {
    return (
      <>
        <div className="empty-state">
          <span className="empty-state-emoji" aria-hidden>{'\u{1F4F0}'}</span>
          <h2 className="empty-state-title">It&rsquo;s quiet in {city.name} this week.</h2>
          <p className="empty-state-body">
            No new public-meeting coverage yet. Check back soon &mdash; we&rsquo;ll let you know when something changes.
          </p>
        </div>
        <SubscribeForm cityName={city.name} variant="hero" />
      </>
    );
  }

  const lead = pickLead(stories);
  const rest = stories.filter((s) => s.id !== lead.id);

  return (
    <>
      <SubscribeForm cityName={city.name} variant="hero" />
      <div style={{ height: 24 }} />
      <div className="card-grid">
        <StoryCard story={lead} cityTimezone={city.timezone} variant="lead" />
        {rest.map((s) => (
          <StoryCard key={s.id} story={s} cityTimezone={city.timezone} />
        ))}
      </div>
      <SubscribeForm cityName={city.name} variant="footer" />
    </>
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
  variant,
}: {
  story: StoryRow;
  cityTimezone: string | null;
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
        <Link href={`/posts/${story.slug}`}>{headline(story)}</Link>
      </h2>
      <p className="story-card-excerpt">{excerpt}</p>
      <div className="story-card-footer">
        <div className="story-card-tag-row">
          {(story.tags || []).slice(0, 3).map((t) => (
            <Link
              key={t}
              href={`/tags/${encodeURIComponent(t.toLowerCase())}`}
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
