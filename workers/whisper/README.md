# Smart Skip Whisper Worker

This is a minimal HTTP contract scaffold for `POST /v1/transcribe`.

Set `MOCK_WHISPER=true` for local integration checks only. Real Smart Skip processing
requires `SMART_SKIP_WHISPER_BASE_URL` to point at a live Whisper-compatible service.
Production deployments should replace `server.mjs` or this image with a
faster-whisper/WhisperX service on the GPU host.
Do not commit model weights.

## Endpoint contract

Health check:

```bash
curl http://<whisper-host>:8001/health
```

Transcription request:

```json
{
  "mediaVersionId": "ssk_mv_...",
  "audioUrl": "https://example.com/episode.mp3",
  "model": "large-v3-turbo",
  "language": "en",
  "wordTimestamps": true,
  "vadFilter": true
}
```

Transcription response:

```json
{
  "mediaVersionId": "ssk_mv_...",
  "provider": "whisper",
  "model": "large-v3-turbo",
  "language": "en",
  "durationMs": 3600000,
  "segments": [
    { "startMs": 0, "endMs": 5000, "speaker": null, "text": "Welcome." }
  ]
}
```

For your laptop setup, run the real Whisper service on the local network or
Tailscale and set the app server env to:

```bash
SMART_SKIP_WHISPER_BASE_URL=http://<laptop-tailscale-name-or-ip>:8001
MOCK_WHISPER=false
```
