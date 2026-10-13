// CEO-008 — safe, navigable local preview of the Admin shell. SYNTHETIC DATA, NO PRODUCTION ACCESS.
//   node tests/preservation/preview.mjs [--port 4178]   then open http://127.0.0.1:4178/?shell=on
// Serves the real public/ with Supabase rewritten to an in-memory stub and a connect-src 'self' CSP.
// Any admin PIN is accepted by the stub's ceo_login. Writes land in memory only and vanish on restart.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--port');
const port = i >= 0 ? Number(process.argv[i + 1]) : 4178;
const stub = await startStub({ publicDir: path.resolve(here, '../../public'), port });
console.log(`CEO-008 preview (synthetic data, writes stay in memory): ${stub.origin}/?shell=on`);
console.log(`Flag OFF (today's experience): ${stub.origin}/?shell=off`);
