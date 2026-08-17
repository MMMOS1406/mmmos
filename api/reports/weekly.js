// MMM OS v12.2 Task 3 — Weekly Report Generator
// GET  /api/reports/weekly          → return latest stored report
// GET  /api/reports/weekly?gen=1    → force-generate new report
// POST /api/reports/weekly          → force-generate (used by Vercel cron)
//
// SQL migration (run once in Supabase SQL editor):
// ─────────────────────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS system_reports (
//   id            BIGSERIAL PRIMARY KEY,
//   report_type   TEXT        NOT NULL DEFAULT 'weekly',
//   week_start    DATE,
//   generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
//   data          JSONB       NOT NULL
// );
// CREATE INDEX IF NOT EXISTS idx_sysreports_generated ON system_reports(generated_at DESC);
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Channel ID → display name
const CHANNEL_NAME = {
  'UCCUa5BLzGh2eRBoqqWBCK_g': 'SRV — Silk Road Voices',
  'UC0nzWQX6AaUqlF5FozNpWPg': 'SRV Studio English',
  'UC41nsMBfVJCqj4vJRLktZTQ': 'NextWave Systems',
  'UCs3bHOHKiHLPg_zdVcd8_gQ': 'AI Creation Studio',
};

// Engine name → channel display name (for package grouping)
const ENGINE_TO_CHANNEL = {
  'SRV Farsi':          'SRV — Silk Road Voices',
  'SRV — Silk Road Voices': 'SRV — Silk Road Voices',
  'SRV English':        'SRV Studio English',
  'SRV Studio English': 'SRV Studio English',
  'NextWave':           'NextWave Systems',
  'NextWave Systems':   'NextWave Systems',
  'AI Studio':          'AI Creation Studio',
  'AI Creation Studio': 'AI Creation Studio',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  return res.ok;
}

