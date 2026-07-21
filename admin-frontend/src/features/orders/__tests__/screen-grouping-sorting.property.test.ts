/**
 * Property Tests for Screen Grouping, Sorting and Filtering (Properties 11, 12, 19, 20)
 *
 * Property 11: Agrupación de pantallas por resolución
 * For any set of screens, the "Por Resolución" grouping SHALL produce exactly one group
 * per unique (resolution_width, resolution_height), and each screen appears in exactly one group.
 *
 * Property 12: Agrupación de pantallas por ScreenGroup
 * For any set of screens, the "Por Grupo" grouping SHALL produce one group per distinct
 * ScreenGroup plus a "Sin grupo" section for screens without a group.
 *
 * Property 19: Ordenamiento de pantallas
 * Sorting by name/resolution produces correct order.
 *
 * Property 20: Filtro de pantallas por nombre
 * Search filters screens by name substring.
 *
 * **Validates: Requirements 4.2, 5.1, 5.2, 6.4, 6.5**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ResolutionGroup } from '../types';
import type { Screen, ScreenGroup } from '@/types/models';

// ─── Pure logic extracted from ByResolutionTab ──────────────────────────────────

/**
 * Groups screens by resolution — mirrors the data structure returned by the API
 * and rendered by ByResolutionTab. Each ResolutionGroup contains screens sharing
 * the same (resolution_width, resolution_height).
 */
function groupByResolution(
  screens: Array<{ id: string; name: string; target_id: string; resolution_width: number; resolution_height: number }>
): ResolutionGroup[] {
  const map = new Map<string, ResolutionGroup>();

  for (const screen of screens) {
    const key = `${screen.resolution_width}x${screen.resolution_height}`;
    if (!map.has(key)) {
      map.set(key, {
        resolution_width: screen.resolution_width,
        resolution_height: screen.resolution_height,
        screen_count: 0,
        screens: [],
        has_creative: false,
        coverage: { with_creative: 0, total: 0 },
      });
    }
    const group = map.get(key)!;
    group.screens.push({ id: screen.id, name: screen.name, target_id: screen.target_id });
    group.screen_count = group.screens.length;
    group.coverage.total = group.screens.length;
  }

  return Array.from(map.values());
}

// ─── Pure logic extracted from ByGroupTab ───────────────────────────────────────

interface ScreenGroupEntry {
  groupId: string | null;
  groupName: string;
  screens: Array<{ id: string; name: string; target_id: string; resolution_width: number; resolution_height: number }>;
}

/**
 * Groups screens by ScreenGroup — mirrors buildScreenGroups from ByGroupTab.
 */
function groupByScreenGroup(
  resolutions: ResolutionGroup[],
  allScreens: Screen[],
): ScreenGroupEntry[] {
  const screenMap = new Map<string, Screen>();
  for (const screen of allScreens) {
    screenMap.set(screen.id, screen);
  }

  const groupedMap = new Map<string | null, ScreenGroupEntry['screens']>();
  const groupNameMap = new Map<string | null, string>();

  for (const resolution of resolutions) {
    for (const resScreen of resolution.screens) {
      const fullScreen = screenMap.get(resScreen.id);
      const groupId = fullScreen?.group_id ?? null;
      const groupName = fullScreen?.screen_group?.name ?? 'Sin grupo';

      if (!groupedMap.has(groupId)) {
        groupedMap.set(groupId, []);
        groupNameMap.set(groupId, groupName);
      }

      groupedMap.get(groupId)!.push({
        id: resScreen.id,
        name: resScreen.name,
        target_id: resScreen.target_id,
        resolution_width: resolution.resolution_width,
        resolution_height: resolution.resolution_height,
      });
    }
  }

  const sortedKeys = Array.from(groupedMap.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const nameA = groupNameMap.get(a) ?? '';
    const nameB = groupNameMap.get(b) ?? '';
    return nameA.localeCompare(nameB);
  });

  return sortedKeys.map((key) => ({
    groupId: key,
    groupName: groupNameMap.get(key) ?? 'Sin grupo',
    screens: groupedMap.get(key) ?? [],
  }));
}

// ─── Pure logic extracted from ByScreenTab ──────────────────────────────────────

interface FlatScreen {
  id: string;
  name: string;
  target_id: string;
  resolution_width: number;
  resolution_height: number;
}

type SortOption = 'name-asc' | 'name-desc' | 'resolution-asc' | 'resolution-desc';

function flattenScreens(resolutions: ResolutionGroup[]): FlatScreen[] {
  return resolutions.flatMap((group) =>
    group.screens.map((screen) => ({
      id: screen.id,
      name: screen.name,
      target_id: screen.target_id,
      resolution_width: group.resolution_width,
      resolution_height: group.resolution_height,
    }))
  );
}

