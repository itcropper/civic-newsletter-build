import Link from 'next/link';
import { getCity } from '@/lib/city';
import { listStories, headline, formatDate } from '@/lib/stories';

export const revalidate = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const city = await getCity();
  const stories = await listStories({ limit: 50 });

  if (stories.length === 0) {
    return (
      <div>
        <p className="post-excerpt">No published stories yet for {city.name}. Check back soon.</p>
      </div>
    );
  }

  return (
    <ol className="post-list">
      {stories.map((s) => (
        <li key={s.id}>
          <div className="post-meta">
            <time dateTime={s.published_at}>{formatDate(s.published_at, city.timezone)}</time>
            {s.tags && s.tags[0] ? <> &middot; <Link href={`/tags/${encodeURIComponent(s.tags[0].toLowerCase())}`}>{s.tags[0]}</Link></> : null}
          </div>
          <h2 className="post-title">
            <Link href={`/posts/${s.slug}`} className="post-link">{headline(s)}</Link>
          </h2>
          <p className="post-excerpt">{s.summary_text.slice(0, 220)}{s.summary_text.length > 220 ? '\u2026' : ''}</p>
        </li>
      ))}
    </ol>
  );
}
