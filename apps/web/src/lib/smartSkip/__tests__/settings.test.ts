import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSmartSkipSettings } from '../useSmartSkip';
import type { AppSettings, PodcastPreference } from '../../../types/domain';

describe('resolveSmartSkipSettings', () => {
  it('uses global settings as defaults and lets podcast preferences override them', () => {
    const preference: PodcastPreference = {
      podcastId: 'show-1',
      smartSkipIntro: true,
      smartSkipSponsors: false,
      smartSkipSoftSkips: true,
      sortDirection: 'newest',
      addNewEpisodesToInbox: true,
      updatedAt: new Date().toISOString()
    };

    const resolved = resolveSmartSkipSettings(
      {
        ...settingsFixture,
        smartSkipIntros: false,
        smartSkipSponsors: true,
        smartSkipSoftSkips: false
      },
      preference
    );

    assert.equal(resolved.intros, true);
    assert.equal(resolved.sponsors, false);
    assert.equal(resolved.softSkips, true);
    assert.equal(resolved.ads, settingsFixture.smartSkipAds);
  });
});

const settingsFixture: AppSettings = {
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
  silenceShortening: false,
  silenceShorteningMode: 'server-ffmpeg',
  silenceThreshold: 0.018,
  silenceThresholdDb: -42,
  silenceMinMs: 350,
  silenceBoostRate: 2.15,
  smartSkipEnabled: true,
  smartSkipAds: true,
  smartSkipSponsors: true,
  smartSkipIntros: false,
  smartSkipOutros: false,
  smartSkipNetworkPromos: true,
  smartSkipSelfPromos: false,
  smartSkipSilence: false,
  smartSkipSoftSkips: false,
  smartSkipSoftPrompt: true,
  smartSkipUseServerMedia: true,
  nativeAudioPreferred: true,
  theme: 'dark'
};
