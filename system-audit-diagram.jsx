import { useState } from "react";

const STATUS = {
  GREEN: { bg: "bg-green-100", border: "border-green-500", text: "text-green-800", dot: "bg-green-500", label: "Working" },
  YELLOW: { bg: "bg-yellow-50", border: "border-yellow-400", text: "text-yellow-800", dot: "bg-yellow-400", label: "Issues" },
  RED: { bg: "bg-red-50", border: "border-red-400", text: "text-red-800", dot: "bg-red-500", label: "Not Working" },
  MISSING: { bg: "bg-gray-100", border: "border-dashed border-gray-400", text: "text-gray-500", dot: "bg-gray-400", label: "Missing" },
};

const components = {
  // Layer 1: Data Sources
  city_council: {
    id: "city_council", label: "City Council", subtitle: "Meeting minutes + agendas",
    layer: 1, status: "GREEN",
    detail: "Birmingham (7 meetings), Savannah (1 meeting), Great Bend (2 meetings) — all crawling and producing content. 15 total meetings in DB across all cities.",
    stats: "15 meetings in DB | 3 cities producing",
    connections: ["crawler"],
  },
  school_board: {
    id: "school_board", label: "School Board", subtitle: "Meeting minutes + video",
    layer: 1, status: "MISSING",
    detail: "No school board meetings are being crawled. The crawler agents are built and could handle this source type, but no cities have school board archive_urls configured. This was in the original vision but hasn't been implemented.",
    stats: "0 meetings | 0 cities configured",
    connections: ["crawler"],
  },
  parks_rec: {
    id: "parks_rec", label: "Parks & Rec", subtitle: "Meeting minutes + video",
    layer: 1, status: "MISSING",
    detail: "No parks & rec meetings being crawled. The meeting_type 'parks_rec' exists in the DB schema, and the crawler supports it, but no archive_urls point to parks/rec sources.",
    stats: "0 meetings | schema ready",
    connections: ["crawler"],
  },
  other_sources: {
    id: "other_sources", label: "+ Other Sources", subtitle: "Planning, utilities, housing...",
    layer: 1, status: "YELLOW",
    detail: "Some variety exists — Birmingham has budget, transportation, and public_hearing meetings. But 10 of 13 active cities have no archive_urls, so they produce nothing. Only 3 cities (Birmingham, Savannah, Great Bend) generate any content at all.",
    stats: "10 of 13 cities silent | archive_urls missing",
    connections: ["crawler"],
  },

  // Layer 2: Crawler & Transcription
  crawler: {
    id: "crawler", label: "AI Web Crawler", subtitle: "civic-crawler Edge Function v12",
    layer: 2, status: "GREEN",
    detail: "Fully deployed (v12) with civic portal auto-detection (CivicClerk, Granicus, Legistar, etc.), SHA-256 dedup, robots.txt respect. Mode A (archive_urls) is reliable. Mode B (autonomous) is unreliable. pg_cron runs crawl daily at 6 AM UTC.\n\nKnown issues: Fargo has archive_urls but produces 0 meetings (page structure issue). WAF/IP blocking affects Spokane, Reno (ISS-001).",
    stats: "v12 deployed | pg_cron 6AM UTC daily",
    connections: ["source_verifier", "transcription"],
  },
  transcription: {
    id: "transcription", label: "Transcription", subtitle: "civic-transcribe Edge Function v8",
    layer: 2, status: "YELLOW",
    detail: "Deployed (v8) with HTML text extraction, native Claude PDF support (base64), and AssemblyAI for video. HTML and PDF paths work well.\n\nIssue: 6 meetings stuck in 'queued' status for 57-61 hours across Twin Falls, Medford, Great Bend, Pueblo. The transcriber may not be handling meetings where the parent city lacks archive_urls. pg_cron runs at 8 AM UTC daily.",
    stats: "v8 deployed | 6 meetings stuck queued",
    connections: ["source_verifier"],
  },

  // Layer 2.5: Source Verification
  source_verifier: {
    id: "source_verifier", label: "Source Verifier", subtitle: "Agent 03b — Anti-hallucination guard",
    layer: 2.5, status: "GREEN",
    detail: "Re-fetches source URLs and compares transcript entities (names, dollar amounts, votes) against raw HTML. Flags (not rejects) PDF sources per ISS-007 fix. Critical anti-hallucination guard added after fabricated data was found during testing.\n\n4 meetings source_verified, 4 source_flagged (expected for PDFs). Working as designed.",
    stats: "4 verified | 4 flagged | 0 false rejections",
    connections: ["summarizer"],
  },

  // Layer 3: AI Analysis Pipeline
  summarizer: {
    id: "summarizer", label: "Summarize", subtitle: "Agent 04 (Sonnet) + 04b Context Enricher",
    layer: 3, status: "YELLOW",
    detail: "Generates 2-5 stories per meeting with category, impact score, and votes. Working but with quality issues:\n\n1. context_note field is NULL on all 13 stories — Agent 04b (context enricher) not populating data\n2. Tone is too bureaucratic — reads like government press releases, not newsletter content\n3. Approving thin 'meeting notice' stories with no substance (ISS-005)\n4. Observer recommends: lead with impact, use second person, add 'why it matters'",
    stats: "13 stories generated | context_note: 0/13",
    connections: ["fact_checker", "tone_checker"],
  },
  fact_checker: {
    id: "fact_checker", label: "Fact-Check", subtitle: "Agent 05a (Opus)",
    layer: 3, status: "YELLOW",
    detail: "Exhaustive claim verification against transcript text. Uses Opus model for highest accuracy.\n\nIssue (ISS-008): Too strict on imprecise-but-accurate summaries. Dropped 2 high-value stories (Village Creek Trail $347K, HUD CDBG-DR $3.9M) that were directionally accurate but simplified. 38.5% overall drop rate — some drops are losing the best civic content.",
    stats: "8 approved | 5 dropped | 38.5% drop rate",
    connections: ["verdict"],
  },
  tone_checker: {
    id: "tone_checker", label: "Tone-Check", subtitle: "Agent 05b (Haiku)",
    layer: 3, status: "GREEN",
    detail: "Banned phrase detection and editorial/sensational language flagging using Haiku model. Working correctly — no stories have been flagged for tone issues. Uses the style_config table for banned phrases list.\n\nGlobal banned phrases: 'contentious', 'alarming', 'residents were upset', 'sparked controversy'.",
    stats: "0 tone flags | banned phrases active",
    connections: ["verdict"],
  },
  verdict: {
    id: "verdict", label: "QC Verdict", subtitle: "Agent 06 (Sonnet) → Redis queue",
    layer: 3, status: "GREEN",
    detail: "Combines fact-checker + tone-checker results. Approve/revise/drop with max 2 revision loops. Approved stories pushed to Upstash Redis per-city queues.\n\nWorking correctly — 7 qc_log entries, proper audit trail. Redis queue receives approved stories for newsletter assembly.\n\nNote: Meeting status not being written back to 'story_approved' — same meeting could be re-processed.",
    stats: "7 QC log entries | Redis push working",
    connections: ["newsletter_builder", "story_selector"],
  },

  // Layer 4: Newsletter Output
  newsletter_builder: {
    id: "newsletter_builder", label: "Newsletter Builder", subtitle: "Agent 07 (Sonnet) → Beehiiv draft",
    layer: 4, status: "RED",
    detail: "Agent code written and tested but NEVER SUCCESSFULLY RUN in production. The issues table has 0 rows — no newsletter has ever been assembled or sent.\n\nThe weekly pg_cron job (Monday 3 PM UTC) is configured and active, but the Beehiiv API key may not be set as an Edge Function secret, and there aren't enough approved stories per city (min_stories_for_issue = 3, but Birmingham has 5 approved).\n\nThis is a critical gap — the entire pipeline produces content that goes nowhere.",
    stats: "0 newsletters assembled | 0 issues in DB",
    connections: ["email_send"],
  },
  delivery_schedule: {
    id: "delivery_schedule", label: "Delivery Schedule", subtitle: "pg_cron + civic-orchestrator",
    layer: 4, status: "GREEN",
    detail: "All 4 pg_cron jobs are active and running:\n• civic-nightly-crawl: 6 AM UTC daily\n• civic-nightly-transcribe: 8 AM UTC daily\n• civic-nightly-pipeline: 9:30 AM UTC daily\n• civic-weekly-newsletter: 3 PM UTC Monday\n\nOrchestrator (v2) iterates active cities, calls Edge Functions sequentially with 5-second stagger. All jobs calling civic-orchestrator via net.http_post.",
    stats: "4 pg_cron jobs active | orchestrator v2",
    connections: ["newsletter_builder"],
  },
  email_send: {
    id: "email_send", label: "Email Send", subtitle: "Beehiiv integration",
    layer: 4, status: "RED",
    detail: "Beehiiv publication exists (pub_89b58c84...) but critical configuration is missing:\n\n1. Beehiiv embed URL not set — all 3 landing pages show 'REPLACE_WITH_BEEHIIV_EMBED_URL' placeholder\n2. Paid subscriptions ($4/mo) not enabled — requires Beehiiv Scale plan upgrade\n3. Zero subscribers — no one can sign up\n4. Zero emails sent — newsletter builder hasn't run\n\nThis is the #1 revenue blocker.",
    stats: "0 subscribers | 0 emails sent | embed URL missing",
    connections: ["paid_subscribers"],
  },

  // Layer 5: Revenue Streams
  paid_subscribers: {
    id: "paid_subscribers", label: "Paid Subscribers", subtitle: "$4/month per resident",
    layer: 5, status: "RED",
    detail: "The $4/month subscription model is designed but completely non-functional:\n\n1. Beehiiv Scale plan not upgraded — can't enable paid subscriptions\n2. No embed URL configured — subscribe buttons don't work\n3. Landing pages not deployed to Netlify — not publicly accessible\n4. Zero subscribers, zero revenue\n\nBirmingham landing page zip is ready for Netlify drag-and-drop deploy, but hasn't been deployed.",
    stats: "$0 revenue | 0 subscribers | not deployed",
    connections: ["city_rollout"],
  },
  fb_ads: {
    id: "fb_ads", label: "AI → Facebook Ads", subtitle: "Agents 08-10 → Marketing API",
    layer: 5, status: "RED",
    detail: "All 4 ad-related agents are coded (08-story-selector, 09a-ad-copy, 09b-audience-targeting, 09c-subject-lines, 10-campaign-assembler) but completely non-functional:\n\n1. Facebook Marketing API credentials not configured\n2. Ian needs to complete Facebook identity verification first\n3. 0 ad_campaigns rows in database\n4. Agent 10 will gracefully skip when credentials are missing\n\nThe code is ready — just needs API access.",
    stats: "0 campaigns | API not configured | code ready",
    connections: ["city_rollout"],
  },

  // Layer 6: Growth & Scale
  city_rollout: {
    id: "city_rollout", label: "City-by-City Rollout", subtitle: "14 cities in DB, 3 producing",
    layer: 6, status: "YELLOW",
    detail: "14 cities in database (13 active, 1 deactivated). But only 3 produce any content:\n\n• Birmingham AL — GREEN (7 meetings, 5 approved stories)\n• Savannah GA — YELLOW (1 meeting, 2 approved stories)\n• Great Bend KS — YELLOW (2 meetings, 1 approved story)\n\n10 cities are silent. Key blockers: missing archive_urls (10 cities), WAF/IP blocking (Spokane, Reno), Fargo silent despite having URLs.\n\nOnboarding is zero-friction by design (just INSERT a row), but cities need archive_urls to produce content.",
    stats: "3 of 14 producing | 10 need archive_urls",
    connections: [],
  },
  local_biz_ads: {
    id: "local_biz_ads", label: "Local Biz Ads", subtitle: "Sponsorship revenue layer",
    layer: 6, status: "MISSING",
    detail: "No infrastructure exists for local business advertising/sponsorships. The handoff document mentions it as part of the revenue model ('local advertising/sponsorships placed within each newsletter'), but:\n\n1. No ad placement slots in the newsletter HTML template\n2. No advertiser management system\n3. No pricing or sales process\n4. Handoff doc says 'Ad slots should be sold manually at launch, then systematized'\n\nThis is a future revenue stream — not yet started.",
    stats: "Not started | manual sales at launch",
    connections: [],
  },
  premium_tier: {
    id: "premium_tier", label: "Premium Tier", subtitle: "Deep dives, alerts, priority access",
    layer: 6, status: "MISSING",
    detail: "No premium tier exists. The original architecture envisioned 'deep dives' and 'alerts' as premium features, but nothing has been built:\n\n1. No alert system for breaking civic news\n2. No deep-dive long-form content generation\n3. No tiered subscription pricing in Beehiiv\n4. No differentiated content pipeline\n\nThis is a future growth feature — the base subscription model needs to work first.",
    stats: "Not started | future feature",
    connections: [],
  },

  // Infrastructure (shown separately)
  supabase: {
    id: "supabase", label: "Supabase Postgres", subtitle: "8 tables, pg_cron, Edge Functions",
    layer: "infra", status: "GREEN",
    detail: "Project yfynwejgbyeisharldyk fully operational:\n\n• 8 tables: cities (14 rows), meetings (15), stories (13), issues (0), qc_log (7), ad_campaigns (0), style_config (1), ops_config (8)\n• 6 Edge Functions deployed and active\n• pg_cron extension enabled with 4 active jobs\n• pg_net extension for HTTP calls\n• Migrations 001-004 applied\n• ops_user role configured\n\nAll infrastructure is solid and functioning.",
    stats: "8 tables | 6 edge functions | 4 cron jobs",
    connections: [],
  },
  redis: {
    id: "redis", label: "Upstash Redis", subtitle: "Per-city story queues",
    layer: "infra", status: "GREEN",
    detail: "Upstash Redis instance (present-sturgeon-97144.upstash.io) configured for per-city story queues. Approved stories are pushed to Redis by Agent 06 (Verdict) and consumed by Agent 07 (Newsletter Builder).\n\nWorking correctly — stories are being queued after QC approval.",
    stats: "Connected | queues active",
    connections: [],
  },
  observer: {
    id: "observer", label: "Observer Task", subtitle: "Daily health check → OBSERVER_REPORT.md",
    layer: "infra", status: "GREEN",
    detail: "Cowork scheduled task 'pipeline-issue-review' runs daily. Last ran 2026-04-15. Produces comprehensive reports covering ops health, content quality, growth opportunities, marketing, and tone.\n\nLatest report identified: Beehiiv embed URL blocker, QC calibration problems, 6 stuck meetings, missing archive_urls for 10 cities, tone improvements needed.\n\nRead-only — does not modify system state.",
    stats: "Last run: today | daily at 5 AM",
    connections: [],
  },
};

