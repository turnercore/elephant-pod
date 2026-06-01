# Smart Skip Segmenter

HTTP service for synchronous `POST /v1/segment` and asynchronous Batch-backed
`POST /v1/segment-batches`.

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

Real Batch mode uses the OpenAI Batch API against `/v1/responses`. The app
server submits one segment request with `POST /v1/segment-batches`, stores the
returned `externalId`, and later polls `GET /v1/segment-batches/:externalId`.
Completed batch checks return the same segment JSON shape as `/v1/segment`.

The app server points at this service with:

```bash
SMART_SKIP_SEGMENTER_BASE_URL=http://localhost:8002
SMART_SKIP_SEGMENTER_MODEL=gpt-5.4-mini
SMART_SKIP_SEGMENTER_BATCH_ENABLED=true
SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_HOURS=12
```

## Health check

```bash
curl http://localhost:8002/health
```

## Production notes

- Keep `OPENAI_API_KEY` only on the segmenter host or secret manager.
- `MOCK_SEGMENTER=false` is required for real episode testing.
- `SMART_SKIP_SEGMENTER_BATCH_ENABLED=true` makes the app server submit
  segmenting work through `/v1/segment-batches` and release jobs until their
  next check window.
- `SEGMENTER_TIMEOUT_MS` defaults to `120000`.
- `SEGMENTER_MAX_TRANSCRIPT_SEGMENTS` defaults to `4000` to prevent accidentally sending unbounded transcript payloads.
