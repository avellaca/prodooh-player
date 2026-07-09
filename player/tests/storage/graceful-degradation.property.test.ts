/**
 * Property 2: Graceful Degradation on Missing Configuration
 *
 * Generate random subsets of missing configs; verify only affected operations are disabled.
 *
 * **Validates: Requirements 1.4**
 *
 * Requirement 1.4: If a specific configuration is missing (backend credential,
 * Prodooh API credentials, or GAM configuration), the player must block only
 * the operations requiring that missing configuration, while continuing to
 * operate normally with sources whose configuration is present.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { LocalConfigStore } from '../../src/storage/LocalConfigStore';
import { ProDoohSource } from '../../src/sources/ProDoohSource';
import { GamVastSource } from '../../src/sources/GamVastSource';
import { UrlSource } from '../../src/sources/UrlSource';
import { PlaylistSource } from '../../src/sources/PlaylistSource';

/**
 * Represents the complete set of configurations that can be present or missing.
 * Each boolean indicates whether the config is present (true) or missing (false).
 */
interface ConfigPresence {
  /** Whether prodooh_api_key is present in the config store */
  hasProDoohApiKey: boolean;
  /** Whether prodooh_network_id is present in the config store */
  hasProDoohNetworkId: boolean;
  /** Whether gam_ad_tag_url is present in the config store */
  hasGamAdTagUrl: boolean;
  /** Whether url source URLs are configured */
  hasUrlConfig: boolean;
  /** Whether backend credential (device_token) is present */
  hasBackendCredential: boolean;
}

/**
 * Arbitrary generator for random subsets of config presence.
 * Generates all 2^5 = 32 possible combinations of present/missing configs.
 */
const configPresenceArb = fc.record({
  hasProDoohApiKey: fc.boolean(),
  hasProDoohNetworkId: fc.boolean(),
  hasGamAdTagUrl: fc.boolean(),
  hasUrlConfig: fc.boolean(),
  hasBackendCredential: fc.boolean(),
});

