// CEO-016D — reference-aware, protection-aware storage cleanup PLAN. Read-only: it only classifies; deleting is a separate, separately authorized step.
// Classification of every object in the srv-assets bucket, then a set of candidate groups with exact paths/sizes and the history that would go dark.
import fs from 'node:fs';

/** Protection rules (an object is PROTECTED, never a candidate, when any applies):
 *  P1  belongs to a NON-test package created in the last 21 days (in-flight work of ANY business; also the window in which TikTok/Instagram pull a Short from its Supabase link)
 *  P2  belongs to an UNPUBLISHED, non-test SRV Farsi / SRV Studio package created in the last 60 days (a VA may still publish it)
 *  P5  a file of an SRV Studio package that has a YouTube upload recorded (production / VA / pilot / _srvYtLongId) — NOTE SRV Studio flags its real private uploads as isTest=true, so the test flag cannot be trusted there: the Monthly Mix Builder reads that package's original mp3 or, when there is none, its Long video file (lib/srvStudioV2Mix.mjs)
 *  P3  is not a package render (audio, thumbnails, photos are kept: they are small and needed to rebuild a render)
 *  P4  anything whose class could not be determined */
export const CLEANUP_SQL = `
with o as (select name, (metadata->>'size')::bigint size, metadata->>'eTag' etag, metadata->>'mimetype' mime, created_at,
   case when name like 'pkg\\_%' escape '\\' then 'package' when name like 'nextwave-v2-route/%' then 'nextwave-v2-route' when name like 'nextwave-v2-preview/%' then 'nextwave-v2-preview'
        when name like 'preview-renders/%' then 'preview-render' when name like 'social-media-manager/%' then 'smm-asset' when name like 'ai_studio/%' then 'ai-studio' else 'other' end category
   from storage.objects where bucket_id = 'srv-assets'),
p as (select package_id, engine, coalesce(youtube_video_id, (full_package::jsonb)->>'youtubeVideoId', (full_package::jsonb)->'srvProduction'->>'youtubeVideoId', (full_package::jsonb)->'srvVa'->>'youtubeVideoId', (full_package::jsonb)->'srvPilot'->>'youtubeVideoId', (full_package::jsonb)->>'_srvYtLongId', (full_package::jsonb)->>'_srvYtShortId') youtube_video_id, generated_at, coalesce(((full_package::jsonb)->>'isTest')::bool,false) or coalesce(((full_package::jsonb)->>'_inTestMode')::bool,false) is_test from public.packages)
select o.name, o.size, o.etag, o.mime, o.created_at::text created_at, o.category,
  coalesce(p.engine, case o.category when 'nextwave-v2-route' then 'NextWave' when 'nextwave-v2-preview' then 'NextWave' when 'smm-asset' then 'SMM' when 'ai-studio' then 'AI Studio' else null end) business,
  case when o.category <> 'package' then o.category when p.package_id is null then 'orphan' when p.is_test and not (p.engine = 'SRV English' and p.youtube_video_id is not null) then 'test' when p.youtube_video_id is not null then 'published' else 'unpublished' end class,
  p.package_id, p.generated_at::text pkg_generated_at, extract(day from now() - p.generated_at)::int pkg_age_days,
  (o.mime like 'video/%') is_video,
  (exists (select 1 from public.packages q where position(o.name in q.full_package) > 0) or exists (select 1 from public.app_settings a where position(o.name in a.value) > 0) or exists (select 1 from public.sm_content_assets s where position(o.name in coalesce(s.storage_path,'') || coalesce(s.source_url,'')) > 0)) referenced,
  (exists (select 1 from public.packages q where q.engine = 'SRV Farsi' and q.content_type = 'Mix' and position(o.name in q.full_package) > 0) or exists (select 1 from public.app_settings a where a.key = 'srv_farsi_mix_sources' and position(o.name in a.value) > 0)) mix_source
from o left join p on o.category = 'package' and p.package_id = split_part(o.name, '/', 1) order by o.name`;

/** SRV Farsi Mix Builder V2 (PM order 2026-11-14): a stored file that a Mix can still need is NEVER a cleanup candidate.
 *  P6  (a) referenced by a Mix package or by the attached-source registry (app_settings.srv_farsi_mix_sources) — set by the SQL column `mix_source`;
 *      (b) listed in a PRIVATE protect manifest (a deliberately unpublished list of storage objects), whatever the package's test flag says;
 *      (c) a published SRV Farsi Long render — until the original audio of that song is retained/attached, the render IS its only Mix audio source.
 *  The manifest is loaded with setMixSourceManifest(paths); an unreadable manifest must stop the run (the CLI does that), never silently protect nothing. */
