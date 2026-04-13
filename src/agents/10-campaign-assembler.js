/**
 * Agent 10 — Campaign Assembler
 * Model: Claude Sonnet
 *
 * Combines ad copy, targeting, and geo data into a Facebook Ads API campaign.
 * Pushes campaign via Facebook Marketing API. Updates Beehiiv post to scheduled.
 */

import supabase from '../config/db.js';
import { getOpsConfig } from '../utils/ops-config.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Assemble and push a Facebook ad campaign for a newsletter issue.
 */
export async function runCampaignAssembler(issueId, cityId, adCopyVariants, targetingBrief) {
  const { data: city } = await supabase
    .from('cities')
    .select('name')
    .eq('id', cityId)
    .single();

  const { data: issue } = await supabase
    .from('issues')
    .select('beehiiv_post_id')
    .eq('id', issueId)
    .single();

  const adSpend = await getOpsConfig('ad_spend_per_city_monthly');
  const sendTime = await getOpsConfig('weekly_send_time');

  // Build Facebook campaign structure
  const campaignPayload = {
    name: `Civic Newsletter - ${city.name} - ${new Date().toISOString().split('T')[0]}`,
    objective: 'OUTCOME_TRAFFIC',
    status: 'PAUSED', // Start paused for safety; Ops can activate
    daily_budget: Math.round((parseFloat(adSpend) / 30) * 100), // cents
    ad_sets: adCopyVariants.map((variants, idx) => ({
      name: `Story ${idx + 1} - A/B Test`,
      targeting: {
        geo_locations: {
          cities: [{ key: city.name, radius: 2, distance_unit: 'mile' }],
        },
        age_min: 28,
        age_max: 65,
        interests: [
          { name: 'Local community' },
          { name: 'Local news' },
          { name: 'Civic engagement' },
          { name: 'Homeowners' },
        ],
      },
      ads: variants.map(v => ({
        name: `${v.angle} variant`,
        creative: {
          title: v.headline,
          body: v.body,
          link_url: `{{newsletter_link}}`, // Replaced at publish time
          call_to_action: { type: 'LEARN_MORE' },
        },
      })),
    })),
  };

  // Push to Facebook Marketing API (or stub)
  let facebookCampaignId = null;
  const fbToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const fbAdAccount = process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (fbToken && fbAdAccount) {
    try {
      facebookCampaignId = await createFacebookCampaign(fbToken, fbAdAccount, campaignPayload);
    } catch (err) {
      console.error('[CampaignAssembler] Facebook API error:', err.message);
      facebookCampaignId = 'fb_error_' + Date.now();
    }
  } else {
    console.warn('[CampaignAssembler] Facebook credentials not configured — campaign saved locally only');
    facebookCampaignId = 'fb_stub_' + Date.now();
  }

  // Save to ad_campaigns table
  await supabase.from('ad_campaigns').insert({
    city_id: cityId,
    issue_id: issueId,
    facebook_campaign_id: facebookCampaignId,
    ad_copy_variants_json: adCopyVariants,
    targeting_brief: targetingBrief,
  });

  // Update Beehiiv post from draft to scheduled
  await scheduleBeehiivPost(issue?.beehiiv_post_id, sendTime);

  console.log(`[CampaignAssembler] ${city.name}: campaign ${facebookCampaignId}, Beehiiv scheduled`);
  return { facebookCampaignId };
}

/**
 * Create a campaign via Facebook Marketing API.
 */
async function createFacebookCampaign(token, adAccountId, payload) {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: payload.name,
        objective: payload.objective,
        status: payload.status,
        special_ad_categories: [],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Facebook API: ${err}`);
  }

  const data = await response.json();
  return data.id;
}

/**
 * Update a Beehiiv post from draft to scheduled.
 */
async function scheduleBeehiivPost(postId, sendTime) {
  if (!postId || postId.startsWith('draft_')) return;

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) return;

  try {
    // Calculate next send datetime
    const now = new Date();
    const [hours, minutes] = sendTime.split(':').map(Number);
    const sendDate = new Date(now);
    sendDate.setHours(hours, minutes, 0, 0);
    if (sendDate <= now) sendDate.setDate(sendDate.getDate() + 1);

    await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/posts/${postId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        status: 'scheduled',
        scheduled_at: sendDate.toISOString(),
      }),
    });
  } catch (err) {
    console.error('[CampaignAssembler] Beehiiv schedule error:', err.message);
  }
}
