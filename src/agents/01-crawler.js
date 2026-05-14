/**
 * Agent 1 — Civic Content Crawler
 * Model: Claude Sonnet
 *
 * Walks per-city seed pages and finds public-meeting content (videos,
 * minutes, agendas), inserting deduped rows into `meetings`.
 *
 * Source priority (highest first):
 *   1. `cities.video_archive_urls` (priority 0). Populated by Agent 1a
 *      (video-archive-discoverer) or by an operator. These are the pages
 *      that LIST the city's collection of recorded meeting videos.
 *      Crawler follows EVERY in-date meeting link found on these pages,
 *      not just a top-N slice, because the whole point is to backfill
 *      transcribable video coverage.
 *   2. `cities.archive_urls` (priority 1). Operator-curated agenda /
 *      minutes index pages. Crawler walks these + one level outward
 *      with the usual top-5 cap.
 *   3. Legacy autonomous mode (no archive_urls + no video_archive_urls):
 *      starts from seed_url and uses Claude-guided navigation. Unpredictable.
 *      Add archive_urls during onboarding and run Agent 1a to populate
 *      video_archive_urls.
 *
 * Date window: 7 days back from "today" (also applied to first crawls of
 * new cities, per MVP scope). Override later if backfill cost is fine.
 *
 * Onboarding a new city:
 *   1. Insert cities row with name, subdomain, seed_url.
 *   2. Optionally seed archive_urls with agenda/minutes URLs.
 *   3. Run the pipeline. Agent 1a auto-discovers video_archive_urls
 *      (3 attempts: pattern → path → LLM). If all 3 fail it flags
 *      manual_needed and the observer report surfaces the city.
 *   4. Operator can drop URLs into video_archive_urls at any time to
 *      override; status flips to manual_set and discovery stops.
 */

import crypto from 'crypto';
import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';

const MAX_STEPS = 30;       // Max pages to visit per crawl run
const MIN_DELAY_MS = 1500;  // Politeness delay
const MAX_MEETINGS = 30;    // Max meetings to collect per run

// Known civic portal domains — links to these get auto-promoted to priority 1
const CIVIC_PORTAL_PATTERNS = [
  'civicclerk.com', 'granicus.com', 'legistar.com', 'boarddocs.com',
  'primegov.com', 'novusagenda.com', 'civicplus.com', 'municode.com',
  'iqm2.com',       // iQ Module 2 — Redding CA and many others
];

// Video platforms — recognized by the LLM but also auto-detected for priority boost
const VIDEO_PLATFORM_PATTERNS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'telvue.com',
  'panopto.com', 'facebook.com/*/videos',
];

/**
 * Build the navigator system prompt dynamically.
 * Includes city name and date range so the LLM can prioritize recent content.
 */
