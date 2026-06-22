import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;

type LookupAddress = { address: string };

export interface UrlSafetyOptions {
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
}

export interface BoundedFetchOptions extends UrlSafetyOptions {
  fetcher?: typeof fetch;
  headers?: HeadersInit;
  maxBytes: number;
  timeoutMs: number;
}

export async function assertPublicHttpUrl(input: string | URL, options: UrlSafetyOptions = {}): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are allowed.');
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Private network URLs are not allowed.');

  const directIp = net.isIP(host) ? [{ address: host }] : undefined;
  const addresses = directIp || await (options.lookup || defaultLookup)(host);
  if (!addresses.length) throw new Error('URL host did not resolve.');
  if (addresses.some((entry) => isBlockedIp(entry.address))) throw new Error('Private network URLs are not allowed.');
  return url;
}

export async function fetchBoundedText(input: string | URL, options: BoundedFetchOptions): Promise<{ body: string; url: string; response: Response }> {
  const fetcher = options.fetcher || fetch;
  let url = await assertPublicHttpUrl(input, options);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: options.headers,
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (error) {
      throw error instanceof Error && error.name === 'AbortError' ? new Error(`URL fetch timed out after ${options.timeoutMs}ms.`) : error;
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect from ${url.href} did not include a location.`);
      if (redirects === MAX_REDIRECTS) throw new Error('Too many redirects while fetching URL.');
      url = await assertPublicHttpUrl(new URL(location, url), options);
      continue;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > options.maxBytes) throw new Error(`URL response exceeded ${options.maxBytes} bytes.`);
    const body = await readBoundedText(response, options.maxBytes);
    return { body, url: url.href, response };
  }
  throw new Error('Too many redirects while fetching URL.');
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error(`URL response exceeded ${maxBytes} bytes.`);
    return body;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`URL response exceeded ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isBlockedIp(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isBlockedIpv4(mapped);
  if (net.isIP(address) === 4) return isBlockedIpv4(address);
  if (net.isIP(address) === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return true;
  const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  );
}
