import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LuGithub as Github } from 'react-icons/lu';
import { FaUndo } from 'react-icons/fa';
import type { AppSettings, BackupFile, CachedPodcast, EpisodeWithState, ListeningStats, Podcast, PodcastPreference, SectionKey } from '@/types/domain';
import { AppShell } from '@/components/Layout/AppShell';
import { PlayerBar } from '@/components/Player/PlayerBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { prefetchServerSilenceMaps } from '@/lib/audio/silenceMaps';
import { fetchSmartSkipSegmentMap, requestSmartSkipProcessing } from '@/lib/smartSkip/api';
import { getSmartSkipRequestStatus } from '@/lib/smartSkip/cache';
import { nowIso } from '@/lib/dates';
import { fetchFeedThroughServer } from '@/lib/rss';
import { enrichYoutubeEpisode, extractYoutubeEpisode, fetchServerCapabilities, importYoutubeSource } from '@/lib/youtubeImport';
import { exportOpml, importOpml } from '@/lib/opml';
import { deleteEpisodeFromCache, downloadEpisodeToCache } from '@/lib/storage/cache';
import { cacheArtworkForOfflineEpisodes, hydrateArtworkForLibrary, revokeArtworkObjectUrls } from '@/lib/storage/artwork';
import { ensureSeedData } from '@/lib/storage/db';
import { clearServerSession, consumeAuthTokenFromCallback, fetchServerSessionProfile, isServerSessionExpired, loadPersistedServerSession, loadServerSession, normalizeServerUrl, readAuthSessionFromUrl, resolveBrowserServerUrl, saveServerSession, startGithubSignIn, testServerConnection, type ServerSession } from '@/lib/sync/serverAuth';
import {
  exportBackup,
  addPodcastToLibrary,
  addEpisodeToQueueEnd,
  addEpisodeToQueueNext,
  addEpisodeToQueueTop,
  cacheParsedPodcast,
  getSettings,
  getEpisodeWithState,
  addListeningSample,
  getListeningStats,
  getPodcastPreference,
  importBackup,
  listCachedEpisodes,
  listCachedPodcasts,
  listEpisodes,
  listFeeds,
  listPodcastPreferences,
  listReadySilenceMapEpisodeIds,
  listReadySmartSkipMapEpisodeIds,
  listSmartSkipMapEpisodeIdsByStatus,
  markAllInFeedPlayed,
  markAllInFeedUnplayed,
  moveInQueue,
  playEpisodeAtQueueTop,
  purgePodcastFromLibrary,
  removePodcastFromLibrary,
  removeFromInbox,
  removeFromQueue,
  reorderQueue,
  saveSettings,
  savePodcastPreference,
  sendAllUnplayedToInbox,
  sendEpisodeToInbox,
  subscribeCachedPodcast,
  unsubscribePodcast,
  updateEpisodeMetadata,
  updateEpisodeState,
  upsertParsedFeed
} from '@/lib/storage/repository';
import { deleteInactiveDownloadIfNeeded, deleteInactiveDownloadsIfNeeded, maybeAutoDownload, pruneDownloadsOverCap } from '@/lib/features/automation';
import { deriveLibraryPodcasts } from '@/lib/libraryModel';
import { isTauriRuntime } from '@/lib/native/tauriBridge';
import { isHostedWebRuntime, isLoopbackUrl } from '@/lib/runtime';
import { syncNow } from '@/lib/sync/syncEngine';

type ViewSnapshot = {
  active: SectionKey;
  selectedPodcastId: string | null;
  selectedEpisodeId: string | null;
};

const MANUAL_FEED_REFRESH_COOLDOWN_MS = 30_000;
const MANUAL_PODCAST_REFRESH_COOLDOWN_MS = 20_000;

