// SRV Farsi Mix — pure rules (no network, no database, no DOM): eligibility, filters, timeline, validation, title, YouTube chapters/description, lineage, mix key.
// CEO order 2026-11-12 (PREVIEW ONLY — nothing here is wired into production). Isomorphic: the page, the preview and the tests import this file (the page copy under
// public/srv-farsi-mix/lib/ is byte-identical; a test enforces it).
//
// A Mix is a 1920×1080 video of any length the VA chooses (at least two valid songs), made from EXISTING published SRV Farsi Long songs: the songs' original audio and source records are only ever READ, nothing is regenerated.
// Two separate choices: ARTIST CATEGORY (Female / Male / Duet / All Artists) decides which singers are eligible; MOOD (Love Romantic / Love Happy / Love Emotional) is the theme.

export const SRVF_MIX_CONFIG = Object.freeze({
  // CEO correction 2026-11-12: NO fixed minimum runtime. The runtime is whatever the selected songs and transitions add up to (a valid 25–28 minute Mix is accepted, so is any other length the VA chooses).
  // The only ceiling is YouTube's own documented limit of a 12-hour video; there is no artificial maximum.
  platformMaxSec: 12 * 3600,
  longBuildWarnSec: 60 * 60,       // information only: the video is rendered in real time, so a long Mix needs the tab open that long
  minTracks: 2,                    // at least two valid source songs (a chapter list needs at least two entries here)
  crossfadeSec: 6, introFadeSec: 2, outroFadeSec: 6,
  minSongSec: 120,                 // same bar as a Short's source Long (a test-length "Long" is never a Mix song)
  width: 1920, height: 1080, fps: 30,
  minChapterSec: 10,
  titlePrefix: 'Top Persian',      // presentation only: the underlying channel (Silk Road Voices), metadata ownership and business stay SRV Farsi
  monthlyReleases: 4,              // one Female, one Male, one Duet, one All Artists Mix per month
});
export const SRVF_MIX_CATEGORIES = Object.freeze([
  { id: 'female', label: 'Female', artists: ['female'], fa: 'صدای زن' },
  { id: 'male', label: 'Male', artists: ['male'], fa: 'صدای مرد' },
  { id: 'duet', label: 'Duet', artists: ['duet'], fa: 'دونفره' },
  { id: 'all', label: 'All Artists (Female + Male + Duet)', short: 'All Artists', artists: ['female', 'male', 'duet'], fa: '' },
]);
export const SRVF_MIX_MOODS = Object.freeze([
  { id: 'romantic', label: 'Love Romantic', match: 'romantic', fa: 'گلچین آهنگ‌های عاشقانه فارسی' },
  { id: 'happy', label: 'Love Happy', match: 'happy', fa: 'گلچین آهنگ‌های شاد عاشقانه فارسی' },
  { id: 'emotional', label: 'Love Emotional', match: 'emotional', fa: 'گلچین آهنگ‌های احساسی عاشقانه فارسی' },
]);
export const SRVF_MIX_CHANNEL_NAME = 'Silk Road Voices';
export const SRVF_AI_DISCLOSURE = 'Music, vocals and visuals in this video are AI-generated and edited by SRV Farsi.';
const VID = /^[A-Za-z0-9_-]{11}$/;
export const srvfCategory = (id) => SRVF_MIX_CATEGORIES.find((c) => c.id === id) || null;
export const srvfMood = (id) => SRVF_MIX_MOODS.find((m) => m.id === id) || null;

// "Duet — Romantic" → { artist:'duet', mood:'romantic' } (either part may be absent)
export function srvfParseMood(s) {
  const t = String(s || '').toLowerCase();
  const artist = /\bduet\b/.test(t) ? 'duet' : /\bfemale\b/.test(t) ? 'female' : /\bmale\b/.test(t) ? 'male' : '';
  const mood = /romantic/.test(t) ? 'romantic' : /happy/.test(t) ? 'happy' : /emotional/.test(t) ? 'emotional' : '';
  return { artist, mood };
}

