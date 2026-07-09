/**
 * Property-based test: Credential Isolation
 *
 * Generates random source configurations with distinct credentials and verifies
 * that each source's request uses ONLY its own credentials, never cross-contaminating
 * with credentials from other sources.
 *
 * **Validates: Requirements 1.3**
 *
 * Requirement 1.3: The player must use Prodooh Ad Serving API credentials separately,
 * only when querying that specific source. Each source's credentials are isolated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { ProDoohSource } from '../../src/sources/ProDoohSource';
import type { ProDoohSourceConfig } from '../../src/sources/ProDoohSource';
import { GamVastSource } from '../../src/sources/GamVastSource';
import type { GamVastConfig } from '../../src/sources/GamVastSource';
import { UrlSource } from '../../src/sources/UrlSource';
import type { UrlSourceConfig, IframeLoader } from '../../src/sources/UrlSource';

describe('Property 1: Credential Isolation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let capturedRequests: Array<{ url: string; body?: string; headers?: Record<string, string> }>;

  beforeEach(() => {
    capturedRequests = [];
    fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      capturedRequests.push({
        url: url as string,
        body: options?.body as string | undefined,
        headers: options?.headers as Record<string, string> | undefined,
      });
      // Return a valid ad response for ProDooh
      if (typeof url === 'string' && url.includes('/public/v1/ad')) {
        return {
          ok: true,
          json: async () => ({
            media: 'https://cdn.example.com/ad.jpg',
            type: 'image/jpeg',
            print_id: `print-${Math.random().toString(36).slice(2)}`,
            proof_of_play: `${url.replace('/public/v1/ad', '/public/v1/ad/proof_of_play/pop-id')}`,
            expiration: `${url.replace('/public/v1/ad', '/public/v1/expiration/pop-id')}`,
          }),
        };
      }
      // Return valid VAST XML for GAM
      return {
        ok: true,
        text: async () => `<?xml version="1.0"?>
<VAST version="3.0">
  <Ad>
    <InLine>
      <Creatives>
        <Creative>
          <Linear>
            <Duration>00:00:15</Duration>
            <MediaFiles>
              <MediaFile>https://cdn.example.com/vast-video.mp4</MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`,
      };
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: generate a unique suffix to create distinct credentials
  const uniqueSuffix = () => fc.nat({ max: 999999 }).map(n => n.toString(36).padStart(4, '0'));

  // Generate pairs of distinct ProDooh configs by construction
  const distinctProDoohConfigPair = fc.tuple(
    uniqueSuffix(),
    uniqueSuffix(),
    uniqueSuffix(),
    uniqueSuffix(),
  ).filter(([a, b, c, d]) => a !== b && c !== d).map(([suffA, suffB, suffC, suffD]) => {
    const configA: ProDoohSourceConfig = {
      apiKey: `apikey-aaa-${suffA}`,
      networkId: `network-aaa-${suffC}`,
      venueId: `venue-aaa`,
      baseUrl: 'https://sandbox-a.api.prodooh.com',
      width: 1920,
      height: 1080,
    };
    const configB: ProDoohSourceConfig = {
      apiKey: `apikey-bbb-${suffB}`,
      networkId: `network-bbb-${suffD}`,
      venueId: `venue-bbb`,
      baseUrl: 'https://sandbox-b.api.prodooh.com',
      width: 1080,
      height: 1920,
    };
    return [configA, configB] as const;
  });

  // Generate random ProDooh configs
  const proDoohConfigArb: fc.Arbitrary<ProDoohSourceConfig> = fc.tuple(
    fc.nat({ max: 999999 }),
    fc.nat({ max: 999999 }),
    fc.nat({ max: 999999 }),
  ).map(([a, b, c]) => ({
    apiKey: `apikey-${a.toString(36)}`,
    networkId: `network-${b.toString(36)}`,
    venueId: `venue-${c.toString(36)}`,
    baseUrl: fc.sample(fc.constantFrom(
      'https://sandbox-a.api.prodooh.com',
      'https://sandbox-b.api.prodooh.com',
      'https://sandbox-c.api.prodooh.com'
    ), 1)[0]!,
    width: 1920,
    height: 1080,
  }));

  const gamConfigArb: fc.Arbitrary<GamVastConfig> = fc.constantFrom(
    'https://pubads.g.doubleclick.net/gampad/ads?test_tag_alpha',
    'https://pubads.g.doubleclick.net/gampad/ads?sandbox_tag_beta',
    'https://pubads.g.doubleclick.net/gampad/ads?test_tag_gamma',
    'https://pubads.g.doubleclick.net/gampad/ads?sandbox_tag_delta'
  ).map(adTagUrl => ({
    adTagUrl,
    timeout: 5000,
  }));

  it('ProDooh source requests contain only its own credentials, never credentials from other sources', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctProDoohConfigPair,
        async ([configA, configB]) => {
          // Create two sources with distinct credentials
          const sourceA = new ProDoohSource(configA);
          const sourceB = new ProDoohSource(configB);

          // Source A makes a request
          capturedRequests = [];
          await sourceA.prefetch();

          expect(capturedRequests.length).toBe(1);
          const requestA = capturedRequests[0]!;
          const bodyA = JSON.parse(requestA.body!);

          // Source A uses ONLY its own credentials
          expect(bodyA.api_key).toBe(configA.apiKey);
          expect(bodyA.network_id).toBe(configA.networkId);
          expect(bodyA.venue_id).toBe(configA.venueId);

          // Source A does NOT use B's credentials
          expect(bodyA.api_key).not.toBe(configB.apiKey);
          expect(bodyA.network_id).not.toBe(configB.networkId);

          // Source B makes a request (new instance, no rate limit issue)
          capturedRequests = [];
          await sourceB.prefetch();

          expect(capturedRequests.length).toBe(1);
          const requestB = capturedRequests[0]!;
          const bodyB = JSON.parse(requestB.body!);

          // Source B uses ONLY its own credentials
          expect(bodyB.api_key).toBe(configB.apiKey);
          expect(bodyB.network_id).toBe(configB.networkId);
          expect(bodyB.venue_id).toBe(configB.venueId);

          // Source B does NOT use A's credentials
          expect(bodyB.api_key).not.toBe(configA.apiKey);
          expect(bodyB.network_id).not.toBe(configA.networkId);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('GAM source requests use only its own ad tag URL, never credentials from ProDooh sources', async () => {
    await fc.assert(
      fc.asyncProperty(
        proDoohConfigArb,
        gamConfigArb,
        async (prodoohConfig, gamConfig) => {
          const gamSource = new GamVastSource(gamConfig);

          capturedRequests = [];
          await gamSource.prefetch();

          // GAM should have made a request
          if (capturedRequests.length > 0) {
            const gamRequest = capturedRequests[0]!;

            // GAM request goes to its own ad tag URL
            expect(gamRequest.url).toBe(gamConfig.adTagUrl);

            // GAM request must NOT contain ProDooh credentials
            expect(gamRequest.url).not.toContain(prodoohConfig.apiKey);
            expect(gamRequest.url).not.toContain(prodoohConfig.networkId);

            // GAM request should NOT have a body with ProDooh credentials
            if (gamRequest.body) {
              expect(gamRequest.body).not.toContain(prodoohConfig.apiKey);
              expect(gamRequest.body).not.toContain(prodoohConfig.networkId);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('each source type uses only its own configuration when making requests, never mixing credentials across source types', async () => {
    await fc.assert(
      fc.asyncProperty(
        proDoohConfigArb,
        gamConfigArb,
        async (prodoohConfig, gamConfig) => {
          // Create all source types with their distinct configurations
          const prodoohSource = new ProDoohSource(prodoohConfig);
          const gamSource = new GamVastSource(gamConfig);
          const urlSource = new UrlSource({
            urls: [{ url: 'https://example.com/page?token=abc', duration: 10 }],
            variables: { venue_id: 'test-venue' },
            iframeLoader: { load: async (url) => { const el = document.createElement('iframe'); el.src = url; return el; }, dispose: () => {} },
          });

          // --- ProDooh request ---
          capturedRequests = [];
          await prodoohSource.prefetch();

          if (capturedRequests.length > 0) {
            const prodoohRequest = capturedRequests[0]!;
            // ProDooh request goes to its own base URL
            expect(prodoohRequest.url).toContain(
              prodoohConfig.baseUrl.replace(/\/+$/, '')
            );
            // ProDooh body contains only its own credentials
            const prodoohBody = JSON.parse(prodoohRequest.body!);
            expect(prodoohBody.api_key).toBe(prodoohConfig.apiKey);
            expect(prodoohBody.network_id).toBe(prodoohConfig.networkId);
            // ProDooh request URL does NOT equal the GAM ad tag URL
            expect(prodoohRequest.url).not.toBe(gamConfig.adTagUrl);
          }

          // --- GAM request ---
          capturedRequests = [];
          await gamSource.prefetch();

          if (capturedRequests.length > 0) {
            const gamRequest = capturedRequests[0]!;
            // GAM request goes to its own ad tag URL
            expect(gamRequest.url).toBe(gamConfig.adTagUrl);
            // GAM request does not carry ProDooh credentials
            expect(gamRequest.url).not.toContain(prodoohConfig.apiKey);
            if (gamRequest.body) {
              expect(gamRequest.body).not.toContain(prodoohConfig.apiKey);
              expect(gamRequest.body).not.toContain(prodoohConfig.networkId);
            }
          }

          // --- URL source ---
          capturedRequests = [];
          const urlContent = await urlSource.prefetch();

          // UrlSource.prefetch() returns content metadata without making network calls
          // Verify the returned content URL doesn't contain other sources' credentials
          if (urlContent) {
            expect(urlContent.mediaUrl).not.toContain(prodoohConfig.apiKey);
            expect(urlContent.mediaUrl).not.toContain(prodoohConfig.networkId);
            expect(urlContent.mediaUrl).not.toBe(gamConfig.adTagUrl);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('multiple ProDooh sources with different credentials never share state across instances', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctProDoohConfigPair,
        async ([configA, configB]) => {
          // Create two independent ProDooh source instances
          const sourceA = new ProDoohSource(configA);
          const sourceB = new ProDoohSource(configB);

          // Both sources make requests — each is a fresh instance so no rate limit issue
          capturedRequests = [];
          await sourceA.prefetch();
          const requestsFromA = [...capturedRequests];

          capturedRequests = [];
          await sourceB.prefetch();
          const requestsFromB = [...capturedRequests];

          // Verify A's request
          expect(requestsFromA.length).toBe(1);
          const bodyA = JSON.parse(requestsFromA[0]!.body!);
          expect(bodyA.api_key).toBe(configA.apiKey);
          expect(bodyA.network_id).toBe(configA.networkId);

          // Verify B's request
          expect(requestsFromB.length).toBe(1);
          const bodyB = JSON.parse(requestsFromB[0]!.body!);
          expect(bodyB.api_key).toBe(configB.apiKey);
          expect(bodyB.network_id).toBe(configB.networkId);

          // Cross-contamination check: A's credentials never appear in B's request
          expect(bodyB.api_key).not.toBe(configA.apiKey);
          expect(bodyB.network_id).not.toBe(configA.networkId);

          // Cross-contamination check: B's credentials never appear in A's request
          expect(bodyA.api_key).not.toBe(configB.apiKey);
          expect(bodyA.network_id).not.toBe(configB.networkId);

          // Verify endpoint isolation (each goes to its own base URL)
          expect(requestsFromA[0]!.url).toContain('sandbox-a');
          expect(requestsFromB[0]!.url).toContain('sandbox-b');
        }
      ),
      { numRuns: 50 }
    );
  });
});
