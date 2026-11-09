// READ-ONLY. Copies the rows the simplified Home reads from production into ONE owner-only local file (0600, outside the repo) so the page
// can be rendered against real data in the local stub — nothing is sent anywhere, nothing in production is written.
// node fetch-real-fixture.mjs --cli-workdir <supabase workdir> --out <file>
import fs from 'node:fs';
const { makeCliQuery } = await import(process.env.CLI_QUERY || '../ceo016a/cli-query.mjs');   // CLI_QUERY=<path to tools/ceo016a/cli-query.mjs> (that tool lives on the cost-reduction branch)
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const q = makeCliQuery({ workdir: arg('--cli-workdir') }); const rows = async (sql) => (await q(sql)).rows;
const out = { fetchedAt: new Date().toISOString(), note: 'production copy for local replay — personal finance data inside, never commit or share' };
out.state = (await rows("select value from public.app_settings where key='mmm_finance_v118'"))[0]?.value || null;
out.youtube_channels = await rows("select channel_id, title, mmm_engine from public.youtube_channels where mmm_engine is not null");
out.youtube_videos_analytics = await rows("select channel_id, title, views, watch_time_min, retention_pct, subs_gained, analytics_synced_at from public.youtube_videos_analytics where analytics_synced_at is not null");
out.packages = [];
for (const e of ['SRV Farsi', 'SRV English', 'NextWave']) out.packages.push(...await rows(`select id, engine, title, created_at, published_at, youtube_video_id, status, full_package from public.packages where engine='${e}' order by created_at desc limit 6`));
fs.writeFileSync(arg('--out'), JSON.stringify(out), { mode: 0o600 });
console.log(JSON.stringify({ stateBytes: (out.state || '').length, channels: out.youtube_channels.length, analyticsRows: out.youtube_videos_analytics.length, packages: out.packages.length }));
