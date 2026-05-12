#!/usr/bin/env node
// Generate Facebook/Nextdoor ad creative for a city's top approved story.
//
// Usage (Node 20+):
//   node --env-file=.env scripts/generate-ad-creative.mjs --city Birmingham
//   node --env-file=.env scripts/generate-ad-creative.mjs --city Birmingham --story <story-id>
//   node --env-file=.env scripts/generate-ad-creative.mjs --city Birmingham --platforms facebook,nextdoor
//
// Output:
//   output/ads/<subdomain>/<YYYY-MM-DD>/payload.json   (machine-readable)
//   output/ads/<subdomain>/<YYYY-MM-DD>/preview.md     (human-readable review)
//
// Submission to Facebook Marketing API and Nextdoor Ads API is intentionally
// left out of this script — those require account credentials Ian needs to
// provision. See docs/AD_SUBMISSION.md for the submission step.

import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SITE_URL_TEMPLATE = process.env.SITE_URL_TEMPLATE || 'https://{subdomain}-civic.vercel.app';

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error('Need SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY in .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const cityName = opt('--city') || 'Birmingham';
const storyId = opt('--story');
const platforms = (opt('--platforms') || 'facebook,nextdoor').split(',').map((s) => s.trim());

const AD_COPY_SYSTEM = `You are a Facebook and Nextdoor ad copywriter for a civic news site. Write 3 ad copy variants for the provided story.

RULES:
- All claims must come directly from the story summary. No embellishment, no exaggeration, no new information.
- Neutral, factual, no partisan framing.
- Plain language. No jargon. No clickbait.

For each variant:
- Headline: max 40 characters
- Body: 1 sentence, max 90 characters
- Cta: one of "Learn more", "Read story", "See details"

Three variants differ by hook angle:
1. "civic_fact" - States what happened (factual headline)
2. "resident_impact" - States what it means for residents
3. "curiosity" - Prompts the reader with a specific question

Return JSON array only, no preamble:
[
  {"angle":"civic_fact","headline":"...","body":"...","cta":"..."},
  {"angle":"resident_impact","headline":"...","body":"...","cta":"..."},
  {"angle":"curiosity","headline":"...","body":"...","cta":"..."}
]`;

const TARGETING_SYSTEM = `You are an ads targeting specialist for local civic news. Given a city and a story summary, produce a targeting brief that fits Facebook Marketing API and Nextdoor Ads API.

Return strict JSON:
{
  "geo": {"city": "...", "state": "...", "radius_miles": 5},
  "age": {"min": 28, "max": 65},
  "interests": ["...", "..."],
  "behaviors": ["..."],
  "exclude": ["users who clicked this campaign in last 30 days"],
  "rationale": "1-2 sentence explanation"
}`;

async function callClaude(system, user, model = 'claude-haiku-4-5-20251001') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1024, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) {
    throw new Error(`Claude error ${res.status}: ${await res.text()}`);
  }
  const d = await res.json();
  return d.content[0].text;
}

function parseJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const m2 = m[1].match(/[\[\{][\s\S]*[\]\}]/);
  return JSON.parse(m2 ? m2[0] : m[1]);
}

