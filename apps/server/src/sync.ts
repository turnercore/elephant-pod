import type { Response, Request } from 'express';
import { z } from 'zod';
import { getAuthContext } from './auth.js';
import { getServerSupabase } from './supabase.js';

const inboxStateEnum = z.enum(['new', 'queued', 'dismissed', 'archived']);
const clipRenderStatusEnum = z.enum([
  'local-only',
  'pending',
  'queued',
  'rendering',
  'ready',
  'rendered',
  'failed',
  'range-link',
  'time-range-only'
]);

const tombstoneTableEnum = z.enum(['subscriptions', 'episodes', 'episode_states', 'clips']);
const optionalUrlSchema = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());

const syncFeedSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().optional(),
  description: z.string().optional(),
  imageUrl: optionalUrlSchema,
  feedUrl: z.string().url(),
  websiteUrl: optionalUrlSchema,
  tags: z.array(z.string()).default([]),
  lastRefreshedAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const syncEpisodeSchema = z.object({
  id: z.string().min(1),
  podcastId: z.string().min(1),
  podcastTitle: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  audioUrl: z.string().url(),
  websiteUrl: optionalUrlSchema,
  imageUrl: optionalUrlSchema,
  publishedAt: z.string().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  explicit: z.boolean().optional(),
  chapters: z.array(z.unknown()).default([]),
  guid: z.string().min(1),
  enclosureLength: z.number().nonnegative().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const syncStateSchema = z.object({
  episodeId: z.string().min(1),
  played: z.boolean(),
  playedAt: z.string().optional(),
  progressSec: z.number().nonnegative(),
  inboxState: inboxStateEnum,
  queuedAt: z.string().optional(),
  queuePosition: z.number().int().nonnegative().nullable().optional(),
  downloaded: z.boolean(),
  downloadedAt: z.string().optional(),
  favorite: z.boolean(),
  deletedAt: z.string().optional(),
  clipCount: z.number().int().nonnegative(),
  updatedAt: z.string().optional(),
  downloadPath: z.string().optional(),
  downloadBytes: z.number().optional(),
  downloadBackend: z.enum(['browser-cache', 'tauri-filesystem']).optional()
});

const syncClipSchema = z.object({
  id: z.string().min(1),
  episodeId: z.string().min(1),
  podcastTitle: z.string().min(1),
  episodeTitle: z.string().min(1),
  sourceAudioUrl: z.string().url(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  title: z.string().min(1),
  note: z.string().optional(),
  publicUrl: optionalUrlSchema,
  renderedAudioUrl: optionalUrlSchema,
  renderedVideoUrl: optionalUrlSchema,
  renderStatus: clipRenderStatusEnum.optional(),
  renderError: z.string().optional(),
  fileSizeBytes: z.number().nonnegative().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const syncTombstoneSchema = z.object({
  id: z.string().min(1),
  tableName: tombstoneTableEnum,
  localId: z.string().min(1),
  deletedAt: z.string(),
  pushedAt: z.string().optional()
});

const syncSettingsSchema = z.record(z.unknown()).default({});

const syncRequestSchema = z.object({
  version: z.number().int().positive().default(2),
  deviceId: z.string().optional(),
  feeds: z.array(syncFeedSchema).default([]),
  episodes: z.array(syncEpisodeSchema).default([]),
  states: z.array(syncStateSchema).default([]),
  clips: z.array(syncClipSchema).default([]),
  tombstones: z.array(syncTombstoneSchema).default([]),
  settings: syncSettingsSchema
});

const syncErrorMessages = {
  missingServer: 'Server sync requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.',
  invalidPayload: 'Invalid sync payload.',
  missingAuth: 'Authentication failed for sync.'
};

type SyncFeed = z.infer<typeof syncFeedSchema>;
type SyncEpisode = z.infer<typeof syncEpisodeSchema>;
type SyncState = z.infer<typeof syncStateSchema>;
type SyncClip = z.infer<typeof syncClipSchema>;
type SyncTombstone = z.infer<typeof syncTombstoneSchema>;
type SyncSettings = z.infer<typeof syncSettingsSchema>;
type SyncStatePush = Omit<SyncState, 'downloaded' | 'downloadedAt' | 'downloadPath' | 'downloadBytes' | 'downloadBackend'>;
type RemotePulledState = Omit<SyncState, 'downloaded' | 'downloadedAt' | 'downloadPath' | 'downloadBytes' | 'downloadBackend'>;

type SyncResponse = {
  pushed: number;
  pulled: number;
  conflicts: number;
  message: string;
  pulledData: {
    feeds: SyncFeed[];
    episodes: SyncEpisode[];
    states: RemotePulledState[];
    clips: SyncClip[];
    settings: SyncSettings | null;
    tombstones: SyncTombstone[];
  };
  serverTime: string;
};

type RemoteSubscription = {
  local_id: string;
  title: string;
  author: string | null;
  description: string | null;
  image_url: string | null;
  feed_url: string;
  website_url: string | null;
  tags: string[] | null;
  last_refreshed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type RemoteEpisode = {
  local_id: string;
  podcast_local_id: string;
  podcast_title: string;
  title: string;
  description: string | null;
  audio_url: string;
  website_url: string | null;
  image_url: string | null;
  published_at: string | null;
  duration_sec: number | null;
  explicit: boolean | null;
  chapters: unknown[] | null;
  guid: string;
  enclosure_length: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type RemoteState = {
  episode_local_id: string;
  played: boolean;
  played_at: string | null;
  progress_sec: number;
  inbox_state: 'new' | 'queued' | 'dismissed' | 'archived';
  queued_at: string | null;
  queue_position: number | null;
  favorite: boolean;
  deleted_at: string | null;
  clip_count: number;
  updated_at: string | null;
};

type RemoteClip = {
  local_id: string;
  episode_local_id: string;
  podcast_title: string;
  episode_title: string;
  source_audio_url: string;
  start_sec: number;
  end_sec: number;
  title: string;
  note: string | null;
  public_url: string | null;
  rendered_audio_url: string | null;
  rendered_video_url: string | null;
  render_status: string | null;
  render_error: string | null;
  file_size_bytes: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type RemoteTombstone = {
  id: string;
  table_name: 'subscriptions' | 'episodes' | 'episode_states' | 'clips';
  local_id: string;
  deleted_at: string;
  pushed_at: string | null;
};

type RemoteSettings = {
  settings: SyncSettings;
  updated_at: string | null;
};

interface MutableSyncStats {
  pushed: number;
  pulled: number;
  conflicts: number;
}

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

function isTableMissing(error: unknown): boolean {
  return (error as { code?: string }).code === '42P01';
}

function nowIso() {
  return new Date().toISOString();
}

function isRemoteNewer(localUpdatedAt: string | undefined, remoteUpdatedAt: string | null | undefined): boolean {
  return new Date(remoteUpdatedAt || 0).getTime() > new Date(localUpdatedAt || 0).getTime();
}

function isLocalNewer(localUpdatedAt: string | undefined, remoteUpdatedAt: string | null | undefined): boolean {
  return new Date(localUpdatedAt || 0).getTime() >= new Date(remoteUpdatedAt || 0).getTime();
}

async function selectAll<T>(client: ServerSupabaseClient, table: string, userId: string): Promise<T[]> {
  const { data, error } = await client.from(table).select('*').eq('user_id', userId);
  if (error) {
    if (isTableMissing(error)) throw error;
    throw error;
  }
  return ((data || []) as T[]) || [];
}

async function selectSettings(client: ServerSupabaseClient, userId: string): Promise<RemoteSettings | null> {
  const { data, error } = await client.from('user_settings').select('settings, updated_at').eq('user_id', userId).maybeSingle();
  if (error) {
    if (isTableMissing(error)) return null;
    throw error;
  }
  return (data as RemoteSettings | null) || null;
}

async function upsert(client: ServerSupabaseClient, table: string, rows: unknown[], onConflict: string, stats: MutableSyncStats) {
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows, { onConflict });
  if (error) throw error;
  stats.pushed += rows.length;
}

function sanitizeSettings(input: SyncSettings): SyncSettings {
  const { downloadPath, downloadBytes, downloadBackend, supabaseUrl, supabaseAnonKey, ...rest } = input as Record<
    string,
    unknown
  >;
  void downloadPath;
  void downloadBytes;
  void downloadBackend;
  void supabaseUrl;
  void supabaseAnonKey;
  return rest;
}

async function syncFeeds(
  client: ServerSupabaseClient,
  userId: string,
  local: SyncFeed[],
  remote: RemoteSubscription[],
  stats: MutableSyncStats,
  pulledFeeds: SyncFeed[]
) {
  const remoteMap = new Map(remote.map((row) => [row.local_id, row]));
  const toPush: ReturnType<typeof toRemoteFeed>[] = [];
  for (const feed of local) {
    const row = remoteMap.get(feed.id);
    if (!row || isLocalNewer(feed.updatedAt, row.updated_at)) toPush.push(toRemoteFeed(userId, feed));
    else if (isRemoteNewer(feed.updatedAt, row.updated_at)) {
      pulledFeeds.push(fromRemoteFeed(row));
      stats.pulled += 1;
      stats.conflicts += 1;
    }
  }
  const localIds = new Set(local.map((feed) => feed.id));
  for (const row of remote) {
    if (localIds.has(row.local_id)) continue;
    pulledFeeds.push(fromRemoteFeed(row));
    stats.pulled += 1;
  }

  await upsert(client, 'subscriptions', toPush, 'user_id,local_id', stats);
}

function stripDeviceDownloadFields(state: SyncState): SyncStatePush {
  const { downloaded, downloadedAt, downloadPath, downloadBytes, downloadBackend, ...rest } = state;
  void downloaded;
  void downloadedAt;
  void downloadPath;
  void downloadBytes;
  void downloadBackend;
  return rest;
}

async function syncEpisodes(
  client: ServerSupabaseClient,
  userId: string,
  local: SyncEpisode[],
  remote: RemoteEpisode[],
  stats: MutableSyncStats,
  pulledEpisodes: SyncEpisode[]
) {
  const remoteMap = new Map(remote.map((row) => [row.local_id, row]));
  const toPush: ReturnType<typeof toRemoteEpisode>[] = [];
  for (const episode of local) {
    const row = remoteMap.get(episode.id);
    if (!row || isLocalNewer(episode.updatedAt, row.updated_at)) toPush.push(toRemoteEpisode(userId, episode));
    else if (isRemoteNewer(episode.updatedAt, row.updated_at)) {
      pulledEpisodes.push(fromRemoteEpisode(row));
      stats.pulled += 1;
      stats.conflicts += 1;
    }
  }
  const localIds = new Set(local.map((episode) => episode.id));
  for (const row of remote) {
    if (localIds.has(row.local_id)) continue;
    pulledEpisodes.push(fromRemoteEpisode(row));
    stats.pulled += 1;
  }

  await upsert(client, 'episodes', toPush, 'user_id,local_id', stats);
}

async function syncStates(
  client: ServerSupabaseClient,
  userId: string,
  local: SyncStatePush[],
  remote: RemoteState[],
  stats: MutableSyncStats,
  pulledStates: RemotePulledState[]
) {
  const remoteMap = new Map(remote.map((row) => [row.episode_local_id, row]));
  const toPush: ReturnType<typeof toRemoteState>[] = [];
  for (const state of local) {
    const row = remoteMap.get(state.episodeId);
    if (!row || isLocalNewer(state.updatedAt, row.updated_at)) toPush.push(toRemoteState(userId, state));
    else if (isRemoteNewer(state.updatedAt, row.updated_at)) {
      pulledStates.push(fromRemoteState(row));
      stats.pulled += 1;
      stats.conflicts += 1;
    }
  }
  const localIds = new Set(local.map((state) => state.episodeId));
  for (const row of remote) {
    if (localIds.has(row.episode_local_id)) continue;
    pulledStates.push(fromRemoteState(row));
    stats.pulled += 1;
  }

  await upsert(client, 'episode_states', toPush, 'user_id,episode_local_id', stats);
}

async function syncClips(
  client: ServerSupabaseClient,
  userId: string,
  local: SyncClip[],
  remote: RemoteClip[],
  stats: MutableSyncStats,
  pulledClips: SyncClip[]
) {
  const remoteMap = new Map(remote.map((row) => [row.local_id, row]));
  const toPush: ReturnType<typeof toRemoteClip>[] = [];
  for (const clip of local) {
    const row = remoteMap.get(clip.id);
    if (!row || isLocalNewer(clip.updatedAt, row.updated_at)) toPush.push(toRemoteClip(userId, clip));
    else if (isRemoteNewer(clip.updatedAt, row.updated_at)) {
      pulledClips.push(fromRemoteClip(row));
      stats.pulled += 1;
      stats.conflicts += 1;
    }
  }
  const localIds = new Set(local.map((clip) => clip.id));
  for (const row of remote) {
    if (localIds.has(row.local_id)) continue;
    pulledClips.push(fromRemoteClip(row));
    stats.pulled += 1;
  }

  await upsert(client, 'clips', toPush, 'user_id,local_id', stats);
}

async function syncSettings(
  client: ServerSupabaseClient,
  userId: string,
  local: SyncSettings,
  remote: RemoteSettings | null,
  stats: MutableSyncStats,
  now: string
): Promise<{ remoteSettings: SyncSettings | null; pulled: boolean }> {
  const localUpdatedAt = (local as { updatedAt?: unknown }).updatedAt;
  const normalizedLocalUpdatedAt = typeof localUpdatedAt === 'string' ? localUpdatedAt : now;
  const localSanitized = sanitizeSettings(local);

  if (!remote || isLocalNewer(normalizedLocalUpdatedAt, remote.updated_at)) {
    await upsert(client, 'user_settings', [{ user_id: userId, settings: localSanitized, updated_at: normalizedLocalUpdatedAt }], 'user_id', stats);
    return { remoteSettings: null, pulled: false };
  }
  if (isRemoteNewer(normalizedLocalUpdatedAt, remote.updated_at)) {
    stats.conflicts += 1;
    stats.pulled += 1;
    return { remoteSettings: remote.settings, pulled: true };
  }
  return { remoteSettings: null, pulled: false };
}

async function syncTombstones(
  client: ServerSupabaseClient,
  userId: string,
  local: SyncTombstone[],
  remote: RemoteTombstone[],
  stats: MutableSyncStats,
  pulled: SyncTombstone[]
) {
  const now = nowIso();
  const toPush = local
    .filter((item) => !item.pushedAt)
    .map((item) => ({
      id: item.id,
      user_id: userId,
      table_name: item.tableName,
      local_id: item.localId,
      deleted_at: item.deletedAt,
      pushed_at: now
    }));

  const localIds = new Set(local.map((item) => item.id));
  const toPull = remote.filter((item) => !localIds.has(item.id));
  if (toPull.length) {
    stats.pulled += toPull.length;
    pulled.push(
      ...toPull.map((row) => ({
        id: row.id,
        tableName: row.table_name,
        localId: row.local_id,
        deletedAt: row.deleted_at,
        pushedAt: row.pushed_at || undefined
      }))
    );
  }

  if (!toPush.length) return;
  await upsert(client, 'sync_tombstones', toPush, 'id', stats);
}

function toRemoteFeed(userId: string, feed: SyncFeed) {
  return {
    user_id: userId,
    local_id: feed.id,
    title: feed.title,
    author: feed.author,
    description: feed.description,
    image_url: feed.imageUrl,
    feed_url: feed.feedUrl,
    website_url: feed.websiteUrl,
    tags: feed.tags,
    last_refreshed_at: feed.lastRefreshedAt,
    created_at: feed.createdAt,
    updated_at: feed.updatedAt
  };
}

function toRemoteEpisode(userId: string, episode: SyncEpisode) {
  return {
    user_id: userId,
    local_id: episode.id,
    podcast_local_id: episode.podcastId,
    podcast_title: episode.podcastTitle,
    title: episode.title,
    description: episode.description,
    audio_url: episode.audioUrl,
    website_url: episode.websiteUrl,
    image_url: episode.imageUrl,
    published_at: episode.publishedAt,
    duration_sec: episode.durationSec,
    explicit: episode.explicit,
    chapters: episode.chapters,
    guid: episode.guid,
    enclosure_length: episode.enclosureLength,
    created_at: episode.createdAt,
    updated_at: episode.updatedAt
  };
}

function toRemoteState(userId: string, state: SyncStatePush) {
  return {
    user_id: userId,
    episode_local_id: state.episodeId,
    played: state.played,
    played_at: state.playedAt,
    progress_sec: state.progressSec,
    inbox_state: state.inboxState,
    queued_at: state.queuedAt,
    queue_position: state.queuePosition,
    favorite: state.favorite,
    deleted_at: state.deletedAt,
    clip_count: state.clipCount,
    updated_at: state.updatedAt
  };
}

function toRemoteClip(userId: string, clip: SyncClip) {
  return {
    user_id: userId,
    local_id: clip.id,
    episode_local_id: clip.episodeId,
    podcast_title: clip.podcastTitle,
    episode_title: clip.episodeTitle,
    source_audio_url: clip.sourceAudioUrl,
    start_sec: clip.startSec,
    end_sec: clip.endSec,
    title: clip.title,
    note: clip.note,
    public_url: clip.publicUrl,
    rendered_audio_url: clip.renderedAudioUrl,
    rendered_video_url: clip.renderedVideoUrl,
    render_status: clip.renderStatus,
    render_error: clip.renderError,
    file_size_bytes: clip.fileSizeBytes,
    created_at: clip.createdAt,
    updated_at: clip.updatedAt
  };
}

function fromRemoteFeed(row: RemoteSubscription): SyncFeed {
  return {
    id: row.local_id,
    title: row.title,
    author: row.author || undefined,
    description: row.description || undefined,
    imageUrl: row.image_url || undefined,
    feedUrl: row.feed_url,
    websiteUrl: row.website_url || undefined,
    tags: row.tags || [],
    lastRefreshedAt: row.last_refreshed_at || undefined,
    createdAt: row.created_at || row.updated_at || nowIso(),
    updatedAt: row.updated_at || nowIso()
  };
}

function fromRemoteEpisode(row: RemoteEpisode): SyncEpisode {
  return {
    id: row.local_id,
    podcastId: row.podcast_local_id,
    podcastTitle: row.podcast_title,
    title: row.title,
    description: row.description || undefined,
    audioUrl: row.audio_url,
    websiteUrl: row.website_url || undefined,
    imageUrl: row.image_url || undefined,
    publishedAt: row.published_at || nowIso(),
    durationSec: row.duration_sec ?? undefined,
    explicit: row.explicit ?? false,
    chapters: row.chapters || [],
    guid: row.guid,
    enclosureLength: row.enclosure_length ?? undefined,
    createdAt: row.created_at || row.updated_at || nowIso(),
    updatedAt: row.updated_at || nowIso()
  };
}

function fromRemoteState(row: RemoteState): RemotePulledState {
  return {
    episodeId: row.episode_local_id,
    played: row.played,
    playedAt: row.played_at || undefined,
    progressSec: row.progress_sec,
    inboxState: row.inbox_state,
    queuedAt: row.queued_at || undefined,
    queuePosition: row.queue_position ?? undefined,
    favorite: row.favorite,
    deletedAt: row.deleted_at || undefined,
    clipCount: row.clip_count,
    updatedAt: row.updated_at || nowIso()
  };
}

function fromRemoteClip(row: RemoteClip): SyncClip {
  return {
    id: row.local_id,
    episodeId: row.episode_local_id,
    podcastTitle: row.podcast_title,
    episodeTitle: row.episode_title,
    sourceAudioUrl: row.source_audio_url,
    startSec: row.start_sec,
    endSec: row.end_sec,
    title: row.title,
    note: row.note || undefined,
    publicUrl: row.public_url || undefined,
    renderedAudioUrl: row.rendered_audio_url || undefined,
    renderedVideoUrl: row.rendered_video_url || undefined,
    renderStatus: row.render_status as SyncClip['renderStatus'],
    renderError: row.render_error || undefined,
    fileSizeBytes: row.file_size_bytes || undefined,
    createdAt: row.created_at || row.updated_at || nowIso(),
    updatedAt: row.updated_at || nowIso()
  };
}

export async function syncHandler(req: Request, res: Response) {
  const context = getAuthContext(res);
  if (!context) {
    res.status(401).json({ error: syncErrorMessages.missingAuth });
    return;
  }

  const parsed = syncRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: syncErrorMessages.invalidPayload, details: parsed.error.flatten() });
    return;
  }

    const client = getServerSupabase() as ServerSupabaseClient | null;
  if (!client) {
    res.status(503).json({ error: syncErrorMessages.missingServer });
    return;
  }

  const payload = parsed.data;
  const pullResult = {
    feeds: [] as SyncFeed[],
    episodes: [] as SyncEpisode[],
    states: [] as RemotePulledState[],
    clips: [] as SyncClip[],
    settings: null as SyncSettings | null,
    tombstones: [] as SyncTombstone[]
  };

  const stats: MutableSyncStats = { pushed: 0, pulled: 0, conflicts: 0 };

  const now = nowIso();

  try {
    const [remoteFeeds, remoteEpisodes, remoteStates, remoteClips, remoteTombstones, remoteSettings] = await Promise.all([
      selectAll<RemoteSubscription>(client, 'subscriptions', context.userId),
      selectAll<RemoteEpisode>(client, 'episodes', context.userId),
      selectAll<RemoteState>(client, 'episode_states', context.userId),
      selectAll<RemoteClip>(client, 'clips', context.userId),
      selectAll<RemoteTombstone>(client, 'sync_tombstones', context.userId),
      selectSettings(client, context.userId)
    ]);

    await Promise.all([
      syncFeeds(client, context.userId, payload.feeds, remoteFeeds, stats, pullResult.feeds),
      syncEpisodes(client, context.userId, payload.episodes, remoteEpisodes, stats, pullResult.episodes),
      syncStates(
        client,
        context.userId,
        payload.states.map(stripDeviceDownloadFields),
        remoteStates,
        stats,
        pullResult.states
      ),
      syncClips(client, context.userId, payload.clips, remoteClips, stats, pullResult.clips)
    ]);

    const settingsResult = await syncSettings(client, context.userId, payload.settings, remoteSettings, stats, now);
    if (settingsResult.remoteSettings) pullResult.settings = settingsResult.remoteSettings;

    await syncTombstones(client, context.userId, payload.tombstones, remoteTombstones, stats, pullResult.tombstones);
  } catch (error) {
    if (isTableMissing(error)) {
      res.status(503).json({
        error: 'Sync tables are not initialized. Apply the Elephant Ears schema in your Supabase project.',
        details: error
      });
      return;
    }
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Sync failed.',
      details: error
    });
    return;
  }

  const response: SyncResponse = {
    pushed: stats.pushed,
    pulled: stats.pulled,
    conflicts: stats.conflicts,
    message: `Sync complete. pushed=${stats.pushed}, pulled=${stats.pulled}, conflicts=${stats.conflicts}.`,
    pulledData: pullResult,
    serverTime: now
  };

  res.json(response);
}
