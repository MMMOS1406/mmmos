// SRV-STUDIO-V2-031 — the SRV Studio-only YouTube playlist permission (CEO-authorized change to the shared OAuth flow).
//
// playlistItems.insert needs youtube, youtube.force-ssl or youtubepartner (YouTube Data API docs). youtube.force-ssl is
// requested — the documented HTTPS-only variant; youtubepartner is for content-owner (CMS) accounts and does not apply.
// It is added ONLY when the reconnect targets SRV Studio, and a token carrying it is stored ONLY for the SRV Studio
// channel. Every other business's OAuth request (scopes, state, prompt) is unchanged byte for byte.
export const SRV_STUDIO_CHANNEL_ID = 'UC0nzWQX6AaUqlF5FozNpWPg';
export const SRV_STUDIO_PLAYLIST_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const SRV_STUDIO_SCOPE_SET = 'srv_studio_playlists';
const SRV_STATE_PREFIX = 'mmm_youtube_auth_srvpl__';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The reconnect is for SRV Studio when the explicit scope set is asked for, or the per-channel target is SRV Studio
// (the existing Integrations "Reconnect" button passes the channel title).
export function srvStudioPlaylistRequested(query) {
  const q = query || {};
  return q.scope_set === SRV_STUDIO_SCOPE_SET || norm(q.channel_target) === 'srvstudio';
}
export function srvStudioScopes(baseScopes) {
  const parts = String(baseScopes).split(' ').filter(Boolean);
  return parts.includes(SRV_STUDIO_PLAYLIST_SCOPE) ? parts.join(' ') : parts.concat(SRV_STUDIO_PLAYLIST_SCOPE).join(' ');
}
export function srvStudioState(channelTarget) {
  return SRV_STATE_PREFIX + Buffer.from(String(channelTarget || 'SRV Studio')).toString('base64url');
}
// → { srvPlaylist:true, channelTarget } for an SRV Studio playlist reconnect state, otherwise null (legacy parsing applies)
export function parseSrvStudioState(state) {
  if (typeof state !== 'string' || !state.startsWith(SRV_STATE_PREFIX)) return null;
  let channelTarget = '';
  try { channelTarget = Buffer.from(state.slice(SRV_STATE_PREFIX.length), 'base64url').toString('utf-8'); } catch (_) { channelTarget = ''; }
  return { srvPlaylist: true, channelTarget: channelTarget || 'SRV Studio' };
}
// A token requested with the playlist scope may be stored only for SRV Studio, identified by Google itself
// (channels?mine=true) — never by the requested target name, never for another channel.
export function srvStudioTokenAllowed(actualChannelId) {
  return actualChannelId === SRV_STUDIO_CHANNEL_ID;
}
