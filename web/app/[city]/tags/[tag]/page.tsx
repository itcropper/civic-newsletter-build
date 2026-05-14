import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { tryGetCity } from '@/lib/city';
import { listStories, headline, formatDate } from '@/lib/stories';
import { SourceChip } from '@/components/SourceBadge';
import { ImpactPill } from '@/components/ImpactPill';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

type Params = { city: string; tag: string };

export async function generateMetadata(
  { params }: { params: Params }
): Promise<Metadata> {
  return { title: `${decodeURIComponent(params.tag)} stories` };
}

export default async function TagPage({ params }: { params: Params }) {
  const city = await tryGetCity(params.city);
  if (!city) notFound();

  const stories = await listStories(city.id);
  const slug = encodeURIComponent(city.subdomain);
  const tagParam = decodeURIComponent(params.tag);
  const matching = stories.filter((s) =>
    (s.tags || []).some((t) => t.toLowerCase() === tagParam.toLowerCase())
  );
  const display =
    matching[0]?.tags?.find((t) => t.toLowerCase() === tagParam.toLowerCase()) || tagParam;

  return (
    <div>
      <Link href={`/${slug}`} className="back-link">{'\u2190'} All stories</Link>
      <h1 style={{ marginTop: 12, fontFamily: 'var(--font-display)' }}>Tag: {display}</h1>
      {matching.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-emoji" aria-hidden>{'\u{1F50D}'}</span>
          <h2 className="empty-state-title">No stories under &ldquo;{display}&rdquo; yet.</h2>
          <p className="empty-state-body">Check the home page for the latest coverage.</p>
        </div>
      ) : (
        <div className="card-grid">
          {matching.map((s) => {
            const excerpt =
              (s.summary_text || '').slice(0, 180) +
              ((s.summary_text || '').length > 180 ? '\u2026' : '');
            return (
              <article key={s.id} className="story-card">
                <div className="story-card-meta">
                  <time dateTime={s.published_at}>{formatDate(s.published_at, city.timezone)}</time>
                  <ImpactPill impact={s.impact_score} />
                </div>
                <h2 className="story-card-title">
                  <Link href={`/${slug}/posts/${s.slug}`}>{headline(s)}</Link>
                </h2>
                <p className="story-card-excerpt">{excerpt}</p>
                <div className="story-card-footer">
                  <div className="story-card-tag-row">
                    {(s.tags || []).slice(0, 3).map((t) => (
                      <Link
                        key={t}
                        href={`/${slug}/tags/${encodeURIComponent(t.toLowerCase())}`}
                        className="tag-chip"
                      >
                        {t}
                      </Link>
                    ))}
                  </div>
                  <SourceChip url={s.source_url} name={s.source_name} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
