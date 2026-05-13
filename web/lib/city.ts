import fs from 'node:fs/promises';
import path from 'node:path';
import { supabase, type CityRow, type BrandingPayload } from './supabase';

// Each deployment is single-tenant. CITY_SUBDOMAIN is set at build time.
const CITY_SUBDOMAIN = process.env.CITY_SUBDOMAIN || 'birmingham';

const DEFAULT_BRANDING: BrandingPayload = {
  hero_url: null,
  primary: '#1f3a5f',
  secondary: '#c9a55c',
  source: 'default',
};

/**
 * Reads /branding/{subdomain}/colors.json or /branding/{subdomain}/hero.{jpg,png}
 * Returns a partial branding payload that overrides whatever's in the DB.
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
      // Local override: served from /branding/{subdomain}/hero.{ext}
      override.hero_url = `/branding/${subdomain}/hero.${ext}`;
      break;
    } catch { /* try next */ }
  }

  if (Object.keys(override).length > 0) override.source = 'override';
  return override;
}

/**
 * Same as getCity but returns a placeholder when Supabase is unreachable or
 * env vars are missing. Used by the layout so a build can still produce a
 * shell even if data fetches fail. Pages still use getCity() and crash
 * loudly so misconfiguration is visible.
 */
export async function getCityOrFallback(): Promise<CityRow & { branding: BrandingPayload }> {
  try {
    return await getCity();
  } catch (err) {
    const subdomain = CITY_SUBDOMAIN;
    const name = subdomain.replace(/(^|-)([a-z])/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase());
    const override = await readOverride(subdomain).catch(() => ({}));
    return {
      id: '00000000-0000-0000-0000-000000000000',
      name,
      subdomain,
      timezone: 'America/Chicago',
      branding_json: null,
      branding: { ...DEFAULT_BRANDING, ...override },
    } as CityRow & { branding: BrandingPayload };
  }
}

/** Loads the city + final branding payload (override > db > default). */
export async function getCity(): Promise<CityRow & { branding: BrandingPayload }> {
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, subdomain, timezone, branding_json')
    .eq('subdomain', CITY_SUBDOMAIN)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error(`Failed to load city: ${error.message}`);
  if (!data) {
    throw new Error(
      `No active city for subdomain '${CITY_SUBDOMAIN}'. ` +
        `Set CITY_SUBDOMAIN env var to a row in the cities table where active=true.`
    );
  }

  const override = await readOverride(CITY_SUBDOMAIN);
  const branding: BrandingPayload = {
    ...DEFAULT_BRANDING,
    ...(data.branding_json || {}),
    ...override,
  };

  return { ...(data as CityRow), branding };
}
