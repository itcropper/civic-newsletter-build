import type { Metadata } from 'next';
import Link from 'next/link';
import { listActiveCitiesWithStories, cityUrl } from '@/lib/city';
import SplashHome from '@/components/SplashHome';
import { supabase } from '@/lib/supabase';
import { getBaseUrl } from '@/lib/feeds';

export const revalidate = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  let metadataBase: URL | undefined;
  try { metadataBase = new URL(getBaseUrl()); } catch { /* leave undefined */ }
  return {
    metadataBase,
    title: { default: 'Civic Weekly', template: '%s \u2014 Civic Weekly' },
    description:
      'Plain-language coverage of public meetings, town by town. Find your city, or request the one we should cover next.',
  };
}

export default async function HomePage() {
  const cities = await listActiveCitiesWithStories().catch(() => []);
  const topRequested = await fetchTopRequested().catch(() => []);

  // Resolve URLs server-side; pass as a plain map (functions aren't
  // serializable across the server -> client boundary).
  const cityUrls: Record<string, string> = {};
  const cityCards = cities.map((c) => {
    const url = cityUrl(c);
    cityUrls[c.subdomain] = url;
    return {
      id: c.id,
      name: c.name,
      state: c.state,
      state_code: c.state_code,
      subdomain: c.subdomain,
      latest_at: c.latest_at,
      url,
    };
  });

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
        <SplashHome
          cities={cityCards}
          topRequested={topRequested}
          cityUrls={cityUrls}
        />
      </main>
      <footer className="site-footer">
        <p>Civic Weekly. <Link href="/about">About</Link></p>
      </footer>
    </>
  );
}

async function fetchTopRequested(): Promise<
  Array<{ city_name: string; state: string; request_count: number }>
> {
  const { data, error } = await supabase.rpc('top_requested_cities', { top_n: 5 });
  if (error || !data) return [];
  return (data as Array<{ city_name: string; state: string; request_count: number }>) || [];
}
