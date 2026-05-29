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
  const enabled = Boolean(settings.smartSkipEnabled && (preference?.smartSkipEnabled ?? true));
  return {
    enabled,
    ads: Boolean(settings.smartSkipAds && (preference?.smartSkipAds ?? true)),
    sponsors: Boolean(settings.smartSkipSponsors && (preference?.smartSkipSponsors ?? true)),
    intros: Boolean(settings.smartSkipIntros && (preference?.smartSkipIntro ?? true)),
    outros: Boolean(settings.smartSkipOutros && (preference?.smartSkipOutro ?? true)),
    networkPromos: Boolean(settings.smartSkipNetworkPromos && (preference?.smartSkipNetworkPromos ?? true)),
    selfPromos: Boolean(settings.smartSkipSelfPromos && (preference?.smartSkipSelfPromos ?? true)),
    silence: Boolean(settings.smartSkipSilence),
    softPrompt: Boolean(settings.smartSkipSoftPrompt)
  };
}
