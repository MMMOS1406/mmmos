#!/bin/bash
# Real-PostgREST verification of the G1 lock — NON-PRODUCTION. Starts a throwaway PostgreSQL + PostgREST on 127.0.0.1, runs the test, stops and deletes everything.
#   G1_PG_BIN=<dir with initdb/pg_ctl/psql>  G1_PGREST=<postgrest binary>  G1_WORK=<empty scratch dir>  [G1_PG_LIB=<dir with libpq.5.dylib>]  bash tests/g1security/realdb/run.sh
set -u
: "${G1_PG_BIN:?}" "${G1_PGREST:?}" "${G1_WORK:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
PGPORT=54329; RPORT=54330; XPORT=54331; DATA="$G1_WORK/pgdata"; SOCK="/tmp/g1pg.$$"; mkdir -p "$SOCK"   # short path: Unix-socket paths are limited to ~100 characters; rm -rf "$DATA"
export DYLD_FALLBACK_LIBRARY_PATH="${G1_PG_LIB:-$(dirname "$G1_PG_BIN")/lib}"
cleanup() { [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null; [ -n "${REST_PID:-}" ] && kill "$REST_PID" 2>/dev/null; "$G1_PG_BIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1; rm -rf "$DATA"; }
trap cleanup EXIT
"$G1_PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null || exit 2
"$G1_PG_BIN/pg_ctl" -D "$DATA" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -k $SOCK -c max_connections=60" -l "$G1_WORK/pg.log" -w start >/dev/null || exit 2
"$G1_PG_BIN/psql" -h 127.0.0.1 -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q -f "$HERE/schema.sql" postgres || exit 2
SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)"   # throwaway JWT secret for this local run only; never written anywhere
JWT="$(node -e "const c=require('node:crypto');const b=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'service_role'});process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.argv[1]).update(h+'.'+p).digest('base64url'))" "$SECRET")"
ANON="$(node -e "const c=require('node:crypto');const b=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon'});process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',process.argv[1]).update(h+'.'+p).digest('base64url'))" "$SECRET")"
PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PGPORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=$RPORT PGRST_DB_POOL=10 "$G1_PGREST" >"$G1_WORK/postgrest.log" 2>&1 &
REST_PID=$!
node "$HERE/proxy.mjs" $XPORT $RPORT & PROXY_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$XPORT/rest/v1/app_settings?limit=0" -H "Authorization: Bearer $JWT" && break; sleep 0.5; done
G1_REAL_URL="http://127.0.0.1:$XPORT" G1_REAL_JWT="$JWT" G1_REAL_ANON="$ANON" G1_PSQL="$G1_PG_BIN/psql" G1_PGPORT=$PGPORT node "$REPO/tests/g1security/test_g1_lock_real_postgrest.mjs"
RC=$?
echo "postgrest log (last lines):"; tail -3 "$G1_WORK/postgrest.log" | cut -c1-160
exit $RC
