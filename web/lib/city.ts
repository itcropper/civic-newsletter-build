import fs from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { supabase, type CityRow, type BrandingPayload } from './supabase';

const DEFAULT_BRANDING: BrandingPayload = {
  hero_url: null,
  primary: '#1f3a5f',
  secondary: '#c9a55c',
  source: 'default',
};

// Optional umbrella domain for multi-tenant deploys (e.g. `civicwire.com`).
// When set, `birmingham.civicwire.com` -> subdomain `birmingham`.
const UMBRELLA_DOMAIN = (process.env.UMBRELLA_DOMAIN || '').toLowerCase();

// Optional explicit override for single-tenant deploys (one Vercel project per
// city on free-tier *.vercel.app, local dev, preview builds). Used only when
// the host header doesn't reveal a subdomain.
const FALLBACK_SUBDOMAIN = process.env.CITY_SUBDOMAIN || '';

/**
 * Determine the city subdomain from the incoming request, data-driven.
 *
 * Resolution order:
 *  1. Host header against UMBRELLA_DOMAIN (production multi-tenant case).
 *  2. CITY_SUBDOMAIN env var (single-tenant fallback for free-tier Vercel).
 *  3. null -- caller decides whether this is splash or an error.
 */
function resolveCitySubdomain(): string | null {
  let host = '';
  try {
    host = (headers().get('host') || '').split(':')[0].toLowerCase();
  } catch {
    // headers() can throw outside a request scope (e.g. some build-time paths).
    // Fall through to env-var fallback.
  }

  if (UMBRELLA_DOMAIN && host.endsWith('.' + UMBRELLA_DOMAIN)) {
    const sub = host.slice(0, host.length - UMBRELLA_DOMAIN.length - 1);
    if (sub && sub !== 'www') return sub;
  }

  if (FALLBACK_SUBDOMAIN) return FALLBACK_SUBDOMAIN;

  return null;
}

/**
 * True when this request should render the splash page rather than a city
 * blog. The condition is "we could not resolve a city subdomain from either
 * UMBRELLA_DOMAIN host parsing or the CITY_SUBDOMAIN env fallback".
 */
export function isSplashRequest(): boolean {
  return resolveCitySubdomain() === null;
}

/**
 * Reads web/branding/{subdomain}/colors.json or hero.{jpg,png,webp}.
 * Overrides take precedence over branding_json from the DB.
 */
async function readOverride(subdomain: string): Promise<Partial<BrandingPayload>> {
  const dir = path.join(process.cwd(), 'branding', subdomain);
  const override: Partial<BrandingPayload> = {};

  try {
    const colorsRaw = await fs.readFile(path.join(dir, 'colors.json'), 'utf8');
    const colors = JSON.parse(colorsRaw);
    if (typeof colors.primary === 'string') override.primary = colors.primary;
    if (typeof colors.secondary === 'string') override.secondary = colors.secondary;
  } catch { /* no override file */ }

  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    try {
      await fs.access(path.join(dir, `hero.${ext}`));
      override.hero_url = `/branding/${subdomain}/hero.${ext}`;
      break;
    } catch { /* try next */ }
  }

  if (Object.keys(override).length > 0) override.source = 'override';
  return override;
}

/**
 * Resilient variant used by the root layout. Returns a placeholder if the
 * city can't be resolved or Supabase is unreachable. Pages should use
 * getCity() so misconfiguration surfaces visibly.
 */
export async function getCityOrFallback(): Promise<CityRow & { branding: BrandingPayload }> {
  try {
    return await getCity();
  } catch {
    const subdomain = FALLBACK_SUBDOMAIN || 'unknown';
    const name = subdomain.replace(/(^|-)([a-z])/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase());
    const override = await readOverride(subdomain).catch(() => ({}));
    return {
      id: '00000000-0000-0000-0000-000000000000',
      name,
      subdomain,
      timezone: 'America/Chicago',
      branding_json: null,
      state: null,
      state_code: null,
      country: null,
      branding: { ...DEFAULT_BRANDING, ...override },
    } as CityRow & { branding: BrandingPayload };
  }
}

/** "Birmingham, Alabama" when state is set; just the name otherwise. */
export function formatCityFull(city: Pick<CityRow, 'name' | 'state'>): string {
  return city.state ? `${city.name}, ${city.state}` : city.name;
}

/** "Birmingham, AL" — compact version for SEO/metadata. */
export function formatCityCompact(city: Pick<CityRow, 'name' | 'state_code'>): string {
  return city.state_code ? `${city.name}, ${city.state_code}` : city.name;
}

/** Loads the city for the current request + final branding payload (override > db > default). */
export async function getCity(): Promise<CityRow & { branding: BrandingPayload }> {
  const subdomain = resolveCitySubdomain();
  if (!subdomain) {
    throw new Error(
      'Cannot resolve city subdomain. Request did not match UMBRELLA_DOMAIN and CITY_SUBDOMAIN fallback is not set.'
    );
  }

  const { data, error } = await supabase
    .from('cities')
    .select('id, name, subdomain, timezone, branding_json, state, state_code, country')
    .eq('subdomain', subdomain)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error(`Failed to load city for subdomain '${subdomain}': ${error.message}`);
  if (!data) throw new Error(`No active city found for subdomain '${subdomain}'. Add a row in cities with subdomain='${subdomain}' and active=true.`);

  const override = await readOverride(subdomain);
  const branding: BrandingPayload = {
    ...DEFAULT_BRANDING,
    ...(data.branding_json || {}),
    ...override,
  };

  return { ...(data as CityRow), branding };
}

/**
 * List active cities that have at least one approved, published story. Used
 * by the splash page to show "we cover these places today" cards. Public
 * stories table read; falls back to active-cities-only when stories table
 * isn't readable (will matter after the RLS lockdown).
 */
export async function listActiveCitiesWithStories(): Promise<
  Array<{
    id: string;
    name: string;
    state: string | null;
    state_code: string | null;
    subdomain: string;
    site_url: string | null;
    latest_at: string | null;
  }>
> {
  // We rely on a single join: cities -> stories(published_at). Anon can read
  // both today; after lockdown both still get anon select policies because
  // they're the rendered content.
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state, state_code, subdomain, site_url')
    .eq('active', true)
    .order('name');

  if (error) throw new Error(`Failed to list cities: ${error.message}`);
  if (!data) return [];

  // For each city, find the most recent published story. One round-trip per
  // city is fine for a handful of cities; revisit when we have dozens.
  const results = await Promise.all(
    data.map(async (c) => {
      const { data: latest } = await supabase
        .from('stories')
        .select('published_at')
        .eq('city_id', c.id)
        .eq('qc_status', 'approved')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { ...c, latest_at: latest?.published_at || null };
    })
  );

  return results.filter((c) => c.latest_at !== null);
}

/**
 * Resolve the public URL for a given city. Priority:
 *  1. `cities.site_url` if set (per-city manual override).
 *  2. UMBRELLA_DOMAIN template if configured.
 *  3. Fallback to the `{subdomain}-civic-newsletter-build.vercel.app`
 *     convention used during the free-tier MVP phase.
 */
export function cityUrl(city: { subdomain: string; site_url?: string | null }): string {
  if (city.site_url) return city.site_url;
  if (UMBRELLA_DOMAIN) return `https://${city.subdomain}.${UMBRELLA_DOMAIN}`;
  return `https://${city.subdomain}-civic-newsletter-build.vercel.app`;
}
