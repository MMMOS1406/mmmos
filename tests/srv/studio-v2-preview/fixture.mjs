// SRV Studio V2 preview — SAMPLE DATA ONLY. Every task, package and lyric here is invented for the
// CEO's interactive test of Checkpoint A. Nothing is read from, copied from or derived from production.
import { makeFixture } from '../../preservation/fixtures.mjs';
import { finalizeSrvStudioV2Package } from '../../../lib/srvStudioV2Music.mjs';
import { V2_SAMPLE_REPLIES } from './v2-samples.mjs';
import { srv2AvatarPick, SRV_STUDIO_V2_AVATAR_REGISTRY_VERSION } from '../../../lib/srvStudioV2Avatars.mjs';

// Checkpoint B: a V2 package exactly as the real generators return it — the sample model reply run
// through the real finalizeSrvStudioV2Package() (system-owned Suno prompts, BPM, validation summary).
export function v2SamplePackage(n, { isLong, mode, recentTitles = [] }) {
  const raw = n < V2_SAMPLE_REPLIES.length ? V2_SAMPLE_REPLIES[n] : { ...sampleGeneratedPackage(n - V2_SAMPLE_REPLIES.length + 4), styleNotes: 'warm pads, rolling bassline, soft vocal-chop echoes', bpm: 120 };
  return finalizeSrvStudioV2Package(raw, { isLong, mode, recentTitles }).pkg;
}

const SAMPLES = [
  {
    title: 'Stay Until the Sunrise', mood: 'Female — Emotional', concept: 'She asks him to stay one more night before he leaves for good',
    hook: 'stay until the sunrise, I am not ready to say goodbye',
    lyrics: '[HOOK]\nStay until the sunrise\nI am not ready to say goodbye\n\n[VERSE 1]\nYour keys are on the counter\nBut your hand is still in mine\nWe keep saying one more song\nLike we can stop the time\n\n[PRE-CHORUS]\nDon\'t look at the clock\nJust look at me\n\n[CHORUS]\nStay until the sunrise\nHold me through the night\nIf this is the last time\nLet it feel like the first time\n\n[BRIDGE]\nTomorrow can wait\nTonight is ours\n\n[FINAL CHORUS]\nStay until the sunrise\nI am not ready to say goodbye',
    shortLyrics: 'Stay until the sunrise\nI am not ready to say goodbye\nIf this is the last time\nLet it feel like the first time',
    sunoPrompt: 'emotional deep house, night drive, warm intimate female vocal, 120 BPM, soft four-on-the-floor kick, airy pads, plucked synth arpeggio, sidechained bass, melancholic chords, clean radio mix, English, 3:00-3:20',
    shortSunoPrompt: 'emotional deep house, female vocal from 0:00, hook and chorus only, 120 BPM, night drive mood, 0:30, no intro silence',
  },
  {
    title: 'Say My Name Slow', mood: 'Female — Romantic', concept: 'Falling for someone who makes her feel seen for the first time',
    hook: 'say my name slow, like you mean it',
    lyrics: '[HOOK]\nSay my name slow\nLike you mean it\n\n[VERSE 1]\nYou never rush a moment\nYou let it breathe\nAnd every time you smile at me\nI forget to leave\n\n[PRE-CHORUS]\nI\'ve been waiting for someone\nWho wants to stay\n\n[CHORUS]\nSay my name slow\nLet it linger in the air\nSay my name slow\nTell me you\'ll be there\n\n[BRIDGE]\nNo one ever said it\nThe way you do\n\n[FINAL CHORUS]\nSay my name slow\nLike you mean it',
    shortLyrics: 'Say my name slow\nLike you mean it\nSay my name slow\nTell me you\'ll be there',
    sunoPrompt: 'emotional deep house, night drive, breathy female vocal, 118 BPM, deep sub bass, shimmering pads, muted guitar loop, late-night city feel, English, 3:00-3:20',
    shortSunoPrompt: 'deep house, breathy female vocal from 0:00, hook only, 118 BPM, 0:30',
  },
  {
    title: 'Don\'t Let Me Go Tonight', mood: 'Female — Emotional', concept: 'Holding on to a love that is slipping away',
    hook: 'don\'t let me go tonight, not like this',
    lyrics: '[HOOK]\nDon\'t let me go tonight\nNot like this\n\n[VERSE 1]\nWe used to talk till morning\nNow we barely say a word\nI still reach for you at midnight\nHoping I am heard\n\n[CHORUS]\nDon\'t let me go tonight\nHold on a little longer\nIf you still feel it too\nLove can make us stronger\n\n[FINAL CHORUS]\nDon\'t let me go tonight\nNot like this',
    shortLyrics: 'Don\'t let me go tonight\nNot like this\nHold on a little longer\nLove can make us stronger',
    sunoPrompt: 'emotional deep house, night drive, aching female vocal, 122 BPM, rolling bassline, reverb piano chords, soft vocal chops, English, 3:00-3:20',
    shortSunoPrompt: 'emotional deep house, female vocal from 0:00, chorus only, 122 BPM, 0:30',
  },
  {
    title: 'Faded Into You', mood: 'Female — Romantic', concept: 'Losing herself completely in someone new',
    hook: 'I faded into you and never looked back',
    lyrics: '[HOOK]\nI faded into you\nAnd never looked back\n\n[VERSE 1]\nThe radio is playing low\nYour hand is on my knee\nI don\'t know where we\'re going\nBut you\'re all I need\n\n[CHORUS]\nI faded into you\nLike the night into the blue\nEverything I knew\nFaded into you',
    shortLyrics: 'I faded into you\nLike the night into the blue\nEverything I knew\nFaded into you',
    sunoPrompt: 'emotional deep house, night drive, soft female vocal, 120 BPM, warm analog pads, slow filter sweeps, English, 3:00-3:20',
    shortSunoPrompt: 'deep house, soft female vocal from 0:00, chorus only, 120 BPM, 0:30',
  },
];

