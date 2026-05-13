import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getCity } from '@/lib/city';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/subscribe
 *
 * Body: { email: string, utm?: Record<string, string> }
 *
 * Adds the email to the active city's Beehiiv publication. Uses the
 * per-city `cities.beehiiv_publication_id` if set, otherwise the global
 * BEEHIIV_PUBLICATION_ID env var as a fallback (single-publication mode
 * during the Birmingham-only phase).
 *
 * Requires BEEHIIV_API_KEY in the Vercel project's environment. If it's
 * missing we degrade to a clear 503 so the front-end can show a useful
 * error instead of silently dropping signups.
 */

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Per-IP rate limiting. Same shape as /api/request-city.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const throttle = new Map<string, number[]>();

const HASH_SALT =
  process.env.REQUEST_HASH_SALT ||
  createHash('sha256').update(`${process.pid}-${Date.now()}-${Math.random()}`).digest('hex');

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_RX.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }

  const utm = isPlainObject(body.utm) ? sanitizeUtm(body.utm) : {};

  const apiKey = process.env.BEEHIIV_API_KEY;
  if (!apiKey) {
    console.error('[subscribe] BEEHIIV_API_KEY is not set in this environment');
    return NextResponse.json(
      { error: 'Subscriptions are temporarily unavailable. Try again later.' },
      { status: 503 }
    );
  }

  // Resolve which Beehiiv publication this signup belongs to.
  let pubId: string | null = null;
  let cityName = 'Civic Weekly';
  try {
    const city = await getCity();
    pubId = city.id ? await resolveCityPubId(city.id) : null;
    cityName = city.name || cityName;
  } catch {
    // splash/no-city — fall through to env fallback
  }
  pubId = pubId || process.env.BEEHIIV_PUBLICATION_ID || null;

  if (!pubId) {
    console.error('[subscribe] No Beehiiv publication id resolved for this request');
    return NextResponse.json(
      { error: 'This city is not configured to accept subscriptions yet.' },
      { status: 503 }
    );
  }

  const ipRaw = extractIp(req);
  const ipHash = createHash('sha256').update(`${HASH_SALT}:${ipRaw}`).digest('hex');
  if (!checkRateLimit(ipHash)) {
    return NextResponse.json({ error: "Too many requests. Try again in a bit." }, { status: 429 });
  }

  try {
    const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        reactivate_existing: true,
        send_welcome_email: true,
        utm_source: utm.utm_source || 'site_subscribe',
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        referring_site: req.headers.get('referer') || undefined,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[subscribe] Beehiiv API ${res.status}:`, text.slice(0, 300));
      return NextResponse.json(
        { error: 'Could not complete signup. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, city: cityName });
  } catch (err: unknown) {
    console.error('[subscribe] fetch failed', err);
    return NextResponse.json(
      { error: 'Could not complete signup. Please try again.' },
      { status: 502 }
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeUtm(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = raw[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) {
      out[k] = v.slice(0, 200);
    }
  }
  return out;
}

async function resolveCityPubId(cityId: string): Promise<string | null> {
  // Service-role-only read so we don't depend on RLS exposing the column.
  // Actually the web uses anon, but cities is anon-readable and
  // beehiiv_publication_id sits next to other columns we already select.
  // Keep this as a single targeted query.
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase
    .from('cities')
    .select('beehiiv_publication_id')
    .eq('id', cityId)
    .maybeSingle();
  if (error) return null;
  return (data?.beehiiv_publication_id as string | null) || null;
}

function extractIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (throttle.get(key) || []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) {
    throttle.set(key, arr);
    return false;
  }
  arr.push(now);
  throttle.set(key, arr);
  return true;
}
