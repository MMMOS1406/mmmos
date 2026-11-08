// SRV Farsi Creative V2 — the ONE canonical SRV Farsi creative brain (order: SRV FARSI V2 CREATIVE BRAIN REPLACEMENT).
//
// Everything V2 knows about writing an SRV Farsi Long song lives in this file: identity, locked structure, language,
// artist/mood profiles, Suno style rules, exclude styles, Farsi-only memory, the 14 hard gates and the request handler.
// The legacy SRV_FARSI_PROMPT (api/generate.js), the Factory prompt (api/ops.js) and the client fallback prompt are
// NOT read by V2; they stay only as the flag-OFF rollback path.
//
// Used only when: engine 'SRV Farsi' + request flag srvFarsiCreativeV2:true + server flag row srv_farsi_creative_v2
// (app_settings) is 'on' (or 'test' and the request is for a [TEST] task). Anything else answers code
// 'srv_farsi_creative_v2_off' and the client falls back to the unchanged legacy path.

export const SRVF_CV2_VERSION = 'srvf-creative-v2.1';
export const SRVF_CV2_FLAG_KEY = 'srv_farsi_creative_v2';
export const SRVF_CV2_GEN_MODEL = 'claude-sonnet-4-5';
export const SRVF_CV2_JUDGE_MODEL = 'claude-haiku-4-5-20251001';
export const SRVF_CV2_ARTISTS = ['Male', 'Female', 'Duet'];
export const SRVF_CV2_MOODS = ['Romantic', 'Emotional', 'Happy'];

// ── Locked Long structure (CEO). Order is exact; nothing may be added. ─────────────────────────────────────────────
export const SRVF_CV2_STRUCTURE = [
  { key: 'INTRO — MUSIC', music: true },
  { key: 'VERSE 1', music: false, min: 4, max: 6 },
  { key: 'CHORUS', music: false, min: 4, max: 6 },
  { key: 'INSTRUMENTAL BREAK — MUSIC', music: true },
  { key: 'VERSE 2', music: false, min: 4, max: 6 },
  { key: 'FINAL CHORUS', music: false, min: 4, max: 8 },
  { key: 'OUTRO — MUSIC', music: true },
];

export const SRVF_CV2_EXCLUDE_DEFAULT = [
  'hard kick', 'dominant bass', 'festival EDM', 'aggressive club beat', 'techno', 'trance', 'EDM drop', 'harsh synths',
  'repetitive electronic loop', 'robotic vocals', 'excessive autotune', 'dry digital mix', 'dense electronic arrangement',
];

// Mood profiles (CEO). Tempo ranges keep the Deep House layer gentle; the song leads.
export const SRVF_CV2_MOOD_PROFILES = {
  Emotional: {
    feel: 'soulful, aching, intimate, vulnerable; emotional held notes; bittersweet movement; restrained production; a strong emotional release in the Chorus',
    story: 'longing, distance, a love that hurts but is still alive, a goodbye not yet accepted, waiting, regret, quiet heartbreak between two lovers',
    tempo: '98-108 BPM, unhurried half-time feel',
  },
  Romantic: {
    feel: 'warm, sweet, affectionate, intimate, melodic; smooth movement; an emotionally uplifting Chorus',
    story: 'falling in love, tenderness, devotion, a promise, the sweetness of being close, admiration, a confession of love',
    tempo: '106-114 BPM, smooth gentle sway',
  },
  Happy: {
    feel: 'lively, warm, joyful and romantic; naturally energetic; smooth rhythmic movement; never childish, never festival EDM, never aggressive club energy',
    story: 'the joy of being in love right now: a happy day together, a playful flirt, good news shared, the excitement of seeing the loved one, love that makes the city brighter. A love song first — not a holiday, ceremony or festival song',
    tempo: '114-122 BPM, light bouncing groove',
  },
};

export const SRVF_CV2_ARTIST_PROFILES = {
  Male: 'ONE male lead singer: a mature, warm male voice (baritone or warm tenor). Lyrics sung from his perspective to the woman he loves. No female voice, no duet.',
  Female: 'ONE female lead singer: a mature, warm female voice (alto or warm mezzo). Lyrics sung from her perspective to the man she loves. No male voice, no duet.',
  Duet: 'A real male/female DUET designed as a conversation between two lovers: a mature warm male voice and a mature warm female voice. Verse 1 is sung by one singer, Verse 2 by the other, both sing the Chorus and Final Chorus.',
};

// Opening focus for the Suno style prompt — picked per request so prompts do not share a boilerplate opening.
export const SRVF_CV2_OPENINGS = [
  'open with the singer: describe the voice and how it feels to hear it',
  'open with the emotional situation of this song in a few words, then the voice',
  'open with the song\'s signature melodic instrument motif, then the voice',
  'open with the tempo and groove feel in plain musical words, then the voice',
  'open with the sound of the first seconds of the intro, then the voice',
];

