# Self-hosted Supabase bundle

This directory contains a full local Supabase-style Docker bundle for Elephant Pod development and small private deployments.

Use this bundle when you want Supabase auth and Supabase Postgres together in one local stack. The root `infra/docker-compose.yml` example keeps a bare Postgres service by default, but this bundle is the self-hosted alternative for auth-heavy testing or a single local deployment.

## Start

```bash
cd infra/supabase
cp .env.example .env
# Replace JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, POSTGRES_PASSWORD, and dashboard credentials.
docker compose pull
docker compose up -d
```

Services:

- Supabase API gateway: `http://localhost:8000`
- Elephant Pod app/server: `http://localhost:8787`
- Mailpit magic-link inbox: `http://localhost:8025`
- Postgres direct dev port: `localhost:54322`

If you run the app server from the repository root instead of inside this compose network, point `DATABASE_URL` at `postgresql://postgres:<password>@localhost:54322/postgres` and set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from this bundle in your root `.env`.

`volumes/db/init/01-elephant-pod-schema.sql` is mounted into the database container so a fresh stack creates the Elephant Pod sync schema automatically.

The schema includes `sync_actions`, an append-only per-user action log used by clients to preserve offline queue, Inbox, played, and progress mutations across frequent sync conflicts. Access tokens are not stored in this schema; mobile/web auth sessions are device-local client data only.

## Environment contract

This stack assumes the server receives a secret-bearing env set. Keep these out of client bundles:

- `SUPABASE_URL` (project URL used by app server Supabase client)
- `SUPABASE_ANON_KEY` (for client/public policy checks and optional server fallbacks)
- `SUPABASE_SERVICE_ROLE_KEY` (for privileged server operations)
- `PODCASTINDEX_API_KEY` (server-only discovery credential)
- `PODCASTINDEX_API_SECRET` (server-only discovery credential)
- `PODCASTINDEX_USER_AGENT` (required by PodcastIndex API policy)
- `SERVER_PUBLIC_URL` (public app callback base used for clip links and discovery redirects)
- `SITE_URL` and `API_EXTERNAL_URL` (Supabase Auth host/redirect expectations)
- `GOTRUE_EXTERNAL_GITHUB_ENABLED`
- `GOTRUE_EXTERNAL_GITHUB_CLIENT_ID`
- `GOTRUE_EXTERNAL_GITHUB_SECRET`
- `GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI`

Auth callback/site expectations:

- `SITE_URL` should match the public UI origin that should receive Supabase auth callbacks.
- `API_EXTERNAL_URL` should resolve to the Supabase API host for server-side auth verification.
- `ADDITIONAL_REDIRECT_URLS` should include any browser landing pages you send users to after sign-in, including the server callback path when using `/api/auth/github/callback`.
- For GitHub provider login, the GitHub OAuth app callback should point to `${API_EXTERNAL_URL}/auth/v1/callback`, while Supabase's redirect allow-list controls the post-login landing URL.
- For development, keep `http://localhost:5173`, `http://localhost:8787`, and `tauri://localhost` in the allow-list as needed.
- In production, replace localhost values with TLS-secured public domains before exposing auth flows.

## Production notes

Use real JWTs signed with the same `JWT_SECRET`, put Caddy/Nginx/TLS in front of Kong and Elephant Pod, replace `latest` tags with a tested Supabase release set, and do not expose Postgres directly unless restricted by a firewall.

Validation notes:

- Clip sync/search endpoints should remain unavailable without a valid session token.
- Secret variables in this stack must be mounted from local environment files or a secret manager, never committed.
- If you use `docker-compose` with a direct `elephant-pod` run, pass `PODCASTINDEX_*` and `SUPABASE_*` environment values explicitly to that service.
