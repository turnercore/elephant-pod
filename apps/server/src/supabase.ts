import { createClient } from '@supabase/supabase-js';
import type { ServerClip } from './types.js';

export function getServerSupabase() {
  return createServerSupabaseClient('service');
}

export function getServerSupabaseWithMode(mode: 'service' | 'anon') {
  return createServerSupabaseClient(mode);
}

export function getServerSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  return {
    supabaseUrl,
    hasServiceRoleKey: Boolean(serviceRoleKey),
    hasAnonKey: Boolean(anonKey)
  };
}

function createServerSupabaseClient(mode: 'service' | 'anon') {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const key = mode === 'service' ? serviceRoleKey || anonKey : anonKey;

  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: mode === 'anon' ? 'implicit' : 'pkce'
    }
  });
}

export async function publishClipToSupabase(clip: ServerClip): Promise<void> {
  const client = getServerSupabase();
  if (!client) return;
  await client.from('public_clips').upsert({
    id: clip.id,
    title: clip.title,
    note: clip.note,
    podcast_title: clip.podcastTitle,
    episode_title: clip.episodeTitle,
    source_audio_url: clip.sourceAudioUrl,
    start_sec: clip.startSec,
    end_sec: clip.endSec,
    public_url: clip.publicUrl,
    rendered_audio_url: clip.renderedAudioUrl,
    rendered_video_url: clip.renderedVideoUrl,
    render_status: clip.renderStatus,
    render_error: clip.renderError,
    file_size_bytes: clip.fileSizeBytes,
    created_at: clip.createdAt,
    updated_at: clip.updatedAt
  });
}