describe('Property 2: Graceful Degradation on Missing Configuration', () => {
  let store: LocalConfigStore;

  afterEach(() => {
    if (store) {
      store.close();
    }
  });

  /**
   * Helper: set up a LocalConfigStore with the given config presence.
   * Returns the store with configs populated based on the presence flags.
   */
  function setupStore(presence: ConfigPresence): LocalConfigStore {
    store = new LocalConfigStore(':memory:');

    // venue_id is always present (device identity)
    store.set('venue_id', 'test-screen-001');

    if (presence.hasBackendCredential) {
      store.set('device_token', 'test-device-token-abc123');
    }
    if (presence.hasProDoohApiKey) {
      store.set('prodooh_api_key', 'sandbox-api-key-valid');
    }
    if (presence.hasProDoohNetworkId) {
      store.set('prodooh_network_id', 'sandbox-network-valid');
    }
    if (presence.hasGamAdTagUrl) {
      store.set('gam_ad_tag', 'https://pubads.g.doubleclick.net/gampad/ads?test_ad=true&sz=1920x1080');
    }
    if (presence.hasUrlConfig) {
      store.set('urls', JSON.stringify([
        { url: 'https://example.com/content', duration: 10 },
      ]));
    }

    return store;
  }

  it('ProDoohSource is available only when BOTH api_key AND network_id are present', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        const apiKey = localStore.get('prodooh_api_key') ?? '';
        const networkId = localStore.get('prodooh_network_id') ?? '';

        const source = new ProDoohSource({
          apiKey,
          networkId,
          venueId: localStore.get('venue_id') ?? '',
          baseUrl: 'https://sandbox.api.prodooh.com',
          width: 1920,
          height: 1080,
        });

        const expectedAvailable = presence.hasProDoohApiKey && presence.hasProDoohNetworkId;
        expect(source.isAvailable()).toBe(expectedAvailable);
      }),
      { numRuns: 100 }
    );
  });

  it('GamVastSource is available only when a valid sandbox ad_tag_url is present', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        const adTagUrl = localStore.get('gam_ad_tag') ?? '';

        const source = new GamVastSource({ adTagUrl });

        // GamVastSource.isAvailable() checks that adTagUrl exists AND validates as sandbox tag
        const expectedAvailable = presence.hasGamAdTagUrl;
        expect(source.isAvailable()).toBe(expectedAvailable);
      }),
      { numRuns: 100 }
    );
  });

  it('UrlSource is available only when at least one URL is configured', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        const urlsJson = localStore.get('urls');
        const urls = urlsJson ? JSON.parse(urlsJson) : [];

        const source = new UrlSource({ urls });

        const expectedAvailable = presence.hasUrlConfig;
        expect(source.isAvailable()).toBe(expectedAvailable);
      }),
      { numRuns: 100 }
    );
  });

  it('sources with present config remain available regardless of other missing configs', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        // Build each source from the store
        const prodoohSource = new ProDoohSource({
          apiKey: localStore.get('prodooh_api_key') ?? '',
          networkId: localStore.get('prodooh_network_id') ?? '',
          venueId: localStore.get('venue_id') ?? '',
          baseUrl: 'https://sandbox.api.prodooh.com',
          width: 1920,
          height: 1080,
        });

        const gamSource = new GamVastSource({
          adTagUrl: localStore.get('gam_ad_tag') ?? '',
        });

        const urlsJson = localStore.get('urls');
        const urlSource = new UrlSource({
          urls: urlsJson ? JSON.parse(urlsJson) : [],
        });

        // ProDooh availability is independent of GAM and URL configs
        if (presence.hasProDoohApiKey && presence.hasProDoohNetworkId) {
          expect(prodoohSource.isAvailable()).toBe(true);
        }

        // GAM availability is independent of ProDooh and URL configs
        if (presence.hasGamAdTagUrl) {
          expect(gamSource.isAvailable()).toBe(true);
        }

        // URL availability is independent of ProDooh and GAM configs
        if (presence.hasUrlConfig) {
          expect(urlSource.isAvailable()).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('missing config disables ONLY the affected source, not others', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        const prodoohSource = new ProDoohSource({
          apiKey: localStore.get('prodooh_api_key') ?? '',
          networkId: localStore.get('prodooh_network_id') ?? '',
          venueId: localStore.get('venue_id') ?? '',
          baseUrl: 'https://sandbox.api.prodooh.com',
          width: 1920,
          height: 1080,
        });

        const gamSource = new GamVastSource({
          adTagUrl: localStore.get('gam_ad_tag') ?? '',
        });

        const urlsJson = localStore.get('urls');
        const urlSource = new UrlSource({
          urls: urlsJson ? JSON.parse(urlsJson) : [],
        });

        // When ProDooh credentials are missing, ProDooh is disabled
        // but GAM and URL sources are unaffected
        if (!presence.hasProDoohApiKey || !presence.hasProDoohNetworkId) {
          expect(prodoohSource.isAvailable()).toBe(false);
        }
        if (presence.hasGamAdTagUrl) {
          expect(gamSource.isAvailable()).toBe(true);
        }
        if (presence.hasUrlConfig) {
          expect(urlSource.isAvailable()).toBe(true);
        }

        // When GAM config is missing, GAM is disabled
        // but ProDooh and URL are unaffected
        if (!presence.hasGamAdTagUrl) {
          expect(gamSource.isAvailable()).toBe(false);
        }
        if (presence.hasProDoohApiKey && presence.hasProDoohNetworkId) {
          expect(prodoohSource.isAvailable()).toBe(true);
        }
        if (presence.hasUrlConfig) {
          expect(urlSource.isAvailable()).toBe(true);
        }

        // When URL config is missing, URL source is disabled
        // but ProDooh and GAM are unaffected
        if (!presence.hasUrlConfig) {
          expect(urlSource.isAvailable()).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('PlaylistSource (always available) is never affected by missing external configs', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        // PlaylistSource doesn't depend on credentials — it needs only local playlist items.
        // Simulate having at least one playlist item ready (the invariant from Req 4.1).
        const db = (localStore as any).db;
        db.prepare(
          `INSERT OR IGNORE INTO playlist (id, version, synced_at) VALUES ('pl-test', '1.0', '2024-01-01T00:00:00Z')`
        ).run();
        db.prepare(
          `INSERT OR IGNORE INTO playlist_items (id, playlist_id, type, media_path, position, download_status) VALUES ('item-test-1', 'pl-test', 'image', '/media/test.jpg', 0, 'ready')`
        ).run();

        // PlaylistSource only checks for items in the database, not external credentials
        const playlistSource = new PlaylistSource(db);

        // Regardless of what external configs are missing, PlaylistSource is always available
        expect(playlistSource.isAvailable()).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('LocalConfigStore returns null for each missing config key independently', () => {
    fc.assert(
      fc.property(configPresenceArb, (presence) => {
        const localStore = setupStore(presence);

        // Verify the store correctly reflects what is present and what is missing
        if (presence.hasProDoohApiKey) {
          expect(localStore.get('prodooh_api_key')).not.toBeNull();
        } else {
          expect(localStore.get('prodooh_api_key')).toBeNull();
        }

        if (presence.hasProDoohNetworkId) {
          expect(localStore.get('prodooh_network_id')).not.toBeNull();
        } else {
          expect(localStore.get('prodooh_network_id')).toBeNull();
        }

        if (presence.hasGamAdTagUrl) {
          expect(localStore.get('gam_ad_tag')).not.toBeNull();
        } else {
          expect(localStore.get('gam_ad_tag')).toBeNull();
        }

        if (presence.hasUrlConfig) {
          expect(localStore.get('urls')).not.toBeNull();
        } else {
          expect(localStore.get('urls')).toBeNull();
        }

        if (presence.hasBackendCredential) {
          expect(localStore.get('device_token')).not.toBeNull();
        } else {
          expect(localStore.get('device_token')).toBeNull();
        }

        // venue_id is always present
        expect(localStore.get('venue_id')).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
