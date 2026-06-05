import type { AppSettings, Clip, Episode, EpisodeState, Podcast, PodcastPreference, SyncAction, SyncTombstone, TombstoneTable } from '@/types/domain';
import { db } from '../storage/db';
import { getSettings, saveSettings } from '../storage/repository';
import { nowIso } from '../dates';
import { normalizeServerUrl } from './serverAuth';

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  message: string;
}

export interface SyncOptions {
  activeEpisodeId?: string;
  activeProgressSec?: number;
  activePlaying?: boolean;
}

interface SyncRequestPayload {
  feeds: Podcast[];
  episodes: Episode[];
  states: EpisodeState[];
  podcastPreferences: PodcastPreference[];
  clips: Clip[];
  tombstones: SyncTombstone[];
  actions: SyncAction[];
  settings: AppSettings;
  deviceId?: string;
}

interface SyncResponsePayload {
  message?: string;
  stats?: Partial<SyncResult>;
  pulls?: unknown;
  pulled?: unknown;
  pulledData?: unknown;
  pushed?: unknown;
  conflicts?: unknown;
  subscriptions?: unknown;
  feeds?: unknown;
  episodes?: unknown;
  episode_states?: unknown;
  episodeStates?: unknown;
  episode_state?: unknown;
  episodeState?: unknown;
  podcastPreferences?: unknown;
  podcast_preferences?: unknown;
  clips?: unknown;
  sync_tombstones?: unknown;
  tombstones?: unknown;
  sync_actions?: unknown;
  syncActions?: unknown;
  actions?: unknown;
  user_settings?: unknown;
  userSettings?: unknown;
}

interface PulledRemote {
  subscriptions: unknown[];
  episodes: unknown[];
  episodeStates: unknown[];
  podcastPreferences: unknown[];
  clips: unknown[];
  tombstones: unknown[];
  actions: unknown[];
  settings: unknown;
}

type RemoteEpisodeState = Omit<EpisodeState, 'downloaded' | 'downloadedAt' | 'downloadPath' | 'downloadBytes' | 'downloadBackend'> & {
  downloaded?: boolean;
  downloadedAt?: string;
};

export async function syncNow(serverUrl?: string, accessToken?: string, options: SyncOptions = {}): Promise<SyncResult> {
  const settings = await getSettings();
  const base = normalizeServerUrl(serverUrl || settings.serverUrl);
  if (!base) return { pushed: 0, pulled: 0, conflicts: 0, message: 'Server URL is not configured.' };
  if (!accessToken) return { pushed: 0, pulled: 0, conflicts: 0, message: 'Sign in before syncing.' };

  const [localFeeds, localEpisodes, localStates, localPodcastPreferences, localClips, localTombstones, pendingActions] = await Promise.all([
    db.feeds.toArray(),
    db.episodes.toArray(),
    db.states.toArray(),
    db.podcastPreferences.toArray(),
    db.clips.toArray(),
    db.tombstones.toArray(),
    db.syncActions.filter((action) => !action.pushedAt).toArray()
  ]);

  const payload: SyncRequestPayload = {
    feeds: localFeeds,
    episodes: localEpisodes,
    states: localStates,
    podcastPreferences: localPodcastPreferences,
    clips: localClips,
    tombstones: localTombstones,
    actions: pendingActions,
    settings,
    deviceId: settings.deviceId || crypto.randomUUID()
  };

  const response = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await parseSyncError(response);
    return { pushed: 0, pulled: 0, conflicts: 0, message };
  }

  const body = (await response.json().catch(() => null)) as SyncResponsePayload | null;
  const pulled = extractPulled(body);
  const stats: MutableSyncStats = { pushed: 0, pulled: 0, conflicts: 0 };

  const remoteFeeds = normalizeRemoteFeeds(pulled.subscriptions);
  const remoteEpisodes = normalizeRemoteEpisodes(pulled.episodes);
  const remoteStates = normalizeRemoteStates(pulled.episodeStates);
  const remotePodcastPreferences = normalizeRemotePodcastPreferences(pulled.podcastPreferences);
  const remoteClips = normalizeRemoteClips(pulled.clips);
  const remoteTombstones = normalizeRemoteTombstones(pulled.tombstones);
  const remoteActions = normalizeRemoteActions(pulled.actions);
  const remoteSettings = pickedRemoteSettings(pulled.settings);

  await syncActions(pendingActions, remoteActions, stats, options);
  await syncFeeds(localFeeds, remoteFeeds, stats);
  await syncEpisodes(localEpisodes, remoteEpisodes, stats);
  await syncStates(localStates, remoteStates, stats, options, pendingActions);
  await syncPodcastPreferences(localPodcastPreferences, remotePodcastPreferences, stats);
  await syncClips(localClips, remoteClips, stats);
  await syncSettings(settings, remoteSettings, stats);
  await syncTombstones(localTombstones, remoteTombstones, stats);

  const nextStats = {
    pushed: pickNumber(body?.stats?.pushed, body?.pushed) ?? stats.pushed,
    pulled: pickNumber(body?.stats?.pulled, body?.pulled) ?? stats.pulled,
    conflicts: pickNumber(body?.stats?.conflicts, body?.conflicts) ?? stats.conflicts,
    message: ''
  };

  const syncMetaDeviceId = settings.deviceId || payload.deviceId || crypto.randomUUID();
  const timestamp = nowIso();
  await db.syncMeta.put({
    id: 'main',
    deviceId: syncMetaDeviceId,
    lastPulledAt: timestamp,
    lastPushedAt: timestamp,
    updatedAt: timestamp
  });
  await markActionsPushed(pendingActions, timestamp);
  const nextSettings = await getSettings();
  await saveSettings({ ...nextSettings, lastSyncAt: timestamp });

  return {
    ...nextStats,
    message:
      body?.message ||
      `Sync complete. Pushed ${nextStats.pushed}, pulled ${nextStats.pulled}, resolved ${nextStats.conflicts} conflict${nextStats.conflicts === 1 ? '' : 's'} by latest update time.`
  };
}