const layers = [
  { id: 1, label: "1 — DATA SOURCES", color: "text-gray-600" },
  { id: 2, label: "2 — CRAWLER & TRANSCRIPTION", color: "text-indigo-600" },
  { id: 2.5, label: "2.5 — VERIFICATION", color: "text-indigo-600" },
  { id: 3, label: "3 — AI ANALYSIS PIPELINE", color: "text-purple-600" },
  { id: 4, label: "4 — NEWSLETTER OUTPUT", color: "text-orange-600" },
  { id: 5, label: "5 — REVENUE STREAMS", color: "text-emerald-600" },
  { id: 6, label: "6 — GROWTH & SCALE", color: "text-blue-600" },
  { id: "infra", label: "INFRASTRUCTURE", color: "text-gray-600" },
];

const layerComponents = {
  1: ["city_council", "school_board", "parks_rec", "other_sources"],
  2: ["crawler", "transcription"],
  2.5: ["source_verifier"],
  3: ["summarizer", "fact_checker", "tone_checker", "verdict"],
  4: ["newsletter_builder", "delivery_schedule", "email_send"],
  5: ["paid_subscribers", "fb_ads"],
  6: ["city_rollout", "local_biz_ads", "premium_tier"],
  infra: ["supabase", "redis", "observer"],
};

