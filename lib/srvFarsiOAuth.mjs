// SRV Farsi — YouTube playlist permission for the Silk Road Voices channel ONLY (CEO/PM decision, 2026-10-24).
//
// Adding a video to a playlist (playlistItems.insert) needs one of youtube, youtube.force-ssl or youtubepartner
// (YouTube Data API docs). youtube.force-ssl — the documented HTTPS-only variant — is requested, and only when the
// reconnect targets Silk Road Voices; a token carrying it is stored only when Google says the consent was for the
// Silk Road Voices channel itself. Every other channel's OAuth request (scopes, state, prompt) is unchanged.
export const SRV_FARSI_CHANNEL_ID = 'UCCUa5BLzGh2eRBoqqWBCK_g';
export const SRV_FARSI_PLAYLIST_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const SRV_FARSI_SCOPE_SET = 'srv_farsi_playlists';
const SRV_FARSI_STATE_PREFIX = 'mmm_youtube_auth_srvfapl__';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The existing Integrations "Reconnect" button passes the channel title ("Silk Road Voices") as channel_target.
export function srvFarsiPlaylistRequested(query) {
  const q = query || {};
  return q.scope_set === SRV_FARSI_SCOPE_SET || norm(q.channel_target) === 'silkroadvoices';
}
export function srvFarsiScopes(baseScopes) {
  const parts = String(baseScopes).split(' ').filter(Boolean);
  return parts.includes(SRV_FARSI_PLAYLIST_SCOPE) ? parts.join(' ') : parts.concat(SRV_FARSI_PLAYLIST_SCOPE).join(' ');
}
export function srvFarsiState(channelTarget) {
  return SRV_FARSI_STATE_PREFIX + Buffer.from(String(channelTarget || 'Silk Road Voices')).toString('base64url');
}
// → { srvFarsiPlaylist:true, channelTarget } for a Silk Road Voices playlist reconnect state, otherwise null
export function parseSrvFarsiState(state) {
  if (typeof state !== 'string' || !state.startsWith(SRV_FARSI_STATE_PREFIX)) return null;
  let channelTarget = '';
  try { channelTarget = Buffer.from(state.slice(SRV_FARSI_STATE_PREFIX.length), 'base64url').toString('utf-8'); } catch (_) { channelTarget = ''; }
  return { srvFarsiPlaylist: true, channelTarget: channelTarget || 'Silk Road Voices' };
}
// Identified by Google itself (channels?mine=true), never by the requested target name.
export function srvFarsiTokenAllowed(actualChannelId) {
  return actualChannelId === SRV_FARSI_CHANNEL_ID;
}