function extractPulled(body: SyncResponsePayload | null): PulledRemote {
  if (!body) {
    return { subscriptions: [], episodes: [], episodeStates: [], podcastPreferences: [], clips: [], tombstones: [], actions: [], settings: null };
  }

  const pulled = toRecord(body.pulledData ?? body.pulled ?? body.pulls);
  return {
    subscriptions: toArray(pulled.subscriptions || pulled.feeds || body.subscriptions || body.feeds),
    episodes: toArray(pulled.episodes || body.episodes),
    episodeStates: toArray(pulled.states || pulled.episode_states || pulled.episodeStates || body.episode_states || body.episodeStates || body.episode_state),
    podcastPreferences: toArray(pulled.podcastPreferences || pulled.podcast_preferences || body.podcastPreferences || body.podcast_preferences),
    clips: toArray(pulled.clips || body.clips),
    tombstones: toArray(pulled.sync_tombstones || pulled.tombstones || body.sync_tombstones || body.tombstones),
    actions: toArray(pulled.sync_actions || pulled.syncActions || pulled.actions || body.sync_actions || body.syncActions || body.actions),
    settings: pulled.settings || pulled.user_settings || pulled.userSettings || body.user_settings || body.userSettings
  };
}

function normalizeRemoteFeeds(rows: unknown[]): Podcast[] {
  return rows.map(normalizeRemoteFeed).filter((feed): feed is Podcast => feed !== null);
}

function normalizeRemoteEpisodes(rows: unknown[]): Episode[] {
  return rows.map(normalizeRemoteEpisode).filter((episode): episode is Episode => episode !== null);
}

function normalizeRemoteStates(rows: unknown[]): RemoteEpisodeState[] {
  return rows.map(normalizeRemoteState).filter((state): state is RemoteEpisodeState => state !== null);
}

function normalizeRemotePodcastPreferences(rows: unknown[]): PodcastPreference[] {
  return rows.map(normalizeRemotePodcastPreference).filter((preference): preference is PodcastPreference => preference !== null);
}

function normalizeRemoteClips(rows: unknown[]): Clip[] {
  return rows.map(normalizeRemoteClip).filter((clip): clip is Clip => clip !== null);
}

function normalizeRemoteTombstones(rows: unknown[]): SyncTombstone[] {
  return rows
    .map((row) => normalizeRemoteTombstone(toRecord(row)))
    .filter((tombstone): tombstone is SyncTombstone => tombstone !== null);
}

