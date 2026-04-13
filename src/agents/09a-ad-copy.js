/**
 * Agent 9a — Ad Copy Writer
 * Model: Claude Haiku
 *
 * For each selected story, writes 3 ad copy variants.
 * All claims must appear in the approved story summary — no embellishment.
 */

import { callClaudeJSON, MODELS } from '../config/anthropic.js';
import { getStyleConfig, buildStylePromptBlock } from '../utils/style-config.js';

const AD_COPY_SYSTEM = `You are a Facebook ad copywriter for a civic newsletter. Write 3 ad copy variants for the provided story.

RULES:
- All claims must come directly from the story summary — NO embellishment, exaggeration, or new information
- Keep language neutral and factual

For each variant:
- Headline: ≤ 40 characters
- Body: 1 sentence, ≤ 90 characters

Three variants differ by hook angle:
1. "civic_fact" — States what happened (factual headline)
2. "resident_impact" — States what it means for residents
3. "curiosity" — Prompts the reader with a question

Return JSON array:
[
  {"angle": "civic_fact", "headline": "...", "body": "..."},
  {"angle": "resident_impact", "headline": "...", "body": "..."},
  {"angle": "curiosity", "headline": "...", "body": "..."}
]`;

/**
 * Generate ad copy variants for a story.
 */
export async function runAdCopyWriter(story, cityId) {
  const styleConfig = await getStyleConfig(cityId);
  const styleBlock = buildStylePromptBlock(styleConfig);

  const userMsg = `City: ${story.city_name || 'Unknown'}
Category: ${story.category}
Impact: ${story.impact_score}
Story summary: ${story.summary_text}`;

  const variants = await callClaudeJSON(
    MODELS.HAIKU,
    AD_COPY_SYSTEM + '\n\n' + styleBlock,
    userMsg,
    { maxTokens: 1024 }
  );

  // Validate lengths
  return variants.map(v => ({
    ...v,
    headline: v.headline.substring(0, 40),
    body: v.body.substring(0, 90),
  }));
}
