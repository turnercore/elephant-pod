import type { SmartSkipSegment } from './types.js';

const CATEGORY_MAP: Record<string, SmartSkipSegment['type']> = {
  sponsor: 'sponsorship',
  intro: 'intro',
  outro: 'outro',
  selfpromo: 'self_promo',
  interaction: 'self_promo',
  preview: 'intro',
  music_offtopic: 'self_promo'
};

export function extractYouTubeVideoId(input: { audioUrl?: string; websiteUrl?: string; description?: string }): string | null {
  const haystack = [input.audioUrl, input.websiteUrl, input.description].filter(Boolean).join(' ');
  const patterns = [
    /(?:youtube\.com\/watch\?[^"' <>\n]*v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:^|[?&])v=([a-zA-Z0-9_-]{11})(?:&|$)/
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function mapSponsorBlockSegments(raw: unknown): Omit<SmartSkipSegment, 'id'>[] {
  if (!Array.isArray(raw)) return [];
  const segments: Omit<SmartSkipSegment, 'id'>[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const category = typeof record.category === 'string' ? record.category : '';
    const type = CATEGORY_MAP[category];
    const segment = Array.isArray(record.segment) ? record.segment : [];
    const startSec = Number(segment[0]);
    const endSec = Number(segment[1]);
    if (!type || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
    segments.push({
      type,
      startMs: Math.round(startSec * 1000),
      endMs: Math.round(endSec * 1000),
      confidence: 0.98,
      action: 'auto_skip',
      source: 'sponsorblock',
      label: labelFor(type),
      evidence: [category]
    });
  }
  return segments;
}

export async function fetchSponsorBlockSegments(videoId: string, fetchImpl: typeof fetch = fetch): Promise<Omit<SmartSkipSegment, 'id'>[]> {
  const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(Object.keys(CATEGORY_MAP)))}`;
  const response = await fetchImpl(url);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`SponsorBlock request failed with ${response.status}`);
  return mapSponsorBlockSegments(await response.json());
}

function labelFor(type: SmartSkipSegment['type']): string {
  if (type === 'sponsorship') return 'Sponsor';
  if (type === 'self_promo') return 'Self promo';
  if (type === 'intro') return 'Intro';
  if (type === 'outro') return 'Outro';
  return 'Smart Skip';
}
