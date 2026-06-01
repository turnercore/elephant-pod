# Smart Skip Segmenter

HTTP service for `POST /v1/segment`.

## Modes

Mock mode is for local integration checks:

```bash
MOCK_SEGMENTER=true node apps/segmenter/server.mjs
```

Real mode calls the OpenAI Responses API with structured JSON output:

```bash
OPENAI_API_KEY=sk-...
MOCK_SEGMENTER=false
CODEX_MODEL=gpt-5.4-mini
node apps/segmenter/server.mjs
```

The app server points at this service with:

```bash
SMART_SKIP_SEGMENTER_BASE_URL=http://localhost:8002
SMART_SKIP_SEGMENTER_MODEL=gpt-5.4-mini
```

## Health check

```bash
curl http://localhost:8002/health
```

## Production notes

- Keep `OPENAI_API_KEY` only on the segmenter host or secret manager.
- `MOCK_SEGMENTER=false` is required for real episode testing.
- `SEGMENTER_TIMEOUT_MS` defaults to `120000`.
- `SEGMENTER_MAX_TRANSCRIPT_SEGMENTS` defaults to `4000` to prevent accidentally sending unbounded transcript payloads.
