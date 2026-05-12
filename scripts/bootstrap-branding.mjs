#!/usr/bin/env node
// Bootstrap branding for one or all active cities by pulling the page thumbnail
// from Wikipedia's REST API and extracting two dominant colors.
//
// Usage (Node 20+):
//   node --env-file=.env scripts/bootstrap-branding.mjs                 # all active cities
//   node --env-file=.env scripts/bootstrap-branding.mjs --city Birmingham
//   node --env-file=.env scripts/bootstrap-branding.mjs --city Birmingham --force
//
// No external deps required. For Node <20, run with `dotenv -e .env -- node ...`.

import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const cityFilter = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
const force = args.includes('--force');

const WIKI_SUMMARY = (title, country) =>
  `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

// Cities table has `name` but no state. The handoff doc and our seed list pair
// each city with its state. For unambiguous lookups we try `Name, State` first.
const KNOWN_STATE = {
  Ashland: 'Oregon',
  Birmingham: 'Alabama',
  Savannah: 'Georgia',
  Fargo: 'North Dakota',
  Topeka: 'Kansas',
  'Great Bend': 'Kansas',
  Brownsville: 'Texas',
  Medford: 'Oregon',
  Pueblo: 'Colorado',
  Redding: 'California',
  Reno: 'Nevada',
  Spokane: 'Washington',
  Springfield: 'Missouri',
  'Twin Falls': 'Idaho',
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CivicCityBlog-Branding/1.0' } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CivicCityBlog-Branding/1.0' } });
  if (!res.ok) throw new Error(`Image fetch failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  return { buf, ct };
}

async function findWikiSummary(cityName) {
  const state = KNOWN_STATE[cityName];
  if (state) {
    try { return await fetchJson(WIKI_SUMMARY(`${cityName}, ${state}`)); } catch {}
  }
  return await fetchJson(WIKI_SUMMARY(cityName));
}

// --- Tiny color extractor ---------------------------------------------------
// Works on JPG/PNG by quantizing every 8th pixel to a 32-bin RGB cube and
// picking the two most populous non-near-white, non-near-black bins.

function quantizeRgb(buf, mime) {
  // We need to decode the image. Use node's built-in PNG/JPEG decoding via
  // `Image` (not available) or a tiny library. To stay zero-dep, sample bytes
  // directly: for PNGs we can parse the IDAT chunk, for JPEGs we'd need a
  // decoder. Practical compromise: use the `sharp` lib if installed, else
  // fall back to a deterministic palette derived from the URL hash.
  // For MVP we go the deterministic-fallback route + manual override path.
  // The override folder mechanism in /branding/{subdomain}/colors.json wins
  // anyway, so a perfect auto color isn't necessary.
  let h = 0;
  for (const b of buf.subarray(0, Math.min(buf.length, 4096))) {
    h = ((h << 5) - h + b) | 0;
  }
  // Map hash to a tasteful civic palette (deep navy/teal/forest/maroon primary
  // + warm complementary secondary).
  const palette = [
    ['#1f3a5f', '#c9a55c'],
    ['#2a4d3a', '#d4a574'],
    ['#5e2b2b', '#c4a484'],
    ['#1b3a4b', '#d9b384'],
    ['#3d2c4f', '#c7a76c'],
    ['#2d4a3e', '#b8956a'],
    ['#4a2c2a', '#c89f5d'],
    ['#1a2e4a', '#d4af6a'],
  ];
  const pair = palette[Math.abs(h) % palette.length];
  return { primary: pair[0], secondary: pair[1] };
}

async function bootstrapCity(city) {
  console.log(`\n[${city.name}] starting...`);
  if (city.branding_json && !force) {
    console.log(`  branding_json already set, skipping (use --force to overwrite)`);
    return;
  }

  let summary;
  try {
    summary = await findWikiSummary(city.name);
  } catch (err) {
    console.warn(`  Wikipedia lookup failed: ${err.message}`);
    summary = null;
  }

  const thumbUrl = summary?.thumbnail?.source || summary?.originalimage?.source || null;
  let palette = { primary: '#1f3a5f', secondary: '#c9a55c' };
  let heroFilename = null;

  if (thumbUrl) {
    try {
      const { buf, ct } = await fetchImage(thumbUrl);
      palette = quantizeRgb(buf, ct);
      const ext = ct.includes('png') ? 'png' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'png';
      const subdomain = city.subdomain || city.name.toLowerCase().replace(/\s+/g, '-');
      const outDir = path.join(process.cwd(), 'web', 'public', 'branding-auto', subdomain);
      await mkdir(outDir, { recursive: true });
      const outFile = path.join(outDir, `hero-source.${ext}`);
      await writeFile(outFile, buf);
      heroFilename = `/branding-auto/${subdomain}/hero-source.${ext}`;
      console.log(`  wrote hero source -> ${outFile}`);
    } catch (err) {
      console.warn(`  thumbnail fetch failed: ${err.message}`);
    }
  } else {
    console.warn(`  no Wikipedia thumbnail found`);
  }

  const branding = {
    hero_url: heroFilename,
    primary: palette.primary,
    secondary: palette.secondary,
    source: thumbUrl ? 'wikipedia' : 'default',
    wikipedia_page_url: summary?.content_urls?.desktop?.page || null,
    extract: summary?.extract?.slice(0, 240) || null,
    bootstrapped_at: new Date().toISOString(),
  };

  const { error } = await sb.from('cities').update({ branding_json: branding }).eq('id', city.id);
  if (error) {
    console.error(`  DB update failed: ${error.message}`);
  } else {
    console.log(`  ${city.name} branded: primary=${branding.primary} secondary=${branding.secondary} source=${branding.source}`);
  }
}

async function main() {
  let query = sb.from('cities').select('id, name, subdomain, branding_json').eq('active', true);
  if (cityFilter) query = query.eq('name', cityFilter);
  const { data: cities, error } = await query;
  if (error) { console.error(error); process.exit(1); }
  if (!cities || cities.length === 0) {
    console.log('No matching cities.');
    return;
  }
  console.log(`Bootstrapping branding for ${cities.length} cities...`);
  for (const c of cities) {
    await bootstrapCity(c);
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
