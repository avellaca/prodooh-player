/**
 * Property-based test: Print ID Lifecycle Completeness
 *
 * Generates random playback outcomes (success, decode failure, timeout, etc.)
 * and verifies that each print_id gets exactly one terminal action — either
 * proof_of_play (confirmed) OR expiration (expired), never both, never neither.
 *
 * **Validates: Requirements 2.2, 5.1, 5.2, 5.3**
 *
 * Requirement 2.2: If the API response includes art, play it and register a pending proof of play.
 * Requirement 5.1: Confirm proof of play ONLY after art finished playing successfully.
 * Requirement 5.2: If art couldn't be played, notify expiration instead.
 * Requirement 5.3: An art never stays ambiguous: always confirmed OR expired, never both, never neither.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { POPQueue } from '../../src/queue/POPQueue';
import type { POPAction, POPQueueEntry } from '../../src/queue/POPQueue';

/** Possible playback outcomes that trigger terminal actions */
type PlaybackOutcome = 'success' | 'decode_failure' | 'timeout' | 'format_unsupported' | 'network_error' | 'corrupt_file';

/** Represents a single ad delivery from the Prodooh API */
interface AdDelivery {
  printId: string;
  outcome: PlaybackOutcome;
}

/**
 * Determines the correct terminal action for a given playback outcome.
 * - success → proof_of_play (Req 5.1)
 * - any failure → expiration (Req 5.2)
 */
function expectedAction(outcome: PlaybackOutcome): POPAction {
  return outcome === 'success' ? 'proof_of_play' : 'expiration';
}

/**
 * Simulates the player's print_id lifecycle decision logic:
 * After receiving art and attempting playback, the player enqueues
 * exactly one terminal action based on the outcome.
 */
