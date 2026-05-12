import type { CityRow, BrandingPayload } from './supabase';
import type { StoryRow } from './supabase';
import { headline } from './stories';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com').replace(/\/+$/, '');

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function postUrl(slug: string): string {
  return `${SITE_URL}/posts/${encodeURIComponent(slug)}`;
}

export function renderRss(city: CityRow & { branding: BrandingPayload }, stories: StoryRow[]): string {
  const lastPub = stories[0]?.published_at || new Date().toISOString();
  const items = stories
    .map((s) => {
      const url = postUrl(s.slug);
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
    <link>${SITE_URL}</link>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Plain-language coverage of public meetings in ${xmlEscape(city.name)}.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(lastPub).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

export function renderAtom(city: CityRow & { branding: BrandingPayload }, stories: StoryRow[]): string {
  const updated = stories[0]?.published_at || new Date().toISOString();
  const entries = stories
    .map((s) => {
      const url = postUrl(s.slug);
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
  <id>${SITE_URL}/</id>
  <link href="${SITE_URL}/"/>
  <link rel="self" href="${SITE_URL}/atom.xml"/>
  <updated>${new Date(updated).toISOString()}</updated>
  <subtitle>Plain-language coverage of public meetings in ${xmlEscape(city.name)}.</subtitle>
${entries}
</feed>`;
}
