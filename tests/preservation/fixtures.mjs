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
