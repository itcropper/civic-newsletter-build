import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/request-city
 *
 * Body: { city_name: string, state: string, email: string }
 *
 * Anon insert into city_requests. We hash the IP (salted with REQUEST_HASH_SALT
 * if set; otherwise a per-process random value, which is fine for soft
 * throttling) so we can rate-limit without storing PII. The DB also enforces
 * length + email-shape constraints as defense in depth.
 */

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// In-memory throttle. Single-region MVP. Swap to Redis when we scale to
// multiple Vercel regions.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;
const throttle = new Map<string, number[]>();

// Hash salt: prefer env, fall back to a per-process random so we don't crash
// without configuration. A per-process salt is enough for rate-limiting; if
// you want hashes that survive deploys, set REQUEST_HASH_SALT in Vercel.
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

  const cityName = typeof body.city_name === 'string' ? body.city_name.trim() : '';
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';

  if (!cityName || cityName.length > 100) {
    return NextResponse.json({ error: 'City name is required (1-100 chars)' }, { status: 400 });
  }
  if (!state || state.length > 60) {
    return NextResponse.json({ error: 'State is required' }, { status: 400 });
  }
  if (!email || !EMAIL_RX.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }

  const ipRaw = extractIp(req);
  const ipHash = createHash('sha256').update(`${HASH_SALT}:${ipRaw}`).digest('hex');

  if (!checkRateLimit(ipHash)) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a bit." },
      { status: 429 }
    );
  }

  const userAgent = req.headers.get('user-agent')?.slice(0, 500) || null;

  // Call the SECURITY DEFINER function rather than INSERTing directly.
  // city_requests stays anon-write-disabled at the table level; the function
  // is the only public insert path and re-validates input as defense in depth.
  const { error } = await supabase.rpc('submit_city_request', {
    p_city_name: cityName,
    p_state: state,
    p_email: email,
    p_user_agent: userAgent,
    p_ip_hash: ipHash,
  });

  if (error) {
    // Don't leak DB error text to the public.
    console.error('[request-city] insert failed', error);
    return NextResponse.json({ error: 'Could not save request. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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
