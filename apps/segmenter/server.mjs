import http from 'node:http';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 8002);
const mock = process.env.MOCK_SEGMENTER === 'true';

http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/segment') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  if (mock) {
    const transcript = JSON.stringify(body?.transcript || {}).toLowerCase();
    const hasSponsor = transcript.includes('brought to you by') || transcript.includes('use code');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      segments: hasSponsor ? [{
        type: 'sponsorship',
        subtype: 'mock',
        startMs: 10_000,
        endMs: 30_000,
        confidence: 0.96,
        action: 'auto_skip',
        label: 'Sponsor',
        evidence: ['mock sponsor phrase']
      }] : []
    }));
    return;
  }
  try {
    const output = await runCodex(JSON.stringify(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(output);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'segmenter failed' }));
  }
}).listen(port, () => {
  console.log(`Smart Skip segmenter listening on ${port}`);
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

function runCodex(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', [
      'exec',
      '--model',
      process.env.CODEX_MODEL || 'gpt-5.3-codex-spark',
      '--output-schema',
      '/app/segmenter-output.schema.json',
      `Return Smart Skip segment JSON for this request. Return JSON only.\n${payload}`
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('exit', (code) => {
      if (code === 0 && stdout.trim()) resolve(stdout.trim());
      else reject(new Error(stderr || `codex exited with ${code}`));
    });
    child.on('error', reject);
  });
}
