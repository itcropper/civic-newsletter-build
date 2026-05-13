import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getCity } from '@/lib/city';
import { getStoryBySlug, headline, formatDate } from '@/lib/stories';
import { SourceBand } from '@/components/SourceBadge';
import { ImpactPill } from '@/components/ImpactPill';
import SubscribeForm from '@/components/SubscribeForm';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const story = await getStoryBySlug(params.slug);
  if (!story) return {};
  return {
    title: headline(story, 70),
    description: story.summary_text.slice(0, 160),
  };
}

type Vote = { motion?: string; result?: string; vote_count?: string };

export default async function PostPage({ params }: { params: { slug: string } }) {
  const story = await getStoryBySlug(params.slug);
  if (!story) notFound();

  const city = await getCity();
  const votes: Vote[] = Array.isArray(story.votes_json) ? (story.votes_json as Vote[]) : [];

  return (
    <article className="post-detail">
      <Link href="/" className="back-link">{'\u2190'} All stories</Link>
      <SourceBand url={story.source_url} name={story.source_name} />
      <div className="post-meta">
        <time dateTime={story.published_at}>{formatDate(story.published_at, city.timezone)}</time>
        <ImpactPill impact={story.impact_score} />
      </div>
      <h1>{headline(story, 140)}</h1>
      <div className="post-body">
        {story.summary_text.split(/\n+/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      {story.context_note ? (
        <div className="context-note">
          <strong>Context:</strong> {story.context_note}
        </div>
      ) : null}
      {votes.length > 0 ? (
        <div className="votes-block">
          <h3>Votes recorded</h3>
          <ul>
            {votes.map((v, i) => (
              <li key={i}>
                {v.motion ? <>{v.motion}{' \u2014 '}</> : null}
                <strong>{v.result || 'unknown'}</strong>
                {v.vote_count ? ` (${v.vote_count})` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {story.tags && story.tags.length > 0 ? (
        <div className="tag-list">
          {story.tags.map((t) => (
            <Link key={t} href={`/tags/${encodeURIComponent(t.toLowerCase())}`} className="tag">{t}</Link>
          ))}
        </div>
      ) : null}
      <SubscribeForm cityName={city.name} variant="footer" />
    </article>
  );
}
