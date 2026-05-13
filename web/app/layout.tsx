import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getCity, getCityOrFallback } from '@/lib/city';
import './globals.css';

// Force all pages through this layout to be rendered dynamically.
// Without this, Next.js tries to statically render /_not-found at build
// time, which invokes the layout and forces a Supabase call before env
// vars are necessarily resolvable.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const city = await getCityOrFallback();
  return {
    title: { default: `${city.name} Civic`, template: `%s \u2014 ${city.name} Civic` },
    description: `Plain-language coverage of public meetings in ${city.name}. Updated regularly.`,
    alternates: {
      types: {
        'application/rss+xml': [{ url: '/rss.xml', title: `${city.name} Civic \u2014 RSS` }],
        'application/atom+xml': [{ url: '/atom.xml', title: `${city.name} Civic \u2014 Atom` }],
      },
    },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const city = await getCityOrFallback();
  const { primary, secondary, hero_url } = city.branding;

  return (
    <html lang="en">
      <body>
        <style>{`
          :root {
            --color-primary: ${primary};
            --color-secondary: ${secondary};
          }
        `}</style>
        <header className="site-header" style={hero_url ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.55)), url(${hero_url})` } : undefined}>
          <div className="header-inner">
            <a href="/" className="site-title">{city.name} Civic</a>
            <p className="site-tagline">Plain-language coverage of public meetings.</p>
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <p>
            {city.name} Civic. Updated continuously. <a href="/rss.xml">RSS</a> &middot; <a href="/about">About</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