function buildNavigatorSystem(cityName, dateRange) {
  const dateClause = dateRange
    ? `\n\nDATE RANGE: Only collect meetings dated between ${dateRange.start} and ${dateRange.end}. Ignore meetings outside this window.`
    : '';

  return `You are an AI web navigator specializing in finding ALL types of government meeting content for ${cityName || 'a city'}. You are given a web page's text content and its links.${dateClause}

YOUR GOALS — find content for ALL of these meeting types:
- City Council / Town Council / Board of Aldermen meetings
- Planning Commission / Zoning Board meetings
- Parks & Recreation Commission meetings
- School Board / Board of Education meetings
- Budget Committee / Finance Committee meetings
- Public Hearings (land use, zoning, permits, etc.)
- Emergency meetings and special sessions
- Housing Authority / Urban Renewal meetings
- Transportation / Public Works committee meetings
- Any other public body holding open meetings

Content types to collect:
- Meeting video recordings (YouTube, telvue, Granicus, Vimeo, etc.)
- Meeting minutes (PDFs or HTML)
- Meeting agendas with substantial content
- Meeting transcripts

CRITICAL — CIVIC PORTAL PRIORITY:
Many cities host their meeting agendas, minutes, and recordings on EXTERNAL civic platforms. These portals are your HIGHEST PRIORITY links to follow:
- **CivicClerk** (*.civicclerk.com) — agenda packets, minutes, video links
- **Granicus / Legistar** (*.granicus.com, *.legistar.com) — legislative management
- **CivicEngage / CivicPlus** — municipal CMS with meeting sections
- **Boarddocs** (*.boarddocs.com) — school board agendas/minutes
- **PrimeGov** (*.primegov.com) — agenda management
- **Novus Agenda** (*.novusagenda.com) — meeting agenda system
- **iQM2** (*.iqm2.com) — agenda/meeting management portal

VIDEO PLATFORMS — also follow links to these for meeting recordings:
- YouTube, Vimeo, telvue.com, Panopto (*.panopto.com), Facebook Videos, Granicus video pages

When you see a link to any of these platforms, it MUST be in your links_to_follow with priority 1. These portals typically have the most complete and current meeting content.

Analyze the page and return JSON:
{
  "page_type": "meeting_list|meeting_detail|video_page|minutes_page|agenda_page|civic_portal|navigation|irrelevant",
  "meetings_found": [
    {
      "title": "descriptive title of the meeting",
      "meeting_type": "city_council|planning|parks_rec|school_board|budget|public_hearing|housing|transportation|emergency|other",
      "date": "YYYY-MM-DD or null if unknown",
      "content_type": "video|minutes_pdf|minutes_html|agenda|transcript",
      "url": "direct URL to the content (video page, PDF link, etc.)",
      "confidence": 0.0-1.0
    }
  ],
  "links_to_follow": [
    {
      "url": "the URL to visit next",
      "reason": "brief reason this link likely leads to meeting content",
      "priority": 1-5
    }
  ],
  "reasoning": "brief explanation of what you see on this page and your navigation strategy"
}

RULES:
- Only include meetings_found entries for actual meeting content (recordings, minutes, agendas), not index/listing pages.
- HIGHEST PRIORITY (priority 1): Links to civic portals (CivicClerk, Granicus, Legistar, Boarddocs, PrimeGov, etc.) — these are almost always the best source of current meeting content.
- HIGH PRIORITY (priority 2): Links containing "minutes", "agendas", "recordings", "video", "watch", "archive", or any meeting body name (council, commission, board, committee).
- ALWAYS follow links to external domains if they lead to civic platforms or meeting content. Cities routinely host content on separate domains — this is expected and correct.
- Do NOT follow links to social media profiles, news articles, job postings, or unrelated pages.
- Limit links_to_follow to the 7 most promising links, ranked by priority (1 = highest).
- For video content, prefer the direct video page URL, not an embed or API URL.
- If you see a list of meetings with dates, follow links to meetings within the date range.
- If a page has both agenda PDFs and video recordings, capture both.
- Look for ALL meeting types, not just city council. Follow links to planning, parks, school board, housing, budget, and other public body pages.`;
}

/**
 * Run the crawler for a single city.
 *
 * If city.archive_urls is set, uses those as the starting queue (preferred mode).
 * Otherwise falls back to autonomous AI-guided navigation from seed_url (legacy mode).
 *
 * @param {string} cityId - UUID of the city to crawl
 * @returns {object} - { newMeetings: number, pagesVisited: number, errors: string[], mode: string }
 */
