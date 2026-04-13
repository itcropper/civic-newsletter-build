/**
 * Agent 3 — Transcription & Extraction
 * Model: Claude Sonnet (for coherence check) + AssemblyAI (for video/audio)
 *
 * Routes by content type:
 * - Video pages → find video URL → AssemblyAI transcription (with speaker diarization)
 * - PDFs → pdfjs-dist text extraction
 * - HTML → fetch + Claude cleaning
 *
 * AssemblyAI handles long files natively (no chunking needed), provides
 * speaker labels, and has good accuracy on proper nouns — ideal for
 * government meeting transcription.
 */

import supabase from '../config/db.js';
import { callClaude, callClaudeJSON, MODELS } from '../config/anthropic.js';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

const COHERENCE_SYSTEM = `You are a government document validator. Determine if the provided text reads as a government meeting transcript or minutes.

Return exactly:
{
  "is_coherent": true/false,
  "governing_body": "name or null",
  "meeting_date": "YYYY-MM-DD or null",
  "named_officials": ["name1", "name2"],
  "reason": "brief explanation"
}`;

const EXTRACTION_SYSTEM = `You are a text extraction specialist. Clean and normalize the following government meeting content. Remove navigation, headers, footers, and repeated boilerplate. Preserve the meeting substance including motions, votes, discussion topics, and speaker attributions. Return only the cleaned text.`;

const VIDEO_URL_SYSTEM = `You are analyzing a web page that contains (or links to) a government meeting video recording. Extract the direct video/audio URL if possible.

Look for:
- HTML5 <video> or <audio> tags with src attributes
- JavaScript variables containing stream URLs (.m3u8, .mp4, .mp3, .webm)
- iframe embeds pointing to video platforms (YouTube, telvue, Granicus, Vimeo)
- Open Graph or meta tags with video URLs
- Direct download links

Return exactly:
{
  "video_urls": ["url1", "url2"],
  "platform": "youtube|telvue|granicus|vimeo|html5|unknown",
  "embed_url": "iframe src or null",
  "page_title": "title of the video/meeting",
  "reason": "what you found"
}

If you can't find a direct video URL, return video_urls as empty array.`;

/**
 * Run transcription/extraction for all queued/ingestion_passed meetings in a city.
 */
