import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  getCityOrFallback,
  formatCityFull,
  formatCityCompact,
  isSplashRequest,
} from '@/lib/city';
import { getBaseUrl } from '@/lib/feeds';
import './globals.css';

// Force all pages through this layout to be rendered dynamically.
// Without this, Next.js tries to statically render /_not-found at build
// time, which invokes the layout and forces a Supabase call before env
// vars are necessarily resolvable.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  let metadataBase: URL | undefined;
  try { metadataBase = new URL(getBaseUrl()); } catch { /* leave undefined */ }

  if (isSplashRequest()) {
    return {
      metadataBase,
      title: { default: 'Civic Weekly', template: '%s \u2014 Civic Weekly' },
      description:
        'Plain-language coverage of public meetings, town by town. Find your city, or request the one we should cover next.',
    };
  }

  const city = await getCityOrFallback();
  const compact = formatCityCompact(city);
  const fullName = formatCityFull(city);
  return {
    metadataBase,
    title: { default: `${compact} Civic`, template: `%s \u2014 ${compact} Civic` },
    description: `Plain-language coverage of public meetings in ${fullName}. Updated regularly.`,
    keywords: city.state ? [city.name, city.state, `${city.name} ${city.state}`, 'city council', 'public meetings'] : undefined,
    alternates: {
      types: {
        'application/rss+xml': [{ url: '/rss.xml', title: `${compact} Civic \u2014 RSS` }],
        'application/atom+xml': [{ url: '/atom.xml', title: `${compact} Civic \u2014 Atom` }],
      },
    },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const splash = isSplashRequest();

  if (splash) {
    return (
      <html lang="en">
        <body>
          <style>{`
            :root {
              --color-primary: #1f3a5f;
              --color-secondary: #c9a55c;
            }
          `}</style>
          <header className="site-header splash-header">
            <div className="header-inner">
              <a href="/" className="site-title">Civic Weekly</a>
              <p className="site-tagline">Plain-language coverage of public meetings, town by town.</p>
            </div>
          </header>
          <main className="site-main is-wide">{children}</main>
          <footer className="site-footer">
            <p>Civic Weekly. <a href="/about">About</a></p>
          </footer>
        </body>
      </html>
    );
  }

  const city = await getCityOrFallback();
  const { primary, secondary, hero_url } = city.branding;
  const fullName = formatCityFull(city);

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
            <p className="site-tagline">Plain-language coverage of public meetings in {fullName}.</p>
          </div>
        </header>
        <main className="site-main is-wide">{children}</main>
        <footer className="site-footer">
          <p>
            {fullName} Civic. Updated continuously. <a href="/rss.xml">RSS</a> &middot; <a href="/about">About</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
