// SRV Studio V2 — music identity, generation prompts, Suno style prompts and the deterministic quality
// validator (orders SRV-STUDIO-V2-003, Checkpoint B). Zero dependencies, no I/O except the injected
// flag check, so both generator paths (api/generate.js and api/ops.js) share one definition and the
// whole module is testable offline.
//
// Used ONLY when the SRV Studio V2 flag is on (app_settings.srv_studio_v2_enabled = true). With the flag
// off, both generators run their original SRV English prompts unchanged.
//
// The system owns the identity: the Suno style prompt is assembled here from a fixed V2 core (female
// vocal, Emotional Deep House, Night Drive, no artist names) plus the model's song-specific texture
// notes, after those notes are cleaned. The model writes the song; it cannot change the identity.

export const SRV_STUDIO_V2_VERSION = 'srv-studio-v2-music-1';
export const SRV_STUDIO_V2_FLAG_KEY = 'srv_studio_v2_enabled';

// ── Flag (server side) ────────────────────────────────────────────────────────
// Fails closed: anything other than a readable row whose value is true means OFF (V1 prompts).
let _flagCache = { at: 0, on: false };
export async function srvStudioV2FlagEnabled({ fetchImpl = globalThis.fetch, supabaseUrl, supabaseKey, now = Date.now(), ttlMs = 30000 } = {}) {
  if (!supabaseUrl || !supabaseKey || typeof fetchImpl !== 'function') return false;
  if (now - _flagCache.at < ttlMs) return _flagCache.on;
  let on = false;
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 2500) : null;
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/app_settings?key=eq.${SRV_STUDIO_V2_FLAG_KEY}&select=value`, {
      headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey }, ...(ctl ? { signal: ctl.signal } : {}),
    });
    if (timer) clearTimeout(timer);
    if (r && r.ok) {
      const rows = await r.json();
      const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
      on = v === true || v === 'true' || v === '"true"';
    }
  } catch (_) { on = false; }
  _flagCache = { at: now, on };
  return on;
}
export function _resetSrvStudioV2FlagCache() { _flagCache = { at: 0, on: false }; }

// ── Mood → emotional colour inside the one V2 genre ───────────────────────────
// The task rotation still produces Romantic / Emotional / Happy. V2 keeps every song inside Emotional
// Deep House / Night Drive and uses the mood only for colour, tempo and key.
export const SRV_STUDIO_V2_MOODS = {
  romantic: { label: 'Romantic', colour: 'warm, yearning, intimate', bpm: [118, 122], key: 'warm minor-seventh chords that lift toward major' },
  emotional: { label: 'Emotional', colour: 'melancholic, bittersweet, aching', bpm: [116, 120], key: 'minor key with suspended chords' },
  happy: { label: 'Hopeful', colour: 'glowing, hopeful, quietly euphoric', bpm: [120, 124], key: 'major key with soft seventh chords' },
};
export function srvStudioV2MoodKey(mode) {
  const m = String(mode || '').toLowerCase();
  if (m.includes('romantic')) return 'romantic';
  if (m.includes('happy') || m.includes('hopeful') || m.includes('uplift')) return 'happy';
  return 'emotional';
}

// ── Suno style prompt (system-owned) ──────────────────────────────────────────
export const SRV_STUDIO_V2_STYLE_CORE =
  'emotional deep house, night drive, mature expressive intimate female lead vocal, close-mic breathy verses, soaring open chorus, English lyrics, four-on-the-floor kick, warm sub bass, rolling bassline, lush atmospheric pads, plucked synth arpeggios, cinematic reverb, modern polished mix';
// Words a texture note may not carry into the style prompt: any vocal identity other than the fixed
// female lead, duets/features, childlike or teenage direction, and imitation phrasing.
const NOTE_STRIP_RX = /\b(male|men|man|boy|boys|guy|guys|baritone|tenor|duet|duets|duo|feat|featuring|choir|rap|rapper|child|childlike|childish|kid|kids|teen|teens|teenage|teenager|girlish|schoolgirl|little girl|young girl|baby voice|vocals?|voice|singer|style|styled|sounds like|similar to|inspired by)\b/gi;
export function cleanSrvStudioV2StyleNotes(notes) {
  // A note that mentions anything off-identity is dropped whole (never left half-sentence).
  const items = String(notes || '').replace(/[\r\n;]+/g, ',').split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length > 2);
  const keep = items.filter((x) => {
    NOTE_STRIP_RX.lastIndex = 0;
    if (NOTE_STRIP_RX.test(x)) return false;
    if (/\b\d{2,3}\s*bpm\b/i.test(x)) return false;
    return !SRV_STUDIO_V2_ARTIST_NAMES.some((n) => new RegExp('(^|[^a-z])' + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(x.toLowerCase()));
  });
  let out = '';
  for (const x of keep.slice(0, 6)) { const next = out ? out + ', ' + x : x; if (next.length > 160) break; out = next; }
  return out;
}
export function clampSrvStudioV2Bpm(bpm, moodKey) {
  const [lo, hi] = (SRV_STUDIO_V2_MOODS[moodKey] || SRV_STUDIO_V2_MOODS.emotional).bpm;
  const n = Math.round(Number(bpm));
  if (!isFinite(n)) return Math.round((lo + hi) / 2);
  return Math.min(hi, Math.max(lo, n));
}
export function buildSrvStudioV2SunoPrompt({ format, bpm, moodKey, notes }) {
  const mood = SRV_STUDIO_V2_MOODS[moodKey] || SRV_STUDIO_V2_MOODS.emotional;
  const tail = format === 'short'
    ? '0:30 runtime, vocal starts at 0:00 with the hook, no instrumental intro, chorus energy throughout, clean ending on the hook'
    : 'full song, short atmospheric intro, verse, pre-chorus, chorus, second verse, bridge, final chorus, 3:00-3:30 runtime, end at [Outro]';
  const cleaned = cleanSrvStudioV2StyleNotes(notes);
  return [SRV_STUDIO_V2_STYLE_CORE, `${clampSrvStudioV2Bpm(bpm, moodKey)} BPM`, `${mood.colour} mood`, mood.key, cleaned, tail].filter(Boolean).join(', ');
}

// ── Generation prompt ─────────────────────────────────────────────────────────
export const SRV_STUDIO_V2_SYSTEM = `You are the songwriter for SRV Studio, an English music channel. Every song is an original Emotional Deep House / Night Drive record sung by one mature, expressive, intimate female artist.

