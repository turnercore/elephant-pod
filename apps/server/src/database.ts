import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { ServerClip } from './types.js';

let pool: Pool | null = null;

function readStringEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasDatabaseUrl() {
  return Boolean(readStringEnv('DATABASE_URL'));
}

function getPool() {
  if (!hasDatabaseUrl()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: readStringEnv('DATABASE_URL')
    });
  }
  return pool;
}

async function withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T | null> {
  const db = getPool();
  if (!db) return null;
  const client = await db.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export function hasLocalDatabase() {
  return hasDatabaseUrl();
}

export async function queryDatabase<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[] | null> {
  return withClient(async (client) => {
    const result = await client.query(sql, values);
    return result.rows as T[];
  });
}

export async function withDatabaseTransaction<T>(callback: (query: <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T | null> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      const result = await callback(async <Row extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => {
        const queryResult = await client.query<Row>(sql, values);
        return queryResult.rows;
      });
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

export async function upsertPublicClip(clip: ServerClip): Promise<void> {
  await queryDatabase(
    `insert into public.public_clips (
      id,
      title,
      note,
      podcast_title,
      episode_title,
      source_audio_url,
      start_sec,
      end_sec,
      public_url,
      rendered_audio_url,
      rendered_video_url,
      render_status,
      render_error,
      file_size_bytes,
      created_at,
      updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16
    )
    on conflict (id) do update set
      title = excluded.title,
      note = excluded.note,
      podcast_title = excluded.podcast_title,
      episode_title = excluded.episode_title,
      source_audio_url = excluded.source_audio_url,
      start_sec = excluded.start_sec,
      end_sec = excluded.end_sec,
      public_url = excluded.public_url,
      rendered_audio_url = excluded.rendered_audio_url,
      rendered_video_url = excluded.rendered_video_url,
      render_status = excluded.render_status,
      render_error = excluded.render_error,
      file_size_bytes = excluded.file_size_bytes,
      updated_at = excluded.updated_at`,
    [
      clip.id,
      clip.title,
      clip.note ?? null,
      clip.podcastTitle,
      clip.episodeTitle,
      clip.sourceAudioUrl,
      clip.startSec,
      clip.endSec,
      clip.publicUrl ?? null,
      clip.renderedAudioUrl ?? null,
      clip.renderedVideoUrl ?? null,
      clip.renderStatus ?? null,
      clip.renderError ?? null,
      clip.fileSizeBytes ?? null,
      clip.createdAt,
      clip.updatedAt
    ]
  );
}
