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
      const wordCount = scores.content_length?.word_count ?? 0;

      // Deterministic agenda-completeness guard: even when the Haiku score
      // squeaks past threshold, refuse stub scrapes that have no real agenda.
      // This is what kept the "no specific agenda items were listed" story
      // from being dropped in earlier runs.
      const agendaStubResult = checkAgendaStub({
        meetingType: meeting.meeting_type,
        wordCount,
        contentToScore,
      });

      // Update meeting with score
      const updates = {
        ingestion_score: totalScore,
        meeting_date: scores.date_extractable?.extracted_date || meeting.meeting_date,
      };

      if (agendaStubResult.isStub) {
        updates.status = 'skipped';
        results.skipped++;

        await supabase.from('qc_log').insert({
          city_id: cityId,
          meeting_id: meeting.id,
          story_topic: meeting.meeting_type || 'unknown',
          flagging_agent: 'ingestion_qc',
          reason: `Skipped: agenda-stub guard tripped (${agendaStubResult.reason}). ` +
            `LLM score was ${totalScore}.`,
        });
      } else if (totalScore >= effectiveThreshold) {
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

/**
 * Detect ingestion-time stubs that shouldn't progress to summarization.
 *
 *   1. Short council/committee/board scrapes with < 400 words almost always
 *      mean we only got the "this meeting is scheduled" preamble.
 *   2. Stub phrasing ("no specific agenda items were listed", "agenda has not
 *      been released", etc.) means no agenda was actually extractable.
 *
 * Either of these is enough to skip the meeting; otherwise it falls through
 * to the normal scoring path.
 */
function checkAgendaStub({ meetingType, wordCount, contentToScore }) {
  const text = (contentToScore || '').toLowerCase();

  const STUB_PHRASES = [
    'no specific agenda items were listed',
    'no specific agenda items was listed',
    'agenda has not been released',
    'agenda has not been published',
    'agenda was not posted',
    'no agenda items available',
    'no agenda items provided',
  ];
  for (const phrase of STUB_PHRASES) {
    if (text.includes(phrase)) {
      return { isStub: true, reason: `matched stub phrase "${phrase}"` };
    }
  }

  const lowerType = (meetingType || '').toLowerCase();
  const isCouncilLike = ['council', 'committee', 'board', 'commission'].some(w =>
    lowerType.includes(w)
  );
  if (isCouncilLike && wordCount > 0 && wordCount < 400) {
    return {
      isStub: true,
      reason: `${meetingType} scrape only ${wordCount} words (< 400) — likely missing agenda`,
    };
  }

  return { isStub: false };
}
