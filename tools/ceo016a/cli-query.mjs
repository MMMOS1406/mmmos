// CEO-016B — a `query(sql, params)` adapter over the Supabase CLI's own authorized session: `supabase db query --linked` (Management API, temporary login role).
// No database password and no token is read, stored or printed by this code; the CLI performs the authentication it already has. Read-only use only.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';

export function inlineParams(sql, params = []) {
  const lit = (v) => {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return v.length === 0 ? "'{}'::text[]" : `array[${v.map(lit).join(',')}]::${v.every((x) => typeof x === 'number') ? 'int' : 'text'}[]`;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return "'" + String(v).replace(/'/g, "''") + "'";
  };
  return sql.replace(/\$(\d+)/g, (m, n) => (params[n - 1] === undefined ? m : lit(params[n - 1])));
}

export function makeCliQuery({ workdir, supabaseBin = 'supabase', readOnlyGuard = true }) {
  return async (sql, params) => {
    const text = inlineParams(sql, params);
    if (readOnlyGuard && /^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy)\b/i.test(text)) throw new Error('read-only adapter refused a write statement');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbq-')); const file = path.join(dir, 'q.sql'); fs.writeFileSync(file, text, { mode: 0o600 });
    try {
      const r = spawnSync(supabaseBin, ['db', 'query', '--linked', '--file', file, '--output-format', 'json', '--workdir', workdir], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`supabase db query failed (${r.status}): ${String(r.stderr || r.stdout).replace(/\s+/g, ' ').slice(0, 300)}`);
      const out = r.stdout; const i = out.indexOf('{'); const json = JSON.parse(out.slice(i));
      if (!Array.isArray(json.rows)) throw new Error('unexpected CLI output: ' + out.slice(0, 200));
      return { rows: json.rows };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}
