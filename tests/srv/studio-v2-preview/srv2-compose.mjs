// SRV Studio V2 — example 16:9 thumbnail and 9:16 Short compositions (Checkpoint C preview only).
// Runs in the browser (preview page) and in Node (@napi-rs/canvas, sample PNGs for the report).
// These are DESIGN MOCKS for review, not the production renderer (_srvRenderVideo is untouched).
// The source avatars are 303x252 concept crops: every composition reports the enlargement it needed.
//
// Branding: an original "SRV STUDIO" wordmark (no logo file exists yet). Cinematic black-and-white is
// applied here as a grade (the source images are warm sepia); `tone:'source'` shows them as delivered.

export const SRV2_BRAND = { word: 'SRV STUDIO', genre: 'Emotional Deep House · Night Drive' };
const FONTS = { title: "'Playfair Display', Georgia, serif", label: "'Inter', system-ui, sans-serif" };

function cover(srcW, srcH, boxW, boxH, fx = 0.5, fy = 0.5) {
  const s = Math.max(boxW / srcW, boxH / srcH);
  const w = boxW / s, h = boxH / s;
  const x = Math.min(srcW - w, Math.max(0, fx * srcW - w / 2));
  const y = Math.min(srcH - h, Math.max(0, fy * srcH - h / 2));
  return { sx: x, sy: y, sw: w, sh: h, scale: s };
}
function grade(ctx, tone) { ctx.filter = tone === 'source' ? 'none' : 'grayscale(1) contrast(1.18) brightness(0.96)'; }
function wrap(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function spaced(ctx, text, x, y, spacing) { let cx = x; for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; } return cx - x; }

// 16:9 YouTube thumbnail / Long cover — portrait on the right, title on the left.
export function composeThumbnail(ctx, img, avatar, { title, tone = 'bw', W = 1280, H = 720 } = {}) {
  const c = avatar.crop, f = avatar.focus;
  ctx.save(); ctx.fillStyle = '#0b0b0c'; ctx.fillRect(0, 0, W, H);
  const boxX = Math.round(W * 0.40), boxW = W - boxX;
  const k = cover(c.w, c.h, boxW, H, f.fx, f.fy);
  grade(ctx, tone); ctx.drawImage(img, c.x + k.sx, c.y + k.sy, k.sw, k.sh, boxX, 0, boxW, H); ctx.filter = 'none';
  const g = ctx.createLinearGradient(boxX, 0, boxX + boxW * 0.42, 0);
  g.addColorStop(0, 'rgba(11,11,12,1)'); g.addColorStop(1, 'rgba(11,11,12,0)');
  ctx.fillStyle = g; ctx.fillRect(boxX - 1, 0, boxW * 0.42 + 2, H);
  const v = ctx.createLinearGradient(0, H * 0.7, 0, H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  // wordmark
  ctx.fillStyle = '#ece8df'; ctx.font = `600 ${Math.round(H * 0.026)}px ${FONTS.label}`; ctx.textBaseline = 'alphabetic';
  spaced(ctx, SRV2_BRAND.word, W * 0.06, H * 0.12, H * 0.011);
  ctx.fillStyle = 'rgba(236,232,223,0.55)'; ctx.fillRect(W * 0.06, H * 0.145, W * 0.05, 2);
  // title
  ctx.fillStyle = '#f5f2ea'; const ts = Math.round(H * 0.105); ctx.font = `700 ${ts}px ${FONTS.title}`;
  const lines = wrap(ctx, title, W * 0.40).slice(0, 3);
  const y0 = H * 0.5 - (lines.length - 1) * ts * 0.55;
  lines.forEach((l, i) => ctx.fillText(l, W * 0.06, y0 + i * ts * 1.08));
  ctx.fillStyle = 'rgba(236,232,223,0.72)'; ctx.font = `500 ${Math.round(H * 0.03)}px ${FONTS.label}`;
  ctx.fillText(SRV2_BRAND.genre, W * 0.06, y0 + lines.length * ts * 1.08 + H * 0.02);
  ctx.restore();
  return { upscale: +k.scale.toFixed(2), sourcePx: `${Math.round(k.sw)}×${Math.round(k.sh)}` };
}

// 9:16 Short — blurred full-bleed backdrop, the landscape portrait as a framed band, lyric + title below.
export function composeShort(ctx, img, avatar, { title, lyric, tone = 'bw', W = 1080, H = 1920 } = {}) {
  const c = avatar.crop, f = avatar.focus;
  ctx.save(); ctx.fillStyle = '#070708'; ctx.fillRect(0, 0, W, H);
  const b = cover(c.w, c.h, W, H, f.fx, f.fy);
  ctx.filter = (tone === 'source' ? '' : 'grayscale(1) ') + 'blur(28px) brightness(0.45)';
  ctx.drawImage(img, c.x + b.sx, c.y + b.sy, b.sw, b.sh, -40, -40, W + 80, H + 80); ctx.filter = 'none';
  // portrait band, full width, keeps the source's landscape aspect (no 9:16 over-crop of a 303 px image)
  const bandW = W, bandH = Math.round(W * (c.h / c.w)), bandY = Math.round(H * 0.20);
  grade(ctx, tone); ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, bandY, bandW, bandH); ctx.filter = 'none';
  const fade = (y, up) => { const g = ctx.createLinearGradient(0, y, 0, y + (up ? -90 : 90)); g.addColorStop(0, 'rgba(7,7,8,0)'); g.addColorStop(1, 'rgba(7,7,8,0.9)'); return g; };
  ctx.fillStyle = fade(bandY + bandH - 90, false); ctx.fillRect(0, bandY + bandH - 90, W, 90);
  // header wordmark
  ctx.fillStyle = '#ece8df'; ctx.font = `600 ${Math.round(W * 0.034)}px ${FONTS.label}`; ctx.textAlign = 'left';
  const ww = ctx.measureText(SRV2_BRAND.word).width + SRV2_BRAND.word.length * W * 0.012;
  spaced(ctx, SRV2_BRAND.word, (W - ww) / 2, H * 0.12, W * 0.012);
  // lyric line
  ctx.textAlign = 'center'; ctx.fillStyle = '#f5f2ea';
  const ls = Math.round(W * 0.066); ctx.font = `600 italic ${ls}px ${FONTS.title}`;
  const ll = wrap(ctx, lyric, W * 0.84).slice(0, 3); const ly = bandY + bandH + H * 0.09;
  ll.forEach((l, i) => ctx.fillText(l, W / 2, ly + i * ls * 1.2));
  // title + genre
  const ty = ly + ll.length * ls * 1.2 + H * 0.06;
  ctx.fillStyle = 'rgba(236,232,223,0.92)'; ctx.font = `700 ${Math.round(W * 0.05)}px ${FONTS.title}`; ctx.fillText(title, W / 2, ty);
  ctx.fillStyle = 'rgba(236,232,223,0.6)'; ctx.font = `500 ${Math.round(W * 0.03)}px ${FONTS.label}`; ctx.fillText(SRV2_BRAND.genre, W / 2, ty + H * 0.035);
  ctx.restore();
  return { upscale: +(bandW / c.w).toFixed(2), sourcePx: `${c.w}×${c.h}` };
}
