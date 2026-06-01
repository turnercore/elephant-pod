import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { ServerClip } from './types.js';

type AllowedTable = 'subscriptions' | 'episodes' | 'episode_states' | 'podcast_preferences' | 'user_settings' | 'clips' | 'sync_tombstones' | 'public_clips';

const TABLE_CONFLICTS: Record<AllowedTable, string[]> = {
  subscriptions: ['user_id', 'local_id'],
  episodes: ['user_id', 'local_id'],
  episode_states: ['user_id', 'episode_local_id'],
  podcast_preferences: ['user_id', 'podcast_local_id'],
  user_settings: ['user_id'],
  clips: ['user_id', 'local_id'],
  sync_tombstones: ['id'],
  public_clips: ['id']
};

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

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function assertAllowedTable(table: string): table is AllowedTable {
  return table in TABLE_CONFLICTS;
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

export async function selectAll<T>(table: string, userId: string): Promise<T[]> {
  if (!assertAllowedTable(table)) throw new Error(`Unsupported table: ${table}`);
  return (
    (await withClient(async (client) => {
      const result = await client.query(`select * from ${quoteIdentifier(table)} where user_id = $1`, [userId]);
      return result.rows as T[];
    })) || []
  );
}

export async function selectSettings<T>(userId: string): Promise<T | null> {
  return (
    (await withClient(async (client) => {
      const result = await client.query(`select settings, updated_at from public.user_settings where user_id = $1 limit 1`, [userId]);
      return (result.rows[0] as T | undefined) ?? null;
    })) || null
  );
}

export async function upsertRows(table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  if (!assertAllowedTable(table)) throw new Error(`Unsupported table: ${table}`);

  await withClient(async (client) => {
    const conflictColumns = TABLE_CONFLICTS[table];
    const columns = Array.from(
      new Set(
        rows.flatMap((row) => Object.keys(row).filter((column) => !column.startsWith('__')))
      )
    );
    if (!columns.length) return;

    const values: unknown[] = [];
    const placeholders = rows
      .map((row, rowIndex) => {
        const inner = columns.map((column) => {
          values.push(row[column] === undefined ? null : row[column]);
          return `$${values.length}`;
        });
        void rowIndex;
        return `(${inner.join(', ')})`;
      })
      .join(', ');

    const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
    const insertSql = `insert into ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) values ${placeholders}`;
    const conflictSql = `on conflict (${conflictColumns.map(quoteIdentifier).join(', ')}) do update set ${updateColumns
      .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
      .join(', ')}`;
    const sql = updateColumns.length ? `${insertSql} ${conflictSql}` : `${insertSql} on conflict do nothing`;
    await client.query(sql, values);
  });
}

export async function upsertPublicClip(clip: ServerClip): Promise<void> {
  await upsertRows('public_clips', [
    {
      id: clip.id,
      title: clip.title,
      note: clip.note ?? null,
      podcast_title: clip.podcastTitle,
      episode_title: clip.episodeTitle,
      source_audio_url: clip.sourceAudioUrl,
      start_sec: clip.startSec,
      end_sec: clip.endSec,
      public_url: clip.publicUrl ?? null,
      rendered_audio_url: clip.renderedAudioUrl ?? null,
      rendered_video_url: clip.renderedVideoUrl ?? null,
      render_status: clip.renderStatus ?? null,
      render_error: clip.renderError ?? null,
      file_size_bytes: clip.fileSizeBytes ?? null,
      created_at: clip.createdAt,
      updated_at: clip.updatedAt
    }
  ]);
}
