#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPABASE_DIR="${ROOT_DIR}/.cache/supabase-source"
RUNTIME_DIR="${ROOT_DIR}/infra/supabase/runtime"
SCHEMA_FILE="${ROOT_DIR}/infra/supabase/schema.sql"

mkdir -p "${ROOT_DIR}/.cache" "${RUNTIME_DIR}"

if [ ! -d "${SUPABASE_DIR}/.git" ]; then
  git clone --depth 1 https://github.com/supabase/supabase "${SUPABASE_DIR}"
else
  git -C "${SUPABASE_DIR}" pull --ff-only
fi

rsync -a --delete "${SUPABASE_DIR}/docker/" "${RUNTIME_DIR}/"
if [ ! -f "${RUNTIME_DIR}/.env" ]; then
  cp "${RUNTIME_DIR}/.env.example" "${RUNTIME_DIR}/.env"
fi

mkdir -p "${RUNTIME_DIR}/volumes/db/elephant-ears"
cp "${SCHEMA_FILE}" "${RUNTIME_DIR}/volumes/db/elephant-ears/100-elephant-ears-schema.sql"
cp "${ROOT_DIR}/infra/supabase/docker-compose.elephant-ears.yml" "${RUNTIME_DIR}/docker-compose.elephant-ears.yml"

cat <<MSG
Supabase Docker bundle copied to:
  ${RUNTIME_DIR}

Next:
  1. cd ${RUNTIME_DIR}
  2. sh utils/generate-keys.sh
  3. sh utils/add-new-auth-keys.sh
  4. Edit .env URLs and SMTP settings.
  5. docker compose -f docker-compose.yml -f docker-compose.elephant-ears.yml up -d
  6. Apply volumes/db/elephant-ears/100-elephant-ears-schema.sql in Studio SQL editor or psql after Auth is ready.
MSG
