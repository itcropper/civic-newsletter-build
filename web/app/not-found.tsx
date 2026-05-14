import Link from 'next/link';

export default function NotFound() {
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
        <div className="post-detail">
          <h1>Not found</h1>
          <p>The page you requested doesn&rsquo;t exist.</p>
          <p><Link href="/">Back to all cities</Link></p>
        </div>
      </main>
      <footer className="site-footer">
        <p>Civic Weekly. <Link href="/about">About</Link></p>
      </footer>
    </>
  );
}