function buildUtmUrl(siteUrl, slug, platform, campaign) {
  const u = new URL(`/posts/${slug}`, siteUrl);
  u.searchParams.set('utm_source', platform);
  u.searchParams.set('utm_medium', 'cpc');
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

async function main() {
  console.log(`\nGenerating ad creative for ${cityName} on platforms: ${platforms.join(', ')}\n`);

  // Find the city.
  const { data: city, error: cityErr } = await sb
    .from('cities')
    .select('id, name, subdomain, branding_json')
    .eq('name', cityName)
    .single();
  if (cityErr || !city) throw new Error(`City not found: ${cityName}`);

  // Pick the story: explicit ID, or the most recent High-impact approved one.
  let storyQuery = sb
    .from('stories')
    .select('id, slug, summary_text, category, impact_score, tags, published_at')
    .eq('city_id', city.id)
    .eq('qc_status', 'approved')
    .not('slug', 'is', null);
  if (storyId) storyQuery = storyQuery.eq('id', storyId);
  else storyQuery = storyQuery.order('impact_score', { ascending: false }).order('published_at', { ascending: false }).limit(1);

  const { data: stories, error: storyErr } = await storyQuery;
  if (storyErr) throw new Error(storyErr.message);
  if (!stories || stories.length === 0) throw new Error('No approved stories with slugs for this city.');

  const story = stories[0];
  console.log(`Story: ${story.summary_text.substring(0, 80)}...`);
  console.log(`Category: ${story.category}, Impact: ${story.impact_score}`);

  // Build campaign id for UTMs.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const campaign = `${city.subdomain}_${story.slug.substring(0, 30)}_${dateStamp}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const siteUrl = SITE_URL_TEMPLATE.replace('{subdomain}', city.subdomain);

  console.log(`\nGenerating ad copy variants...`);
  const adCopyRaw = await callClaude(AD_COPY_SYSTEM, `City: ${city.name}\nCategory: ${story.category}\nImpact: ${story.impact_score}\nSummary: ${story.summary_text}`);
  const variants = parseJSON(adCopyRaw).map((v) => ({
    ...v,
    headline: (v.headline || '').substring(0, 40),
    body: (v.body || '').substring(0, 90),
  }));
  console.log(`  Got ${variants.length} variants`);

  console.log(`\nGenerating targeting brief...`);
  const targetingRaw = await callClaude(TARGETING_SYSTEM, `City: ${city.name}\nStory: ${story.summary_text.substring(0, 400)}`);
  const targeting = parseJSON(targetingRaw);
  console.log(`  Geo: ${targeting.geo?.city}, ${targeting.geo?.state} (radius ${targeting.geo?.radius_miles}mi)`);

  // Build per-platform payloads with UTM-tagged destinations.
  const payloads = {};
  for (const platform of platforms) {
    const destination = buildUtmUrl(siteUrl, story.slug, platform, campaign);
    payloads[platform] = {
      platform,
      destination_url: destination,
      creative_variants: variants.map((v) => ({
        ...v,
        link: destination,
      })),
      audience: targeting,
      budget: { daily_usd: 20, total_usd: 100, duration_days: 5 },
      campaign_id: campaign,
      story_id: story.id,
      city: city.name,
      generated_at: new Date().toISOString(),
    };
  }

  const outDir = path.join(process.cwd(), 'output', 'ads', city.subdomain, dateStamp);
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, 'payload.json'), JSON.stringify({ city: city.name, story_id: story.id, platforms: payloads }, null, 2));

  // Human-readable preview for review before submission.
  const preview = renderPreview(city, story, variants, targeting, payloads);
  await writeFile(path.join(outDir, 'preview.md'), preview);

  console.log(`\nWrote ${path.join(outDir, 'payload.json')}`);
  console.log(`Wrote ${path.join(outDir, 'preview.md')}`);
  console.log(`\nNext step: review preview.md, then see docs/AD_SUBMISSION.md to submit.`);
}

function renderPreview(city, story, variants, targeting, payloads) {
  const lines = [];
  lines.push(`# Ad creative preview \u2014 ${city.name}`);
  lines.push(`Generated ${new Date().toISOString()}.`);
  lines.push('');
  lines.push(`## Source story`);
  lines.push(`- Slug: \`${story.slug}\``);
  lines.push(`- Category: ${story.category} \u00b7 Impact: ${story.impact_score}`);
  lines.push('');
  lines.push(`${story.summary_text}`);
  lines.push('');
  lines.push(`## Creative variants`);
  for (const v of variants) {
    lines.push(`### ${v.angle}`);
    lines.push(`**${v.headline}**`);
    lines.push(v.body);
    lines.push(`CTA: ${v.cta}`);
    lines.push('');
  }
  lines.push(`## Targeting`);
  lines.push('```json');
  lines.push(JSON.stringify(targeting, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`## Per-platform destinations`);
  for (const [platform, p] of Object.entries(payloads)) {
    lines.push(`- **${platform}**: ${p.destination_url}`);
  }
  lines.push('');
  lines.push(`## Suggested budget`);
  lines.push(`$20/day x 5 days = $100 total per platform. Adjust in payload.json before submission.`);
  return lines.join('\n');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
