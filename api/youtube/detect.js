// MMM OS v12.2 — Upload Detection Engine
// GET /api/youtube/detect
// Scans packages and auto-advances their lifecycle:
//   uploaded (no video_id)        → title-match youtube_videos → published
//   published / performing / stalled (has video_id) → refresh view count → reclassify

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tldcwvtwjypmwynsklsd.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Performance thresholds
const PERF_MIN_DAYS = 7;          // must be live this long before classifying
const PERFORMING_VPD = 20;        // views/day ≥ this → performing
const STALLED_VPD = 5;            // views/day < this (after PERF_MIN_DAYS) → stalled

// Engine name → YouTube channel ID (keep in sync with link.js)
const ENGINE_CHANNEL = {
  'SRV Farsi':             'UCCUa5BLzGh2eRBoqqWBCK_g',
  'SRV — Silk Road Voices':'UCCUa5BLzGh2eRBoqqWBCK_g',
  'SRV English':           'UC0nzWQX6AaUqlF5FozNpWPg',
  'SRV Studio English':    'UC0nzWQX6AaUqlF5FozNpWPg',
  'NextWave':              'UC41nsMBfVJCqj4vJRLktZTQ',
  'NextWave Systems':      'UC41nsMBfVJCqj4vJRLktZTQ',
  'AI Studio':             'UCs3bHOHKiHLPg_zdVcd8_gQ',
  'AI Creation Studio':    'UCs3bHOHKiHLPg_zdVcd8_gQ',
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

async function sbPatch(table, filter, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  return { ok: res.ok, status: res.status };
}

async function findMatchingVideo(channelId, title) {
  const exact = await sbGet(
    `youtube_videos?channel_id=eq.${channelId}&title=ilike.${encodeURIComponent(title)}&order=published_at.desc&limit=1`
  );
  if (exact?.length) return { video: exact[0], matchType: 'exact' };

  const keywords = title.split(/\s+/).filter(w => w.length > 3).slice(0, 3).join(' ');
  if (!keywords) return null;

  const fuzzy = await sbGet(
    `youtube_videos?channel_id=eq.${channelId}&title=ilike.*${encodeURIComponent(keywords)}*&order=published_at.desc&limit=5`
  );
  if (fuzzy?.length) return { video: fuzzy[0], matchType: 'fuzzy' };
  return null;
}

// ── TikTok title match (merged from packages/sync.js) ────────────────────────

async function findTikTokVideo(title) {
  const exact = await sbGet(
    `tiktok_videos?title=ilike.${encodeURIComponent(title)}&order=create_time.desc&limit=1`
  );
  if (exact?.length) return { video: exact[0], matchType: 'exact' };

  const keywords = title.split(/\s+/).filter(w => w.length > 3).slice(0, 3).join(' ');
  if (!keywords) return null;

  const fuzzy = await sbGet(
    `tiktok_videos?title=ilike.*${encodeURIComponent(keywords)}*&order=create_time.desc&limit=5`
  );
  if (fuzzy?.length) return { video: fuzzy[0], matchType: 'fuzzy' };
  return null;
}

function calcEngagementScore(ytVideo, ttVideo) {
  let score = 0;
  if (ytVideo) {
    score += (ytVideo.view_count    || 0) * 1;
    score += (ytVideo.like_count    || 0) * 8;
    score += (ytVideo.comment_count || 0) * 25;
  }
  if (ttVideo) {
    score += (ttVideo.view_count    || 0) * 1;
    score += (ttVideo.like_count    || 0) * 8;
    score += (ttVideo.comment_count || 0) * 25;
    score += (ttVideo.share_count   || 0) * 15;
  }
  return Math.round(score);
}

async function handlePackagesSync(res) {
  const rows = await sbGet(
    'packages?select=package_id,youtube_video_id,tiktok_video_id,full_package&order=generated_at.desc&limit=200'
  );
  if (!rows?.length) return res.status(200).json({ scanned: 0, linked: 0, results: [] });

  const results = [];
  let linked = 0;

  for (const row of rows) {
    const pkgId = row.package_id;
    if (!pkgId) continue;

    let pkg = {};
    try { pkg = row.full_package ? JSON.parse(row.full_package) : {}; } catch {}

    const title = pkg.title || '';
    if (!title) continue;

    let ttVideoId = row.tiktok_video_id || null;
    let ytVideo = null, ttVideo = null;

    if (row.youtube_video_id) {
      const ytRows = await sbGet(
        `youtube_videos?video_id=eq.${row.youtube_video_id}&select=view_count,like_count,comment_count&limit=1`
      );
      ytVideo = ytRows?.[0] || null;
    }

    if (!ttVideoId) {
      const ttMatch = await findTikTokVideo(title);
      if (ttMatch) {
        ttVideoId = ttMatch.video.video_id;
        ttVideo   = ttMatch.video;
        results.push({ packageId: pkgId, title, action: 'tiktok_linked', matchType: ttMatch.matchType, ttVideoId });
        linked++;
        console.log(`[v12.3] packages/sync: TikTok linked "${title}" → ${ttVideoId} (${ttMatch.matchType})`);
      }
    } else {
      const ttRows = await sbGet(
        `tiktok_videos?video_id=eq.${ttVideoId}&select=view_count,like_count,comment_count,share_count&limit=1`
      );
      ttVideo = ttRows?.[0] || null;
    }

    const hasYT = !!(row.youtube_video_id);
    const hasTT = !!(ttVideoId);
    const crossStatus  = (hasYT && hasTT) ? 'linked' : hasYT ? 'partial' : 'pending';
    const engagementScore = calcEngagementScore(ytVideo, ttVideo);
    const uploadSyncStatus = {
      youtube:   hasYT ? { video_id: row.youtube_video_id, synced_at: new Date().toISOString() } : null,
      tiktok:    hasTT ? { video_id: ttVideoId,           synced_at: new Date().toISOString() } : null,
      instagram: null,
    };

    await sbPatch('packages', `package_id=eq.${pkgId}`, {
      cross_platform_status: crossStatus,
      engagement_score:      engagementScore,
      upload_sync_status:    uploadSyncStatus,
      ...(ttVideoId && !row.tiktok_video_id ? { tiktok_video_id: ttVideoId } : {}),
    });
  }

  console.log(`[v12.3] packages/sync complete — scanned:${rows.length} tiktok_linked:${linked}`);
  return res.status(200).json({ scanned: rows.length, linked, results });
}

function classifyPerformance(viewCount, publishedAt, currentStatus) {
  if (!publishedAt) return currentStatus;
  const daysSince = Math.max(0, (Date.now() - new Date(publishedAt)) / 86400000);
  if (daysSince < PERF_MIN_DAYS) return 'published'; // too new
  const vpd = (viewCount || 0) / daysSince;
  if (vpd >= PERFORMING_VPD) return 'performing';
  if (vpd < STALLED_VPD) return 'stalled';
  return 'published'; // mid-range: leave as published
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Route: /api/packages/sync → cross-platform sync (merged from packages/sync.js)
  if (req.url && req.url.includes('packages')) return handlePackagesSync(res);

  // POST: single-package YouTube link (merged from link.js)
  if (req.method === 'POST') {
    const { packageId, engine, title, fullPackageJson } = req.body || {};
    if (!packageId || !engine || !title) {
      return res.status(400).json({ error: 'packageId, engine, and title are required' });
    }
    const channelId = ENGINE_CHANNEL[engine];
    if (!channelId) {
      return res.status(400).json({ error: `Unknown engine: "${engine}"`, knownEngines: Object.keys(ENGINE_CHANNEL) });
    }
    console.log(`[v12.3] link: pkg=${packageId} engine="${engine}" → channel=${channelId} title="${title}"`);
    const result = await findMatchingVideo(channelId, title);
    if (!result) {
      console.log('[v12.3] No matching video found for:', title);
      return res.status(200).json({ linked: false, message: 'No matching video found — upload first or sync the channel' });
    }
    const { video, matchType } = result;
    console.log(`[v12.3] Match found (${matchType}): ${video.video_id} — "${video.title}"`);
    let updatedFullPackage = null;
    if (fullPackageJson) {
      try {
        const p = JSON.parse(fullPackageJson);
        p.youtube_video_id = video.video_id;
        p.published_at = video.published_at;
        p.performance_status = 'published';
        p.linked_channel = channelId;
        updatedFullPackage = JSON.stringify(p);
      } catch { /* leave null */ }
    }
    const patchPayload = {
      youtube_video_id: video.video_id,
      published_at: video.published_at,
      performance_status: 'published',
      linked_channel: channelId,
      ...(updatedFullPackage ? { full_package: updatedFullPackage } : {}),
    };
    const patch = await sbPatch('packages', `package_id=eq.${packageId}`, patchPayload);
    if (!patch.ok) console.warn(`[v12.3] Package PATCH status ${patch.status}`);
    else console.log('[v12.3] Package row updated ✓');
    return res.status(200).json({
      linked: true,
      matchType,
      video: {
        videoId: video.video_id,
        title: video.title,
        publishedAt: video.published_at,
        viewCount: video.view_count ?? null,
        thumbnailUrl: video.thumbnail_url || '',
      },
      channelId,
      packagePatched: patch.ok,
    });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET or POST only' });

  try {
    // Fetch all packages needing attention
    const rows = await sbGet(
      `packages?performance_status=in.(uploaded,published,performing,stalled)&select=package_id,performance_status,youtube_video_id,published_at,linked_channel,full_package&order=generated_at.desc&limit=100`
    );
    if (!rows || !rows.length) {
      return res.status(200).json({ scanned: 0, linked: 0, reclassified: 0, results: [] });
    }

    const results = [];
    let linked = 0, reclassified = 0;

    for (const row of rows) {
      const pkgId = row.package_id;
      if (!pkgId) continue;

      let pkg = {};
      try { pkg = row.full_package ? JSON.parse(row.full_package) : {}; } catch {}

      const currentStatus = row.performance_status || 'uploaded';
      let updates = null;

      // ── Case 1: uploaded, no video linked yet → try title match ──
      if (currentStatus === 'uploaded' && !row.youtube_video_id) {
        const engine = pkg.engine || '';
        const title = pkg.title || '';
        if (!engine || !title) continue;

        const channelId = ENGINE_CHANNEL[engine];
        if (!channelId) continue;

        const match = await findMatchingVideo(channelId, title);
        if (match) {
          const v = match.video;
          updates = {
            youtube_video_id: v.video_id,
            published_at: v.published_at,
            linked_channel: channelId,
            view_count: v.view_count || 0,
            thumbnail_url: v.thumbnail_url || '',
            performance_status: 'published',
          };
          linked++;
          results.push({ packageId: pkgId, title, action: 'linked', newStatus: 'published', videoId: v.video_id, matchType: match.matchType });
          console.log(`[v12.2] detect: linked "${title}" → ${v.video_id} (${match.matchType})`);
        }
      }

      // ── Case 2: linked package → refresh view count + reclassify ──
      if (!updates && row.youtube_video_id) {
        const videoRow = await sbGet(
          `youtube_videos?video_id=eq.${row.youtube_video_id}&select=view_count,thumbnail_url&limit=1`
        );
        const viewCount = videoRow?.[0]?.view_count || 0;
        const thumbnailUrl = videoRow?.[0]?.thumbnail_url || pkg.thumbnail_url || '';
        const newStatus = classifyPerformance(viewCount, row.published_at, currentStatus);

        if (newStatus !== currentStatus || viewCount !== (pkg.view_count || 0)) {
          updates = { view_count: viewCount, thumbnail_url: thumbnailUrl, performance_status: newStatus };
          if (newStatus !== currentStatus) {
            reclassified++;
            results.push({ packageId: pkgId, title: pkg.title || pkgId, action: 'reclassified', oldStatus: currentStatus, newStatus, viewCount });
            console.log(`[v12.2] detect: "${pkg.title}" ${currentStatus} → ${newStatus} (${viewCount} views)`);
          }
        }
      }

      // ── Persist changes: columns + full_package JSON ──
      if (updates) {
        const updatedPkg = { ...pkg, ...updates };
        const patch = await sbPatch('packages', `package_id=eq.${pkgId}`, {
          ...updates,
          full_package: JSON.stringify(updatedPkg),
        });
        if (!patch.ok) {
          console.warn(`[v12.2] detect: PATCH failed for ${pkgId} (status ${patch.status})`);
        }
      }
    }

    console.log(`[v12.2] detect complete — scanned:${rows.length} linked:${linked} reclassified:${reclassified}`);
    return res.status(200).json({ scanned: rows.length, linked, reclassified, results });

  } catch (err) {
    console.error('[v12.2] detect error:', err.message);
    return res.status(500).json({ error: 'detect_failed', message: err.message });
  }
}
