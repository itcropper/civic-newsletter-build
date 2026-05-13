/**
 * City Worker Pipeline — Orchestrates all 10 agents for a single city.
 *
 * Nightly run: Agents 1–6 (crawl + process + QC)
 * Weekly send: Agents 7–10 (newsletter + marketing)
 */

import supabase from './config/db.js';
import { getOpsConfigBatch } from './utils/ops-config.js';
import { runCrawler } from './agents/01-crawler.js';
import { runIngestionQC } from './agents/02-ingestion-qc.js';
import { runTranscription } from './agents/03-transcription.js';
import { runSourceVerifier } from './agents/03b-source-verifier.js';
import { runSummarizer } from './agents/04-summarizer.js';
import { runSignalGate } from './agents/04c-signal-gate.js';
import { runContextEnricher } from './agents/04b-context-enricher.js';
import { runVerdict } from './agents/06-verdict.js';
import { runNewsletterBuilder } from './agents/07-newsletter-builder.js';
import { runStorySelector } from './agents/08-story-selector.js';
import { runAdCopyWriter } from './agents/09a-ad-copy.js';
import { runAudienceTargeting } from './agents/09b-audience-targeting.js';
import { runSubjectLineTester } from './agents/09c-subject-lines.js';
import { runCampaignAssembler } from './agents/10-campaign-assembler.js';

/**
 * Run the nightly crawl + process pipeline (Agents 1–6) for a single city.
 */
