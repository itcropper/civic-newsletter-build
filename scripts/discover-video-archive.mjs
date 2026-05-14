#!/usr/bin/env node
/**
 * Run the Video Archive Discoverer for one city (or all active cities)
 * outside the normal pipeline schedule. Useful for:
 *
 *   - Onboarding: kick discovery for a new city right after inserting
 *     its row, instead of waiting for the nightly run.
 *   - Re-trying after a `manual_needed` flag: bump attempts back to 0
 *     before running so the 3-strategy ladder restarts.
 *
 * Usage:
 *   node --env-file=.env scripts/discover-video-archive.mjs --slug ashland-or
 *   node --env-file=.env scripts/discover-video-archive.mjs --slug ashland-or --reset
 *   node --env-file=.env scripts/discover-video-archive.mjs --all
 *   node --env-file=.env scripts/discover-video-archive.mjs --list-manual-needed
 */

import supabase from '../src/config/db.js';
import { runVideoArchiveDiscoverer } from '../src/agents/01a-video-archive-discoverer.js';

const args = parseArgs(process.argv.slice(2));

if (args['list-manual-needed']) {
  const { data } = await supabase
    .from('cities_awaiting_video_archive')
    .select('*');
  if (!data || data.length === 0) {
    console.log('No cities awaiting manual video archive intervention.');
  } else {
    console.log(`${data.length} cities awaiting operator action:`);
    for (const c of data) {
      console.log(`  - ${c.name} (${c.subdomain}): ${c.video_archive_attempts} attempts, last ${c.video_archive_last_attempt_at}`);
      console.log(`    seed_url: ${c.seed_url}`);
    }
  }
  process.exit(0);
}

let targets = [];
if (args.all) {
  const { data } = await supabase
    .from('cities')
    .select('id, name, subdomain')
    .eq('active', true)
    .order('name');
  targets = data || [];
} else if (args.slug) {
  const { data } = await supabase
    .from('cities')
    .select('id, name, subdomain')
    .eq('subdomain', args.slug)
    .single();
  if (!data) {
    console.error(`No city found with subdomain '${args.slug}'.`);
    process.exit(1);
  }
  targets = [data];
} else {
  console.error('Usage: --slug <subdomain> [--reset] | --all | --list-manual-needed');
  process.exit(1);
}

for (const city of targets) {
  if (args.reset) {
    await supabase
      .from('cities')
      .update({
        video_archive_discovery_status: 'unknown',
        video_archive_attempts: 0,
        video_archive_last_attempt_at: null,
      })
      .eq('id', city.id);
    console.log(`[reset] ${city.name}: attempts → 0, status → unknown`);
  }

  console.log(`\n=== ${city.name} (${city.subdomain}) ===`);
  const result = await runVideoArchiveDiscoverer(city.id);
  console.log(JSON.stringify(result, null, 2));
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
