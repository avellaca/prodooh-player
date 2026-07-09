/**
 * Property-based test: Sandbox Tag Validation
 *
 * Generates random strings and URL-like inputs to verify that only strings
 * matching both conditions (valid GAM domain + sandbox indicator) are accepted
 * as valid sandbox tags.
 *
 * **Validates: Requirements 3.1**
 *
 * Requirement 3.1: Before sending any request to GAM, validate the ad tag format
 * to confirm it's a test/sandbox tag; refuse to send if validation fails and log an error.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GamVastSource } from '../../src/sources/GamVastSource';
import type { GamLogger } from '../../src/sources/GamVastSource';

/** Known valid GAM domains (must match implementation) */
const ALLOWED_GAM_DOMAINS = [
  'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'googleads.g.doubleclick.net',
];

/** Sandbox/test indicators (must match implementation) */
const SANDBOX_INDICATORS = [
  'test',
  'sandbox',
  'sample_tag',
  'debug',
  'adunit/test',
  'test_ad',
  '/test/',
];

/** Creates a silent logger that captures error calls */
function createSilentLogger(): GamLogger & { errorCalls: string[] } {
  const logger = {
    errorCalls: [] as string[],
    error(msg: string) {
      logger.errorCalls.push(msg);
    },
    warn() {},
  };
  return logger;
}

/** Helper to create a GamVastSource with silent logger */
function createSource(url: string) {
  const logger = createSilentLogger();
  const source = new GamVastSource({ adTagUrl: url, logger });
  return { source, logger };
}

/**
 * Checks if a URL satisfies both validation conditions manually:
 * 1. URL is on a known GAM domain
 * 2. URL contains a sandbox/test indicator
 */
function isValidSandboxTag(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isKnownDomain = ALLOWED_GAM_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );

  if (!isKnownDomain) return false;

  const fullUrl = url.toLowerCase();
  const hasSandboxIndicator = SANDBOX_INDICATORS.some((indicator) =>
    fullUrl.includes(indicator),
  );

  return hasSandboxIndicator;
}

describe('Property 5: Sandbox Tag Validation', () => {
  /**
   * Arbitrary that generates valid sandbox tag URLs by combining
   * a valid GAM domain with a sandbox indicator in the path.
   */
  const validSandboxTagArb = fc.tuple(
    fc.constantFrom(...ALLOWED_GAM_DOMAINS),
    fc.constantFrom(...SANDBOX_INDICATORS),
    fc.webPath(),
  ).map(([domain, indicator, extraPath]) =>
    `https://${domain}/gampad/${indicator}${extraPath}`,
  );

  /**
   * Arbitrary that generates URLs on non-GAM domains.
   * Even with sandbox indicators, these must be rejected.
   */
  const nonGamDomainArb = fc.tuple(
    fc.domain().filter(
      (d) => !ALLOWED_GAM_DOMAINS.some(
        (allowed) => d === allowed || d.endsWith(`.${allowed}`),
      ),
    ),
    fc.constantFrom(...SANDBOX_INDICATORS),
    fc.webPath(),
  ).map(([domain, indicator, path]) =>
    `https://${domain}/${indicator}${path}`,
  );

  /**
   * Arbitrary that generates URLs on valid GAM domains but WITHOUT any sandbox indicator.
   * These must be rejected.
   */
  const gamDomainNoSandboxArb = fc.tuple(
    fc.constantFrom(...ALLOWED_GAM_DOMAINS),
    fc.stringMatching(/^[a-z0-9/]{1,30}$/).filter((path) => {
      const lower = path.toLowerCase();
      return !SANDBOX_INDICATORS.some((ind) => lower.includes(ind));
    }),
  ).map(([domain, path]) =>
    `https://${domain}/gampad/${path}`,
  );

  /**
   * Arbitrary that generates completely random strings (not necessarily valid URLs).
   */
  const randomStringArb = fc.string({ minLength: 0, maxLength: 200 });

  it('accepts URLs that are on a valid GAM domain AND contain a sandbox indicator', () => {
    fc.assert(
      fc.property(
        validSandboxTagArb,
        (url) => {
          const { source } = createSource(url);
          const result = source.validateSandboxTag(url);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects URLs on non-GAM domains even if they contain sandbox indicators', () => {
    fc.assert(
      fc.property(
        nonGamDomainArb,
        (url) => {
          const { source, logger } = createSource(url);
          const result = source.validateSandboxTag(url);
          expect(result).toBe(false);
          expect(logger.errorCalls.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects URLs on valid GAM domains that lack sandbox indicators', () => {
    fc.assert(
      fc.property(
        gamDomainNoSandboxArb,
        (url) => {
          const { source, logger } = createSource(url);
          const result = source.validateSandboxTag(url);
          expect(result).toBe(false);
          expect(logger.errorCalls.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects random strings that are not valid URLs', () => {
    fc.assert(
      fc.property(
        randomStringArb.filter((s) => {
          try {
            new URL(s);
            return false; // exclude valid URLs from this test
          } catch {
            return true; // keep invalid URLs
          }
        }),
        (randomStr) => {
          const { source } = createSource(randomStr);
          const result = source.validateSandboxTag(randomStr);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('validateSandboxTag result always matches the reference implementation for any URL-like input', () => {
    /**
     * Generates URLs with random domains (mix of valid GAM and non-GAM)
     * and random paths (mix of containing and not containing sandbox indicators).
     */
    const anyUrlArb = fc.tuple(
      fc.constantFrom(
        ...ALLOWED_GAM_DOMAINS,
        'example.com',
        'evil.adserver.net',
        'pubads.fake.net',
        'doubleclick.net',
      ),
      fc.constantFrom(
        '/gampad/test/ads',
        '/gampad/sandbox/tag',
        '/sample_tag/vast',
        '/debug/creative',
        '/adunit/test/1234',
        '/test_ad/banner',
        '/test/vast.xml',
        '/gampad/production/ads',
        '/real/campaign/live',
        '/gampad/ads',
        '/some/random/path',
      ),
    ).map(([domain, path]) => `https://${domain}${path}`);

    fc.assert(
      fc.property(
        anyUrlArb,
        (url) => {
          const { source } = createSource(url);
          const actual = source.validateSandboxTag(url);
          const expected = isValidSandboxTag(url);
          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('case-insensitive: sandbox indicators are matched regardless of URL casing', () => {
    const casedSandboxTagArb = fc.tuple(
      fc.constantFrom(...ALLOWED_GAM_DOMAINS),
      fc.constantFrom(...SANDBOX_INDICATORS),
    ).map(([domain, indicator]) => {
      // Randomly capitalize parts of the indicator
      const casedIndicator = indicator
        .split('')
        .map((c) => (Math.random() > 0.5 ? c.toUpperCase() : c))
        .join('');
      return `https://${domain}/gampad/${casedIndicator}/ads`;
    });

    fc.assert(
      fc.property(
        casedSandboxTagArb,
        (url) => {
          const { source } = createSource(url);
          const result = source.validateSandboxTag(url);
          // Should accept because comparison is case-insensitive
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty and null-like inputs are always rejected', () => {
    const emptyLikeArb = fc.constantFrom('', ' ', '\t', '\n');

    fc.assert(
      fc.property(
        emptyLikeArb,
        (input) => {
          const { source } = createSource(input);
          const result = source.validateSandboxTag(input);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 10 },
    );
  });
});
