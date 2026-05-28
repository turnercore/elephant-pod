import { createClient } from '@supabase/supabase-js';
import type { ServerClip } from './types.js';

const placeholderPattern = /^(CHANGE_ME|REPLACE_ME|TODO|PLACEHOLDER)/i;

function readStringEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasRealEnvValue(value?: string) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !placeholderPattern.test(trimmed);
}

function readBooleanEnv(name: string) {
  const value = readStringEnv(name)?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function getServerSupabase() {
  return createServerSupabaseClient('service');
}

export function getServerSupabaseWithMode(mode: 'service' | 'anon') {
  return createServerSupabaseClient(mode);
}

export function getServerSupabaseConfig() {
  const supabaseUrl = readStringEnv('SUPABASE_URL');
  const serviceRoleKey = hasRealEnvValue(
    readStringEnv('SUPABASE_SERVICE_ROLE_KEY') || readStringEnv('SUPABASE_SERVICE_KEY')
  );
  const anonKey = readStringEnv('SUPABASE_ANON_KEY');
  const githubEnabled = readBooleanEnv('GOTRUE_EXTERNAL_GITHUB_ENABLED');
  const githubClientId = readStringEnv('GOTRUE_EXTERNAL_GITHUB_CLIENT_ID');
  const githubSecret = readStringEnv('GOTRUE_EXTERNAL_GITHUB_SECRET');
  const githubRedirectUri = readStringEnv('GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI');

  return {
    supabaseUrl,
    hasServiceRoleKey: serviceRoleKey,
    hasAnonKey: hasRealEnvValue(anonKey),
    hasGitHubProvider: githubEnabled && hasRealEnvValue(githubClientId) && hasRealEnvValue(githubSecret) && hasRealEnvValue(githubRedirectUri)
  };
}

function createServerSupabaseClient(mode: 'service' | 'anon') {
  const url = readStringEnv('SUPABASE_URL');
  const serviceRoleKey = readStringEnv('SUPABASE_SERVICE_ROLE_KEY') || readStringEnv('SUPABASE_SERVICE_KEY');
  const anonKey = readStringEnv('SUPABASE_ANON_KEY');
  const serviceRoleHasValue = hasRealEnvValue(serviceRoleKey);
  const anonHasValue = hasRealEnvValue(anonKey);
  const serviceRole = serviceRoleHasValue ? serviceRoleKey : undefined;
  const anon = anonHasValue ? anonKey : undefined;
  const key = mode === 'service' ? serviceRole || anon : anon;

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
