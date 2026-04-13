/**
 * Agent 8 — Story Selector
 * Model: Claude Sonnet
 *
 * From the assembled issue, selects 2-3 highest-impact stories for ad campaigns.
 * Preference: dollar amounts >$100K → school news → roads → safety → other
 */

import supabase from '../config/db.js';

const CATEGORY_PRIORITY = {
  Budget: 1,
  Schools: 2,
  Roads: 3,
  Safety: 4,
  Zoning: 5,
  Parks: 6,
  Utilities: 7,
  Other: 8,
};

/**
 * Select top 2-3 stories from an issue for ad campaigns.
 * @param {string} issueId
 * @returns {object[]} - Selected stories
 */
export async function runStorySelector(issueId) {
  const { data: issue } = await supabase
    .from('issues')
    .select('story_ids, city_id')
    .eq('id', issueId)
    .single();

  if (!issue) throw new Error(`Issue not found: ${issueId}`);

  const { data: stories } = await supabase
    .from('stories')
    .select('*')
    .in('id', issue.story_ids)
    .eq('qc_status', 'approved');

  if (!stories || stories.length === 0) return [];

  // Score and rank stories
  const scored = stories.map(s => ({
    ...s,
    priority: calculatePriority(s),
  }));

  scored.sort((a, b) => a.priority - b.priority);

  // Select top 2-3
  const selected = scored.slice(0, Math.min(3, scored.length));

  console.log(`[StorySelector] Selected ${selected.length} stories for ads from issue ${issueId}`);
  return selected;
}

function calculatePriority(story) {
  let score = 0;

  // Impact score
  if (story.impact_score === 'High') score += 0;
  else if (story.impact_score === 'Medium') score += 10;
  else score += 20;

  // Category preference
  score += (CATEGORY_PRIORITY[story.category] || 8);

  // Bonus for dollar amounts > $100K mentioned in summary
  const dollarMatch = story.summary_text.match(/\$[\d,.]+\s*(million|M|K|billion|B)/i);
  if (dollarMatch) score -= 5;

  return score;
}