═══════════ MUSIC IDENTITY (fixed) ═══════════
• Language: natural, contemporary English only.
• Artist: one adult female lead vocalist, mature and expressive. Never male. Never a duet or a feature. Never teenage or childlike in voice, wording or situation.
• Genre: Emotional Deep House with a Night Drive atmosphere — late-night, cinematic, moving, intimate.
• Never name, quote or imitate a real artist, band or existing song.

═══════════ WHAT THE SONGS ARE ABOUT ═══════════
Adult love and longing told as a story: wanting someone, missing someone, choosing someone, almost losing someone, coming back, letting go, holding on. The relationship is the subject. Night, motion and the city may set the atmosphere (headlights, empty highways, passenger seat, streetlights, 2am), but the song is about the feeling between two people, never about the place.

═══════════ SONGWRITING STANDARD ═══════════
• Open with the hook: the first sung line is the strongest line in the song.
• The chorus repeats ONE memorable phrase (the hook or a close variant) and lands on it.
• Every line singable in one breath: 4-9 words, natural stresses, no tongue-twisters.
• Concrete, specific images over abstractions. Each verse moves the story forward.
• Leave space for the groove: short phrases, room for the drop after the chorus.
• Avoid clichés: "I can't live without you", "you're my everything", "tears rolling down", "my heart is broken", "love is blind", "set my soul on fire", "dancing in the dark", "lost in your eyes".
• No kiss-centred concepts or titles. No explicit content.
• Titles: 2-6 words, original, sound like a real release. Never use "Deep House", "Night Drive", "Emotional", "Remix", "SRV", "Song" or "Lyrics" in a title.
• The new song must be clearly different from every title, concept and hook in the avoid list.

═══════════ ARRANGEMENTS ═══════════
LONG (full release, about 3:00-3:30):
[Intro] (instrumental, no lyrics) · [Verse 1] 4 lines · [Pre-Chorus] 2 lines · [Chorus] 4 lines · [Verse 2] 4 lines · [Pre-Chorus] 2 lines · [Chorus] 4 lines · [Bridge] 2-4 lines · [Final Chorus] 4 lines · [Outro] (instrumental or one echoed hook line)
SHORT (standalone 30 seconds): 4-6 lines, no section labels, line 1 is the hook, the chorus phrase lands by line 3-4, ends on the hook.
Always write BOTH: the full song in "lyrics" and the 30-second version in "shortLyrics" (built from the hook and chorus). The requested format decides which one must be strongest.

