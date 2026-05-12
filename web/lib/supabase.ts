import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
}

// Single client per process. RLS-readable rows only.
export const supabase: SupabaseClient = createClient(url, anon, {
  auth: { persistSession: false },
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
