#!/usr/bin/env node
/**
 * Run just the crawler (no transcription, no AssemblyAI cost) for one
 * city, then print the meetings that landed in the queue. Useful for
 * verifying that the discoverer + crawler are pulling in the right
 * content before committing to a full pipeline run.
 *
 * Usage:
 *   node scripts/run-crawler.mjs --slug ashland-or
 *   node scripts/run-crawler.mjs --slug ashland-or --since 7
 *
 * The script also runs the video-archive discoverer first (no-op if the
 * city already has video_archive_urls set), so a fresh city can be
 * crawled end-to-end with one command.
 */

import 'dotenv/config';
import supabase from '../src/config/db.js';
import { runVideoArchiveDiscoverer } from '../src/agents/01a-video-archive-discoverer.js';
import { runCrawler } from '../src/agents/01-crawler.js';

const args = parseArgs(process.argv.slice(2));
const slug = args.slug;
const sinceDays = parseInt(args.since || '1', 10);

if (!slug) {
  console.error('Usage: --slug <subdomain> [--since <days>]');
  process.exit(1);
}

const { data: city, error } = await supabase
  .from('cities')
  .select('id, name, subdomain')
  .eq('subdomain', slug)
  .single();

if (error || !city) {
  console.error(`No city found with subdomain '${slug}'.`);
  process.exit(1);
}

console.log(`\n=== Discoverer pass (no-op if already discovered) ===`);
const discoveryResult = await runVideoArchiveDiscoverer(city.id);
console.log(JSON.stringify(discoveryResult, null, 2));

console.log(`\n=== Crawler ===`);
const crawlResult = await runCrawler(city.id);
console.log(JSON.stringify(crawlResult, null, 2));

// Show what landed in the meetings table from this run (anything created
// in the last `sinceDays` days).
const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
const { data: meetings } = await supabase
  .from('meetings')
  .select('id, source_url, url, meeting_type, meeting_date, status, created_at')
  .eq('city_id', city.id)
  .gte('created_at', sinceIso)
  .order('created_at', { ascending: false });

console.log(`\n=== Meetings queued for ${city.name} in the last ${sinceDays}d ===`);
if (!meetings || meetings.length === 0) {
  console.log('(none)');
} else {
  for (const m of meetings) {
    const u = m.source_url || m.url;
    const looksVideo = /(youtube|youtu\.be|vimeo|telvue|granicus|\.mp4|\.m3u8|player|video|watch|playlists?)/i.test(u || '');
    console.log(`  - [${m.status}] ${m.meeting_type || '?'} ${m.meeting_date || '?'}  ${looksVideo ? '🎥' : '📄'}  ${u}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}
