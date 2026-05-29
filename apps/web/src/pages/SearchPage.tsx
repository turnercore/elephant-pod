import { Check, Loader2, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CachedPodcast, Podcast } from '@/types/domain';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Panel } from '@/components/ui/Panel';
import { searchPodcastIndex, type PodcastDiscoveryResult } from '@/lib/podcastDiscovery';

const MIN_REMOTE_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 450;
const PODCAST_INDEX_RATE_LIMIT_MS = 1000;

export function SearchPage({
  podcasts,
  cachedPodcasts,
  canSearchRemote,
  accessToken,
  serverUrl,
  onOpenPodcast,
  onOpenRemotePodcast,
  onResolveFeedUrl,
  onSubscribe,
  onSubscribeRemote,
  onUnsubscribe
}: {
  podcasts: Podcast[];
  cachedPodcasts: CachedPodcast[];
  canSearchRemote: boolean;
  accessToken: string | null;
  serverUrl?: string;
  onOpenPodcast: (podcastId: string) => void;
  onOpenRemotePodcast: (result: PodcastDiscoveryResult) => void;
  onResolveFeedUrl: (feedUrl: string) => Promise<void>;
  onSubscribe: (podcastId: string) => void;
  onSubscribeRemote: (result: PodcastDiscoveryResult) => void;
  onUnsubscribe: (podcastId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<PodcastDiscoveryResult[]>([]);
  const [remoteStatus, setRemoteStatus] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const remoteCacheRef = useRef(new Map<string, PodcastDiscoveryResult[]>());
  const lastRemoteRequestAtRef = useRef(0);
  const subscribedFeedKeys = useMemo(() => new Set(podcasts.map((podcast) => normalizeFeedKey(podcast.feedUrl))), [podcasts]);
  const subscribedByFeedKey = useMemo(() => new Map(podcasts.map((podcast) => [normalizeFeedKey(podcast.feedUrl), podcast.id])), [podcasts]);
  const localResults = useMemo(() => searchLocalPodcasts(cachedPodcasts, query), [cachedPodcasts, query]);
  const localFeedKeys = useMemo(() => new Set(localResults.map((podcast) => normalizeFeedKey(podcast.feedUrl))), [localResults]);

  const results = useMemo(() => {
    const merged: SearchResult[] = localResults.map((podcast) => ({
      id: podcast.id,
      title: podcast.title,
      author: podcast.author,
      description: podcast.description,
      imageUrl: podcast.imageUrl,
      feedUrl: podcast.feedUrl,
      categories: podcast.categories,
      kind: 'local',
      subscribed: subscribedFeedKeys.has(normalizeFeedKey(podcast.feedUrl)),
      subscribedPodcastId: subscribedByFeedKey.get(normalizeFeedKey(podcast.feedUrl))
    }));
    for (const podcast of remoteResults) {
      if (localFeedKeys.has(normalizeFeedKey(podcast.feedUrl))) continue;
      merged.push({
        ...podcast,
        kind: 'remote',
        subscribed: subscribedFeedKeys.has(normalizeFeedKey(podcast.feedUrl)),
        subscribedPodcastId: subscribedByFeedKey.get(normalizeFeedKey(podcast.feedUrl))
      });
    }
    return merged;
  }, [localResults, remoteResults, localFeedKeys, subscribedFeedKeys, subscribedByFeedKey]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus('');
      return;
    }

    if (isFeedUrl(q)) {
      setRemoteResults([]);
      const cached = cachedPodcasts.some((podcast) => normalizeFeedKey(podcast.feedUrl) === normalizeFeedKey(q));
      if (cached) {
        setRemoteLoading(false);
        setRemoteStatus('Feed found in local cache.');
        return;
      }
      setRemoteLoading(true);
      setRemoteStatus('Checking RSS feed...');
      const timer = window.setTimeout(() => {
        void (async () => {
          try {
            await onResolveFeedUrl(q);
            if (!cancelled) setRemoteStatus('Feed cached. Subscribe from the result below.');
          } catch (error) {
            if (!cancelled) setRemoteStatus(error instanceof Error ? error.message : 'Feed could not be parsed.');
          } finally {
            if (!cancelled) setRemoteLoading(false);
          }
        })();
      }, SEARCH_DEBOUNCE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const remoteQueryKey = normalizeSearch(q);
    if (remoteQueryKey.length < MIN_REMOTE_QUERY_LENGTH) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus('');
      return;
    }

    if (!canSearchRemote) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus('Configure server + sign-in to search PodcastIndex.');
      return;
    }

    const cachedRemoteResults = remoteCacheRef.current.get(remoteQueryKey);
    if (cachedRemoteResults) {
      setRemoteResults(cachedRemoteResults);
      setRemoteLoading(false);
      setRemoteStatus(cachedRemoteResults.length ? '' : 'No PodcastIndex matches.');
      return;
    }

    setRemoteLoading(true);
    setRemoteStatus('Searching PodcastIndex...');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!serverUrl || !accessToken) throw new Error('Server URL and session are required.');
          const waitMs = Math.max(0, PODCAST_INDEX_RATE_LIMIT_MS - (Date.now() - lastRemoteRequestAtRef.current));
          if (waitMs) await delay(waitMs);
          if (cancelled) return;
          lastRemoteRequestAtRef.current = Date.now();
          const discovered = await searchPodcastIndex(serverUrl, accessToken, q);
          if (cancelled) return;
          remoteCacheRef.current.set(remoteQueryKey, discovered);
          setRemoteResults(discovered);
          setRemoteStatus(discovered.length ? '' : 'No PodcastIndex matches.');
        } catch (error) {
          if (cancelled) return;
          setRemoteStatus(error instanceof Error ? error.message : 'Podcast search failed.');
          setRemoteResults([]);
        } finally {
          if (!cancelled) setRemoteLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accessToken, cachedPodcasts, canSearchRemote, onResolveFeedUrl, query, serverUrl]);

  return (
    <Panel title="Search" className="h-full">
      <div className="border-b border-bone/15 p-4">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bone" size={18} aria-hidden />
          <Input className="h-14 w-full pl-10 text-lg" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search podcasts by name, creator, or private RSS URL" aria-label="Search podcasts" />
        </div>
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        {remoteLoading || remoteStatus ? (
          <p className="mb-4 flex items-center gap-2 text-sm text-bone" role="status">
            {remoteLoading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {remoteLoading ? remoteStatus || 'Searching...' : remoteStatus}
          </p>
        ) : null}
        {!query.trim() ? <p className="text-sm text-bone">Search by podcast name, creator, or paste a private RSS feed URL. Local cached podcasts appear first.</p> : null}
        <div className="grid gap-3">
          {results.map((result) => (
            <PodcastSearchRow
              key={`${result.kind}:${result.id}`}
              result={result}
              onOpen={() => result.kind === 'local' ? onOpenPodcast(result.id) : onOpenRemotePodcast(result)}
              onSubscribe={() => result.kind === 'local' ? onSubscribe(result.id) : onSubscribeRemote(result)}
              onUnsubscribe={() => onUnsubscribe(result.subscribedPodcastId || result.id)}
            />
          ))}
        </div>
        {query.trim() && !results.length && !remoteLoading ? <p className="mt-8 text-sm text-bone">No podcasts matched yet.</p> : null}
      </div>
    </Panel>
  );
}