async function generateReport() {
  const now = new Date();
  const weekAgoISO = new Date(now - 7 * 86400000).toISOString();
  const weekStart = weekAgoISO.slice(0, 10);
  const weekEnd = now.toISOString().slice(0, 10);

  // ── 1. Fetch all channel data ──
  const channels = await sbGet('youtube_channels?select=channel_id,title,subscribers,total_views,total_videos') || [];

  // ── 2. This week's videos ──
  const weeklyVideos = await sbGet(
    `youtube_videos?published_at=gte.${weekAgoISO}&select=channel_id,video_id,published_at,view_count&order=published_at.desc&limit=200`
  ) || [];

  // ── 3. Last known upload per channel (for stalled detection) ──
  const recentVideos = await sbGet(
    `youtube_videos?select=channel_id,published_at&order=published_at.desc&limit=100`
  ) || [];
  const lastUploadPerChannel = {};
  for (const v of recentVideos) {
    if (!lastUploadPerChannel[v.channel_id]) lastUploadPerChannel[v.channel_id] = v.published_at;
  }

  // ── 4. Packages produced this week ──
  const weeklyPkgRows = await sbGet(
    `packages?generated_at=gte.${weekAgoISO}&select=full_package,performance_status&limit=100`
  ) || [];
  const weeklyPkgs = weeklyPkgRows.map(r => {
    try { return JSON.parse(r.full_package); } catch { return null; }
  }).filter(Boolean);

  // ── 5. Previous report (for deltas) ──
  const prevReports = await sbGet(
    `system_reports?report_type=eq.weekly&order=generated_at.desc&limit=2&select=data,generated_at`
  ) || [];
  // Use the second-most-recent if latest is from today (otherwise it IS the previous one)
  const prevReport = prevReports.find(r =>
    new Date(r.generated_at).toISOString().slice(0, 10) !== weekEnd
  );
  const prevEngineMap = {};
  if (prevReport?.data?.engines) {
    for (const e of prevReport.data.engines) prevEngineMap[e.name] = e;
  }

  // ── 6. Build per-engine metrics ──
  const engines = [];
  for (const ch of channels) {
    const channelName = CHANNEL_NAME[ch.channel_id] || ch.title;
    const chVideosThisWeek = weeklyVideos.filter(v => v.channel_id === ch.channel_id);
    const uploadsThisWeek = chVideosThisWeek.length;

    // Upload consistency: unique days with at least one upload
    const uploadDays = new Set(chVideosThisWeek.map(v => v.published_at?.slice(0, 10))).size;
    const uploadConsistency = Math.round(uploadDays / 7 * 100); // % of week days with upload

    // Views this week (sum of view_count on videos published this week)
    const weeklyViews = chVideosThisWeek.reduce((s, v) => s + (v.view_count || 0), 0);

    // Deltas vs previous report
    const prev = prevEngineMap[channelName];
    const subscriberDelta = prev ? (ch.subscribers || 0) - (prev.subscribers || 0) : null;
    const viewsDelta = prev ? (ch.total_views || 0) - (prev.totalViews || 0) : null;

    // Avg views per upload this week
    const avgViewsPerUpload = uploadsThisWeek
      ? Math.round(weeklyViews / uploadsThisWeek)
      : null;

    // Last upload date and days-since
    const lastUpload = lastUploadPerChannel[ch.channel_id] || null;
    const daysSinceUpload = lastUpload
      ? Math.floor((now - new Date(lastUpload)) / 86400000)
      : 999;

    // Engine status classification
    let status = 'active';
    if (daysSinceUpload > 14) status = 'stalled';
    else if (uploadsThisWeek === 0) status = 'idle';
    else if (uploadsThisWeek >= 2) status = 'performing';

    // Packages produced by this engine this week
    const packagesProduced = weeklyPkgs.filter(p => ENGINE_TO_CHANNEL[p.engine] === channelName).length;

    // Growth score: 0–100
    const growthScore = Math.min(100,
      uploadsThisWeek * 15 +
      (subscriberDelta > 0 ? Math.min(25, subscriberDelta * 2) : 0) +
      (viewsDelta > 0 ? Math.min(25, Math.log10(viewsDelta + 1) * 8) : 0) +
      (packagesProduced * 10)
    );

    engines.push({
      name: channelName,
      channelId: ch.channel_id,
      subscribers: ch.subscribers || 0,
      totalViews: ch.total_views || 0,
      totalVideos: ch.total_videos || 0,
      uploadsThisWeek,
      weeklyViews,
      avgViewsPerUpload,
      uploadConsistency,
      daysSinceUpload,
      packagesProduced,
      subscriberDelta,
      viewsDelta,
      growthScore: Math.round(growthScore),
      status,
    });
  }

  // Sort by growth score descending for ranking
  engines.sort((a, b) => b.growthScore - a.growthScore);

  // ── 7. Totals ──
  const totals = {
    weeklyViews: engines.reduce((s, e) => s + e.weeklyViews, 0),
    weeklyUploads: engines.reduce((s, e) => s + e.uploadsThisWeek, 0),
    packagesProduced: weeklyPkgs.length,
    subscriberNet: engines.reduce((s, e) => s + (e.subscriberDelta || 0), 0),
  };

  // ── 8. Rankings ──
  const ranked = [...engines].sort((a, b) => b.growthScore - a.growthScore);
  const rankings = {
    topEngine: ranked[0]?.name || null,
    bottomEngine: ranked[ranked.length - 1]?.name || null,
    mostUploads: [...engines].sort((a, b) => b.uploadsThisWeek - a.uploadsThisWeek)[0]?.name || null,
    mostPackages: [...engines].sort((a, b) => b.packagesProduced - a.packagesProduced)[0]?.name || null,
  };

  // ── 9. Warnings ──
  const warnings = [];
  for (const e of engines) {
    if (e.status === 'stalled') {
      warnings.push({ level: 'critical', engine: e.name, message: `No uploads in ${e.daysSinceUpload} days` });
    } else if (e.status === 'idle') {
      warnings.push({ level: 'warning', engine: e.name, message: '0 uploads this week' });
    }
    if (e.subscriberDelta !== null && e.subscriberDelta < -5) {
      warnings.push({ level: 'warning', engine: e.name, message: `Lost ${Math.abs(e.subscriberDelta)} subscribers` });
    }
  }

  // ── 10. Machine health score ──
  const activeEngines = engines.filter(e => e.uploadsThisWeek > 0).length;
  const stalledCount = engines.filter(e => e.status === 'stalled').length;
  const criticalCount = warnings.filter(w => w.level === 'critical').length;
  const warnCount = warnings.filter(w => w.level === 'warning').length;
  const machineHealth = Math.max(0, Math.min(100,
    40 + (activeEngines * 15) - (stalledCount * 20) - (criticalCount * 5) - (warnCount * 3)
  ));

  const report = {
    weekStart,
    weekEnd,
    generatedAt: now.toISOString(),
    engines,
    rankings,
    totals,
    warnings,
    machineHealth,
  };

  // ── 11. Store report ──
  await sbInsert('system_reports', {
    report_type: 'weekly',
    week_start: weekStart,
    generated_at: now.toISOString(),
    data: report,
  });

  console.log(`[v12.2] Weekly report generated — health:${machineHealth} engines:${engines.length} warnings:${warnings.length}`);
  return report;
}

