/**
 * Agent 4 — Summarizer
 * Model: Claude Sonnet
 *
 * Reads style_config, summarizes each processed meeting into 2-5 stories.
 * Assigns category, impact score, extracts votes. Inserts stories with qc_status = pending.
 */

import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';
import { getStyleConfig, buildStylePromptBlock } from '../utils/style-config.js';

const SUMMARIZER_SYSTEM = `You are a civic journalist AI writing for a local newsletter. Your goal is to produce stories that read like professional local journalism — not bureaucratic summaries. Readers want to know WHO made decisions, WHAT was decided, and WHAT it means for them.

For each meeting transcript provided, identify 2–5 key topics or decisions. For each topic:

1. Write a 80–150 word story in plain readable prose. This story MUST:
   - Name specific people (council members, commissioners, directors, department heads) whenever they are mentioned or took a vote — do not anonymize them as "officials" or "the committee"
   - Include exact dollar amounts, vote tallies (e.g., "passed 6-1"), and relevant dates
   - State clearly what was decided and what happens next (implementation timeline, next vote, public comment period, etc.)
   - Reference the source document type (e.g., "according to the meeting agenda", "per the budget proposal submitted by...")
   - Be written for a general resident audience — avoid jargon without explanation

2. Write a 1–2 sentence "context_note" that adds meaningful background NOT in the transcript itself. This can include:
   - How this item fits into a broader city initiative or ongoing issue
   - Historical precedent (e.g., "this is the third time in two years the council has revisited this property")
   - What residents should watch for at upcoming meetings
   - NOTE: Do NOT editorialize, express opinion, or use loaded language. Context notes must be factual observations, not judgments. If you cannot write a genuinely useful context note from the transcript alone, write "" (empty string) and the enrichment agent will attempt to research it separately.

3. Assign exactly one category: Budget / Safety / Schools / Roads / Zoning / Parks / Utilities / Other

4. Assign an impact level:
   - High: dollar amounts >$100K, direct vote on policy, affects schools or safety
   - Medium: procedural votes, budget discussions, planning approvals
   - Low: routine scheduling, minor administrative items

5. Extract all votes into an array: [{"motion": "...", "result": "passed/failed", "vote_count": "5-2", "names_for": ["..."], "names_against": ["..."]}]
   - Include individual vote breakdowns by name if available in the transcript

HEADLINE RULES (strict):
- 6 to 10 words. No trailing punctuation.
- Lead with the decision, vote, action window, or material change — never with "Meeting is", "Committee will", "Council to discuss", or any phrasing that signals procedure rather than news.
- Use active voice, present or past tense. Include the specific subject (council body, named person, dollar amount, location) when it fits.
- If nothing decided and no action window exists, you should not be writing a story at all — return fewer stories rather than padding with non-news.

Good headlines:
  - "Council awards $4.2M Avondale water-main contract"
  - "Vote splits 4-3 against new short-term-rental fee"
  - "Public hearing Monday on Five Points rezoning"

Bad headlines (do not produce):
  - "Council holds meeting to discuss water issue"
  - "Budget and Finance Committee schedules April meeting"
  - "Officials gather to review department updates"

Return JSON array:
[
  {
    "headline": "6-10 word news headline following the rules above",
    "summary": "80-150 word story with names, amounts, and specifics",
    "context_note": "1-2 sentence factual background note, or empty string",
    "category": "Budget|Safety|Schools|Roads|Zoning|Parks|Utilities|Other",
    "impact": "High|Medium|Low",
    "votes": [{"motion": "...", "result": "...", "vote_count": "...", "names_for": [], "names_against": []}]
  }
]

CRITICAL: Every factual claim in your summary must come directly from the transcript. Do not fabricate names, dollar amounts, or vote counts. You MAY note when key information (like a vote breakdown or meeting outcome) was not present in the available transcript excerpt.`;

/**
 * Run summarizer for all processed meetings in a city.
 */
export async function runSummarizer(cityId) {
  const results = { storiesCreated: 0, errors: [] };

  // Get style config
  const styleConfig = await getStyleConfig(cityId);
  const styleBlock = buildStylePromptBlock(styleConfig);
  const fullSystem = SUMMARIZER_SYSTEM + '\n\n' + styleBlock;

  // Fetch processed meetings that haven't been summarized yet
  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('city_id', cityId)
    .in('status', ['source_verified', 'source_flagged'])
    .not('transcript_text', 'is', null);

  if (error) throw new Error(`Failed to fetch meetings: ${error.message}`);
  if (!meetings || meetings.length === 0) return results;

  for (const meeting of meetings) {
    try {
      // Check if stories already exist for this meeting
      const { data: existingStories } = await supabase
        .from('stories')
        .select('id')
        .eq('meeting_id', meeting.id)
        .limit(1);

      if (existingStories && existingStories.length > 0) continue;

      const userMsg = `Meeting type: ${meeting.meeting_type}
Meeting date: ${meeting.meeting_date}
Source: ${meeting.source_url}

Transcript:
${meeting.transcript_text.substring(0, 30000)}`;

      const stories = await callClaudeJSON(MODELS.SONNET, fullSystem, userMsg, { maxTokens: 4096 });

      if (!Array.isArray(stories) || stories.length === 0) {
        results.errors.push(`Meeting ${meeting.id}: no stories extracted`);
        continue;
      }

      // Insert stories
      const storyRows = stories.map(s => ({
        meeting_id: meeting.id,
        city_id: cityId,
        headline: s.headline ? String(s.headline).trim() : null,
        summary_text: s.summary,
        context_note: s.context_note || null,
        category: s.category,
        impact_score: s.impact,
        votes_json: s.votes || [],
        qc_status: 'pending',
        qc_revision_count: 0,
      }));

      const { error: insertErr } = await supabase.from('stories').insert(storyRows);
      if (insertErr) {
        results.errors.push(`Meeting ${meeting.id} insert: ${insertErr.message}`);
      } else {
        results.storiesCreated += storyRows.length;
      }

    } catch (err) {
      results.errors.push(`Meeting ${meeting.id}: ${err.message}`);
    }
  }

  console.log(`[Summarizer] Created ${results.storiesCreated} stories`);
  return results;
}

/**
 * Re-summarize a specific story with revision notes (called by Verdict agent).
 */
export async function reviseSummary(storyId, revisionNotes, cityId) {
  const { data: story } = await supabase
    .from('stories')
    .select('*, meetings(*)')
    .eq('id', storyId)
    .single();

  if (!story) throw new Error(`Story not found: ${storyId}`);

  const styleConfig = await getStyleConfig(cityId);
  const styleBlock = buildStylePromptBlock(styleConfig);

  const revisionSystem = SUMMARIZER_SYSTEM + '\n\n' + styleBlock + `

REVISION REQUESTED. The previous summary had these issues:
${revisionNotes}

Rewrite the summary addressing all issues while maintaining factual accuracy.`;

  const userMsg = `Original summary: ${story.summary_text}

Original transcript excerpt:
${story.meetings?.transcript_text?.substring(0, 20000) || 'Transcript unavailable'}`;

  const revised = await callClaudeJSON(MODELS.SONNET, revisionSystem, userMsg, { maxTokens: 1024 });

  if (Array.isArray(revised) && revised.length > 0) {
    await supabase.from('stories').update({
      summary_text: revised[0].summary,
      qc_status: 'pending',
      qc_revision_count: story.qc_revision_count + 1,
    }).eq('id', storyId);
  }

  return revised;
}
