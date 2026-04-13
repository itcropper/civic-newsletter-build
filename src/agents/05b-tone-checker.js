/**
 * Agent 5b — Tone checker
 * Model: Claude Haiku
 *
 * Checks summary for banned phrases and editorial language.
 * Runs in parallel with 5a.
 */

import { callClaudeJSON, MODELS } from '../config/anthropic.js';

const TONE_CHECK_SYSTEM = `You are a tone and neutrality reviewer for civic journalism. Review the summary for:

1. Any word or phrase from the banned list (exact or near-match)
2. Any language that expresses opinion, emotion, or editorial framing rather than reporting fact
3. Any sensationalism, loaded language, or implied judgment

Return exactly:
{
  "tone_clean": true/false,
  "issues": [
    {"type": "banned_phrase|editorial|sensational", "text": "the problematic text", "suggestion": "neutral alternative"}
  ]
}

If no issues found, return {"tone_clean": true, "issues": []}`;

/**
 * Check tone/neutrality of a story summary.
 * @param {string} summaryText - The story summary
 * @param {string[]} bannedPhrases - List of banned phrases from style_config
 * @returns {object} - Tone check results
 */
export async function runToneChecker(summaryText, bannedPhrases) {
  const userMsg = `BANNED PHRASES LIST:
${bannedPhrases.join('\n')}

SUMMARY TO REVIEW:
${summaryText}`;

  const result = await callClaudeJSON(MODELS.HAIKU, TONE_CHECK_SYSTEM, userMsg, {
    maxTokens: 1024,
  });

  return {
    tone_clean: result.tone_clean ?? true,
    issues: result.issues || [],
  };
}
