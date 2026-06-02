import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 8002);
const mock = process.env.MOCK_SEGMENTER === 'true';
// Segmenter backend options:
// - none: disable real segmenting in this service
// - openai_batch: use OpenAI Batch API against /v1/responses
const backend = process.env.SEGMENTER_BACKEND || 'openai_batch';
const openAiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const defaultModel = process.env.SEGMENTER_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const timeoutMs = Number(process.env.SEGMENTER_TIMEOUT_MS || 120_000);
const localDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = existsSync('/app/segmenter-output.schema.json')
  ? '/app/segmenter-output.schema.json'
  : path.join(localDir, 'segmenter-output.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'smart-skip-segmenter', backend, mock, model: defaultModel }));
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/v1/segment-batches/')) {
    try {
      const externalId = decodeURIComponent(req.url.split('/').pop() || '');
      const output = await checkSegmentBatch(externalId);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(output));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'segmenter batch check failed' }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/segment-batches') {
    const body = await readJson(req);
    try {
      const output = await submitSegmentBatch(body);
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(output));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'segmenter batch submission failed' }));
    }
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/segment') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  if (mock) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(mockSegmenterOutput(body)));
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
  assertOpenAiBatchBackend();
  const apiKey = requireOpenAiKey();
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
        ...buildResponsesBody(payload)
      })
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`OpenAI segmenter request failed with ${response.status}: ${raw.slice(0, 500)}`);
    return parseSegmenterOutput(JSON.parse(raw));
  } finally {
    clearTimeout(timeout);
  }
}

async function submitSegmentBatch(payload) {
  const customId = typeof payload?.customId === 'string' && payload.customId.trim()
    ? payload.customId.trim()
    : `smart-skip-${Date.now()}`;
  const request = payload?.request || payload;
  if (mock) {
    return {
      provider: 'mock',
      externalId: `mock_batch_${customId}`,
      status: 'completed',
      result: mockSegmenterOutput(request)
    };
  }
  assertOpenAiBatchBackend();
  const apiKey = requireOpenAiKey();
  const jsonl = JSON.stringify({
    custom_id: customId,
    method: 'POST',
    url: '/v1/responses',
    body: buildResponsesBody(request)
  }) + '\n';
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), `${customId}.jsonl`);
  const file = await openAiJson('/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form
  });
  const batch = await openAiJson('/batches', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      input_file_id: file.id,
      endpoint: '/v1/responses',
      completion_window: '24h',
      metadata: {
        custom_id: customId,
        feature: 'smart-skip'
      }
    })
  });
  return batchToResponse(batch);
}

async function checkSegmentBatch(externalId) {
  if (!externalId) throw new Error('Segmenter batch id is required.');
  if (mock || externalId.startsWith('mock_batch_')) {
    return { provider: 'mock', externalId, status: 'completed', result: { segments: [] } };
  }
  assertOpenAiBatchBackend();
  const apiKey = requireOpenAiKey();
  const batch = await openAiJson(`/batches/${encodeURIComponent(externalId)}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  const response = batchToResponse(batch);
  if (batch.status !== 'completed') return response;
  if (!batch.output_file_id) throw new Error(`OpenAI batch ${externalId} completed without output_file_id.`);
  const outputText = await openAiText(`/files/${encodeURIComponent(batch.output_file_id)}/content`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  const result = parseBatchOutput(outputText);
  return {
    ...response,
    status: 'completed',
    result
  };
}

function buildResponsesBody(payload) {
  return {
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
  };
}

function batchToResponse(batch) {
  return {
    provider: 'openai',
    externalId: batch.id,
    status: normalizeBatchStatus(batch.status),
    inputFileId: batch.input_file_id,
    outputFileId: batch.output_file_id,
    errorFileId: batch.error_file_id,
    error: batch.errors ? JSON.stringify(batch.errors).slice(0, 1000) : undefined
  };
}

function normalizeBatchStatus(status) {
  if (status === 'cancelling') return 'in_progress';
  return status || 'submitted';
}

function parseBatchOutput(outputText) {
  const lines = outputText.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('OpenAI batch output was empty.');
  const first = JSON.parse(lines[0]);
  if (first.error) throw new Error(first.error.message || 'OpenAI batch request failed.');
  const body = first.response?.body;
  if (!body) throw new Error('OpenAI batch output did not include response body.');
  return parseSegmenterOutput(body);
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
  parsed.segments = parsed.segments.map((segment) => {
    if (segment && typeof segment === 'object' && segment.subtype === null) {
      const { subtype, ...rest } = segment;
      return rest;
    }
    return segment;
  });
  if (response.usage) parsed.usage = normalizeUsage(response.usage);
  return parsed;
}

function normalizeUsage(usage) {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    raw: usage
  };
}

function mockSegmenterOutput(body) {
  const transcript = JSON.stringify(body?.transcript || {}).toLowerCase();
  const hasSponsor = transcript.includes('brought to you by') || transcript.includes('use code');
  return {
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
  };
}

function requireOpenAiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required when MOCK_SEGMENTER=false.');
  return apiKey;
}

function assertOpenAiBatchBackend() {
  if (backend === 'none') {
    throw new Error('SEGMENTER_BACKEND=none disables the Smart Skip segmenter service.');
  }
  if (backend !== 'openai_batch') {
    throw new Error(`Unsupported SEGMENTER_BACKEND=${backend}. Supported values: none, openai_batch.`);
  }
}

async function openAiJson(pathname, init) {
  const response = await fetch(`${openAiBaseUrl}${pathname}`, init);
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}: ${raw.slice(0, 500)}`);
  return JSON.parse(raw);
}

async function openAiText(pathname, init) {
  const response = await fetch(`${openAiBaseUrl}${pathname}`, init);
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}: ${raw.slice(0, 500)}`);
  return raw;
}