function normalizeRemoteActions(rows: unknown[]): SyncAction[] {
  return rows.map(normalizeRemoteAction).filter((action): action is SyncAction => action !== null);
}

function normalizeRemoteAction(row: unknown): SyncAction | null {
  const record = toRecord(row);
  const id = asString(record.id);
  const deviceId = asString(record.device_id ?? record.deviceId);
  const entityType = asString(record.entity_type ?? record.entityType);
  const actionType = asString(record.action_type ?? record.actionType);
  const entityId = asString(record.entity_id ?? record.entityId);
  if (!id || !deviceId || entityType !== 'episode_state' || actionType !== 'episode-state-updated' || !entityId) return null;
  return {
    id,
    deviceId,
    sequence: asNumber(record.sequence) || 0,
    entityType,
    entityId,
    actionType,
    payload: toRecord(record.payload) as SyncAction['payload'],
    createdAt: asOptionalString(record.created_at ?? record.createdAt) || nowIso(),
    pushedAt: asOptionalString(record.pushed_at ?? record.pushedAt),
    appliedAt: asOptionalString(record.applied_at ?? record.appliedAt)
  };
}

function normalizeRemoteFeed(row: unknown): Podcast | null {
  const record = toRecord(row);
  const localId = asString(record.local_id ?? record.id);
  if (!localId) return null;
  const feedUrl = asString(record.feed_url ?? record.feedUrl);
  if (!feedUrl) return null;

  return {
    id: localId,
    title: asString(record.title),
    author: asOptionalString(record.author),
    description: asOptionalString(record.description),
    imageUrl: asOptionalString(record.image_url ?? record.imageUrl),
    feedUrl,
    websiteUrl: asOptionalString(record.website_url ?? record.websiteUrl),
    tags: Array.isArray(record.tags) ? (record.tags as string[]) : [],
    sourceType: asPodcastSourceType(record.source_type ?? record.sourceType),
    sourceUrl: asOptionalString(record.source_url ?? record.sourceUrl),
    externalId: asOptionalString(record.external_id ?? record.externalId),
    lastRefreshedAt: asOptionalString(record.last_refreshed_at ?? record.lastRefreshedAt),
    createdAt: asOptionalString(record.created_at ?? record.createdAt) || nowIso(),
    updatedAt: asOptionalString(record.updated_at ?? record.updatedAt) || nowIso()
  };
}

function normalizeRemoteEpisode(row: unknown): Episode | null {
  const record = toRecord(row);
  const localId = asString(record.local_id ?? record.id);
  if (!localId) return null;
  const podcastId = asString(record.podcast_local_id ?? record.podcastId);
  if (!podcastId) return null;
  const audioUrl = asString(record.audio_url ?? record.audioUrl);
  if (!audioUrl) return null;

  return {
    id: localId,
    podcastId,
    podcastTitle: asString(record.podcast_title ?? record.podcastTitle),
    title: asString(record.title),
    description: asOptionalString(record.description),
    audioUrl,
    websiteUrl: asOptionalString(record.website_url ?? record.websiteUrl),
    imageUrl: asOptionalString(record.image_url ?? record.imageUrl),
    publishedAt: asOptionalString(record.published_at ?? record.publishedAt) || nowIso(),
    durationSec: asNumber(record.duration_sec ?? record.durationSec),
    explicit: asBoolean(record.explicit),
    chapters: Array.isArray(record.chapters) ? (record.chapters as Episode['chapters']) : [],
    guid: asString(record.guid),
    enclosureLength: asNumber(record.enclosure_length ?? record.enclosureLength),
    sourceType: asEpisodeSourceType(record.source_type ?? record.sourceType),
    sourceUrl: asOptionalString(record.source_url ?? record.sourceUrl),
    externalId: asOptionalString(record.external_id ?? record.externalId),
    extractionStatus: asExtractionStatus(record.extraction_status ?? record.extractionStatus),
    createdAt: asOptionalString(record.created_at ?? record.createdAt) || nowIso(),
    updatedAt: asOptionalString(record.updated_at ?? record.updatedAt) || nowIso()
  };
}