let MIX_SOURCE_PATHS = new Set();
export function setMixSourceManifest(paths) { MIX_SOURCE_PATHS = new Set(paths || []); return MIX_SOURCE_PATHS.size; }
export function protection(o) {
  if (o.mix_source === true || o.mix_source === 't' || MIX_SOURCE_PATHS.has(o.name)) return 'P6 SRV Farsi Mix source (referenced by a Mix / attached registry / recovered-source manifest)';
  if (o.class === 'published' && o.business === 'SRV Farsi' && o.is_video && /\/long_/.test(o.name || '')) return 'P6 published SRV Farsi Long render (the only audio source of that song for a Mix)';
  if (o.class === 'published' && o.business === 'SRV English') return 'P5 SRV Studio published package (Monthly Mix Builder source)';
  if (o.category === 'package' && o.class !== 'test' && o.pkg_age_days != null && o.pkg_age_days <= 21) return 'P1 in-flight (<=21 days)';
  if (o.class === 'unpublished' && (o.business === 'SRV Farsi' || o.business === 'SRV English') && o.pkg_age_days != null && o.pkg_age_days <= 60) return 'P2 unpublished active-business package (<=60 days)';
  if (o.category === 'package' && !o.is_video && o.class !== 'orphan' && o.class !== 'test') return 'P3 small non-video asset of a real package (audio/thumb/photo) kept';
  if (!o.class || o.class === 'other') return 'P4 unclassified';
  return null;
}

/** Candidate groups in the order of the CEO's priority list. A file belongs to the first group that claims it. */
export const GROUPS = [
  ['1 Unreferenced test renders', (o) => o.class === 'test' && !o.referenced && o.is_video],
  ['2 Orphan files', (o) => o.class === 'orphan'],
  ['2b Small leftovers of test packages (audio/thumbnails)', (o) => o.class === 'test' && !o.is_video],
  ['3 Temporary previews', (o) => o.class === 'preview-render'],
  ['4 Obsolete test packages (video files still referenced by test records)', (o) => o.class === 'test' && o.referenced && o.is_video],
  ['5 Redundant published video files (the video is on YouTube)', (o) => o.class === 'published' && o.is_video && o.business === 'SRV Farsi'],
  ['6 Unused NextWave assets', (o) => o.business === 'NextWave' && (o.class === 'nextwave-v2-route' || o.class === 'nextwave-v2-preview')],
  ['7 Unused SMM assets', (o) => o.class === 'smm-asset'],
  ['8 Unnecessary AI Creation Studio files', (o) => o.class === 'ai-studio'],
  ['9 Stale unpublished drafts (older than 60 days, active businesses)', (o) => o.class === 'unpublished' && o.is_video && (o.business === 'SRV Farsi' || o.business === 'SRV English')],
];

export function buildCleanup(objects) {
  const taken = new Set(); const out = [];
  for (const [label, fn] of GROUPS) {
    const rows = []; for (const o of objects) { if (taken.has(o.name) || protection(o) || !fn(o)) continue; taken.add(o.name); rows.push(o); }
    const bizBytes = {}; for (const r of rows) bizBytes[r.business || '?'] = (bizBytes[r.business || '?'] || 0) + Number(r.size);
    const refPkgs = new Set(rows.filter((r) => r.referenced && r.package_id).map((r) => r.package_id));
    out.push({ label, files: rows.length, bytes: rows.reduce((a, r) => a + Number(r.size), 0), referencedFiles: rows.filter((r) => r.referenced).length, packagesLosingPreview: refPkgs.size, byBusiness: bizBytes, paths: rows.map((r) => r.name) });
  }
  const total = objects.reduce((a, o) => a + Number(o.size), 0), cand = out.reduce((a, g) => a + g.bytes, 0);
  const protectedBytes = objects.filter((o) => protection(o)).reduce((a, o) => a + Number(o.size), 0);
  const prot = {}; for (const o of objects) { const r = protection(o); if (r) { const k = `${r} | ${o.business || '-'} | ${o.class}`; prot[k] = prot[k] || { files: 0, bytes: 0 }; prot[k].files++; prot[k].bytes += Number(o.size); } }
  return { protectedBreakdown: prot, groups: out, totalBytes: total, candidateBytes: cand, remainingBytes: total - cand, protectedBytes, unclaimedUnprotectedBytes: total - cand - protectedBytes };
}