// Packages produced by Generate / Regenerate in the preview: each one is a distinct song (distinct
// title, hook and concept words) so the app's real duplicate-package check does not fire on them.
const GEN_WORDS = [
  ['Midnight Promise', 'promise', 'keeping a promise made at midnight'], ['Golden Hour Heart', 'golden', 'a heart that glows when he calls'],
  ['Neon Tears', 'neon', 'crying in the passenger seat and smiling anyway'], ['Echoes of You', 'echoes', 'hearing his voice in every song on the radio'],
  ['Slow Motion Love', 'motion', 'wanting a first touch to last forever'], ['Paper Wings', 'wings', 'trusting someone enough to fall'],
  ['Silver Lining Kiss', 'silver', 'finding hope after the fight'], ['Velvet Highway', 'velvet', 'driving to see him through the night'],
  ['Fireflies and You', 'fireflies', 'small bright moments that add up to love'], ['Moonlit Confession', 'confession', 'finally admitting what she feels'],
  ['After the Rain', 'rain', 'starting again together'], ['Starlight Echo', 'starlight', 'missing him from far away'],
];
export function sampleGeneratedPackage(n) {
  if (n < SAMPLES.length) return pkgFrom(SAMPLES[n], SAMPLES[n].title, SAMPLES[n].concept, SAMPLES[n].hook);
  const k = n - SAMPLES.length; const [base, word, concept] = GEN_WORDS[k % GEN_WORDS.length];
  const round = Math.floor(k / GEN_WORDS.length);
  const title = round ? `${base} ${['Reprise', 'Afterglow', 'Encore', 'Nightfall'][(round - 1) % 4]}${round > 4 ? ' ' + round : ''}` : base;
  const s = SAMPLES[k % SAMPLES.length];
  const hook = `${word} ${title.toLowerCase()}, I feel it every time`;
  const lyrics = `[HOOK]\n${title}\nI feel it every time\n\n[VERSE 1]\nThis is ${concept}\nAnd I can't hide it anymore\n\n[CHORUS]\n${title}\nStay with me tonight\n${title}\nHold on, hold on tight`;
  const shortLyrics = `${title}\nI feel it every time\n${title}\nHold on, hold on tight`;
  return pkgFrom({ ...s, lyrics, shortLyrics }, title, `${concept} (${word})`, hook);
}
function pkgFrom(s, title, concept, hook) {
  return {
    mood: s.mood, vocal: 'female', loveSituation: concept, concept,
    title, shortTitle: title, hook, lyrics: s.lyrics, shortLyrics: s.shortLyrics,
    sunoPrompt: s.sunoPrompt, shortSunoPrompt: s.shortSunoPrompt, thumbnailText: title,
    captionYouTube: `${hook}\nA new SRV Studio song.\nSubscribe for more.\n#SRVStudio #DeepHouse #NightDrive`,
    captionTikTok: hook + ' #SRVStudio', captionInstagram: hook + ' #SRVStudio', hashtags: '#SRVStudio #DeepHouse #NightDrive',
  };
}

// Deterministic stand-in for the server's srv_english_regen_caption (the real one calls the model).
export function sampleCaption(title, lyrics) {
  const first = String(lyrics || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('[')) || title;
  return {
    ok: true,
    captionYT: `${first}\n"${title}" is a new SRV Studio song about love that won't let go.\nA late-night drive in sound, sung from the heart.\nListen with headphones and subscribe for more.\n#SRVStudio #DeepHouse #NightDrive #EmotionalMusic`,
    hashtags: '#SRVStudio #DeepHouse #NightDrive #EmotionalMusic',
  };
}

