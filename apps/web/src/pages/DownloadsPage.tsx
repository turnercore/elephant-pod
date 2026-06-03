import { LuDownload as Download, LuHardDrive as HardDrive, LuTrash2 as Trash2 } from 'react-icons/lu';
import { useEffect, useMemo, useState } from 'react';
import type { EpisodeWithState } from '@/types/domain';
import { EpisodeList } from '@/components/Episodes/EpisodeList';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { estimateStorageMb } from '@/lib/storage/cache';

export function DownloadsPage({
  episodes,
  getPodcastImageUrl,
  handlers
}: {
  episodes: EpisodeWithState[];
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
  handlers: Omit<React.ComponentProps<typeof EpisodeList>, 'episodes' | 'getPodcastImageUrl'>;
}) {
  const [usage, setUsage] = useState(0);
  const downloaded = episodes.filter((episode) => episode.state.downloaded);
  const nativeCount = useMemo(() => downloaded.filter((episode) => episode.state.downloadBackend === 'tauri-filesystem').length, [downloaded]);

  useEffect(() => {
    void estimateStorageMb().then(setUsage);
  }, [downloaded.length]);

  return (
    <Panel
      title="Downloads"
      action={<Badge tone="teal"><HardDrive size={13} aria-hidden /> {usage} MB</Badge>}
      className="h-full"
    >
      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-0 pb-6 pt-3 md:px-5 md:pt-4">
        <div className="grid gap-3 border-b border-bone/15 pb-4 md:grid-cols-3">
          <Stat icon={<Download size={18} aria-hidden />} label="Downloaded" value={String(downloaded.length)} />
          <Stat icon={<HardDrive size={18} aria-hidden />} label="Native files" value={String(nativeCount)} />
          <Stat icon={<Trash2 size={18} aria-hidden />} label="Storage estimate" value={`${usage} MB`} />
        </div>
        <div className="pt-4">
          <EpisodeList episodes={downloaded} getPodcastImageUrl={getPodcastImageUrl} {...handlers} />
        </div>
      </div>
    </Panel>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-eh border border-bone/15 bg-canvas/30 p-3">
      <div className="mb-2 text-yellow">{icon}</div>
      <div className="text-xs uppercase tracking-[0.06em] text-bone">{label}</div>
      <div className="text-lg font-black text-cream">{value}</div>
    </div>
  );
}