export async function runCrawler(cityId) {
  const { data: city, error: cityErr } = await supabase
    .from('cities')
    .select('id, name, seed_url, archive_urls, video_archive_urls, send_schedule, last_issue_date')
    .eq('id', cityId)
    .single();

  if (cityErr || !city) throw new Error(`City not found: ${cityId}`);

  const dateRange = getDateRange();
  const systemPrompt = buildNavigatorSystem(city.name, dateRange);
  console.log(`[Crawler] ${city.name}: date range ${dateRange.start} to ${dateRange.end}`);

  const results = { newMeetings: 0, pagesVisited: 0, errors: [], mode: 'unknown' };
  const visited = new Set();

  const videoArchiveUrls = Array.isArray(city.video_archive_urls) ? city.video_archive_urls : [];
  const archiveUrls = Array.isArray(city.archive_urls) ? city.archive_urls : [];

  // ─────────────────────────────────────────────────────────────────────────
  // MODE A: archive_urls (and/or video_archive_urls) provided.
  // video_archive_urls are queued at priority 0 (highest) so the crawler
  // always finishes harvesting video pages before falling through to
  // agenda/minutes pages.
  // ─────────────────────────────────────────────────────────────────────────
  if (videoArchiveUrls.length > 0 || archiveUrls.length > 0) {
    results.mode = videoArchiveUrls.length > 0 ? 'archive_with_video' : 'archive_urls';
    console.log(`[Crawler] ${city.name}: archive mode — video_archive_urls=${videoArchiveUrls.length}, archive_urls=${archiveUrls.length}`);

    const queue = [];
    for (const url of videoArchiveUrls) {
      queue.push({
        url: ensureProtocol(url),
        reason: 'video archive index (priority 0)',
        priority: 0,
        isVideoIndex: true,
      });
    }
    for (const url of archiveUrls) {
      queue.push({
        url: ensureProtocol(url),
        reason: 'operator-configured archive URL',
        priority: 1,
        isVideoIndex: false,
      });
    }

    while (queue.length > 0 && results.pagesVisited < MAX_STEPS && results.newMeetings < MAX_MEETINGS) {
      queue.sort((a, b) => a.priority - b.priority);
      const next = queue.shift();
      const normalizedUrl = normalizeUrl(next.url);
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      try {
        await sleep(MIN_DELAY_MS);
        console.log(`[Crawler] Step ${results.pagesVisited + 1}: ${normalizedUrl}`);
        const page = await fetchPage(normalizedUrl);
        if (!page) { console.log(`[Crawler]   -> failed to fetch`); continue; }

        results.pagesVisited++;

        // Auto-detect civic portal + video platform links before Claude analysis
        const civicPortalLinks = extractCivicPortalLinks(page.links);
        for (const portalLink of civicPortalLinks) {
          const portalUrl = normalizeUrl(portalLink.url);
          if (!visited.has(portalUrl)) {
            queue.push({
              url: portalUrl,
              reason: `auto-detected ${portalLink.platform}`,
              priority: portalLink.priority,
            });
          }
        }

        // Ask Claude to analyze the page and find meeting links
        const analysis = await callClaudeJSON(
          MODELS.SONNET,
          systemPrompt,
          `CURRENT URL: ${normalizedUrl}\n\nPAGE TEXT (first 8000 chars):\n${page.text.substring(0, 8000)}\n\nLINKS ON PAGE (first 150):\n${page.links.slice(0, 150).map(l => `- ${l}`).join('\n')}`,
          { maxTokens: 2048 }
        );

        console.log(`[Crawler]   -> ${analysis.page_type}: ${analysis.reasoning?.substring(0, 100)}`);

        // Collect any meetings found directly on this archive page
        if (analysis.meetings_found && analysis.meetings_found.length > 0) {
          for (const meeting of analysis.meetings_found) {
            if (meeting.confidence < 0.6) continue;
            if (dateRange && meeting.date && (meeting.date < dateRange.start || meeting.date > dateRange.end)) continue;
            await upsertMeeting(cityId, meeting, normalizedUrl, results);
          }
        }

        // Link-following policy:
        //   - On a video-index page (isVideoIndex), follow EVERY link to a
        //     plausible meeting-video detail page that the LLM surfaced.
        //     These are the recordings we exist to transcribe — capping at
        //     top-5 would silently drop coverage.
        //   - On a regular operator archive page, keep the top-5 cap to
        //     avoid runaway expansion into navigation/footer links.
        if (analysis.links_to_follow && analysis.links_to_follow.length > 0) {
          const slice = next.isVideoIndex ? analysis.links_to_follow : analysis.links_to_follow.slice(0, 5);
          for (const link of slice) {
            const linkUrl = normalizeUrl(link.url);
            if (visited.has(linkUrl)) continue;
            // Video-index children are still video-shaped — keep the flag.
            const childIsVideoIndex = next.isVideoIndex && looksLikeVideoMeetingLink(link);
            if (next.isVideoIndex || link.priority <= 2) {
              queue.push({
                url: linkUrl,
                reason: link.reason,
                priority: (link.priority || 3) + (next.isVideoIndex ? 0 : 1),
                isVideoIndex: childIsVideoIndex,
              });
            }
          }
        }

      } catch (err) {
        results.errors.push(`Error at ${normalizedUrl}: ${err.message}`);
      }
    }

    console.log(`[Crawler] ${city.name} (archive mode): visited ${results.pagesVisited} pages, found ${results.newMeetings} new meetings`);
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODE B: legacy autonomous navigation (fallback — no archive_urls set)
  // Starts from seed_url and autonomously discovers meeting pages.
  // NOTE: This mode is unpredictable. Add archive_urls during city onboarding.
  // ─────────────────────────────────────────────────────────────────────────
  results.mode = 'legacy_autonomous';
  console.warn(`[Crawler] ${city.name}: LEGACY MODE — no archive_urls configured. Add archive_urls during city onboarding for reliable crawling.`);

  // Start with the seed URL — Claude will figure out where to go from there
  const queue = [{ url: ensureProtocol(city.seed_url), reason: 'seed URL', priority: 1, isVideoIndex: false }];

  // Seed common meeting page patterns as starting points
  const seedOrigin = new URL(ensureProtocol(city.seed_url)).origin;
  const commonPaths = [
    '/agendas-minutes', '/meetings', '/government/agendas-minutes',
    '/city-council/meetings', '/AgendaCenter', '/government/city-council',
    '/government/meetings', '/boards-commissions', '/government/boards-commissions',
    '/planning/meetings', '/school-board', '/parks-recreation',
    '/public-meetings', '/calendar', '/government/calendar',
  ];
  for (const path of commonPaths) {
    queue.push({ url: seedOrigin + path, reason: 'common meeting page path', priority: 3, isVideoIndex: false });
  }

  while (queue.length > 0 && results.pagesVisited < MAX_STEPS && results.newMeetings < MAX_MEETINGS) {
    // Sort by priority (lower = higher priority)
    queue.sort((a, b) => a.priority - b.priority);
    const next = queue.shift();

    const normalizedUrl = normalizeUrl(next.url);
    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);

    try {
      await sleep(MIN_DELAY_MS);

      console.log(`[Crawler] Step ${results.pagesVisited + 1}: ${normalizedUrl} (${next.reason})`);
      const page = await fetchPage(normalizedUrl);
      if (!page) {
        console.log(`[Crawler]   -> failed to fetch`);
        continue;
      }

      results.pagesVisited++;

      // Auto-detect civic portal + video platform links BEFORE Claude analysis (ensures we never miss them)
      const civicPortalLinks = extractCivicPortalLinks(page.links);
      for (const portalLink of civicPortalLinks) {
        const portalUrl = normalizeUrl(portalLink.url);
        if (!visited.has(portalUrl)) {
          queue.push({
            url: portalUrl,
            reason: `auto-detected ${portalLink.platform} (${portalLink.priority === 1 ? 'civic portal' : 'video platform'})`,
            priority: portalLink.priority,
          });
          console.log(`[Crawler]   -> AUTO-QUEUED: ${portalUrl} (${portalLink.platform})`);
        }
      }

      // Ask Claude to analyze the page
      const analysis = await callClaudeJSON(
        MODELS.SONNET,
        systemPrompt,
        `CURRENT URL: ${normalizedUrl}\n\nPAGE TEXT (first 8000 chars):\n${page.text.substring(0, 8000)}\n\nLINKS ON PAGE (first 150):\n${page.links.slice(0, 150).map(l => `- ${l}`).join('\n')}`,
        { maxTokens: 2048 }
      );

      console.log(`[Crawler]   -> ${analysis.page_type}: ${analysis.reasoning?.substring(0, 100)}`);

      // Process any meetings found on this page
      if (analysis.meetings_found && analysis.meetings_found.length > 0) {
        for (const meeting of analysis.meetings_found) {
          if (meeting.confidence < 0.6) continue;
          if (dateRange && meeting.date && (meeting.date < dateRange.start || meeting.date > dateRange.end)) {
            console.log(`[Crawler]   -> SKIPPED (out of date range): ${meeting.title} (${meeting.date})`);
            continue;
          }
          await upsertMeeting(cityId, meeting, normalizedUrl, results);
        }
      }

      // Add recommended links to the queue
      if (analysis.links_to_follow && analysis.links_to_follow.length > 0) {
        for (const link of analysis.links_to_follow) {
          const linkUrl = normalizeUrl(link.url);
          if (!visited.has(linkUrl)) {
            // Boost priority for civic portal links that Claude found
            const isCivicPortal = CIVIC_PORTAL_PATTERNS.some(p => linkUrl.includes(p));
            queue.push({
              url: linkUrl,
              reason: link.reason,
              priority: isCivicPortal ? 1 : (link.priority || 3),
            });
          }
        }
      }

    } catch (err) {
      results.errors.push(`Error at ${normalizedUrl}: ${err.message}`);
    }
  }

  console.log(`[Crawler] ${city.name}: visited ${results.pagesVisited} pages, found ${results.newMeetings} new meetings`);
  return results;
}

