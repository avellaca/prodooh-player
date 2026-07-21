/**
 * Feature: 13-creatives-enhancements, Property 10: Búsqueda en biblioteca filtra por tags, nombre y dimensiones
 *
 * For any set of Content items with tags and any search query, the filtered results
 * SHALL include only Content where the query matches as substring in at least one of:
 * filename, tag name, or dimensions string (WxH).
 *
 * **Validates: Requirements 2.1, 18.2**
 *
 * Requirement 2.1: Search by Tags, filename and dimensions in library selector
 * Requirement 18.2: Filter results by match in Tags, filename and dimensions
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { matchesSearch } from '../orders/components/LibrarySelectorModal';
import type { Content, Tag } from '@/types/models';

// --- Generators ---

/** Generate a valid ISO date string (constrained to valid date range) */
const isoDateArb = fc
  .integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31 as timestamps
  .map((ts) => new Date(ts).toISOString());

/** Generate a valid Tag */
const tagArb = fc.record({
  id: fc.uuid(),
  tenant_id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  created_at: isoDateArb,
});

/** Generate an array of tags (0 to 5) */
const tagsArb = fc.array(tagArb, { minLength: 0, maxLength: 5 });

/** Generate a valid Content item with optional tags */
const contentArb = (tags?: fc.Arbitrary<Tag[]>) =>
  fc.record({
    id: fc.uuid(),
    tenant_id: fc.uuid(),
    filename: fc.string({ minLength: 1, maxLength: 100 }),
    mime_type: fc.constantFrom('image/png', 'image/jpeg', 'video/mp4'),
    storage_path: fc.string({ minLength: 1, maxLength: 200 }),
    file_size_bytes: fc.integer({ min: 1024, max: 10_000_000 }),
    width: fc.integer({ min: 1, max: 7680 }),
    height: fc.integer({ min: 1, max: 4320 }),
    duration_seconds: fc.option(fc.integer({ min: 1, max: 3600 }), { nil: null }),
    orientation: fc.constantFrom('landscape', 'portrait'),
    rotation: fc.constantFrom(0, 90, 180, 270),
    created_at: isoDateArb,
    tags: tags ?? tagsArb,
  });

/** Generate a non-empty search query */
const searchQueryArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

