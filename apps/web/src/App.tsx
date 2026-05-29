import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Github } from 'lucide-react';
import type { AppSettings, BackupFile, CachedPodcast, Clip, EpisodeWithState, ListeningStats, Podcast, PodcastPreference, SectionKey } from '@/types/domain';
import { AppShell } from '@/components/Layout/AppShell';
import { PlayerBar } from '@/components/Player/PlayerBar';
import { ClipComposer } from '@/components/Clips/ClipComposer';
import { Button } from '@/components/ui/Button';
import { InboxPage } from '@/pages/InboxPage';
import { QueuePage } from '@/pages/QueuePage';
import { LibraryPage } from '@/pages/LibraryPage';
import { SearchPage } from '@/pages/SearchPage';
import { PodcastDetailPage } from '@/pages/PodcastDetailPage';
import { EpisodeDetailPage } from '@/pages/EpisodeDetailPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { useAudioController } from '@/lib/audio/useAudioController';
import { nowIso } from '@/lib/dates';
import { fetchFeedThroughServer } from '@/lib/rss';
import { exportOpml, importOpml } from '@/lib/opml';
import { downloadEpisodeToCache } from '@/lib/storage/cache';
import { ensureSeedData } from '@/lib/storage/db';
import { clearServerSession, consumeAuthTokenFromCallback, fetchServerSessionProfile, isServerSessionExpired, loadServerSession, saveServerSession, startGithubSignIn, type ServerSession } from '@/lib/sync/serverAuth';
import {
  exportBackup,
  addEpisodeToQueueEnd,
  addEpisodeToQueueNext,
  cacheParsedPodcast,
  getSettings,
  addListeningSample,
  getListeningStats,
  getPodcastPreference,
  importBackup,
  listCachedEpisodes,
  listCachedPodcasts,
  listEpisodes,
  listFeeds,
  listPodcastPreferences,
  markAllInFeedPlayed,
  markAllInFeedUnplayed,
  moveInQueue,
  normalizeInboxPositions,
  playEpisodeAtQueueTop,
  removeFromQueue,
  reorderQueue,
  saveClip,
  saveSettings,
  savePodcastPreference,
  sendAllUnplayedToInbox,
  sendEpisodeToInbox,
  subscribeCachedPodcast,
  unsubscribePodcast,
  updateEpisodeState,
  upsertParsedFeed
} from '@/lib/storage/repository';
import { deleteInactiveDownloadIfNeeded, deleteInactiveDownloadsIfNeeded, maybeAutoDownload, pruneDownloadsOverCap } from '@/lib/features/automation';
import { isTauriRuntime } from '@/lib/native/tauriBridge';

type ViewSnapshot = {
  active: SectionKey;
  selectedPodcastId: string | null;
  selectedEpisodeId: string | null;
};