/**
 * Insert a meeting into the DB if it doesn't already exist (dedup by URL hash).
 * Shared between archive_urls mode and legacy mode.
 */
async function upsertMeeting(cityId, meeting, pageUrl, results) {
  const meetingUrl = meeting.url || pageUrl;
  const contentHash = crypto.createHash('sha256').update(meetingUrl).digest('hex');

  const { data: existing } = await supabase
    .from('meetings')
    .select('id')
    .eq('content_hash', contentHash)
    .limit(1);

  if (!existing || existing.length === 0) {
    const { error: insertErr } = await supabase.from('meetings').insert({
      city_id: cityId,
      url: meetingUrl,
      content_hash: contentHash,
      source_url: meetingUrl,
      meeting_date: meeting.date || null,
      meeting_type: mapMeetingType(meeting.meeting_type),
      status: 'queued',
    });

    if (insertErr) {
      results.errors.push(`Insert failed for ${meetingUrl}: ${insertErr.message}`);
    } else {
      results.newMeetings++;
      console.log(`[Crawler]   -> NEW MEETING: ${meeting.title} (${meeting.content_type}, ${meeting.date})`);
    }
  }
}

/**
 * Fetch a page and extract text + links. Works across any domain.
 */
async function fetchPage(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CivicNewsletterBot/1.0; +https://civicnewsletter.com/bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') || '';

    // Skip binary content (PDFs are handled separately by transcription agent)
    if (contentType.includes('pdf')) {
      return {
        text: `[PDF document at ${url}]`,
        links: [],
      };
    }

    const html = await resp.text();

    // Extract visible text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract all links with their text
    const links = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const href = new URL(match[1], url).toString();
        const linkText = match[2].replace(/<[^>]+>/g, '').trim();
        if (linkText) {
          links.push(`${linkText} → ${href}`);
        } else {
          links.push(href);
        }
      } catch {}
    }

    return { text, links };
  } catch (err) {
    console.error(`[Crawler] Fetch failed for ${url}:`, err.message);
    return null;
  }
}

