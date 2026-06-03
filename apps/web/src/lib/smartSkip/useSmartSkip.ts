import { useEffect, useState } from 'react';
import type { AppSettings, EpisodeWithState, PodcastPreference } from '@/types/domain';
import { fetchSmartSkipSegmentMap, requestSmartSkipProcessing } from './api';
import type { ResolvedSmartSkipSettings, SmartSkipSegmentMap } from './types';

export function useSmartSkipMap(episode: EpisodeWithState | null, settings: AppSettings, enabled: boolean, accessToken?: string | null): SmartSkipSegmentMap | null {
  const [map, setMap] = useState<SmartSkipSegmentMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    setMap(null);
    if (!episode || !enabled || !settings.serverUrl || !accessToken) return;
    void fetchSmartSkipSegmentMap(episode, settings.serverUrl, accessToken)
      .then(async (existing) => existing || requestSmartSkipProcessing(episode, settings.serverUrl, accessToken, 'nowPlaying'))
      .then((next) => {
        if (!cancelled) setMap(next);
      })
      .catch(() => {
        if (!cancelled) setMap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, enabled, episode?.audioUrl, episode?.id, settings.serverUrl]);
  return map;
}

export function resolveSmartSkipSettings(settings: AppSettings, preference?: PodcastPreference): ResolvedSmartSkipSettings {
  const enabled = Boolean(preference?.smartSkipEnabled ?? settings.smartSkipEnabled);
  const globalCommercials = settings.smartSkipCommercials ?? (settings.smartSkipAds || settings.smartSkipSponsors || settings.smartSkipNetworkPromos);
  const preferenceCommercials = preference?.smartSkipCommercials ?? preference?.smartSkipAds ?? preference?.smartSkipSponsors ?? preference?.smartSkipNetworkPromos;
  const commercials = Boolean(preferenceCommercials ?? globalCommercials);
  const includeSoftMatches = Boolean(preference?.smartSkipIncludeSoftMatches ?? preference?.smartSkipSoftSkips ?? settings.smartSkipIncludeSoftMatches ?? settings.smartSkipSoftSkips);
  return {
    enabled,
    commercials: enabled && commercials,
    intros: enabled && Boolean(preference?.smartSkipIntro ?? settings.smartSkipIntros),
    outros: enabled && Boolean(preference?.smartSkipOutro ?? settings.smartSkipOutros),
    selfPromos: enabled && Boolean(preference?.smartSkipSelfPromos ?? settings.smartSkipSelfPromos),
    silence: enabled && Boolean(preference?.smartSkipSilence ?? settings.smartSkipSilence),
    includeSoftMatches,
    softPrompt: Boolean(settings.smartSkipSoftPrompt)
  };
}