function PodcastSearchRow({ result, onOpen, onSubscribe, onUnsubscribe }: { result: SearchResult; onOpen: () => void; onSubscribe: () => void; onUnsubscribe: () => void }) {
  return (
    <article className="rounded-eh border border-bone/15 bg-surface/80 p-3 transition hover:border-yellow/35">
      <div className="flex min-w-0 gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-3 text-left" aria-label={`Open ${result.title}`}>
          {result.imageUrl ? <img src={result.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-eh border border-bone/15 object-cover" /> : <div className="h-20 w-20 shrink-0 rounded-eh border border-bone/15 bg-canvas" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-black text-cream">{result.title}</span>
            {result.author ? <span className="mt-1 block truncate text-sm font-bold text-yellow">{result.author}</span> : null}
            {result.description ? <span className="mt-2 line-clamp-2 text-sm leading-5 text-bone">{stripHtml(result.description)}</span> : null}
            <span className="mt-2 flex flex-wrap gap-1">
              {result.kind === 'local' ? <Badge tone="teal">Cached</Badge> : <Badge tone="mauve">PodcastIndex</Badge>}
              {result.categories?.slice(0, 4).map((category) => <Badge key={category} tone="yellow">{category}</Badge>)}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-start">
          {result.subscribed ? (
            <Button variant="secondary" onClick={onUnsubscribe} aria-label={`Unsubscribe from ${result.title}`}>
              <Check size={16} aria-hidden />
              Subscribed
            </Button>
          ) : (
            <Button variant="primary" onClick={onSubscribe} aria-label={`Subscribe to ${result.title}`}>
              <Plus size={16} aria-hidden />
              Subscribe
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function searchLocalPodcasts(podcasts: CachedPodcast[], query: string): CachedPodcast[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [];
  return podcasts
    .map((podcast) => ({ podcast, score: scorePodcast(podcast, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.podcast.title.localeCompare(b.podcast.title))
    .map(({ podcast }) => podcast);
}

function scorePodcast(podcast: CachedPodcast, query: string): number {
  let score = 0;
  score += scoreField(normalizeSearch(podcast.title), query, 1000);
  score += scoreField(normalizeSearch(podcast.author || ''), query, 700);
  score += scoreField(normalizeSearch(podcast.feedUrl), query, 650);
  score += scoreField(normalizeSearch((podcast.categories || podcast.tags || []).join(' ')), query, 160);
  score += scoreField(normalizeSearch(podcast.description || ''), query, 60);
  return score;
}

function scoreField(field: string, query: string, weight: number): number {
  if (!field) return 0;
  if (field === query) return weight;
  if (field.startsWith(query)) return Math.floor(weight * 0.9);
  if (field.includes(query)) return Math.floor(weight * 0.7);
  const tokens = query.split(' ').filter(Boolean);
  const hits = tokens.filter((token) => field.includes(token)).length;
  return hits ? Math.floor((hits / tokens.length) * weight * 0.5) : 0;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeFeedKey(value: string): string {
  return value.trim().replace(/\/$/, '').toLowerCase();
}

function isFeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

type SearchResult = {
  id: string;
  title: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  feedUrl: string;
  categories?: string[];
  kind: 'local' | 'remote';
  subscribed: boolean;
  subscribedPodcastId?: string;
};