function StatusDot({ status }) {
  const s = STATUS[status];
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.dot} mr-2 flex-shrink-0`} />;
}

function ComponentCard({ comp, isSelected, onClick }) {
  const s = STATUS[comp.status];
  const isMissing = comp.status === "MISSING";
  return (
    <button
      onClick={onClick}
      className={`relative p-3 rounded-lg border-2 ${s.border} ${s.bg} ${isSelected ? "ring-2 ring-blue-500 ring-offset-2" : ""} transition-all hover:shadow-md text-left w-full min-w-0 cursor-pointer`}
      style={isMissing ? { borderStyle: "dashed" } : {}}
    >
      <div className="flex items-start gap-1">
        <StatusDot status={comp.status} />
        <div className="min-w-0">
          <div className={`font-semibold text-sm leading-tight ${s.text}`}>
            {comp.label}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 leading-tight truncate">
            {comp.subtitle}
          </div>
        </div>
      </div>
      {isMissing && (
        <div className="absolute -top-2 -right-2 bg-gray-500 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
          NOT BUILT
        </div>
      )}
    </button>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center py-1">
      <svg width="20" height="20" viewBox="0 0 20 20" className="text-gray-400">
        <path d="M10 4 L10 14 M6 10 L10 14 L14 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function DetailPanel({ comp, onClose }) {
  if (!comp) return null;
  const s = STATUS[comp.status];
  return (
    <div className={`border-2 ${s.border} ${s.bg} rounded-xl p-5 mt-4 relative`}>
      <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer">
        &times;
      </button>
      <div className="flex items-center gap-2 mb-3">
        <StatusDot status={comp.status} />
        <h3 className={`text-lg font-bold ${s.text}`}>{comp.label}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text} border ${s.border}`}>
          {s.label}
        </span>
      </div>
      <p className="text-xs text-gray-500 font-mono mb-3">{comp.subtitle}</p>
      <div className="bg-white bg-opacity-60 rounded-lg p-3 mb-3">
        <p className="text-sm text-gray-500 font-semibold mb-1">Live Stats</p>
        <p className="text-sm text-gray-700 font-mono">{comp.stats}</p>
      </div>
      <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{comp.detail}</div>
    </div>
  );
}

