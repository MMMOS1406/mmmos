// SRV Farsi Long — SAFE FRAME (CEO 2026-11-15): the camera zoom must never crop the avatar. Runs the page's OWN camera + safe-frame functions
// (extracted verbatim from public/index.html) over EVERY avatar of the library, 6 camera seeds, 8 minutes at 0.5 s steps (all framings, push, breathing, sway).
//   node tests/srv/test_srv_farsi_safe_frame.mjs [public/index.html]
import fs from 'node:fs'; import { execSync } from 'node:child_process'; import path from 'node:path';
const file = process.argv[2] || 'public/index.html'; const root = path.resolve(path.dirname(file)); const html = fs.readFileSync(file, 'utf8');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const at = (re) => { const m = re.exec(html); if (!m) throw new Error('missing ' + re); return m.index; };
const fnSrc = (n) => { const s = at(new RegExp('function ' + n + '\\(')); return html.slice(s, html.indexOf('\n}\n', s) + 3); };
const cam = html.slice(at(/const SRV_FARSI_CAM=\{/), html.indexOf('\n', html.indexOf('swayAmt:0.8')) + 1); const safe = html.slice(at(/const SRV_FARSI_SAFE=\{/), html.indexOf('\n', at(/const SRV_FARSI_SAFE=\{/)) + 1);
const L = new Function(cam + safe + ['_srvFarsiCamRng', '_srvFarsiCamEase', '_srvFarsiCamTimeline', '_srvFarsiCamera', '_srvFarsiCamRect', '_srvFarsiSafeRegion', '_srvFarsiSafeRect'].map(fnSrc).join('\n') + ';return {C:SRV_FARSI_CAM,tl:_srvFarsiCamTimeline,cam:_srvFarsiCamera,rect:_srvFarsiCamRect,ease:_srvFarsiCamEase,region:_srvFarsiSafeRegion,safe:_srvFarsiSafeRect};')();
const pool = []; for (const m of html.matchAll(/\{id:'((?:female|male|duet)_\d+)',src:'([^']+)',thumb:'[^']*',fx:([\d.]+),fy:([\d.]+),fw:([\d.]+)\}/g)) pool.push({ id: m[1], src: m[2], fx: +m[3], fy: +m[4], fw: +m[5] });
const dims = (src) => { const o = execSync(`sips -g pixelWidth -g pixelHeight "${root}${src}"`).toString(); return [+/pixelWidth: (\d+)/.exec(o)[1], +/pixelHeight: (\d+)/.exec(o)[1]]; };
const PW = 1920, PH = 1080, C = L.C; let minHead = 1, minFace = 1, minSubj = 1, zk = 0, zo = 0, worst = '';
const frac = (b, r) => { const a = (q) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.y1 - q.y0); return a({ x0: Math.max(b.x0, r.x), x1: Math.min(b.x1, r.x + r.w), y0: Math.max(b.y0, r.y), y1: Math.min(b.y1, r.y + r.h) }) / a(b); };
for (const a of pool) {
  const [iw, ih] = dims(a.src); const isMirror = a.fx < 0.5, aim = { x: isMirror ? 0.264 : 0.736, y: 0.40, face: 0.1386 }; const cover = Math.max(PW / iw, PH / ih);
  const sc = Math.min(Math.max(cover, Math.min(cover * 1.7, 1.5)), Math.max(cover, (aim.face * PW) / (a.fw * iw))); const sw = PW / sc, sh = PH / sc;
  const sx = Math.min(iw - sw, Math.max(0, iw * a.fx - sw * aim.x)), sy = Math.min(ih - sh, Math.max(0, ih * a.fy - sh * aim.y)); const bcx = (sx + sw / 2) / iw, bcy = (sy + sh / 2) / ih, fwPx = a.fw * iw;
  const FW = C.framings.wide, fxW = a.fx - (aim.x - 0.5) * (PW / (sc * FW.z * C.overscan)) / iw; const Rw = L.rect(iw, ih, PW, PH, sc, FW.z * C.overscan, bcx + (fxW - bcx) * FW.pull, bcy + (a.fy + FW.dy - bcy) * FW.pull, 0, 0, FW.z * C.overscan);
  const P = L.region(iw, ih, a.fx, a.fy, a.fw, Rw, aim.x > 0.5);
  const head = { x0: Math.max(0, a.fx * iw - 0.8 * fwPx), x1: Math.min(iw, a.fx * iw + 0.8 * fwPx), y0: Math.max(0, a.fy * ih - 1.05 * fwPx), y1: Math.min(ih, a.fy * ih + 0.8 * fwPx) }; const face = { x0: a.fx * iw - fwPx / 2, x1: a.fx * iw + fwPx / 2, y0: a.fy * ih - fwPx / 2, y1: a.fy * ih + fwPx / 2 };
  for (const seedStr of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const seed = [...seedStr].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0), tl = L.tl(480, seedStr + '|' + a.id);
    for (let t = 0; t < 480; t += 0.5) {
      const cm = L.cam(t, seed), s = tl.find((q) => t < q.end) || tl[tl.length - 1], F = C.framings[s.framing], pp = Math.max(-0.1, Math.min(1.1, (t - s.start) / Math.max(1, s.end - s.start)));
      const zz = F.z * (1 + C.push * L.ease(pp)) * C.overscan * cm.zoom, fxT = a.fx - (aim.x - 0.5) * (PW / (sc * zz)) / iw;
      const r0 = L.rect(iw, ih, PW, PH, sc, zz, bcx + (fxT - bcx) * F.pull, bcy + (a.fy + F.dy - bcy) * F.pull, cm.mx, cm.my, F.z * C.overscan); const r = L.safe(r0, P, iw, ih);
      const h = frac(head, r), f = frac(face, r), p = frac(P, r); if (h < minHead) { minHead = h; worst = a.id; } minFace = Math.min(minFace, f); minSubj = Math.min(minSubj, p); zk += r.scale; zo += r0.scale;
      if (Math.abs(r.w / r.h - PW / PH) > 1e-6) { ok('window keeps the 16:9 aspect', false, a.id + ' t=' + t); }
    }
  }
}
ok('the library has the 37 avatars (female / male / duet)', pool.length === 37, String(pool.length));
ok('the HEAD (hair to chin, clipped to the photo) is always >= 99% inside the frame for every avatar and every camera moment', minHead >= 0.99, 'min ' + minHead.toFixed(3) + ' (' + worst + ')');
ok('the FACE is always 100% inside the frame', minFace >= 0.999, 'min ' + minFace.toFixed(3));
ok("the subject's side of the approved wide frame is always inside the frame", minSubj >= 0.999, 'min ' + minSubj.toFixed(3));
ok('the camera motion is preserved: >= 95% of the zoom is kept on average', zk / zo >= 0.95, (100 * zk / zo).toFixed(1) + '%');
ok('the renderer version marks the corrected Long renderer', /SRV_FARSI_RENDERER_VERSION='srvf-render-2026-11-15-m'/.test(html));
ok('the safe frame is applied only in the Long camera path (keepFaceSide); the Short path is untouched', /if\(o\.keepFaceSide\)\{\s*const FW=C\.framings\.wide/.test(html) && !/_srvFarsiSafeRect\(/.test(html.slice(html.indexOf("const zz=(1+C.push*_srvFarsiCamEase(o.cam.p))"), html.indexOf("const zz=(1+C.push*_srvFarsiCamEase(o.cam.p))") + 400)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
