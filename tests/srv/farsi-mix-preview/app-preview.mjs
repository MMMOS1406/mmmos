// Human-navigable local preview of the REAL app with the SRV Farsi Mix and the repaired SRV English Short selector. SYNTHETIC DATA, NO PRODUCTION ACCESS; writes stay in memory.
//   node tests/srv/farsi-mix-preview/app-preview.mjs [--port 4179]
//   Farsi (Mix ON):   http://127.0.0.1:4179/?srvfMix=1   → sign in as the CEO (any PIN) or VA, open task "SRV Farsi — Female — Romantic · Short", set Format = Mix
//   English (repair): second server on port+1 — open the task "SRV English — Female — Emotional · Long", choose SHORT
import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
import { startStub } from '../../preservation/stub-server.mjs'; import { farsiFx, engFx } from './fixtures-app.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const i = process.argv.indexOf('--port'); const port = i >= 0 ? Number(process.argv[i + 1]) : 4179;
const pub = path.resolve(here, '../../../public');
const a = await startStub({ publicDir: pub, fixture: farsiFx({ songsDir: path.join(process.env.PREVIEW_PACK || path.join(os.homedir(), 'MMM', 'srv-farsi-mix-preview'), 'songs') }), port }); const b = await startStub({ publicDir: pub, fixture: engFx(), port: port + 1 });
console.log(`SRV Farsi Mix preview (synthetic): ${a.origin}/?srvfMix=1\nSRV English Short-selector preview (synthetic): ${b.origin}/`);