function SummaryBar() {
  const all = Object.values(components);
  const counts = { GREEN: 0, YELLOW: 0, RED: 0, MISSING: 0 };
  all.forEach(c => counts[c.status]++);
  return (
    <div className="flex gap-4 flex-wrap mb-6">
      {Object.entries(counts).map(([status, count]) => (
        <div key={status} className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-sm font-medium text-gray-700">
            {count} {STATUS[status].label}
          </span>
        </div>
      ))}
      <div className="ml-auto text-xs text-gray-400">Audit: April 15, 2026</div>
    </div>
  );
}

function CriticalBlockers() {
  return (
    <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-bold text-red-800 mb-2">Critical Blockers (Revenue = $0)</h3>
      <div className="space-y-1.5 text-sm text-red-700">
        <p>1. <strong>Beehiiv embed URL</strong> — placeholder on all 3 landing pages. Zero subscribers can sign up.</p>
        <p>2. <strong>Landing pages not deployed</strong> — birmingham-netlify-drop.zip sitting locally, not on the web.</p>
        <p>3. <strong>0 newsletters sent</strong> — weekly pipeline hasn't produced an issue despite 8 approved stories.</p>
        <p>4. <strong>Beehiiv paid tier</strong> — Scale plan not upgraded, can't charge $4/mo.</p>
        <p>5. <strong>Facebook API</strong> — identity verification incomplete, 0 ad campaigns possible.</p>
      </div>
    </div>
  );
}