function normalizeRemoteState(row: unknown): RemoteEpisodeState | null {
  const record = toRecord(row);
  const episodeId = asString(record.episode_local_id ?? record.episodeId);
  if (!episodeId) return null;

  return {
    episodeId,
    played: asBoolean(record.played),
	    playedAt: asOptionalString(record.played_at ?? record.playedAt),
    lastPlayedAt: asOptionalString(record.last_played_at ?? record.lastPlayedAt),
	    progressSec: asNumber(record.progress_sec ?? record.progressSec) || 0,
	    inboxState: asInboxState(record.inbox_state ?? record.inboxState),
	    inboxPosition: asNumber(record.inbox_position ?? record.inboxPosition),
	    queuedAt: asOptionalString(record.queued_at ?? record.queuedAt),
    queuePosition: asNumber(record.queue_position ?? record.queuePosition),
    downloaded: asBoolean(record.downloaded),
    downloadedAt: asOptionalString(record.downloaded_at ?? record.downloadedAt),
    favorite: asBoolean(record.favorite),
    deletedAt: asOptionalString(record.deleted_at ?? record.deletedAt),
    clipCount: asNumber(record.clip_count ?? record.clipCount) || 0,
    updatedAt: asOptionalString(record.updated_at ?? record.updatedAt) || nowIso()
	  };
	}

function normalizeRemotePodcastPreference(row: unknown): PodcastPreference | null {
  const record = toRecord(row);
  const podcastId = asString(record.podcast_local_id ?? record.podcastId);
  if (!podcastId) return null;
  const sortDirection = record.sort_direction ?? record.sortDirection;
  return {
    podcastId,
    playbackRate: asNumber(record.playback_rate ?? record.playbackRate),
    skipForwardSec: asNumber(record.skip_forward_sec ?? record.skipForwardSec),
    skipBackSec: asNumber(record.skip_back_sec ?? record.skipBackSec),
    skipIntroSec: asNumber(record.skip_intro_sec ?? record.skipIntroSec) ?? 0,
    skipOutroSec: asNumber(record.skip_outro_sec ?? record.skipOutroSec) ?? 0,
    silenceShortening: typeof (record.silence_shortening ?? record.silenceShortening) === 'boolean' ? Boolean(record.silence_shortening ?? record.silenceShortening) : undefined,
    smartSkipEnabled: typeof (record.smart_skip_enabled ?? record.smartSkipEnabled) === 'boolean' ? Boolean(record.smart_skip_enabled ?? record.smartSkipEnabled) : undefined,
    smartSkipCommercials: typeof (record.smart_skip_commercials ?? record.smartSkipCommercials ?? record.smart_skip_ads ?? record.smartSkipAds ?? record.smart_skip_sponsors ?? record.smartSkipSponsors ?? record.smart_skip_network_promos ?? record.smartSkipNetworkPromos) === 'boolean'
      ? Boolean(record.smart_skip_commercials ?? record.smartSkipCommercials ?? record.smart_skip_ads ?? record.smartSkipAds ?? record.smart_skip_sponsors ?? record.smartSkipSponsors ?? record.smart_skip_network_promos ?? record.smartSkipNetworkPromos)
      : undefined,
    smartSkipIntro: typeof (record.smart_skip_intro ?? record.smartSkipIntro) === 'boolean' ? Boolean(record.smart_skip_intro ?? record.smartSkipIntro) : undefined,
    smartSkipOutro: typeof (record.smart_skip_outro ?? record.smartSkipOutro) === 'boolean' ? Boolean(record.smart_skip_outro ?? record.smartSkipOutro) : undefined,
    smartSkipSelfPromos: typeof (record.smart_skip_self_promos ?? record.smartSkipSelfPromos) === 'boolean' ? Boolean(record.smart_skip_self_promos ?? record.smartSkipSelfPromos) : undefined,
    smartSkipSilence: typeof (record.smart_skip_silence ?? record.smartSkipSilence) === 'boolean' ? Boolean(record.smart_skip_silence ?? record.smartSkipSilence) : undefined,
    smartSkipIncludeSoftMatches: typeof (record.smart_skip_include_soft_matches ?? record.smartSkipIncludeSoftMatches ?? record.smart_skip_soft_skips ?? record.smartSkipSoftSkips) === 'boolean'
      ? Boolean(record.smart_skip_include_soft_matches ?? record.smartSkipIncludeSoftMatches ?? record.smart_skip_soft_skips ?? record.smartSkipSoftSkips)
      : undefined,
    sortDirection: sortDirection === 'oldest' ? 'oldest' : 'newest',
    addNewEpisodesToInbox: typeof (record.add_new_episodes_to_inbox ?? record.addNewEpisodesToInbox) === 'boolean' ? Boolean(record.add_new_episodes_to_inbox ?? record.addNewEpisodesToInbox) : true,
    updatedAt: asOptionalString(record.updated_at ?? record.updatedAt) || nowIso()
  };
}

