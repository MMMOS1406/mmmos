// NextWave V2 — BENCHMARK PRODUCTION SYSTEM: Ideogram client (same model/endpoint as the production pipeline) + spend ledger.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const URL_GEN = 'https://api.ideogram.ai/v1/ideogram-v3/generate';
const LEDGER = '/tmp/bench/spend.json';
export function spend(entry) { const l = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : []; l.push({ ...entry, at: new Date().toISOString() }); writeFileSync(LEDGER, JSON.stringify(l)); }
export const totalSpend = () => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : []).reduce((s, e) => s + (e.usd || 0), 0);
export async function generate({ apiKey, prompt, referencePath, aspect = '1x1', out, tag, negative }) {
  const f = new FormData(); f.append('prompt', prompt); f.append('rendering_speed', 'TURBO'); f.append('aspect_ratio', aspect);
  if (negative) f.append('negative_prompt', negative);
  if (referencePath) f.append('character_reference_images', new Blob([readFileSync(referencePath)], { type: 'image/png' }), 'ref.png');
  const r = await fetch(URL_GEN, { method: 'POST', headers: { 'Api-Key': apiKey }, body: f });
  if (!r.ok) throw new Error(`ideogram_${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json(); const img = j.data && j.data[0]; if (!img || !img.url) throw new Error('ideogram_no_image');
  const buf = Buffer.from(await (await fetch(img.url)).arrayBuffer()); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, buf);
  const usd = referencePath ? 0.10 : 0.03; spend({ vendor: 'ideogram', tag, usd, out }); return { out, seed: img.seed, usd };
}