export function makeStudioFixture(now = Date.now()) {
  const base = makeFixture();
  const state = JSON.parse(base.settings.mmm_finance_v118);
  const day = (o) => new Date(now + o * 86400000).toISOString().slice(0, 10);
  const created = now - 3600e3;
  const t = (id, format, stage, offset) => ({
    id, engine: 'SRV English', status: 'assigned', isTest: true, autoCreated: false, platform: 'All',
    name: `SRV English — Female · ${format} [PREVIEW TEST]`, mode: id % 2 ? 'Female — Emotional' : 'Female — Romantic',
    mood: id % 2 ? 'Female — Emotional' : 'Female — Romantic', contentType: format === 'Long' ? 'Long' : 'Short Video',
    contentFormat: format === 'Long' ? 'long' : 'short', isLong: format === 'Long', isoDate: day(offset),
    day: new Date(now + offset * 86400000).toLocaleDateString('en-US', { weekday: 'long' }), channel: 'SRV Studio',
    createdAt: created + id, assignmentReason: '[manual-test] SRV Studio V2 preview', _previewStage: stage,
  });
  const tasks = [t(201, 'Short', 'generate', 0), t(202, 'Short', 'review', 0), t(203, 'Long', 'review', 1), t(204, 'Short', 'build', 1), t(205, 'Long', 'approve', 2)];
  const stages = { __identityEpoch: created - 60000 };
  const packages = [];
  const avatarHistory = [];
  tasks.forEach((task, i) => {
    const uid = `srve_${task.createdAt}_${task.id}`;
    task.srvUid = uid;
    if (task._previewStage !== 'generate') {
      task.status = 'generating'; // what the real generatePackage() leaves behind (the Checkpoint A header bug)
      stages[uid] = task._previewStage; stages[String(task.id)] = task._previewStage;
      // #202 Short, #203 Long, #205 Long carry V2 packages; #204 keeps a pre-V2 package so the
      // "generated before the V2 music direction" note can be seen.
      const v2Idx = { 202: 0, 203: 1, 205: 3 }[task.id];
      const s = v2Idx != null ? v2SamplePackage(v2Idx, { isLong: task.contentFormat === 'long', mode: task.mood }) : sampleGeneratedPackage(i - 1);
      const pkg = {
        id: `pkg_preview_${task.id}`, taskId: task.id, engine: 'SRV English', mood: task.mood, platform: 'All', contentType: task.contentType,
        contentFormat: task.contentFormat, engineType: 'suno', generatedAt: new Date(created + 1000 * (i + 1)).toISOString(), checklist: {},
        performance_status: 'generated', isTest: true, srvTaskUid: uid, captionYT: s.captionYouTube, ...s,
      };
      // Checkpoint C: V2 packages carry their task's avatar, picked by the real rotation (#204 stays pre-V2).
      if (pkg.srvStudioV2) {
        const moodKey = /romantic/i.test(task.mood) ? 'romantic' : /happy|hopeful/i.test(task.mood) ? 'hopeful' : 'emotional';
        const a = srv2AvatarPick({ history: avatarHistory, moodKey });
        const at = new Date(created + 2000 * (i + 1)).toISOString();
        pkg.srvAvatar = { id: a.id, assignedAt: at, by: 'rotation', registry: SRV_STUDIO_V2_AVATAR_REGISTRY_VERSION };
        avatarHistory.push({ id: a.id, at });
        // Checkpoint C2: #205 keeps an avatar from the archived concept collection, to show that a package
        // assigned before the final collection still resolves (historical reference intact).
        if (task.id === 205) pkg.srvAvatar = { id: 'srv2-av-04', assignedAt: at, by: 'rotation', registry: 'srv2-avatars-1' };
      }
      packages.push({ package_id: pkg.id, task_id: task.id, engine: 'SRV English', title: pkg.title, full_package: JSON.stringify(pkg), generated_at: pkg.generatedAt });
    }
    delete task._previewStage;
  });
  state.tasks = state.tasks.filter((x) => x.engine !== 'SRV English').concat(tasks);
  state.srvLifecycleStages = stages;
  state.engineState = { ...(state.engineState || {}), 'SRV English': 'test' };
  // Checkpoint E3: the two-video pilot authorization, as the release would set it — #203 Long, #204 Short.
  const uidOf = (id) => { const t = tasks.find((x) => x.id === id); return 'srve_' + t.createdAt + '_' + id; };
  const pilot = { enabled: true, tasks: { long: uidOf(203), short: uidOf(204) }, maxUploads: 2, expires: new Date(Date.now() + 7 * 86400000).toISOString(), channelId: 'UC0nzWQX6AaUqlF5FozNpWPg' };
  return {
    ...base,
    settings: { ...base.settings, mmm_finance_v118: JSON.stringify(state), srv_studio_v2_enabled: 'true', srv_studio_v2_pilot: JSON.stringify(pilot) },
    tables: { ...base.tables, packages },
  };
}