// ── eligibility ──
// A published SRV Farsi Long: SRV Farsi only, a built Long video on YouTube, full-length (>= minSongSec, measured not labelled), production (never [TEST]), not a Short,
// not set aside, with a title, a usable audio source and a known cover. `publicVideoIds` (optional) comes from YouTube; without it the package's own privacy marker is used.
// `youtubeDurations` ({ videoId: seconds }, optional) is YouTube's own length of the uploaded Long — the authoritative metadata for a song whose length MMMOS never recorded (older Longs) or recorded implausibly
// (shorter than a song while YouTube holds a full-length video). A length MMMOS did measure and that is plausible is never replaced.
// `taskArtists` ({ srvTaskUid: 'female'|'male'|'duet' }, optional) comes from the SRV Farsi TASK that produced the package (explicit operator / rotation record) — the only other reliable place an artist category is recorded.
// An artist is NEVER guessed: package field, then the mood text, then the linked task; otherwise it stays unknown (reason unknown_artist) and `artistSuggestion` shows what the generation prompt hints at, for a person to confirm.
export function srvfMixCandidates(pkgs, { publicVideoIds = null, unreachable = null, youtubeDurations = null, taskArtists = null } = {}) {
  const pub = publicVideoIds ? new Set(publicVideoIds) : null; const bad = unreachable ? new Set(unreachable) : null; const out = []; const ytd = youtubeDurations || null;
  for (const p of pkgs || []) {
    if (!p || p.engine !== 'SRV Farsi') continue;
    if (p.srvShortOf && p.srvShortOf.longPkgId) continue;                                   // a Short is never a source
    if (p.contentType === 'Short' || p.contentFormat === 'short' || p.farsiMix) continue;   // nor a Short-format package, nor another Mix
    if (!p._srvLongVideoUrl && !p._srvAudioUrl) continue;                                    // not a built Long at all
    const yt = p._srvYtLongId || p.youtubeVideoId || p.youtube_video_id || (p.srvPublish && p.srvPublish.videoId) || null;
    const pkgSec = Number(p._srvLongDurationSec || (p.srvRender && (p.srvRender.audioDurationSec || p.srvRender.durationSec)) || 0); const ySec = ytd && yt && Number.isFinite(Number(ytd[yt])) && Number(ytd[yt]) > 0 ? Number(ytd[yt]) : 0;
    const useYt = ySec > 0 && (!(pkgSec > 0) || (pkgSec < SRVF_MIX_CONFIG.minSongSec && ySec >= SRVF_MIX_CONFIG.minSongSec)); const sec = useYt ? ySec : pkgSec;
    const pm = srvfParseMood(p.mood || p.moodLabel || ''); const pa = (String(p.artist || '').toLowerCase().match(/^(female|male|duet)$/) || [''])[0]; const ta = taskArtists && p.srvTaskUid && /^(female|male|duet)$/.test(String(taskArtists[p.srvTaskUid] || '')) ? taskArtists[p.srvTaskUid] : '';
    const artist = pa || pm.artist || ta || ''; const artistSource = pa ? 'package' : pm.artist ? 'mood' : ta ? 'task' : '';
    let artistSuggestion = '', artistEvidence = ''; if (!artist) { const sp = String(p.sunoPrompt || '').toLowerCase(); const hasF = /\bfemale\b/.test(sp), hasM = /\bmale\b/.test(sp), hasD = /\bduet\b/.test(sp); const ev = (re) => (re.exec(sp) || [''])[0]; if (hasD || (hasF && hasM)) { artistSuggestion = 'duet'; artistEvidence = ev(/[^.,;]{0,25}\b(duet|female and male|male and female)\b[^.,;]{0,25}/); } else if (hasF) { artistSuggestion = 'female'; artistEvidence = ev(/[^.,;]{0,25}\bfemale\b[^.,;]{0,25}/); } else if (hasM) { artistSuggestion = 'male'; artistEvidence = ev(/[^.,;]{0,25}\bmale\b[^.,;]{0,25}/); } artistEvidence = artistEvidence.trim().slice(0, 70); }
    const privacy = (p.srvPublish && p.srvPublish.privacyStatus) || null;
    const srcUrl = p._srvAudioUrl || p._srvLongVideoUrl || null; const title = srvfCleanText(p.title);
    const reason = String(p.srvTaskUid || '').startsWith('set-aside:') ? 'set_aside' : p.isTest ? 'test' : !title ? 'no_title' : !VID.test(String(yt || '')) ? 'not_uploaded'
      : (pub ? !pub.has(yt) : privacy === 'private') ? 'not_public' : !(sec > 0) ? 'unknown_duration' : sec < SRVF_MIX_CONFIG.minSongSec ? 'too_short' : !artist ? 'unknown_artist' : bad && bad.has(String(srcUrl)) ? 'media_unreachable' : null;
    const fgPkg = srvfCleanText(p.titleFinglish); const fgOk = fgPkg && !srvfFinglishCheck(fgPkg);
    out.push({
      pkgId: String(p.id), taskUid: p.srvTaskUid || null, title, finglish: fgOk ? fgPkg : srvfTransliterate(title), finglishAuto: !fgOk, artist, artistSource, ...(artistSuggestion ? { artistSuggestion, artistEvidence } : {}), mood: pm.mood || '',
      durationSec: sec, durationSource: useYt ? 'youtube' : (sec > 0 ? 'package' : 'unknown'), youtubeVideoId: yt, privacy: privacy || (pub ? 'public' : 'unknown'),
      audioSource: p._srvAudioUrl ? 'original-mp3' : 'long-video-aac', sourceUrl: srcUrl,
      cover: (p._srvAvatarChoice && p._srvAvatarChoice.id) ? { id: p._srvAvatarChoice.id, artist: p._srvAvatarChoice.artist || artist } : null,
      generatedAt: p.generatedAt || '', eligible: !reason, reason,
    });
  }
  return out.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
}
// Catalog summary per artist category (what the Mix builder shows and what the server records): published Long packages, how many are eligible, and why the rest are not.
export function srvfCatalogSummary(cands) {
  const mk = () => ({ published: 0, eligible: 0, reasons: {} }); const out = { female: mk(), male: mk(), duet: mk(), unknown: mk(), all: mk() };
  for (const c of cands || []) { if (c.reason === 'test' || c.reason === 'set_aside') continue; const k = out[c.artist] ? c.artist : 'unknown';
    for (const t of (k === 'unknown' ? [k] : [k, 'all'])) { out[t].published++; if (c.eligible) out[t].eligible++; else out[t].reasons[c.reason] = (out[t].reasons[c.reason] || 0) + 1; } }
  return out;
}
// ── source attachment (published YouTube songs that have no MMMOS package/source) ──
// A published song whose original audio MMMOS never kept is "Published — Source Required". An operator can LINK an audio file that already lives in MMMOS storage (or a newly uploaded original) to the YouTube video id — nothing is
// created in the packages table and the published video is never touched. The link is only valid when: the video is on the pinned channel and Public (production), the audio's real decoded length matches YouTube's (±3 s),
// and an artist category is verified (explicit package record, or confirmed by the operator with the evidence shown). A song is never matched to audio by title alone.
export const SRVF_ATTACH_TOLERANCE_SEC = 3;
export function srvfNormTitle(t) { return String(t || '').toLowerCase().replace(/[\u200c\u200d]/g, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[^\p{L}]/gu, ''); }
// The song's own title from a YouTube video title ("Silk Road Voices - X | Persian Deep House | دیدار تو" -> "دیدار تو"; "🌙 آسمان نیمه شب 🌙 آهنگ جدید" -> "آسمان نیمه شب").
export function srvfSongTitleFromYoutube(t) {
  const parts = String(t || '').split('|').map((x) => x.trim()).filter(Boolean); const fa = parts.filter((x) => /[\u0600-\u06FF]/.test(x)); let pick = (fa.length ? fa[fa.length - 1] : parts[0]) || '';
  pick = pick.replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ' ').replace(/(^|\s)(آهنگ|ریمکس|ویدیو|عاشقانه|احساسی|شاد|جدید|دوئت|تک‌?خوان|Persian|Deep House|Love Song|SRV|Silk Road Voices)(?=[\s,،.]|$).*$/u, '').replace(/[^\p{L}\p{M}\p{N}\u200c\s'’-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return pick || String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
// Candidate MMMOS packages for a YouTube-only song, WITH the evidence shown to the operator. Title equality AND a generation→publication window; ambiguity (more than one package, or a package that fits another song as well) is reported, never resolved silently.
export function srvfSourceSuggestions(song, packages, { taskArtists = null, liveIds = null, claimedBy = null } = {}) {
  const nt = srvfNormTitle(srvfSongTitleFromYoutube(song.title)); if (!nt) return [];
  const out = []; for (const p of packages || []) {
    if (!p || p.engine !== 'SRV Farsi' || p.farsiMix || (p.srvShortOf && p.srvShortOf.longPkgId) || p.contentType === 'Short' || p.contentFormat === 'short' || /^Short/.test(String(p.contentType || ''))) continue;
    const yt = p._srvYtLongId || p.youtubeVideoId || p.youtube_video_id || (p.srvPublish && p.srvPublish.videoId) || null; if (yt && liveIds && liveIds.has(yt)) continue;               // already tied to a live channel video
    const pt = srvfNormTitle(String(p.title || '').split('|')[0].replace(/آهنگ.*$/, '')); if (!pt || !(pt === nt || nt.includes(pt) || pt.includes(nt))) continue;
    const lag = Math.round((Date.parse(song.publishedAt) - Date.parse(p.generatedAt)) / 864e5); if (!Number.isFinite(lag) || lag < -1 || lag > 30) continue;
    const pm = srvfParseMood(p.mood || ''); const pa = (String(p.artist || '').toLowerCase().match(/^(female|male|duet)$/) || [''])[0]; const ta = taskArtists && p.srvTaskUid && /^(female|male|duet)$/.test(String(taskArtists[p.srvTaskUid] || '')) ? taskArtists[p.srvTaskUid] : '';
    const artist = pa || pm.artist || ta || ''; const sp = String(p.sunoPrompt || '').toLowerCase(); const hasF = /\bfemale\b/.test(sp), hasM = /\bmale\b/.test(sp), hasD = /\bduet\b/.test(sp);
    out.push({ pkgId: String(p.id), title: srvfCleanText(p.title), generatedAt: p.generatedAt || '', lagDays: lag, deadYoutubeId: yt || null, artist, artistSource: pa ? 'package' : pm.artist ? 'mood' : ta ? 'task' : '', artistSuggestion: artist ? '' : (hasD || (hasF && hasM) ? 'duet' : hasF ? 'female' : hasM ? 'male' : ''), exact: pt === nt, sourceUrl: p._srvLongVideoUrl || p._srvAudioUrl || null, storedLong: p.hasStoredLong ? p.storedLongPath || null : null, recordedSec: Number(p._srvLongDurationSec || 0) || null, markedTest: !!p.isTest });
  }
  // exact title equality wins: containment ("X" inside "X and Y") is only used when nothing is exactly equal, and those suggestions are flagged fuzzy (never automatic, never marked unique)
  const exact = out.filter((x) => x.exact); return exact.length ? exact : out.map((x) => ({ ...x, fuzzy: true }));
}
export function srvfAttachmentCandidate(att, u, { channelId, accepts = ['public'], minSongSec = 120, pkg = null } = {}) {
  const title = srvfCleanText((att && att.title) || (pkg && pkg.title) || srvfSongTitleFromYoutube(u && u.title)) || (u && u.title) || att.youtubeVideoId; const fgPkg = pkg ? srvfCleanText(pkg.titleFinglish) : ''; const fgOk = fgPkg && !srvfFinglishCheck(fgPkg);
  const sec = u && u.durationSec ? Number(u.durationSec) : 0; const artist = /^(female|male|duet)$/.test(String(att && att.artist)) ? att.artist : '';
  const reason = !u ? 'not_found_on_youtube' : u.channelId !== channelId ? 'other_channel' : accepts.indexOf(u.privacyStatus) < 0 ? 'not_public_on_youtube' : !(sec >= minSongSec) ? 'too_short' : !att.sourceUrl ? 'source_required'
    : !(Number(att.measuredSec) > 0) || Math.abs(Number(att.measuredSec) - sec) > SRVF_ATTACH_TOLERANCE_SEC ? 'source_duration_mismatch' : !artist ? 'unknown_artist' : null;
  return { pkgId: 'src_' + att.youtubeVideoId, taskUid: null, title, finglish: fgOk ? fgPkg : srvfTransliterate(title), finglishAuto: !fgOk, artist, artistSource: 'attachment', mood: pkg ? (srvfParseMood(pkg.mood || '').mood || '') : '', durationSec: sec, durationSource: 'youtube', youtubeVideoId: att.youtubeVideoId, privacy: u ? u.privacyStatus : 'unknown',
    audioSource: 'attached-file', sourceUrl: att.sourceUrl || null, cover: pkg && pkg._srvAvatarChoice && pkg._srvAvatarChoice.id ? { id: pkg._srvAvatarChoice.id, artist: pkg._srvAvatarChoice.artist || artist } : null, generatedAt: (u && u.publishedAt) || att.attachedAt || '', eligible: !reason, reason, inMmmos: true, attached: true, attachedBy: att.attachedBy || null, attachedAt: att.attachedAt || null, attachedPackageId: att.packageId || null, attachKind: att.kind || 'attached', ...(u && u.publishedAt ? { publishedAt: u.publishedAt } : {}) };
}
// Human text for every reason a published Long cannot be a Mix source (shown in the page; the server uses the same codes).
export const SRVF_REASON_TEXT = Object.freeze({ set_aside: 'set aside', test: 'a test package', no_title: 'has no title', not_uploaded: 'not uploaded to YouTube', not_public: 'marked private in MMMOS', unknown_duration: 'its length is not recorded in MMMOS and YouTube could not provide it', too_short: 'too short to be a full song (under 2 minutes)', unknown_artist: 'its artist category (Female / Male / Duet) is not recorded', media_unreachable: 'its audio file cannot be read', not_public_on_youtube: 'not Public on YouTube (it is Private or Unlisted) — make it public in YouTube Studio first', not_found_on_youtube: 'not found on the SRV Farsi YouTube channel', other_channel: 'belongs to a different YouTube channel', not_in_mmmos: 'Published — Source Required: no original audio file is linked in MMMOS yet, so it cannot be mixed', source_required: 'Published — Source Required', source_duration_mismatch: 'the linked audio is not the same length as the YouTube video (it is a different recording)' });
// Filter by artist category and mood (only eligible songs unless includeIneligible).
export function srvfMixFilter(cands, { category = 'all', mood = '', includeIneligible = false } = {}) {
  const c = srvfCategory(category) || srvfCategory('all');
  return (cands || []).filter((x) => (includeIneligible || x.eligible) && c.artists.includes(x.artist) && (!mood || x.mood === mood));
}

// ── timeline ──
// Track i starts at sum(d_0..d_{i-1}) − i·crossfade. The active song (and the on-screen title/cover) changes at the MIDDLE of each crossfade — where the new song becomes the louder
// one — and that same second is the YouTube chapter timestamp (rounded down), so the video and the description always agree. The first chapter is 0:00 (YouTube requires it).
export function srvfClock(sec) {
  const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export function srvfMixTimeline(tracks, { crossfadeSec = SRVF_MIX_CONFIG.crossfadeSec } = {}) {
  const t = (tracks || []).map((x) => ({ ...x, durationSec: Number(x.durationSec) }));
  if (t.some((x) => !(x.durationSec > crossfadeSec * 2))) throw new Error('every track must be longer than two crossfades');
  let at = 0; const items = [];
  t.forEach((x, i) => {
    const start = i === 0 ? 0 : at - crossfadeSec;
    const switchAt = i === 0 ? 0 : start + crossfadeSec / 2;                  // exact moment the highlighted title and the cover change
    const chapterSec = i === 0 ? 0 : Math.floor(switchAt);
    items.push({ index: i, pkgId: x.pkgId, title: x.title, finglish: x.finglish || '', youtubeVideoId: x.youtubeVideoId || null, artist: x.artist || '', durationSec: x.durationSec, startSec: +start.toFixed(3), endSec: +(start + x.durationSec).toFixed(3),
      switchAtSec: +switchAt.toFixed(3), chapterSec, timestamp: srvfClock(chapterSec) });
    at = start + x.durationSec;
  });
  const totalSec = +at.toFixed(3);
  return { items, totalSec, totalLabel: srvfClock(Math.round(totalSec)), crossfadeSec };
}
// Which song is active at time t (video and chapters share this rule).
export function srvfActiveIndex(tl, t) { let a = 0; for (const it of tl.items) if (t >= it.switchAtSec) a = it.index; return a; }

// ── validation ──
// Blockers stop the Mix reaching final approval or publishing; warnings are shown but do not stop it.
export function srvfMixValidate(tl, { category = 'all', mood = '', songs = [] } = {}, cfg = SRVF_MIX_CONFIG) {
  const problems = [], warnings = []; const items = tl.items, n = items.length; const c = srvfCategory(category);
  if (!c) problems.push('choose an artist category');
  if (mood && !srvfMood(mood)) problems.push('choose a mix mood');
  if (!mood) problems.push('choose a mix mood');
  if (n < cfg.minTracks) problems.push(`at least ${cfg.minTracks} valid songs are needed (now ${n})`);
  if (n === 2) warnings.push('YouTube shows chapter markers only for videos with at least 3 timestamps — with two songs the tracklist is still listed in the description, but no chapter bar appears');
  const ids = items.map((x) => x.pkgId); if (new Set(ids).size !== ids.length) problems.push('a song is in the mix twice');
  const titles = items.map((x) => x.title.toLowerCase()); if (new Set(titles).size !== titles.length) problems.push('two songs have the same title');
  if (tl.totalSec > cfg.platformMaxSec) problems.push(`runtime ${tl.totalLabel} is above YouTube's ${srvfClock(cfg.platformMaxSec)} limit for one video`);
  else if (tl.totalSec > cfg.longBuildWarnSec) warnings.push(`runtime ${tl.totalLabel}: the video is rendered in real time, so the build needs this browser tab open for about ${tl.totalLabel}`);
  if (n && items[0].chapterSec !== 0) problems.push('the first chapter must start at 0:00');
  for (let i = 1; i < n; i++) if (items[i].chapterSec - items[i - 1].chapterSec < cfg.minChapterSec) problems.push(`chapter ${i + 1} is shorter than ${cfg.minChapterSec} s`);
  if (c) for (const s of songs) { if (!c.artists.includes(s.artist)) problems.push(`"${s.title}" is a ${s.artist || 'unknown'} song — not allowed in a ${c.short || c.label} Mix`); }
  if (mood) for (const s of songs) if (s.mood && s.mood !== mood) warnings.push(`"${s.title}" is ${s.mood}, the Mix mood is ${mood}`);
  if (category === 'all' && songs.length) { const have = new Set(songs.map((s) => s.artist)); const miss = ['female', 'male', 'duet'].filter((a) => !have.has(a)); if (miss.length) warnings.push(`All Artists Mix has no ${miss.join(' / ')} song`); }
  for (const s of songs) { const fe = srvfFinglishCheck(s.finglish); if (fe) problems.push(`"${s.title}": ${fe}`); else if (s.finglishAuto && !s.finglishConfirmed) problems.push(`confirm the Finglish spelling of "${s.title}" (it is only an automatic draft)`); }
  return { ok: !problems.length, problems, warnings, totalSec: tl.totalSec };
}

// ── Finglish (Latin spelling of the Persian title; the video's tracklist shows ONLY this, never Persian script) ──
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu;
export const srvfCleanText = (s) => String(s || '').replace(EMOJI, '').replace(/[\u200c\u200b]+/g, (m) => (m.includes('\u200c') ? '\u200c' : '')).replace(/\s+/g, ' ').trim();
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
// A usable Finglish spelling: not empty, no Persian/Arabic script, only Latin letters (diacritics allowed), digits, spaces and light punctuation.
export function srvfFinglishCheck(f) {
  const t = srvfCleanText(f); if (!t) return 'a Finglish (Latin) spelling of the title is required';
  if (ARABIC_SCRIPT.test(t)) return 'the Finglish spelling must not contain Persian script';
  if (!/^[\p{Script=Latin}0-9 '’\-–,.!?&()]+$/u.test(t)) return 'the Finglish spelling may only use Latin letters, digits and simple punctuation';
  return null;
}
// A DRAFT only (Persian omits short vowels, so no program can spell a title exactly): used when a package has no stored Finglish. It is always flagged for the VA to confirm or correct.
const FA = { 'ا': 'a', 'آ': 'â', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'gh', 'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ۀ': 'e', 'ئ': '', 'ء': '', 'ً': '', 'ٔ': '' };
export function srvfTransliterate(fa) {
  const words = srvfCleanText(fa).split(' ').filter(Boolean); const out = [];
  for (const w of words) {
    const ch = [...w].filter((c) => c !== '\u200c' && !/[\u064B-\u0652]/.test(c)); let r = ''; const cons = (c) => c && c !== 'ا' && c !== 'و' && c !== 'ی' && c !== 'ي' && c !== 'آ' && FA[c] !== undefined;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i], prev = ch[i - 1], next = ch[i + 1];
      if (c === 'و') r += (i > 0 && cons(prev) && i < ch.length - 1) || (i > 0 && cons(prev) && i === ch.length - 1) ? 'u' : 'v';
      else if (c === 'ی' || c === 'ي') r += i > 0 && (cons(prev) || prev === 'ا') ? 'i' : 'y';
      else if (c === 'ه' && i === ch.length - 1 && i > 0 && cons(prev)) r += 'e';
      else if (c in FA) r += FA[c]; else if (/[A-Za-z0-9]/.test(c)) r += c;
      if (cons(c) && cons(next) && i < ch.length - 1 && c !== 'ه') r += 'e';
    }
    out.push(r);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().replace(/(^|\s)([a-zâ])/g, (m, a, b) => a + b.toUpperCase());
}

// ── title and metadata ──
// "Top Persian — Love Romantic Mix | گلچین آهنگ‌های عاشقانه فارسی" (All Artists); the single-artist categories add the artist word. The VA can edit it freely (≤ 100 characters).
export function srvfMixTitle(category, mood) {
  const c = srvfCategory(category), m = srvfMood(mood); if (!c || !m) return '';
  const lead = c.id === 'all' ? '' : c.label + ' ';
  const variants = [`${SRVF_MIX_CONFIG.titlePrefix} — ${lead}${m.label} Mix | ${m.fa}`, `${SRVF_MIX_CONFIG.titlePrefix} — ${lead}${m.label} Mix`, `${SRVF_MIX_CONFIG.titlePrefix} — ${m.label} Mix`];
  return variants.find((v) => v.length <= 100) || variants[variants.length - 1];
}
export function srvfTitleCheck(title) { const t = String(title || '').trim(); return !t ? 'a title is required' : t.length > 100 ? `the title is ${t.length} characters (YouTube allows 100)` : /[<>]/.test(t) ? 'the title cannot contain < or >' : null; }
export function srvfMixDescription({ title, category, mood }, tl) {
  const c = srvfCategory(category), m = srvfMood(mood); const mins = Math.round(tl.totalSec / 60); const lines = [];
  lines.push(`${m ? m.fa : 'گلچین آهنگ‌های فارسی'} — ${tl.items.length} آهنگ، ${mins} دقیقه موسیقی`);
  lines.push(`${tl.items.length} Persian ${m ? m.label.toLowerCase() : 'love'} songs from SRV Farsi${c && c.id !== 'all' ? ' — ' + c.label.toLowerCase() + ' voices' : ''}, one ${mins}-minute mix.`);
  lines.push(''); lines.push('Tracklist');
  for (const x of tl.items) lines.push(`${x.timestamp} ${x.title}${x.finglish ? ' — ' + x.finglish : ''}`);
  lines.push(''); lines.push('Full songs');
  for (const x of tl.items) if (x.youtubeVideoId) lines.push(`${x.title} — https://youtu.be/${x.youtubeVideoId}`);
  lines.push(''); lines.push('Subscribe to Silk Road Voices for a new Persian song every week.'); lines.push(SRVF_AI_DISCLOSURE);
  lines.push('#SRVFarsi #PersianMusic #FarsiSongs #PersianLoveSongs #ایرانی #آهنگ_فارسی');
  return lines.join('\n');
}
export function srvfMixTags({ category, mood }, tl) {
  const base = ['SRV Farsi', 'Silk Road Voices', 'Persian music', 'Farsi songs', 'Persian love songs', 'آهنگ فارسی', 'گلچین آهنگ فارسی', (srvfMood(mood) || { label: 'Persian love' }).label + ' mix', 'persian mix 2026'];
  const all = base.concat(tl.items.flatMap((x) => [x.title, x.finglish].filter(Boolean))).filter((v, i, a) => a.indexOf(v) === i);
  const out = []; let len = 0; for (const t of all) { if (len + t.length + 1 > 450) break; out.push(t); len += t.length + 1; } return out;
}
// Every source song with its package, task, YouTube id and audio source — kept on the Mix package forever; the source records themselves are never modified.
export function srvfMixLineage(tl, cands) {
  const by = new Map((cands || []).map((e) => [e.pkgId, e]));
  return tl.items.map((x) => { const e = by.get(x.pkgId) || {}; return { order: x.index + 1, pkgId: x.pkgId, taskUid: e.taskUid || null, title: x.title, youtubeVideoId: e.youtubeVideoId || null, audioSource: e.audioSource || null, artist: x.artist, startSec: x.startSec, switchAtSec: x.switchAtSec }; });
}
// Duplicate protection: month + category + mood + the ordered source packages. The same Mix always gives the same key.
export function srvfMixKey(monthKey, category, mood, tl) {
  const s = 'srvfmix|' + monthKey + '|' + category + '|' + mood + '|' + tl.items.map((x) => x.pkgId).join(','); let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = ((h2 << 5) + h2 + c) >>> 0; }
  return 'fmix_' + String(monthKey).replace('-', '') + '_' + h1.toString(36) + h2.toString(36);
}

// ── backgrounds and cover ──
// Approved procedural backgrounds (no external assets) plus any image from the SRV Farsi cover libraries ("cover:<avatarId>", blurred and darkened). Saved with the Mix package.
export const SRVF_BACKGROUND_IDS = Object.freeze(['ice', 'night-gold', 'teal-dusk', 'rose-dusk', 'midnight', 'emerald']);
export const srvfBackgroundValid = (id) => SRVF_BACKGROUND_IDS.includes(id) || /^cover:[a-z]+_\d{2}$|^cover:up_f_[a-z0-9_]+$/.test(String(id || ''));
// The package record stored with the Mix (everything needed to rebuild it exactly).
export function srvfMixRecord({ category, mood, title, tracks, tl, background = 'ice', thumbCover = null, monthKey, at = new Date().toISOString() }, cands = []) {
  const validation = srvfMixValidate(tl, { category, mood, songs: tracks });
  return { version: 'srvf-mix-1', category, mood, title: String(title || '').trim() || srvfMixTitle(category, mood), background: srvfBackgroundValid(background) ? background : 'ice',
    thumbCover: thumbCover || (tracks[0] && tracks[0].cover) || null, tracks: tracks.map((x) => ({ pkgId: x.pkgId, title: x.title, finglish: x.finglish || '', finglishAuto: !!x.finglishAuto, finglishConfirmed: !!x.finglishConfirmed, artist: x.artist, durationSec: x.durationSec, youtubeVideoId: x.youtubeVideoId || null, cover: x.cover || null, audioSource: x.audioSource, sourceUrl: x.sourceUrl })),
    runtimeSec: tl.totalSec, validation: { ok: validation.ok, problems: validation.problems, warnings: validation.warnings }, lineage: srvfMixLineage(tl, cands), key: srvfMixKey(monthKey || at.slice(0, 7), category, mood, tl), savedAt: at };
}