export default function CivicNewsletterAudit() {
  const [selected, setSelected] = useState(null);

  const handleClick = (id) => {
    setSelected(prev => prev === id ? null : id);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 font-sans">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Civic Newsletter System — Live Audit</h1>
        <p className="text-sm text-gray-500">Click any component to see detailed status, live stats, and issues</p>
      </div>

      <SummaryBar />
      <CriticalBlockers />

      <div className="space-y-4">
        {layers.map((layer) => {
          const comps = layerComponents[layer.id] || [];
          return (
            <div key={layer.id}>
              {layer.id !== 1 && <Arrow />}
              <div className={`text-xs font-bold uppercase tracking-wider ${layer.color} mb-2 text-center`}>
                {layer.label}
              </div>
              <div className={`grid gap-3 ${
                comps.length === 4 ? "grid-cols-4" :
                comps.length === 3 ? "grid-cols-3" :
                comps.length === 2 ? "grid-cols-2" :
                "grid-cols-1 max-w-xs mx-auto"
              }`}>
                {comps.map((id) => (
                  <ComponentCard
                    key={id}
                    comp={components[id]}
                    isSelected={selected === id}
                    onClick={() => handleClick(id)}
                  />
                ))}
              </div>
              {comps.some(id => id === selected) && (
                <DetailPanel
                  comp={components[selected]}
                  onClose={() => setSelected(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <h3 className="text-sm font-bold text-gray-700 mb-3">Data Connections</h3>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-semibold text-gray-800 mb-1">Nightly Flow (Agents 1-6)</p>
            <p>Crawler → Transcribe → Source Verify → Summarize → Fact-Check + Tone-Check → Verdict → Redis Queue</p>
            <p className="text-green-600 mt-1 font-medium">pg_cron: 6AM → 8AM → 9:30AM UTC</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-semibold text-gray-800 mb-1">Weekly Flow (Agents 7-10)</p>
            <p>Redis Queue → Newsletter Builder → Beehiiv Draft → Story Select → Ad Copy → FB Campaign</p>
            <p className="text-red-600 mt-1 font-medium">pg_cron: Monday 3PM UTC — NEVER RUN SUCCESSFULLY</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-semibold text-gray-800 mb-1">External Services</p>
            <p>Supabase (DB + Edge Functions) → Upstash Redis → Beehiiv (newsletter) → Facebook Marketing API</p>
            <p className="text-yellow-600 mt-1 font-medium">Beehiiv + Facebook = not configured</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-semibold text-gray-800 mb-1">Monitoring</p>
            <p>Observer Task (daily 5AM) → reads DB + logs → writes OBSERVER_REPORT.md → Ian reviews</p>
            <p className="text-green-600 mt-1 font-medium">Running daily, last report: today</p>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-bold text-blue-800 mb-2">Bottom Line</h3>
        <p className="text-sm text-blue-700">
          The <strong>data pipeline</strong> (crawl → transcribe → verify → summarize → QC) works end-to-end for 3 cities
          and runs autonomously via pg_cron. However, <strong>zero revenue is being generated</strong> because the output
          half of the system (newsletter delivery, subscriber acquisition, paid subscriptions, advertising) is not functional.
          The approved stories go into Redis and stop there. Five Ian-action items (Beehiiv embed URL, Netlify deploy,
          Scale plan, Facebook verification, archive URLs for 10 cities) are the primary blockers.
        </p>
      </div>
    </div>
  );
}