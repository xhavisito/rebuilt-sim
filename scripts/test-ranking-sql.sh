#!/usr/bin/env bash
# Prueba docs/ranking.sql en un Postgres local desechable (necesita postgresql instalado).
# Uso: scripts/test-ranking-sql.sh   (o PGURL=postgres://… para usar uno que ya corre)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "${PGURL:-}" ]; then
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f tests/sql/ranking.test.sql
  exit
fi
PG=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)
[ -z "$PG" ] && PG=$(dirname "$(command -v initdb)")
D=$(mktemp -d /var/tmp/rk-XXXXXX)
RUN=()
if [ "$(id -u)" = 0 ]; then chown -R postgres "$D"; RUN=(su postgres -c); fi
run() { if [ ${#RUN[@]} -gt 0 ]; then "${RUN[@]}" "$*"; else bash -c "$*"; fi; }
cleanup() { run "$PG/pg_ctl -D $D/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
run "$PG/initdb -D $D/data -A trust -U postgres" >/dev/null
run "$PG/pg_ctl -D $D/data -o '-p 5498 -k $D -c listen_addresses=' -l $D/log -w start" >/dev/null
psql -h "$D" -p 5498 -U postgres -v ON_ERROR_STOP=1 -q -f tests/sql/ranking.test.sql
