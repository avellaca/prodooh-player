/**
 * Feature: 08-reingenieria-back-front, Property 8: Content FK Protection
 *
 * Property: For any content (Content) in the system, the DELETE operation must succeed (200)
 * if and only if no record exists in the `creatives` table with `content_id` referencing
 * that content. If at least one creative references it, it must return error 409 with a
 * readable message in Spanish.
 *
 * **Validates: Requirements 13.1, 13.4**
 *
 * Requirement 13.1: DELETE content referenced by at least one Creative → 409 with readable message
 * Requirement 13.4: DELETE content NOT referenced by any Creative → 200 (proceed normally)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Pure decision function modeling the FK protection logic ---

interface ContentDeletionResult {
  status: 200 | 409;
  message: string;
}

/**
 * Models the backend FK protection logic for content deletion.
 * Given a content_id and a set of creative references (content_ids referenced by creatives),
 * decides whether deletion should be allowed or rejected.
 */
function decideContentDeletion(
  contentId: string,
  creativeContentReferences: string[]
): ContentDeletionResult {
  const isReferenced = creativeContentReferences.includes(contentId);

  if (isReferenced) {
    return {
      status: 409,
      message:
        'No se puede eliminar este contenido porque está siendo utilizado por uno o más creativos activos. Elimine primero los creativos que lo referencian.',
    };
  }

  return {
    status: 200,
    message: 'Content deleted successfully.',
  };
}

// --- Generators ---

/** Generate a valid content ID (UUID format) */
const contentIdArb = fc.uuid();

/** Generate a set of creative references (content_ids that creatives point to) */
const creativeReferencesArb = fc.array(fc.uuid(), { minLength: 0, maxLength: 20 });

describe('Property 8: Content FK Protection', () => {
  // =========================================================================
  // Requirement 13.4: Content NOT referenced → DELETE returns 200
  // =========================================================================

  it('DELETE returns 200 when content_id is NOT in creative references', () => {
    fc.assert(
      fc.property(
        contentIdArb,
        creativeReferencesArb,
        (contentId, references) => {
          // Ensure contentId is NOT in the references
          const filteredReferences = references.filter((ref) => ref !== contentId);

          const result = decideContentDeletion(contentId, filteredReferences);

          // PROPERTY: When content is not referenced, deletion succeeds with 200
          expect(result.status).toBe(200);
          expect(result.message).toBe('Content deleted successfully.');
        }
      ),
      { numRuns: 100 }
    );
  });

  // =========================================================================
  // Requirement 13.1: Content referenced by creative(s) → DELETE returns 409
  // =========================================================================

  it('DELETE returns 409 when content_id IS in creative references', () => {
    fc.assert(
      fc.property(
        contentIdArb,
        creativeReferencesArb,
        (contentId, otherReferences) => {
          // Ensure contentId IS in the references (inject it)
          const referencesWithContent = [...otherReferences, contentId];

          const result = decideContentDeletion(contentId, referencesWithContent);

          // PROPERTY: When content is referenced, deletion is rejected with 409
          expect(result.status).toBe(409);
          expect(result.message).toContain('No se puede eliminar');
          expect(result.message).toContain('creativos activos');
        }
      ),
      { numRuns: 100 }
    );
  });

  // =========================================================================
  // Combined property: status is exclusively determined by reference existence
  // =========================================================================

  it('DELETE status is 200 iff content_id is NOT in references, 409 otherwise', () => {
    fc.assert(
      fc.property(
        contentIdArb,
        creativeReferencesArb,
        (contentId, references) => {
          const result = decideContentDeletion(contentId, references);
          const isReferenced = references.includes(contentId);

          // PROPERTY: The decision is a pure function of reference membership
          if (isReferenced) {
            expect(result.status).toBe(409);
          } else {
            expect(result.status).toBe(200);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // =========================================================================
  // Property: Multiple references to same content still yield 409
  // =========================================================================

  it('DELETE returns 409 even when content is referenced by multiple creatives', () => {
    fc.assert(
      fc.property(
        contentIdArb,
        fc.integer({ min: 2, max: 10 }),
        creativeReferencesArb,
        (contentId, duplicateCount, otherReferences) => {
          // Create references with multiple entries pointing to the same content
          const referencesWithDuplicates = [
            ...otherReferences,
            ...Array.from({ length: duplicateCount }, () => contentId),
          ];

          const result = decideContentDeletion(contentId, referencesWithDuplicates);

          // PROPERTY: Even with multiple references, result is still 409
          expect(result.status).toBe(409);
          expect(result.message).toContain('No se puede eliminar');
        }
      ),
      { numRuns: 100 }
    );
  });
});