// ── The canonical creative specification (system prompt) ─────────────────────────────────────────────────────────
export const SRVF_CV2_SYSTEM = `You are the songwriter and music director of SRV Farsi (Silk Road Voices), a Persian love-song channel.
You write ONE complete Long song package per request and return it as ONE JSON object. Nothing else.

PERMANENT PRINCIPLE: REAL PERSIAN LOVE SONG FIRST. SUBTLE DEEP HOUSE SECOND.
SRV Farsi never sounds like "bass + kick + pad + Persian vocal loop". It sounds like a naturally composed Persian love
song with a human singer, a memorable melody and real musical movement, with a restrained Deep House production layer
underneath. The result must feel human, warm, sweet, melodic, alive, emotionally convincing, professionally arranged,
pleasant to listen to, never harsh and never obviously AI-generated. Never copy existing songs' lyrics or melodies.

ARTIST AND MOOD ARE GIVEN TO YOU. They are fixed by the producer. Never change them. Echo them exactly in the JSON.

━━ LOCKED SONG STRUCTURE (exact order, nothing added) ━━
[INTRO — MUSIC]
[VERSE 1]
[CHORUS]
[INSTRUMENTAL BREAK — MUSIC]
[VERSE 2]
[FINAL CHORUS]
[OUTRO — MUSIC]
- Write the section headers exactly like this, each on its own line, in this order, once each.
- "— MUSIC" sections contain NO lyrics at all (leave them empty).
- NEVER add a Pre-Chorus, Bridge, Verse 3, extra Chorus, Hook Intro, spoken part, ad-lib section or any other header.
- VERSE 1 and VERSE 2: 4-6 lines each. CHORUS: 4-6 lines. FINAL CHORUS: 4-8 lines.
- Only for a DUET, add the singer to the header: [VERSE 1 — MALE], [CHORUS — BOTH], [VERSE 2 — FEMALE],
  [FINAL CHORUS — BOTH] (Verse 1 and Verse 2 must be different singers). Solo songs never add a singer to a header.
- No other bracketed tags, no stage directions, no English, no transliteration inside the lyrics.

━━ SONGWRITING ━━
Every song has: a clear relationship story between two lovers; an understandable emotional situation; a strong,
memorable verbal hook; natural singable line lengths (about 4-9 words); a Chorus phrase made for melodic repetition;
controlled repetition; no filler; no abstract AI poetry.
- VERSE: intimate, conversational, emotionally specific, restrained; the story moves forward (Verse 2 is a new step
  in the story, not a rewrite of Verse 1).
- CHORUS: clearly different from the Verse — simpler, more memorable, built around the hook, with longer open vowels
  and lines that can carry longer held notes; it is the emotional payoff.
- FINAL CHORUS: the same identity and hook as the Chorus (it may vary or add one line) with a stronger emotional
  performance.
- The hook line must appear in both the CHORUS and the FINAL CHORUS.

━━ LANGUAGE ━━
About 60% natural, general Farsi and 40% soft Dari-friendly influence, understood by Afghan and Iranian listeners.
Natural when sung. Prefer conversational emotional language, short singable phrases, simple but meaningful words,
believable human relationship language. Avoid heavy Tehran slang, stiff literary or classical Persian, artificial
poetry, meaningless metaphors, cliché AI wording (e.g. "قلب شکسته", "تا ابد", "روح من", "دنیای من", "بی تو می‌میرم",
"ستاره‌های آسمان", "عشق ابدی"), unnatural repetition and over-complicated sentences. Concrete everyday images beat
abstract words. Lines are full Persian script.

━━ COMPOSITION AND ARRANGEMENT (for the Suno style prompt) ━━
Describe a LIVING arrangement, never a static loop: warm Rhodes or piano, gentle acoustic guitar where it fits,
delicate Persian plucked strings (setar, tar, santoor or rubab) as accents where they fit, soft atmospheric strings,
melodic bass movement, small instrumental fills, ONE signature melodic motif, call-and-response between the singer and
an instrument, instruments entering and leaving naturally, space between vocal phrases. The instrumental break carries
the signature motif; the outro resolves it. Verse: sparse and intimate. Chorus opens up through a wider melody, richer
harmony, more musical movement and stronger vocal emotion — NOT through louder drums.

━━ DEEP HOUSE RULE ━━
Deep House is supporting production only: gentle movement, a smooth soft pulse, a warm restrained groove, soft
percussion, controlled bass, tasteful modern production. It never dominates the song. Mention the deep house layer at
most once, always as subtle/soft/restrained. Never write (not even negated) in the style prompt: hard kick, dominant
or heavy bass, four-on-the-floor stomp, drop, EDM, festival, techno, trance, club banger, harsh synths, loop.
Unwanted styles go only into excludeStyles.

━━ HUMAN VOCAL ━━
A mature, believable singer with clear natural Persian pronunciation, a warm tone, clearly in front of the music, real
breathing, changing intensity, natural pauses, subtle imperfections, a gentle vocal crack where the emotion asks for
it, expressive held notes and natural phrase timing. Never robotic, grid-perfect, heavily autotuned, synthetic or
buried behind the beat.

━━ SUNO STYLE PROMPT (field "sunoPrompt") ━━
English, 105-135 words (about 700-900 characters; it is rejected at 1000 characters or more). It must cover, in natural producer language:
1) the singer and vocal identity, named with the exact words "male vocal", "female vocal" or "male and female duet"
(name only the given voice — never mention the other gender in the style prompt),
2) the melodic Persian love-song identity, 3) the Verse/Chorus contrast, 4) the living arrangement with the signature
motif, 5) the restrained deep house movement (once), 6) a warm polished studio sound, 7) the human performance.
No EQ or mixing jargon. Do not repeat bass/kick/deep house. Follow the OPENING instruction given in the request — do
not start with a genre label such as "cinematic modern Persian pop".

━━ OUTPUT — ONE JSON object, no markdown ━━
{
  "artist": "<exactly the given artist>",
  "mood": "<exactly the given mood>",
  "story": "2-3 English sentences: who sings to whom, the situation, how it moves from Verse 1 to Verse 2",
  "concept": "one English sentence: the unique emotional premise of this song",
  "title": "one fitting emoji + short Persian title (2-5 words) + the same emoji",
  "titleFinglish": "Latin transliteration of the Persian title (pronunciation, not meaning), no emoji",
  "hook": "the Chorus hook line in Persian, 3-8 words, exactly as sung",
  "lyrics": "the full lyrics with the locked section headers, lines separated by \\n",
  "sunoPrompt": "the style prompt described above",
  "excludeStyles": "comma-separated styles to exclude (only add up to 3 song-specific items to the default list given)",
  "captionYouTube": "2-3 concise Farsi sentences: what the song means and the emotional story. No hashtags, no English, no call to action",
  "thumbnailText": "the Persian title with its emoji",
  "centralImage": "the one central image of the song, 1-3 English words",
  "location": "the setting, 1-3 English words",
  "hookStructure": "hook pattern as a short kebab-case tag (e.g. direct-promise, question-to-lover, confession, sensory-recall, invitation, gentle-plea)",
  "emotionalScenario": "the specific emotional situation in one English line",
  "emotionalSubMode": "a 2-4 word English texture of this mood",
  "selfCheck": "one English line confirming: structure order, hook in both choruses, artist and mood unchanged"
}`;

