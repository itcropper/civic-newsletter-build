/**
 * Agent 3b — Source Verifier
 * Model: Claude Haiku
 *
 * Compares the cleaned transcript_text against the raw source HTML to catch
 * hallucinated or fabricated content introduced during transcription.
 *
 * This is a critical guard for civic accuracy: the fact-checker (Agent 5a)
 * can only verify internal consistency (summary vs transcript). This agent
 * verifies external consistency (transcript vs actual source material).
 *
 * Checks:
 * 1. Named entities (people, dollar amounts, dates, vote counts) in the
 *    transcript must appear in the raw source HTML
 * 2. No significant claims in the transcript should be absent from the source
 * 3. Flags any entities that appear to have been added during transcription
 */

import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';

const VERIFY_SYSTEM = `You are a source verification specialist. You are given two texts:
1. RAW SOURCE — the original HTML/text scraped from a government website
2. TRANSCRIPT — a cleaned version produced by an AI extraction agent

Your job is to verify that the TRANSCRIPT faithfully represents the RAW SOURCE.

Check these specific categories:
- NAMES: Every person named in the transcript must appear in the raw source. Flag any name in the transcript not found in the source.
- DOLLAR AMOUNTS: Every dollar figure in the transcript must appear in the raw source.
- VOTE COUNTS: Every vote tally (e.g., "6-0", "5-1") must appear in the raw source.
- DATES: Specific dates mentioned must be grounded in the source.
- KEY CLAIMS: Major factual claims (project status, percentages, decisions) must be supported.

Return exactly:
{
  "verified": true/false,
  "source_word_count": <number of words in raw source>,
  "transcript_word_count": <number of words in transcript>,
  "inflation_ratio": <transcript_word_count / source_word_count>,
  "ungrounded_entities": [
    {"type": "name|dollar|vote|date|claim", "value": "...", "concern": "..."}
  ],
  "fabrication_risk": "none|low|medium|high",
  "recommendation": "pass|flag|reject",
  "reason": "brief explanation"
}

IMPORTANT RULES:
- If transcript is significantly LONGER than the raw source, that is a red flag — the AI may have generated content.
- If the transcript contains named officials not found anywhere in the source, that is a HIGH fabrication risk.
- Minor formatting differences or paraphrasing are acceptable.
- An inflation_ratio above 1.5 should raise concern. Above 2.0 is a strong reject signal.
- Be strict. For a civic newsletter, a single fabricated name or dollar amount is unacceptable.`;

/**
 * Verify a transcript against its raw source material.
 * @param {string} cityId - City UUID
 * @returns {object} - { verified: number, flagged: number, rejected: number, errors: string[] }
 */
export async function runSourceVerifier(cityId) {
  const results = { verified: 0, flagged: 0, rejected: 0, errors: [] };

  // Get meetings that have been processed (have transcript_text) but not yet source-verified
  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('city_id', cityId)
    .eq('status', 'processed')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch meetings: ${error.message}`);
  if (!meetings || meetings.length === 0) return results;

  for (const meeting of meetings) {
    try {
      // Fetch the raw source page again
      const rawSource = await fetchRawSource(meeting.source_url || meeting.url);

      if (!rawSource || rawSource.length < 100) {
        // Can't verify — flag but don't block
        results.flagged++;
        await logVerification(cityId, meeting.id, 'source_verifier',
          'Could not re-fetch source URL for verification');
        continue;
      }

      // Compare transcript against raw source
      const verification = await callClaudeJSON(
        MODELS.HAIKU,
        VERIFY_SYSTEM,
        `RAW SOURCE (from ${meeting.source_url || meeting.url}):\n${rawSource.substring(0, 30000)}\n\n---\n\nTRANSCRIPT (produced by transcription agent):\n${meeting.transcript_text?.substring(0, 30000) || ''}`,
        { maxTokens: 1024 }
      );

      if (verification.recommendation === 'reject' || verification.fabrication_risk === 'high') {
        // Reject: revert meeting to a state that blocks summarization
        await supabase.from('meetings')
          .update({ status: 'source_rejected' })
          .eq('id', meeting.id);

        await logVerification(cityId, meeting.id, 'source_verifier',
          `REJECTED — ${verification.reason}. Ungrounded: ${JSON.stringify(verification.ungrounded_entities)}`);

        results.rejected++;

      } else if (verification.recommendation === 'flag' || verification.fabrication_risk === 'medium') {
        // Flag: allow to proceed but log concerns for human review
        await supabase.from('meetings')
          .update({ status: 'source_flagged' })
          .eq('id', meeting.id);

        await logVerification(cityId, meeting.id, 'source_verifier',
          `FLAGGED — ${verification.reason}. Ungrounded: ${JSON.stringify(verification.ungrounded_entities)}`);

        results.flagged++;

      } else {
        // Pass: mark as source-verified
        await supabase.from('meetings')
          .update({ status: 'source_verified' })
          .eq('id', meeting.id);

        results.verified++;
      }

    } catch (err) {
      results.errors.push(`Meeting ${meeting.id}: ${err.message}`);
    }
  }

  console.log(`[SourceVerifier] Verified: ${results.verified}, Flagged: ${results.flagged}, Rejected: ${results.rejected}`);
  return results;
}

/**
 * Fetch raw text from a URL (no AI cleaning — just strip HTML tags).
 */
async function fetchRawSource(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CivicNewsletterBot/1.0 (source verification)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Strip HTML tags but preserve text
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err) {
    console.error(`[SourceVerifier] Failed to fetch ${url}:`, err.message);
    return null;
  }
}

async function logVerification(cityId, meetingId, agent, reason) {
  await supabase.from('qc_log').insert({
    city_id: cityId,
    meeting_id: meetingId,
    flagging_agent: agent,
    reason,
  });
}