export async function runNightlyPipeline(cityId) {
  const startTime = Date.now();
  console.log(`\n========== NIGHTLY PIPELINE: ${cityId} ==========`);

  try {
    // Agent 1 — Crawl
    console.log('[Pipeline] Starting Agent 1: Crawler...');
    const crawlResults = await runCrawler(cityId);
    console.log(`[Pipeline] Crawler done: ${crawlResults.newMeetings} new meetings`);

    // Agent 2 — Ingestion QC
    console.log('[Pipeline] Starting Agent 2: Ingestion QC...');
    const qcResults = await runIngestionQC(cityId);
    console.log(`[Pipeline] Ingestion QC done: ${qcResults.passed} passed`);

    // Agent 3 — Transcription
    console.log('[Pipeline] Starting Agent 3: Transcription...');
    const transcriptResults = await runTranscription(cityId);
    console.log(`[Pipeline] Transcription done: ${transcriptResults.processed} processed`);

    // Agent 3b — Source Verification
    console.log('[Pipeline] Starting Agent 3b: Source Verifier...');
    const verifyResults = await runSourceVerifier(cityId);
    console.log(`[Pipeline] Source Verifier done: ${verifyResults.verified} verified, ${verifyResults.flagged} flagged, ${verifyResults.rejected} rejected`);

    // Agent 4 — Summarizer
    console.log('[Pipeline] Starting Agent 4: Summarizer...');
    const summaryResults = await runSummarizer(cityId);
    console.log(`[Pipeline] Summarizer done: ${summaryResults.storiesCreated} stories`);

    // Agent 4c — Signal Gate (drops low-signal stories before we pay for enrichment)
    console.log('[Pipeline] Starting Agent 4c: Signal Gate...');
    const signalResults = await runSignalGate(cityId);
    console.log(`[Pipeline] Signal Gate done: ${signalResults.gated} gated, ${signalResults.dropped} dropped`);

    // Agent 4b — Context Enricher (web research — adds background beyond transcript)
    // Requires BRAVE_API_KEY in environment for web search; gracefully skips if absent.
    console.log('[Pipeline] Starting Agent 4b: Context Enricher...');
    const enrichResults = await runContextEnricher(cityId, {
      braveApiKey: process.env.BRAVE_API_KEY || null,
    });
    console.log(`[Pipeline] Context Enricher done: ${enrichResults.enriched} enriched, ${enrichResults.skipped} no-context`);

    // Agents 5a/5b + 6 — QC + Verdict (may loop for revisions)
    console.log('[Pipeline] Starting Agents 5a/5b/6: QC + Verdict...');
    const verdictResults = await runVerdict(cityId);
    console.log(`[Pipeline] Verdict done: ${verdictResults.approved} approved, ${verdictResults.dropped} dropped`);

    // If there were revisions, run verdict again to process re-submitted stories
    if (verdictResults.revised > 0) {
      console.log('[Pipeline] Re-running verdict for revised stories...');
      const reVerdictResults = await runVerdict(cityId);
      console.log(`[Pipeline] Re-verdict: ${reVerdictResults.approved} approved, ${reVerdictResults.dropped} dropped`);
    }

    // Update reliability score
    await updateReliabilityScore(cityId, crawlResults, qcResults);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Pipeline] Nightly pipeline complete in ${elapsed}s`);

    return {
      crawl: crawlResults,
      ingestion: qcResults,
      transcription: transcriptResults,
      summary: summaryResults,
      signalGate: signalResults,
      verdict: verdictResults,
    };

  } catch (err) {
    console.error(`[Pipeline] Nightly pipeline failed for ${cityId}:`, err);
    throw err;
  }
}

/**
 * Run the weekly send pipeline (Agents 7–10) for a single city.
 */
export async function runWeeklyPipeline(cityId) {
  const startTime = Date.now();
  console.log(`\n========== WEEKLY PIPELINE: ${cityId} ==========`);

  try {
    const { data: city } = await supabase
      .from('cities')
      .select('name')
      .eq('id', cityId)
      .single();

    // Agent 7 — Newsletter Builder
    console.log('[Pipeline] Starting Agent 7: Newsletter Builder...');
    const newsletter = await runNewsletterBuilder(cityId);
    if (!newsletter) {
      console.log('[Pipeline] No stories to send — skipping weekly pipeline');
      return null;
    }
    console.log(`[Pipeline] Newsletter built: ${newsletter.storyCount} stories`);

    // Agent 8 — Story Selector
    console.log('[Pipeline] Starting Agent 8: Story Selector...');
    const selectedStories = await runStorySelector(newsletter.issueId);
    console.log(`[Pipeline] Selected ${selectedStories.length} stories for ads`);

    if (selectedStories.length > 0) {
      // Agents 9a, 9b, 9c — run in parallel
      console.log('[Pipeline] Starting Agents 9a/9b/9c in parallel...');
      const [adCopyResults, targetingBrief, subjectLines] = await Promise.all([
        // 9a — Ad copy for each selected story
        Promise.all(selectedStories.map(s => runAdCopyWriter(s, cityId))),
        // 9b — Audience targeting
        runAudienceTargeting(city.name, selectedStories),
        // 9c — Subject lines
        runSubjectLineTester(newsletter.issueId, cityId, city.name, selectedStories),
      ]);
      console.log('[Pipeline] Ad copy, targeting, and subject lines ready');

      // Agent 10 — Campaign Assembler
      console.log('[Pipeline] Starting Agent 10: Campaign Assembler...');
      const campaign = await runCampaignAssembler(
        newsletter.issueId,
        cityId,
        adCopyResults,
        targetingBrief
      );
      console.log(`[Pipeline] Campaign assembled: ${campaign.facebookCampaignId}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Pipeline] Weekly pipeline complete in ${elapsed}s`);
    return newsletter;

  } catch (err) {
    console.error(`[Pipeline] Weekly pipeline failed for ${cityId}:`, err);
    throw err;
  }
}

/**
 * Run all active cities. Nightly + weekly send if applicable.
 */
export async function runAllCities() {
  const config = await getOpsConfigBatch(['weekly_send_day', 'nightly_crawl_time']);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const isSendDay = today === config.weekly_send_day;

  const { data: cities } = await supabase
    .from('cities')
    .select('id, name, send_schedule')
    .eq('active', true)
    .order('name');

  if (!cities || cities.length === 0) {
    console.log('[Pipeline] No active cities');
    return;
  }

  // Stagger cities by 8 minutes each
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];

    if (i > 0) {
      console.log(`[Pipeline] Waiting 8 minutes before next city...`);
      await new Promise(r => setTimeout(r, 8 * 60 * 1000));
    }

    // Always run nightly
    await runNightlyPipeline(city.id);

    // Run weekly send if today matches city's schedule
    if (isSendDay && shouldSendToday(city.send_schedule, today)) {
      await runWeeklyPipeline(city.id);
    }
  }
}

/**
 * Update city reliability score using exponential moving average.
 */
async function updateReliabilityScore(cityId, crawlResults, qcResults) {
  const totalAttempted = qcResults.passed + qcResults.skipped;
  if (totalAttempted === 0) return;

  const { data: city } = await supabase
    .from('cities')
    .select('reliability_score')
    .eq('id', cityId)
    .single();

  const currentScore = city?.reliability_score || 1.0;
  const runScore = qcResults.passed / totalAttempted;
  const newScore = 0.3 * runScore + 0.7 * currentScore;

  await supabase.from('cities')
    .update({ reliability_score: newScore })
    .eq('id', cityId);

  // Deactivate if score too low after 5+ runs
  if (newScore < 0.4) {
    const { count } = await supabase
      .from('qc_log')
      .select('id', { count: 'exact' })
      .eq('city_id', cityId);

    if (count >= 5) {
      await supabase.from('cities')
        .update({ active: false })
        .eq('id', cityId);

      await supabase.from('qc_log').insert({
        city_id: cityId,
        flagging_agent: 'pipeline',
        reason: `City deactivated: reliability score ${newScore.toFixed(2)} below 0.4 after ${count} runs`,
      });
    }
  }
}

function shouldSendToday(schedule, today) {
  // For now, weekly sends on the configured day. Biweekly/monthly TBD.
  return schedule === 'weekly';
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('pipeline.js')) {
  const mode = process.argv[2] || 'all';
  const cityId = process.argv[3];

  if (mode === 'nightly' && cityId) {
    runNightlyPipeline(cityId).catch(console.error);
  } else if (mode === 'weekly' && cityId) {
    runWeeklyPipeline(cityId).catch(console.error);
  } else {
    runAllCities().catch(console.error);
  }
}