function filterScreensByName(screens: FlatScreen[], query: string): FlatScreen[] {
  if (!query.trim()) return screens;
  const q = query.toLowerCase().trim();
  return screens.filter((screen) => screen.name.toLowerCase().includes(q));
}

function sortScreens(screens: FlatScreen[], sortBy: SortOption): FlatScreen[] {
  const sorted = [...screens];
  switch (sortBy) {
    case 'name-asc':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'resolution-asc':
      sorted.sort((a, b) => {
        const aRes = a.resolution_width * a.resolution_height;
        const bRes = b.resolution_width * b.resolution_height;
        return aRes - bRes || a.name.localeCompare(b.name);
      });
      break;
    case 'resolution-desc':
      sorted.sort((a, b) => {
        const aRes = a.resolution_width * a.resolution_height;
        const bRes = b.resolution_width * b.resolution_height;
        return bRes - aRes || a.name.localeCompare(b.name);
      });
      break;
  }
  return sorted;
}

// ─── Generators ─────────────────────────────────────────────────────────────────

const resolutionArb = fc.record({
  width: fc.integer({ min: 320, max: 7680 }),
  height: fc.integer({ min: 240, max: 4320 }),
});

const screenArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  target_id: fc.uuid(),
}).chain((base) =>
  resolutionArb.map((res) => ({
    ...base,
    resolution_width: res.width,
    resolution_height: res.height,
  }))
);

const screenListArb = fc.array(screenArb, { minLength: 1, maxLength: 30 });

/** Generate a screen group assignment for testing groupByScreenGroup */
const screenGroupArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
});

/** Arbitrary that generates screens with optional group assignments */
function screensWithGroupsArb() {
  return fc.tuple(
    screenListArb,
    fc.array(screenGroupArb, { minLength: 0, maxLength: 5 }),
  ).chain(([screens, groups]) => {
    // Assign each screen randomly to a group or no group
    const assignments = fc.array(
      fc.integer({ min: -1, max: groups.length - 1 }),
      { minLength: screens.length, maxLength: screens.length },
    );
    return assignments.map((assigns) => ({ screens, groups, assigns }));
  });
}

// ─── Property Tests ─────────────────────────────────────────────────────────────

