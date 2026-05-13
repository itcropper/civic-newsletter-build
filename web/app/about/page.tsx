import Link from 'next/link';
import { getCity } from '@/lib/city';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const city = await getCity();
  return (
    <article className="post-detail">
      <Link href="/" className="back-link">{'\u2190'} Home</Link>
      <h1>About {city.name} Civic</h1>
      <div className="post-body">
        <p>
          {city.name} Civic publishes plain-language coverage of city council and other public meetings in {city.name}.
          Each story is drawn directly from agendas, minutes, and meeting videos published by the city.
        </p>
        <p>
          Every story is fact-checked against the source material before publication. We do not editorialize. We do not
          take a side. We tell you who voted on what, how much it costs, and what changes as a result.
        </p>
        <p>
          You can follow {city.name} Civic via <Link href="/rss.xml">RSS</Link> or <Link href="/atom.xml">Atom</Link>.
        </p>
      </div>
    </article>
  );
}
