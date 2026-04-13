/**
 * Agent 9c — Subject Line Tester
 * Model: Claude Haiku
 *
 * Writes 2 subject line variants for the newsletter issue.
 * Updates the issues row with subject_line_variants_json.
 */

import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';
import { getStyleConfig, buildStylePromptBlock } from '../utils/style-config.js';

const SUBJECT_LINE_SYSTEM = `You are a newsletter subject line writer for civic content. Write exactly 2 subject line variants.

Variant A — "specific_fact": Lead with a specific civic fact (dollar amount, vote result, concrete action)
  Example: "$4.2M road repair approved — here's what's changing"

Variant B — "civic_hook": Lead with a civic engagement hook
  Example: "What your city council decided this week in [City Name]"

RULES:
- Both variants ≤ 50 characters
- Use only facts from the provided stories — no embellishment
- Include the city name in at least one variant

Return JSON:
[
  {"variant": "A", "type": "specific_fact", "subject_line": "..."},
  {"variant": "B", "type": "civic_hook", "subject_line": "..."}
]`;

/**
 * Generate subject line variants and update the issue.
 */
export async function runSubjectLineTester(issueId, cityId, cityName, topStories) {
  const styleConfig = await getStyleConfig(cityId);
  const styleBlock = buildStylePromptBlock(styleConfig);

  const storyContext = topStories
    .map(s => `[${s.impact_score}] ${s.category}: ${s.summary_text}`)
    .join('\n\n');

  const userMsg = `City: ${cityName}
Top stories for this issue:
${storyContext}`;

  const variants = await callClaudeJSON(
    MODELS.HAIKU,
    SUBJECT_LINE_SYSTEM + '\n\n' + styleBlock,
    userMsg,
    { maxTokens: 500 }
  );

  // Enforce 50 char limit
  const trimmed = variants.map(v => ({
    ...v,
    subject_line: v.subject_line.substring(0, 50),
  }));

  // Update issues row
  await supabase.from('issues')
    .update({ subject_line_variants_json: trimmed })
    .eq('id', issueId);

  return trimmed;
}
