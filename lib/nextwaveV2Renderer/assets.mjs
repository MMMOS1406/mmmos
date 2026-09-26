// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: asset registry (tagged, reusable, metadata-carrying).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSprite, makeCanvas } from './core.mjs';
// NOTE: every asset path below is a literal join(process.cwd(), ...) so the serverless bundler traces the files (same pattern as SMM_FONT_PATH).
const HOST_FILES = {
  point: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'host_point.png'),
  card: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'host_card.png'),
  compare: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'host_compare.png'),
  react: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'host_react.png'),
  think: join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'host_think.png'),
};
const HOST_MANIFEST = join(process.cwd(), 'api', 'assets', 'nextwave-v2', 'bench', 'host_manifest.json');
export const MANIFEST = { host: { identity: 'nextwave_host_v1', source: 'ideogram-v3 (character reference)', tags: ['host', 'waist_up', 'transparent'], poses: JSON.parse(readFileSync(HOST_MANIFEST, 'utf8')) } };
// pose sprite: { canvas, w, h, rect? } — `rect` (card pose) is the blank card the renderer writes evidence onto.
export async function loadHostPoses() {
  const out = {};
  for (const [role, m] of Object.entries(MANIFEST.host.poses)) {
    const img = await loadSprite(HOST_FILES[role]); const { c, g } = makeCanvas(m.w, m.h); g.drawImage(img, 0, 0);
    out[role] = { canvas: c, w: m.w, h: m.h, rect: m.rect || null };
  }
  return out;
}