// ── Short-Form Intelligence ───────────────────────────────────────────────────
async function generateShortFormIntelligence() {
  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 86400000).toISOString();
  const twelveWeeksAgo = new Date(now - 84 * 86400000).toISOString();

  const [ytRaw, ttRaw] = await Promise.all([
    sbGet(`youtube_videos?published_at=gte.${ninetyDaysAgo}&select=video_id,channel_id,title,published_at,view_count,like_count,comment_count&order=published_at.desc&limit=500`),
    sbGet(`tiktok_videos?published_at=gte.${ninetyDaysAgo}&select=video_id,open_id,title,published_at,view_count,like_count,comment_count,share_count&order=published_at.desc&limit=500`),
  ]);
  const ytVideos = ytRaw || [];
  const ttVideos = ttRaw || [];

  const engScore = (v, platform) =>
    (v.view_count || 0) +
    (v.like_count  || 0) * 8 +
    (v.comment_count || 0) * 25 +
    (platform === 'TikTok' ? (v.share_count || 0) * 15 : 0);

  const ytAll = ytVideos.map(v => ({
    ...v,
    platform: 'YouTube',
    channel: CHANNEL_NAME[v.channel_id] || v.channel_id || 'YouTube',
    score: engScore(v, 'YouTube'),
  }));
  const ttAll = ttVideos.map(v => ({
    ...v,
    platform: 'TikTok',
    channel: 'TikTok',
    score: engScore(v, 'TikTok'),
  }));
  const allVideos = [...ytAll, ...ttAll];

  // 1. Strongest Platform
  const ytAvgViews  = ytAll.length ? Math.round(ytAll.reduce((s,v) => s+(v.view_count||0),0) / ytAll.length) : 0;
  const ttAvgViews  = ttAll.length ? Math.round(ttAll.reduce((s,v) => s+(v.view_count||0),0) / ttAll.length) : 0;
  const ytAvgScore  = ytAll.length ? ytAll.reduce((s,v) => s+v.score,0) / ytAll.length : 0;
  const ttAvgScore  = ttAll.length ? ttAll.reduce((s,v) => s+v.score,0) / ttAll.length : 0;
  const platformWinner = !ytAll.length && !ttAll.length ? 'No data'
    : !ttAll.length ? 'YouTube' : !ytAll.length ? 'TikTok'
    : ytAvgScore > ttAvgScore * 1.1 ? 'YouTube'
    : ttAvgScore > ytAvgScore * 1.1 ? 'TikTok' : 'Equal';

  const strongestPlatform = {
    winner: platformWinner,
    youtube: { avgViews: ytAvgViews, totalVideos: ytAll.length, totalViews: ytAll.reduce((s,v)=>s+(v.view_count||0),0), avgScore: Math.round(ytAvgScore) },
    tiktok:  { avgViews: ttAvgViews, totalVideos: ttAll.length, totalViews: ttAll.reduce((s,v)=>s+(v.view_count||0),0), avgScore: Math.round(ttAvgScore) },
  };

  // 2. Top Performing Hooks (top 10 by views)
  const topHooks = allVideos
    .filter(v => (v.view_count || 0) > 0 && v.title)
    .sort((a, b) => (b.view_count||0) - (a.view_count||0))
    .slice(0, 10)
    .map(v => ({
      platform: v.platform,
      channel:  v.channel,
      title:    v.title,
      views:    v.view_count  || 0,
      likes:    v.like_count  || 0,
      comments: v.comment_count || 0,
      publishedAt: v.published_at,
    }));

  // 3. Best Upload Times (by UTC hour, min 2 uploads in bucket)
  const hourBuckets = {};
  for (const v of allVideos) {
    if (!v.published_at || !(v.view_count > 0)) continue;
    const h = new Date(v.published_at).getUTCHours();
    if (!hourBuckets[h]) hourBuckets[h] = { views: 0, count: 0 };
    hourBuckets[h].views += v.view_count;
    hourBuckets[h].count++;
  }
  const bestUploadTimes = Object.entries(hourBuckets)
    .filter(([, d]) => d.count >= 2)
    .map(([h, d]) => ({ hour: +h, avgViews: Math.round(d.views / d.count), uploads: d.count }))
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 5);

  // 4. Cross-Platform Winners — weeks with both platforms active, top video from each
  const ytWeekSet = new Set(ytAll.map(v => v.published_at?.slice(0, 7)).filter(Boolean));
  const ttWeekSet = new Set(ttAll.map(v => v.published_at?.slice(0, 7)).filter(Boolean));
  const sharedWeeks = [...ytWeekSet].filter(w => ttWeekSet.has(w)).sort().reverse().slice(0, 5);
  const crossPlatformWinners = sharedWeeks.map(week => {
    const ytBest = ytAll.filter(v => v.published_at?.startsWith(week)).sort((a,b)=>(b.view_count||0)-(a.view_count||0))[0];
    const ttBest = ttAll.filter(v => v.published_at?.startsWith(week)).sort((a,b)=>(b.view_count||0)-(a.view_count||0))[0];
    return {
      week,
      youtube: ytBest ? { title: ytBest.title, views: ytBest.view_count||0, channel: ytBest.channel } : null,
      tiktok:  ttBest ? { title: ttBest.title, views: ttBest.view_count||0 } : null,
    };
  }).filter(w => w.youtube || w.tiktok);

  // 5. Viral Velocity — views per day since upload, top 10
  const viralVelocity = allVideos
    .filter(v => (v.view_count || 0) > 0 && v.published_at)
    .map(v => {
      const days = Math.max(1, (now - new Date(v.published_at)) / 86400000);
      return { platform: v.platform, channel: v.channel, title: v.title || '', views: v.view_count||0, viewsPerDay: Math.round((v.view_count||0) / days), publishedAt: v.published_at };
    })
    .sort((a, b) => b.viewsPerDay - a.viewsPerDay)
    .slice(0, 10);

  // 6. Upload Consistency — 12-week rolling window
  const consistencyWeeks = [];
  for (let i = 11; i >= 0; i--) {
    const wStart = new Date(now - (i + 1) * 7 * 86400000).toISOString();
    const wEnd   = new Date(now - i       * 7 * 86400000).toISOString();
    const yt = ytVideos.filter(v => v.published_at >= wStart && v.published_at < wEnd).length;
    const tt = ttVideos.filter(v => v.published_at >= wStart && v.published_at < wEnd).length;
    consistencyWeeks.push({ weekOf: wStart.slice(0, 10), youtube: yt, tiktok: tt, total: yt + tt });
  }
  const ytAvgPerWeek = +(consistencyWeeks.reduce((s,w) => s+w.youtube,0) / 12).toFixed(1);
  const ttAvgPerWeek = +(consistencyWeeks.reduce((s,w) => s+w.tiktok, 0) / 12).toFixed(1);
  let ytStreak = 0; for (let i = 11; i >= 0; i--) { if (consistencyWeeks[i].youtube > 0) ytStreak++; else break; }
  let ttStreak = 0; for (let i = 11; i >= 0; i--) { if (consistencyWeeks[i].tiktok  > 0) ttStreak++; else break; }

  // 7. Engagement Ranking — top 20 by score
  const engagementRanking = allVideos
    .filter(v => v.score > 0 && v.title)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((v, i) => ({
      rank: i + 1,
      platform: v.platform,
      channel:  v.channel,
      title:    v.title,
      views:    v.view_count    || 0,
      likes:    v.like_count    || 0,
      comments: v.comment_count || 0,
      score:    v.score,
      publishedAt: v.published_at,
    }));

  console.log(`[v12.3] SFI generated — yt:${ytAll.length} tt:${ttAll.length} videos`);
  return {
    generatedAt: now.toISOString(),
    dataRange: '90 days',
    totalVideos: allVideos.length,
    strongestPlatform,
    topHooks,
    bestUploadTimes,
    crossPlatformWinners,
    viralVelocity,
    uploadConsistency: { weeks: consistencyWeeks, ytAvgPerWeek, ttAvgPerWeek, ytStreak, ttStreak },
    engagementRanking,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  // Short-Form Intelligence route
  if (req.method === 'GET' && req.query?.type === 'shortform') {
    try {
      const data = await generateShortFormIntelligence();
      return res.status(200).json(data);
    } catch (err) {
      console.error('[v12.3] SFI error:', err.message);
      return res.status(500).json({ error: 'sfi_failed', message: err.message });
    }
  }

  try {
    const forceGenerate = req.method === 'POST' || req.query?.gen === '1';

    if (!forceGenerate) {
      // Return latest stored report
      const stored = await sbGet(
        'system_reports?report_type=eq.weekly&order=generated_at.desc&limit=1&select=data,generated_at'
      );
      if (stored?.length) {
        return res.status(200).json({ report: stored[0].data, cached: true, generatedAt: stored[0].generated_at });
      }
      // No stored report — fall through to generate
    }

    const report = await generateReport();
    return res.status(200).json({ report, cached: false, generatedAt: report.generatedAt });

  } catch (err) {
    console.error('[v12.2] Weekly report error:', err.message);
    return res.status(500).json({ error: 'report_failed', message: err.message });
  }
}