// ── small text helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const PERSIAN_RE = /[؀-ۿ]/;
const LATIN_RE = /[A-Za-z]/;
export function srvfCv2NormFa(s) {
  return String(s || '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه').replace(/[أإآ]/g, 'ا')
    .replace(/[ً-ٰٟ]/g, '')            // diacritics
    .replace(/‌/g, ' ')                           // ZWNJ → space
    .replace(/[^؀-ۿA-Za-z0-9\s]/g, ' ')      // emoji / punctuation
    .replace(/[،؛؟]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const EN_STOP = new Set('a an the and or of for in on at to from by with as is are was were be been his her their its she he they them him who whom that this these those into onto than then there where when while about after before still now one two each every through across over under all only just very more most some such not no her his our your my me we you i it own same other again ever never once'.split(' '));
export function srvfCv2Tokens(s, { fa = false } = {}) {
  const t = (fa ? srvfCv2NormFa(s) : String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ\s-]/g, ' ').replace(/-/g, ' '))
    .split(/\s+/).filter(Boolean);
  return fa ? t.filter(w => w.length > 1) : t.filter(w => w.length > 2 && !EN_STOP.has(w)).map(w => w.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'));
}
export function srvfCv2Jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
function containment(small, big) { // share of `small` tokens found in `big`
  const S = new Set(small), Bg = new Set(big); if (!S.size) return 0;
  let i = 0; for (const x of S) if (Bg.has(x)) i++; return i / S.size;
}

// ── input validation ─────────────────────────────────────────────────────────────────────────────────────────────
export function srvfCv2Selection(body) {
  const b = body || {};
  const cap = s => { const v = String(s || '').trim().toLowerCase(); return v ? v[0].toUpperCase() + v.slice(1) : ''; };
  const artist = cap(b.artist), mood = cap(b.mood), format = cap(b.format);
  if (!SRVF_CV2_ARTISTS.includes(artist)) return { ok: false, error: 'artist must be Male, Female or Duet' };
  if (!SRVF_CV2_MOODS.includes(mood)) return { ok: false, error: 'mood must be Romantic, Emotional or Happy' };
  if (format !== 'Long') return { ok: false, error: 'format must be Long' };
  return { ok: true, artist, mood, format };
}

// ── flag (server-side, fails closed) ─────────────────────────────────────────────────────────────────────────────
let _flagCache = { at: 0, mode: 'off' };
export function srvfCv2ParseFlag(v) {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (_) { /* plain string */ } }
  if (x === true) return 'on';
  if (x && typeof x === 'object' && typeof x.mode === 'string') x = x.mode;
  x = String(x == null ? '' : x).trim().toLowerCase();
  return x === 'on' || x === 'true' ? 'on' : x === 'test' ? 'test' : 'off';
}
export async function srvfCv2FlagMode({ fetchImpl = globalThis.fetch, supabaseUrl, supabaseKey, now = Date.now(), ttlMs = 30000 } = {}) {
  if (!supabaseUrl || !supabaseKey || typeof fetchImpl !== 'function') return 'off';
  if (now - _flagCache.at < ttlMs) return _flagCache.mode;
  let mode = 'off';
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 2500) : null;
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.${SRVF_CV2_FLAG_KEY}&select=value`, {
      headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey }, ...(ctl ? { signal: ctl.signal } : {}),
    });
    if (timer) clearTimeout(timer);
    if (r && r.ok) { const rows = await r.json(); mode = srvfCv2ParseFlag(Array.isArray(rows) && rows[0] ? rows[0].value : null); }
  } catch (_) { mode = 'off'; }
  _flagCache = { at: now, mode };
  return mode;
}
export function _resetSrvfCv2FlagCache() { _flagCache = { at: 0, mode: 'off' }; }
export function srvfCv2Allowed(mode, isTestTask) { return mode === 'on' || (mode === 'test' && isTestTask === true); }

// ── Farsi-only creative memory (generation_memory, engine_id = 'srv_farsi'; schema untouched, read-only) ──────────
export const SRVF_CV2_MEMORY_TYPES = { title: 60, hook: 60, concept: 30, mood: 20, central_image: 30, location: 20, hook_structure: 10, emotional_scenario: 30 };
export async function srvfCv2LoadMemory({ fetchImpl = globalThis.fetch, supabaseUrl, supabaseKey } = {}) {
  const out = { ok: false, title: [], hook: [], concept: [], mood: [], central_image: [], location: [], hook_structure: [], emotional_scenario: [] };
  if (!supabaseUrl || !supabaseKey || typeof fetchImpl !== 'function') return out;
  try {
    const res = await Promise.all(Object.entries(SRVF_CV2_MEMORY_TYPES).map(async ([type, limit]) => {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
      // Titles were back-filled many times by the legacy guard; over-fetch and de-duplicate in order.
      const r = await fetchImpl(`${supabaseUrl}/rest/v1/generation_memory?engine_id=eq.srv_farsi&memory_type=eq.${type}&select=value&order=created_at.desc&limit=${type === 'title' ? 400 : limit * 2}`, {
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey }, ...(ctl ? { signal: ctl.signal } : {}),
      });
      if (timer) clearTimeout(timer);
      if (!r || !r.ok) throw new Error('memory ' + type + ' ' + (r && r.status));
      const rows = await r.json();
      const seen = new Set(); const vals = [];
      for (const row of rows || []) { const v = String(row && row.value || '').trim(); if (!v) continue; const k = v.toLowerCase(); if (type !== 'mood' && seen.has(k)) continue; seen.add(k); vals.push(v); if (vals.length >= limit) break; }
      return [type, vals];
    }));
    for (const [t, v] of res) out[t] = v;
    out.ok = true;
  } catch (_) { out.ok = false; }
  return out;
}
// Tokens used ≥3 times across recent imagery/settings/premises — the saturated zone.
export function srvfCv2Saturated(memory) {
  const m = memory || {};
  const count = {};
  const docs = [...(m.central_image || []).slice(0, 30), ...(m.location || []).slice(0, 20), ...(m.concept || []).slice(0, 20)];
  for (const d of docs) for (const t of new Set(srvfCv2Tokens(d))) count[t] = (count[t] || 0) + 1;
  const generic = new Set(['woman', 'man', 'lover', 'love', 'romantic', 'memory', 'moment', 'family', 'night', 'morning', 'city', 'home', 'perspective', 'joy', 'warmth', 'year', 'together', 'people', 'person', 'singer', 'female', 'male', 'duet', 'song', 'first', 'time', 'heartbreak', 'distance', 'longing', 'quiet', 'anchored', 'shared', 'specific', 'emotional', 'new']);
  return Object.entries(count).filter(([t, n]) => n >= 3 && !generic.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([t]) => t);
}

// ── user prompt ──────────────────────────────────────────────────────────────────────────────────────────────────
export function srvfCv2UserPrompt({ artist, mood, memory, feedback, openingIndex = 0 }) {
  const m = memory || {};
  const P = SRVF_CV2_MOOD_PROFILES[mood];
  const list = (a, n) => (a || []).slice(0, n).map(x => '  - ' + String(x).slice(0, 140)).join('\n') || '  (none)';
  const sat = srvfCv2Saturated(m);
  const fb = (Array.isArray(feedback) ? feedback : []).slice(0, 14).map(f => `  - ${String(f && f.gate || '').slice(0, 6)}: ${String(f && f.reason || '').replace(/[\r\n]+/g, ' ').slice(0, 300)}`).join('\n');
  return `Write one SRV Farsi Long song package.

