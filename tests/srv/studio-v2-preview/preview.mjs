// SRV Studio V2 — Checkpoint A interactive preview. SAMPLE DATA, NO PRODUCTION ACCESS.
//   node tests/srv/studio-v2-preview/preview.mjs [--port 4188] [--data FILE]
// Open the printed URL, choose Mansoor (Admin), enter any PIN (the preview accepts any), open Tasks.
// Edits are kept in FILE (default ~/MMM/srv-studio-v2-discovery/preview-state.json) so they survive a
// reload and a restart. Reset the sample data: open <origin>/__stub/reset.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', 4188));
const dataFile = arg('--data', path.join(os.homedir(), 'MMM', 'srv-studio-v2-discovery', 'preview-state.json'));
const p = await startPreview({ publicDir: path.resolve(here, '../../../public'), port, dataFile, quiet: false });
console.log(`SRV Studio V2 preview (sample data, writes stay on this computer): ${p.origin}/`);
console.log(`Legacy view for comparison (V2 forced off): ${p.origin}/?srvStudioV2=off`);
console.log(`Isolation log: ${p.origin}/__stub/log · reset sample data: ${p.origin}/__stub/reset`);
console.log(`Data file: ${dataFile}`);
