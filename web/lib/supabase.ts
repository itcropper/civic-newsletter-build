import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy init: don't crash on module import if env vars are missing.
// Throw only on first actual use. Lets the build's static-rendering pass
// skip pages that are marked force-dynamic without dragging in a hard
// dependency on Supabase being reachable at build time.

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. ' +
        'Set them in your Vercel project Settings -> Environment Variables.'
    );
  }
  _client = createClient(url, anon, { auth: { persistSession: false } });
  return _client;
}

// Proxy so consumers can still write `supabase.from('...')` etc.
// Methods are resolved against the lazily-built client on first access.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function' ? (value as Function).bind(client) : value;
  },
});

export type CityRow = {
  id: string;
  name: string;
  subdomain: string;
  timezone: string | null;
  branding_json: BrandingPayload | null;
};

export type BrandingPayload = {
  hero_url?: string | null;
  primary?: string | null;
  secondary?: string | null;
  source?: 'wikipedia' | 'override' | 'default';
};

export type StoryRow = {
  id: string;
  city_id: string;
  slug: string;
  summary_text: string;
  category: string | null;
  impact_score: string | null;
  votes_json: unknown;
  tags: string[] | null;
  published_at: string;
  qc_status: string;
  context_note: string | null;
};
