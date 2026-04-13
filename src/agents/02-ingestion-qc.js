/**
 * Agent 2 — Ingestion QC
 * Model: Claude Haiku
 *
 * Scores queued meetings on 3 checks (date, length, content match).
 * Score >= threshold → ingestion_passed. Below → retry once, then skipped.
 */

import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';
import { getOpsConfig } from '../utils/ops-config.js';

const QC_SYSTEM = `You are a government meeting content quality checker. Score the provided content on three criteria and return JSON.

Criteria:
1. date_extractable (30 points): Can you extract a specific meeting date? Is it within the last 60 days?
2. content_length (40 points): Does the content contain at least 500 words of substantive text?
3. content_match (30 points): Does the body text match the expected meeting type (e.g., city council minutes should discuss motions, votes, council members)?

Return exactly:
{
  "date_extractable": { "score": 0-30, "extracted_date": "YYYY-MM-DD or null", "reason": "..." },
  "content_length": { "score": 0-40, "word_count": number, "reason": "..." },
  "content_match": { "score": 0-30, "matches_type": true/false, "reason": "..." },
  "total_score": 0-100
}`;

/**
 * Run ingestion QC for all queued meetings in a city.
 * @param {string} cityId
 * @returns {object} - { passed: number, skipped: number, errors: string[] }
 */
export async function runIngestionQC(cityId) {
  const results = { passed: 0, skipped: 0, errors: [] };

  // Get city reliability for adjusted threshold
  const { data: city } = await supabase
    .from('cities')
    .select('name, reliability_score')
    .eq('id', cityId)
    .single();

  const minScore = parseFloat(await getOpsConfig('min_ingestion_score'));
  const effectiveThreshold = minScore * (2 - (city?.reliability_score || 1.0));

  // Fetch queued meetings
  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('city_id', cityId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch queued meetings: ${error.message}`);
  if (!meetings || meetings.length === 0) {
    console.log(`[IngestionQC] ${city?.name}: no queued meetings`);
    return results;
  }

  for (const meeting of meetings) {
    try {
      // We need content to score — fetch it via the URL if transcript_text not yet populated
      const contentToScore = meeting.transcript_text || `URL: ${meeting.url}\nSource: ${meeting.source_url}`;

      const userMsg = `Meeting type: ${meeting.meeting_type || 'unknown'}
Meeting URL: ${meeting.url}
Content:
${contentToScore.substring(0, 5000)}`;

      const scores = await callClaudeJSON(MODELS.HAIKU, QC_SYSTEM, userMsg, { maxTokens: 500 });
      const totalScore = scores.total_score || 0;

      // Update meeting with score
      const updates = {
        ingestion_score: totalScore,
        meeting_date: scores.date_extractable?.extracted_date || meeting.meeting_date,
      };

      if (totalScore >= effectiveThreshold) {
        updates.status = 'ingestion_passed';
        results.passed++;
      } else {
        updates.status = 'skipped';
        results.skipped++;

        // Log to qc_log
        await supabase.from('qc_log').insert({
          city_id: cityId,
          meeting_id: meeting.id,
          story_topic: meeting.meeting_type || 'unknown',
          flagging_agent: 'ingestion_qc',
          reason: `Score ${totalScore} below threshold ${effectiveThreshold}. ` +
            `Date: ${scores.date_extractable?.score}/30, ` +
            `Length: ${scores.content_length?.score}/40, ` +
            `Match: ${scores.content_match?.score}/30`,
        });
      }

      await supabase
        .from('meetings')
        .update(updates)
        .eq('id', meeting.id);

    } catch (err) {
      results.errors.push(`Meeting ${meeting.id}: ${err.message}`);
    }
  }

  console.log(`[IngestionQC] ${city?.name}: ${results.passed} passed, ${results.skipped} skipped`);
  return results;
}
