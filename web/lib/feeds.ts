import type { CityRow, BrandingPayload, StoryRow } from './supabase';
import { headers } from 'next/headers';
import { headline } from './stories';

/**
 * Compute the absolute base URL for outbound links (RSS items, Atom entries,
 * canonical tags) from the current request. No env var, no config -- the URL
 * a reader hits to fetch the feed is the same URL we put inside the feed.
 */
export function getBaseUrl(): string {
  const h = headers();
  const host = h.get('host') || 'localhost:3000';
  const fwdProto = h.get('x-forwarded-proto');
  const proto = fwdProto || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderRss(city: CityRow & { branding: BrandingPayload }, stories: StoryRow[]): string {
  const base = getBaseUrl();
  const cityBase = `${base}/${encodeURIComponent(city.subdomain)}`;
  const lastPub = stories[0]?.published_at || new Date().toISOString();
  const items = stories
    .map((s) => {
      const url = `${cityBase}/posts/${encodeURIComponent(s.slug)}`;
      const title = xmlEscape(headline(s, 140));
      const body = xmlEscape(s.summary_text);
      const cats = (s.tags || []).map((t) => `<category>${xmlEscape(t)}</category>`).join('');
      return `    <item>
      <title>${title}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(s.published_at).toUTCString()}</pubDate>
      ${cats}
      <description>${body}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(city.name + ' Civic')}</title>
    <link>${cityBase}</link>
    <atom:link href="${cityBase}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Plain-language coverage of public meetings in ${xmlEscape(city.name)}.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(lastPub).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

export function renderAtom(city: CityRow & { branding: BrandingPayload }, stories: StoryRow[]): string {
  const base = getBaseUrl();
  const cityBase = `${base}/${encodeURIComponent(city.subdomain)}`;
  const updated = stories[0]?.published_at || new Date().toISOString();
  const entries = stories
    .map((s) => {
      const url = `${cityBase}/posts/${encodeURIComponent(s.slug)}`;
      return `  <entry>
    <title>${xmlEscape(headline(s, 140))}</title>
    <id>${url}</id>
    <link href="${url}"/>
    <updated>${new Date(s.published_at).toISOString()}</updated>
    <content type="html">${xmlEscape(s.summary_text)}</content>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(city.name + ' Civic')}</title>
  <id>${cityBase}/</id>
  <link href="${cityBase}/"/>
  <link rel="self" href="${cityBase}/atom.xml"/>
  <updated>${new Date(updated).toISOString()}</updated>
  <subtitle>Plain-language coverage of public meetings in ${xmlEscape(city.name)}.</subtitle>
${entries}
</feed>`;
}
