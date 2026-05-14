import fs from 'node:fs/promises';
import path from 'node:path';
import { supabase, type CityRow, type BrandingPayload } from './supabase';

const DEFAULT_BRANDING: BrandingPayload = {
  hero_url: null,
  primary: '#1f3a5f',
  secondary: '#c9a55c',
  source: 'default',
};

/**
 * Routing is path-based: every city lives at `/{subdomain}` (the column is
 * still called `subdomain` for historical reasons, but it's just the URL
 * slug now). The splash page lives at `/`.
 *
 * Pages get the slug from their route `params.city` and pass it in here.
 * No Host header parsing, no env-var fallback, no UMBRELLA_DOMAIN.
 */

/**
 * Reads web/branding/{slug}/colors.json or hero.{jpg,png,webp}.
 * Overrides take precedence over branding_json from the DB.
 */
async function readOverride(slug: string): Promise<Partial<BrandingPayload>> {
  const dir = path.join(process.cwd(), 'branding', slug);
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
      override.hero_url = `/branding/${slug}/hero.${ext}`;
      break;
    } catch { /* try next */ }
  }

  if (Object.keys(override).length > 0) override.source = 'override';
  return override;
}

/** "Birmingham, Alabama" when state is set; just the name otherwise. */
export function formatCityFull(city: Pick<CityRow, 'name' | 'state'>): string {
  return city.state ? `${city.name}, ${city.state}` : city.name;
}

/** "Birmingham, AL" — compact version for SEO/metadata. */
export function formatCityCompact(city: Pick<CityRow, 'name' | 'state_code'>): string {
  return city.state_code ? `${city.name}, ${city.state_code}` : city.name;
}

/**
 * Loads the city for the given slug + final branding payload (override > db > default).
 * Throws if no active city exists for the slug; callers in `[city]` routes should
 * convert that into a notFound() so users see a 404 rather than a 500.
 */
export async function getCity(slug: string): Promise<CityRow & { branding: BrandingPayload }> {
  if (!slug) throw new Error('getCity() requires a city slug.');

  const { data, error } = await supabase
    .from('cities')
    .select('id, name, subdomain, timezone, branding_json, state, state_code, country')
    .eq('subdomain', slug)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error(`Failed to load city for slug '${slug}': ${error.message}`);
  if (!data) throw new Error(`No active city found for slug '${slug}'.`);

  const override = await readOverride(slug);
  const branding: BrandingPayload = {
    ...DEFAULT_BRANDING,
    ...(data.branding_json || {}),
    ...override,
  };

  return { ...(data as CityRow), branding };
}

/**
 * Try to load the city; return null (instead of throwing) if it doesn't exist
 * or Supabase is unreachable. Used by layouts that want to gracefully fall
 * back to a 404 page rather than rendering a server error.
 */
export async function tryGetCity(
  slug: string
): Promise<(CityRow & { branding: BrandingPayload }) | null> {
  try {
    return await getCity(slug);
  } catch {
    return null;
  }
}

/**
 * List active cities that have at least one approved, published story. Used
 * by the splash page to show "we cover these places today" cards.
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
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state, state_code, subdomain, site_url')
    .eq('active', true)
    .order('name');

  if (error) throw new Error(`Failed to list cities: ${error.message}`);
  if (!data) return [];

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
 * Resolve the public URL for a given city. Path-based routing means every
 * city lives at `/{subdomain}` on the same host. We return a relative path
 * here so links work in any environment (local dev, preview, prod) without
 * baking the host into the URL.
 *
 * `cities.site_url` is still honored as a per-city override for the rare
 * case where a city has its own domain.
 */
export function cityUrl(city: { subdomain: string; site_url?: string | null }): string {
  if (city.site_url) return city.site_url;
  return `/${city.subdomain}`;
}