export async function runTranscription(cityId) {
  const results = { processed: 0, skipped: 0, errors: [] };

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('city_id', cityId)
    .in('status', ['queued', 'ingestion_passed'])
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch meetings: ${error.message}`);
  if (!meetings || meetings.length === 0) return results;

  for (const meeting of meetings) {
    try {
      const url = meeting.source_url || meeting.url;
      const contentType = await detectContentType(url);

      console.log(`[Transcription] Processing ${meeting.id}: ${url} (${contentType})`);

      let transcriptText = '';

      switch (contentType) {
        case 'video':
          transcriptText = await transcribeVideo(url);
          break;
        case 'pdf':
          transcriptText = await extractPdf(url);
          break;
        case 'html':
        default:
          transcriptText = await extractHtml(url);
          // If HTML content is thin, check if it's a video page
          if (transcriptText.split(/\s+/).length < 200) {
            console.log(`[Transcription] HTML content thin (${transcriptText.split(/\s+/).length} words), checking for video...`);
            const videoTranscript = await transcribeVideo(url);
            if (videoTranscript && videoTranscript.split(/\s+/).length > transcriptText.split(/\s+/).length) {
              transcriptText = videoTranscript;
            }
          }
          break;
      }

      if (!transcriptText || transcriptText.split(/\s+/).length < 100) {
        results.skipped++;
        await logSkip(cityId, meeting.id, 'transcription',
          `Content too short (${transcriptText?.split(/\s+/).length || 0} words)`);
        await supabase.from('meetings').update({ status: 'skipped' }).eq('id', meeting.id);
        continue;
      }

      // Clean the text via Claude (skip for AssemblyAI output which is already clean)
      let cleanedText = transcriptText;
      if (contentType !== 'video') {
        cleanedText = await callClaude(
          MODELS.SONNET,
          EXTRACTION_SYSTEM,
          transcriptText.substring(0, 50000),
          { maxTokens: 8192 }
        );
      }

      // Coherence check
      const coherence = await callClaudeJSON(
        MODELS.SONNET,
        COHERENCE_SYSTEM,
        cleanedText.substring(0, 5000),
        { maxTokens: 500 }
      );

      if (!coherence.is_coherent) {
        results.skipped++;
        await logSkip(cityId, meeting.id, 'transcription',
          `Failed coherence check: ${coherence.reason}`);
        await supabase.from('meetings').update({ status: 'skipped' }).eq('id', meeting.id);
        continue;
      }

      // Store transcript and update status
      await supabase.from('meetings').update({
        transcript_text: cleanedText,
        meeting_date: coherence.meeting_date || meeting.meeting_date,
        status: 'processed',
      }).eq('id', meeting.id);

      results.processed++;
      console.log(`[Transcription] Meeting ${meeting.id}: ${cleanedText.split(/\s+/).length} words, date=${coherence.meeting_date}`);

    } catch (err) {
      results.errors.push(`Meeting ${meeting.id}: ${err.message}`);
      console.error(`[Transcription] Error processing ${meeting.id}:`, err.message);
    }
  }

  console.log(`[Transcription] Processed: ${results.processed}, Skipped: ${results.skipped}`);
  return results;
}

// =============================================
// AssemblyAI Transcription
// =============================================

/**
 * Transcribe a video meeting via AssemblyAI.
 *
 * Steps:
 * 1. Fetch the page to find the video/audio URL
 * 2. Submit URL to AssemblyAI (it downloads and processes directly)
 * 3. Poll until complete
 * 4. Return transcript with speaker labels
 */
async function transcribeVideo(pageUrl) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.warn('[Transcription] ASSEMBLYAI_API_KEY not set — cannot transcribe video');
    return '';
  }

  try {
    // Step 1: Find the video/audio URL on the page
    const videoUrl = await findVideoUrl(pageUrl);
    if (!videoUrl) {
      console.log(`[Transcription] No video URL found on ${pageUrl}`);
      return '';
    }

    console.log(`[Transcription] Found video URL: ${videoUrl}`);

    // Step 2: Submit to AssemblyAI
    const transcriptId = await submitToAssemblyAI(videoUrl, apiKey);
    console.log(`[Transcription] AssemblyAI job submitted: ${transcriptId}`);

    // Step 3: Poll until complete
    const result = await pollAssemblyAI(transcriptId, apiKey);

    if (result.status === 'error') {
      console.error(`[Transcription] AssemblyAI error: ${result.error}`);
      return '';
    }

    // Step 4: Format transcript with speaker labels
    return formatAssemblyAITranscript(result);

  } catch (err) {
    console.error(`[Transcription] Video transcription failed for ${pageUrl}:`, err.message);
    return '';
  }
}

/**
 * Submit a video/audio URL to AssemblyAI for transcription.
 * Returns the transcript ID for polling.
 */
async function submitToAssemblyAI(audioUrl, apiKey) {
  const resp = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,         // Enable speaker diarization
      language_code: 'en',
      punctuate: true,
      format_text: true,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AssemblyAI submit error: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data.id;
}

/**
 * Poll AssemblyAI until transcription is complete.
 * Government meetings can be 2-3+ hours, so we allow up to 30 minutes of polling.
 */
async function pollAssemblyAI(transcriptId, apiKey) {
  const maxWaitMs = 30 * 60 * 1000; // 30 minutes
  const pollIntervalMs = 10000;      // 10 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const resp = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
      headers: { 'Authorization': apiKey },
    });

    if (!resp.ok) {
      throw new Error(`AssemblyAI poll error: ${resp.status}`);
    }

    const data = await resp.json();

    if (data.status === 'completed') {
      return data;
    }

    if (data.status === 'error') {
      return data;
    }

    // Still processing — wait and retry
    console.log(`[Transcription] AssemblyAI status: ${data.status} (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error('AssemblyAI transcription timed out after 30 minutes');
}

/**
 * Format AssemblyAI transcript result with speaker labels and timestamps.
 *
 * Output format:
 * [0:00:15] Speaker A: The meeting will come to order...
 * [0:01:30] Speaker B: Thank you, Mayor...
 */
function formatAssemblyAITranscript(result) {
  // If we have utterances (speaker-labeled segments), use those
  if (result.utterances && result.utterances.length > 0) {
    return result.utterances.map(u => {
      const timestamp = formatTimestamp(u.start / 1000); // ms to seconds
      return `[${timestamp}] Speaker ${u.speaker}: ${u.text}`;
    }).join('\n\n');
  }

  // Fallback: use the raw text (no speaker labels)
  if (result.text) {
    return result.text;
  }

  return '';
}

// =============================================
// Video URL Extraction
// =============================================

/**
 * Find the direct video/audio URL on a page using Claude analysis.
 */
async function findVideoUrl(pageUrl) {
  try {
    const resp = await fetch(pageUrl, {
      headers: { 'User-Agent': 'CivicNewsletterBot/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // First try: look for common video patterns directly in the HTML
    const directUrl = extractVideoUrlFromHtml(html, pageUrl);
    if (directUrl) return directUrl;

    // Second try: ask Claude to analyze the page
    const analysis = await callClaudeJSON(
      MODELS.SONNET,
      VIDEO_URL_SYSTEM,
      `PAGE URL: ${pageUrl}\n\nHTML (first 15000 chars):\n${html.substring(0, 15000)}`,
      { maxTokens: 512 }
    );

    if (analysis.video_urls && analysis.video_urls.length > 0) {
      // Prefer mp4/mp3/webm over m3u8 (AssemblyAI handles most formats)
      const preferred = analysis.video_urls.find(u =>
        u.match(/\.(mp4|mp3|webm|ogg|wav)(\?|$)/i)
      );
      return preferred || analysis.video_urls[0];
    }

    // Third try: if there's an embed URL, fetch that page too
    if (analysis.embed_url) {
      const embedResp = await fetch(analysis.embed_url, {
        headers: { 'User-Agent': 'CivicNewsletterBot/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (embedResp.ok) {
        const embedHtml = await embedResp.text();
        return extractVideoUrlFromHtml(embedHtml, analysis.embed_url);
      }
    }

    return null;
  } catch (err) {
    console.error(`[Transcription] Failed to find video URL on ${pageUrl}:`, err.message);
    return null;
  }
}

/**
 * Extract video URL directly from HTML using regex patterns.
 */
function extractVideoUrlFromHtml(html, baseUrl) {
  // Pattern 1: <video> or <source> tags
  const videoSrcMatch = html.match(/<(?:video|source)[^>]+src=["']([^"']+\.(?:mp4|webm|ogg)(?:\?[^"']*)?)["']/i);
  if (videoSrcMatch) {
    try { return new URL(videoSrcMatch[1], baseUrl).toString(); } catch {}
  }

  // Pattern 2: Direct mp4/mp3 links
  const directMatch = html.match(/["'](https?:\/\/[^"']+\.(?:mp4|mp3|webm)(?:\?[^"']*)?)["']/i);
  if (directMatch) return directMatch[1];

  // Pattern 3: m3u8 streams (HLS) — AssemblyAI can handle these
  const hlsMatch = html.match(/["'](https?:\/\/[^"']+\.m3u8(?:\?[^"']*)?)["']/i);
  if (hlsMatch) return hlsMatch[1];

  // Pattern 4: telvue/Granicus specific patterns
  const telvueMatch = html.match(/["'](https?:\/\/[^"']*telvue[^"']*\.mp4[^"']*)["']/i);
  if (telvueMatch) return telvueMatch[1];

  return null;
}

// =============================================
// HTML & PDF Extraction
// =============================================

/**
 * Extract text from HTML page using fetch.
 */
async function extractHtml(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CivicNewsletterBot/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err) {
    console.error(`[Transcription] HTML extraction failed for ${url}:`, err.message);
    return '';
  }
}

/**
 * Extract text from a PDF URL.
 */
async function extractPdf(url) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjsLib.getDocument(url).promise;
    let fullText = '';

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
    }

    return fullText;
  } catch (err) {
    console.error(`[Transcription] PDF extraction failed for ${url}:`, err.message);
    return '';
  }
}

// =============================================
// Content Type Detection
// =============================================

/**
 * Detect content type from URL and HTTP headers.
 */
async function detectContentType(url) {
  const lower = url.toLowerCase();

  // URL-based detection
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'video';
  if (lower.includes('vimeo.com')) return 'video';
  if (lower.includes('telvue.com')) return 'video';
  if (lower.includes('granicus.com') && lower.includes('player')) return 'video';
  if (lower.match(/\.(mp4|mp3|webm|m3u8)(\?|$)/)) return 'video';

  // HEAD request for content-type header
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'CivicNewsletterBot/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('pdf')) return 'pdf';
    if (ct.includes('video') || ct.includes('audio')) return 'video';
  } catch {}

  return 'html';
}

// =============================================
// Utilities
// =============================================

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function logSkip(cityId, meetingId, agent, reason) {
  await supabase.from('qc_log').insert({
    city_id: cityId,
    meeting_id: meetingId,
    flagging_agent: agent,
    reason,
  });
}
