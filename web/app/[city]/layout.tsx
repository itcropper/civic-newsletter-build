import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  tryGetCity,
  formatCityFull,
  formatCityCompact,
} from '@/lib/city';
import { getBaseUrl } from '@/lib/feeds';

// Force dynamic so Supabase calls happen per-request, not at build time.
export const dynamic = 'force-dynamic';

type Params = { city: string };

export async function generateMetadata(
  { params }: { params: Params }
): Promise<Metadata> {
  let metadataBase: URL | undefined;
  try { metadataBase = new URL(getBaseUrl()); } catch { /* leave undefined */ }

  const city = await tryGetCity(params.city);
  if (!city) {
    return { metadataBase, title: 'Civic Weekly' };
  }
  const compact = formatCityCompact(city);
  const fullName = formatCityFull(city);
  const slug = encodeURIComponent(city.subdomain);
  return {
    metadataBase,
    title: { default: `${compact} Civic`, template: `%s \u2014 ${compact} Civic` },
    description: `Plain-language coverage of public meetings in ${fullName}. Updated regularly.`,
    keywords: city.state ? [city.name, city.state, `${city.name} ${city.state}`, 'city council', 'public meetings'] : undefined,
    alternates: {
      types: {
        'application/rss+xml': [{ url: `/${slug}/rss.xml`, title: `${compact} Civic \u2014 RSS` }],
        'application/atom+xml': [{ url: `/${slug}/atom.xml`, title: `${compact} Civic \u2014 Atom` }],
      },
    },
  };
}

export default async function CityLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Params;
}) {
  const city = await tryGetCity(params.city);
  if (!city) notFound();

  const { primary, secondary, hero_url } = city.branding;
  const fullName = formatCityFull(city);
  const slug = encodeURIComponent(city.subdomain);

  return (
    <>
      <style>{`
        :root {
          --color-primary: ${primary};
          --color-secondary: ${secondary};
        }
      `}</style>
      <header
        className="site-header"
        style={hero_url ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.55)), url(${hero_url})` } : undefined}
      >
        <div className="header-inner">
          <Link href={`/${slug}`} className="site-title">{city.name} Civic</Link>
          <p className="site-tagline">Plain-language coverage of public meetings in {fullName}.</p>
        </div>
      </header>
      <main className="site-main is-wide">{children}</main>
      <footer className="site-footer">
        <p>
          {fullName} Civic. Updated continuously.{' '}
          <Link href={`/${slug}/rss.xml`}>RSS</Link> &middot;{' '}
          <Link href="/about">About</Link> &middot;{' '}
          <Link href="/">All cities</Link>
        </p>
      </footer>
    </>
  );
}
