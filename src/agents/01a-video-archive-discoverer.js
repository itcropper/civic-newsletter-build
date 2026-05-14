/**
 * Agent 1a — Video Archive Discoverer
 * Model: Claude Sonnet (LLM strategy only; pattern + path probes are deterministic)
 *
 * Auto-discovers the page that lists the city's collection of past
 * meeting videos (the "video archive index"), so the crawler can walk it
 * and queue every recording for transcription.
 *
 * Why this is separate from the crawler:
 *   The crawler walks operator-supplied archive_urls + one level outward.
 *   In practice those URLs point at minutes/agendas pages, NOT at the
 *   video portal — Granicus/Legistar/iQM2 typically live on a separate
 *   subdomain. The crawler never reaches them. This agent finds them.
 *
 * Three strategies, each counts as one attempt. Capped at 3 attempts per
 * city total; once exceeded, status flips to 'manual_needed' and the
 * observer report surfaces the city for operator intervention.
 *
 * Strategies, in order:
 *   1. PATTERN: probe canonical platform URLs derived from the city's
 *      domain (Granicus / Legistar / iQM2 / PrimeGov / Novus / Boarddocs).
 *      Cheap — HEAD + small GET. No LLM call.
 *   2. PATH: probe the city's own domain for likely video-archive paths
 *      (/watch, /video, /cctv, /meeting-videos, etc.). Same cost shape.
 *   3. LLM: a guided crawl from the seed URL, prompt explicitly scoped
 *      to "find the page that lists ALL past meeting videos, not any
 *      single video." Up to ~6 fetches, one Claude Sonnet call.
 *
 * State machine on cities:
 *   unknown      → on success: discovered      / on each fail: attempts++
 *                  after attempts == 3        → manual_needed
 *   discovered   → no-op (skip; crawler walks the URLs)
 *   manual_set   → no-op (operator owns this; never auto-overwrite)
 *   manual_needed → no-op until status changes (operator unblocks by
 *                   setting video_archive_urls; pipeline transitions to
 *                   manual_set on next run)
 *
 * Once an operator populates video_archive_urls, transition to manual_set
 * happens automatically on the next discoverer run.
 */

import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';

const HEAD_TIMEOUT_MS = 6000;
const GET_TIMEOUT_MS = 12000;
const POLITE_DELAY_MS = 800;
const MAX_LLM_FETCHES = 6;
const MIN_CONFIDENCE = 0.7;
const USER_AGENT =
  'Mozilla/5.0 (compatible; CivicNewsletterBot/1.0; +https://civicnewsletter.com/bot)';

/**
 * Run video-archive discovery for a single city.
 *
 * @param {string} cityId
 * @returns {object} {
 *   status: 'discovered'|'manual_needed'|'manual_set'|'already_done'|'skipped',
 *   foundUrls: string[],
 *   strategyUsed: 'pattern'|'path'|'llm'|null,
 *   attemptsAfter: number,
 *   reason?: string,
 * }
 */
