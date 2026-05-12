/**
 * Agent 4b — Context Enricher
 * Model: Claude Sonnet
 *
 * Runs AFTER the summarizer (Agent 4). For each pending story that has an
 * empty or thin context_note, this agent searches for local news, polls,
 * or publicly available context about the topic — then appends a brief,
 * balanced "Context" note to the story summary.
 *
 * Philosophy:
 *   - The context note should INFORM the reader, not editorialize.
 *   - If local coverage was polarized (e.g., a poll showed 60% opposition),
 *     that is a relevant FACT and should be noted neutrally.
 *   - The enricher does NOT override the meeting transcript — it adds
 *     background that a good journalist would include when covering a story.
 *   - If no reliable external context can be found, the story runs as-is.
 *
 * What this agent looks for:
 *   - Local news coverage of the same topic
 *   - Public opinion data (polls, petition signatures, public comment counts)
 *   - Prior council/board history on the same issue
 *   - State or federal policy context that explains why a local item matters
 *   - Ongoing controversies or organized community responses
 *
 * What this agent avoids:
 *   - Adopting the framing or language of partisan sources
 *   - Including unverified social media claims
 *   - Making value judgments ("good", "bad", "controversial", "problematic")
 *   - Adding context from sources published more than 6 months prior
 */

import supabase from '../config/db.js';
import { callClaudeText, MODELS } from '../config/anthropic.js';

const ENRICHER_SYSTEM = `You are a research assistant for a civic journalism newsletter. Your job is to find reliable public-interest context that a local journalist would want to include when covering a city government story.

You will be given:
1. A city name
2. A story summary from a city meeting transcript
3. Web search results about the topic (or a note that no results were found)

Your task: Write a single context note of 1–3 sentences that adds genuine value to the story. This note will appear as a "Context" section at the end of the newsletter story.

Rules:
- Use NEUTRAL, factual language. Describe what happened or what exists — do not characterize it as good, bad, controversial, or alarming.
- If a source (e.g., local news, a poll, public records) shows strong community sentiment, you may report the FACT of that sentiment (e.g., "A 2026 city survey found 58% of respondents opposed to increased density in the historic district") — but do not adopt or amplify the sentiment itself.
- You may note that previous council votes, public hearings, or prior coverage exist — this helps readers understand where a topic stands in a longer arc.
- Prefer facts from government sources, established local/regional news outlets, or verifiable public records.
- If the web results are empty, irrelevant, or purely opinion-based without factual substance, return exactly: NO_CONTEXT
- Do not speculate. Do not include anything you cannot trace to the provided search results.
- Do not duplicate information already in the story summary.
- Keep the note under 60 words.

Return ONLY the context note text, or NO_CONTEXT. No labels, no JSON, no explanation.`;

/**
 * Generate a web search query for a given story.
 */
function buildSearchQuery(cityName, storyHeadline, storySummary) {
  // Extract key noun phrases from the headline for a focused query
  // In production this could use a more sophisticated NLP approach
  const cleanHeadline = storyHeadline
    .replace(/[^a-zA-Z0-9\s$]/g, '')
    .trim();
  return `${cityName} ${cleanHeadline} local news 2025 2026`;
}

/**
 * Perform a web search via Brave Search API (or fall back gracefully).
 * Returns array of { title, snippet, url } or empty array.
 */
async function webSearch(query, apiKey) {
  if (!apiKey) return [];
  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    url.searchParams.set('freshness', 'py'); // Past year

    const resp = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return [];
    const data = await resp.json();

    return (data.web?.results || []).map(r => ({
      title: r.title,
      snippet: r.description || '',
      url: r.url,
    }));
  } catch (err) {
    console.warn(`[ContextEnricher] Web search failed: ${err.message}`);
    return [];
  }
}

/**
 * Format search results into a readable block for the Claude prompt.
 */
function formatSearchResults(results) {
  if (!results || results.length === 0) {
    return 'No web search results found.';
  }
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.url}`
  ).join('\n\n');
}

/**
 * Run context enrichment for all pending stories in a city.
 *
 * @param {string} cityId - UUID of the city
 * @param {object} options
 * @param {string} [options.braveApiKey] - Brave Search API key for web lookups
 * @returns {{ enriched: number, skipped: number, errors: string[] }}
 */
export async function runContextEnricher(cityId, { braveApiKey } = {}) {
  const results = { enriched: 0, skipped: 0, errors: [] };

  // Fetch city name
  const { data: city } = await supabase
    .from('cities')
    .select('name')
    .eq('id', cityId)
    .single();

  if (!city) return results;

  // Fetch pending stories that don't yet have enriched context
  // We identify "needs enrichment" as: context_note is null or empty string
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, summary_text, category, impact_score, context_note, meetings(meeting_date, meeting_type)')
    .eq('city_id', cityId)
    .eq('qc_status', 'pending')
    .or('context_note.is.null,context_note.eq.');

  if (error) {
    results.errors.push(`Fetch failed: ${error.message}`);
    return results;
  }

  if (!stories || stories.length === 0) return results;

  for (const story of stories) {
    try {
      // Extract headline from summary (first sentence or first 12 words)
      const firstSentence = story.summary_text?.split(/[.!?]/)[0] || story.summary_text || '';
      const headline = firstSentence.split(' ').slice(0, 12).join(' ');

      // Build search query
      const query = buildSearchQuery(city.name, headline, story.summary_text);

      // Perform web search
      const searchResults = await webSearch(query, braveApiKey);

      // Ask Claude to synthesize context
      const userMsg = `City: ${city.name}

Story summary (from city meeting transcript):
${story.summary_text}

Web search query used: "${query}"

Search results:
${formatSearchResults(searchResults)}`;

      const contextNote = await callClaudeText(
        MODELS.SONNET,
        ENRICHER_SYSTEM,
        userMsg,
        { maxTokens: 256 }
      );

      if (!contextNote || contextNote.trim() === 'NO_CONTEXT') {
        results.skipped++;
        continue;
      }

      // Update the story with the enriched context note
      const { error: updateErr } = await supabase
        .from('stories')
        .update({ context_note: contextNote.trim() })
        .eq('id', story.id);

      if (updateErr) {
        results.errors.push(`Update story ${story.id}: ${updateErr.message}`);
      } else {
        results.enriched++;
        console.log(`[ContextEnricher] Enriched story ${story.id}: "${headline.substring(0, 50)}..."`);
      }

    } catch (err) {
      results.errors.push(`Story ${story.id}: ${err.message}`);
    }
  }

  console.log(`[ContextEnricher] ${city.name}: enriched ${results.enriched}, skipped (no context) ${results.skipped}`);
  return results;
}
