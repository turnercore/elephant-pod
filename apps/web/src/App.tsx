import { useCallback, useEffect, useMemo, useState } from 'react';
import { Github } from 'lucide-react';
import type { AppSettings, BackupFile, Clip, EpisodeWithState, Podcast, SectionKey } from '@/types/domain';
import { AppShell } from '@/components/Layout/AppShell';
import { PlayerBar } from '@/components/Player/PlayerBar';
import { ClipComposer } from '@/components/Clips/ClipComposer';
import { Button } from '@/components/ui/Button';
import { InboxPage } from '@/pages/InboxPage';
import { QueuePage } from '@/pages/QueuePage';
import { LibraryPage } from '@/pages/LibraryPage';
import { SearchPage } from '@/pages/SearchPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { useAudioController } from '@/lib/audio/useAudioController';
import { nowIso } from '@/lib/dates';
import { fetchFeedThroughServer } from '@/lib/rss';
import { exportOpml, importOpml } from '@/lib/opml';
import { downloadEpisodeToCache } from '@/lib/storage/cache';
import { ensureSeedData } from '@/lib/storage/db';
import { clearServerSession, consumeAuthTokenFromCallback, isServerSessionExpired, loadServerSession, saveServerSession, startGithubSignIn, type ServerSession } from '@/lib/sync/serverAuth';
import {
  exportBackup,
  getSettings,
  importBackup,
  listEpisodes,
  listFeeds,
  markAllInFeedPlayed,
  moveInQueue,
  queueEpisode,
  removeFromQueue,
  saveClip,
  saveSettings,
  updateEpisodeState,
  upsertParsedFeed
} from '@/lib/storage/repository';
import { autoDeleteAfterListen, maybeAutoDownload, pruneDownloadsOverCap } from '@/lib/features/automation';
import { isTauriRuntime } from '@/lib/native/tauriBridge';

