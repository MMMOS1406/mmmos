// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: asset registry (tagged, reusable, metadata-carrying).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSprite, makeCanvas } from './core.mjs';
const DIR = join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench');
export const MANIFEST = { host: { identity: 'nextwave_host_v1', source: 'ideogram-v3 (character reference)', tags: ['host', 'waist_up', 'transparent'], poses: JSON.parse(readFileSync(join(DIR, 'host_manifest.json'), 'utf8')) } };
// pose sprite: { canvas, w, h, rect? } — `rect` (card pose) is the blank card the renderer writes evidence onto.
export async function loadHostPoses() {
  const out = {};
  for (const [role, m] of Object.entries(MANIFEST.host.poses)) {
    const img = await loadSprite(join(DIR, `host_${role}.png`)); const { c, g } = makeCanvas(m.w, m.h); g.drawImage(img, 0, 0);
    out[role] = { canvas: c, w: m.w, h: m.h, rect: m.rect || null };
  }
  return out;
}
