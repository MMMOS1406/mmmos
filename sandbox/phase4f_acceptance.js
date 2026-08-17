// Phase 4F sandbox fixture — the dedicated Operating Loop acceptance-test
// target. Inert: not referenced by any route, rewrite, dispatcher, or build
// config in this repository. Its sole purpose is to be the one small,
// harmless, clearly-identifiable file a CEO-authorized Engineering Agent
// edits through the Engineering Gateway's isolated persistent workspace, to
// prove real persisted change + trustworthy diff, not business behavior.
const phase4fAcceptanceMarker = {
  note: 'baseline',
  touched: false,
};
module.exports = { phase4fAcceptanceMarker };
