import { RefreshCw, Rss } from 'lucide-react';
import type { EpisodeWithState } from '@/types/domain';
import { EpisodeList } from '@/components/Episodes/EpisodeList';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface InboxPageProps {
  episodes: EpisodeWithState[];
  feedUrl: string;
  setFeedUrl: (url: string) => void;
  onAddFeed: () => void;
  onRefreshFeeds: () => void;
  handlers: Omit<React.ComponentProps<typeof EpisodeList>, 'episodes'>;
}

export function InboxPage({ episodes, feedUrl, setFeedUrl, onAddFeed, onRefreshFeeds, handlers }: InboxPageProps) {
  return (
    <Panel
      title="Inbox"
      kicker="Triage first. Queue second."
      action={
        <Button onClick={onRefreshFeeds} size="sm">
          <RefreshCw size={15} aria-hidden /> Refresh
        </Button>
      }
      className="h-full"
    >
      <div className="border-b border-bone/15 p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <Input value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="Paste RSS feed URL" aria-label="RSS feed URL" />
          <Button variant="primary" onClick={onAddFeed}>
            <Rss size={16} aria-hidden /> Add feed
          </Button>
        </div>
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        <EpisodeList episodes={episodes} {...handlers} />
      </div>
    </Panel>
  );
}
