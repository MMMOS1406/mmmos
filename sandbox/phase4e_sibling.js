// Phase 4E sandbox fixture — the UNAUTHORIZED sibling file used to prove that
// a task's file allowlist is an exact-match allowlist, not a directory-wide
// grant. No Engineering Task in this program authorizes this specific path.
// Inert — not referenced by any route, rewrite, dispatcher, or build config.
function phase4eSiblingPing() {
  return { ok: true, phase: '4E', note: 'unauthorized sibling fixture' };
}
module.exports = { phase4eSiblingPing };