function normalizeRemoteClip(row: unknown): Clip | null {
  const record = toRecord(row);
  const localId = asString(record.local_id ?? record.id);
  if (!localId) return null;
  const episodeId = asString(record.episode_local_id ?? record.episodeId);
  if (!episodeId) return null;
  const sourceAudioUrl = asString(record.source_audio_url ?? record.sourceAudioUrl);
  if (!sourceAudioUrl) return null;

  return {
    id: localId,
    episodeId,
    podcastTitle: asString(record.podcast_title ?? record.podcastTitle),
    episodeTitle: asString(record.episode_title ?? record.episodeTitle),
    sourceAudioUrl,
    startSec: asNumber(record.start_sec ?? record.startSec) || 0,
    endSec: asNumber(record.end_sec ?? record.endSec) || 0,
    title: asString(record.title),
    note: asOptionalString(record.note),
    publicUrl: asOptionalString(record.public_url ?? record.publicUrl),
    renderedAudioUrl: asOptionalString(record.rendered_audio_url ?? record.renderedAudioUrl),
    renderedVideoUrl: asOptionalString(record.rendered_video_url ?? record.renderedVideoUrl),
    renderStatus: asRenderStatus(record.render_status ?? record.renderStatus),
    renderError: asOptionalString(record.render_error ?? record.renderError),
    fileSizeBytes: asNumber(record.file_size_bytes ?? record.fileSizeBytes),
    createdAt: asOptionalString(record.created_at ?? record.createdAt) || nowIso(),
    updatedAt: asOptionalString(record.updated_at ?? record.updatedAt) || nowIso()
  };
}

function normalizeRemoteTombstone(row: Record<string, unknown>): SyncTombstone | null {
  const id = asString(row.id);
  const tableName = asTombstoneTable(row.table_name ?? row.tableName);
  const localId = asString(row.local_id ?? row.localId);
  if (!id || !tableName || !localId) return null;
  return {
    id,
    tableName,
    localId,
    deletedAt: asOptionalString(row.deleted_at ?? row.deletedAt) || nowIso(),
    pushedAt: asOptionalString(row.pushed_at ?? row.pushedAt)
  };
}

function pickedRemoteSettings(payload: unknown): RemoteSettingsPayload | null {
  return normalizeRemoteSettingsPayload(payload);
}

type RemoteSettingsPayload = Partial<AppSettings> & { updated_at?: string };

function normalizeRemoteSettingsPayload(payload: unknown): RemoteSettingsPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if ('settings' in record && typeof record.settings === 'object' && record.settings !== null) {
    return record.settings as RemoteSettingsPayload;
  }
  return record as RemoteSettingsPayload;
}

async function syncFeeds(local: Podcast[], remote: Podcast[], stats: MutableSyncStats) {
  const remoteMap = new Map(remote.map((row) => [row.id, row]));
  const toPull: Podcast[] = [];

  for (const feed of local) {
    const row = remoteMap.get(feed.id);
    if (row && isRemoteNewer(feed.updatedAt, row.updatedAt)) {
      toPull.push(row);
      stats.conflicts += 1;
    } else if (!row) {
      stats.pushed += 1;
    }
  }

  const localIds = new Set(local.map((feed) => feed.id));
  for (const row of remote) {
    if (!localIds.has(row.id)) {
      toPull.push(row);
      stats.conflicts += 1;
    }
  }

  if (toPull.length) {
    await db.feeds.bulkPut(toPull);
    stats.pulled += toPull.length;
  }
}