ARTIST (fixed): ${artist}
${SRVF_CV2_ARTIST_PROFILES[artist]}

MOOD (fixed): ${mood}
Feel: ${P.feel}
Story territory: ${P.story}
Tempo feel: ${P.tempo}

SUNO STYLE PROMPT OPENING: ${SRVF_CV2_OPENINGS[openingIndex % SRVF_CV2_OPENINGS.length]}.

DEFAULT EXCLUDE STYLES (always included automatically): ${SRVF_CV2_EXCLUDE_DEFAULT.join(', ')}

RECENT SRV FARSI SONGS — the new song must be clearly different in title, hook wording, story premise, central image,
location, hook structure and emotional scenario. Do not force strangeness; just choose a fresh, natural situation.
Recent titles:
${list(m.title, 30)}
Recent hooks:
${list(m.hook, 25)}
Recent premises:
${list(m.concept, 12)}
Recent central images: ${(m.central_image || []).slice(0, 25).join(' · ') || '(none)'}
Recent locations: ${(m.location || []).slice(0, 15).join(' · ') || '(none)'}
Recent hook structures (do not reuse the last three): ${(m.hook_structure || []).slice(0, 10).join(' · ') || '(none)'}
Recent emotional scenarios:
${list(m.emotional_scenario, 12)}
SATURATED — do not use as central image, location or premise: ${sat.join(', ') || '(none)'}
${fb ? `
THE PREVIOUS ATTEMPT WAS REJECTED BY QUALITY CHECKS. Fix every point below in this new attempt (write a new song if needed):
${fb}
` : ''}
Return only the JSON object.`;
}

// ── parse ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function srvfCv2Parse(text) {
  const t = String(text || '').replace(/```json\s*|```/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(t.slice(a, b + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (_) { return null; }
}

// ── lyrics structure parser ──────────────────────────────────────────────────────────────────────────────────────
export function srvfCv2Sections(lyrics) {
  const sections = []; let cur = null; const stray = [];
  for (const raw of String(lyrics || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const h = line.match(/^\[(.+)\]$/);
    if (h) {
      const label = h[1].replace(/\s*[-–—]\s*/g, ' — ').replace(/\s+/g, ' ').trim().toUpperCase();
      let key = label, voice = null;
      const v = label.match(/^(VERSE 1|VERSE 2|CHORUS|FINAL CHORUS) — (MALE|FEMALE|BOTH)$/);
      if (v) { key = v[1]; voice = v[2]; }
      cur = { key, voice, label, lines: [] }; sections.push(cur);
    } else if (cur) cur.lines.push(line); else stray.push(line);
  }
  return { sections, stray };
}

// ── Deterministic gates ──────────────────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_STYLE = [
  /hard[\s-]*kick/i, /(dominant|heavy|booming|pounding)\s+(sub[\s-]*)?bass/i, /four[\s-]*on[\s-]*the[\s-]*floor/i, /\bdrops?\b(?!\s+(out|away|back|to\s+(just|only)))/i,
  /\bedm\b/i, /festival/i, /techno/i, /trance/i, /club[\s-]*(banger|first|beat|anthem)/i, /harsh/i, /\bloops?\b/i, /\blooping\b/i,
  /\bdry\s+digital/i, /dense\s+electronic/i, /robotic/i, /auto[\s-]*tune/i,
];
const VOCAL_HUMAN = [/breath/i, /natural/i, /expressive/i, /held\s+notes?|long\s+notes?|sustain/i, /warm/i, /intimate/i, /pause/i, /crack/i, /imperfect/i, /human/i, /phrasing|phrase/i, /pronunciation|diction/i, /in\s+front|upfront|forward/i, /intensity|dynamics/i, /emotion/i];
const ARRANGEMENT = [/rhodes/i, /piano/i, /acoustic\s+guitar|guitar/i, /setar|\btar\b|santoor|santur|rubab|rabab|oud|kamancheh|daf|tombak/i, /strings/i, /melodic\s+bass|bass\s*line|bassline/i, /\bfills?\b/i, /motif/i, /call[\s-]*and[\s-]*response|answer(s|ing)?\s+the\s+(voice|vocal|singer)|respond/i, /enter|leave|drop(s)?\s+out|fade(s)?\s+in|join|arrive/i, /space|breath(es|ing)?\s+room/i];
const LYRIC_CLICHE = ['قلب شکسته', 'تا ابد', 'روح من', 'دنیای من', 'بی تو میمیرم', 'ستاره های آسمان', 'عشق ابدی', 'در آغوش باد', 'رقص باران', 'آسمان دلم', 'قلبم شکست', 'تنهای تنها'];
const BOILERPLATE_OPEN = [/^cinematic\s+modern\s+persian\s+pop/i, /^cinematic\s+(modern\s+)?(afghan\s+)?persian\s+pop/i, /^persian\s+pop\b/i, /^deep\s+house\b/i];

function g(pass, reason) { return { pass: !!pass, reason: pass ? 'ok' : reason }; }

export function srvfCv2DeterministicGates(pkg, { artist, mood, memory }) {
  const p = pkg || {};
  const G = {};
  const sp = String(p.sunoPrompt || '');
  const spl = sp.toLowerCase();
  const { sections, stray } = srvfCv2Sections(p.lyrics);

  // G1 — artist match (echo + style prompt + duet turns)
  {
    const echo = String(p.artist || '').trim().toLowerCase() === artist.toLowerCase();
    const hasFemale = /\bfemale\b/i.test(sp), hasMale = /\bmale\b/i.test(sp.replace(/\bfemale\b/gi, '')), hasDuet = /\bduet\b/i.test(sp);
    const voices = sections.map(s => s.voice).filter(Boolean);
    let ok = echo, why = [];
    if (!echo) why.push(`artist field "${p.artist || ''}" ≠ ${artist}`);
    if (artist === 'Male') { if (!hasMale) { ok = false; why.push('style prompt never names a male voice'); } if (hasFemale || hasDuet) { ok = false; why.push('style prompt mentions a female voice or duet'); } if (voices.length) { ok = false; why.push('solo song must not tag singers in headers'); } }
    if (artist === 'Female') { if (!hasFemale) { ok = false; why.push('style prompt never names a female voice'); } if (hasMale || hasDuet) { ok = false; why.push('style prompt mentions a male voice or duet'); } if (voices.length) { ok = false; why.push('solo song must not tag singers in headers'); } }
    if (artist === 'Duet') {
      if (!(hasDuet || (hasMale && hasFemale))) { ok = false; why.push('style prompt does not describe a male/female duet'); }
      const v1 = sections.find(s => s.key === 'VERSE 1'), v2 = sections.find(s => s.key === 'VERSE 2');
      if (!voices.includes('MALE') || !voices.includes('FEMALE')) { ok = false; why.push('duet lyrics must mark a MALE section and a FEMALE section'); }
      else if (!v1 || !v2 || !v1.voice || !v2.voice || v1.voice === v2.voice || v1.voice === 'BOTH' || v2.voice === 'BOTH') { ok = false; why.push('Verse 1 and Verse 2 must be sung by different singers (MALE/FEMALE)'); }
    }
    G.G1 = g(ok, why.join('; '));
  }
  // G2 — mood match (echo); fit is judged in J-mood
  G.G2 = g(String(p.mood || '').trim().toLowerCase() === mood.toLowerCase(), `mood field "${p.mood || ''}" ≠ ${mood}`);
  // G3 — locked structure
  {
    const why = [];
    const keys = sections.map(s => s.key);
    const want = SRVF_CV2_STRUCTURE.map(s => s.key);
    if (keys.join('|') !== want.join('|')) why.push(`section order is [${keys.join('] [') || 'none'}] — must be exactly [${want.join('] [')}]`);
    if (stray.length) why.push('lyric lines before the first header');
    for (const spec of SRVF_CV2_STRUCTURE) {
      const s = sections.find(x => x.key === spec.key); if (!s) continue;
      if (spec.music && s.lines.length) why.push(`[${spec.key}] must contain no lyrics`);
      if (!spec.music && (s.lines.length < spec.min || s.lines.length > spec.max)) why.push(`[${spec.key}] has ${s.lines.length} lines (allowed ${spec.min}-${spec.max})`);
    }
    for (const s of sections) if (s.voice && artist !== 'Duet') why.push(`header [${s.label}] tags a singer in a solo song`);
    for (const s of sections) for (const l of s.lines) if (/^\(.*\)$|^\[.*\]$/.test(l)) why.push('stage directions/bracketed tags inside lyrics');
    G.G3 = g(!why.length, [...new Set(why)].join('; '));
  }
  const sung = sections.filter(s => !/MUSIC/.test(s.key)).flatMap(s => s.lines);
  // G4 — natural Farsi (deterministic part; the judge adds naturalness)
  {
    const why = [];
    const nonFa = sung.filter(l => !PERSIAN_RE.test(l) || LATIN_RE.test(l));
    if (!sung.length) why.push('no sung lines');
    if (nonFa.length) why.push(`${nonFa.length} sung line(s) contain Latin letters or no Persian`);
    const wc = sung.map(l => srvfCv2NormFa(l).split(' ').filter(Boolean).length);
    const bad = wc.filter(n => n < 2 || n > 11).length;
    if (sung.length && bad / sung.length > 0.2) why.push(`${bad} of ${sung.length} lines are not singable length (2-11 words)`);
    const verseLines = sections.filter(s => /VERSE/.test(s.key)).flatMap(s => s.lines).map(srvfCv2NormFa);
    if (new Set(verseLines).size !== verseLines.length) why.push('a verse line is repeated');
    const cl = LYRIC_CLICHE.filter(c => srvfCv2NormFa(p.lyrics).includes(srvfCv2NormFa(c)));
    if (cl.length >= 2) why.push('cliché wording: ' + cl.join(', '));
    G.G4 = g(!why.length, why.join('; '));
  }
  // G5 — story present (judge decides quality)
  G.G5 = g(String(p.story || '').trim().split(/\s+/).length >= 12 && String(p.concept || '').trim().length >= 20, 'story/concept missing or too thin');
  // G6 — hook: concise, Persian, in Chorus and Final Chorus
  {
    const why = [];
    const hook = srvfCv2NormFa(p.hook); const ht = hook.split(' ').filter(Boolean);
    if (!PERSIAN_RE.test(p.hook || '')) why.push('hook is not Persian');
    if (ht.length < 3 || ht.length > 9) why.push(`hook has ${ht.length} words (3-9)`);
    const inSec = key => { const s = sections.find(x => x.key === key); if (!s) return false; const joined = srvfCv2NormFa(s.lines.join(' ')); return joined.includes(hook) || s.lines.some(l => containment(ht, srvfCv2NormFa(l).split(' ')) >= 0.75); };
    if (!inSec('CHORUS')) why.push('hook line is not sung in the CHORUS');
    if (!inSec('FINAL CHORUS')) why.push('hook line is not sung in the FINAL CHORUS');
    G.G6 = g(!why.length, why.join('; '));
  }
  // G7 — verse/chorus contrast (deterministic part)
  {
    const why = [];
    const verse = sections.filter(s => /^VERSE/.test(s.key)).flatMap(s => s.lines).map(l => srvfCv2NormFa(l).split(' '));
    const chorus = (sections.find(s => s.key === 'CHORUS') || { lines: [] }).lines.map(l => srvfCv2NormFa(l).split(' '));
    const overlap = chorus.filter(c => verse.some(v => srvfCv2Jaccard(c, v) >= 0.6)).length;
    if (chorus.length && overlap > 1) why.push(`${overlap} chorus lines repeat verse lines`);
    const avg = a => a.length ? a.reduce((x, y) => x + y.length, 0) / a.length : 0;
    if (chorus.length && verse.length && avg(chorus) > avg(verse) + 2.5) why.push('chorus lines are much longer than verse lines (should be simpler)');
    const fc = (sections.find(s => s.key === 'FINAL CHORUS') || { lines: [] }).lines.map(srvfCv2NormFa);
    const cj = srvfCv2Jaccard(chorus.flat(), fc.join(' ').split(' '));
    if (chorus.length && fc.length && cj < 0.35) why.push('FINAL CHORUS does not keep the CHORUS identity');
    G.G7 = g(!why.length, why.join('; '));
  }
  // G8 — human vocal direction
  {
    const hits = VOCAL_HUMAN.filter(r => r.test(sp)).length;
    G.G8 = g(hits >= 5, `style prompt has only ${hits} human-vocal cues (need ≥5: breath, pauses, held notes, natural pronunciation, warmth, intensity…)`);
  }
  // G9 — living arrangement
  {
    const hits = ARRANGEMENT.filter(r => r.test(sp)).length;
    const motif = /motif|call[\s-]*and[\s-]*response|answer|respond/i.test(sp);
    G.G9 = g(hits >= 5 && motif, `style prompt describes ${hits} arrangement elements${motif ? '' : ' and no signature motif / call-and-response'} (need ≥5 incl. motif)`);
  }
  // G10 — deep house restraint
  {
    const why = [];
    const bad = FORBIDDEN_STYLE.filter(r => r.test(sp)).map(r => (sp.match(r) || [''])[0]);
    if (bad.length) why.push('style prompt contains excluded style words: ' + [...new Set(bad)].join(', '));
    const dh = (spl.match(/deep[\s-]*house|house\s+(groove|pulse|beat|layer|rhythm)/g) || []).length;
    if (dh < 1) why.push('style prompt does not mention the subtle deep house layer');
    if (dh > 1) why.push(`deep house mentioned ${dh} times (max 1)`);
    const kb = (spl.match(/\bkick\b|\bbass\b/g) || []).length;
    if (kb > 2) why.push(`bass/kick mentioned ${kb} times (max 2)`);
    if (dh >= 1 && !/(subtle|soft|gentle|restrained|understated|light|warm|low[\s-]*key|quiet)[^.,;]{0,40}(deep[\s-]*house|house)|(deep[\s-]*house|house)[^.,;]{0,40}(subtle|soft|gentle|restrained|underneath|beneath|supporting|in the background|understated)/i.test(sp)) why.push('deep house is not framed as subtle/supporting');
    G.G10 = g(!why.length, why.join('; '));
  }
  // G11 — generic / AI risk (deterministic part)
  {
    const why = [];
    if (BOILERPLATE_OPEN.some(r => r.test(sp.trim()))) why.push('style prompt opens with a genre boilerplate');
    if (/cinematic modern persian pop/i.test(sp)) why.push('legacy boilerplate phrase "cinematic modern Persian pop"');
    const words = spl.match(/[a-z']+/g) || []; const freq = {};
    const common = new Set(['vocal', 'vocals', 'voice', 'chorus', 'verse', 'verses', 'singer', 'melody', 'persian', 'warm', 'gentle', 'soft', 'their', 'there', 'which', 'while', 'with']);
    for (const w of words) if (w.length > 4 && !common.has(w)) freq[w] = (freq[w] || 0) + 1;
    const rep = Object.entries(freq).filter(([, n]) => n >= 5).map(([w]) => w);
    if (rep.length) why.push('style prompt repeats words: ' + rep.join(', '));
    G.G11 = g(!why.length, why.join('; '));
  }
  // G12 — diversity vs Farsi memory
  {
    const why = []; const M = memory || {};
    const tTok = srvfCv2NormFa(p.title).split(' ').filter(Boolean);
    const tHit = (M.title || []).slice(0, 60).find(t => { const o = srvfCv2NormFa(t).split(' ').filter(Boolean); return srvfCv2NormFa(t) === srvfCv2NormFa(p.title) || (o.length && tTok.length && srvfCv2Jaccard(o, tTok) >= 0.6); });
    if (tHit) why.push(`title too close to recent "${tHit}"`);
    const hTok = srvfCv2NormFa(p.hook).split(' ').filter(Boolean);
    const hHit = (M.hook || []).slice(0, 60).find(h => srvfCv2Jaccard(srvfCv2NormFa(h).split(' '), hTok) >= 0.6);
    if (hHit) why.push(`hook too close to recent "${hHit}"`);
    const ci = srvfCv2Tokens(p.centralImage);
    const ciHit = (M.central_image || []).slice(0, 20).find(x => srvfCv2Jaccard(srvfCv2Tokens(x), ci) >= 0.5);
    if (ciHit) why.push(`central image repeats recent "${ciHit}"`);
    const sat = srvfCv2Saturated(M);
    const satHit = [...new Set([...ci, ...srvfCv2Tokens(p.location)])].filter(t => sat.includes(t));
    if (satHit.length) why.push('uses saturated imagery: ' + satHit.join(', '));
    const loc = srvfCv2Tokens(p.location);
    const locHit = (M.location || []).slice(0, 8).find(x => srvfCv2Jaccard(srvfCv2Tokens(x), loc) >= 0.5);
    if (locHit) why.push(`location repeats recent "${locHit}"`);
    const hs = String(p.hookStructure || '').trim().toLowerCase();
    if (hs && (M.hook_structure || []).slice(0, 3).some(x => String(x).trim().toLowerCase() === hs)) why.push(`hook structure "${hs}" used in the last 3 songs`);
    const es = srvfCv2Tokens(p.emotionalScenario);
    const esHit = (M.emotional_scenario || []).slice(0, 20).find(x => srvfCv2Jaccard(srvfCv2Tokens(x), es) >= 0.45);
    if (esHit) why.push(`emotional scenario too close to recent "${String(esHit).slice(0, 80)}"`);
    const cpC = srvfCv2Tokens(p.concept), cpS = srvfCv2Tokens(p.story);
    const cpHit = (M.concept || []).slice(0, 20).find(x => { const t = srvfCv2Tokens(x); return srvfCv2Jaccard(t, cpC) >= 0.4 || srvfCv2Jaccard(t, cpS) >= 0.4; });
    if (cpHit) why.push(`story premise too close to recent "${String(cpHit).slice(0, 80)}"`);
    G.G12 = g(!why.length, why.join('; '));
  }
  // G13 — Suno length
  G.G13 = g(sp.length >= 400 && sp.length < 1000, `style prompt is ${sp.length} characters (must be 400-999)`);
  // G14 — Persian script in title and lyrics (kept from the legacy guard)
  G.G14 = g(PERSIAN_RE.test(p.title || '') && PERSIAN_RE.test(p.lyrics || ''), 'title or lyrics are not in Persian script');
  return G;
}

// ── LLM-assisted judge (G4/G5/G6/G7/G2/G11 quality) ─────────────────────────────────────────────────────────────
export const SRVF_CV2_JUDGE_SYSTEM = `You are a strict senior Persian-language songwriter and A&R reviewer for a Persian love-song channel.
You judge one song package and return ONE JSON object only. Be honest and demanding: a 7 means "good enough to release",
8+ means strong. Judge the Persian as a native Afghan/Iranian listener would hear it sung.`;
export function srvfCv2JudgePrompt(pkg, { artist, mood }) {
  return `ARTIST: ${artist}   MOOD: ${mood}