export default function App() {
  const [active, setActive] = useState<SectionKey>('inbox');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [feeds, setFeeds] = useState<Podcast[]>([]);
  const [cachedPodcasts, setCachedPodcasts] = useState<CachedPodcast[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeWithState[]>([]);
  const [cachedEpisodes, setCachedEpisodes] = useState<EpisodeWithState[]>([]);
  const [podcastPreferences, setPodcastPreferences] = useState<PodcastPreference[]>([]);
  const [listeningStats, setListeningStats] = useState<ListeningStats | null>(null);
  const [selectedPodcastId, setSelectedPodcastId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [navStack, setNavStack] = useState<ViewSnapshot[]>([]);
  const [episodeSilenceOverrides, setEpisodeSilenceOverrides] = useState<Record<string, boolean>>({});
  const [playerCollapseToken, setPlayerCollapseToken] = useState(0);
  const [status, setStatus] = useState('');
  const [clipEpisode, setClipEpisode] = useState<EpisodeWithState | null>(null);
  const [serverSession, setServerSession] = useState<ServerSession | null>(null);
  const telemetryRef = useRef<{ episodeId: string; mediaAt: number; wallAt: number } | null>(null);
  const profileHydrationRef = useRef<string | null>(null);

  const audio = useAudioController(settings || fallbackSettings, podcastPreferences, episodeSilenceOverrides);
  const runtimeServerUrl = settings?.serverUrl || getBrowserRuntimeServerUrl();

  function navigateTo(snapshot: ViewSnapshot) {
    setPlayerCollapseToken((token) => token + 1);
    setNavStack((stack) => [...stack, { active, selectedPodcastId, selectedEpisodeId }].slice(-40));
    setActive(snapshot.active);
    setSelectedPodcastId(snapshot.selectedPodcastId);
    setSelectedEpisodeId(snapshot.selectedEpisodeId);
  }

  function navigateSection(section: SectionKey) {
    navigateTo({ active: section, selectedPodcastId: null, selectedEpisodeId: null });
  }

  function navigatePodcast(podcastId: string) {
    navigateTo({ active, selectedPodcastId: podcastId, selectedEpisodeId: null });
  }

  function navigateEpisode(episodeId: string) {
    navigateTo({ active, selectedPodcastId, selectedEpisodeId: episodeId });
  }

  function navigateBack() {
    setPlayerCollapseToken((token) => token + 1);
    setNavStack((stack) => {
      const previous = stack[stack.length - 1];
      if (!previous) {
        setSelectedEpisodeId(null);
        setSelectedPodcastId(null);
        return stack;
      }
      setActive(previous.active);
      setSelectedPodcastId(previous.selectedPodcastId);
      setSelectedEpisodeId(previous.selectedEpisodeId);
      return stack.slice(0, -1);
    });
  }

  const refreshLocalState = useCallback(async () => {
    await ensureSeedData();
    const [nextSettings, nextFeeds, nextEpisodes, nextCachedPodcasts, nextCachedEpisodes, nextPodcastPreferences, nextListeningStats] = await Promise.all([
      getSettings(),
      listFeeds(),
      listEpisodes(),
      listCachedPodcasts(),
      listCachedEpisodes(),
      listPodcastPreferences(),
      getListeningStats()
    ]);
    setSettings(nextSettings);
    setFeeds(nextFeeds);
    setEpisodes(nextEpisodes);
    setCachedPodcasts(nextCachedPodcasts);
    setCachedEpisodes(nextCachedEpisodes);
    setPodcastPreferences(nextPodcastPreferences);
    setListeningStats(nextListeningStats);
  }, []);

  useEffect(() => {
    void refreshLocalState();
  }, [refreshLocalState]);

  useEffect(() => {
    if (!runtimeServerUrl) {
      if (serverSession) setServerSession(null);
      profileHydrationRef.current = null;
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
    if (!runtimeServerUrl || !serverSession || isServerSessionExpired(serverSession)) {
      profileHydrationRef.current = null;
      return;
    }
    if (serverSession.username || profileHydrationRef.current === serverSession.accessToken) return;
    profileHydrationRef.current = serverSession.accessToken;
    void fetchServerSessionProfile(runtimeServerUrl, serverSession.accessToken).then((profile) => {
      if (!profile) return;
      const nextSession = { ...serverSession, ...profile, updatedAt: new Date().toISOString() };
      saveServerSession(runtimeServerUrl, nextSession);
      setServerSession(nextSession);
    });
  }, [runtimeServerUrl, serverSession]);

  useEffect(() => {
    if (!settings || !serverSession || isServerSessionExpired(serverSession)) {
      return;
    }
  }, [settings, serverSession]);

  useEffect(() => {
    if (!settings) return;
    const timer = window.setInterval(() => {
      void handleRefreshFeeds();
    }, Math.max(15, settings.refreshIntervalMinutes) * 60_000);
    return () => window.clearInterval(timer);
  }, [settings?.refreshIntervalMinutes, feeds.length]);

  useEffect(() => {
    if (!status || status.endsWith('...') || status.endsWith('…')) return;
    const timer = window.setTimeout(() => setStatus(''), 3200);
    return () => window.clearTimeout(timer);
  }, [status]);

  const knownEpisodes = useMemo(() => allKnownEpisodes(cachedEpisodes, episodes), [cachedEpisodes, episodes]);
  const podcastImageById = useMemo(() => {
    const next = new Map<string, string>();
    for (const podcast of [...feeds, ...cachedPodcasts]) {
      if (podcast.imageUrl) next.set(podcast.id, podcast.imageUrl);
    }
    return next;
  }, [cachedPodcasts, feeds]);
  const getPodcastImageUrl = useCallback((podcastId: string) => podcastImageById.get(podcastId), [podcastImageById]);
  const withPlaybackArtwork = useCallback(
    (episode: EpisodeWithState): EpisodeWithState => episode.imageUrl ? episode : { ...episode, imageUrl: getPodcastImageUrl(episode.podcastId) },
    [getPodcastImageUrl]
  );

  useEffect(() => {
    if (!settings) return;
    void maybeAutoDownload(knownEpisodes, settings).then((count) => {
      if (count > 0) void refreshLocalState();
    });
  }, [knownEpisodes, settings?.autoDownload, settings?.autoDownloadInbox, settings?.downloadOnlyWifi]);

  useEffect(() => {
    if (!settings) return;
    void pruneDownloadsOverCap(settings, knownEpisodes).then((count) => {
      if (count > 0) void refreshLocalState();
    });
  }, [knownEpisodes, settings?.storageCapMb]);

  useEffect(() => {
    if (!settings) return;
    void deleteInactiveDownloadsIfNeeded(settings, knownEpisodes).then((count) => {
      if (count > 0) void refreshLocalState();
    });
  }, [knownEpisodes, settings?.autoDeleteAfterListen]);

  useEffect(() => {
    telemetryRef.current = audio.current
      ? { episodeId: audio.current.id, mediaAt: audio.currentTime, wallAt: performance.now() }
      : null;
  }, [audio.current?.id, audio.isPlaying]);

  const inboxEpisodes = useMemo(
    () => knownEpisodes
      .filter((episode) => episode.state.inboxState === 'new' && !episode.state.played && !episode.state.queuePosition)
      .sort((a, b) => {
        if (settings?.inboxSortDirection === 'oldest') return sortOldest(a, b) || (a.state.inboxPosition || 0) - (b.state.inboxPosition || 0);
        return sortNewest(a, b) || (a.state.inboxPosition || 0) - (b.state.inboxPosition || 0);
      }),
    [knownEpisodes, settings?.inboxSortDirection]
  );

  const queueEpisodes = useMemo(
    () => knownEpisodes.filter((episode) => episode.state.queuePosition).sort((a, b) => (a.state.queuePosition || 0) - (b.state.queuePosition || 0)),
    [knownEpisodes]
  );

  const selectedPodcast = useMemo(() => selectedPodcastId ? cachedPodcasts.find((podcast) => podcast.id === selectedPodcastId) : null, [cachedPodcasts, selectedPodcastId]);
  const selectedPodcastEpisodes = useMemo(() => selectedPodcastId ? knownEpisodes.filter((episode) => episode.podcastId === selectedPodcastId) : [], [knownEpisodes, selectedPodcastId]);
  const selectedPodcastPreference = useMemo(() => selectedPodcastId ? podcastPreferences.find((preference) => preference.podcastId === selectedPodcastId) || defaultPodcastPreference(selectedPodcastId) : null, [podcastPreferences, selectedPodcastId]);
  const selectedEpisode = useMemo(() => selectedEpisodeId ? knownEpisodes.find((episode) => episode.id === selectedEpisodeId) || null : null, [knownEpisodes, selectedEpisodeId]);
  const selectedEpisodePodcast = useMemo(
    () => selectedEpisode ? cachedPodcasts.find((podcast) => podcast.id === selectedEpisode.podcastId) || feeds.find((podcast) => podcast.id === selectedEpisode.podcastId) : null,
    [cachedPodcasts, feeds, selectedEpisode]
  );
  const effectivePlayerSettings = useMemo(() => {
    const preference = audio.current ? podcastPreferences.find((item) => item.podcastId === audio.current?.podcastId) : undefined;
    return {
      ...(settings || fallbackSettings),
      playbackRate: preference?.playbackRate ?? (settings || fallbackSettings).playbackRate,
      skipForwardSec: preference?.skipForwardSec ?? (settings || fallbackSettings).skipForwardSec,
      skipBackSec: preference?.skipBackSec ?? (settings || fallbackSettings).skipBackSec,
      silenceShortening: preference?.silenceShortening ?? (settings || fallbackSettings).silenceShortening
    };
  }, [audio.current, podcastPreferences, settings]);

  async function persistSettings(next: AppSettings) {
    setSettings(next);
    await saveSettings(next);
  }

  const handleCacheFeedUrl = useCallback(async (url: string) => {
    if (!settings) throw new Error('Local settings are still loading.');
    if (!url.trim()) throw new Error('Enter an RSS feed URL.');
    try {
      setStatus('Fetching feed…');
      const parsed = await fetchFeedThroughServer(url.trim(), settings.serverUrl);
      await cacheParsedPodcast(parsed);
      setStatus(`Cached ${parsed.podcast.title}.`);
      await refreshLocalState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Feed import failed.');
      throw error;
    }
  }, [refreshLocalState, settings]);

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

  function handleBrowserSignOut() {
    if (!runtimeServerUrl) return;
    clearServerSession(runtimeServerUrl);
    setServerSession(null);
    setStatus('Signed out. Local data remains on this device.');
  }

  const browserNeedsSignIn = Boolean(settings) && !isTauriRuntime() && (!serverSession || isServerSessionExpired(serverSession));

  async function handlePlay(episode: EpisodeWithState) {
    if (audio.current?.id === episode.id) {
      const willResume = !audio.isPlaying;
      await audio.toggle();
      if (willResume) await updateEpisodeState(episode.id, { lastPlayedAt: nowIso() });
      await refreshLocalState();
      return;
    }
    await handleDisplaceCurrentIfNeeded(episode);
    await playEpisodeAtQueueTop(episode.id);
    await audio.playEpisode(withPlaybackArtwork(episode));
    await refreshLocalState();
  }

  async function handleDisplaceCurrentIfNeeded(nextEpisode: EpisodeWithState) {
    if (!audio.current || audio.current.id === nextEpisode.id) return;
    const currentDuration = audio.duration || audio.current.durationSec || 0;
    const completion = currentDuration > 0 ? audio.currentTime / currentDuration : 0;
    if (completion >= 0.9) {
      await updateEpisodeState(audio.current.id, {
        played: true,
        playedAt: nowIso(),
        lastPlayedAt: nowIso(),
        progressSec: currentDuration || audio.currentTime,
        inboxState: 'archived',
        inboxPosition: undefined,
        queuePosition: undefined,
        queuedAt: undefined
      });
      if (settings) await deleteInactiveDownloadIfNeeded(audio.current.id, settings);
      return;
    }
    await updateEpisodeState(audio.current.id, { progressSec: Math.floor(audio.currentTime) });
    await addEpisodeToQueueNext(audio.current.id);
  }

  async function handleTogglePlayed(episode: EpisodeWithState) {
    const played = !episode.state.played;
    await updateEpisodeState(episode.id, {
      played,
      playedAt: played ? nowIso() : undefined,
      lastPlayedAt: played ? nowIso() : undefined,
      progressSec: played ? episode.durationSec || episode.state.progressSec : episode.state.progressSec,
      inboxState: played ? 'archived' : episode.state.inboxState,
      inboxPosition: played ? undefined : episode.state.inboxPosition,
      queuePosition: played ? undefined : episode.state.queuePosition
    });
    if (played && settings) await deleteInactiveDownloadIfNeeded(episode.id, settings);
    await refreshLocalState();
  }

  async function handleQueue(episode: EpisodeWithState) {
    if (episode.state.queuePosition) {
      await removeFromQueue(episode.id);
      if (settings) await deleteInactiveDownloadIfNeeded(episode.id, settings);
    } else await addEpisodeToQueueEnd(episode.id);
    await refreshLocalState();
  }

  async function handleQueueEnd(episode: EpisodeWithState) {
    await addEpisodeToQueueEnd(episode.id);
    await refreshLocalState();
  }

  async function handlePlayNext(episode: EpisodeWithState) {
    await addEpisodeToQueueNext(episode.id);
    await refreshLocalState();
  }

  async function handleSendInbox(episode: EpisodeWithState) {
    await sendEpisodeToInbox(episode.id);
    await refreshLocalState();
  }

  async function handleDismiss(episode: EpisodeWithState) {
    await updateEpisodeState(episode.id, { inboxState: 'dismissed', inboxPosition: undefined });
    if (settings) await deleteInactiveDownloadIfNeeded(episode.id, settings);
    await normalizeInboxPositions();
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
        downloadBackend: result.backend,
        downloadSource: 'manual'
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
    if (settings) await deleteInactiveDownloadIfNeeded(episode.id, settings);
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
      lastPlayedAt: nowIso(),
      progressSec: audio.current.durationSec || audio.currentTime,
      inboxState: 'archived',
      inboxPosition: undefined,
      queuePosition: undefined
    });
    await deleteInactiveDownloadIfNeeded(audio.current.id, settings);
    await refreshLocalState();
    if (settings.autoPlayNext) {
      const next = queueEpisodes.find((episode) => episode.id !== audio.current?.id);
      if (next) {
        await playEpisodeAtQueueTop(next.id);
        await audio.playEpisode(withPlaybackArtwork(next));
        await refreshLocalState();
      }
      else {
        const inboxNext = inboxEpisodes[0];
        if (inboxNext) {
          await playEpisodeAtQueueTop(inboxNext.id);
          await audio.playEpisode(withPlaybackArtwork(inboxNext));
          await refreshLocalState();
        }
      }
    }
  }

  async function handleTimeUpdate() {
    if (!audio.current) return;
    const now = performance.now();
    const previous = telemetryRef.current;
    if (audio.isPlaying && previous?.episodeId === audio.current.id) {
      const mediaDelta = audio.currentTime - previous.mediaAt;
      const wallDelta = (now - previous.wallAt) / 1000;
      if (mediaDelta >= 5 && mediaDelta < 120 && wallDelta >= 2 && wallDelta < 120) {
        const rate = Math.max(1, effectivePlayerSettings.playbackRate || 1);
        const speedSavedSec = Math.max(0, wallDelta * (rate - 1));
        const silenceSavedSec = currentSkipSilence ? Math.max(0, mediaDelta - wallDelta * rate) : 0;
        await addListeningSample({
          episode: audio.current,
          listeningSec: wallDelta,
          contentSec: mediaDelta,
          speedSavedSec,
          silenceSavedSec
        });
      }
    }
    telemetryRef.current = { episodeId: audio.current.id, mediaAt: audio.currentTime, wallAt: now };
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
    downloadFile(`elephant-pod-backup-${Date.now()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  }

  async function handleImportJson(file: File) {
    const parsed = JSON.parse(await file.text()) as BackupFile;
    await importBackup(parsed);
    await refreshLocalState();
  }

  function handleExportOpml() {
    downloadFile(`elephant-pod-subscriptions-${Date.now()}.opml`, exportOpml(feeds), 'text/xml');
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

  async function handleOpenRemotePodcast(result: { id: string; feedUrl: string; title: string }) {
    if (!settings) return;
    setStatus(`Loading ${result.title}...`);
    try {
      const parsed = await fetchFeedThroughServer(result.feedUrl, settings.serverUrl);
      await cacheParsedPodcast(parsed, result.id);
      await refreshLocalState();
      navigatePodcast(parsed.podcast.id);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Podcast details failed to load.');
    }
  }

  async function handleSubscribeRemotePodcast(result: { id: string; feedUrl: string; title: string }) {
    if (!settings) return;
    setStatus(`Subscribing to ${result.title}...`);
    try {
      const parsed = await fetchFeedThroughServer(result.feedUrl, settings.serverUrl);
      await cacheParsedPodcast(parsed, result.id);
      await subscribeCachedPodcast(parsed.podcast.id);
      await refreshLocalState();
      navigatePodcast(parsed.podcast.id);
      setStatus(`Subscribed to ${parsed.podcast.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Podcast subscription failed.');
    }
  }

  async function handleRefreshSelectedPodcast() {
    if (!settings || !selectedPodcast) return;
    setStatus(`Refreshing ${selectedPodcast.title}...`);
    try {
      const parsed = await fetchFeedThroughServer(selectedPodcast.feedUrl, settings.serverUrl);
      await cacheParsedPodcast(parsed, selectedPodcast.podcastIndexId);
      if (feeds.some((feed) => feed.id === selectedPodcast.id)) await upsertParsedFeed(parsed);
      await refreshLocalState();
      setStatus(`Refreshed ${parsed.podcast.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Podcast refresh failed.');
    }
  }

  async function handleSubscribePodcast(podcastId: string) {
    await subscribeCachedPodcast(podcastId);
    await refreshLocalState();
  }

  async function handleUnsubscribePodcast(podcastId: string) {
    await unsubscribePodcast(podcastId);
    await refreshLocalState();
  }

  async function handleSavePodcastPreference(preference: PodcastPreference) {
    await savePodcastPreference(preference);
    await refreshLocalState();
  }

  async function handleSendAllUnplayedSelectedToInbox() {
    if (!selectedPodcastId) return;
    await sendAllUnplayedToInbox(selectedPodcastId);
    await refreshLocalState();
  }

  async function handleMarkSelectedPodcastPlayed(played: boolean) {
    if (!selectedPodcastId) return;
    if (played) await markAllInFeedPlayed(selectedPodcastId);
    else await markAllInFeedUnplayed(selectedPodcastId);
    await refreshLocalState();
  }

  const handlers = {
    onPlay: handlePlay,
    onQueue: handleQueue,
    onPlayNext: handlePlayNext,
    onQueueEnd: handleQueueEnd,
    onSendInbox: handleSendInbox,
    onDismiss: handleDismiss,
    onDownload: handleDownload,
    onTogglePlayed: handleTogglePlayed,
    onClip: setClipEpisode,
    onOpenEpisode: (episode: EpisodeWithState) => navigateEpisode(episode.id),
    onOpenPodcast: (podcastId: string) => navigatePodcast(podcastId),
    currentEpisodeId: audio.current?.id,
    isCurrentPlaying: audio.isPlaying
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

    if (selectedEpisode) {
      return (
        <EpisodeDetailPage
          episode={selectedEpisode}
          podcastImageUrl={selectedEpisodePodcast?.imageUrl}
          onOpenPodcast={navigatePodcast}
          onPlay={(episode) => void handlePlay(episode)}
          onPlayNext={(episode) => void handlePlayNext(episode)}
          onQueueEnd={(episode) => void handleQueueEnd(episode)}
          onSendInbox={(episode) => void handleSendInbox(episode)}
          onDownload={(episode) => void handleDownload(episode)}
          onTogglePlayed={(episode) => void handleTogglePlayed(episode)}
        />
      );
    }

    if (selectedPodcast && selectedPodcastPreference) {
      return (
        <PodcastDetailPage
          podcast={selectedPodcast}
          subscribed={feeds.some((feed) => feed.id === selectedPodcast.id)}
          episodes={selectedPodcastEpisodes}
          preference={selectedPodcastPreference}
          onSubscribe={() => void handleSubscribePodcast(selectedPodcast.id)}
          onUnsubscribe={() => void handleUnsubscribePodcast(selectedPodcast.id)}
          onRefresh={() => void handleRefreshSelectedPodcast()}
          onPreferenceChange={(preference) => void handleSavePodcastPreference(preference)}
          onSendAllUnplayedToInbox={() => void handleSendAllUnplayedSelectedToInbox()}
          onMarkAllPlayed={() => void handleMarkSelectedPodcastPlayed(true)}
          onMarkAllUnplayed={() => void handleMarkSelectedPodcastPlayed(false)}
          handlers={handlers}
        />
      );
    }

    switch (active) {
      case 'inbox':
        return <InboxPage episodes={inboxEpisodes} onRefreshFeeds={handleRefreshFeeds} getPodcastImageUrl={getPodcastImageUrl} handlers={handlers} />;
      case 'queue':
        return <QueuePage episodes={queueEpisodes} onPlay={handlePlay} onMove={handleMoveQueue} onRemove={handleRemoveQueue} />;
      case 'library':
        return <LibraryPage podcasts={cachedPodcasts} subscribedFeeds={feeds} episodes={knownEpisodes} onOpenPodcast={navigatePodcast} />;
      case 'search':
        return (
          <SearchPage
            podcasts={feeds}
            cachedPodcasts={cachedPodcasts}
            canSearchRemote={Boolean(runtimeServerUrl && serverSession && !isServerSessionExpired(serverSession))}
            accessToken={serverSession && !isServerSessionExpired(serverSession) ? serverSession.accessToken : null}
            serverUrl={runtimeServerUrl}
            onOpenPodcast={navigatePodcast}
            onOpenRemotePodcast={(result) => void handleOpenRemotePodcast(result)}
            onResolveFeedUrl={handleCacheFeedUrl}
            onSubscribe={(podcastId) => void handleSubscribePodcast(podcastId)}
            onSubscribeRemote={(result) => void handleSubscribeRemotePodcast(result)}
            onUnsubscribe={(podcastId) => void handleUnsubscribePodcast(podcastId)}
          />
        );
      case 'history':
        return <HistoryPage episodes={knownEpisodes} getPodcastImageUrl={getPodcastImageUrl} handlers={handlers} />;
      case 'downloads':
        return <DownloadsPage episodes={episodes} getPodcastImageUrl={getPodcastImageUrl} handlers={handlers} />;
      case 'settings':
        return (
          <SettingsPage
            settings={effectivePlayerSettings}
            listeningStats={listeningStats}
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

  const currentSkipSilence = audio.current
    ? episodeSilenceOverrides[audio.current.id] ?? podcastPreferences.find((preference) => preference.podcastId === audio.current?.podcastId)?.silenceShortening ?? settings?.silenceShortening ?? false
    : false;

  return (
    <>
      <AppShell
        active={active}
        onSelect={navigateSection}
        serverUrl={runtimeServerUrl}
        serverSession={serverSession}
        onSignIn={() => void handleBrowserSignIn()}
        onSignOut={handleBrowserSignOut}
        canGoBack={navStack.length > 0}
        onBack={navigateBack}
        player={
          settings && (
            <PlayerBar
              current={audio.current}
              queue={queueEpisodes}
              isPlaying={audio.isPlaying}
              currentTime={audio.currentTime}
              duration={audio.duration}
              settings={settings}
              currentSkipSilence={currentSkipSilence}
              collapseToken={playerCollapseToken}
              onCurrentSkipSilenceChange={(enabled) => {
                if (!audio.current) return;
                setEpisodeSilenceOverrides((overrides) => ({ ...overrides, [audio.current!.id]: enabled }));
              }}
              onToggle={() => void audio.toggle()}
              onSeek={audio.seek}
              onSkipBy={audio.skipBy}
              onSettingsChange={(next) => void persistSettings(next)}
              onStopForSleep={audio.stop}
              onPlayNext={() => {
                const next = queueEpisodes.find((episode) => episode.id !== audio.current?.id);
                if (next) void handlePlay(next);
                else if (inboxEpisodes[0]) void handlePlay(inboxEpisodes[0]);
              }}
              onPlayEpisode={(episode) => void handlePlay(episode)}
              onQueueNext={(episode) => void handlePlayNext(episode)}
              onQueueEnd={(episode) => void handleQueueEnd(episode)}
              onSendInbox={(episode) => void handleSendInbox(episode)}
              onRemoveQueue={(episode) => void handleRemoveQueue(episode)}
              onTogglePlayed={(episode) => void handleTogglePlayed(episode)}
              onReorderQueue={(episode, position) => {
                void reorderQueue(episode.id, position).then(refreshLocalState);
              }}
              onOpenEpisode={(episode) => navigateEpisode(episode.id)}
              onOpenPodcast={navigatePodcast}
              getPodcastImageUrl={getPodcastImageUrl}
            />
          )
        }
      >
        {page}
      </AppShell>
      {status ? <StatusToast message={status} onDismiss={() => setStatus('')} /> : null}
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
  autoDownload: true,
  autoDownloadInbox: false,
  autoDeleteAfterListen: true,
  downloadOnlyWifi: true,
  storageCapMb: 2048,
  inboxSortDirection: 'newest',
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

function sortOldest(a: EpisodeWithState, b: EpisodeWithState) {
  return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
}

function StatusToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[10rem] z-[60] flex justify-center px-4 md:bottom-[7rem]" aria-live="polite" aria-atomic="true">
      <div role="status" className="pointer-events-auto flex max-w-md items-center gap-3 rounded-eh border border-yellow/30 bg-canvas/95 px-4 py-3 text-sm font-bold text-yellow shadow-xl shadow-black/40">
        <span className="min-w-0 flex-1">{message}</span>
        <button type="button" onClick={onDismiss} className="rounded px-2 py-1 text-xs text-bone transition hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow" aria-label="Dismiss notification">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function allKnownEpisodes(cached: EpisodeWithState[], subscribed: EpisodeWithState[]): EpisodeWithState[] {
  return [...new Map([...cached, ...subscribed].map((episode) => [episode.id, episode])).values()];
}

function defaultPodcastPreference(podcastId: string): PodcastPreference {
  return {
    podcastId,
    skipIntroSec: 0,
    skipOutroSec: 0,
    sortDirection: 'newest',
    addNewEpisodesToInbox: true,
    updatedAt: nowIso()
  };
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