async function syncEpisodes(local: Episode[], remote: Episode[], stats: MutableSyncStats) {
  const remoteMap = new Map(remote.map((row) => [row.id, row]));
  const toPull: Episode[] = [];

  for (const episode of local) {
    const row = remoteMap.get(episode.id);
    if (row && isRemoteNewer(episode.updatedAt, row.updatedAt)) {
      toPull.push(row);
      stats.conflicts += 1;
    } else if (!row) {
      stats.pushed += 1;
    }
  }

  const localIds = new Set(local.map((episode) => episode.id));
  for (const row of remote) {
    if (!localIds.has(row.id)) {
      toPull.push(row);
      stats.conflicts += 1;
    }
  }

  if (toPull.length) {
    await db.episodes.bulkPut(toPull);
    stats.pulled += toPull.length;
  }
}

async function syncStates(local: EpisodeState[], remote: RemoteEpisodeState[], stats: MutableSyncStats, options: SyncOptions, pendingActions: SyncAction[] = []) {
  const remoteMap = new Map(remote.map((row) => [row.episodeId, hydrateRemoteEpisodeState(row)]));
  const latestPendingAction = latestActionByEntity(pendingActions);
  const toPull: EpisodeState[] = [];

  for (const state of local) {
    const row = remoteMap.get(state.episodeId);
    if (row && isRemoteNewer(state.updatedAt, row.updatedAt)) {
      const action = latestPendingAction.get(state.episodeId);
      if (action && shouldKeepPendingActionOverRemote(action.createdAt, row.updatedAt)) {
        stats.pushed += 1;
        continue;
      }
      toPull.push(mergeRemoteEpisodeState(state, row, options));
      stats.conflicts += 1;
    } else if (!row) {
      stats.pushed += 1;
    }
  }

  const localIds = new Set(local.map((state) => state.episodeId));
  for (const row of remote) {
    if (!localIds.has(row.episodeId)) {
      toPull.push(hydrateRemoteEpisodeState(row));
      stats.conflicts += 1;
    }
  }

  if (toPull.length) {
    await db.states.bulkPut(toPull);
    stats.pulled += toPull.length;
  }
}

export function shouldKeepPendingActionOverRemote(actionCreatedAt?: string, remoteUpdatedAt?: string | null): boolean {
  return isLocalNewer(actionCreatedAt, remoteUpdatedAt);
}

async function syncActions(localPending: SyncAction[], remote: SyncAction[], stats: MutableSyncStats, options: SyncOptions) {
  const localIds = new Set((await db.syncActions.toArray()).map((action) => action.id));
  const remoteToApply = remote
    .filter((action) => !localIds.has(action.id))
    .sort(compareActions);

  if (remoteToApply.length) {
    for (const action of remoteToApply) {
      await applyRemoteAction(action, options);
      await db.syncActions.put({ ...action, appliedAt: nowIso(), pushedAt: action.pushedAt || action.createdAt });
    }
    stats.pulled += remoteToApply.length;
  }

  if (localPending.length) stats.pushed += localPending.length;
}

async function applyRemoteAction(action: SyncAction, options: SyncOptions) {
  if (action.entityType !== 'episode_state') return;
  if (options.activePlaying && options.activeEpisodeId === action.entityId) return;
  const patch = action.payload.state;
  if (!patch) return;
  const current = await db.states.get(action.entityId);
  if (current && !isRemoteNewer(current.updatedAt, action.createdAt)) return;
  await db.states.put({
    ...current,
    ...hydrateRemoteEpisodeState({
      episodeId: action.entityId,
      played: Boolean(patch.played),
      playedAt: patch.playedAt,
      lastPlayedAt: patch.lastPlayedAt,
      progressSec: patch.progressSec || 0,
      inboxState: patch.inboxState || 'archived',
      inboxPosition: patch.inboxPosition,
      queuedAt: patch.queuedAt,
      queuePosition: patch.queuePosition,
      downloaded: false,
      downloadedAt: undefined,
      favorite: Boolean(patch.favorite),
      deletedAt: patch.deletedAt,
      clipCount: patch.clipCount || 0,
      updatedAt: patch.updatedAt || action.createdAt
    }),
    downloaded: current?.downloaded ?? false,
    downloadedAt: current?.downloadedAt,
    downloadPath: current?.downloadPath,
    downloadBytes: current?.downloadBytes,
    downloadBackend: current?.downloadBackend,
    downloadSource: current?.downloadSource,
    updatedAt: patch.updatedAt || action.createdAt
  });
}

function latestActionByEntity(actions: SyncAction[]): Map<string, SyncAction> {
  const map = new Map<string, SyncAction>();
  for (const action of actions) {
    const existing = map.get(action.entityId);
    if (!existing || compareActions(existing, action) < 0) map.set(action.entityId, action);
  }
  return map;
}

