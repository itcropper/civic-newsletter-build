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
