/**
 * Agent 5a — Fact-checker
 * Model: Claude Opus
 *
 * Verifies every claim in the summary against the original transcript.
 * Checks vote counts for exact matches. Runs in parallel with 5b.
 */

import { callClaudeJSON, MODELS } from '../config/anthropic.js';

const FACT_CHECK_SYSTEM = `You are a strict fact-checker. Review every specific claim in the summary against the transcript. Be precise and exhaustive.

For each claim in the summary:
1. Find the supporting text in the transcript
2. Verify the claim accurately represents the transcript
3. Check all vote counts match exactly

Return exactly:
{
  "claims_verified": true/false,
  "verified_claims": ["claim 1 text", "claim 2 text"],
  "unverified_claims": [{"claim": "...", "reason": "..."}],
  "vote_errors": [{"summary_says": "...", "transcript_says": "..."}]
}

If ALL claims are verified and ALL votes match, set claims_verified = true.
If ANY claim cannot be verified or ANY vote is wrong, set claims_verified = false.`;

/**
 * Fact-check a single story against its transcript.
 * @param {string} summaryText - The story summary
 * @param {string} transcriptText - The meeting transcript
 * @param {object} votesJson - The extracted votes array
 * @returns {object} - Fact-check results
 */
export async function runFactChecker(summaryText, transcriptText, votesJson) {
  const userMsg = `SUMMARY TO VERIFY:
${summaryText}

VOTES IN SUMMARY:
${JSON.stringify(votesJson || [], null, 2)}

ORIGINAL TRANSCRIPT:
${transcriptText?.substring(0, 40000) || 'No transcript available'}`;

  const result = await callClaudeJSON(MODELS.OPUS, FACT_CHECK_SYSTEM, userMsg, {
    maxTokens: 2048,
  });

  return {
    claims_verified: result.claims_verified ?? false,
    unverified_claims: result.unverified_claims || [],
    vote_errors: result.vote_errors || [],
  };
}