function compareActions(a: SyncAction, b: SyncAction): number {
  const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (byTime !== 0) return byTime;
  const bySequence = a.sequence - b.sequence;
  if (bySequence !== 0) return bySequence;
  return a.deviceId.localeCompare(b.deviceId);
}

async function markActionsPushed(actions: SyncAction[], pushedAt: string) {
  if (!actions.length) return;
  await db.syncActions.bulkPut(actions.map((action) => ({ ...action, pushedAt })));
}

export function mergeRemoteEpisodeState(local: EpisodeState, remote: EpisodeState, options: SyncOptions = {}): EpisodeState {
  const activeProgressSec = options.activeEpisodeId === local.episodeId ? options.activeProgressSec : undefined;
  const protectActivePlayback = options.activePlaying && options.activeEpisodeId === local.episodeId;
  // Keep device-local download metadata from the destination device on merges.
  const merged = {
    ...remote,
    downloaded: local.downloaded,
    downloadedAt: local.downloadedAt,
    downloadPath: local.downloadPath,
    downloadBytes: local.downloadBytes,
    downloadBackend: local.downloadBackend,
    downloadSource: local.downloadSource
  };
  if (!protectActivePlayback) return merged;
  return {
    ...merged,
    played: local.played,
    playedAt: local.playedAt,
    lastPlayedAt: local.lastPlayedAt,
    progressSec: Math.max(local.progressSec || 0, Math.floor(activeProgressSec || 0)),
    inboxState: local.inboxState,
    inboxPosition: local.inboxPosition,
    queuedAt: local.queuedAt,
    queuePosition: local.queuePosition,
    updatedAt: nowIso()
  };
}

function hydrateRemoteEpisodeState(remote: RemoteEpisodeState): EpisodeState {
  return {
    episodeId: remote.episodeId,
    played: remote.played,
    playedAt: remote.playedAt,
    lastPlayedAt: remote.lastPlayedAt,
	    progressSec: remote.progressSec,
	    inboxState: remote.inboxState,
	    inboxPosition: remote.inboxPosition,
	    queuedAt: remote.queuedAt,
    queuePosition: remote.queuePosition,
    downloaded: remote.downloaded ?? false,
    downloadedAt: remote.downloadedAt,
    downloadPath: undefined,
    downloadBytes: undefined,
    downloadBackend: undefined,
    downloadSource: undefined,
    favorite: remote.favorite,
    deletedAt: remote.deletedAt,
    clipCount: remote.clipCount,
    updatedAt: remote.updatedAt
	  };
	}

async function syncPodcastPreferences(local: PodcastPreference[], remote: PodcastPreference[], stats: MutableSyncStats) {
  const remoteMap = new Map(remote.map((row) => [row.podcastId, row]));
  const toPull: PodcastPreference[] = [];

  for (const preference of local) {
    const row = remoteMap.get(preference.podcastId);
    if (row && isRemoteNewer(preference.updatedAt, row.updatedAt)) {
      toPull.push(row);
      stats.conflicts += 1;
    } else if (!row) {
      stats.pushed += 1;
    }
  }

  const localIds = new Set(local.map((preference) => preference.podcastId));
  for (const row of remote) {
    if (!localIds.has(row.podcastId)) {
      toPull.push(row);
      stats.conflicts += 1;
    }
  }

  if (toPull.length) {
    await db.podcastPreferences.bulkPut(toPull);
    stats.pulled += toPull.length;
  }
}

async function syncClips(local: Clip[], remote: Clip[], stats: MutableSyncStats) {
  const remoteMap = new Map(remote.map((row) => [row.id, row]));
  const toPull: Clip[] = [];

  for (const clip of local) {
    const row = remoteMap.get(clip.id);
    if (row && isRemoteNewer(clip.updatedAt, row.updatedAt)) {
      toPull.push(row);
      stats.conflicts += 1;
    } else if (!row) {
      stats.pushed += 1;
    }
  }

  const localIds = new Set(local.map((clip) => clip.id));
  for (const row of remote) {
    if (!localIds.has(row.id)) {
      toPull.push(row);
      stats.conflicts += 1;
    }
  }

  if (toPull.length) {
    await db.clips.bulkPut(toPull);
    stats.pulled += toPull.length;
  }
}

