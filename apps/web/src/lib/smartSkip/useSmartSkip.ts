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
  return {
    enabled,
    ads: Boolean(preference?.smartSkipAds ?? settings.smartSkipAds),
    sponsors: Boolean(preference?.smartSkipSponsors ?? settings.smartSkipSponsors),
    intros: Boolean(preference?.smartSkipIntro ?? settings.smartSkipIntros),
    outros: Boolean(preference?.smartSkipOutro ?? settings.smartSkipOutros),
    networkPromos: Boolean(preference?.smartSkipNetworkPromos ?? settings.smartSkipNetworkPromos),
    selfPromos: Boolean(preference?.smartSkipSelfPromos ?? settings.smartSkipSelfPromos),
    silence: Boolean(preference?.smartSkipSilence ?? settings.smartSkipSilence),
    softSkips: Boolean(preference?.smartSkipSoftSkips ?? settings.smartSkipSoftSkips),
    softPrompt: Boolean(settings.smartSkipSoftPrompt)
  };
}
