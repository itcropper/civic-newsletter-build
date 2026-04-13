/**
 * Agent 6 — Verdict
 * Model: Claude Sonnet
 *
 * Combines fact-check + tone-check results. Approves, revises, or drops stories.
 * Revision loop capped at ops_config.max_revision_loops.
 */

import supabase from '../config/db.js';
import { runFactChecker } from './05a-fact-checker.js';
import { runToneChecker } from './05b-tone-checker.js';
import { reviseSummary } from './04-summarizer.js';
import { getStyleConfig } from '../utils/style-config.js';
import { getOpsConfig } from '../utils/ops-config.js';
import { getRedis, keys } from '../config/redis.js';

/**
 * Run the QC verdict loop for all pending stories in a city.
 */
export async function runVerdict(cityId) {
  const results = { approved: 0, dropped: 0, revised: 0, errors: [] };

  const maxLoops = parseInt(await getOpsConfig('max_revision_loops'));
  const styleConfig = await getStyleConfig(cityId);
  const bannedPhrases = Array.isArray(styleConfig.banned_phrases)
    ? styleConfig.banned_phrases
    : JSON.parse(styleConfig.banned_phrases);

  // Get city name for Redis key
  const { data: city } = await supabase
    .from('cities')
    .select('name')
    .eq('id', cityId)
    .single();

  // Fetch pending stories with their meeting transcripts
  const { data: stories, error } = await supabase
    .from('stories')
    .select('*, meetings(transcript_text)')
    .eq('city_id', cityId)
    .eq('qc_status', 'pending');

  if (error) throw new Error(`Failed to fetch pending stories: ${error.message}`);
  if (!stories || stories.length === 0) return results;

  for (const story of stories) {
    try {
      const transcript = story.meetings?.transcript_text || '';

      // Run fact-check and tone-check in parallel
      const [factResult, toneResult] = await Promise.all([
        runFactChecker(story.summary_text, transcript, story.votes_json),
        runToneChecker(story.summary_text, bannedPhrases),
      ]);

      // Decision logic
      if (factResult.claims_verified && toneResult.tone_clean) {
        // Approved — update status and push to Redis queue
        await supabase.from('stories')
          .update({ qc_status: 'approved' })
          .eq('id', story.id);

        const redis = getRedis();
        await redis.rpush(
          keys.queue(city.name),
          JSON.stringify({ story_id: story.id })
        );

        results.approved++;

      } else if (!factResult.claims_verified) {
        // Factual errors → drop (never try to fix factual claims)
        await supabase.from('stories')
          .update({ qc_status: 'dropped' })
          .eq('id', story.id);

        await supabase.from('qc_log').insert({
          city_id: cityId,
          meeting_id: story.meeting_id,
          story_topic: story.category,
          flagging_agent: 'fact_checker',
          reason: `Unverified claims: ${JSON.stringify(factResult.unverified_claims)}. Vote errors: ${JSON.stringify(factResult.vote_errors)}`,
        });

        results.dropped++;

      } else if (!toneResult.tone_clean && story.qc_revision_count < maxLoops) {
        // Tone issues only, under revision limit → send back for revision
        const revisionNotes = toneResult.issues
          .map(i => `${i.type}: "${i.text}" → suggested: "${i.suggestion}"`)
          .join('\n');

        await reviseSummary(story.id, revisionNotes, cityId);
        results.revised++;

      } else {
        // Exceeded revision limit → drop
        await supabase.from('stories')
          .update({ qc_status: 'dropped' })
          .eq('id', story.id);

        await supabase.from('qc_log').insert({
          city_id: cityId,
          meeting_id: story.meeting_id,
          story_topic: story.category,
          flagging_agent: 'verdict',
          reason: `Exceeded max revision loops (${maxLoops}). Remaining tone issues: ${JSON.stringify(toneResult.issues)}`,
        });

        results.dropped++;
      }

    } catch (err) {
      results.errors.push(`Story ${story.id}: ${err.message}`);
    }
  }

  console.log(`[Verdict] Approved: ${results.approved}, Revised: ${results.revised}, Dropped: ${results.dropped}`);
  return results;
}
