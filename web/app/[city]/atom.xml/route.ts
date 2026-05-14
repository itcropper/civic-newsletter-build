import { notFound } from 'next/navigation';
import { tryGetCity } from '@/lib/city';
import { listStories } from '@/lib/stories';
import { renderAtom } from '@/lib/feeds';

export const revalidate = 600;
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { city: string } }
) {
  const city = await tryGetCity(params.city);
  if (!city) notFound();
  const stories = await listStories(city.id, { limit: 25 });
  return new Response(renderAtom(city, stories), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
}
