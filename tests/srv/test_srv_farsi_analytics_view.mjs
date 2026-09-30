// SRV Farsi P1-C — analytics exclusion. Runs the REAL migration on local Postgres 17 (PGlite) with synthetic
// rows, and statically checks which readers use the analytics view. Never touches production.
// Run: node tests/srv/test_srv_farsi_analytics_view.mjs   (needs: npm i --no-save @electric-sql/pglite)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x = '') => { c ? pass++ : fail++; out.push(`${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); };

const db = new PGlite();
await db.exec(`create role anon; create role authenticated;
  create table public.youtube_channels (channel_id text primary key, title text, mmm_engine text);
  create table public.youtube_videos (video_id text primary key, channel_id text, title text, views int, published_at timestamptz);
  insert into youtube_channels values ('UC_SRV','Silk Road Voices','SRV Farsi'),('UC_NW','NextWave Systems','NextWave'),('UC_AI','AI Creation Studio','AI Studio');
  insert into youtube_videos values
    ('s1','UC_SRV','🌸 صبح نوروز 🌸',120,now()),
    ('s2','UC_SRV','[TEST] 💔 زندگی جدیدت 💔',0,now()),
    ('s3','UC_SRV','[TEST] Duet Long',3,now()),
    ('s4','UC_SRV','Song about [TEST] not a prefix',50,now()),
    ('n1','UC_NW','[TEST] NextWave finance',9,now()),
    ('n2','UC_NW','Compound interest explained',400,now()),
    ('a1','UC_AI','[TEST] AI tools',1,now());`);
await db.exec(readFileSync(join(root, 'migrations/srv_farsi_p1_analytics_view.sql'), 'utf8'));
const ids = async (sql) => (await db.query(sql)).rows.map(r => r.video_id).sort().join(',');
ok('G: SRV Farsi [TEST] uploads excluded from analytics view', (await ids(`select video_id from youtube_videos_analytics where channel_id='UC_SRV'`)) === 's1,s4');
ok('G: only a [TEST] title PREFIX counts (no guessing)', (await ids(`select video_id from youtube_videos_analytics where video_id='s4'`)) === 's4');
ok('I: NextWave rows identical to raw table (incl. its own [TEST] uploads)',
  (await ids(`select video_id from youtube_videos_analytics where channel_id='UC_NW'`)) === (await ids(`select video_id from youtube_videos where channel_id='UC_NW'`)));
ok('I: AI Studio rows identical to raw table',
  (await ids(`select video_id from youtube_videos_analytics where channel_id='UC_AI'`)) === (await ids(`select video_id from youtube_videos where channel_id='UC_AI'`)));
const rowEq = (await db.query(`select count(*)::int n from (select * from youtube_videos where channel_id<>'UC_SRV' except select * from youtube_videos_analytics) x`)).rows[0].n;
ok('I: non-SRV rows byte-identical (all columns)', rowEq === 0);
ok('G: raw table keeps every test record for engineering', (await db.query(`select count(*)::int n from youtube_videos`)).rows[0].n === 7);
const grants = (await db.query(`select has_table_privilege('anon','public.youtube_videos_analytics','select') a`)).rows[0].a;
ok('view readable by the browser role', grants === true);

// Static: which readers use the view (analytics) vs the raw table (writers / sync / memory)
const idx = readFileSync(join(root, 'public/index.html'), 'utf8');
const ops = readFileSync(join(root, 'api/ops.js'), 'utf8');
const wk = readFileSync(join(root, 'api/reports/weekly.js'), 'utf8');
const body = (src, name) => { const m = src.match(new RegExp('\\n(?:async )?function ' + name + '\\(')); const s = m.index; return src.slice(s, src.indexOf('\n}\n', s)); };
for (const f of ['loadYouTubeAnalytics', 'ytShowTopPerformers', '_pcFetchTopPerformersForEngine'])
  ok(`G: client analytics ${f} reads the view`, /youtube_videos_analytics/.test(body(idx, f)) && !/youtube_videos[?']/.test(body(idx, f)));
for (const f of ['operatorRecommendations', 'revenueDashboard', 'decisionEngine', 'analyticsFoundationReport'])
  ok(`G: server ${f} reads the view`, /youtube_videos_analytics\?/.test(body(ops, f)) && !/youtube_videos\?/.test(body(ops, f)));
for (const f of ['generateReport', 'generateShortFormIntelligence'])
  ok(`G: weekly report ${f} reads the view`, /youtube_videos_analytics\?/.test(body(wk, f)) && !/youtube_videos\?/.test(body(wk, f)));
ok('raw table still used by snapshot job (records kept)', /youtube_videos\?select=video_id/.test(body(ops, 'youtubeSnapshotNow')));

console.log(out.join('\n')); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