═══════════ OUTPUT ═══════════
Return ONLY one JSON object, no markdown, no preamble:
{
  "title": "original 2-6 word title",
  "concept": "one sentence: who wants what from whom, and what is at stake",
  "emotionalStory": "two sentences: the story arc from first line to last",
  "loveSituation": "short label, e.g. 'coming back after leaving'",
  "hook": "the hook line exactly as sung",
  "lyrics": "full LONG song with the section labels above",
  "shortLyrics": "4-6 line 30-second version, no labels",
  "bpm": 116-124,
  "styleNotes": "3-6 short production texture notes for THIS song (instruments, sound design, energy) — no vocal or gender words, no artist names, no BPM",
  "captionYouTube": "hook line, two sentences about the song, a call to listen, then 5-8 hashtags including #SRVStudio",
  "captionTikTok": "one line plus 3 hashtags including #SRVStudio",
  "captionInstagram": "2-3 lines plus hashtags including #SRVStudio",
  "hashtags": "5-8 hashtags including #SRVStudio",
  "vocal": "female"
}`;

export function buildSrvStudioV2UserPrompt({ isLong, mode, avoidText = '', taskName = '' }) {
  const moodKey = srvStudioV2MoodKey(mode);
  const mood = SRV_STUDIO_V2_MOODS[moodKey];
  return `Write a new SRV Studio song.
Format requested: ${isLong ? 'LONG (full release) — the full "lyrics" are the product' : 'SHORT (30-second standalone) — "shortLyrics" are the product'}
Emotional colour: ${mood.label} — ${mood.colour}. Tempo ${mood.bpm[0]}-${mood.bpm[1]} BPM.
${taskName ? 'Task: ' + taskName + '\n' : ''}
AVOID LIST — the new title, concept and hook must be clearly different from all of these:
${String(avoidText || '(none yet)').slice(0, 9000)}

