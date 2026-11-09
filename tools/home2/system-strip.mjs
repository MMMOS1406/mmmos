// MMMOS homepage v2 — builds the CEO-only "System" strip row (app_settings key mmm_system_strip). READ-ONLY by default: prints the JSON.
// Writing needs --apply AND a CEO authorization for the production write; it is never run by a test or by the page.
// node system-strip.mjs --cli-workdir <supabase workdir> --plan Pro --plan-storage-mib 102400 --rollback dpl_xxx --backup-at 2026-11-08T12:00:00Z [--baseline-at <iso>] [--apply]
import { makeCliQuery } from '../ceo016a/cli-query.mjs';
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const q = makeCliQuery({ workdir: arg('--cli-workdir') });
const [st] = (await q("select coalesce(sum((metadata->>'size')::bigint),0)::bigint b from storage.objects where bucket_id = 'srv-assets'")).rows;
const strip = { asOf: new Date().toISOString(), plan: arg('--plan', 'unknown'), storageMiB: Math.round(Number(st.b) / 1048576), planStorageMiB: Number(arg('--plan-storage-mib', 0)) || null, backupAt: arg('--backup-at'), lastBaselineAt: arg('--baseline-at', new Date().toISOString()), rollbackTarget: arg('--rollback') };
console.log(JSON.stringify(strip, null, 1));
if (process.argv.includes('--apply')) {
  const v = JSON.stringify(strip).replace(/'/g, "''");
  await q(`insert into public.app_settings(key, value) values ('mmm_system_strip', '${v}') on conflict (key) do update set value = excluded.value`);
  console.log('written');
}
