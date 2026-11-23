#!/usr/bin/env bash
# Gera infra/.env com segredos aleatórios para o ambiente LOCAL.
# Nunca reutilize estes valores em produção, e nunca copie os de produção para cá.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ] && [ "${1:-}" != "--forcar" ]; then
  echo ".env já existe. Use --forcar para recriar (isso invalida sessões e tokens locais)." >&2
  exit 1
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # $1 = role
  local header payload sig now exp
  now=$(date +%s); exp=$((now + 10*365*24*3600))
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"iss":"supabase","ref":"local","role":"%s","iat":%d,"exp":%d}' "$1" "$now" "$exp" | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
FIELDO_ADMIN_KEY=$(openssl rand -hex 24)

cat > .env <<EOF
# Gerado por scripts/gerar-env.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). Ambiente LOCAL.
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=$(jwt anon)
SERVICE_ROLE_KEY=$(jwt service_role)
FIELDO_ADMIN_KEY=${FIELDO_ADMIN_KEY}

# Endereços vistos pelo NAVEGADOR
SITE_URL=http://localhost:8080
API_EXTERNAL_URL=http://localhost:8000

# Opcional: só a Edge Function "assistant" usa. Vazio = assistente desligado.
ANTHROPIC_API_KEY=
EOF
chmod 600 .env
echo "infra/.env criado."
