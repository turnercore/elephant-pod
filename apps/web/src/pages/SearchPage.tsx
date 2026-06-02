import { LuCheck as Check, LuLoader as Loader2, LuPlus as Plus, LuSearch as Search, LuWifiOff as WifiOff, LuYoutube as Youtube } from 'react-icons/lu';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CachedPodcast, Podcast } from '@/types/domain';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Panel } from '@/components/ui/Panel';
import { classifyAddPodcastInput } from '@/lib/addPodcastOmnibar';
import { searchPodcastIndex, type PodcastDiscoveryResult } from '@/lib/podcastDiscovery';

const MIN_REMOTE_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 450;
const PODCAST_INDEX_RATE_LIMIT_MS = 1000;

export function SearchPage({
  podcasts,
  cachedPodcasts,
  canSearchRemote,
  canUseYoutubeImport,
  offline,
  accessToken,
  serverUrl,
  onOpenPodcast,
  onOpenRemotePodcast,
  onResolveFeedUrl,
  onImportYoutube,
  onSubscribe,
  onSubscribeRemote
}: {
  podcasts: Podcast[];
  cachedPodcasts: CachedPodcast[];
  canSearchRemote: boolean;
  canUseYoutubeImport: boolean;
  offline?: boolean;
  accessToken: string | null;
  serverUrl?: string;
  onOpenPodcast: (podcastId: string) => void;
  onOpenRemotePodcast: (result: PodcastDiscoveryResult) => void;
  onResolveFeedUrl: (feedUrl: string) => Promise<void>;
  onImportYoutube: (url: string) => Promise<void>;
  onSubscribe: (podcastId: string) => void;
  onSubscribeRemote: (result: PodcastDiscoveryResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<PodcastDiscoveryResult[]>([]);
  const [remoteStatus, setRemoteStatus] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const remoteCacheRef = useRef(new Map<string, PodcastDiscoveryResult[]>());
  const lastRemoteRequestAtRef = useRef(0);
  const subscribedFeedKeys = useMemo(() => new Set(podcasts.map((podcast) => normalizeFeedKey(podcast.feedUrl))), [podcasts]);
  const subscribedByFeedKey = useMemo(() => new Map(podcasts.map((podcast) => [normalizeFeedKey(podcast.feedUrl), podcast.id])), [podcasts]);
  const input = useMemo(() => classifyAddPodcastInput(query), [query]);
  const visibleInput = input.kind === 'youtube-url' && !canUseYoutubeImport ? { kind: 'search' as const, value: input.value } : input;
  const exactKnownPodcast = useMemo(() => {
    if (visibleInput.kind !== 'rss-url' && visibleInput.kind !== 'youtube-url') return null;
    return cachedPodcasts.find((podcast) =>
      normalizeFeedKey(podcast.feedUrl) === normalizeFeedKey(visibleInput.value) ||
      normalizeFeedKey(podcast.sourceUrl || '') === normalizeFeedKey(visibleInput.value)
    ) || null;
  }, [cachedPodcasts, visibleInput.kind, visibleInput.value]);

  const results = useMemo(() => {
    const merged: SearchResult[] = [];
    if (exactKnownPodcast) {
      merged.push({
        id: exactKnownPodcast.id,
        title: exactKnownPodcast.title,
        author: exactKnownPodcast.author,
        description: exactKnownPodcast.description,
        imageUrl: exactKnownPodcast.imageUrl,
        feedUrl: exactKnownPodcast.feedUrl,
        categories: exactKnownPodcast.categories,
        kind: 'known',
        subscribed: subscribedFeedKeys.has(normalizeFeedKey(exactKnownPodcast.feedUrl)),
        subscribedPodcastId: subscribedByFeedKey.get(normalizeFeedKey(exactKnownPodcast.feedUrl))
      });
    }
    for (const podcast of remoteResults) {
      if (exactKnownPodcast && normalizeFeedKey(exactKnownPodcast.feedUrl) === normalizeFeedKey(podcast.feedUrl)) continue;
      merged.push({
        ...podcast,
        kind: 'remote',
        subscribed: subscribedFeedKeys.has(normalizeFeedKey(podcast.feedUrl)),
        subscribedPodcastId: subscribedByFeedKey.get(normalizeFeedKey(podcast.feedUrl))
      });
    }
    return merged;
  }, [exactKnownPodcast, remoteResults, subscribedFeedKeys, subscribedByFeedKey]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    const classified = classifyAddPodcastInput(q);
    if (!q) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus(offline ? 'You are offline. Add Podcast search is unavailable until you reconnect.' : '');
      return;
    }

    if (offline) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus('You are offline. Reconnect to search PodcastIndex, parse RSS feeds, or import YouTube sources.');
      return;
    }

    if (classified.kind === 'youtube-url') {
      setRemoteResults([]);
      if (!canUseYoutubeImport) {
        setRemoteLoading(false);
        setRemoteStatus('');
        return;
      }
      if (exactKnownPodcast) {
        setRemoteLoading(false);
        setRemoteStatus('This source is already in your library.');
        return;
      }
      setRemoteLoading(false);
      setRemoteStatus(`YouTube ${classified.youtubeKind || 'source'} ready to import.`);
      return;
    }

    if (classified.kind === 'rss-url') {
      setRemoteResults([]);
      if (exactKnownPodcast) {
        setRemoteLoading(false);
        setRemoteStatus('Feed found in local cache.');
        return;
      }
      setRemoteLoading(true);
      setRemoteStatus('Checking RSS feed...');
      const timer = window.setTimeout(() => {
        void (async () => {
          try {
            await onResolveFeedUrl(classified.value);
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

    const remoteQueryKey = normalizeSearch(classified.value);
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
          const discovered = await searchPodcastIndex(serverUrl, accessToken, classified.value);
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
  }, [accessToken, canSearchRemote, canUseYoutubeImport, exactKnownPodcast, offline, onResolveFeedUrl, query, serverUrl]);

  return (
    <Panel title="Search" className="h-full">
      <div className="border-b border-bone/15 p-4">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bone" size={18} aria-hidden />
          <Input
            className="h-14 w-full pl-10 text-lg"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={offline ? 'Offline' : canUseYoutubeImport ? 'Add by podcast name, RSS feed URL, or YouTube URL' : 'Add by podcast name or RSS feed URL'}
            aria-label="Add podcast search"
          />
        </div>
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        {offline ? (
          <article className="mb-4 flex items-start gap-3 rounded-eh border border-yellow/25 bg-yellow/10 p-3 text-yellow">
            <WifiOff size={18} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-black uppercase tracking-[0.08em]">Offline</h3>
              <p className="mt-1 text-sm leading-5 text-bone">Reconnect to add podcasts, parse RSS feeds, search PodcastIndex, or import YouTube sources.</p>
            </div>
          </article>
        ) : null}
        {remoteLoading || remoteStatus ? (
          <p className="mb-4 flex items-center gap-2 text-sm text-bone" role="status">
            {remoteLoading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {remoteLoading ? remoteStatus || 'Searching...' : remoteStatus}
          </p>
        ) : null}
        {!query.trim() && !offline ? <p className="text-sm text-bone">{canUseYoutubeImport ? 'Search PodcastIndex, paste an RSS feed, or paste a YouTube video, playlist, channel, or podcast URL.' : 'Search PodcastIndex or paste an RSS feed URL.'}</p> : null}
        {canUseYoutubeImport && input.kind === 'youtube-url' && query.trim() && !exactKnownPodcast ? (
          <article className="mb-4 rounded-eh border border-bone/15 bg-surface/80 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-eh border border-bone/15 bg-canvas text-yellow">
                <Youtube size={22} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-black text-cream">Import YouTube {input.youtubeKind || 'source'}</h3>
                <p className="mt-1 text-sm text-bone">This creates a podcast-style feed first. Audio imports only when you choose an episode.</p>
              </div>
              <Button
                variant="primary"
                onClick={() => void onImportYoutube(input.value)}
                disabled={!canUseYoutubeImport}
                aria-label="Import YouTube audio"
              >
                <Plus size={16} aria-hidden />
                Import
              </Button>
            </div>
          </article>
        ) : null}
        <div className="grid gap-3">
          {results.map((result) => (
            <PodcastSearchRow
              key={`${result.kind}:${result.id}`}
              result={result}
              onOpen={() => result.kind === 'known' ? onOpenPodcast(result.subscribedPodcastId || result.id) : result.subscribed ? onOpenPodcast(result.subscribedPodcastId || result.id) : onOpenRemotePodcast(result)}
              onSubscribe={() => result.kind === 'known' ? onSubscribe(result.id) : onSubscribeRemote(result)}
            />
          ))}
        </div>
        {query.trim() && !offline && !results.length && !remoteLoading ? <p className="mt-8 text-sm text-bone">No podcasts matched yet.</p> : null}
      </div>
    </Panel>
  );
}

function PodcastSearchRow({ result, onOpen, onSubscribe }: { result: SearchResult; onOpen: () => void; onSubscribe: () => void }) {
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
              {result.kind === 'known' ? <Badge tone="teal">Known</Badge> : <Badge tone="mauve">PodcastIndex</Badge>}
              {result.categories?.slice(0, 4).map((category) => <Badge key={category} tone="yellow">{category}</Badge>)}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-start">
          {result.subscribed ? (
            <Button variant="secondary" onClick={onOpen} aria-label={`Open subscribed podcast ${result.title}`}>
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

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeFeedKey(value: string): string {
  return value.trim().replace(/\/$/, '').toLowerCase();
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
  kind: 'known' | 'remote';
  subscribed: boolean;
  subscribedPodcastId?: string;
};
