# Smart Skip Whisper Worker

This is a minimal HTTP contract scaffold for `POST /v1/transcribe`.

Set `MOCK_WHISPER=true` for local development. Production deployments should replace
`server.mjs` or this image with a faster-whisper/WhisperX service on the GPU host.
Do not commit model weights.
