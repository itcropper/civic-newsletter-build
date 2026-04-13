/**
 * Agent 9b — Audience Targeting
 * Model: Claude Haiku
 *
 * Generates a Facebook targeting brief for each city's ad campaign.
 */

import { callClaude, MODELS } from '../config/anthropic.js';

const TARGETING_SYSTEM = `You are a Facebook Ads targeting specialist for local civic newsletters. Generate a targeting brief based on the city and story information provided.

Use this structure:
- Geographic: municipality boundary + 2 mile radius
- Age: 28-65
- Interests: homeowners, local community, local news, civic engagement, city government
- Exclude: anyone who clicked a newsletter ad for this city in the last 30 days

Write a concise targeting brief that a Facebook Ads API integration can use. Include the specific city name and any relevant local context.`;

/**
 * Generate audience targeting brief for a city's ad campaign.
 */
export async function runAudienceTargeting(cityName, stories) {
  const storyContext = stories
    .map(s => `${s.category}: ${s.summary_text.substring(0, 100)}`)
    .join('\n');

  const userMsg = `City: ${cityName}
Number of stories: ${stories.length}
Story categories: ${stories.map(s => s.category).join(', ')}

Story summaries:
${storyContext}`;

  const brief = await callClaude(MODELS.HAIKU, TARGETING_SYSTEM, userMsg, { maxTokens: 500 });
  return brief;
}