async function syncSettings(local: AppSettings, remote: RemoteSettingsPayload | null, stats: MutableSyncStats) {
  const remoteUpdated = remote?.updated_at || remote?.updatedAt;
  if (!remote || !remoteUpdated) {
    stats.pushed += 1;
    return;
  }

  if (isLocalNewer(local.updatedAt, remoteUpdated)) {
    stats.pushed += 1;
    return;
  }

  if (isRemoteNewer(local.updatedAt, remoteUpdated)) {
    await saveSettings({
      ...local,
      ...remote,
      id: 'local',
      serverUrl: local.serverUrl,
      nativeAudioPreferred: local.nativeAudioPreferred,
      updatedAt: remoteUpdated
    });
    stats.pulled += 1;
    stats.conflicts += 1;
  }
}

async function syncTombstones(local: SyncTombstone[], remote: SyncTombstone[], stats: MutableSyncStats) {
  const pushTimestamp = nowIso();
  const localToPush = local.filter((item) => !item.pushedAt);
  if (localToPush.length) {
    await db.tombstones.bulkPut(localToPush.map((item) => ({ ...item, pushedAt: pushTimestamp })));
    stats.pushed += localToPush.length;
  }

  const localIds = new Set(local.map((item) => item.id));
  const toPull = remote.filter((item) => !localIds.has(item.id));
  if (toPull.length) {
    await db.tombstones.bulkPut(toPull);
    await applyTombstones(toPull);
    stats.pulled += toPull.length;
  }
}

async function applyTombstones(tombstones: SyncTombstone[]) {
  for (const tombstone of tombstones) {
    if (tombstone.tableName === 'subscriptions') await db.feeds.delete(tombstone.localId);
    if (tombstone.tableName === 'episodes') await db.episodes.delete(tombstone.localId);
    if (tombstone.tableName === 'episode_states') await db.states.delete(tombstone.localId);
    if (tombstone.tableName === 'clips') await db.clips.delete(tombstone.localId);
  }
}

interface MutableSyncStats {
  pushed: number;
  pulled: number;
  conflicts: number;
}

function isRemoteNewer(localUpdatedAt?: string, remoteUpdatedAt?: string | null): boolean {
  return new Date(remoteUpdatedAt || 0).getTime() > new Date(localUpdatedAt || 0).getTime();
}

function isLocalNewer(localUpdatedAt?: string, remoteUpdatedAt?: string | null): boolean {
  return new Date(localUpdatedAt || 0).getTime() >= new Date(remoteUpdatedAt || 0).getTime();
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return Boolean(value);
}

function asInboxState(value: unknown): EpisodeState['inboxState'] {
  if (value === 'new' || value === 'dismissed' || value === 'archived') return value;
  if (value === 'queued') return 'archived';
  return 'archived';
}

function asRenderStatus(value: unknown): Clip['renderStatus'] | undefined {
  if (
    value === 'local-only' ||
    value === 'queued' ||
    value === 'pending' ||
    value === 'rendering' ||
    value === 'ready' ||
    value === 'rendered' ||
    value === 'failed' ||
    value === 'range-link' ||
    value === 'time-range-only'
  ) {
    return value;
  }
  return undefined;
}

function asPodcastSourceType(value: unknown): Podcast['sourceType'] {
  if (value === 'youtube-channel' || value === 'youtube-playlist' || value === 'youtube-ad-hoc') return value;
  if (value === 'rss') return 'rss';
  return undefined;
}

function asEpisodeSourceType(value: unknown): Episode['sourceType'] {
  if (value === 'youtube') return 'youtube';
  if (value === 'rss') return 'rss';
  return undefined;
}

function asExtractionStatus(value: unknown): Episode['extractionStatus'] {
  if (value === 'queued' || value === 'processing' || value === 'ready' || value === 'failed' || value === 'none') return value;
  return undefined;
}

function asTombstoneTable(value: unknown): TombstoneTable | undefined {
  if (value === 'subscriptions' || value === 'episodes' || value === 'episode_states' || value === 'clips') return value;
  return undefined;
}

async function parseSyncError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `Sync failed with status ${response.status}.`;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || text;
  } catch {
    return text;
  }
}
