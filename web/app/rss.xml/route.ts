import { getCity } from '@/lib/city';
import { listStories } from '@/lib/stories';
import { renderRss } from '@/lib/feeds';

export const revalidate = 600;
export const dynamic = 'force-dynamic';

export async function GET() {
  const [city, stories] = await Promise.all([getCity(), listStories({ limit: 25 })]);
  return new Response(renderRss(city, stories), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
