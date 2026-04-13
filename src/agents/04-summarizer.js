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

const SUMMARIZER_SYSTEM = `You are a civic journalist AI. You produce clear, factual summaries of government meeting proceedings for a local newsletter audience.

For each meeting transcript provided, identify 2–5 key topics or decisions. For each topic:
1. Write a 40–80 word summary in plain neutral prose
2. Assign exactly one category: Budget / Safety / Schools / Roads / Zoning / Parks / Utilities / Other
3. Assign an impact level:
   - High: dollar amounts >$100K, direct vote on policy, affects schools or safety
   - Medium: procedural votes, budget discussions, planning approvals
   - Low: routine scheduling, minor administrative items
4. Extract all votes into an array: [{"motion": "...", "result": "passed/failed", "vote_count": "5-2"}]

Return JSON array:
[
  {
    "headline": "short headline",
    "summary": "40-80 word summary",
    "category": "Budget|Safety|Schools|Roads|Zoning|Parks|Utilities|Other",
    "impact": "High|Medium|Low",
    "votes": [{"motion": "...", "result": "...", "vote_count": "..."}]
  }
]

CRITICAL: Every claim in your summary must come directly from the transcript. Do not infer, speculate, or embellish.`;

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
        summary_text: s.summary,
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
