import fs from 'node:fs';
import path from 'node:path';
import { makeFixture } from '../../preservation/fixtures.mjs';
import { makeSong } from './make-songs.mjs';
import { createStubMixApi } from './stub-mix-api.mjs';
// Synthetic fixtures for the app-level preview (every value invented): SRV Farsi with 12 published Longs, SRV English with 5 Longs whose titles are hidden by their Shorts.
const titles = JSON.parse(fs.readFileSync(new URL('./sample-titles.json', import.meta.url), 'utf8'));
const T = (id, engine, name, extra) => Object.assign({ id, engine, name, status: 'assigned', isoDate: '2026-10-06', day: 'Tuesday', createdAt: 1790000000000 + id, channel: '', platform: 'All', srvTaskUid: (engine === 'SRV Farsi' ? 'srvf_' : 'srve_') + id }, extra);
export const SONG_SECS = [125, 130, 200, 203, 206, 209, 212, 215, 218, 221, 224, 227];     // songs 0-1 are a quick pair (a 2-song Mix of ~4:09 builds in about 4 minutes); the rest are normal length
// The synthetic test songs live in <songsDir>/song-N.wav (generated once). Every Long's audio is served from /media/song-N.wav by the stub.
export function ensureSongs(songsDir) { fs.mkdirSync(songsDir, { recursive: true }); SONG_SECS.forEach((sec, i) => { const f = path.join(songsDir, `song-${i}.wav`); if (!fs.existsSync(f)) fs.writeFileSync(f, makeSong(i, sec)); }); return songsDir; }
export function farsiFx({ songsDir = null } = {}) {
  const fx = makeFixture(); fx.restFilter = true; const st = JSON.parse(fx.settings.mmm_finance_v118);
  st.tasks.push(T(901, 'SRV Farsi', 'SRV Farsi — Female — Romantic · Short', { mood: 'Female — Romantic', mode: 'Female — Romantic', contentType: 'Short Video', contentFormat: 'short', isLong: false })); fx.settings.mmm_finance_v118 = JSON.stringify(st);
  const arts = ['Female', 'Male', 'Duet', 'Female', 'Female', 'Male', 'Duet', 'Female', 'Female', 'Male', 'Female', 'Duet']; const lst = (Array.isArray(titles) ? titles : titles.titles || []).map((x) => (typeof x === 'string' ? { fa: x } : x));
  fx.tables.packages = arts.map((a, i) => { const id = 'pkg_M' + i, yt = 'VIDmix' + String(i).padStart(5, '0'); const t = lst[i] || {}; return { package_id: id, engine: 'SRV Farsi', youtube_video_id: yt, generated_at: '2026-10-' + String(10 + i).padStart(2, '0') + 'T10:00:00Z', full_package: JSON.stringify({ id, engine: 'SRV Farsi', title: t.fa || t.title || 'آهنگ ' + (i + 1), ...(i === 3 ? {} : { titleFinglish: t.finglish || t.latin || '' }), artist: a, mood: a + ' — Romantic', contentType: 'LongScript', contentFormat: 'long', isTest: false, _srvLongVideoUrl: '/media/song-' + i + '.wav', _srvAudioUrl: '/media/song-' + i + '.wav', _srvYtLongId: yt, _srvLongDurationSec: SONG_SECS[i], srvPublish: { privacyStatus: 'public' }, _srvAvatarChoice: { id: a.toLowerCase() + '_0' + (1 + (i % 5)), artist: a.toLowerCase() }, generatedAt: '2026-10-' + String(10 + i).padStart(2, '0') + 'T10:00:00Z' }) }; });
  fx.tables.youtube_channels = []; fx.tables.youtube_videos_analytics = []; fx.persistTableWrites = true; if (songsDir) fx.mediaDir = ensureSongs(songsDir);
  const pk = fx.tables.packages.map((r) => JSON.parse(r.full_package)); fx.__mix = createStubMixApi({ publicVideos: pk.map((p) => p._srvYtLongId), packages: () => pk, enabled: true }); fx.api.srv_farsi_mix = fx.__mix.api;   // the Mix upload runs the REAL server policy against an in-memory YouTube
  return fx;
}
export function engFx() {
  const fx = makeFixture(); fx.restFilter = true; const st = JSON.parse(fx.settings.mmm_finance_v118);
  st.tasks = st.tasks.filter((t) => !(t.engine === 'SRV English' && /\bMale\b/.test(t.name || '')));   // the shared test fixture holds one synthetic "SRV English — Male · Short" row — it is not production data and is not shown in the preview
  st.tasks.push(T(801, 'SRV English', 'SRV English — Female — Emotional · Long (auto-created)', { mood: 'Female — Emotional', mode: 'Female — Emotional', contentType: 'Long', contentFormat: 'long', isLong: true })); fx.settings.mmm_finance_v118 = JSON.stringify(st);
  const gen = (d) => '2026-10-' + String(d).padStart(2, '0') + 'T10:00:00Z'; const names = ['Gone Before Goodbye', 'You Never Saw Me Break', 'The Day I Stopped Waiting', 'Quiet Hours', 'Last Light On'];
  const longs = names.map((t, i) => ({ package_id: 'pkg_L' + i, engine: 'SRV English', generated_at: gen(10 + i), full_package: JSON.stringify({ id: 'pkg_L' + i, engine: 'SRV English', title: t, contentFormat: 'long', _srvLongVideoUrl: '/assets/x' + i + '.webm', _srvAudioUrl: i % 2 ? '' : '/assets/a.mp3', srvRender: { width: 1920, height: 1080, durationSec: 190 + i * 7, audioDurationSec: 190 + i * 7 }, generatedAt: gen(10 + i), _srvYtLongId: 'VID000000' + (10 + i) }) }));
  const shorts = longs.slice(0, 4).map((l, i) => ({ package_id: 'pkg_S' + i, engine: 'SRV English', generated_at: gen(20 + i), full_package: JSON.stringify({ id: 'pkg_S' + i, engine: 'SRV English', title: JSON.parse(l.full_package).title, contentFormat: 'short', srvShortOf: { longPkgId: 'pkg_L' + i }, generatedAt: gen(20 + i) }) }));
  fx.tables.packages = shorts.concat(longs); fx.tables.youtube_channels = []; fx.tables.youtube_videos_analytics = []; return fx;
}