describe('Property 10: Búsqueda en biblioteca filtra por tags, nombre y dimensiones', () => {
  // =========================================================================
  // Property: Empty query matches everything
  // =========================================================================
  describe('Empty query returns all content', () => {
    it('matchesSearch returns true for any content when query is empty', () => {
      fc.assert(
        fc.property(contentArb(), (content) => {
          expect(matchesSearch(content, '')).toBe(true);
          expect(matchesSearch(content, '   ')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Filename substring always matches
  // =========================================================================
  describe('Filename substring match', () => {
    it('any substring of the filename causes a match', () => {
      fc.assert(
        fc.property(
          contentArb(),
          fc.integer({ min: 0 }),
          fc.integer({ min: 1, max: 10 }),
          (content, startOffset, length) => {
            const filename = content.filename;
            if (filename.length === 0) return; // skip empty filenames

            const start = startOffset % filename.length;
            const end = Math.min(start + length, filename.length);
            const substring = filename.slice(start, end);

            if (substring.trim().length === 0) return; // skip whitespace-only substrings

            expect(matchesSearch(content, substring)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Dimensions string match (WxH format)
  // =========================================================================
  describe('Dimensions string match', () => {
    it('searching for the exact dimensions string (WxH) always matches', () => {
      fc.assert(
        fc.property(contentArb(), (content) => {
          const dims = `${content.width}x${content.height}`;
          expect(matchesSearch(content, dims)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('searching for a substring of dimensions always matches', () => {
      fc.assert(
        fc.property(contentArb(), (content) => {
          // Partial dimension queries (e.g., just width or "x" + height)
          const widthStr = `${content.width}`;
          const heightStr = `${content.height}`;
          const dims = `${content.width}x${content.height}`;

          // Width substring
          if (dims.includes(widthStr)) {
            expect(matchesSearch(content, widthStr)).toBe(true);
          }
          // Height substring - only matches if it's a substring of the dims string
          if (dims.includes(heightStr)) {
            expect(matchesSearch(content, heightStr)).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Tag name match
  // =========================================================================
  describe('Tag name match', () => {
    it('searching for any tag name (or substring) matches the content', () => {
      const contentWithTagsArb = contentArb(
        fc.array(tagArb, { minLength: 1, maxLength: 5 })
      );

      fc.assert(
        fc.property(contentWithTagsArb, (content) => {
          const tags = content.tags!;
          if (tags.length === 0) return;

          // Pick a random tag and use its name as query
          const tag = tags[0]!;
          if (tag.name.trim().length === 0) return;

          expect(matchesSearch(content, tag.name)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('searching for a substring of a tag name matches the content', () => {
      const contentWithTagsArb = contentArb(
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenant_id: fc.uuid(),
            name: fc.string({ minLength: 3, maxLength: 50 }),
            created_at: isoDateArb,
          }),
          { minLength: 1, maxLength: 5 }
        )
      );

      fc.assert(
        fc.property(contentWithTagsArb, (content) => {
          const tags = content.tags!;
          const tag = tags[0]!;
          if (tag.name.trim().length < 2) return;

          // Take a 2-char substring from the tag name
          const substring = tag.name.slice(0, 2);
          if (substring.trim().length === 0) return;

          expect(matchesSearch(content, substring)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Non-matching query does NOT match
  // =========================================================================
  describe('Non-matching query exclusion', () => {
    it('a query that is NOT a substring of filename, dimensions, or any tag name does NOT match', () => {
      fc.assert(
        fc.property(contentArb(), (content) => {
          // Build a query guaranteed not to appear in filename, dimensions, or tags
          const uniqueSuffix = '🦄🎯🔮';
          const query = uniqueSuffix;

          const filename = content.filename.toLowerCase();
          const dims = `${content.width}x${content.height}`;
          const tagNames = (content.tags ?? []).map((t) => t.name.toLowerCase());

          // Verify our crafted query does not match any field
          const matchesFilename = filename.includes(query.toLowerCase());
          const matchesDims = dims.includes(query.toLowerCase());
          const matchesTags = tagNames.some((n) => n.includes(query.toLowerCase()));

          if (!matchesFilename && !matchesDims && !matchesTags) {
            expect(matchesSearch(content, query)).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Search is case-insensitive
  // =========================================================================
  describe('Case-insensitive search', () => {
    it('search is case-insensitive for filename', () => {
      fc.assert(
        fc.property(
          contentArb(),
          (content) => {
            if (content.filename.trim().length === 0) return;

            const upper = content.filename.toUpperCase();
            const lower = content.filename.toLowerCase();

            // Both upper and lower case versions should produce same result
            expect(matchesSearch(content, upper)).toBe(matchesSearch(content, lower));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('search is case-insensitive for tag names', () => {
      const contentWithTagsArb = contentArb(
        fc.array(
          fc.record({
            id: fc.uuid(),
            tenant_id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 50 }),
            created_at: isoDateArb,
          }),
          { minLength: 1, maxLength: 3 }
        )
      );

      fc.assert(
        fc.property(contentWithTagsArb, (content) => {
          const tags = content.tags!;
          if (tags.length === 0) return;
          const tagName = tags[0]!.name;
          if (tagName.trim().length === 0) return;

          expect(matchesSearch(content, tagName.toUpperCase())).toBe(
            matchesSearch(content, tagName.toLowerCase())
          );
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Content without tags only matches by filename or dimensions
  // =========================================================================
  describe('Content without tags', () => {
    it('content with no tags only matches if query is substring of filename or dimensions', () => {
      const contentNoTagsArb = contentArb(fc.constant(undefined as unknown as Tag[]));

      fc.assert(
        fc.property(contentNoTagsArb, searchQueryArb, (content, query) => {
          // Override tags to be undefined
          const contentWithoutTags = { ...content, tags: undefined };
          const q = query.toLowerCase().trim();

          const filenameMatch = contentWithoutTags.filename.toLowerCase().includes(q);
          const dimsMatch = `${contentWithoutTags.width}x${contentWithoutTags.height}`.includes(q);

          const expected = filenameMatch || dimsMatch;
          expect(matchesSearch(contentWithoutTags, query)).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: Filtered results are sound — every result matches
  // =========================================================================
  describe('Filter soundness over a list of content', () => {
    it('filtering a list of content items returns ONLY items that match the query in at least one field', () => {
      const contentListArb = fc.array(contentArb(), { minLength: 1, maxLength: 20 });

      fc.assert(
        fc.property(contentListArb, searchQueryArb, (contents, query) => {
          const q = query.toLowerCase().trim();
          const filtered = contents.filter((c) => matchesSearch(c, query));

          for (const content of filtered) {
            const filenameMatch = content.filename.toLowerCase().includes(q);
            const dimsMatch = `${content.width}x${content.height}`.includes(q);
            const tagMatch = (content.tags ?? []).some((t) =>
              t.name.toLowerCase().includes(q)
            );

            // Every filtered item must match at least one field
            expect(filenameMatch || dimsMatch || tagMatch).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('filtering a list of content items does NOT exclude any items that should match', () => {
      const contentListArb = fc.array(contentArb(), { minLength: 1, maxLength: 20 });

      fc.assert(
        fc.property(contentListArb, searchQueryArb, (contents, query) => {
          const q = query.toLowerCase().trim();
          const filtered = contents.filter((c) => matchesSearch(c, query));
          const excluded = contents.filter((c) => !matchesSearch(c, query));

          for (const content of excluded) {
            const filenameMatch = content.filename.toLowerCase().includes(q);
            const dimsMatch = `${content.width}x${content.height}`.includes(q);
            const tagMatch = (content.tags ?? []).some((t) =>
              t.name.toLowerCase().includes(q)
            );

            // Every excluded item must NOT match any field
            expect(filenameMatch || dimsMatch || tagMatch).toBe(false);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
