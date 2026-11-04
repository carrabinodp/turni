#!/bin/bash
# Avvia un Postgres temporaneo, applica stub + migrazione e lancia i test.
set -e
PG=/usr/lib/postgresql/16/bin
DIR=$(mktemp -d)
chown postgres "$DIR"
su postgres -c "$PG/initdb -D $DIR/data -A trust -U postgres >/dev/null"
su postgres -c "$PG/pg_ctl -D $DIR/data -o '-k $DIR -p 54329 -c listen_addresses=' -l $DIR/log start >/dev/null"
trap "su postgres -c '$PG/pg_ctl -D $DIR/data stop -m immediate >/dev/null'; rm -rf $DIR" EXIT
P="psql -h $DIR -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t"
$P -d t -f "$(dirname $0)/supabase_stub.sql"
$P -d t -f "$(dirname $0)/../../supabase/migrations/0001_init.sql"
$P -d t -f "$(dirname $0)/../../supabase/migrations/0002_giornate_pause.sql"
$P -d t -f "$(dirname $0)/../../supabase/migrations/0003_team_calendario.sql"
$P -d t -c "grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;"
$P -d t -f "$(dirname $0)/tests.sql"
