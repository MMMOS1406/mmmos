// Operator tool for the per-channel background-sync switch (lib/channelSyncControl.mjs). READ-ONLY unless --apply is given AND a CEO authorization exists for the change.
//   CLI_QUERY=<path to tools/ceo016a/cli-query.mjs> node channel-sync-control.mjs status --cli-workdir <supabase workdir>
//   node channel-sync-control.mjs disable <id> [<id>…] --platform youtube|tiktok --cli-workdir <dir> [--apply]
//   node channel-sync-control.mjs enable  <id> [<id>…] --platform youtube|tiktok --cli-workdir <dir> [--apply]
// It edits ONLY the one config row app_settings.sync_disabled_channels. It never reads or writes a token, a connection row or any content, and it refuses SRV Farsi / SRV English.
// Rollback of everything it does: `enable` the same ids (or delete that one row) — the next scheduled run syncs them again.
const { makeCliQuery } = await import(process.env.CLI_QUERY || '../ceo016a/cli-query.mjs');
const { CONFIG_KEY, RETAINED_ENGINES, parseDisabled } = await import(new URL('../../lib/channelSyncControl.mjs', import.meta.url).href);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const [cmd, ...rest] = process.argv.slice(2); const ids = rest.filter((x) => !x.startsWith('--') && x !== arg('--platform') && x !== arg('--cli-workdir'));
const q = makeCliQuery({ workdir: arg('--cli-workdir') }); const rows = async (sql) => (await q(sql)).rows;
const row = (await rows(`select value from public.app_settings where key='${CONFIG_KEY}'`))[0];
const cur = parseDisabled(row && row.value); const asObj = (c) => ({ youtube: [...c.youtube].sort(), tiktok: [...c.tiktok].sort() });
const yt = await rows('select c.channel_id, c.mmm_engine, k.status, (select max(synced_at)::text from public.youtube_sync_logs l where l.channel_id = c.channel_id) last_logged_sync from public.youtube_channels c left join public.youtube_connections k on k.channel_id = c.channel_id order by c.mmm_engine');
const tt = await rows('select open_id, mmm_engine, status from public.tiktok_connections order by mmm_engine');
const show = () => { console.log('currently disabled:', JSON.stringify(asObj(cur))); console.log('YouTube channels:'); yt.forEach((c) => console.log(`  ${c.channel_id}  ${String(c.mmm_engine).padEnd(12)} connection=${c.status}  ${RETAINED_ENGINES.includes(c.mmm_engine) ? 'RETAINED (cannot be disabled)' : cur.youtube.has(c.channel_id) ? 'SKIPPED by switch' : 'syncing'}`)); console.log('TikTok accounts:'); tt.forEach((c) => console.log(`  ${c.open_id}  ${String(c.mmm_engine).padEnd(12)} status=${c.status}  ${RETAINED_ENGINES.includes(c.mmm_engine) ? 'RETAINED (cannot be disabled)' : cur.tiktok.has(c.open_id) ? 'SKIPPED by switch' : 'syncing'}`)); };
if (cmd === 'status' || !cmd) { show(); process.exit(0); }
if (!['disable', 'enable'].includes(cmd)) { console.error('unknown command'); process.exit(2); }
const platform = arg('--platform'); if (!['youtube', 'tiktok'].includes(platform)) { console.error('--platform youtube|tiktok required'); process.exit(2); }
if (!ids.length) { console.error('give at least one id'); process.exit(2); }
const next = { youtube: new Set(cur.youtube), tiktok: new Set(cur.tiktok) };
for (const id of ids) {
  const r = platform === 'youtube' ? yt.find((c) => c.channel_id === id) : tt.find((c) => c.open_id === id);
  if (!r) { console.error(`REFUSED: ${id} is not a known ${platform} id`); process.exit(1); }
  if (cmd === 'disable' && (!r.mmm_engine || RETAINED_ENGINES.includes(r.mmm_engine))) { console.error(`REFUSED: ${id} belongs to "${r.mmm_engine}" — only channels of retired businesses can be disabled`); process.exit(1); }
  cmd === 'disable' ? next[platform].add(id) : next[platform].delete(id);
}
const value = JSON.stringify({ youtube: [...next.youtube].sort(), tiktok: [...next.tiktok].sort() });
console.log(`${cmd} ${platform}: ${ids.join(', ')}\nresulting row: ${value}`);
if (!process.argv.includes('--apply')) { console.log('DRY RUN — nothing written (add --apply once the CEO has authorized this change)'); process.exit(0); }
await q(`insert into public.app_settings(key, value) values ('${CONFIG_KEY}', '${value.replace(/'/g, "''")}') on conflict (key) do update set value = excluded.value, updated_at = now()`);
console.log('written');
