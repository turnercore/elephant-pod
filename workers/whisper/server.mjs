import http from 'node:http';

const port = Number(process.env.PORT || 8001);
const mock = process.env.MOCK_WHISPER === 'true';

http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/transcribe') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  if (!mock) {
    res.writeHead(501, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Install faster-whisper or WhisperX in this worker image for production transcription.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    mediaVersionId: body.mediaVersionId,
    provider: 'whisper',
    model: body.model || process.env.WHISPER_MODEL || 'large-v3-turbo',
    language: body.language || 'en',
    durationMs: 60_000,
    segments: [
      { startMs: 0, endMs: 9_000, speaker: null, text: 'Welcome to the episode.' },
      { startMs: 10_000, endMs: 30_000, speaker: null, text: 'This episode is brought to you by our mock sponsor. Use code elephant.' },
      { startMs: 31_000, endMs: 60_000, speaker: null, text: 'Now back to the show.' }
    ]
  }));
}).listen(port, () => {
  console.log(`Smart Skip mock Whisper worker listening on ${port}`);
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