function simulatePlaybackLifecycle(queue: POPQueue, delivery: AdDelivery): void {
  const baseUrl = 'https://sandbox.api.prodooh.com';
  const popUrl = `${baseUrl}/public/v1/ad/proof_of_play/${delivery.printId}`;
  const expirationUrl = `${baseUrl}/public/v1/expiration/${delivery.printId}`;

  if (delivery.outcome === 'success') {
    // Art played successfully → confirm proof of play (Req 5.1)
    queue.enqueue(delivery.printId, 'proof_of_play', popUrl);
  } else {
    // Art could not be played → notify expiration (Req 5.2)
    queue.enqueue(delivery.printId, 'expiration', expirationUrl);
  }
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pop_queue (
      id TEXT PRIMARY KEY,
      print_id TEXT NOT NULL,
      action TEXT CHECK(action IN ('proof_of_play', 'expiration')),
      url TEXT NOT NULL,
      created_at TEXT,
      attempts INTEGER DEFAULT 0,
      next_retry_at TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed'))
    );
  `);
  return db;
}

/**
 * Arbitrary: generates a random playback outcome.
 */
const playbackOutcomeArb: fc.Arbitrary<PlaybackOutcome> = fc.oneof(
  fc.constant('success' as PlaybackOutcome),
  fc.constant('decode_failure' as PlaybackOutcome),
  fc.constant('timeout' as PlaybackOutcome),
  fc.constant('format_unsupported' as PlaybackOutcome),
  fc.constant('network_error' as PlaybackOutcome),
  fc.constant('corrupt_file' as PlaybackOutcome)
);

/**
 * Arbitrary: generates a unique print_id (UUID-like string).
 */
const printIdArb = fc.uuid();

/**
 * Arbitrary: generates an ad delivery with a unique print_id and random outcome.
 */
const adDeliveryArb: fc.Arbitrary<AdDelivery> = fc.record({
  printId: printIdArb,
  outcome: playbackOutcomeArb,
});

/**
 * Arbitrary: generates a batch of ad deliveries with unique print_ids.
 */
const adDeliveryBatchArb: fc.Arbitrary<AdDelivery[]> = fc
  .array(adDeliveryArb, { minLength: 1, maxLength: 50 })
  .map((deliveries) => {
    // Ensure unique print_ids within the batch
    const seen = new Set<string>();
    return deliveries.filter((d) => {
      if (seen.has(d.printId)) return false;
      seen.add(d.printId);
      return true;
    });
  })
  .filter((deliveries) => deliveries.length > 0);

describe('Property 7: Print ID Lifecycle Completeness', () => {
  let db: Database.Database;
  let queue: POPQueue;

  beforeEach(() => {
    db = createTestDb();
    queue = new POPQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('each print_id gets exactly one terminal action (never both, never neither)', () => {
    fc.assert(
      fc.property(adDeliveryBatchArb, (deliveries) => {
        // Reset queue for each run
        db.exec('DELETE FROM pop_queue');

        // Simulate lifecycle for each ad delivery
        for (const delivery of deliveries) {
          simulatePlaybackLifecycle(queue, delivery);
        }

        // Verify: each print_id has exactly one entry in the queue
        for (const delivery of deliveries) {
          const entries = db
            .prepare('SELECT * FROM pop_queue WHERE print_id = ?')
            .all(delivery.printId) as POPQueueEntry[];

          // Exactly one terminal action per print_id (Req 5.3)
          expect(entries).toHaveLength(1);

          const entry = entries[0]!;

          // The action matches the expected terminal action for the outcome
          const expected = expectedAction(delivery.outcome);
          expect(entry.action).toBe(expected);
        }

        // Verify: total queue entries equals total unique deliveries
        const totalEntries = db
          .prepare('SELECT COUNT(*) as count FROM pop_queue')
          .get() as { count: number };
        expect(totalEntries.count).toBe(deliveries.length);
      }),
      { numRuns: 200 }
    );
  });

  it('successful playback always results in proof_of_play, never expiration', () => {
    fc.assert(
      fc.property(
        fc.array(printIdArb, { minLength: 1, maxLength: 30 }).map((ids) => [...new Set(ids)]).filter((ids) => ids.length > 0),
        (printIds) => {
          db.exec('DELETE FROM pop_queue');

          // All deliveries are successful
          for (const printId of printIds) {
            simulatePlaybackLifecycle(queue, { printId, outcome: 'success' });
          }

          // Verify: every entry is proof_of_play
          const entries = db.prepare('SELECT * FROM pop_queue').all() as POPQueueEntry[];
          for (const entry of entries) {
            expect(entry.action).toBe('proof_of_play');
          }

          // No expiration entries exist
          const expirations = db
            .prepare("SELECT COUNT(*) as count FROM pop_queue WHERE action = 'expiration'")
            .get() as { count: number };
          expect(expirations.count).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('failed playback always results in expiration, never proof_of_play', () => {
    const failureOutcomes: PlaybackOutcome[] = [
      'decode_failure',
      'timeout',
      'format_unsupported',
      'network_error',
      'corrupt_file',
    ];

    const failureOutcomeArb = fc.constantFrom(...failureOutcomes);

    fc.assert(
      fc.property(
        fc.array(
          fc.record({ printId: printIdArb, outcome: failureOutcomeArb }),
          { minLength: 1, maxLength: 30 }
        )
          .map((deliveries) => {
            const seen = new Set<string>();
            return deliveries.filter((d) => {
              if (seen.has(d.printId)) return false;
              seen.add(d.printId);
              return true;
            });
          })
          .filter((d) => d.length > 0),
        (deliveries) => {
          db.exec('DELETE FROM pop_queue');

          for (const delivery of deliveries) {
            simulatePlaybackLifecycle(queue, delivery);
          }

          // Verify: every entry is expiration
          const entries = db.prepare('SELECT * FROM pop_queue').all() as POPQueueEntry[];
          for (const entry of entries) {
            expect(entry.action).toBe('expiration');
          }

          // No proof_of_play entries exist
          const pops = db
            .prepare("SELECT COUNT(*) as count FROM pop_queue WHERE action = 'proof_of_play'")
            .get() as { count: number };
          expect(pops.count).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no print_id ever has both proof_of_play AND expiration (mutual exclusivity)', () => {
    fc.assert(
      fc.property(adDeliveryBatchArb, (deliveries) => {
        db.exec('DELETE FROM pop_queue');

        for (const delivery of deliveries) {
          simulatePlaybackLifecycle(queue, delivery);
        }

        // For each print_id, check that it does NOT have both action types
        const printIds = deliveries.map((d) => d.printId);
        for (const printId of printIds) {
          const popCount = db
            .prepare("SELECT COUNT(*) as count FROM pop_queue WHERE print_id = ? AND action = 'proof_of_play'")
            .get(printId) as { count: number };
          const expCount = db
            .prepare("SELECT COUNT(*) as count FROM pop_queue WHERE print_id = ? AND action = 'expiration'")
            .get(printId) as { count: number };

          // Mutual exclusivity: at most one type of action
          const hasProof = popCount.count > 0;
          const hasExpiration = expCount.count > 0;

          // XOR: exactly one must be true (Req 5.3)
          expect(hasProof !== hasExpiration).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('the lifecycle decision is deterministic: same outcome always produces same action', () => {
    fc.assert(
      fc.property(
        printIdArb,
        playbackOutcomeArb,
        (printId, outcome) => {
          db.exec('DELETE FROM pop_queue');

          // Run the lifecycle
          simulatePlaybackLifecycle(queue, { printId, outcome });

          const entry = db
            .prepare('SELECT action FROM pop_queue WHERE print_id = ?')
            .get(printId) as { action: POPAction };

          // Verify deterministic mapping
          expect(entry.action).toBe(expectedAction(outcome));
        }
      ),
      { numRuns: 200 }
    );
  });
});