function ensureProtocol(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return 'https://' + url;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.sort();
    return u.toString().replace(/\/+$/, '');
  } catch { return url; }
}

function mapMeetingType(type) {
  const map = {
    city_council: 'city_council',
    planning: 'planning',
    parks_rec: 'parks_rec',
    school_board: 'school_board',
    budget: 'budget',
    public_hearing: 'public_hearing',
    housing: 'housing',
    transportation: 'transportation',
    emergency: 'emergency',
  };
  return map[type] || 'other';
}

/**
 * Compute the crawl date range. Fixed at 7 days back for MVP — including
 * first-time crawls of newly-added cities. Increase later if backfill
 * cost is acceptable (AssemblyAI charges per hour of audio).
 *
 * Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }.
 */
function getDateRange() {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  return { start: start.toISOString().split('T')[0], end };
}

/**
 * Heuristic: does this link from a video-index page look like an
 * individual meeting recording (vs. a back-nav, paginator, or footer link)?
 * Used to decide whether children of a video-index page should themselves
 * be queued with isVideoIndex=true so deep links don't trigger the
 * unbounded follow-everything policy when they aren't appropriate.
 */
function looksLikeVideoMeetingLink(link) {
  const url = (link.url || '').toLowerCase();
  const reason = (link.reason || '').toLowerCase();
  // Treat detail pages as "video meeting" only when the URL or reason
  // strongly suggests a single recording, not another index page.
  const detailUrl = /(player|video|watch|meeting|view_id|clip_id|recording|stream|broadcast)/.test(url);
  const detailReason = /(video|recording|watch|player|individual meeting|specific meeting)/.test(reason);
  // Avoid treating obvious pagination as video-index children.
  const isPagination = /[?&](page|p|offset|start)=\d+/.test(url);
  return (detailUrl || detailReason) && !isPagination;
}

/**
 * Check if a URL is a civic portal SUBDOMAIN (not the marketing/main site).
 * e.g., "reddingca.granicus.com" → true, "www.granicus.com" → false
 */
function isCivicSubdomain(url, portalDomain) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Must contain the portal domain
    if (!hostname.endsWith(portalDomain)) return false;
    // Exclude the bare domain and www. prefix (marketing/product sites)
    if (hostname === portalDomain || hostname === 'www.' + portalDomain) return false;
    return true;
  } catch { return false; }
}

/**
 * Scan page links for known civic portal domains (subdomains only)
 * and video platforms. Returns array of { url, platform, priority }.
 * This is a safety net — ensures we ALWAYS follow civic portal links
 * even if Claude's analysis misses them.
 */
function extractCivicPortalLinks(links) {
  const found = [];
  const seen = new Set();

  for (const link of links) {
    // Links are in format "Link Text → URL" or just "URL"
    const urlPart = link.includes('→') ? link.split('→').pop().trim() : link.trim();
    if (seen.has(urlPart)) continue;

    // Check civic portal subdomains (highest priority)
    for (const pattern of CIVIC_PORTAL_PATTERNS) {
      if (urlPart.includes(pattern) && isCivicSubdomain(urlPart, pattern)) {
        seen.add(urlPart);
        found.push({ url: urlPart, platform: pattern.split('.')[0], priority: 1 });
        break;
      }
    }

    // Check video platforms (priority 2) — only direct video links, not marketing
    if (!seen.has(urlPart)) {
      for (const pattern of VIDEO_PLATFORM_PATTERNS) {
        if (urlPart.includes(pattern)) {
          seen.add(urlPart);
          found.push({ url: urlPart, platform: pattern.split('.')[0], priority: 2 });
          break;
        }
      }
    }
  }

  return found;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
