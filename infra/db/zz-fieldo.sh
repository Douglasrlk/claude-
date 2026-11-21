#!/bin/sh
# Roda UMA vez, na criação do volume, depois do migrate.sh da imagem supabase/postgres
# (a ordem é alfabética: "migrate.sh" < "zz-fieldo.sh").
set -eu

# Senhas dos papéis de serviço (PostgREST, GoTrue, Storage) = POSTGRES_PASSWORD.
psql -v ON_ERROR_STOP=1 --no-psqlrc -U supabase_admin -d postgres <<EOSQL
ALTER USER authenticator          WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER pgbouncer              WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_auth_admin    WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER USER supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
EOSQL

# Baseline do Fieldo, idêntica ao catálogo de produção (ver docs/ANALISE.md §2).
for f in /fieldo/init/*.sql; do
  echo "zz-fieldo.sh: aplicando $f"
  psql -v ON_ERROR_STOP=1 --no-psqlrc -q -U postgres -d postgres -f "$f"
done

# Buckets, policies de storage e dados de demonstração rodam depois, no
# serviço "db-post" do compose (precisam das tabelas que o GoTrue e o
# storage-api criam ao subir).
