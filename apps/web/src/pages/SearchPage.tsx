import { Search, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { EpisodeWithState } from '@/types/domain';
import { EpisodeList } from '@/components/Episodes/EpisodeList';
import { Panel } from '@/components/ui/Panel';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { searchPodcastIndex } from '@/lib/podcastDiscovery';
import type { PodcastDiscoveryResult } from '@/lib/podcastDiscovery';

export function SearchPage({
  episodes,
  handlers,
  canSearchRemote,
  accessToken,
  onAddPodcast,
  serverUrl
}: {
  episodes: EpisodeWithState[];
  handlers: Omit<React.ComponentProps<typeof EpisodeList>, 'episodes'>;
  canSearchRemote: boolean;
  accessToken: string | null;
  onAddPodcast: (feedUrl: string) => Promise<void>;
  serverUrl?: string;
}) {
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<PodcastDiscoveryResult[]>([]);
  const [remoteStatus, setRemoteStatus] = useState('Configure server + sign-in to search PodcastIndex.');
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [addingFeedId, setAddingFeedId] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return episodes.filter((episode) => `${episode.title} ${episode.podcastTitle} ${episode.description || ''}`.toLowerCase().includes(q));
  }, [episodes, query]);

  useEffect(() => {
    let cancelled = false;
    if (!canSearchRemote) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus('Configure server + sign-in to search PodcastIndex.');
      return;
    }
    const q = query.trim();
    if (!q) {
      setRemoteResults([]);
      setRemoteLoading(false);
      setRemoteStatus('Type a search term to discover podcasts.');
      return;
    }

    setRemoteLoading(true);
    setRemoteStatus('Searching PodcastIndex...');

    (async () => {
      try {
        if (!serverUrl || !accessToken) throw new Error('Server URL and session are required.');
        const discovered = await searchPodcastIndex(serverUrl, accessToken, q);
        if (cancelled) return;
        setRemoteResults(discovered);
        setRemoteStatus(discovered.length ? '' : 'No podcast matches. Try broader terms.');
      } catch (error) {
        if (cancelled) return;
        setRemoteStatus(error instanceof Error ? error.message : 'Podcast search failed.');
        setRemoteResults([]);
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canSearchRemote, query, serverUrl, accessToken]);

  async function handleAdd(feed: PodcastDiscoveryResult) {
    if (addingFeedId) return;
    setAddingFeedId(feed.id);
    setRemoteStatus(`Importing ${feed.title}...`);
    try {
      await onAddPodcast(feed.feedUrl);
      setRemoteStatus(`Added ${feed.title}.`);
    } catch (error) {
      setRemoteStatus(error instanceof Error ? error.message : 'Feed add failed.');
    } finally {
      setAddingFeedId(null);
    }
  }

  return (
    <Panel title="Search" kicker="Find the moment before it disappears" className="h-full">
      <div className="border-b border-bone/15 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bone" size={18} aria-hidden />
          <Input className="pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, shows, notes" aria-label="Search episodes" />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4">
        <section className="grid gap-2">
          <h2 className="eh-title text-sm">Local Episodes</h2>
          <EpisodeList episodes={results} {...handlers} />
        </section>
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 className="eh-title text-sm">PodcastIndex</h2>
            {remoteLoading ? <span className="text-xs text-bone">Searching…</span> : null}
          </div>
          <p className="text-sm text-bone" role="status">{remoteStatus}</p>
          {remoteResults.map((podcast) => (
            <article key={podcast.id} className="rounded-eh border border-bone/15 bg-canvas/30 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                {podcast.imageUrl ? <img src={podcast.imageUrl} alt={`${podcast.title} artwork`} className="h-12 w-12 rounded-eh border border-bone/20 object-cover" /> : null}
                <div className="min-w-0">
                  <h3 className="font-bold tracking-wide text-cream">{podcast.title}</h3>
                  {podcast.author ? <p className="text-sm text-bone">{podcast.author}</p> : null}
                </div>
                <Button
                  onClick={() => void handleAdd(podcast)}
                  disabled={addingFeedId === podcast.id || !canSearchRemote}
                  aria-label={`Add ${podcast.title} feed`}
                  className="shrink-0"
                >
                  <Plus size={16} aria-hidden /> Add
                </Button>
              </div>
              {podcast.description ? <p className="text-sm text-bone">{podcast.description}</p> : null}
              <p className="truncate pt-2 text-xs text-yellow" title={podcast.feedUrl}>
                {podcast.feedUrl}
              </p>
            </article>
          ))}
          {!remoteResults.length && !remoteLoading && canSearchRemote ? <p className="text-sm text-bone">No matches yet.</p> : null}
        </section>
      </div>
    </Panel>
  );
}
