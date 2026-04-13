/**
 * Agent 7 — Newsletter Builder
 * Model: Claude Sonnet
 *
 * Assembles approved stories into a newsletter, posts to Beehiiv as draft.
 * Creates issues row, marks stories as used, clears Redis queue atomically.
 */

import supabase from '../config/db.js';
import { callClaude, MODELS } from '../config/anthropic.js';
import { getStyleConfig, buildStylePromptBlock } from '../utils/style-config.js';
import { getRedis, keys } from '../config/redis.js';
import dotenv from 'dotenv';
dotenv.config();

const LEDE_SYSTEM = `You are a civic newsletter editor. Write a lede paragraph (exactly 3 sentences) that accurately covers the top 3 stories provided. Be factual, clear, and engaging. Do not editorialize or speculate.`;

const IMPACT_ORDER = { High: 0, Medium: 1, Low: 2 };

/**
 * Build and publish the weekly newsletter for a city.
 */
export async function runNewsletterBuilder(cityId) {
  const { data: city } = await supabase
    .from('cities')
    .select('name')
    .eq('id', cityId)
    .single();

  const styleConfig = await getStyleConfig(cityId);
  const styleBlock = buildStylePromptBlock(styleConfig);

  // Pull approved stories from Redis queue
  const redis = getRedis();
  const queueKey = keys.queue(city.name);
  const queueItems = await redis.lrange(queueKey, 0, -1);

  if (!queueItems || queueItems.length === 0) {
    console.log(`[Newsletter] ${city.name}: no stories in queue`);
    return null;
  }

  const storyIds = queueItems.map(item => JSON.parse(item).story_id);

  // Fetch full story data
  const { data: stories } = await supabase
    .from('stories')
    .select('*, meetings(meeting_date, source_url, meeting_type)')
    .in('id', storyIds)
    .eq('qc_status', 'approved');

  if (!stories || stories.length === 0) return null;

  // Rank: High → Medium → Low, then by most recent meeting date
  stories.sort((a, b) => {
    const impactDiff = (IMPACT_ORDER[a.impact_score] || 2) - (IMPACT_ORDER[b.impact_score] || 2);
    if (impactDiff !== 0) return impactDiff;
    return new Date(b.meetings?.meeting_date || 0) - new Date(a.meetings?.meeting_date || 0);
  });

  // Get upcoming meetings
  const { data: upcomingMeetings } = await supabase
    .from('meetings')
    .select('meeting_date, meeting_type, source_url')
    .eq('city_id', cityId)
    .gt('meeting_date', new Date().toISOString().split('T')[0])
    .order('meeting_date', { ascending: true })
    .limit(5);

  // Generate lede paragraph (written last per spec, but generated from top 3)
  const top3Summaries = stories.slice(0, 3).map(s => s.summary_text).join('\n\n');
  const lede = await callClaude(
    MODELS.SONNET,
    LEDE_SYSTEM + '\n\n' + styleBlock,
    `Top 3 stories:\n${top3Summaries}`,
    { maxTokens: 500 }
  );

  // Assemble newsletter HTML
  const issueDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const readTime = Math.max(2, Math.ceil(stories.length * 1.5));

  const storyCards = stories.map(s => {
    const impactDot = s.impact_score === 'High' ? '🔴' : s.impact_score === 'Medium' ? '🟡' : '🟢';
    return `<div class="story-card">
  <span class="category-tag">${s.category}</span> ${impactDot}
  <h3>${s.summary_text.split('.')[0]}.</h3>
  <p>${s.summary_text}</p>
  <p class="attribution">Source: <a href="${s.meetings?.source_url || '#'}">${s.meetings?.meeting_type || 'Meeting'}</a> — ${s.meetings?.meeting_date || 'Date unknown'}</p>
</div>`;
  }).join('\n\n');

  // Civic snapshot
  const meetingCount = new Set(stories.map(s => s.meeting_id)).size;
  const voteCount = stories.reduce((sum, s) => sum + (s.votes_json?.length || 0), 0);

  const upcomingHtml = upcomingMeetings?.length > 0
    ? upcomingMeetings.map(m => `<li>${m.meeting_type} — ${m.meeting_date}</li>`).join('\n')
    : '<li>No upcoming meetings found</li>';

  const newsletterHtml = `
<div class="newsletter">
  <header>
    <h1>${city.name} Civic Update</h1>
    <p>${issueDate} · ${meetingCount} meeting${meetingCount !== 1 ? 's' : ''} covered · ${readTime} min read</p>
  </header>

  <div class="lede">
    <p>${lede}</p>
  </div>

  ${storyCards}

  <div class="civic-snapshot">
    <h2>Civic Snapshot</h2>
    <p>Meetings covered this week: ${meetingCount} · Votes taken: ${voteCount}</p>
  </div>

  <div class="coming-up">
    <h2>Coming Up</h2>
    <ul>${upcomingHtml}</ul>
  </div>

  <footer>
    <p>Powered by AI civic monitoring · <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
  </footer>
</div>`;

  // Post to Beehiiv as draft
  const beehiivPostId = await postToBeehiiv(city.name, newsletterHtml, issueDate);

  // Create issues row
  const { data: issue, error: issueErr } = await supabase.from('issues').insert({
    city_id: cityId,
    story_ids: storyIds,
    beehiiv_post_id: beehiivPostId,
    style_config_version: styleConfig.version,
  }).select().single();

  if (issueErr) throw new Error(`Failed to create issue: ${issueErr.message}`);

  // Mark stories as used
  await supabase.from('stories')
    .update({ used_in_issue_id: issue.id })
    .in('id', storyIds);

  // Clear Redis queue atomically
  await redis.del(queueKey);

  console.log(`[Newsletter] ${city.name}: assembled ${stories.length} stories, Beehiiv draft: ${beehiivPostId}`);
  return { issueId: issue.id, storyCount: stories.length, beehiivPostId };
}

/**
 * Post newsletter content to Beehiiv as a draft.
 */
async function postToBeehiiv(cityName, htmlContent, issueDate) {
  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;

  if (!apiKey || !pubId) {
    console.warn('[Newsletter] Beehiiv credentials not configured — skipping API call');
    return 'draft_local_' + Date.now();
  }

  try {
    const response = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: `${cityName} Civic Update — ${issueDate}`,
        subtitle: `Your weekly civic roundup for ${cityName}`,
        content: [{ type: 'html', html: htmlContent }],
        status: 'draft',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Newsletter] Beehiiv API error:', err);
      return 'draft_failed_' + Date.now();
    }

    const data = await response.json();
    return data.data?.id || 'draft_unknown';
  } catch (err) {
    console.error('[Newsletter] Beehiiv request failed:', err.message);
    return 'draft_error_' + Date.now();
  }
}
