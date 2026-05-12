import Link from 'next/link';
import type { Metadata } from 'next';
import { getCity } from '@/lib/city';
import { listStories, headline, formatDate } from '@/lib/stories';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { tag: string } }): Promise<Metadata> {
  return { title: `${params.tag} stories` };
}

export default async function TagPage({ params }: { params: { tag: string } }) {
  const stories = await listStories({});
  const city = await getCity();
  const matching = stories.filter((s) => (s.tags || []).some((t) => t.toLowerCase() === params.tag.toLowerCase()));
  const display = matching[0]?.tags?.find((t) => t.toLowerCase() === params.tag.toLowerCase()) || params.tag;

  return (
    <div>
      <Link href="/" className="back-link">{'\u2190'} All stories</Link>
      <h1 style={{ marginTop: 12 }}>Tag: {display}</h1>
      {matching.length === 0 ? (
        <p className="post-excerpt">No stories with this tag yet.</p>
      ) : (
        <ol className="post-list">
          {matching.map((s) => (
            <li key={s.id}>
              <div className="post-meta"><time dateTime={s.published_at}>{formatDate(s.published_at, city.timezone)}</time></div>
              <h2 className="post-title">
                <Link href={`/posts/${s.slug}`} className="post-link">{headline(s)}</Link>
              </h2>
              <p className="post-excerpt">{s.summary_text.slice(0, 220)}{s.summary_text.length > 220 ? '\u2026' : ''}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
