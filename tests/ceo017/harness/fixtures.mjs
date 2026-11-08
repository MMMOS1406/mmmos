// CEO-008 Phase 0 — synthetic fixtures for the preservation harness.
// Every value is invented. No production data is read, copied or derived here.
// The shapes mirror what the app stores (D.* state, approvals, decisions) so real screens render.

export const FIXED_NOW = Date.UTC(2026, 9, 5, 14, 0, 0); // Mon 2026-10-05 14:00 UTC — the harness freezes the clock here

const task = (id, engine, name, status, isoDate, extra = {}) => ({
  id, engine, name, status, isoDate, day: new Date(isoDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  channel: '', platform: 'All', contentType: '', mood: '', createdAt: FIXED_NOW - 86400000 * 7, autoCreated: false, ...extra,
});

export function makeFixture() {
  const state = {
    tasks: [
      task(1, 'SRV Farsi', 'SRV Farsi — Female · Short (fixture)', 'done', '2026-09-28', { updatedAt: '2026-09-28T15:00:00.000Z' }),
      task(2, 'SRV English', 'SRV English — Female · Short (fixture)', 'done', '2026-09-29', { updatedAt: '2026-09-29T15:00:00.000Z' }),
      task(3, 'NextWave', 'NextWave — Finance · Short (fixture)', 'assigned', '2026-10-05'),
      task(4, 'AI Studio', 'AI Studio — Education · Short (fixture)', 'assigned', '2026-10-06'),
      task(5, 'SRV English', 'SRV English — Male · Short (fixture)', 'assigned', '2026-10-05'),
    ],
    engineState: {}, enginePaused: {}, cadenceAutoCreatedSlots: {}, _publishSlots: {}, commandLog: [],
    srvFarsiLifecycleStages: {}, aiStudioLifecycleStages: {}, snapshots: [
      { date: '2026-09-20T12:00:00.000Z', net: 9000 }, { date: '2026-10-04T12:00:00.000Z', net: 9500 },
    ],
    engineRevenue: { 'AI Studio': { '2026-10': 40 } }, plaidConnected: false,
  };

  const decisions = [
    { id: 'cdp-fixture-1', decision_type: 'content_mix', recommendation_title: '[FIXTURE] Shift fixture engine content mix', analysis_summary: 'Synthetic analysis text for the harness.', authorization_boundary: 'Fixture scoped change.', expected_business_impact: 'Fixture impact.', proposed_exact_change: {} },
    { id: 'cdp-fixture-2', decision_type: 'advisory', recommendation_title: '[FIXTURE] Advisory review item', analysis_summary: 'Synthetic advisory text.', proposed_exact_change: { type: 'advisory' } },
  ];
  const approvals = [
    { id: 'appr-fixture-1', item_type: 'platform_connection', item_id: 'Fixture Engine|instagram', item_title: '[FIXTURE] Fixture Engine — instagram connection authorization', submitted_by: 'engineering_agent', assigned_to: 'admin', status: 'pending', approval_type: 'platform_connection', notes: 'Fixture: create a developer app and supply the id.', created_at: '2026-10-01T10:00:00.000Z' },
    { id: 'appr-fixture-2', item_type: 'content', item_id: 'x', item_title: '[FIXTURE] Generic approval request', submitted_by: 'va', assigned_to: 'admin', status: 'pending', approval_type: 'content', notes: '', created_at: '2026-10-02T10:00:00.000Z' },
  ];

  return {
    settings: {
      mmm_finance_v118: JSON.stringify(state),
      mmm_cdp_overrides: JSON.stringify({}),
    },
    tables: { packages: [], brain_departments: [], brain_people: [], brain_expansion_ideas: [], brain_documents: [] },
    api: {
      cdp_list: { ok: true, decisions },
      list_approvals: { ok: true, approvals, pendingCount: approvals.length },
      get_notifications: { success: true, ok: true, notifications: [] },
      analytics_sync_status: { ok: true, recent: [] },
      platform_connections_matrix: { ok: true, matrix: [] },
      list_tasks: { ok: true, tasks: [] },
      list_pipeline: { ok: true, items: [] },
      list_assets: { ok: true, assets: [] },
      strategy_state: { ok: true, state: null },
      optimization_state: { ok: true, state: null },
      business_brain_list: { ok: true, businesses: [] },
      business_operations_get: { ok: true, businesses: [] },
      get_reliability_metrics: { ok: true, metrics: null },
      operator_recommendations: { ok: true, recommendations: [] },
      __weekly: { ok: true, report: null },
    },
    decisions, approvals,
  };
}

/** CEO-011 — a richer, still entirely synthetic fixture for the human-navigable preview and the screenshots.
 *  Additive: makeFixture() (and therefore the Phase 0 golden baseline) is untouched. Every value is invented. */
export function makePreviewFixture() {
  const f = makeFixture();
  const state = JSON.parse(f.settings.mmm_finance_v118);
  const t = (id, engine, name, status, isoDate, extra = {}) => task(id, engine, name, status, isoDate, extra);
  state.tasks = state.tasks.concat([
    t(11, 'SRV Farsi', 'SRV Farsi — Female · Short (sample)', 'assigned', '2026-10-05', { contentFormat: 'short' }),
    t(12, 'SRV Farsi', 'SRV Farsi — Male · Long (sample)', 'assigned', '2026-10-09', { contentFormat: 'long' }),
    t(13, 'SRV Farsi', 'SRV Farsi — Duet · Short (sample)', 'generating', '2026-10-07', { contentFormat: 'short' }),
    t(14, 'NextWave', 'NextWave — AI / Tech · Short (sample)', 'assigned', '2026-10-06', { contentFormat: 'short' }),
    t(15, 'AI Studio', 'AI Studio — Psychology · Short (sample)', 'assigned', '2026-10-08', { contentFormat: 'short' }),
    t(16, 'SRV English', 'SRV English — Female · Long (sample)', 'done', '2026-10-02', { updatedAt: '2026-10-02T15:00:00.000Z' }),
    t(17, 'NextWave', 'NextWave — Finance · Short (sample)', 'done', '2026-10-01', { updatedAt: '2026-10-01T15:00:00.000Z' }),
    { id: 'ie_2026-10', _taskKind: 'investment_engine_monthly', _taskYM: '2026-10', engine: 'Investment Engine', name: 'Update Investment Engine — 2026-10', mode: 'Monthly Wealth Engine Update', status: 'open', dueDate: '2026-10-01', channel: '', auto: true },
  ]);
  state.engineRevenue = { 'SRV Farsi': { '2026-10': 120 }, 'SRV English': { '2026-10': 35 }, 'AI Studio': { '2026-10': 40 } };
  state.engineState = { 'AI Studio': 'paused' }; state.enginePaused = { 'AI Studio': true };
  state.investmentEngine = { monthly: { '2026-07': { value: 29000, gainLoss: -5400, contribution: 300, recordedAt: '2026-07-31T10:00:00Z' }, '2026-08': { value: 30500, gainLoss: -5100, contribution: 300, recordedAt: '2026-08-31T10:00:00Z' }, '2026-09': { value: 32000, gainLoss: -5200, contribution: 300, recordedAt: '2026-09-30T10:00:00Z' } } };
  f.settings.mmm_finance_v118 = JSON.stringify(state);
  // Sample platform status: three healthy channels and one expired token, so the preview shows a realistic mix of "running" and "needs attention".
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const vids = (n, base) => Array.from({ length: n }, (_, i) => ({ viewCount: base + (n - i) * 15, publishedAt: ago(24 * (i + 1)) }));
  const ch = (title, id, subs, base) => ({ title, channelId: id, subscribers: subs, totalVideos: 80, totalViews: base * 80, uploadsThisWeek: 2, lastSync: ago(2), lastUploadDate: ago(30), recentVideos: vids(6, base), bestVideo: null, avatarUrl: '' });
  f.platform = { '/api/youtube/status': () => ({ ok: true, configured: true, mode: 'live', connected: true,
    channels: [ch('Silk Road Voices', 'UC_SAMPLE_SRV', 1240, 210), ch('SRV Studio', 'UC_SAMPLE_STUDIO', 480, 95), ch('NextWave Systems', 'UC_SAMPLE_NW', 310, 60), ch('AI Creation Studio', 'UC_SAMPLE_AI', 150, 40)],
    syncLogs: [{ channel_id: 'UC_SAMPLE_SRV', status: 'success', synced_at: ago(2) }, { channel_id: 'UC_SAMPLE_STUDIO', status: 'success', synced_at: ago(2) }, { channel_id: 'UC_SAMPLE_AI', status: 'success', synced_at: ago(3) }, { channel_id: 'UC_SAMPLE_NW', status: 'success', synced_at: ago(5) }],
    tokenHealth: [{ channelId: 'UC_SAMPLE_SRV', isExpired: false }, { channelId: 'UC_SAMPLE_STUDIO', isExpired: false }, { channelId: 'UC_SAMPLE_NW', isExpired: true }, { channelId: 'UC_SAMPLE_AI', isExpired: false }] }) };
  const pk = (id, engine, title, d, status, extra = {}) => ({ package_id: id, full_package: JSON.stringify({ id, engine, title, generatedAt: d + 'T10:00:00.000Z', performance_status: status, cost: 1.5, ...extra }), cross_platform_status: null });
  f.tables.packages = [
    pk('pkg-s1', 'SRV Farsi', 'Sample Farsi song package — emotional', '2026-10-02', 'published'), pk('pkg-s2', 'SRV Farsi', 'Sample Farsi song package — romantic', '2026-09-29', 'published'),
    pk('pkg-s3', 'SRV Farsi', 'Sample Farsi song package — happy', '2026-09-25', 'generated'), pk('pkg-e1', 'SRV English', 'Sample English song package', '2026-10-01', 'generated'),
    pk('pkg-n1', 'NextWave', 'Sample NextWave script package', '2026-10-03', 'generated', { nextwaveV2Route: { status: 'ready_for_review' } }),
    pk('pkg-n2', 'NextWave', 'Sample NextWave finance package', '2026-09-30', 'published', { nextwaveV2Route: { status: 'final' } }),
    pk('pkg-a1', 'AI Studio', 'Sample AI Studio script package', '2026-09-27', 'published'),
  ];
  return f;
}

/** CEO-015 — SRV Farsi sample world for the premium-workspace tests and the preview. Additive on top of makePreviewFixture(); every value is invented.
 *  Adds: SRV Farsi tasks across the lifecycle stages (with the immutable identity the app uses), SRV Farsi packages with format / video links / views per day,
 *  a richer YouTube status for the Silk Road Voices channel, stored analytics rows (SRV Farsi and other channels, so isolation can be tested) and the
 *  read-only revenue_dashboard response. */
export function makeFarsiPreviewFixture(nowMs = FIXED_NOW) {
  const f = makePreviewFixture();
  const state = JSON.parse(f.settings.mmm_finance_v118);
  const uid = (t) => `srvf_${t.createdAt}_${t.id}`;
  const mk = (id, name, status, isoDate, extra = {}) => task(id, 'SRV Farsi', name, status, isoDate, { mode: 'Female — Emotional', ...extra });
  const farsi = state.tasks.filter((t) => t.engine === 'SRV Farsi' && t.status !== 'done');
  const extra = [
    mk(18, 'SRV Farsi — Female · Short (sample publish)', 'assigned', '2026-10-06', { contentFormat: 'short', mode: 'Female — Romantic' }),
    mk(19, 'SRV Farsi — Male · Short (sample new)', 'assigned', '2026-10-08', { contentFormat: 'short', mode: 'Male — Happy' }),
  ];
  state.tasks = state.tasks.concat(extra);
  const byId = (id) => state.tasks.find((t) => t.id === id);
  byId(11).mode = 'Female — Emotional'; byId(12).mode = 'Male — Romantic'; byId(13).mode = 'Duet — Happy';
  state.srvFarsiLifecycleStages = { __identityEpoch: FIXED_NOW - 86400000 * 30, [uid(byId(11))]: 'review', [uid(byId(12))]: 'approve', [uid(byId(13))]: 'build', [uid(byId(18))]: 'publish' };
  state.srvFarsiTaskSeq = 4; state.srvFarsiArtistIdx = 3; state.srvFarsiMoodIdx = 1; state.srvFarsiLastScheduledMs = nowMs + 5 * 86400000;
  f.settings.mmm_finance_v118 = JSON.stringify(state);
  const ago = (h) => new Date(nowMs - h * 3600000).toISOString();
  const day = (d) => new Date(nowMs - d * 86400000).toISOString();
  const srvVids = [
    ['sv1', 'Sample Farsi song — Delkhoshi (Long)', 21, 6200, 5100, 25800, 41.2, 14], ['sv2', 'Sample Farsi song — Setareh (Short)', 17, 3100, 2800, 4100, 55.0, 6],
    ['sv3', 'Sample Farsi song — Baran (Short)', 12, 2400, 2100, 3300, 52.4, 5], ['sv4', 'Sample Farsi song — Eshgh (Long)', 9, 1900, 1500, 9400, 38.1, 4],
    ['sv5', 'Sample Farsi song — Khanom (Short)', 5, 800, 720, 900, 49.9, 1], ['sv6', 'Sample Farsi song — Mehrabon (Short)', 2, 150, 130, 160, 47.0, 0],
  ];
  f.tables.youtube_channels = [
    { channel_id: 'UC_SAMPLE_SRV', title: 'Silk Road Voices', mmm_engine: 'SRV Farsi' }, { channel_id: 'UC_SAMPLE_STUDIO', title: 'SRV Studio', mmm_engine: 'SRV English' },
    { channel_id: 'UC_SAMPLE_NW', title: 'NextWave Systems', mmm_engine: 'NextWave' }, { channel_id: 'UC_SAMPLE_AI', title: 'AI Creation Studio', mmm_engine: 'AI Studio' },
  ];
  f.tables.youtube_videos_analytics = [
    ...srvVids.map(([id, title, d, vc, views, wt, ret, subs]) => ({ video_id: id, channel_id: 'UC_SAMPLE_SRV', title, published_at: day(d), view_count: vc, views, watch_time_min: wt, retention_pct: ret, subs_gained: subs, analytics_synced_at: ago(30) })),
    { video_id: 'ev1', channel_id: 'UC_SAMPLE_STUDIO', title: 'Sample English song', published_at: day(6), view_count: 900, views: 700, watch_time_min: 1800, retention_pct: 33, subs_gained: 3, analytics_synced_at: ago(30) },
    { video_id: 'nv1', channel_id: 'UC_SAMPLE_NW', title: 'Sample NextWave short', published_at: day(4), view_count: 400, views: 300, watch_time_min: 500, retention_pct: 28, subs_gained: 1, analytics_synced_at: ago(30) },
  ];
  const chRow = (title, id, subs, base, vids) => ({ title, channelId: id, subscribers: subs, totalVideos: 80, totalViews: base * 80, uploadsThisWeek: 2, lastSync: ago(2), lastUploadDate: day(2), recentVideos: vids, bestVideo: null, avatarUrl: '' });
  const srvRecent = srvVids.slice().reverse().slice(0, 5).map(([id, title, d, vc]) => ({ videoId: id, title, publishedAt: day(d), viewCount: vc, likeCount: 0 }));
  const base = f.platform['/api/youtube/status']();
  base.channels = base.channels.map((c) => (c.channelId === 'UC_SAMPLE_SRV' ? { ...chRow('Silk Road Voices', 'UC_SAMPLE_SRV', 1240, 210, srvRecent), bestVideo: { videoId: 'sv1', title: srvVids[0][1], viewCount: 6200, thumbnailUrl: '' } } : c));
  base.syncLogs = base.syncLogs.map((l, i) => ({ ...l, synced_at: ago(2 + i) }));   // relative to the same clock as the rest of this sample world
  f.platform['/api/youtube/status'] = () => base;
  const row = (title, id, engine, subs, growth, wh, sv, u30, u7) => ({ channelId: id, title, engine, subscribers: subs, subsGrowth30d: growth, watchHours12m: wh, shortsViews90d: sv, uploads30d: u30, uploads7d: u7, progress: { subs: Math.min(100, subs / 10), watchHours: Math.round(wh / 40 * 10) / 10, shortsViews: Math.round(sv / 100000) / 10 }, yppReady: false, etaToYppDays: null, thresholds: { subs: 1000, watchHours12m: 4000, shortsViews90d: 10000000 } });
  f.api.revenue_dashboard = { ok: true, perChannel: [row('Silk Road Voices', 'UC_SAMPLE_SRV', 'SRV Farsi', 1240, 36, 512, 91000, 9, 3), row('SRV Studio', 'UC_SAMPLE_STUDIO', 'SRV English', 480, 12, 120, 20000, 5, 2), row('NextWave Systems', 'UC_SAMPLE_NW', 'NextWave', 310, 8, 60, 9000, 4, 1), row('AI Creation Studio', 'UC_SAMPLE_AI', 'AI Studio', 150, 2, 20, 2000, 2, 0)] };
  const pk = (id, title, d, status, ex = {}) => ({ package_id: id, full_package: JSON.stringify({ id, engine: 'SRV Farsi', title, generatedAt: d + 'T10:00:00.000Z', performance_status: status, cost: 1.5, ...ex }), cross_platform_status: null });
  f.tables.packages = f.tables.packages.concat([
    pk('pkg-f4', 'Sample Farsi song — Delkhoshi (Long)', '2026-09-20', 'performing', { isLong: true, contentFormat: 'long', youtubeVideoId: 'sv1', views_per_day: 295, published_at: day(14) }),
    pk('pkg-f5', 'Sample Farsi song — Setareh', '2026-09-24', 'published', { contentFormat: 'short', youtubeVideoId: 'sv2', views_per_day: 182, published_at: day(10) }),
    pk('pkg-f6', 'Sample Farsi song — Baran', '2026-09-29', 'published', { contentFormat: 'short', youtubeVideoId: 'sv3', views_per_day: 200, published_at: day(5) }),
    pk('pkg-f7', 'Sample Farsi song — Eshgh (Long)', '2026-10-01', 'published', { isLong: true, contentFormat: 'long', youtubeVideoId: 'sv4', views_per_day: 210, published_at: day(3) }),
    pk('pkg-f8', 'Sample Farsi song — pending upload', '2026-10-04', 'uploaded', { contentFormat: 'short' }),
  ]);
  return f;
}
