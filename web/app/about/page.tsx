import Link from 'next/link';
import type { Metadata } from 'next';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About Civic Weekly',
  description:
    'Civic Weekly publishes plain-language coverage of public meetings, town by town.',
};

export default function AboutPage() {
  return (
    <>
      <style>{`
        :root {
          --color-primary: #1f3a5f;
          --color-secondary: #c9a55c;
        }
      `}</style>
      <header className="site-header splash-header">
        <div className="header-inner">
          <Link href="/" className="site-title">Civic Weekly</Link>
          <p className="site-tagline">Plain-language coverage of public meetings, town by town.</p>
        </div>
      </header>
      <main className="site-main is-wide">
        <article className="post-detail">
          <Link href="/" className="back-link">{'\u2190'} Home</Link>
          <h1>About Civic Weekly</h1>
          <div className="post-body">
            <p>
              Civic Weekly publishes plain-language coverage of city council, school board, and other
              public meetings &mdash; one site per city. Each story is drawn directly from agendas,
              minutes, and meeting videos published by the city itself.
            </p>
            <p>
              Every story is fact-checked against the source material before publication. We do not
              editorialize. We do not take a side. We tell you who voted on what, how much it costs,
              and what changes as a result.
            </p>
            <p>
              Don&rsquo;t see your city? Request it from the <Link href="/">home page</Link>.
            </p>
          </div>
        </article>
      </main>
      <footer className="site-footer">
        <p>Civic Weekly. <Link href="/">Home</Link></p>
      </footer>
    </>
  );
}