type PendingLibraryRemoval = {
  podcast: CachedPodcast;
  wasSubscribed: boolean;
  downloadedEpisodes: EpisodeWithState[];
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
  const [pendingLibraryRemoval, setPendingLibraryRemoval] = useState<PendingLibraryRemoval | null>(null);
  const pendingLibraryRemovalTimerRef = useRef<number | null>(null);
  const [downloadingEpisodeIds, setDownloadingEpisodeIds] = useState<Set<string>>(new Set());
  const [confirmDeleteDownloadEpisodeId, setConfirmDeleteDownloadEpisodeId] = useState<string | null>(null);
  const [readySilenceEpisodeIds, setReadySilenceEpisodeIds] = useState<Set<string>>(new Set());
  const [readySmartSkipEpisodeIds, setReadySmartSkipEpisodeIds] = useState<Set<string>>(new Set());
  const [processingSmartSkipEpisodeIds, setProcessingSmartSkipEpisodeIds] = useState<Set<string>>(new Set());
  const [smartSkipPollTick, setSmartSkipPollTick] = useState(0);
  const [playerCollapseToken, setPlayerCollapseToken] = useState(0);
  const [status, setStatus] = useState('');
  const [statusDurationMs, setStatusDurationMs] = useState(3200);
  const [statusAction, setStatusAction] = useState<(() => void) | null>(null);
  const [serverTestStatus, setServerTestStatus] = useState('');
  const [serverConnectionOk, setServerConnectionOk] = useState(false);
  const [serverSession, setServerSession] = useState<ServerSession | null>(null);
  const [serverSessionHydrating, setServerSessionHydrating] = useState(true);
  const [pendingCallbackSession, setPendingCallbackSession] = useState<ServerSession | null>(null);
  const [youtubeImportEnabled, setYoutubeImportEnabled] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const telemetryRef = useRef<{ episodeId: string; mediaAt: number; wallAt: number } | null>(null);
  const persistedProgressRef = useRef<{ episodeId: string; second: number } | null>(null);
  const profileHydrationRef = useRef<string | null>(null);
  const syncHydrationRef = useRef<string | null>(null);
  const onlineSyncRef = useRef<string | null>(null);
  const artworkObjectUrlsRef = useRef<string[]>([]);
  const offlineBundlePrefetchRef = useRef<Set<string>>(new Set());
  const youtubeEnrichmentRef = useRef<Set<string>>(new Set());
  const startupCueEpisodeRef = useRef<string | null>(null);
  const smartSkipRequestedAtRef = useRef<Map<string, number>>(new Map());
  const lastManualFeedRefreshAtRef = useRef(0);
  const lastPodcastRefreshAtRef = useRef<Map<string, number>>(new Map());

  const hostedWebRuntime = isHostedWebRuntime();
  const runtimeServerUrl = resolveBrowserServerUrl(resolveConfiguredServerUrl(settings?.serverUrl));
  const runtimeSettings = useMemo(
    () => ({
      ...(settings || fallbackSettings),
      serverUrl: runtimeServerUrl
    }),
    [runtimeServerUrl, settings]
  );
  const serverAccessToken = serverSession && !isServerSessionExpired(serverSession) ? serverSession.accessToken : null;
  const canUseServerSilence = Boolean(runtimeServerUrl && serverAccessToken);
  const canUseServerSmartSkip = Boolean(runtimeServerUrl && serverAccessToken);
  const canUseYoutubeImport = Boolean(runtimeServerUrl && serverAccessToken && youtubeImportEnabled);
  const audio = useAudioController(runtimeSettings, podcastPreferences, episodeSilenceOverrides, serverAccessToken);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      revokeArtworkObjectUrls(artworkObjectUrlsRef.current);
    };
  }, []);

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
    const [nextSettings, nextFeeds, nextEpisodes, nextCachedPodcasts, nextCachedEpisodes, nextPodcastPreferences, nextListeningStats, nextReadySilenceIds, nextReadySmartSkipIds, nextProcessingSmartSkipIds] = await Promise.all([
      getSettings(),
      listFeeds(),
      listEpisodes(),
      listCachedPodcasts(),
      listCachedEpisodes(),
      listPodcastPreferences(),
      getListeningStats(),
      listReadySilenceMapEpisodeIds(),
      listReadySmartSkipMapEpisodeIds(),
      listSmartSkipMapEpisodeIdsByStatus(['queued', 'processing'])
    ]);
    const normalizedSettings = isTauriRuntime() && isLoopbackUrl(nextSettings.serverUrl || '') ? { ...nextSettings, serverUrl: '' } : nextSettings;
    if (normalizedSettings !== nextSettings) void saveSettings(normalizedSettings);
    const hydrated = await hydrateArtworkForLibrary({
      feeds: nextFeeds,
      cachedPodcasts: nextCachedPodcasts,
      episodes: nextEpisodes,
      cachedEpisodes: nextCachedEpisodes
    });
    revokeArtworkObjectUrls(artworkObjectUrlsRef.current);
    artworkObjectUrlsRef.current = hydrated.objectUrls;
    setSettings(normalizedSettings);
    setFeeds(hydrated.feeds);
    setEpisodes(hydrated.episodes);
    setCachedPodcasts(hydrated.cachedPodcasts);
    setCachedEpisodes(hydrated.cachedEpisodes);
    setPodcastPreferences(nextPodcastPreferences);
    setListeningStats(nextListeningStats);
    setReadySilenceEpisodeIds(new Set(nextReadySilenceIds));
    setReadySmartSkipEpisodeIds(new Set(nextReadySmartSkipIds));
    setProcessingSmartSkipEpisodeIds(new Set(nextProcessingSmartSkipIds));
    void cacheArtworkForOfflineEpisodes([...nextEpisodes, ...nextCachedEpisodes], [...nextFeeds, ...nextCachedPodcasts]).then((count) => {
      if (count > 0) void refreshLocalState();
    });
  }, []);

  useEffect(() => {
    void refreshLocalState();
  }, [refreshLocalState]);

  useEffect(() => {
    const callbackSession = consumeAuthTokenFromCallback();
    if (callbackSession) {
      setServerSessionHydrating(false);
      if (runtimeServerUrl) {
        saveServerSession(runtimeServerUrl, callbackSession);
        setServerSession(callbackSession);
        void hydrateCallbackSession(runtimeServerUrl, callbackSession);
        setPendingCallbackSession(null);
      } else {
        setPendingCallbackSession(callbackSession);
      }
      setStatus('Signed in with GitHub.');
      return;
    }

    if (!runtimeServerUrl) {
      if (serverSession) setServerSession(null);
      profileHydrationRef.current = null;
      setServerSessionHydrating(false);
      return;
    }

    if (pendingCallbackSession) {
      setServerSessionHydrating(false);
      saveServerSession(runtimeServerUrl, pendingCallbackSession);
      setServerSession(pendingCallbackSession);
      void hydrateCallbackSession(runtimeServerUrl, pendingCallbackSession);
      setPendingCallbackSession(null);
      setStatus('Signed in with GitHub.');
      return;
    }

    const immediateSession = loadServerSession(runtimeServerUrl);
    if (immediateSession) {
      setServerSession(immediateSession);
      setServerSessionHydrating(false);
      return;
    }

    setServerSessionHydrating(true);
    let cancelled = false;
    void loadPersistedServerSession(runtimeServerUrl).then((persistedSession) => {
      if (cancelled) return;
      if (persistedSession) setServerSession((current) => current || persistedSession);
    }).finally(() => {
      if (!cancelled) setServerSessionHydrating(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingCallbackSession, runtimeServerUrl]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const handleDeepLinks = (urls: string[]) => {
      const callbackSession = urls.map(readAuthSessionFromUrl).find((session): session is ServerSession => Boolean(session));
      if (!callbackSession) return;
      if (runtimeServerUrl) {
        saveServerSession(runtimeServerUrl, callbackSession);
        setServerSession(callbackSession);
        void hydrateCallbackSession(runtimeServerUrl, callbackSession);
        setPendingCallbackSession(null);
      } else {
        setPendingCallbackSession(callbackSession);
      }
      setStatus('Signed in with GitHub.');
    };

    void import('@tauri-apps/plugin-deep-link').then(async ({ getCurrent, onOpenUrl }) => {
      const currentUrls = await getCurrent().catch(() => null);
      if (!disposed && currentUrls) handleDeepLinks(currentUrls);
      unlisten = await onOpenUrl((urls) => {
        if (!disposed) handleDeepLinks(urls);
      }).catch(() => null);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
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
      setServerSession((current) => current?.accessToken === serverSession.accessToken ? nextSession : current);
    });
  }, [runtimeServerUrl, serverSession]);

  useEffect(() => {
    let cancelled = false;
    if (!runtimeServerUrl) {
      setYoutubeImportEnabled(false);
      return;
    }
    void fetchServerCapabilities(runtimeServerUrl).then((capabilities) => {
      if (!cancelled) setYoutubeImportEnabled(capabilities.youtubeImport.enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [runtimeServerUrl]);

  useEffect(() => {
    if (!settings || !serverSession || isServerSessionExpired(serverSession)) {
      syncHydrationRef.current = null;
      return;
    }
    const syncKey = `${runtimeServerUrl}:${serverSession.accessToken}`;
    if (!runtimeServerUrl || syncHydrationRef.current === syncKey) return;
    syncHydrationRef.current = syncKey;
    void syncNow(runtimeServerUrl, serverSession.accessToken, currentSyncOptions()).then(() => refreshLocalState());
  }, [refreshLocalState, runtimeServerUrl, settings, serverSession]);

  useEffect(() => {
    if (!isOnline || !settings || !runtimeServerUrl || !serverSession || isServerSessionExpired(serverSession)) return;
    const syncKey = `${runtimeServerUrl}:${serverSession.accessToken}:${Math.floor(Date.now() / 60_000)}`;
    if (onlineSyncRef.current === syncKey) return;
    onlineSyncRef.current = syncKey;
    void syncNow(runtimeServerUrl, serverSession.accessToken, currentSyncOptions()).then(() => refreshLocalState());
  }, [isOnline, refreshLocalState, runtimeServerUrl, serverSession, settings]);

  useEffect(() => {
    if (!settings) return;
    const timer = window.setInterval(() => {
      void handleRefreshFeeds();
    }, Math.max(15, settings.refreshIntervalMinutes) * 60_000);
    return () => window.clearInterval(timer);
  }, [settings?.refreshIntervalMinutes, feeds.length]);

  useEffect(() => {
    if (!status || status.endsWith('...') || status.endsWith('…')) return;
    if (pendingLibraryRemoval) return;
    const timer = window.setTimeout(() => {
      setStatus('');
      setStatusDurationMs(3200);
      setStatusAction(null);
    }, statusDurationMs);
    return () => window.clearTimeout(timer);
  }, [pendingLibraryRemoval, status, statusDurationMs]);

  useEffect(() => {
    if (!audio.smartSkipNotice) return;
    setStatus(`Skipped ${audio.smartSkipNotice.segment.label.toLowerCase()}`);
    setStatusDurationMs(750);
    setStatusAction(() => audio.undoSmartSkip);
  }, [audio.smartSkipNotice, audio.undoSmartSkip]);

  useEffect(() => {
    return () => clearPendingLibraryRemovalTimer();
  }, []);

  const knownEpisodes = useMemo(() => allKnownEpisodes(cachedEpisodes, episodes), [cachedEpisodes, episodes]);
  const offlineMode = !isOnline;
  const visibleEpisodes = useMemo(() => offlineMode ? knownEpisodes.filter((episode) => episode.state.downloaded) : knownEpisodes, [knownEpisodes, offlineMode]);
  const liveVisibleEpisodes = useMemo(
    () => overlayLiveProgress(visibleEpisodes, audio.current, audio.currentTime, audio.duration),
    [audio.current?.id, audio.currentTime, audio.duration, visibleEpisodes]
  );
  const liveKnownEpisodes = useMemo(
    () => overlayLiveProgress(knownEpisodes, audio.current, audio.currentTime, audio.duration),
    [audio.current?.id, audio.currentTime, audio.duration, knownEpisodes]
  );
  const downloadedEpisodes = useMemo(() => knownEpisodes.filter((episode) => episode.state.downloaded), [knownEpisodes]);
  const visibleEpisodePodcastIds = useMemo(() => new Set(liveVisibleEpisodes.map((episode) => episode.podcastId)), [liveVisibleEpisodes]);
  const visibleFeeds = useMemo(() => offlineMode ? feeds.filter((podcast) => visibleEpisodePodcastIds.has(podcast.id)) : feeds, [feeds, offlineMode, visibleEpisodePodcastIds]);
  const visibleCachedPodcasts = useMemo(() => offlineMode ? cachedPodcasts.filter((podcast) => visibleEpisodePodcastIds.has(podcast.id)) : cachedPodcasts, [cachedPodcasts, offlineMode, visibleEpisodePodcastIds]);
  const libraryPodcasts = useMemo(() => deriveLibraryPodcasts(visibleCachedPodcasts, visibleFeeds, liveVisibleEpisodes, podcastPreferences), [visibleCachedPodcasts, visibleFeeds, liveVisibleEpisodes, podcastPreferences]);
  const podcastImageById = useMemo(() => {
    const next = new Map<string, string>();
    for (const podcast of [...visibleFeeds, ...visibleCachedPodcasts, ...libraryPodcasts]) {
      if (podcast.imageUrl) next.set(podcast.id, podcast.imageUrl);
    }
    for (const episode of liveVisibleEpisodes) {
      if (episode.imageUrl && !next.has(episode.podcastId)) next.set(episode.podcastId, episode.imageUrl);
    }
    return next;
  }, [libraryPodcasts, visibleCachedPodcasts, liveVisibleEpisodes, visibleFeeds]);
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
    if (!isOnline || !downloadedEpisodes.length) return;
    const pending = downloadedEpisodes.filter((episode) => !offlineBundlePrefetchRef.current.has(episode.id));
    if (!pending.length) return;
    for (const episode of pending) offlineBundlePrefetchRef.current.add(episode.id);
    void cacheArtworkForOfflineEpisodes(pending, [...feeds, ...cachedPodcasts]);
    const silencePending = pending.filter((episode) => settings && isSmartSkipSilenceEnabled(episode, settings, podcastPreferences));
    if (canUseServerSilence && silencePending.length) void prefetchServerSilenceMaps(silencePending, runtimeServerUrl, serverAccessToken);
    if (canUseServerSmartSkip) {
      for (const episode of pending) void requestSmartSkipProcessing(episode, runtimeServerUrl, serverAccessToken, 'queue');
    }
  }, [cachedPodcasts, canUseServerSilence, canUseServerSmartSkip, downloadedEpisodes, feeds, isOnline, runtimeServerUrl, serverAccessToken]);

  useEffect(() => {
    telemetryRef.current = audio.current
      ? { episodeId: audio.current.id, mediaAt: audio.currentTime, wallAt: performance.now() }
      : null;
  }, [audio.current?.id, audio.isPlaying]);

  useEffect(() => {
    if (!audio.current) return;
    const rounded = Math.max(0, Math.floor(audio.currentTime));
    const lastPersisted = persistedProgressRef.current;
    const shouldPersist =
      lastPersisted?.episodeId !== audio.current.id ||
      rounded === 0 ||
      Math.abs(rounded - (lastPersisted?.second ?? -999)) >= 5;
    if (!shouldPersist) return;
    const timer = window.setTimeout(() => {
      if (!audio.current) return;
      persistedProgressRef.current = { episodeId: audio.current.id, second: rounded };
      void updateEpisodeState(audio.current.id, { progressSec: rounded });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [audio.current?.id, audio.currentTime]);

  const inboxEpisodes = useMemo(
    () => liveVisibleEpisodes
      .filter((episode) => episode.state.inboxState === 'new' && !episode.state.played && !episode.state.queuePosition)
      .sort((a, b) => {
        if (settings?.inboxSortDirection === 'oldest') return sortOldest(a, b) || (a.state.inboxPosition || 0) - (b.state.inboxPosition || 0);
        return sortNewest(a, b) || (a.state.inboxPosition || 0) - (b.state.inboxPosition || 0);
      }),
    [settings?.inboxSortDirection, liveVisibleEpisodes]
  );

  const queueEpisodes = useMemo(
    () => liveVisibleEpisodes.filter((episode) => episode.state.queuePosition).sort((a, b) => (a.state.queuePosition || 0) - (b.state.queuePosition || 0)),
    [liveVisibleEpisodes]
  );

  useEffect(() => {
    if (!settings || audio.current || audio.isPlaying || !queueEpisodes.length) return;
    const top = queueEpisodes[0];
    if (startupCueEpisodeRef.current === top.id) return;
    startupCueEpisodeRef.current = top.id;
    void audio.cueEpisode(withPlaybackArtwork(top));
  }, [audio.current, audio.cueEpisode, audio.isPlaying, queueEpisodes, settings, withPlaybackArtwork]);

  useEffect(() => {
    if (!settings || !canUseServerSilence) return;
    const candidates = [
      ...(audio.current ? [audio.current] : []),
      ...queueEpisodes.filter((episode) => episode.id !== audio.current?.id).slice(0, 3),
      ...inboxEpisodes.slice(0, 3)
    ];
    const relevant = candidates.filter((episode) => episodeSilenceOverrides[episode.id] ?? isSmartSkipSilenceEnabled(episode, settings, podcastPreferences));
    if (!relevant.length) return;
    void prefetchServerSilenceMaps(relevant, runtimeServerUrl, serverAccessToken);
  }, [audio.current?.id, canUseServerSilence, episodeSilenceOverrides, inboxEpisodes, podcastPreferences, queueEpisodes, runtimeServerUrl, serverAccessToken, settings]);

  useEffect(() => {
    if (!settings?.smartSkipEnabled || !canUseServerSmartSkip || !serverAccessToken) return;
    const timer = window.setInterval(() => setSmartSkipPollTick((tick) => tick + 1), 2 * 60_000);
    return () => window.clearInterval(timer);
  }, [canUseServerSmartSkip, serverAccessToken, settings?.smartSkipEnabled]);

  useEffect(() => {
    if (!settings?.smartSkipEnabled || !canUseServerSmartSkip || !serverAccessToken) return;
    const byEpisodeId = new Map<string, { episode: EpisodeWithState; reason: 'queue' | 'inbox' }>();
    for (const episode of inboxEpisodes) byEpisodeId.set(episode.id, { episode, reason: 'inbox' });
    for (const episode of queueEpisodes) byEpisodeId.set(episode.id, { episode, reason: 'queue' });
    const candidates = [...byEpisodeId.values()].filter(({ episode }) => {
      const preference = podcastPreferences.find((item) => item.podcastId === episode.podcastId);
      return preference?.smartSkipEnabled !== false && !readySmartSkipEpisodeIds.has(episode.id);
    });
    if (!candidates.length) return;
    let cancelled = false;
    void (async () => {
      let changed = false;
      for (const { episode, reason } of candidates) {
        if (cancelled) return;
        const cachedStatus = await getSmartSkipRequestStatus(episode).catch(() => null);
        const throttleMs = cachedStatus === 'queued' || cachedStatus === 'processing' ? 2 * 60_000 : 30 * 60_000;
        const lastRequestedAt = smartSkipRequestedAtRef.current.get(episode.id) || 0;
        if (Date.now() - lastRequestedAt < throttleMs) continue;
        smartSkipRequestedAtRef.current.set(episode.id, Date.now());
        const map = cachedStatus === 'queued' || cachedStatus === 'processing'
          ? await fetchSmartSkipSegmentMap(episode, runtimeServerUrl, serverAccessToken).catch(() => null)
          : cachedStatus === 'ready'
            ? null
            : await requestSmartSkipProcessing(episode, runtimeServerUrl, serverAccessToken, reason).catch(() => null);
        if (cachedStatus === 'ready') continue;
        changed = true;
        if (map?.status === 'ready') setReadySmartSkipEpisodeIds((current) => new Set(current).add(episode.id));
        else setProcessingSmartSkipEpisodeIds((current) => new Set(current).add(episode.id));
      }
      if (!changed) return;
      const [nextReady, nextProcessing] = await Promise.all([
        listReadySmartSkipMapEpisodeIds(),
        listSmartSkipMapEpisodeIdsByStatus(['queued', 'processing'])
      ]);
      if (!cancelled) {
        setReadySmartSkipEpisodeIds(new Set(nextReady));
        setProcessingSmartSkipEpisodeIds(new Set(nextProcessing));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canUseServerSmartSkip, inboxEpisodes, podcastPreferences, queueEpisodes, readySmartSkipEpisodeIds, runtimeServerUrl, serverAccessToken, settings?.smartSkipEnabled, smartSkipPollTick]);

  const selectedPodcast = useMemo(() => {
    if (!selectedPodcastId) return null;
    const cached = libraryPodcasts.find((podcast) => podcast.id === selectedPodcastId) || visibleCachedPodcasts.find((podcast) => podcast.id === selectedPodcastId);
    if (cached) return cached;
    const feed = visibleFeeds.find((podcast) => podcast.id === selectedPodcastId);
    return feed ? toCachedPodcastView(feed) : null;
  }, [libraryPodcasts, selectedPodcastId, visibleCachedPodcasts, visibleFeeds]);
  const selectedPodcastEpisodes = useMemo(() => selectedPodcastId ? liveVisibleEpisodes.filter((episode) => episode.podcastId === selectedPodcastId) : [], [selectedPodcastId, liveVisibleEpisodes]);
  const selectedPodcastPreference = useMemo(() => selectedPodcastId ? podcastPreferences.find((preference) => preference.podcastId === selectedPodcastId) || defaultPodcastPreference(selectedPodcastId) : null, [podcastPreferences, selectedPodcastId]);
  const selectedEpisode = useMemo(() => selectedEpisodeId ? liveVisibleEpisodes.find((episode) => episode.id === selectedEpisodeId) || null : null, [selectedEpisodeId, liveVisibleEpisodes]);
  const selectedEpisodePodcast = useMemo(
    () => selectedEpisode ? visibleCachedPodcasts.find((podcast) => podcast.id === selectedEpisode.podcastId) || visibleFeeds.find((podcast) => podcast.id === selectedEpisode.podcastId) : null,
    [selectedEpisode, visibleCachedPodcasts, visibleFeeds]
  );

  useEffect(() => {
    if (!selectedEpisode || selectedEpisode.sourceType !== 'youtube') return;
    if (!runtimeServerUrl || !serverAccessToken || !youtubeImportEnabled) return;
    const sourceUrl = selectedEpisode.sourceUrl || selectedEpisode.websiteUrl;
    if (!sourceUrl || youtubeEnrichmentRef.current.has(selectedEpisode.id)) return;
    youtubeEnrichmentRef.current.add(selectedEpisode.id);
    void enrichYoutubeEpisode(runtimeServerUrl, serverAccessToken, selectedEpisode.id, sourceUrl)
      .then(async (patch) => {
        if (!Object.keys(patch).length) return;
        await updateEpisodeMetadata(selectedEpisode.id, patch);
        await refreshLocalState();
      })
      .catch(() => {
        youtubeEnrichmentRef.current.delete(selectedEpisode.id);
      });
  }, [refreshLocalState, runtimeServerUrl, selectedEpisode, serverAccessToken, youtubeImportEnabled]);

  const episodeBadgesById = useMemo(() => {
    if (!settings) return {};
    const preferences = new Map(podcastPreferences.map((preference) => [preference.podcastId, preference]));
    const badges: Record<string, string[]> = {};
    for (const episode of liveVisibleEpisodes) {
      const preference = preferences.get(episode.podcastId);
      const episodeBadges: string[] = [];
      if ((preference?.smartSkipEnabled ?? settings.smartSkipEnabled) && readySmartSkipEpisodeIds.has(episode.id)) episodeBadges.push('Smart Skip');
      else if ((preference?.smartSkipEnabled ?? settings.smartSkipEnabled) && processingSmartSkipEpisodeIds.has(episode.id)) episodeBadges.push('Smart Skip queued');
      if ((episodeSilenceOverrides[episode.id] ?? preference?.silenceShortening ?? settings.silenceShortening) && readySilenceEpisodeIds.has(episode.id)) episodeBadges.push('Trim silence');
      if (episodeBadges.length) badges[episode.id] = episodeBadges;
    }
    return badges;
  }, [episodeSilenceOverrides, liveVisibleEpisodes, podcastPreferences, processingSmartSkipEpisodeIds, readySilenceEpisodeIds, readySmartSkipEpisodeIds, settings]);
  const effectivePlayerSettings = useMemo(() => {
    const preference = audio.current ? podcastPreferences.find((item) => item.podcastId === audio.current?.podcastId) : undefined;
    return {
      ...runtimeSettings,
      playbackRate: preference?.playbackRate ?? runtimeSettings.playbackRate,
      skipForwardSec: preference?.skipForwardSec ?? runtimeSettings.skipForwardSec,
      skipBackSec: preference?.skipBackSec ?? runtimeSettings.skipBackSec,
      silenceShortening: preference?.silenceShortening ?? runtimeSettings.silenceShortening
    };
  }, [audio.current, podcastPreferences, runtimeSettings]);

  async function persistSettings(next: AppSettings) {
    if (next.serverUrl !== settings?.serverUrl) {
      setServerConnectionOk(false);
      setServerTestStatus('');
    }
    setSettings(next);
    await saveSettings(next);
  }

  function currentSyncOptions() {
    return {
      activeEpisodeId: audio.current?.id,
      activeProgressSec: audio.currentTime,
      activePlaying: audio.isPlaying
    };
  }

  async function handleTestServer(serverUrlOverride?: string): Promise<boolean> {
    const nextSettings = settings && serverUrlOverride !== undefined ? { ...settings, serverUrl: serverUrlOverride } : settings;
    if (nextSettings && serverUrlOverride !== undefined && serverUrlOverride !== settings?.serverUrl) {
      setSettings(nextSettings);
      await saveSettings(nextSettings);
    }
    const serverUrlToTest = resolveConfiguredServerUrl(nextSettings?.serverUrl);
    if (!serverUrlToTest) {
      setServerConnectionOk(false);
      setServerTestStatus('Enter a server URL first.');
      return false;
    }
    try {
      setServerConnectionOk(false);
      setServerTestStatus('Testing server connection...');
      const message = await testServerConnection(serverUrlToTest);
      setServerConnectionOk(true);
      setServerTestStatus(message);
      return true;
    } catch (error) {
      setServerConnectionOk(false);
      setServerTestStatus(error instanceof Error ? error.message : 'Server connection failed.');
      return false;
    }
  }

  async function handleReconnect() {
    const browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    setIsOnline(browserOnline);
    if (!browserOnline) {
      setStatus('Still offline.');
      return;
    }
    setStatus('Reconnecting...');
    try {
      if (runtimeServerUrl) {
        await testServerConnection(runtimeServerUrl);
        setServerConnectionOk(true);
      }
      if (runtimeServerUrl && serverSession && !isServerSessionExpired(serverSession)) {
        await syncNow(runtimeServerUrl, serverSession.accessToken, currentSyncOptions());
        await refreshLocalState();
      }
      setStatus('Reconnected.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Reconnect failed.');
    }
  }

  const handleCacheFeedUrl = useCallback(async (url: string) => {
    if (!settings) throw new Error('Local settings are still loading.');
    if (!url.trim()) throw new Error('Enter an RSS feed URL.');
    try {
      setStatus('Fetching feed…');
      const parsed = await fetchFeedThroughServer(url.trim(), runtimeServerUrl);
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
      setServerSessionHydrating(false);
      return;
    }
    if (nextSession) {
      saveServerSession(runtimeServerUrl, nextSession);
    } else {
      clearServerSession(runtimeServerUrl);
    }
    setServerSession(nextSession);
    setServerSessionHydrating(false);
  }

  async function hydrateCallbackSession(serverUrl: string, session: ServerSession) {
    const profile = await fetchServerSessionProfile(serverUrl, session.accessToken).catch(() => null);
    if (!profile) {
      setStatus('Signed in with GitHub.');
      return;
    }
    const nextSession = { ...session, ...profile, updatedAt: new Date().toISOString() };
    saveServerSession(serverUrl, nextSession);
    setServerSession((current) => current?.accessToken === session.accessToken ? nextSession : current);
  }

  async function handleRefreshFeeds(options: { manual?: boolean } = {}) {
    if (!settings || feeds.length === 0) return;
    if (options.manual && Date.now() - lastManualFeedRefreshAtRef.current < MANUAL_FEED_REFRESH_COOLDOWN_MS) {
      setStatus('Feeds were just refreshed. Try again in a moment.');
      return;
    }
    if (options.manual) lastManualFeedRefreshAtRef.current = Date.now();
    if (!isOnline) {
      setStatus('Offline. Showing downloaded episodes only.');
      return;
    }
    let refreshed = 0;
    for (const feed of feeds) {
      try {
        const parsed = await fetchFeedThroughServer(feed.feedUrl, runtimeServerUrl);
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
      setActive('settings');
      setStatus('Add a server URL in Settings before signing in.');
      setServerTestStatus('Add a server URL in Settings before signing in.');
      return;
    }
    if (!hostedWebRuntime) {
      const connectionOk = await handleTestServer();
      if (!connectionOk) {
        setActive('settings');
        setStatus('Could not confirm the server connection.');
        setServerTestStatus('Could not confirm the server connection. Check the server URL and try again.');
        return;
      }
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

  const browserNeedsSignIn = hostedWebRuntime && Boolean(settings) && !isTauriRuntime() && !serverSessionHydrating && (!serverSession || isServerSessionExpired(serverSession));

  async function handlePlay(episode: EpisodeWithState) {
    const playableEpisode = await ensureYoutubeAudioReady(episode);
    if (!playableEpisode) return;
    try {
      if (audio.current?.id === playableEpisode.id) {
        const willResume = !audio.isPlaying;
        await audio.toggle();
        if (willResume) await updateEpisodeState(playableEpisode.id, { lastPlayedAt: nowIso() });
        await refreshLocalState();
        return;
      }
      const displacedEpisode = audio.current;
      const displacedTime = audio.currentTime;
      const displacedDuration = audio.duration || displacedEpisode?.durationSec || 0;
      await audio.playEpisode(withPlaybackArtwork(playableEpisode));
      if (displacedEpisode) await handleDisplaceEpisodeIfNeeded(displacedEpisode, displacedTime, displacedDuration);
      await playEpisodeAtQueueTop(playableEpisode.id);
      await refreshLocalState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not start playback.');
    }
  }

  async function handleDisplaceEpisodeIfNeeded(episode: EpisodeWithState, currentTime: number, currentDuration: number) {
    const completion = currentDuration > 0 ? currentTime / currentDuration : 0;
    if (completion >= 0.9) {
      await updateEpisodeState(episode.id, {
        played: true,
        playedAt: nowIso(),
        lastPlayedAt: nowIso(),
        progressSec: currentDuration || currentTime,
        inboxState: 'archived',
        inboxPosition: undefined,
        queuePosition: undefined,
        queuedAt: undefined
      });
      if (settings) await deleteInactiveDownloadIfNeeded(episode.id, settings);
      return;
    }
    await updateEpisodeState(episode.id, { progressSec: Math.floor(currentTime) });
    await addEpisodeToQueueNext(episode.id);
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

  async function handleQueueTop(episode: EpisodeWithState) {
    await addEpisodeToQueueTop(episode.id);
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

  function applyOptimisticEpisodeState(episodeId: string, patch: Partial<EpisodeWithState['state']>) {
    const timestamp = nowIso();
    const update = (episode: EpisodeWithState) => episode.id === episodeId
      ? { ...episode, state: { ...episode.state, ...patch, updatedAt: timestamp } }
      : episode;
    setEpisodes((current) => current.map(update));
    setCachedEpisodes((current) => current.map(update));
  }

  async function handleDismiss(episode: EpisodeWithState) {
    setEpisodes((current) => current.filter((item) => item.id !== episode.id));
    setCachedEpisodes((current) => current.filter((item) => item.id !== episode.id));
    void removeFromInbox(episode.id)
      .then(() => window.setTimeout(() => {
        void refreshLocalState();
      }, 600))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Could not remove episode from Inbox.');
        void refreshLocalState();
      });
  }

  async function handleDownload(episode: EpisodeWithState) {
    if (downloadingEpisodeIds.has(episode.id)) return;
    if (episode.state.downloaded) {
      if (confirmDeleteDownloadEpisodeId !== episode.id) {
        setConfirmDeleteDownloadEpisodeId(episode.id);
        return;
      }
      setConfirmDeleteDownloadEpisodeId(null);
      setDownloadingEpisodeIds((ids) => new Set(ids).add(episode.id));
      try {
        await deleteEpisodeFromCache(episode);
        await updateEpisodeState(episode.id, {
          downloaded: false,
          downloadedAt: undefined,
          downloadPath: undefined,
          downloadBytes: undefined,
          downloadBackend: undefined,
          downloadSource: undefined
        });
        setStatus(`Deleted download for ${episode.title}.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not delete download.');
      } finally {
        setDownloadingEpisodeIds((ids) => {
          const next = new Set(ids);
          next.delete(episode.id);
          return next;
        });
        await refreshLocalState();
      }
      return;
    }
    const downloadableEpisode = await ensureYoutubeAudioReady(episode);
    if (!downloadableEpisode) return;
    setConfirmDeleteDownloadEpisodeId(null);
    setDownloadingEpisodeIds((ids) => new Set(ids).add(downloadableEpisode.id));
    try {
      const result = await downloadEpisodeToCache(downloadableEpisode);
      await updateEpisodeState(downloadableEpisode.id, {
        downloaded: true,
        downloadedAt: nowIso(),
        downloadPath: result.path,
        downloadBytes: result.bytes,
        downloadBackend: result.backend,
        downloadSource: 'manual'
      });
      const downloadedEpisode = { ...downloadableEpisode, state: { ...downloadableEpisode.state, downloaded: true } };
      void cacheArtworkForOfflineEpisodes([downloadedEpisode], [...feeds, ...cachedPodcasts]);
      if (canUseServerSilence && isSmartSkipSilenceEnabled(downloadedEpisode, runtimeSettings, podcastPreferences)) void prefetchServerSilenceMaps([downloadedEpisode], runtimeServerUrl, serverAccessToken);
      if (canUseServerSmartSkip) void requestSmartSkipProcessing(downloadedEpisode, runtimeServerUrl, serverAccessToken, 'queue');
      setStatus(`Downloaded ${downloadableEpisode.title} ${result.backend === 'tauri-filesystem' ? 'to native storage' : 'to browser cache'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Download failed. Host may block browser downloads, or native storage may be unavailable.');
    } finally {
      setDownloadingEpisodeIds((ids) => {
        const next = new Set(ids);
        next.delete(downloadableEpisode.id);
        return next;
      });
    }
    await refreshLocalState();
  }

  async function ensureYoutubeAudioReady(episode: EpisodeWithState): Promise<EpisodeWithState | null> {
    if (episode.sourceType !== 'youtube' || episode.extractionStatus === 'ready') return episode;
    if (!runtimeServerUrl || !serverAccessToken) {
      setStatus('Sign in to import YouTube audio.');
      return null;
    }
    if (!youtubeImportEnabled) {
      setStatus('YouTube audio import is disabled on this server.');
      return null;
    }
    const sourceUrl = episode.sourceUrl || episode.websiteUrl;
    if (!sourceUrl) {
      setStatus('This YouTube episode is missing its source URL.');
      return null;
    }
    try {
      setStatus('Queuing YouTube audio import...');
      const result = await extractYoutubeEpisode(runtimeServerUrl, serverAccessToken, episode.id, sourceUrl);
      await updateEpisodeMetadata(episode.id, { extractionStatus: result.audioReady ? 'ready' : result.extractionStatus });
      await refreshLocalState();
      if (result.audioReady) {
        setStatus('YouTube audio is ready.');
        return (await getEpisodeWithState(episode.id)) || { ...episode, extractionStatus: 'ready' };
      }
      setStatus('Server is preparing YouTube audio...');
      for (let attempt = 0; attempt < 18; attempt += 1) {
        await sleep(5000);
        const next = await extractYoutubeEpisode(runtimeServerUrl, serverAccessToken, episode.id, sourceUrl);
        await updateEpisodeMetadata(episode.id, { extractionStatus: next.audioReady ? 'ready' : next.extractionStatus });
        if (next.audioReady) {
          await refreshLocalState();
          setStatus('YouTube audio is ready.');
          return (await getEpisodeWithState(episode.id)) || { ...episode, extractionStatus: 'ready' };
        }
      }
      setStatus('YouTube audio is still processing on the server. Try again shortly.');
      return null;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'YouTube audio import failed.');
      return null;
    }
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
        const silenceSavedSec = effectivePlayerSettings.silenceShortening ? Math.max(0, mediaDelta - wallDelta * rate) : 0;
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
    const lastPersisted = persistedProgressRef.current;
    if (rounded > 0 && rounded % 15 === 0 && (lastPersisted?.episodeId !== audio.current.id || lastPersisted.second !== rounded)) {
      persistedProgressRef.current = { episodeId: audio.current.id, second: rounded };
      await updateEpisodeState(audio.current.id, { progressSec: rounded });
    }
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
        const parsed = await fetchFeedThroughServer(url, runtimeServerUrl);
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
      const parsed = await fetchFeedThroughServer(result.feedUrl, runtimeServerUrl);
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
      const parsed = await fetchFeedThroughServer(result.feedUrl, runtimeServerUrl);
      await cacheParsedPodcast(parsed, result.id);
      await subscribeCachedPodcast(parsed.podcast.id);
      await refreshLocalState();
      navigatePodcast(parsed.podcast.id);
      setStatus(`Subscribed to ${parsed.podcast.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Podcast subscription failed.');
    }
  }

  async function handleImportYoutube(url: string) {
    if (!runtimeServerUrl || !serverAccessToken) {
      setStatus('Sign in to import YouTube audio.');
      return;
    }
    if (!youtubeImportEnabled) {
      setStatus('YouTube import is disabled on this server.');
      return;
    }
    setStatus('Importing YouTube source...');
    try {
      const parsed = await importYoutubeSource(runtimeServerUrl, serverAccessToken, url);
      await cacheParsedPodcast(parsed);
      await subscribeCachedPodcast(parsed.podcast.id);
      await refreshLocalState();
      navigatePodcast(parsed.podcast.id);
      setStatus(`Imported ${parsed.podcast.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'YouTube import failed.');
    }
  }

  async function handleRefreshSelectedPodcast() {
    if (!settings || !selectedPodcast) return;
    const lastRefreshAt = lastPodcastRefreshAtRef.current.get(selectedPodcast.id) || 0;
    if (Date.now() - lastRefreshAt < MANUAL_PODCAST_REFRESH_COOLDOWN_MS) {
      setStatus(`${selectedPodcast.title} was just refreshed. Try again in a moment.`);
      return;
    }
    lastPodcastRefreshAtRef.current.set(selectedPodcast.id, Date.now());
    setStatus(`Refreshing ${selectedPodcast.title}...`);
    try {
      const parsed = selectedPodcast.sourceType?.startsWith('youtube')
        ? await refreshYoutubeSource(selectedPodcast)
        : await fetchFeedThroughServer(selectedPodcast.feedUrl, runtimeServerUrl);
      await cacheParsedPodcast(parsed, selectedPodcast.podcastIndexId);
      if (feeds.some((feed) => feed.id === selectedPodcast.id)) await upsertParsedFeed(parsed);
      await refreshLocalState();
      setStatus(`Refreshed ${parsed.podcast.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Podcast refresh failed.');
    }
  }

  async function refreshYoutubeSource(podcast: Podcast) {
    if (!runtimeServerUrl || !serverAccessToken) throw new Error('Sign in to refresh YouTube sources.');
    if (!youtubeImportEnabled) throw new Error('YouTube import is disabled on this server.');
    return importYoutubeSource(runtimeServerUrl, serverAccessToken, podcast.sourceUrl || podcast.feedUrl);
  }

  async function handleSubscribePodcast(podcastId: string) {
    if (pendingLibraryRemoval?.podcast.id === podcastId) {
      clearPendingLibraryRemovalTimer();
      setPendingLibraryRemoval(null);
    }
    const podcast = selectedPodcast?.id === podcastId ? selectedPodcast : visibleCachedPodcasts.find((item) => item.id === podcastId) || libraryPodcasts.find((item) => item.id === podcastId);
    if (podcast) {
      setFeeds((current) => current.some((feed) => feed.id === podcastId) ? current : [...current, toPodcastView(podcast)]);
      setPodcastPreferences((current) => upsertPodcastPreference(current, podcastId, { inLibrary: true, wasSubscribedBeforeLibraryRemoval: false }));
    }
    await subscribeCachedPodcast(podcastId);
    await refreshLocalState();
  }

  async function handleUnsubscribePodcast(podcastId: string) {
    setFeeds((current) => current.filter((feed) => feed.id !== podcastId));
    setPodcastPreferences((current) => upsertPodcastPreference(current, podcastId, { inLibrary: true }));
    await unsubscribePodcast(podcastId);
    await refreshLocalState();
  }

  async function handleAddPodcastToLibrary(podcastId: string) {
    if (pendingLibraryRemoval?.podcast.id === podcastId) {
      undoPendingLibraryRemoval();
      return;
    }
    const preference = podcastPreferences.find((item) => item.podcastId === podcastId);
    const podcast = selectedPodcast?.id === podcastId ? selectedPodcast : visibleCachedPodcasts.find((item) => item.id === podcastId) || libraryPodcasts.find((item) => item.id === podcastId);
    setPodcastPreferences((current) => upsertPodcastPreference(current, podcastId, { inLibrary: true, wasSubscribedBeforeLibraryRemoval: false }));
    if (preference?.wasSubscribedBeforeLibraryRemoval && podcast) {
      setFeeds((current) => current.some((feed) => feed.id === podcastId) ? current : [...current, toPodcastView(podcast)]);
    }
    await addPodcastToLibrary(podcastId);
    await refreshLocalState();
  }

  async function handleRemovePodcastFromLibrary(podcast: CachedPodcast) {
    const wasSubscribed = feeds.some((feed) => feed.id === podcast.id);
    const downloadedEpisodes = liveVisibleEpisodes.filter((episode) => episode.podcastId === podcast.id && episode.state.downloaded);
    clearPendingLibraryRemovalTimer();
    setPendingLibraryRemoval({ podcast, wasSubscribed, downloadedEpisodes });
    setPodcastPreferences((current) => upsertPodcastPreference(current, podcast.id, { inLibrary: false, wasSubscribedBeforeLibraryRemoval: wasSubscribed }));
    setFeeds((current) => current.filter((feed) => feed.id !== podcast.id));
    setStatus(`Removed ${podcast.title} from Library. Undo within 30s.`);
    await removePodcastFromLibrary(podcast.id, wasSubscribed);
    pendingLibraryRemovalTimerRef.current = window.setTimeout(() => {
      void finalizePodcastLibraryRemoval(podcast.id, downloadedEpisodes);
    }, 30_000);
  }

  function undoPendingLibraryRemoval() {
    const pending = pendingLibraryRemoval;
    if (!pending) return;
    clearPendingLibraryRemovalTimer();
    setPendingLibraryRemoval(null);
    setPodcastPreferences((current) => upsertPodcastPreference(current, pending.podcast.id, { inLibrary: true, wasSubscribedBeforeLibraryRemoval: false }));
    if (pending.wasSubscribed) {
      setFeeds((current) => current.some((feed) => feed.id === pending.podcast.id) ? current : [...current, toPodcastView(pending.podcast)]);
    }
    setStatus(`Restored ${pending.podcast.title}.`);
    void addPodcastToLibrary(pending.podcast.id).then(refreshLocalState);
  }

  async function finalizePodcastLibraryRemoval(podcastId: string, downloadedEpisodes: EpisodeWithState[]) {
    clearPendingLibraryRemovalTimer();
    setPendingLibraryRemoval((pending) => pending?.podcast.id === podcastId ? null : pending);
    setEpisodes((current) => current.map((episode) => episode.podcastId === podcastId ? withoutLibraryRemovalState(episode) : episode));
    setCachedEpisodes((current) => current.map((episode) => episode.podcastId === podcastId ? withoutLibraryRemovalState(episode) : episode));
    await Promise.all(downloadedEpisodes.map((episode) => deleteEpisodeFromCache(episode).catch(() => undefined)));
    await purgePodcastFromLibrary(podcastId);
    await refreshLocalState();
  }

  function clearPendingLibraryRemovalTimer() {
    if (pendingLibraryRemovalTimerRef.current !== null) {
      window.clearTimeout(pendingLibraryRemovalTimerRef.current);
      pendingLibraryRemovalTimerRef.current = null;
    }
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
    onQueueTop: handleQueueTop,
    onPlayNext: handlePlayNext,
    onQueueEnd: handleQueueEnd,
    onSendInbox: handleSendInbox,
    onDismiss: handleDismiss,
    onDownload: handleDownload,
    onTogglePlayed: handleTogglePlayed,
    onOpenEpisode: (episode: EpisodeWithState) => navigateEpisode(episode.id),
    onOpenPodcast: (podcastId: string) => navigatePodcast(podcastId),
    currentEpisodeId: audio.current?.id,
    isCurrentPlaying: audio.isPlaying,
    downloadingEpisodeIds,
    confirmDeleteDownloadEpisodeId,
    onCancelDeleteDownload: () => setConfirmDeleteDownloadEpisodeId(null),
    episodeBadgesById
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
            {!hostedWebRuntime ? (
              <div className="mt-5 grid gap-3 text-left">
                <label className="grid gap-2">
                  <span className="text-sm font-bold text-cream">App server URL</span>
                  <Input
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={settings.serverUrl || ''}
                    onChange={(event) => void persistSettings({ ...settings, serverUrl: event.target.value })}
                    placeholder="https://ears.example.com"
                    aria-label="App server URL"
                  />
                </label>
                <Button onClick={() => void handleTestServer()} disabled={!settings.serverUrl?.trim()} aria-label="Test app server connection">
                  Test server
                </Button>
                <p className="text-sm text-yellow" role="status">{serverTestStatus || 'Enter a server URL and test it before signing in.'}</p>
              </div>
            ) : null}
            <Button onClick={() => void handleBrowserSignIn()} className="mt-5" disabled={!runtimeServerUrl} aria-label="Start GitHub sign-in">
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
          onCancelDeleteDownload={() => setConfirmDeleteDownloadEpisodeId(null)}
          onTogglePlayed={(episode) => void handleTogglePlayed(episode)}
          downloading={downloadingEpisodeIds.has(selectedEpisode.id)}
          confirmingDeleteDownload={confirmDeleteDownloadEpisodeId === selectedEpisode.id}
          processedBadges={episodeBadgesById[selectedEpisode.id]}
        />
      );
    }

    if (selectedPodcast && selectedPodcastPreference) {
      return (
        <PodcastDetailPage
          podcast={selectedPodcast}
          inLibrary={visibleFeeds.some((feed) => feed.id === selectedPodcast.id) || selectedPodcastPreference.inLibrary !== false}
          subscribed={visibleFeeds.some((feed) => feed.id === selectedPodcast.id)}
          pendingLibraryRemoval={pendingLibraryRemoval?.podcast.id === selectedPodcast.id}
          episodes={selectedPodcastEpisodes}
          preference={selectedPodcastPreference}
          smartSkipDefaults={runtimeSettings}
          onSubscribe={() => void handleSubscribePodcast(selectedPodcast.id)}
          onUnsubscribe={() => void handleUnsubscribePodcast(selectedPodcast.id)}
          onAddToLibrary={() => void handleAddPodcastToLibrary(selectedPodcast.id)}
          onRemoveFromLibrary={() => void handleRemovePodcastFromLibrary(selectedPodcast)}
          onUndoRemoveFromLibrary={undoPendingLibraryRemoval}
          onRefresh={() => void handleRefreshSelectedPodcast()}
          onPreferenceChange={(preference) => void handleSavePodcastPreference(preference)}
          onSendAllUnplayedToInbox={() => void handleSendAllUnplayedSelectedToInbox()}
          onMarkAllPlayed={() => void handleMarkSelectedPodcastPlayed(true)}
          onMarkAllUnplayed={() => void handleMarkSelectedPodcastPlayed(false)}
          handlers={handlers}
          canUseSmartSkip={canUseServerSmartSkip}
        />
      );
    }

    switch (active) {
      case 'inbox':
        return <InboxPage episodes={inboxEpisodes} onRefreshFeeds={() => void handleRefreshFeeds({ manual: true })} getPodcastImageUrl={getPodcastImageUrl} episodeBadgesById={episodeBadgesById} handlers={handlers} />;
      case 'queue':
        return <QueuePage episodes={queueEpisodes} onPlay={handlePlay} onMove={handleMoveQueue} onQueueTop={handleQueueTop} onQueueEnd={handleQueueEnd} onSendInbox={handleSendInbox} onRemove={handleRemoveQueue} onTogglePlayed={handleTogglePlayed} />;
      case 'library':
        return <LibraryPage podcasts={libraryPodcasts} subscribedFeeds={visibleFeeds} episodes={liveVisibleEpisodes} onRefreshFeeds={() => void handleRefreshFeeds({ manual: true })} onOpenPodcast={navigatePodcast} />;
      case 'search':
        return (
          <SearchPage
            podcasts={visibleFeeds}
            cachedPodcasts={visibleCachedPodcasts}
            canSearchRemote={Boolean(isOnline && runtimeServerUrl && serverSession && !isServerSessionExpired(serverSession))}
            canUseYoutubeImport={Boolean(isOnline && canUseYoutubeImport)}
            offline={offlineMode}
            accessToken={serverSession && !isServerSessionExpired(serverSession) ? serverSession.accessToken : null}
            serverUrl={runtimeServerUrl}
            onOpenPodcast={navigatePodcast}
            onOpenRemotePodcast={(result) => void handleOpenRemotePodcast(result)}
            onResolveFeedUrl={handleCacheFeedUrl}
            onImportYoutube={(url) => handleImportYoutube(url)}
            onSubscribe={(podcastId) => void handleSubscribePodcast(podcastId)}
            onSubscribeRemote={(result) => void handleSubscribeRemotePodcast(result)}
          />
        );
      case 'history':
        return <HistoryPage episodes={liveKnownEpisodes} getPodcastImageUrl={getPodcastImageUrl} handlers={handlers} />;
      case 'downloads':
        return <DownloadsPage episodes={liveVisibleEpisodes} getPodcastImageUrl={getPodcastImageUrl} handlers={handlers} />;
      case 'settings':
        return (
          <SettingsPage
            settings={settings}
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
            onTestServer={(serverUrl) => void handleTestServer(serverUrl)}
            serverTestStatus={serverTestStatus}
            serverConnectionOk={serverConnectionOk}
            onSignIn={() => void handleBrowserSignIn()}
            showServerControls={!hostedWebRuntime}
            canUseSmartSkip={canUseServerSmartSkip}
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
        onSelect={navigateSection}
        serverUrl={runtimeServerUrl}
        serverSession={serverSession}
        onSignIn={() => void handleBrowserSignIn()}
        onSignOut={handleBrowserSignOut}
        canGoBack={navStack.length > 0}
        onBack={navigateBack}
        offline={offlineMode}
        onReconnect={() => void handleReconnect()}
        inboxCount={inboxEpisodes.length}
        player={
          settings && (
            <PlayerBar
              current={audio.current}
              queue={queueEpisodes}
              isPlaying={audio.isPlaying}
              currentTime={audio.currentTime}
              duration={audio.duration}
              settings={settings}
              collapseToken={playerCollapseToken}
              onToggle={() => void audio.toggle()}
              onSeek={audio.seek}
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
      {status ? (
        <StatusToast
          message={status}
          onDismiss={() => {
            setStatus('');
            setStatusDurationMs(3200);
            setStatusAction(null);
          }}
          onUndo={pendingLibraryRemoval ? undoPendingLibraryRemoval : statusAction || undefined}
        />
      ) : null}
      <audio ref={audio.audioRef} preload="metadata" onEnded={() => void handleEnded()} onTimeUpdate={() => void handleTimeUpdate()}>
        <track kind="captions" />
      </audio>
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
  silenceShorteningMode: 'server-ffmpeg',
  silenceThreshold: 0.018,
  silenceThresholdDb: -42,
  silenceMinMs: 350,
  silenceMinimumDurationSec: 0.35,
  silenceBoostRate: 2.15,
  smartSkipEnabled: true,
  smartSkipCommercials: true,
  smartSkipAds: true,
  smartSkipSponsors: true,
  smartSkipIntros: false,
  smartSkipOutros: false,
  smartSkipNetworkPromos: true,
  smartSkipSelfPromos: false,
  smartSkipSilence: false,
  smartSkipIncludeSoftMatches: false,
  smartSkipSoftSkips: false,
  smartSkipSoftPrompt: true,
  smartSkipUseServerMedia: true,
  theme: 'dark'
};

function sortNewest(a: EpisodeWithState, b: EpisodeWithState) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function sortOldest(a: EpisodeWithState, b: EpisodeWithState) {
  return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
}

function StatusToast({ message, onDismiss, onUndo }: { message: string; onDismiss: () => void; onUndo?: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[10rem] z-[60] flex justify-center px-4 md:bottom-[7rem]" aria-live="polite" aria-atomic="true">
      <div role="status" className="pointer-events-auto flex max-w-md items-center gap-3 rounded-eh border border-yellow/30 bg-canvas/95 px-4 py-3 text-sm font-bold text-yellow shadow-xl shadow-black/40">
        <span className="min-w-0 flex-1">{message}</span>
        {onUndo ? (
          <button type="button" onClick={onUndo} className="grid h-8 w-8 place-items-center rounded text-cream transition hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow" aria-label="Undo notification action">
            <FaUndo size={14} aria-hidden />
          </button>
        ) : null}
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

function overlayLiveProgress(episodes: EpisodeWithState[], current: EpisodeWithState | null, currentTime: number, duration: number): EpisodeWithState[] {
  if (!current) return episodes;
  const progressSec = Math.max(0, Math.floor(currentTime));
  const durationSec = Math.max(duration || current.durationSec || 0, current.durationSec || 0);
  return episodes.map((episode) => {
    if (episode.id !== current.id) return episode;
    return {
      ...episode,
      durationSec: durationSec || episode.durationSec,
      state: {
        ...episode.state,
        progressSec
      }
    };
  });
}

function defaultPodcastPreference(podcastId: string): PodcastPreference {
  return {
    podcastId,
    inLibrary: false,
    wasSubscribedBeforeLibraryRemoval: false,
    skipIntroSec: 0,
    skipOutroSec: 0,
    sortDirection: 'newest',
    addNewEpisodesToInbox: true,
    updatedAt: nowIso()
  };
}

function upsertPodcastPreference(preferences: PodcastPreference[], podcastId: string, patch: Partial<PodcastPreference>): PodcastPreference[] {
  const existing = preferences.find((preference) => preference.podcastId === podcastId) || defaultPodcastPreference(podcastId);
  const next = { ...existing, ...patch, updatedAt: nowIso() };
  return [...preferences.filter((preference) => preference.podcastId !== podcastId), next];
}

function toPodcastView(podcast: CachedPodcast): Podcast {
  return {
    id: podcast.id,
    title: podcast.title,
    author: podcast.author,
    description: podcast.description,
    imageUrl: podcast.imageUrl,
    feedUrl: podcast.feedUrl,
    websiteUrl: podcast.websiteUrl,
    tags: podcast.tags || podcast.categories || [],
    sourceType: podcast.sourceType,
    sourceUrl: podcast.sourceUrl,
    externalId: podcast.externalId,
    lastRefreshedAt: podcast.lastRefreshedAt,
    createdAt: podcast.createdAt,
    updatedAt: podcast.updatedAt
  };
}

function toCachedPodcastView(podcast: Podcast): CachedPodcast {
  return {
    ...podcast,
    cachedAt: podcast.updatedAt,
    cacheExpiresAt: undefined,
    podcastIndexId: undefined,
    categories: podcast.tags || []
  };
}

function withoutLibraryRemovalState(episode: EpisodeWithState): EpisodeWithState {
  return {
    ...episode,
    state: {
      ...episode.state,
      inboxState: 'archived',
      inboxPosition: undefined,
      queuedAt: undefined,
      queuePosition: undefined,
      downloaded: false,
      downloadedAt: undefined,
      downloadPath: undefined,
      downloadBytes: undefined,
      downloadBackend: undefined,
      downloadSource: undefined
    }
  };
}

function isSmartSkipSilenceEnabled(episode: EpisodeWithState, settings: AppSettings, preferences: PodcastPreference[]) {
  const preference = preferences.find((item) => item.podcastId === episode.podcastId);
  const smartSkipEnabled = preference?.smartSkipEnabled ?? settings.smartSkipEnabled;
  if (!smartSkipEnabled) return false;
  return Boolean(preference?.smartSkipSilence ?? settings.smartSkipSilence);
}

function resolveConfiguredServerUrl(configuredUrl?: string) {
  if (configuredUrl && !isLocalPreviewAppUrl(configuredUrl)) return configuredUrl;
  return getBrowserRuntimeServerUrl();
}

function getBrowserRuntimeServerUrl() {
  if (isTauriRuntime()) return '';
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== 'undefined' && isHostedWebRuntime()) return window.location.origin;
  return 'http://localhost:8787';
}

function isLocalPreviewAppUrl(input: string) {
  if (typeof window === 'undefined') return false;
  try {
    const candidate = new URL(normalizeServerUrl(input));
    const current = new URL(window.location.origin);
    return candidate.origin === current.origin && (current.hostname === 'localhost' || current.hostname === '127.0.0.1') && current.port !== '8787';
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