export async function runVideoArchiveDiscoverer(cityId) {
  const { data: city, error } = await supabase
    .from('cities')
    .select('id, name, seed_url, archive_urls, video_archive_urls, video_archive_discovery_status, video_archive_attempts')
    .eq('id', cityId)
    .single();

  if (error || !city) throw new Error(`City not found: ${cityId}`);

  // If operator populated URLs themselves, lock to manual_set and exit.
  if (Array.isArray(city.video_archive_urls) && city.video_archive_urls.length > 0) {
    if (city.video_archive_discovery_status !== 'manual_set' &&
        city.video_archive_discovery_status !== 'discovered') {
      // Operator added URLs while status was unknown/manual_needed.
      // Promote to manual_set so we stop auto-trying.
      await supabase.from('cities')
        .update({ video_archive_discovery_status: 'manual_set' })
        .eq('id', cityId);
      console.log(`[VideoDiscoverer] ${city.name}: operator set video_archive_urls — locked to manual_set.`);
    }
    return {
      status: 'manual_set',
      foundUrls: city.video_archive_urls,
      strategyUsed: null,
      attemptsAfter: city.video_archive_attempts,
    };
  }

  // Already discovered? Nothing to do — crawler will walk the URLs.
  if (city.video_archive_discovery_status === 'discovered') {
    return {
      status: 'already_done',
      foundUrls: city.video_archive_urls || [],
      strategyUsed: null,
      attemptsAfter: city.video_archive_attempts,
    };
  }

  // Hit the 3-attempt cap — wait for operator.
  if (city.video_archive_attempts >= 3 &&
      city.video_archive_discovery_status === 'manual_needed') {
    return {
      status: 'manual_needed',
      foundUrls: [],
      strategyUsed: null,
      attemptsAfter: city.video_archive_attempts,
      reason: 'Awaiting operator: 3 prior attempts produced no high-confidence match.',
    };
  }

  // Decide which strategy to run based on attempts so far.
  // attempt 0 → PATTERN; attempt 1 → PATH; attempt 2 → LLM.
  const attemptIdx = Math.min(city.video_archive_attempts, 2);
  const strategy = ['pattern', 'path', 'llm'][attemptIdx];
  console.log(`[VideoDiscoverer] ${city.name}: attempt ${attemptIdx + 1}/3 — strategy=${strategy}`);

  let result = { urls: [], confidence: 0, reason: '' };
  try {
    if (strategy === 'pattern') result = await strategyPattern(city);
    else if (strategy === 'path') result = await strategyPath(city);
    else result = await strategyLLM(city);
  } catch (err) {
    result.reason = `strategy threw: ${err.message}`;
  }

  const newAttempts = city.video_archive_attempts + 1;
  const succeeded = result.urls.length > 0 && result.confidence >= MIN_CONFIDENCE;

  const update = {
    video_archive_attempts: newAttempts,
    video_archive_last_attempt_at: new Date().toISOString(),
  };

  if (succeeded) {
    update.video_archive_urls = result.urls;
    update.video_archive_discovery_status = 'discovered';
  } else if (newAttempts >= 3) {
    update.video_archive_discovery_status = 'manual_needed';
  }

  await supabase.from('cities').update(update).eq('id', cityId);

  if (succeeded) {
    console.log(`[VideoDiscoverer] ${city.name}: discovered via ${strategy}. URLs: ${result.urls.join(', ')}`);
    return {
      status: 'discovered',
      foundUrls: result.urls,
      strategyUsed: strategy,
      attemptsAfter: newAttempts,
      reason: result.reason,
    };
  }

  if (newAttempts >= 3) {
    console.warn(`[VideoDiscoverer] ${city.name}: 3 strategies failed — flagged for manual intervention.`);
    return {
      status: 'manual_needed',
      foundUrls: [],
      strategyUsed: strategy,
      attemptsAfter: newAttempts,
      reason: result.reason || 'No high-confidence match after 3 strategies.',
    };
  }

  console.log(`[VideoDiscoverer] ${city.name}: ${strategy} failed (${result.reason || 'no match'}); will try next strategy on next run.`);
  return {
    status: 'skipped',
    foundUrls: [],
    strategyUsed: strategy,
    attemptsAfter: newAttempts,
    reason: result.reason,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Strategy 1: PATTERN — probe canonical platform URLs derived from the
// city's domain. No LLM. Civic platforms tend to follow predictable
// subdomain naming: {city}.legistar.com, {city}.iqm2.com, etc.
// ────────────────────────────────────────────────────────────────────────

async function strategyPattern(city) {
  const slugs = candidateSlugs(city);
  if (slugs.length === 0) return { urls: [], confidence: 0, reason: 'no slug candidates' };

  // Each entry: subdomain template + a path that lists meeting recordings.
  const templates = [
    // Granicus / Legistar — same family. ViewPublisher is the video index;
    // Calendar shows agendas (also has video links).
    (s) => `https://${s}.granicus.com/ViewPublisher.php?view_id=1`,
    (s) => `https://${s}.granicus.com/ViewPublisher.php?view_id=2`,
    (s) => `https://${s}.legistar.com/Calendar.aspx`,
    // iQM2 — citizens portal lists past meetings with video links.
    (s) => `https://${s}.iqm2.com/Citizens/Default.aspx`,
    (s) => `https://${s}.iqm2.com/Citizens/Calendar.aspx`,
    // PrimeGov
    (s) => `https://${s}.primegov.com/portal/meetings`,
    // Novus Agenda
    (s) => `https://${s}.novusagenda.com/agendapublic/`,
    // Boarddocs (school boards)
    (s) => `https://go.boarddocs.com/${s}/Board.nsf/Public`,
  ];

  const hits = [];
  for (const slug of slugs) {
    for (const tmpl of templates) {
      const url = tmpl(slug);
      const ok = await probeForArchive(url);
      if (ok.matches) {
        hits.push({ url, confidence: ok.confidence, hint: ok.hint });
      }
      await sleep(POLITE_DELAY_MS);
    }
  }

  if (hits.length === 0) {
    return { urls: [], confidence: 0, reason: `probed ${slugs.length * templates.length} pattern URLs, no archive matches` };
  }

  hits.sort((a, b) => b.confidence - a.confidence);
  const top = hits.slice(0, 2);
  return {
    urls: top.map((h) => h.url),
    confidence: top[0].confidence,
    reason: `pattern probe: ${top.map((h) => h.hint).join('; ')}`,
  };
}

/**
 * Build candidate slugs from the city's seed_url hostname and name.
 * `birminghamal.gov` → ['birminghamal', 'birmingham'].
 * Used as Granicus / Legistar / iQM2 subdomain hints.
 */
function candidateSlugs(city) {
  const out = new Set();
  try {
    const host = new URL(ensureProtocol(city.seed_url)).hostname.toLowerCase();
    // Strip the TLD plus common municipal patterns: ".gov", ".us", ".net".
    const base = host
      .replace(/^www\./, '')
      .replace(/\.gov$|\.us$|\.net$|\.org$|\.com$/, '');
    // base might still have a city.state shape: "birminghamal" or "fargond".
    out.add(base);
    // Strip trailing 2-letter state code if present (heuristic).
    const stripped = base.replace(/(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)$/, '');
    if (stripped && stripped !== base) out.add(stripped);
  } catch { /* malformed seed_url */ }

  // Also try a slug derived from the city name itself.
  if (city.name) {
    const nameSlug = city.name.toLowerCase().replace(/[^a-z]+/g, '');
    if (nameSlug) out.add(nameSlug);
  }
  return Array.from(out).filter((s) => s.length >= 3 && s.length <= 40);
}

// ────────────────────────────────────────────────────────────────────────
// Strategy 2: PATH — probe the city's OWN domain for likely paths to a
// video-archive index. Many cities self-host video tabs under /watch,
// /cctv, /government/meeting-videos, etc.
// ────────────────────────────────────────────────────────────────────────

const VIDEO_ARCHIVE_PATHS = [
  '/watch',
  '/videos',
  '/video',
  '/cctv',
  '/media',
  '/recordings',
  '/streaming',
  '/live',
  '/government/meeting-videos',
  '/government/videos',
  '/government/watch',
  '/government/media',
  '/government/streaming',
  '/city-council/videos',
  '/city-council/watch',
  '/meetings/videos',
  '/meetings/watch',
  '/meeting-videos',
  '/meeting-archive',
  '/agenda-center/videos',
];

async function strategyPath(city) {
  let origin;
  try {
    origin = new URL(ensureProtocol(city.seed_url)).origin;
  } catch {
    return { urls: [], confidence: 0, reason: 'invalid seed_url' };
  }

  const hits = [];
  for (const path of VIDEO_ARCHIVE_PATHS) {
    const url = origin + path;
    const ok = await probeForArchive(url);
    if (ok.matches) hits.push({ url, confidence: ok.confidence, hint: ok.hint });
    await sleep(POLITE_DELAY_MS);
  }

  if (hits.length === 0) {
    return { urls: [], confidence: 0, reason: `probed ${VIDEO_ARCHIVE_PATHS.length} common paths, no archive matches` };
  }

  hits.sort((a, b) => b.confidence - a.confidence);
  const top = hits.slice(0, 2);
  return {
    urls: top.map((h) => h.url),
    confidence: top[0].confidence,
    reason: `path probe: ${top.map((h) => h.hint).join('; ')}`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Strategy 3: LLM — guided crawl from seed URL. Prompt scoped to "find the
// page that lists ALL past meeting videos." Up to MAX_LLM_FETCHES fetches.
// ────────────────────────────────────────────────────────────────────────

const ARCHIVE_FINDER_SYSTEM = `You are an AI web navigator helping to find ONE specific page for a city government website: the **video archive index page**.

DEFINITION (be strict):
A "video archive index" is a single page that lists the COLLECTION of recorded public meeting videos — typically organized by date and meeting body (city council, planning commission, etc.). Examples of what counts:
- "Watch past meetings" pages on Granicus / Legistar / iQM2 portals
- City-hosted "/watch" or "/cctv" pages listing dozens of past meeting recordings
- City YouTube channel "Uploads" / "Videos" tab if it's the canonical archive
- A "Meeting Videos" tab on AgendaCenter / civic platforms

What does NOT count:
- A single video page (one meeting)
- A page that just embeds the current live stream
- An agenda/minutes listing with no video links
- The city's homepage or general government landing page

Return JSON:
{
  "found": true|false,
  "archive_url": "<full URL of the video archive index, or null>",
  "confidence": 0.0-1.0,
  "evidence": "short quote or visible element that proves this page lists multiple past meeting videos",
  "next_links": [
    {"url": "<absolute URL to try next>", "reason": "<why this is a promising lead>"}
  ],
  "reasoning": "what you observed on this page"
}

RULES:
- "found" must be true ONLY if THIS page itself is the archive index. If you only see a LINK to it, mark found=false and put the URL in next_links.
- confidence ≥ 0.7 means "I am confident this is the archive index." Reserve ≥ 0.9 for cases where the page clearly shows a list of dated meeting videos.
- next_links should be at most 4 URLs. Prefer links labeled "video", "watch", "archive", "recordings", "media", "cctv", "live stream archive", or any civic-platform subdomain link (Granicus, Legistar, iQM2, PrimeGov).
- Do NOT include single-meeting video URLs in next_links — only candidates for the INDEX page.`;

async function strategyLLM(city) {
  let seed;
  try {
    seed = ensureProtocol(city.seed_url);
  } catch {
    return { urls: [], confidence: 0, reason: 'invalid seed_url' };
  }

  const visited = new Set();
  const queue = [{ url: seed, reason: 'seed URL' }];
  let fetches = 0;
  let best = { url: null, confidence: 0, evidence: '' };

  while (queue.length > 0 && fetches < MAX_LLM_FETCHES) {
    const next = queue.shift();
    const normalized = normalizeUrl(next.url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const page = await fetchPageText(normalized);
    if (!page) continue;
    fetches++;

    let analysis;
    try {
      analysis = await callClaudeJSON(
        MODELS.SONNET,
        ARCHIVE_FINDER_SYSTEM,
        `CURRENT URL: ${normalized}\n\nPAGE TEXT (first 6000 chars):\n${page.text.substring(0, 6000)}\n\nLINKS ON PAGE (first 80):\n${page.links.slice(0, 80).map((l) => `- ${l}`).join('\n')}`,
        { maxTokens: 1024 }
      );
    } catch (err) {
      continue;
    }

    if (analysis.found && analysis.archive_url && (analysis.confidence || 0) > best.confidence) {
      best = {
        url: analysis.archive_url,
        confidence: analysis.confidence || 0.7,
        evidence: analysis.evidence || '',
      };
      // Early-exit on a strong match.
      if (best.confidence >= 0.9) break;
    }

    for (const link of (analysis.next_links || []).slice(0, 4)) {
      if (link.url && !visited.has(normalizeUrl(link.url))) {
        queue.push({ url: link.url, reason: link.reason });
      }
    }

    await sleep(POLITE_DELAY_MS);
  }

  if (!best.url || best.confidence < MIN_CONFIDENCE) {
    return {
      urls: [],
      confidence: best.confidence,
      reason: `LLM crawl over ${fetches} pages did not surface a high-confidence archive index`,
    };
  }

  return {
    urls: [best.url],
    confidence: best.confidence,
    reason: `LLM strategy: ${best.evidence}`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Lightweight probe: fetch a URL, decide whether the page looks like a
 * video archive index. Heuristic-only; no LLM call.
 *
 * Returns { matches: boolean, confidence: number, hint: string }.
 */
async function probeForArchive(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(GET_TIMEOUT_MS),
    });

    if (!resp.ok) return { matches: false, confidence: 0, hint: `http ${resp.status}` };

    const html = (await resp.text()).slice(0, 60000);
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase();

    // Strong signals: explicit "video archive" language + multiple past meeting dates.
    const hasMeetingLanguage = /\b(city council|board of|commission|planning|school board|public meeting|town council)\b/.test(text);
    const hasVideoLanguage = /\b(video|watch|recording|stream|webcast|broadcast|cctv)\b/.test(text);
    const hasArchiveLanguage = /\b(archive|past|previous|history|all meetings|recordings library)\b/.test(text);

    // Count plausible meeting-date references — multiple distinct dates is the
    // best signal that this is an index, not a single meeting page.
    const datePattern = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*20\d\d)?\b|\b\d{1,2}\/\d{1,2}\/20\d\d\b/g;
    const dateMatches = (text.match(datePattern) || []).length;

    // Count video-like links/player references.
    const videoTokenCount = (html.match(/\.(mp4|m3u8|webm)|youtube\.com\/watch|granicus\.com\/MediaPlayer|telvue|player\.html/gi) || []).length;

    let confidence = 0;
    const hints = [];
    if (hasMeetingLanguage) { confidence += 0.15; hints.push('meeting language'); }
    if (hasVideoLanguage) { confidence += 0.15; hints.push('video language'); }
    if (hasArchiveLanguage) { confidence += 0.20; hints.push('archive language'); }
    if (dateMatches >= 5) { confidence += 0.30; hints.push(`${dateMatches} dates`); }
    else if (dateMatches >= 2) { confidence += 0.15; hints.push(`${dateMatches} dates`); }
    if (videoTokenCount >= 5) { confidence += 0.30; hints.push(`${videoTokenCount} video refs`); }
    else if (videoTokenCount >= 2) { confidence += 0.15; hints.push(`${videoTokenCount} video refs`); }

    confidence = Math.min(confidence, 0.95);

    return {
      matches: confidence >= MIN_CONFIDENCE,
      confidence,
      hint: hints.join(', ') || 'no signals',
    };
  } catch (err) {
    return { matches: false, confidence: 0, hint: `fetch error: ${err.message}` };
  }
}

async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(GET_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('pdf') || ct.includes('image/')) return null;
    const html = await resp.text();

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const links = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      try {
        const href = new URL(m[1], url).toString();
        const linkText = m[2].replace(/<[^>]+>/g, '').trim();
        links.push(linkText ? `${linkText} → ${href}` : href);
      } catch { /* skip malformed href */ }
    }
    return { text, links };
  } catch {
    return null;
  }
}

function ensureProtocol(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return 'https://' + url;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.sort();
    return u.toString().replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
