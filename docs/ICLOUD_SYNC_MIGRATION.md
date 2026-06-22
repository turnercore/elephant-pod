# iCloud Sync Migration

## Direction

DaisyPod is now iPhone-first. The long-term sync model should use the user's Apple account and iCloud private database for personal app state, while the DaisyPod server remains the processing and public-service boundary.

This changes the product split:

- Native iOS local SQLite remains the source of truth for immediate UI, playback, queueing, downloads, triage, settings, OPML, and backups.
- CloudKit syncs personal state between the user's Apple devices.
- The DaisyPod server no longer needs to own personal sync as the default path.
- The server remains required for PodcastIndex discovery, YouTube import and audio extraction, public clip publishing, silence maps, Smart Skip, health, and capabilities.
- Server services use native app assumptions. PodcastIndex discovery requires native service headers only, while protected processing and publishing routes use Sign in with Apple backend sessions. CloudKit/iCloud account state gates personal sync, not PodcastIndex, YouTube, clips, silence maps, or Smart Skip. Add App Attest on top of Apple Sign In if stronger public abuse controls become necessary.

The previous `/api/sync` Postgres path is retired from the native product runtime. Fresh server schemas no longer create personal podcast sync tables; personal sync work targets CloudKit.

## What Moves To CloudKit

Sync these personal records through the user's private CloudKit database:

- Podcasts/subscriptions and library membership.
- Episodes and episode metadata imported by the user.
- Episode state: played, progress, Inbox, Queue, history, favorites, and visible user decisions.
- Podcast preferences: speed, skip intervals, silence shortening, Smart Skip preferences, sorting, and new-episode Inbox behavior.
- Settings that should follow the user across iPhones.
- Local clip metadata, except public publishing state that belongs to the server.
- Derived episode intelligence that enables offline playback behavior once fetched: silence maps, Smart Skip segment maps, and transcripts.
- Tombstones and sync actions needed for recoverable multi-device merges.

Do not sync these through CloudKit:

- Downloaded audio files.
- App-container file paths.
- Cached artwork file paths.
- Native app tokens or any future server tokens.
- Sleep timer deadline.
- Offline Mode.
- Device-specific background task state.
- Server job queue internals, leases, and processing-only cache state that does not affect offline playback.

Listening stats should remain local until there is a deliberate user-facing decision. They are profile facts and backup-exported today, but syncing them can create surprising cross-device totals if the user uses multiple devices differently.

## Server Responsibilities After The Split

The server should become feature/capability and processing oriented:

- `GET /api/capabilities` tells the iOS app which server-only features are available.
- RSS parsing remains useful as an optional proxy, but iOS must keep direct RSS/Atom fallback.
- PodcastIndex search remains server-mediated so API keys stay server-only.
- YouTube import, metadata enrichment, fake RSS feed generation, and audio extraction remain server-owned.
- Clip publishing remains server-owned because public links and rendered MP3 excerpts are public artifacts.
- Silence maps and Smart Skip remain server-owned processing/cache services.
- The server no longer needs to expose personal sync routes. Keep only server-owned feature data and public artifacts.

The server should not need to receive private iCloud data just to sync two Apple devices. It should receive only the payload needed for a server feature, such as a media URL for analysis or an episode/source identifier for YouTube extraction.

## Auth Direction

Native personal sync should use iCloud account state, not a server login. If the device is signed into iCloud and the build is provisioned with the DaisyPod CloudKit container, CloudKit should handle identity, private database access, and device-to-device propagation.

Server services should become Apple-native:

- Use backend `/api/capabilities` plus Sign in with Apple backend sessions as the protected processing gate so random internet clients cannot call processing routes with only spoofed native headers.
- Keep local iCloud account availability scoped to CloudKit personal sync status and sync attempts.
- Add server-side App Attest or Sign in with Apple token verification before treating this as a public abuse-control identity.
- Do not sync app/server tokens through CloudKit or JSON backup.

## Native Implementation Plan

1. Keep the UI pointed at a native sync coordinator instead of assuming a server route.
   - Status: implemented. `CloudKitPersonalSyncEngine` prepares local snapshots, merges remote records, restores portable state, and uploads through the selected CloudKit store.
2. Keep SQLite as the canonical local store and map local repository changes into idempotent sync actions.
3. Add a CloudKit adapter behind that boundary:
   - Use private database records for personal rows.
   - Use deterministic record names derived from local ids where possible.
   - Keep a per-device sync cursor/change token.
   - Preserve local active-playback protection before applying remote episode-state changes.
   - Current native status: `CloudKitPersonalSyncEngine` exports deterministic record snapshots from the portable local backup shape, strips device-local fields before upload, includes silence maps, Smart Skip maps, and transcripts, downloads existing private-zone records through CloudKit private-zone changes, persists a per-zone server change token for incremental downloads, falls back to a fresh zone scan when CloudKit expires the token, merges local/remote records by `modifiedAt`, keeps the actively playing episode state local even when remote data is newer, applies current tombstones while ignoring stale tombstones and preserving device files, restores the merged portable state into SQLite, and uploads the merged snapshot through `LiveCloudKitPersonalSyncStore` when iCloud is available.
   - Pending: two-device physical validation.
4. Add iCloud account status UI in Settings:
   - Available and syncing.
   - Not signed into iCloud.
   - Restricted or unavailable.
   - Last sync time and last error.
5. Add a one-time migration path:
   - Existing local SQLite rows upload to CloudKit as the first truth set.
   - Existing local/server database data can be imported by a one-off migration tool if needed, then uploaded through the CloudKit path.
   - Device-local downloads and paths stay local.
6. Add CloudKit-focused tests:
   - Repository-to-record encoding strips local paths and tokens.
   - Remote changes replay sync actions deterministically.
   - Active playback protection wins during merge.
   - Tombstones delete local rows without deleting device files.
   - Stale tombstones do not delete newer local or merged records.
   - CloudKit unavailable state leaves the app fully local-first.

`apps/ios/project.yml` declares the CloudKit entitlement for `iCloud.com.elephanthand.daisypod`. Physical-device provisioning still needs to be revalidated with an online device and the matching Apple Developer container before CloudKit sync can be called complete.

## Backend Migration Plan

1. Keep processing/discovery routes separate from personal sync state.
2. Accept native iOS service requests for PodcastIndex discovery when the request passes the native service header contract; require Sign in with Apple backend sessions for protected processing and publishing routes.
3. Add App Attest for stronger production abuse controls if the processing server becomes public.
4. Do not reintroduce product auth routes for normal app use.
5. Keep browser sign-in assumptions out of the native/server runtime.

## Acceptance Gates

CloudKit is not complete until these pass on physical Apple devices:

- First launch local-only with iCloud unavailable.
- First launch with iCloud available and no server configured.
- Add RSS feed on device A; see it on device B.
- Queue reorder on device A; replay on device B.
- Active playback on device B is not disrupted by an older device A update.
- Download/play offline on one device without syncing file paths to the other.
- OPML import on one device syncs subscriptions and episodes.
- JSON backup/restore preserves local device identity and does not duplicate CloudKit rows.
- Use backend capabilities plus native service headers for PodcastIndex, and Sign in with Apple backend sessions for YouTube/clips/Smart Skip processing; add App Attest before public abuse-sensitive deployment if needed.
- Server-only features still fail gracefully from `/api/capabilities`.
- Server-only features still require the native service gate when configured, so random internet clients cannot call processing routes with only spoofed headers.
- Ready silence maps, Smart Skip maps, and transcripts fetched on device A are available offline on device B after CloudKit sync.
