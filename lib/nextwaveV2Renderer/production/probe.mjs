// Runtime probe for the V2 route: proves, inside the actual serverless runtime, that the native canvas loads, the fonts register,
// the banked assets are present and readable, and ffmpeg has the encoders/muxers the route needs. Read-only, no spend, no secrets.
import { spawn } from 'node:child_process';
import { stat, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { makeCanvas, text, P } from '../core.mjs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const A = (f) => join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', f);
const ASSET_FILES = ['host_point.png', 'host_card.png', 'host_compare.png', 'host_react.png', 'host_think.png', 'host_manifest.json', 'bg_road_wide.png', 'bg_road_tall.png', 'bg_kitchen_wide.png', 'bg_kitchen_tall.png', 'prop_wagon.png', 'prop_bag.png', 'prop_chest.png', 'prop_beach.png'];
const FONT_FILES = [join(process.cwd(), 'api', 'assets', 'fonts', 'Inter-Variable.ttf'), join(process.cwd(), 'api', 'assets', 'fonts', 'PlayfairDisplay-Variable.ttf')];
const sh = (bin, args) => new Promise((res) => { const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; }); p.on('error', (er) => res({ code: -1, out: '', err: er.message })); p.on('close', (c) => res({ code: c, out: o, err: e })); });

export async function runtimeProbe({ ffmpegPath }) {
  const out = { node: process.version, platform: process.platform, arch: process.arch, cwd_is_task_root: process.cwd(), vercel_env: process.env.VERCEL_ENV || null, region: process.env.VERCEL_REGION || null, checks: {} };
  const c = (k, ok, extra = {}) => { out.checks[k] = { ok, ...extra }; };
  try { const cv = createCanvas(64, 64); const g = cv.getContext('2d'); g.fillStyle = '#123456'; g.fillRect(0, 0, 64, 64); c('napi_canvas_loads', cv.toBuffer('image/png').length > 100); } catch (e) { c('napi_canvas_loads', false, { error: e.message }); }
  const assets = {}; for (const f of ASSET_FILES) { try { const s = await stat(A(f)); assets[f] = s.size; } catch (e) { assets[f] = null; } }
  c('banked_assets_present', Object.values(assets).every((v) => v && v > 100), { files: assets });
  const fonts = {}; for (const f of FONT_FILES) { try { fonts[f.split('/').pop()] = (await stat(f)).size; } catch { fonts[f.split('/').pop()] = null; } }
  c('font_files_present', Object.values(fonts).every((v) => v && v > 1000), { files: fonts });
  try {
    const { c: cv, g } = makeCanvas(600, 160); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 160); text(g, 'NW Inter 1234', 10, 60, { weight: 800, size: 48, color: P.ink }); text(g, 'NW Playfair 1234', 10, 130, { kind: 'display', weight: 800, size: 48, color: P.ink });
    const fam = GlobalFonts.families.map((f) => f.family); const buf = cv.toBuffer('image/png'); const withFonts = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    c('fonts_register_and_render', fam.includes('NW Inter') && fam.includes('NW Playfair'), { families: fam.filter((x) => /^NW /.test(x)), png_bytes: buf.length, digest: withFonts });
  } catch (e) { c('fonts_register_and_render', false, { error: e.message }); }
  const v = await sh(ffmpegPath, ['-hide_banner', '-version']); c('ffmpeg_runs', v.code === 0, { version: (v.out.split('\n')[0] || v.err.split('\n')[0] || '').slice(0, 90), path: ffmpegPath });
  const enc = await sh(ffmpegPath, ['-hide_banner', '-encoders']); c('ffmpeg_libx264_aac', /libx264/.test(enc.out) && /\baac\b/.test(enc.out));
  const mux = await sh(ffmpegPath, ['-hide_banner', '-formats']); c('ffmpeg_concat_mp4_mp3', /concat/.test(mux.out) && /mp4/.test(mux.out) && /mp3/.test(mux.out));
  try { // a real 1-second encode through the exact route path: rawvideo pipe -> libx264 -> mp4, then concat + apad mux
    const dir = join(tmpdir(), 'nwv2-probe-' + Date.now()); const { mkdir, rm } = await import('node:fs/promises'); await mkdir(dir, { recursive: true });
    const { renderVideo } = await import('../render.mjs'); const fmt = { w: 320, h: 180, fps: 30 }; const t0 = Date.now();
    await renderVideo({ ffmpegPath, format: fmt, duration: 1, drawFrame: (g, t) => { g.fillStyle = '#F7F4EE'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#C99E4C'; g.fillRect(10 + t * 200, 60, 60, 60); }, outPath: join(dir, 'a.mp4'), tStart: 0, crf: 20 });
    await renderVideo({ ffmpegPath, format: fmt, duration: 1, drawFrame: (g, t) => { g.fillStyle = '#F7F4EE'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#C99E4C'; g.fillRect(10 + t * 200, 60, 60, 60); }, outPath: join(dir, 'b.mp4'), tStart: 1, crf: 20 });
    await writeFile(join(dir, 'l.txt'), `file '${join(dir, 'a.mp4')}'\nfile '${join(dir, 'b.mp4')}'`);
    const au = await sh(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-b:a', '64k', join(dir, 'n.mp3')]);
    const cc = await sh(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'l.txt'), '-i', join(dir, 'n.mp3'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-t', '2.000', '-movflags', '+faststart', join(dir, 'o.mp4')]);
    const s = await stat(join(dir, 'o.mp4')).catch(() => null); c('route_encode_concat_mux', au.code === 0 && cc.code === 0 && !!s && s.size > 1000, { bytes: s && s.size, ms: Date.now() - t0, ffmpeg_err: cc.code === 0 ? undefined : cc.err.slice(-300) });
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  } catch (e) { c('route_encode_concat_mux', false, { error: e.message }); }
  out.all_ok = Object.values(out.checks).every((x) => x.ok); return out;
}