describe('Property 11: Agrupación de pantallas por resolución', () => {
  /**
   * Property 11a: The number of groups equals the number of unique resolutions.
   */
  it('produces exactly one group per unique (resolution_width, resolution_height)', () => {
    fc.assert(
      fc.property(screenListArb, (screens) => {
        const groups = groupByResolution(screens);

        // Count unique resolutions in input
        const uniqueResolutions = new Set(
          screens.map((s) => `${s.resolution_width}x${s.resolution_height}`)
        );

        expect(groups.length).toBe(uniqueResolutions.size);

        // Each group has unique resolution key
        const groupKeys = groups.map((g) => `${g.resolution_width}x${g.resolution_height}`);
        expect(new Set(groupKeys).size).toBe(groups.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 11b: Each screen appears in exactly one group whose dimensions match.
   */
  it('each screen appears in exactly one group with matching dimensions', () => {
    fc.assert(
      fc.property(screenListArb, (screens) => {
        const groups = groupByResolution(screens);

        // Collect all screen IDs across all groups
        const allGroupedScreenIds: string[] = [];
        for (const group of groups) {
          for (const screen of group.screens) {
            allGroupedScreenIds.push(screen.id);
          }
        }

        // Total count matches input
        expect(allGroupedScreenIds.length).toBe(screens.length);

        // Each screen from input appears exactly once
        for (const screen of screens) {
          const count = allGroupedScreenIds.filter((id) => id === screen.id).length;
          expect(count).toBe(1);

          // The group it belongs to has matching resolution
          const matchingGroup = groups.find((g) =>
            g.screens.some((s) => s.id === screen.id)
          );
          expect(matchingGroup).toBeDefined();
          expect(matchingGroup!.resolution_width).toBe(screen.resolution_width);
          expect(matchingGroup!.resolution_height).toBe(screen.resolution_height);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 12: Agrupación de pantallas por ScreenGroup', () => {
  /**
   * Property 12a: Produces one group per distinct ScreenGroup plus "Sin grupo" for ungrouped.
   */
  it('produces one group per distinct ScreenGroup plus Sin grupo for ungrouped screens', () => {
    fc.assert(
      fc.property(screensWithGroupsArb(), ({ screens, groups, assigns }) => {
        // Build full Screen objects with group assignments
        const fullScreens: Screen[] = screens.map((s, idx) => {
          const groupIdx = assigns[idx];
          const assignedGroup = groupIdx >= 0 ? groups[groupIdx] : undefined;
          return {
            id: s.id,
            tenant_id: 'tenant-1',
            group_id: assignedGroup?.id ?? null,
            venue_id: 'venue-1',
            name: s.name,
            status: 'online',
            enabled: true,
            orientation: 'landscape' as const,
            resolution_width: s.resolution_width,
            resolution_height: s.resolution_height,
            num_slots: null,
            ssp_slots: null,
            playlist_slots: null,
            schedule: null,
            last_heartbeat: null,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
            screen_group: assignedGroup ? {
              id: assignedGroup.id,
              tenant_id: 'tenant-1',
              name: assignedGroup.name,
              num_slots: null,
              ssp_slots: null,
              playlist_slots: null,
              duration_seconds: null,
              schedule: null,
              created_at: '2024-01-01',
            } : undefined,
          };
        });

        // Build ResolutionGroup[] from the screens (as the API would return)
        const resolutions = groupByResolution(screens);

        // Run the grouping function
        const result = groupByScreenGroup(resolutions, fullScreens);

        // Determine expected distinct groups
        const hasUngrouped = assigns.some((a) => a < 0);
        const usedGroupIds = new Set(
          assigns.filter((a) => a >= 0).map((a) => groups[a].id)
        );

        const expectedGroupCount = usedGroupIds.size + (hasUngrouped ? 1 : 0);
        expect(result.length).toBe(expectedGroupCount);

        // Verify "Sin grupo" section exists if there are ungrouped screens
        if (hasUngrouped) {
          const sinGrupo = result.find((g) => g.groupId === null);
          expect(sinGrupo).toBeDefined();
          expect(sinGrupo!.groupName).toBe('Sin grupo');
        }

        // Each screen appears in exactly one group entry
        const allScreenIds = result.flatMap((g) => g.screens.map((s) => s.id));
        expect(allScreenIds.length).toBe(screens.length);
        for (const screen of screens) {
          expect(allScreenIds.filter((id) => id === screen.id).length).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 12b: "Sin grupo" section appears last (null groupId sorted last).
   */
  it('Sin grupo section appears after named groups', () => {
    fc.assert(
      fc.property(screensWithGroupsArb(), ({ screens, groups, assigns }) => {
        const fullScreens: Screen[] = screens.map((s, idx) => {
          const groupIdx = assigns[idx];
          const assignedGroup = groupIdx >= 0 ? groups[groupIdx] : undefined;
          return {
            id: s.id,
            tenant_id: 'tenant-1',
            group_id: assignedGroup?.id ?? null,
            venue_id: 'venue-1',
            name: s.name,
            status: 'online',
            enabled: true,
            orientation: 'landscape' as const,
            resolution_width: s.resolution_width,
            resolution_height: s.resolution_height,
            num_slots: null,
            ssp_slots: null,
            playlist_slots: null,
            schedule: null,
            last_heartbeat: null,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
            screen_group: assignedGroup ? {
              id: assignedGroup.id,
              tenant_id: 'tenant-1',
              name: assignedGroup.name,
              num_slots: null,
              ssp_slots: null,
              playlist_slots: null,
              duration_seconds: null,
              schedule: null,
              created_at: '2024-01-01',
            } : undefined,
          };
        });

        const resolutions = groupByResolution(screens);
        const result = groupByScreenGroup(resolutions, fullScreens);

        // If "Sin grupo" exists, it must be the last entry
        const sinGrupoIdx = result.findIndex((g) => g.groupId === null);
        if (sinGrupoIdx >= 0) {
          expect(sinGrupoIdx).toBe(result.length - 1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 19: Ordenamiento de pantallas', () => {
  /**
   * Property 19a: Sorting by name-asc produces lexicographic order.
   */
  it('sorting by name-asc produces alphabetical order', () => {
    fc.assert(
      fc.property(screenListArb, (screens) => {
        const flat = flattenScreens(groupByResolution(screens));
        const sorted = sortScreens(flat, 'name-asc');

        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i - 1].name.localeCompare(sorted[i].name)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 19b: Sorting by name-desc produces reverse lexicographic order.
   */
  it('sorting by name-desc produces reverse alphabetical order', () => {
    fc.assert(
      fc.property(screenListArb, (screens) => {
        const flat = flattenScreens(groupByResolution(screens));
        const sorted = sortScreens(flat, 'name-desc');

        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i - 1].name.localeCompare(sorted[i].name)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 19c: Sorting by resolution-asc produces ascending pixel area order.
   */
  it('sorting by resolution-asc produces ascending resolution area', () => {
    fc.assert(
      fc.property(screenListArb, (screens) => {
        const flat = flattenScreens(groupByResolution(screens));
        const sorted = sortScreens(flat, 'resolution-asc');

        for (let i = 1; i < sorted.length; i++) {
          const prevArea = sorted[i - 1].resolution_width * sorted[i - 1].resolution_height;
          const currArea = sorted[i].resolution_width * sorted[i].resolution_height;
          if (prevArea === currArea) {
            // Tiebreaker: alphabetical by name
            expect(sorted[i - 1].name.localeCompare(sorted[i].name)).toBeLessThanOrEqual(0);
          } else {
            expect(prevArea).toBeLessThanOrEqual(currArea);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 19d: Sorting by resolution-desc produces descending pixel area order.
   */
  it('sorting by resolution-desc produces descending resolution area', () => {
    fc.assert(
      fc.property(screenListArb, (screens) => {
        const flat = flattenScreens(groupByResolution(screens));
        const sorted = sortScreens(flat, 'resolution-desc');

        for (let i = 1; i < sorted.length; i++) {
          const prevArea = sorted[i - 1].resolution_width * sorted[i - 1].resolution_height;
          const currArea = sorted[i].resolution_width * sorted[i].resolution_height;
          if (prevArea === currArea) {
            // Tiebreaker: alphabetical by name
            expect(sorted[i - 1].name.localeCompare(sorted[i].name)).toBeLessThanOrEqual(0);
          } else {
            expect(prevArea).toBeGreaterThanOrEqual(currArea);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 19e: Sorting preserves the same set of elements (no additions or removals).
   */
  it('sorting preserves all elements', () => {
    fc.assert(
      fc.property(
        screenListArb,
        fc.constantFrom('name-asc', 'name-desc', 'resolution-asc', 'resolution-desc') as fc.Arbitrary<SortOption>,
        (screens, sortOption) => {
          const flat = flattenScreens(groupByResolution(screens));
          const sorted = sortScreens(flat, sortOption);

          expect(sorted.length).toBe(flat.length);
          const originalIds = flat.map((s) => s.id).sort();
          const sortedIds = sorted.map((s) => s.id).sort();
          expect(sortedIds).toEqual(originalIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 20: Filtro de pantallas por nombre', () => {
  /**
   * Property 20a: All returned screens contain the search query as substring (case-insensitive).
   */
  it('all filtered screens contain the query as a substring of their name', () => {
    fc.assert(
      fc.property(
        screenListArb,
        fc.string({ minLength: 1, maxLength: 10 }),
        (screens, query) => {
          const flat = flattenScreens(groupByResolution(screens));
          const filtered = filterScreensByName(flat, query);

          for (const screen of filtered) {
            expect(screen.name.toLowerCase()).toContain(query.toLowerCase().trim());
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 20b: No screen that contains the query substring is excluded from results.
   */
  it('no matching screen is excluded from the filter results', () => {
    fc.assert(
      fc.property(
        screenListArb,
        fc.string({ minLength: 1, maxLength: 10 }),
        (screens, query) => {
          const flat = flattenScreens(groupByResolution(screens));
          const filtered = filterScreensByName(flat, query);
          const filteredIds = new Set(filtered.map((s) => s.id));
          const trimmedQuery = query.toLowerCase().trim();

          for (const screen of flat) {
            if (screen.name.toLowerCase().includes(trimmedQuery)) {
              expect(filteredIds.has(screen.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 20c: Empty/whitespace query returns all screens.
   */
  it('empty or whitespace-only query returns all screens', () => {
    fc.assert(
      fc.property(
        screenListArb,
        fc.constantFrom('', ' ', '  ', '\t'),
        (screens, query) => {
          const flat = flattenScreens(groupByResolution(screens));
          const filtered = filterScreensByName(flat, query);
          expect(filtered.length).toBe(flat.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 20d: Filter is case-insensitive — searching with different cases yields same results.
   */
  it('filtering is case-insensitive', () => {
    fc.assert(
      fc.property(
        screenListArb,
        fc.string({ minLength: 1, maxLength: 10 }),
        (screens, query) => {
          const flat = flattenScreens(groupByResolution(screens));
          const filteredLower = filterScreensByName(flat, query.toLowerCase());
          const filteredUpper = filterScreensByName(flat, query.toUpperCase());

          const idsLower = filteredLower.map((s) => s.id).sort();
          const idsUpper = filteredUpper.map((s) => s.id).sort();
          expect(idsLower).toEqual(idsUpper);
        },
      ),
      { numRuns: 50 },
    );
  });
});