STORY (from writer): ${String(pkg.story || '').slice(0, 600)}
HOOK: ${String(pkg.hook || '').slice(0, 200)}
LYRICS:
${String(pkg.lyrics || '').slice(0, 3500)}

Score 1-10 and give a short English reason (at most 15 words) for each:
- naturalFarsi: natural, singable conversational Persian (about 60% general Farsi / 40% soft Dari-friendly); no stiff literary language, no heavy slang, no awkward or ungrammatical lines
- story: a clear relationship situation between two lovers with emotional progression from Verse 1 to Verse 2
- hook: the Chorus hook is concise, recognizable and suitable for melodic repetition
- contrast: the Chorus is clearly simpler/more memorable than the Verses and gives an emotional/melodic lift; the Final Chorus keeps its identity
- moodFit: the lyrics clearly fit the ${mood} mood (${SRVF_CV2_MOOD_PROFILES[mood].feel.split(';')[0]})
- artistFit: the lyrics fit a ${artist === 'Duet' ? 'male/female duet conversation' : artist.toLowerCase() + ' singer'} singing to a lover
- humanNotAI: sounds written by a human songwriter — no meaningless metaphors, no generic AI poetry, no filler

Return ONLY this JSON object, no other text:
{"naturalFarsi":{"score":0,"reason":""},"story":{"score":0,"reason":""},"hook":{"score":0,"reason":""},"contrast":{"score":0,"reason":""},"moodFit":{"score":0,"reason":""},"artistFit":{"score":0,"reason":""},"humanNotAI":{"score":0,"reason":""}}`;
}
export const SRVF_CV2_JUDGE_MIN = 7;
const JUDGE_TO_GATE = { naturalFarsi: 'G4', story: 'G5', hook: 'G6', contrast: 'G7', moodFit: 'G2', artistFit: 'G1', humanNotAI: 'G11' };
export function srvfCv2ApplyJudge(G, judge) {
  const out = { ...G };
  if (!judge || typeof judge !== 'object') {
    for (const k of ['G4', 'G5', 'G6', 'G7', 'G11']) out[k] = { pass: false, reason: (out[k].pass ? '' : out[k].reason + '; ') + 'quality judge unavailable' };
    return out;
  }
  for (const [dim, gate] of Object.entries(JUDGE_TO_GATE)) {
    const s = Number(judge[dim] && judge[dim].score);
    if (!(s >= SRVF_CV2_JUDGE_MIN)) {
      const r = `${dim} ${isFinite(s) ? s : '?'}/10: ${String(judge[dim] && judge[dim].reason || 'no reason').slice(0, 220)}`;
      out[gate] = { pass: false, reason: out[gate].pass ? r : out[gate].reason + '; ' + r };
    }
  }
  return out;
}

// ── package finalisation (contract-compatible; task selection is authoritative) ─────────────────────────────────
export function srvfCv2ExcludeStyles(modelValue) {
  const extra = String(modelValue || '').split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
  const all = [...SRVF_CV2_EXCLUDE_DEFAULT];
  const low = new Set(all.map(s => s.toLowerCase()));
  const safe = /^[a-z0-9 '&/-]{3,40}$/i;
  let added = 0;
  for (const e of extra) {
    if (added >= 3) break;
    if (!safe.test(e) || low.has(e.toLowerCase()) || /persian|farsi|vocal(?!s? (fx|effects))|piano|guitar|string|love|warm|human/i.test(e)) continue;
    all.push(e); low.add(e.toLowerCase()); added++;
  }
  return all.join(', ');
}
export function srvfCv2ChorusLines(lyrics) {
  const { sections } = srvfCv2Sections(lyrics);
  const c = sections.find(s => s.key === 'CHORUS');
  return c ? c.lines.join('\n') : '';
}
export function srvfCv2Finalize(raw, { artist, mood, gateResults, attempt }) {
  const r = raw || {};
  const s = v => (typeof v === 'string' ? v.trim() : '');
  const chorus = srvfCv2ChorusLines(r.lyrics);
  const pkg = {
    // structured selection — authoritative, never the model's
    mood: mood.toLowerCase(),
    vocal: artist.toLowerCase(),
    artist,
    mode: artist + ' — ' + mood,
    // creative content
    concept: s(r.concept), story: s(r.story),
    title: s(r.title), titleFinglish: s(r.titleFinglish),
    shortTitle: s(r.title).replace(/[^؀-ۿ‌\s]/g, '').replace(/\s+/g, ' ').trim(),
    hook: s(r.hook), lyrics: s(r.lyrics),
    sunoPrompt: s(r.sunoPrompt),
    excludeStyles: srvfCv2ExcludeStyles(r.excludeStyles),
    captionYouTube: s(r.captionYouTube), captionYT: s(r.captionYouTube),
    thumbnailText: s(r.thumbnailText) || s(r.title),
    centralImage: s(r.centralImage), location: s(r.location), hookStructure: s(r.hookStructure).toLowerCase(),
    emotionalScenario: s(r.emotionalScenario), emotionalSubMode: s(r.emotionalSubMode),
    // legacy Long fields kept present (no extra model tokens): derived, never generated separately
    shortLyrics: chorus, shortSunoPrompt: s(r.sunoPrompt),
    captionTikTok: '', captionInstagram: '',
    workflowNotes: 'SRV Farsi Creative V2 — paste sunoPrompt as the Suno style, excludeStyles as Exclude styles, lyrics as lyrics.',
    // additive V2 metadata
    creativeV2: true,
    creativeGateVersion: SRVF_CV2_VERSION,
    creativeGateResults: gateResults || null,
    creativeAttempt: attempt || 1,
  };
  return pkg;
}
export function srvfCv2Failed(G) { return Object.entries(G).filter(([, v]) => !v.pass).map(([gate, v]) => ({ gate, reason: v.reason })); }

// ── Anthropic call ───────────────────────────────────────────────────────────────────────────────────────────────
async function callClaude({ fetchImpl, apiKey, model, system, user, maxTokens, timeoutMs }) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      ...(ctl ? { signal: ctl.signal } : {}),
    });
    if (!r.ok) { const t = await r.text(); throw new Error(`Claude ${r.status}: ${String(t).slice(0, 160)}`); }
    const d = await r.json();
    return { text: (d.content || []).map(b => b.text || '').join(''), usage: d.usage || null };
  } finally { if (timer) clearTimeout(timer); }
}

// ── one attempt: generate → deterministic gates → judge → result ────────────────────────────────────────────────
export async function srvfCv2Attempt({ fetchImpl = globalThis.fetch, apiKey, selection, memory, feedback, attempt = 1, openingIndex }) {
  const { artist, mood } = selection;
  const t0 = Date.now();
  const oi = Number.isInteger(openingIndex) ? openingIndex : Math.floor(Math.random() * SRVF_CV2_OPENINGS.length);
  const gen = await callClaude({ fetchImpl, apiKey, model: SRVF_CV2_GEN_MODEL, system: SRVF_CV2_SYSTEM, user: srvfCv2UserPrompt({ artist, mood, memory, feedback, openingIndex: oi }), maxTokens: 3000, timeoutMs: 150000 });
  const raw = srvfCv2Parse(gen.text);
  const timing = { generateMs: Date.now() - t0 };
  if (!raw) {
    const G = { PARSE: { pass: false, reason: 'model reply was not a JSON object' } };
    return { ok: false, gates: G, failed: srvfCv2Failed(G), raw: null, usage: { gen: gen.usage }, timing };
  }
  let G = srvfCv2DeterministicGates(raw, { artist, mood, memory });
  let judge = null, judgeUsage = null, judgeError = null;
  const t1 = Date.now();
  for (let k = 0; k < 2 && !judge; k++) { // one retry when the judge reply is not usable JSON
    try {
      const j = await callClaude({ fetchImpl, apiKey, model: SRVF_CV2_JUDGE_MODEL, system: SRVF_CV2_JUDGE_SYSTEM, user: srvfCv2JudgePrompt(raw, { artist, mood }), maxTokens: 1500, timeoutMs: 45000 });
      judgeUsage = j.usage;
      const parsed = srvfCv2Parse(j.text);
      if (parsed && Object.keys(JUDGE_TO_GATE).every(d => parsed[d] && isFinite(Number(parsed[d].score)))) judge = parsed;
      else judgeError = 'unusable judge reply: ' + String(j.text || '').slice(0, 240);
    } catch (e) { judgeError = 'judge call failed: ' + String(e && e.message || e).slice(0, 200); }
  }
  timing.judgeMs = Date.now() - t1;
  G = srvfCv2ApplyJudge(G, judge);
  const failed = srvfCv2Failed(G);
  return { ok: failed.length === 0, gates: G, failed, judge, judgeError: judge ? null : judgeError, raw, usage: { gen: gen.usage, judge: judgeUsage }, timing, openingIndex: oi };
}

// ── request handler (called from api/generate.js only for engine 'SRV Farsi' + srvFarsiCreativeV2:true) ─────────
export async function srvfCv2Handle(body, { fetchImpl = globalThis.fetch, apiKey, supabaseUrl, supabaseKey } = {}) {
  const b = body || {};
  const mode = await srvfCv2FlagMode({ fetchImpl, supabaseUrl, supabaseKey });
  if (!srvfCv2Allowed(mode, b.srvFarsiTest === true)) return { status: 200, json: { success: false, code: 'srv_farsi_creative_v2_off', flag: mode } };
  const sel = srvfCv2Selection(b);
  if (!sel.ok) return { status: 200, json: { success: false, code: 'srv_farsi_creative_v2_off', reason: sel.error } }; // not a V2 job → legacy path
  if (!apiKey) return { status: 500, json: { success: false, code: 'srv_farsi_creative_v2_error', error: 'API key not configured.' } };
  const memory = await srvfCv2LoadMemory({ fetchImpl, supabaseUrl, supabaseKey });
  const attempt = Math.max(1, Math.min(9, Number(b.attempt) || 1));
  const feedback = Array.isArray(b.feedback) ? b.feedback.slice(0, 14).map(f => ({ gate: String(f && f.gate || '').slice(0, 8), reason: String(f && f.reason || '').slice(0, 400) })) : [];
  let r;
  try { r = await srvfCv2Attempt({ fetchImpl, apiKey, selection: sel, memory, feedback, attempt }); }
  catch (e) { return { status: 502, json: { success: false, code: 'srv_farsi_creative_v2_error', error: String(e && e.message || e).slice(0, 300) } }; }
  const gateResults = {
    version: SRVF_CV2_VERSION, passed: r.ok, attempt, memoryLoaded: memory.ok,
    gates: r.gates, judge: r.judge || null, judgeError: r.judgeError || null, models: { generate: SRVF_CV2_GEN_MODEL, judge: SRVF_CV2_JUDGE_MODEL },
    timing: r.timing, usage: r.usage, at: new Date().toISOString(),
  };
  if (!r.ok) return { status: 200, json: { success: false, code: 'srv_farsi_creative_v2_gates_failed', failed: r.failed, gateResults, preview: r.raw ? { title: r.raw.title || '', hook: r.raw.hook || '' } : null } };
  const pkg = srvfCv2Finalize(r.raw, { artist: sel.artist, mood: sel.mood, gateResults, attempt });
  return { status: 200, json: { success: true, engineType: 'suno', creativeV2: true, package: pkg } };
}
