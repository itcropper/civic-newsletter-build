import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=<query>
 *
 * Typeahead for the splash-page city picker. Returns up to 8 active cities
 * whose name OR state contains the query (case-insensitive). Anon-readable
 * (cities is publicly readable today; will stay that way after RLS lockdown
 * because city names + subdomains are the rendered content).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [] });
  }

  // ilike with leading/trailing wildcards. We OR across name and state.
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state, state_code, subdomain')
    .eq('active', true)
    .or(`name.ilike.${pattern},state.ilike.${pattern},state_code.ilike.${pattern}`)
    .order('name')
    .limit(8);

  if (error) {
    return NextResponse.json({ hits: [], error: error.message }, { status: 500 });
  }
  return NextResponse.json({ hits: data || [] });
}
