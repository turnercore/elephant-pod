import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 8002);
const mock = process.env.MOCK_SEGMENTER === 'true';
const openAiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const defaultModel = process.env.CODEX_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const timeoutMs = Number(process.env.SEGMENTER_TIMEOUT_MS || 120_000);
const localDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = existsSync('/app/segmenter-output.schema.json')
  ? '/app/segmenter-output.schema.json'
  : path.join(localDir, 'segmenter-output.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'smart-skip-segmenter', mock, model: defaultModel }));
    return;
  }
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
    const output = await segmentWithOpenAI(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(output));
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

async function segmentWithOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required when MOCK_SEGMENTER=false.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs).unref();
  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: payload?.model || defaultModel,
        instructions: buildInstructions(payload),
        input: JSON.stringify(compactPayload(payload)),
        text: {
          format: {
            type: 'json_schema',
            name: 'smart_skip_segments',
            schema
          }
        }
      })
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenAI segmenter request failed with ${response.status}: ${raw.slice(0, 500)}`);
    return parseSegmenterOutput(JSON.parse(raw));
  } finally {
    clearTimeout(timeout);
  }
}

function buildInstructions(payload) {
  return [
    payload?.instructions?.text || 'Return Smart Skip segment JSON for this podcast episode.',
    'Return only JSON matching the supplied schema.',
    'Prefer false negatives over false positives.',
    'Do not invent timestamps. Use transcript timestamps and silence-map boundaries only.',
    'Do not mark normal product discussion as an ad unless the transcript clearly contains promotional or sponsor language.'
  ].join('\n');
}

function compactPayload(payload) {
  const transcript = payload?.transcript || {};
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  const maxSegments = Math.max(1, Number(process.env.SEGMENTER_MAX_TRANSCRIPT_SEGMENTS || 4000));
  return {
    episode: payload?.episode,
    mediaVersion: payload?.mediaVersion,
    transcript: {
      ...transcript,
      segments: segments.slice(0, maxSegments)
    },
    silenceMap: payload?.silenceMap || []
  };
}

function parseSegmenterOutput(response) {
  const text = response.output_text || response.output?.flatMap((item) => item.content || []).find((content) => content.type === 'output_text' || content.type === 'text')?.text;
  if (!text) throw new Error('OpenAI segmenter response did not include output text.');
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.segments)) throw new Error('OpenAI segmenter response did not include segments.');
  return parsed;
}
