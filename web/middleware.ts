import { NextRequest, NextResponse } from 'next/server';

/**
 * Legacy redirect. If the old single-tenant `CITY_SUBDOMAIN` env var is set
 * on a Vercel project, redirect `/` -> `/{CITY_SUBDOMAIN}` so existing
 * deploys keep working during the cutover to path-based routing.
 *
 * Once every old project is either deleted or has its CITY_SUBDOMAIN var
 * removed, this whole file can be deleted.
 */

const LEGACY_CITY = (process.env.CITY_SUBDOMAIN || '').trim().toLowerCase();

export function middleware(req: NextRequest) {
  if (!LEGACY_CITY) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Only redirect the bare root. Anything under /api, /_next, static files,
  // or an already-prefixed path passes through untouched.
  if (pathname === '/' || pathname === '') {
    const url = req.nextUrl.clone();
    url.pathname = `/${LEGACY_CITY}`;
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

// Match only the root path. Everything else is left alone.
export const config = {
  matcher: ['/'],
};