export default function App() {
  const [active, setActive] = useState<SectionKey>('inbox');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [feeds, setFeeds] = useState<Podcast[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeWithState[]>([]);
  const [feedUrl, setFeedUrl] = useState('');
  const [status, setStatus] = useState('');
  const [clipEpisode, setClipEpisode] = useState<EpisodeWithState | null>(null);
  const [serverSession, setServerSession] = useState<ServerSession | null>(null);

  const audio = useAudioController(settings || fallbackSettings);
  const runtimeServerUrl = settings?.serverUrl || getBrowserRuntimeServerUrl();

  const refreshLocalState = useCallback(async () => {
    await ensureSeedData();
    const [nextSettings, nextFeeds, nextEpisodes] = await Promise.all([getSettings(), listFeeds(), listEpisodes()]);
    setSettings(nextSettings);
    setFeeds(nextFeeds);
    setEpisodes(nextEpisodes);
  }, []);

  useEffect(() => {
    void refreshLocalState();
  }, [refreshLocalState]);

  useEffect(() => {
    if (!runtimeServerUrl) {
      if (serverSession) setServerSession(null);
      return;
    }
    const callbackSession = consumeAuthTokenFromCallback();
    if (callbackSession) {
      saveServerSession(runtimeServerUrl, callbackSession);
      setServerSession(callbackSession);
      return;
    }
    setServerSession(loadServerSession(runtimeServerUrl));
  }, [runtimeServerUrl]);

  useEffect(() => {
    if (!settings) return;
    const timer = window.setInterval(() => {
      void handleRefreshFeeds();
    }, Math.max(15, settings.refreshIntervalMinutes) * 60_000);
    return () => window.clearInterval(timer);
  }, [settings?.refreshIntervalMinutes, feeds.length]);

  useEffect(() => {
    if (!settings) return;
    void maybeAutoDownload(episodes, settings).then((count) => {
      if (count > 0) void refreshLocalState();
    });
  }, [episodes.length, settings?.autoDownload, settings?.downloadOnlyWifi]);

  useEffect(() => {
    if (!settings) return;
    void pruneDownloadsOverCap(settings).then(() => refreshLocalState());
  }, [settings?.storageCapMb]);

  const inboxEpisodes = useMemo(
    () => episodes.filter((episode) => episode.state.inboxState === 'new' && !episode.state.played).sort(sortNewest),
    [episodes]
  );

  const queueEpisodes = useMemo(
    () => episodes.filter((episode) => episode.state.queuePosition).sort((a, b) => (a.state.queuePosition || 0) - (b.state.queuePosition || 0)),
    [episodes]
  );

  async function persistSettings(next: AppSettings) {
    setSettings(next);
    await saveSettings(next);
  }

  async function handleAddFeedFromUrl(url: string) {
    if (!settings || !url.trim()) return;
    const isLocalInput = url.trim() === feedUrl.trim();
    try {
      setStatus('Fetching feed…');
      const parsed = await fetchFeedThroughServer(url.trim(), settings.serverUrl);
      await upsertParsedFeed(parsed);
      if (isLocalInput) setFeedUrl('');
      setStatus(`Added ${parsed.podcast.title}.`);
      await refreshLocalState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Feed import failed.');
    }
  }

  async function handleAddFeed() {
    await handleAddFeedFromUrl(feedUrl);
  }

  function handleSessionChange(nextSession: ServerSession | null) {
    if (!runtimeServerUrl) {
      setServerSession(null);
      return;
    }
    if (nextSession) {
      saveServerSession(runtimeServerUrl, nextSession);
    } else {
      clearServerSession(runtimeServerUrl);
    }
    setServerSession(nextSession);
  }

  async function handleRefreshFeeds() {
    if (!settings || feeds.length === 0) return;
    let refreshed = 0;
    for (const feed of feeds) {
      try {
        const parsed = await fetchFeedThroughServer(feed.feedUrl, settings.serverUrl);
        await upsertParsedFeed(parsed);
        refreshed += 1;
      } catch {
        // Keep refresh resilient. A single broken feed should not block the app.
      }
    }
    setStatus(refreshed ? `Refreshed ${refreshed} feed${refreshed === 1 ? '' : 's'}.` : 'No feeds refreshed.');
    await refreshLocalState();
  }

  async function handleBrowserSignIn() {
    if (!runtimeServerUrl) {
      setStatus('Add a server URL in Playback + Automation settings first.');
      return;
    }
    try {
      setStatus('Opening GitHub sign-in...');
      await startGithubSignIn(runtimeServerUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not start GitHub sign-in.');
    }
  }

  const browserNeedsSignIn = Boolean(settings) && !isTauriRuntime() && (!serverSession || isServerSessionExpired(serverSession));

  async function handlePlay(episode: EpisodeWithState) {
    await audio.playEpisode(episode);
    if (episode.state.inboxState === 'new') await updateEpisodeState(episode.id, { inboxState: 'archived' });
    await refreshLocalState();
  }

  async function handleTogglePlayed(episode: EpisodeWithState) {
    const played = !episode.state.played;
    await updateEpisodeState(episode.id, {
      played,
      playedAt: played ? nowIso() : undefined,
      progressSec: played ? episode.durationSec || episode.state.progressSec : episode.state.progressSec,
      inboxState: played ? 'archived' : episode.state.inboxState,
      queuePosition: played ? undefined : episode.state.queuePosition
    });
    if (played && settings) await autoDeleteAfterListen(episode, settings);
    await refreshLocalState();
  }

  async function handleQueue(episode: EpisodeWithState) {
    if (episode.state.queuePosition) await removeFromQueue(episode.id);
    else await queueEpisode(episode.id);
    await refreshLocalState();
  }

  async function handleDismiss(episode: EpisodeWithState) {
    await updateEpisodeState(episode.id, { inboxState: 'dismissed' });
    await refreshLocalState();
  }

  async function handleDownload(episode: EpisodeWithState) {
    try {
      const result = await downloadEpisodeToCache(episode);
      await updateEpisodeState(episode.id, {
        downloaded: true,
        downloadedAt: nowIso(),
        downloadPath: result.path,
        downloadBytes: result.bytes,
        downloadBackend: result.backend
      });
      setStatus(`Downloaded ${episode.title} ${result.backend === 'tauri-filesystem' ? 'to native storage' : 'to browser cache'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Download failed. Host may block browser downloads, or native storage may be unavailable.');
    }
    await refreshLocalState();
  }

  async function handleMoveQueue(episode: EpisodeWithState, direction: -1 | 1) {
    await moveInQueue(episode.id, direction);
    await refreshLocalState();
  }

  async function handleRemoveQueue(episode: EpisodeWithState) {
    await removeFromQueue(episode.id);
    await refreshLocalState();
  }

  async function handleMarkFeedPlayed(podcastId: string) {
    await markAllInFeedPlayed(podcastId);
    await refreshLocalState();
  }

  async function handleEnded() {
    if (!audio.current || !settings) return;
    await updateEpisodeState(audio.current.id, {
      played: true,
      playedAt: nowIso(),
      progressSec: audio.current.durationSec || audio.currentTime,
      inboxState: 'archived',
      queuePosition: undefined
    });
    await autoDeleteAfterListen(audio.current, settings);
    await refreshLocalState();
    if (settings.autoPlayNext) {
      const next = queueEpisodes.find((episode) => episode.id !== audio.current?.id);
      if (next) await audio.playEpisode(next);
    }
  }

  async function handleTimeUpdate() {
    if (!audio.current) return;
    const rounded = Math.floor(audio.currentTime);
    if (rounded > 0 && rounded % 15 === 0) {
      await updateEpisodeState(audio.current.id, { progressSec: rounded });
    }
  }

  async function handleSaveClip(clip: Clip): Promise<Clip> {
    let saved = clip;
    const serverUrl = settings?.serverUrl?.replace(/\/$/, '');
    if (serverUrl) {
      try {
        const response = await fetch(`${serverUrl}/api/clips`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clip)
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            id: string;
            publicUrl: string;
            renderedAudioUrl?: string;
            renderedVideoUrl?: string;
            renderStatus?: Clip['renderStatus'];
            renderError?: string;
            fileSizeBytes?: number;
          };
          saved = {
            ...clip,
            serverClipId: payload.id,
            publicUrl: payload.publicUrl,
            renderedAudioUrl: payload.renderedAudioUrl,
            renderedVideoUrl: payload.renderedVideoUrl,
            renderStatus: payload.renderStatus || 'pending',
            renderError: payload.renderError,
            fileSizeBytes: payload.fileSizeBytes,
            updatedAt: nowIso()
          };
        }
      } catch {
        // Keep local clip even if server publication fails.
      }
    }
    await saveClip(saved);
    await refreshLocalState();
    return saved;
  }

  async function handleExportJson() {
    const backup = await exportBackup();
    downloadFile(`elephant-ears-backup-${Date.now()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  }

  async function handleImportJson(file: File) {
    const parsed = JSON.parse(await file.text()) as BackupFile;
    await importBackup(parsed);
    await refreshLocalState();
  }

  function handleExportOpml() {
    downloadFile(`elephant-ears-subscriptions-${Date.now()}.opml`, exportOpml(feeds), 'text/xml');
  }

  async function handleImportOpml(file: File) {
    if (!settings) return;
    const urls = importOpml(await file.text());
    for (const url of urls) {
      try {
        const parsed = await fetchFeedThroughServer(url, settings.serverUrl);
        await upsertParsedFeed(parsed);
      } catch {
        // Continue importing the rest.
      }
    }
    await refreshLocalState();
  }

  const handlers = {
    onPlay: handlePlay,
    onQueue: handleQueue,
    onDismiss: handleDismiss,
    onDownload: handleDownload,
    onTogglePlayed: handleTogglePlayed,
    onClip: setClipEpisode
  };

  const page = (() => {
    if (!settings) return <div className="eh-card grid h-full place-items-center p-8">Loading local library…</div>;

    if (browserNeedsSignIn) {
      return (
        <div className="eh-card grid h-full place-items-center p-8">
          <div className="max-w-lg text-center">
            <div className="mb-2 text-sm font-bold uppercase tracking-[0.08em] text-yellow">Server Login Required</div>
            <h2 className="eh-title text-xl">Sign in with GitHub to continue</h2>
            <p className="mt-2 text-sm leading-6 text-bone">
              This web/runtime build requires a signed-in server session before playback and library actions are available.
            </p>
            <Button onClick={() => void handleBrowserSignIn()} className="mt-5" aria-label="Start GitHub sign-in">
              <Github size={16} aria-hidden />
              Sign in with GitHub
            </Button>
            {status && <p className="mt-4 text-sm text-yellow" role="status">{status}</p>}
          </div>
        </div>
      );
    }

    switch (active) {
      case 'inbox':
        return <InboxPage episodes={inboxEpisodes} feedUrl={feedUrl} setFeedUrl={setFeedUrl} onAddFeed={handleAddFeed} onRefreshFeeds={handleRefreshFeeds} handlers={handlers} />;
      case 'queue':
        return <QueuePage episodes={queueEpisodes} onPlay={handlePlay} onMove={handleMoveQueue} onRemove={handleRemoveQueue} />;
      case 'library':
        return <LibraryPage feeds={feeds} episodes={episodes} handlers={handlers} onMarkFeedPlayed={handleMarkFeedPlayed} />;
      case 'search':
        return (
          <SearchPage
            episodes={episodes}
            handlers={handlers}
            canSearchRemote={Boolean(runtimeServerUrl && serverSession && !isServerSessionExpired(serverSession))}
            accessToken={serverSession && !isServerSessionExpired(serverSession) ? serverSession.accessToken : null}
            onAddPodcast={handleAddFeedFromUrl}
            serverUrl={runtimeServerUrl}
          />
        );
      case 'downloads':
        return <DownloadsPage episodes={episodes} handlers={handlers} />;
      case 'settings':
        return (
          <SettingsPage
            settings={settings}
            feeds={feeds}
            onSettingsChange={persistSettings}
            onExportJson={handleExportJson}
            onImportJson={handleImportJson}
            onExportOpml={handleExportOpml}
            onImportOpml={handleImportOpml}
            onRefresh={refreshLocalState}
            serverSession={serverSession}
            onSessionChange={handleSessionChange}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <>
      <AppShell
        active={active}
        onSelect={setActive}
        player={
          settings && (
            <PlayerBar
              current={audio.current}
              isPlaying={audio.isPlaying}
              currentTime={audio.currentTime}
              duration={audio.duration}
              settings={settings}
              onToggle={() => void audio.toggle()}
              onSeek={audio.seek}
              onSkipBy={audio.skipBy}
              onSettingsChange={(next) => void persistSettings(next)}
              onStopForSleep={audio.stop}
              onPlayNext={() => {
                const next = queueEpisodes.find((episode) => episode.id !== audio.current?.id);
                if (next) void handlePlay(next);
              }}
            />
          )
        }
      >
        {status && <div className="mb-3 rounded-eh border border-yellow/25 bg-yellow/10 px-3 py-2 text-sm text-yellow" role="status">{status}</div>}
        {page}
      </AppShell>
      <audio ref={audio.audioRef} preload="metadata" onEnded={() => void handleEnded()} onTimeUpdate={() => void handleTimeUpdate()}>
        <track kind="captions" />
      </audio>
      {clipEpisode && (
        <ClipComposer
          episode={clipEpisode}
          currentTime={audio.current?.id === clipEpisode.id ? audio.currentTime : clipEpisode.state.progressSec}
          serverUrl={settings?.serverUrl}
          onClose={() => setClipEpisode(null)}
          onSave={handleSaveClip}
        />
      )}
    </>
  );
}

const fallbackSettings: AppSettings = {
  id: 'local',
  skipForwardSec: 30,
  skipBackSec: 15,
  resumeRewindSec: 8,
  playbackRate: 1,
  autoPlayNext: true,
  autoDownload: false,
  autoDeleteAfterListen: false,
  downloadOnlyWifi: true,
  storageCapMb: 2048,
  refreshIntervalMinutes: 720,
  nativeAudioPreferred: true,
  silenceShortening: false,
  silenceShorteningMode: 'web-audio',
  silenceThreshold: 0.018,
  silenceThresholdDb: -42,
  silenceMinMs: 350,
  silenceMinimumDurationSec: 0.35,
  silenceBoostRate: 2.15,
  syncEnabled: false,
  theme: 'dark'
};

function sortNewest(a: EpisodeWithState, b: EpisodeWithState) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function getBrowserRuntimeServerUrl() {
  if (isTauriRuntime()) return '';
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== 'undefined' && window.location.port !== '5173') return window.location.origin;
  return 'http://localhost:8787';
}

function downloadFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
