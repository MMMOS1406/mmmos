// SRV Farsi Creative V2 — live [TEST] generation run for all 9 Artist × Mood combinations.
// Calls the deployed /api/generate exactly like the app's guard (structured artist/mood, srvFarsiTest:true,
// up to 3 attempts, failed-gate reasons fed into the next attempt). Saves nothing in MMMOS (no package rows,
// no memory rows, no task state) — it only records what the V2 brain returns.
//
//   node tests/srv/srvf-creative-v2-live/run-combos.mjs <origin> <out.json> [concurrency] [Artist-Mood,...]
import fs from 'node:fs';

const origin = process.argv[2];
const outFile = process.argv[3];
const conc = Number(process.argv[4] || 3);
const only = process.argv[5] ? process.argv[5].split(',') : null;
if (!origin || !outFile) { console.error('usage: run-combos.mjs <origin> <out.json> [concurrency] [Artist-Mood,...]'); process.exit(2); }

const combos = [];
for (const artist of ['Male', 'Female', 'Duet']) for (const mood of ['Emotional', 'Romantic', 'Happy']) combos.push({ artist, mood });
const todo = only ? combos.filter(c => only.includes(c.artist + '-' + c.mood)) : combos;

async function attempt(c, n, feedback) {
  const t0 = Date.now();
  const r = await fetch(origin + '/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: 'SRV Farsi', srvFarsiCreativeV2: true, srvFarsiTest: true, artist: c.artist, mood: c.mood, format: 'Long', attempt: n, feedback, taskName: `SRV Farsi — Long · ${c.artist} — ${c.mood} [TEST]` }),
  });
  let j; const text = await r.text();
  try { j = JSON.parse(text); } catch (_) { j = { success: false, code: 'http_' + r.status, error: text.slice(0, 300) }; }
  return { status: r.status, ms: Date.now() - t0, json: j };
}

async function runCombo(c) {
  const rec = { ...c, attempts: [], result: null };
  let feedback = [];
  for (let n = 1; n <= 3; n++) {
    const a = await attempt(c, n, feedback);
    const j = a.json;
    rec.attempts.push({ n, status: a.status, ms: a.ms, code: j.code || (j.success ? 'success' : ''), failed: j.failed || null, gateResults: j.gateResults || (j.package && j.package.creativeGateResults) || null, preview: j.preview || null, error: j.error || null });
    console.log(`${c.artist}-${c.mood} attempt ${n}: ${a.status} ${j.success ? 'PASS' : (j.code || 'error')} ${(j.failed || []).map(f => f.gate).join(',')} ${a.ms}ms`);
    if (j.code === 'srv_farsi_creative_v2_off') { rec.result = 'flag_off'; break; }
    if (j.success) { rec.result = 'pass'; rec.package = j.package; break; }
    feedback = j.failed || [{ gate: 'API', reason: j.error || ('HTTP ' + a.status) }];
  }
  if (!rec.result) rec.result = 'failed_after_3';
  return rec;
}

const results = [];
const queue = [...todo];
await Promise.all(Array.from({ length: conc }, async () => { while (queue.length) { const c = queue.shift(); results.push(await runCombo(c)); fs.writeFileSync(outFile, JSON.stringify(results, null, 2)); } }));
results.sort((a, b) => combos.findIndex(c => c.artist === a.artist && c.mood === a.mood) - combos.findIndex(c => c.artist === b.artist && c.mood === b.mood));
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log('\nSUMMARY');
for (const r of results) console.log(`${r.artist}-${r.mood}: ${r.result} after ${r.attempts.length} attempt(s)${r.package ? ' · suno ' + r.package.sunoPrompt.length + ' chars · ' + r.package.title : ''}`);
