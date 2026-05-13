/**
 * Agent 4c — Signal Gate
 * Model: Claude Sonnet (Haiku for the regex fast-path; no LLM call when stubs match)
 *
 * Sits between the Summarizer and the Context Enricher. A story must hit at
 * least one of four signals to be allowed to progress through QC:
 *   - decision_made      : a vote happened, a contract was awarded, a rule changed, money was committed.
 *   - action_window      : public comment open, hearing scheduled with a specific topic, deadline for resident input.
 *   - material_consequence: something will measurably change for residents (service, money, rule, infrastructure).
 *   - conflict           : council split, public opposition recorded, alternative proposals discussed.
 *
 * Zero signals → qc_status='dropped' + qc_log row. Verdict (which only reads
 * qc_status='pending') will then naturally skip these stories.
 *
 * Stories that already have signal_score set are skipped (idempotent).
 */

import supabase from '../config/db.js';
import { callClaudeJSON, MODELS } from '../config/anthropic.js';

const SIGNAL_GATE_SYSTEM = `You are a civic-news editor deciding whether a draft story carries enough signal to publish.

Score the story on four signals. For each, return whether it "hit" and a short evidence quote from the summary/headline that justifies your call.

Signals (be strict — assume the burden of proof is on the story):

1. decision_made — A concrete action was taken: a vote, an award of a contract, the passage or rejection of an ordinance/resolution, the commitment of funds, a hiring/firing, a policy change taking effect. Discussions, agenda items, or scheduled future votes do NOT count.

2. action_window — There is a specific, dated opportunity for residents to act: a public comment period that is open now, a hearing scheduled on a specific topic with a date, a deadline to apply/submit/object. A generic "next meeting" reference is NOT enough.

3. material_consequence — Something will measurably change for residents within a knowable timeframe: a service is added/cut, a fee or tax changes, an infrastructure project starts/stops, a rule alters what residents can do. Aspirations and proposals that have not advanced do NOT count.

4. conflict — Recorded disagreement that shaped the outcome: a split vote, named opposition from council members or department heads, a competing proposal that was considered, organized public opposition entered into the record. A single skeptical question is NOT conflict.

Return exactly:
{
  "decision_made":       { "hit": true|false, "evidence": "short quote or empty string" },
  "action_window":       { "hit": true|false, "evidence": "short quote or empty string" },
  "material_consequence":{ "hit": true|false, "evidence": "short quote or empty string" },
  "conflict":            { "hit": true|false, "evidence": "short quote or empty string" }
}

Do not invent evidence. If a signal does not clearly hit, mark it false.`;

const SIGNAL_KEYS = ['decision_made', 'action_window', 'material_consequence', 'conflict'];

/**
 * Regex fast-path: catches the stub patterns Ian flagged (scheduled-meeting,
 * no agenda items, etc.) without paying for an LLM call. Returns true if the
 * story is an obvious stub.
 */
function isObviousStub(story) {
  const text = `${story.headline || ''} ${story.summary_text || ''}`.toLowerCase();
  const stubPatterns = [
    /\bis scheduled to meet\b/,
    /\bno specific agenda items? (?:were|was) listed\b/,
    /\bagenda has not been (?:released|published)\b/,
    /\bno agenda (?:items|was) (?:available|provided|posted)\b/,
    /\b(?:committee|council|board) will (?:meet|gather|convene)\b/,
  ];
  return stubPatterns.some(rx => rx.test(text));
}

/**
 * Run Signal Gate over all pending stories in a city that have not yet been
 * scored.
 *
 * @param {string} cityId
 * @returns {{gated: number, dropped: number, errors: string[]}}
 */
export async function runSignalGate(cityId) {
  const results = { gated: 0, dropped: 0, errors: [] };

  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, meeting_id, headline, summary_text, category, context_note, votes_json, meetings(meeting_type, meeting_date, source_url)')
    .eq('city_id', cityId)
    .eq('qc_status', 'pending')
    .is('signal_score', null);

  if (error) throw new Error(`Failed to fetch pending stories: ${error.message}`);
  if (!stories || stories.length === 0) {
    console.log('[SignalGate] No pending stories awaiting scoring');
    return results;
  }

  for (const story of stories) {
    try {
      let signalScore = 0;
      let signalReasons = [];
      let stubDrop = false;

      if (isObviousStub(story)) {
        // Cheap drop. Don't waste a Sonnet call.
        stubDrop = true;
      } else {
        const userMsg = buildUserMsg(story);
        const scores = await callClaudeJSON(MODELS.SONNET, SIGNAL_GATE_SYSTEM, userMsg, { maxTokens: 600 });

        for (const key of SIGNAL_KEYS) {
          if (scores?.[key]?.hit === true) {
            signalScore++;
            signalReasons.push(key);
          }
        }
      }

      const updates = {
        signal_score: signalScore,
        signal_reasons: signalReasons,
      };

      if (signalScore === 0) {
        updates.qc_status = 'dropped';
        results.dropped++;

        await supabase.from('qc_log').insert({
          city_id: cityId,
          meeting_id: story.meeting_id,
          story_topic: story.headline || story.category || 'unknown',
          flagging_agent: 'signal_gate',
          reason: stubDrop
            ? 'Dropped: matched stub pattern (scheduled meeting / no agenda).'
            : 'Dropped: hit zero of four signals (decision_made, action_window, material_consequence, conflict).',
        });
      } else {
        results.gated++;
      }

      const { error: updateErr } = await supabase
        .from('stories')
        .update(updates)
        .eq('id', story.id);

      if (updateErr) {
        results.errors.push(`Story ${story.id} update: ${updateErr.message}`);
      }
    } catch (err) {
      results.errors.push(`Story ${story.id}: ${err.message}`);
    }
  }

  console.log(`[SignalGate] Gated ${results.gated} stories, dropped ${results.dropped}`);
  return results;
}

function buildUserMsg(story) {
  const meeting = story.meetings || {};
  const votes = Array.isArray(story.votes_json) && story.votes_json.length > 0
    ? `\n\nVotes recorded:\n${JSON.stringify(story.votes_json)}`
    : '';
  const context = story.context_note ? `\n\nContext note: ${story.context_note}` : '';
  return `Meeting type: ${meeting.meeting_type || 'unknown'}
Meeting date: ${meeting.meeting_date || 'unknown'}

Headline: ${story.headline || '(none)'}

Summary:
${story.summary_text}${context}${votes}`;
}
