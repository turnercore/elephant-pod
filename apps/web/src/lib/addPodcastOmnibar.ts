export type AddPodcastInputKind = 'empty' | 'rss-url' | 'youtube-url' | 'search';
export type YoutubeInputKind = 'video' | 'playlist' | 'channel' | 'unknown';

export interface AddPodcastInput {
  kind: AddPodcastInputKind;
  value: string;
  youtubeKind?: YoutubeInputKind;
}

export function classifyAddPodcastInput(input: string): AddPodcastInput {
  const value = input.trim();
  if (!value) return { kind: 'empty', value };
  if (isHttpUrl(value)) {
    const youtubeKind = classifyYoutubeUrl(value);
    if (youtubeKind) return { kind: 'youtube-url', value, youtubeKind };
    return { kind: 'rss-url', value };
  }
  return { kind: 'search', value };
}

export function classifyYoutubeUrl(input: string): YoutubeInputKind | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return null;
  if (host === 'youtu.be') return 'video';
  if (url.searchParams.has('list')) return 'playlist';
  if (url.pathname.startsWith('/playlist')) return 'playlist';
  if (url.pathname.startsWith('/podcast/')) return 'playlist';
  if (url.pathname.startsWith('/watch') && url.searchParams.has('v')) return 'video';
  if (url.pathname.startsWith('/shorts/')) return 'video';
  if (url.pathname.startsWith('/channel/') || url.pathname.startsWith('/c/') || url.pathname.startsWith('/@')) return 'channel';
  return 'unknown';
}

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
