/**
 * Property-based test: Rate Limit Compliance
 *
 * Generates sequences of ad requests with varying timing and verifies that
 * the minimum interval of 10 seconds between actual API calls is always enforced.
 *
 * **Validates: Requirements 2.5**
 *
 * Requirement 2.5: The player must respect polling rate limits documented by
 * the Prodooh Ad Serving API (minimum 10s between requests per screen).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { ProDoohSource } from '../../src/sources/ProDoohSource';
import type { ProDoohSourceConfig } from '../../src/sources/ProDoohSource';

const defaultConfig: ProDoohSourceConfig = {
  apiKey: 'test-api-key',
  networkId: 'test-network',
  venueId: 'test-venue',
  baseUrl: 'https://sandbox.api.prodooh.com',
  width: 1920,
  height: 1080,
};

const mockAdResponse = {
  media: 'https://cdn.prodooh.com/ad/creative.jpg',
  type: 'image/jpeg',
  print_id: 'pop-uuid-001',
  proof_of_play: 'https://sandbox.api.prodooh.com/public/v1/ad/proof_of_play/pop-uuid-001',
  expiration: 'https://sandbox.api.prodooh.com/public/v1/expiration/pop-uuid-001',
};

/**
 * Base time offset so that Date.now() never starts at 0.
 * ProDoohSource initializes lastRequestTime = 0, so if Date.now() is also 0,
 * the first request would be rate-limited. Using a realistic start time avoids this.
 */
const BASE_TIME = 1_700_000_000_000; // Arbitrary epoch-like start

describe('Property 4: Rate Limit Compliance', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchCallTimestamps: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    fetchCallTimestamps = [];
    fetchMock = vi.fn().mockImplementation(async () => {
      // Record the timestamp of each actual fetch call
      fetchCallTimestamps.push(Date.now());
      return {
        ok: true,
        json: async () => mockAdResponse,
      };
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Arbitrary that generates a sequence of time deltas (in ms) between
   * consecutive ad request attempts. Deltas range from 0ms to 30_000ms
   * to cover cases both below and above the 10s minimum interval.
   */
  const requestTimingSequence = fc.array(
    fc.integer({ min: 0, max: 30_000 }),
    { minLength: 2, maxLength: 20 }
  );

  it('actual API calls are always separated by at least 10 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(
        requestTimingSequence,
        async (deltas) => {
          // Reset state for each property run
          fetchCallTimestamps = [];
          fetchMock.mockClear();
          vi.setSystemTime(BASE_TIME);

          const source = new ProDoohSource(defaultConfig);

          // Execute the first prefetch
          await source.prefetch();

          // Execute subsequent prefetch calls with the generated timing
          for (const delta of deltas) {
            vi.advanceTimersByTime(delta);
            await source.prefetch();
          }

          // Verify: every pair of consecutive actual fetch calls respects the 10s minimum
          for (let i = 1; i < fetchCallTimestamps.length; i++) {
            const interval = fetchCallTimestamps[i]! - fetchCallTimestamps[i - 1]!;
            expect(interval).toBeGreaterThanOrEqual(10_000);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('requests attempted before the 10s interval are silently rejected (return null, no fetch)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 9_999 }),
        async (shortDelay) => {
          // Reset state
          fetchCallTimestamps = [];
          fetchMock.mockClear();
          vi.setSystemTime(BASE_TIME);

          const source = new ProDoohSource(defaultConfig);

          // First request succeeds
          const firstResult = await source.prefetch();
          expect(firstResult).not.toBeNull();
          expect(fetchMock).toHaveBeenCalledTimes(1);

          // Advance by less than 10s
          vi.advanceTimersByTime(shortDelay);

          // Second request should be rate-limited
          const result = await source.prefetch();
          expect(result).toBeNull();
          expect(fetchMock).toHaveBeenCalledTimes(1); // No additional fetch call
        }
      ),
      { numRuns: 100 }
    );
  });

  it('requests at or after exactly 10s are allowed through', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10_000, max: 60_000 }),
        async (validDelay) => {
          // Reset state
          fetchCallTimestamps = [];
          fetchMock.mockClear();
          vi.setSystemTime(BASE_TIME);

          const source = new ProDoohSource(defaultConfig);

          // First request
          await source.prefetch();
          expect(fetchMock).toHaveBeenCalledTimes(1);

          // Advance by a valid delay (>= 10s)
          vi.advanceTimersByTime(validDelay);

          // Second request should succeed
          const result = await source.prefetch();
          expect(result).not.toBeNull();
          expect(fetchMock).toHaveBeenCalledTimes(2);

          // Verify actual interval between fetch calls
          expect(fetchCallTimestamps[1]! - fetchCallTimestamps[0]!).toBeGreaterThanOrEqual(10_000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('regardless of request pattern, total actual API calls never exceed theoretical maximum', async () => {
    await fc.assert(
      fc.asyncProperty(
        requestTimingSequence,
        async (deltas) => {
          // Reset state
          fetchCallTimestamps = [];
          fetchMock.mockClear();
          vi.setSystemTime(BASE_TIME);

          const source = new ProDoohSource(defaultConfig);

          // Execute all requests
          await source.prefetch();
          for (const delta of deltas) {
            vi.advanceTimersByTime(delta);
            await source.prefetch();
          }

          // Total elapsed time
          const totalTime = deltas.reduce((sum, d) => sum + d, 0);

          // Maximum possible API calls = 1 + floor(totalTime / 10_000)
          const maxPossibleCalls = 1 + Math.floor(totalTime / 10_000);

          expect(fetchCallTimestamps.length).toBeLessThanOrEqual(maxPossibleCalls);
        }
      ),
      { numRuns: 100 }
    );
  });
});