Return the JSON object only.`;
}

// Parses a model reply into an object (JSON, optionally inside <package> tags or code fences).
export function parseSrvStudioV2Reply(raw) {
  const text = String(raw || '').trim();
  const tries = [];
  const tag = text.match(/<package>([\s\S]*?)<\/package>/i); if (tag) tries.push(tag[1]);
  tries.push(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, ''));
  const brace = text.match(/\{[\s\S]*\}/); if (brace) tries.push(brace[0]);
  for (const t of tries) { try { const o = JSON.parse(t.trim()); if (o && typeof o === 'object') return o; } catch (_) { /* next */ } }
  return null;
}

// Turns the model's object into the package shape both generators return, with the system-owned
// Suno prompts and the validation report attached.
export function finalizeSrvStudioV2Package(raw, { isLong, mode, recentTitles = [] } = {}) {
  const moodKey = srvStudioV2MoodKey(mode || raw.mood);
  const bpm = clampSrvStudioV2Bpm(raw.bpm, moodKey);
  const notes = raw.styleNotes || '';
  const shortLyrics = String(raw.shortLyrics || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l)).join('\n');
  const title = String(raw.title || '').replace(/\s+/g, ' ').trim();
  let hashtags = String(raw.hashtags || '').trim();
  if (!/#SRVStudio\b/i.test(hashtags)) hashtags = (hashtags + ' #SRVStudio').trim();
  const caption = String(raw.captionYouTube || raw.captionYT || '').trim();
  const pkg = {
    title, shortTitle: title,
    concept: String(raw.concept || '').trim(), emotionalStory: String(raw.emotionalStory || '').trim(),
    loveSituation: String(raw.loveSituation || '').trim(), hook: String(raw.hook || '').trim(),
    mood: (mode && String(mode).includes('—') ? String(mode).split('—')[1].trim() : SRV_STUDIO_V2_MOODS[moodKey].label),
    vocal: 'female', bpm, styleNotes: cleanSrvStudioV2StyleNotes(notes),
    lyrics: String(raw.lyrics || '').trim(), shortLyrics,
    sunoPrompt: buildSrvStudioV2SunoPrompt({ format: 'long', bpm, moodKey, notes }),
    shortSunoPrompt: buildSrvStudioV2SunoPrompt({ format: 'short', bpm, moodKey, notes }),
    captionYouTube: caption, captionYT: caption,
    captionTikTok: String(raw.captionTikTok || '').trim(), captionInstagram: String(raw.captionInstagram || '').trim(),
    hashtags, thumbnailText: title, contentFormat: isLong ? 'long' : 'short',
  };
  const validation = srv2ValidatePackage(pkg, { isLong: !!isLong, recentTitles });
  pkg.srvStudioV2 = { version: SRV_STUDIO_V2_VERSION, moodKey, score: validation.score, hardFail: validation.hardFail, failed: validation.checks.filter((c) => c.status === 'fail').map((c) => c.id), warned: validation.checks.filter((c) => c.status === 'warn').map((c) => c.id) };
  if (raw.vocal && String(raw.vocal).toLowerCase() !== 'female') pkg.srvStudioV2.modelVocalField = String(raw.vocal);
  return { pkg, validation };
}

// <srv-v2-validator> — this block is copied byte-for-byte into public/index.html (a test enforces it).
const SRV_STUDIO_V2_ARTIST_NAMES=['Taylor Swift','Olivia Rodrigo','Gracie Abrams','Sabrina Carpenter','Billie Eilish','Lana Del Rey','Dua Lipa','Ellie Goulding','Adele','Rihanna','Beyonce','Beyoncé','Ariana Grande','Selena Gomez','Lorde','Halsey','Zara Larsson','Jess Glynne','Kygo','Lane 8','RÜFÜS','Rufus Du Sol','Disclosure','Calvin Harris','Avicii','Odesza','Bob Moses','Fred again','Fisher','Chris Lake','Tinlicker','Yotto','Le Youth','Gorgon City','MK','Duke Dumont','Purple Disco Machine','The Weeknd','Drake','Ed Sheeran','Coldplay'];
const SRV2_MALE_RX=/\b(male|men|man|boy|boys|guy|guys|baritone|tenor|duet|duets|duo|feat|featuring|rapper|rap verse|choir of men|bass singer)\b/i;
const SRV2_CHILD_RX=/\b(child|childlike|childish|kid|kids|teen|teens|teenage|teenager|girlish|schoolgirl|little girl|young girl|baby voice|nursery)\b/i;
const SRV2_LYRIC_AGE_RX=/\b(school|schoolgirl|homework|recess|my mom says|curfew|sixteen|fifteen|fourteen|teen|teenage)\b/i;
const SRV2_DUET_TAG_RX=/^\s*[\[(]\s*(male|man|him|he|guy|boy|both|duet|together|all|feat[^\])]*)\s*[\])]/im;
const SRV2_IMITATE_RX=/\b(in the style of|sounds like|similar to|inspired by|cover of|reminiscent of)\b/i;
const SRV2_CLICHES=["i can't live without you","you're my everything","tears rolling down","my heart is broken","love is blind","set my soul on fire","dancing in the dark","lost in your eyes","you complete me","meant to be","forever and always","heart of gold"];
const SRV2_TITLE_FORBIDDEN_RX=/\b(deep house|night drive|emotional|remix|feat|featuring|srv|song|lyrics?|official|edit|version)\b/i;
const SRV2_GENERIC_TITLES=['love','night','drive','tonight','forever','you','us','home','stay','dreams','alone','heart','midnight','feelings','emotions'];
const SRV2_HOUSE_ELEMENTS=['four-on-the-floor','four on the floor','sub bass','bassline','pads','arpeggio','sidechain','house kick','groove','synth'];
const SRV2_NIGHT_IMAGERY=['night','midnight','2am','3am','headlights','highway','road','drive','driving','passenger','dashboard','streetlight','street lights','city lights','neon','moon','window down','windows down','freeway','exit','tail lights','taillights','radio','miles','engine','rearview','lane','dark'];
const SRV2_ENGLISH_STOP=new Set(['the','and','you','i','me','my','your','we','to','a','in','of','it','on','is','im',"i'm",'dont',"don't",'all','so','be','that','this','but','for','with','just','when','if','all','are','what','like','love','know','can','do','its',"it's",'was','were','our','us','no','not','at','still','where','back','now','one','up','out','go','let','into','from','am','been','have','had','say','said','tell','why','how','every','never','again']);

function srv2Words(s){return String(s||'').toLowerCase().replace(/[^a-z0-9'\s]/g,' ').split(/\s+/).filter(Boolean);}
function srv2SungLines(text){return String(text||'').split('\n').map(function(l){return l.trim();}).filter(function(l){return l&&!/^\[.*\]$/.test(l)&&!/^\(.*\)$/.test(l);});}
function srv2Jaccard(a,b){const A=new Set(srv2Words(a)),B=new Set(srv2Words(b));if(!A.size||!B.size)return 0;let n=0;A.forEach(function(w){if(B.has(w))n++;});return n/(A.size+B.size-n);}
function srv2Contain(part,whole){const A=srv2Words(part),B=new Set(srv2Words(whole));if(!A.length)return 0;return A.filter(function(w){return B.has(w);}).length/A.length;}
function srv2Sections(text){const out=[];String(text||'').split('\n').forEach(function(l){const m=l.trim().match(/^\[([^\]]+)\]$/);if(m)out.push(m[1].toLowerCase());});return out;}
function srv2HasArtist(text){const t=String(text||'').toLowerCase();return SRV_STUDIO_V2_ARTIST_NAMES.filter(function(n){return new RegExp('(^|[^a-z])'+n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z]|$)').test(t);});}

// Deterministic checks for one SRV Studio V2 package. It judges the TEXT (lyrics, prompts, title) the
// operator and Suno receive. It cannot hear or guarantee the gender of an actual generated voice.
function srv2ValidatePackage(pkg,opts){
  opts=opts||{};
  const isLong=!!opts.isLong;
  const p=pkg||{};
  const lyr=isLong?String(p.lyrics||''):String(p.shortLyrics||'');
  const prompt=isLong?String(p.sunoPrompt||''):String(p.shortSunoPrompt||'');
  const bothPrompts=String(p.sunoPrompt||'')+' \n '+String(p.shortSunoPrompt||'');
  const allLyrics=String(p.lyrics||'')+'\n'+String(p.shortLyrics||'');
  const checks=[];
  const add=function(id,label,status,detail,hard){checks.push({id:id,label:label,status:status,detail:detail||'',hard:!!hard});};

  // 1. Female-only vocal direction (text only)
  const maleHit=(bothPrompts.match(SRV2_MALE_RX)||[])[0];
  const childHit=(bothPrompts.match(SRV2_CHILD_RX)||[])[0];
  const duetTag=SRV2_DUET_TAG_RX.test(allLyrics);
  const femaleNamed=/\bfemale\b/i.test(prompt);
  const vocalField=p.vocal==null||String(p.vocal).toLowerCase()==='female';
  if(maleHit||childHit||duetTag||!vocalField)add('female','Female-only vocal direction','fail',maleHit?'Suno prompt mentions "'+maleHit+'"':childHit?'Suno prompt has childlike/teen direction "'+childHit+'"':duetTag?'Lyrics contain a duet or male part label':'Package vocal field is "'+p.vocal+'"',true);
  else if(!femaleNamed)add('female','Female-only vocal direction','fail','Suno prompt does not ask for a female vocal',true);
  else add('female','Female-only vocal direction','pass','Prompt asks for a female lead; no male, duet or childlike direction found');
  const ageHit=(allLyrics.match(SRV2_LYRIC_AGE_RX)||[])[0];
  add('adult','Adult perspective in lyrics',ageHit?'warn':'pass',ageHit?'Lyrics mention "'+ageHit+'" — check the song does not read as teenage':'No school/teen age markers in the lyrics');

  // 2. English-language lyrics
  const letters=(lyr.match(/\p{L}/gu)||[]).length;
  const latin=(lyr.match(/[A-Za-z]/g)||[]).length;
  const words=srv2Words(lyr);
  const stopShare=words.length?words.filter(function(w){return SRV2_ENGLISH_STOP.has(w);}).length/words.length:0;
  if(!letters)add('english','English-language lyrics','fail','No lyrics',true);
  else if(latin/letters<0.98)add('english','English-language lyrics','fail',Math.round((1-latin/letters)*100)+'% of letters are not Latin script',true);
  else if(stopShare<0.2)add('english','English-language lyrics','warn','Few common English words ('+Math.round(stopShare*100)+'%) — check the language');
  else add('english','English-language lyrics','pass','Latin script, '+Math.round(stopShare*100)+'% common English words');

  // 3. No artist imitation
  const artists=srv2HasArtist(bothPrompts+'\n'+allLyrics+'\n'+(p.title||''));
  const imitate=SRV2_IMITATE_RX.test(bothPrompts);
  if(artists.length||imitate)add('original','No artist imitation','fail',artists.length?'Mentions '+artists.join(', '):'Prompt asks to imitate another artist',true);
  else add('original','No artist imitation','pass','No artist names or imitation phrasing');

  // 4. Emotional Deep House compatibility
  const bpmMatch=prompt.match(/\b(\d{2,3})\s*bpm\b/i);
  const bpm=bpmMatch?Number(bpmMatch[1]):null;
  const houseEls=SRV2_HOUSE_ELEMENTS.filter(function(e){return prompt.toLowerCase().includes(e);}).length;
  if(!/deep house/i.test(prompt))add('deephouse','Emotional Deep House compatibility','fail','Suno prompt does not name deep house',true);
  else if(!bpm||bpm<112||bpm>126)add('deephouse','Emotional Deep House compatibility','fail',bpm?bpm+' BPM is outside the deep house range (112-126)':'No BPM in the Suno prompt',true);
  else if(houseEls<2)add('deephouse','Emotional Deep House compatibility','warn','Only '+houseEls+' house production element named');
  else add('deephouse','Emotional Deep House compatibility','pass','Deep house, '+bpm+' BPM, '+houseEls+' house elements');

  // 5. Night Drive atmosphere
  const imagery=SRV2_NIGHT_IMAGERY.filter(function(w){return new RegExp('\\b'+w+'\\b','i').test(allLyrics);});
  if(!/night drive/i.test(prompt))add('nightdrive','Night Drive atmosphere','fail','Suno prompt does not name night drive');
  else if(!imagery.length)add('nightdrive','Night Drive atmosphere','warn','Prompt sets night drive, but the lyrics carry no night or motion image');
  else add('nightdrive','Night Drive atmosphere','pass','Prompt sets night drive; lyrics use '+imagery.slice(0,4).join(', '));

  // 6. Title originality
  const title=String(p.title||'').trim();
  const tw=srv2Words(title);
  const recent=(opts.recentTitles||[]).filter(Boolean);
  const exact=recent.find(function(r){return srv2Words(r).join(' ')===tw.join(' ');});
  const close=recent.map(function(r){return{r:r,j:srv2Jaccard(r,title)};}).filter(function(x){return x.j>=0.6;}).sort(function(a,b){return b.j-a.j;})[0];
  if(!title)add('title','Title originality','fail','No title',true);
  else if(SRV2_TITLE_FORBIDDEN_RX.test(title))add('title','Title originality','fail','Title contains a genre/label word ("'+(title.match(SRV2_TITLE_FORBIDDEN_RX)||[])[0]+'")');
  else if(exact)add('title','Title originality','fail','Same title as an earlier song: "'+exact+'"');
  else if(close)add('title','Title originality','warn','Very close to an earlier title: "'+close.r+'"');
  else if(tw.length===1&&SRV2_GENERIC_TITLES.includes(tw[0]))add('title','Title originality','warn','One-word generic title');
  else if(tw.length<2||tw.length>6)add('title','Title originality','warn',tw.length+' words (2-6 recommended)');
  else add('title','Title originality','pass',tw.length+' words, not used before'+(recent.length?' (checked against '+recent.length+' earlier titles)':''));

  // 7. Hook and chorus quality
  const sung=srv2SungLines(lyr);
  const hook=String(p.hook||'').trim()||sung[0]||'';
  const hookWords=srv2Words(hook).length;
  const firstLines=sung.slice(0,2).join(' ');
  const hookOpens=!!hook&&srv2Contain(hook,firstLines)>=0.7;
  const lines=String(lyr).split('\n');
  let chorusText='';let inChorus=false;
  lines.forEach(function(l){const m=l.trim().match(/^\[([^\]]+)\]$/);if(m){inChorus=/chorus/i.test(m[1])&&!/pre/i.test(m[1]);return;}if(inChorus)chorusText+=' '+l;});
  const hookLead=srv2Words(hook).slice(0,3).join(' ');
  const hookInChorus=isLong?(!!chorusText&&(srv2Contain(hook,chorusText)>=0.6||(hookLead.split(' ').length===3&&srv2Words(chorusText).join(' ').includes(hookLead)))):true;
  const cliches=SRV2_CLICHES.filter(function(c){return allLyrics.toLowerCase().includes(c);});
  const longLines=sung.filter(function(l){return srv2Words(l).length>12;}).length;
  const distinct=new Set(sung.map(function(l){return l.toLowerCase();})).size;
  const distinctShare=sung.length?distinct/sung.length:0;
  const hookIssues=[];
  if(!hook)hookIssues.push('no hook');
  if(hookWords>14)hookIssues.push('hook is '+hookWords+' words');
  if(!hookOpens)hookIssues.push('the song does not open with the hook');
  if(!hookInChorus)hookIssues.push('the chorus does not carry the hook');
  if(cliches.length)hookIssues.push('cliché: '+cliches.join(', '));
  if(longLines)hookIssues.push(longLines+' line(s) over 12 words');
  if(distinctShare<(isLong?0.45:0.5))hookIssues.push('too repetitive ('+Math.round(distinctShare*100)+'% distinct lines)');
  if(!hook||hookIssues.length>=3)add('hook','Hook and chorus quality','fail',hookIssues.join('; '));
  else if(hookIssues.length)add('hook','Hook and chorus quality','warn',hookIssues.join('; '));
  else add('hook','Hook and chorus quality','pass','Opens with a '+hookWords+'-word hook'+(isLong?' that the chorus repeats':'')+'; singable lines; no clichés');

  // 8. Long / Short format
  const fmtIssues=[];
  if(isLong){
    const sec=srv2Sections(p.lyrics);
    const choruses=sec.filter(function(s){return /chorus/.test(s)&&!/pre/.test(s);}).length;
    if(!sec.some(function(s){return /verse 1|verse$/.test(s);}))fmtIssues.push('no [Verse 1]');
    if(!sec.some(function(s){return /verse 2/.test(s);}))fmtIssues.push('no [Verse 2]');
    if(choruses<2)fmtIssues.push(choruses+' chorus section(s), needs 2+');
    if(!sec.some(function(s){return /bridge/.test(s);}))fmtIssues.push('no [Bridge]');
    const n=srv2SungLines(p.lyrics).length;
    if(n<18||n>40)fmtIssues.push(n+' sung lines (18-40 expected)');
    if(!/3:\d\d/.test(String(p.sunoPrompt||'')))fmtIssues.push('Suno prompt has no 3-minute runtime');
  }else{
    const n=srv2SungLines(p.shortLyrics).length;
    if(n<4||n>8)fmtIssues.push(n+' short lines (4-8 expected)');
    if(/\[[^\]]+\]/.test(String(p.shortLyrics||'')))fmtIssues.push('short lyrics contain section labels');
    if(!/0:30/.test(String(p.shortSunoPrompt||'')))fmtIssues.push('short Suno prompt has no 0:30 runtime');
    if(!/0:00/.test(String(p.shortSunoPrompt||'')))fmtIssues.push('short Suno prompt does not start the vocal at 0:00');
  }
  if(fmtIssues.length>=2)add('format',isLong?'Long arrangement':'Short (30s) arrangement','fail',fmtIssues.join('; '),true);
  else if(fmtIssues.length)add('format',isLong?'Long arrangement':'Short (30s) arrangement','warn',fmtIssues.join('; '));
  else add('format',isLong?'Long arrangement':'Short (30s) arrangement','pass',isLong?'Verses, 2+ choruses, bridge, 3-minute runtime':'4-8 unlabelled lines, 0:30 runtime, vocal at 0:00');

  const weights={female:2,english:1.5,original:1,deephouse:1.5,nightdrive:1,title:1,hook:1.5,format:1,adult:0.5};
  let total=0,got=0;
  checks.forEach(function(c){const w=weights[c.id]||1;total+=w;got+=c.status==='pass'?w:c.status==='warn'?w*0.5:0;});
  const hardFail=checks.some(function(c){return c.hard&&c.status==='fail';});
  const raw=total?Math.round(got/total*100)/10:0;
  const score=hardFail?Math.min(raw,4):raw;
  const label=hardFail?'Fails SRV Studio direction':score>=9?'Excellent':score>=8?'Good':score>=7?'Review carefully':'Recommend regenerate';
  return {version:'srv2-validator-1',score:score,label:label,hardFail:hardFail,checks:checks};
}
// </srv-v2-validator>

export { srv2ValidatePackage, SRV_STUDIO_V2_ARTIST_NAMES };
