import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoopEngine } from '../../src/engine/LoopEngine';
import type { ContentSource, PreparedContent, SourceType } from '../../src/sources/types';
import type { FallbackBuffer } from '../../src/sources/FallbackBuffer';
import type { LoopConfig, SlotConfig } from '../../src/storage/types';

/**
 * Tests for LoopEngine — fixed-slot sequential execution engine.
 *
 * Validates: Requirements 7.1, 7.3, 7.8, 6.1, 6.2
 */

// --- Helpers ---

function makePreparedContent(id: string, source: SourceType = 'prodooh', duration = 5): PreparedContent {
  return {
    id,
    type: 'image',
    source,
    mediaUrl: `/media/${id}.jpg`,
    duration,
    metadata: {},
  };
}

function createMockSource(sourceId: SourceType, available = true, content?: PreparedContent, duration = 1): ContentSource {
  const defaultContent = content ?? makePreparedContent(`${sourceId}-content`, sourceId, duration);
  return {
    id: sourceId,
    prefetch: vi.fn(async () => (available ? defaultContent : null)),
    confirmPlay: vi.fn(async () => {}),
    reportFailure: vi.fn(async () => {}),
    isAvailable: vi.fn(() => available),
  };
}

function createMockFallbackBuffer(): FallbackBuffer {
  let callCount = 0;
  return {
    getNext: vi.fn(() => {
      callCount++;
      return makePreparedContent(`fallback-${callCount}`, 'playlist', 5);
    }),
    hasContent: vi.fn(() => true),
    getSize: vi.fn(() => 1),
    replenish: vi.fn(async () => {}),
  } as unknown as FallbackBuffer;
}

function makeLoopConfig(slots: SlotConfig[]): LoopConfig {
  const totalDuration = slots.reduce((sum, s) => sum + s.duration, 0);
  return {
    slots,
    total_duration: totalDuration,
    version: '1.0.0',
  };
}

function makeSlot(position: number, source: SourceType, duration = 5): SlotConfig {
  return { position, source, duration };
}

describe('LoopEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor and initial state', () => {
    it('should initialize with currentIndex at 0', () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh')]);
      const sources = new Map<SourceType, ContentSource>();
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      expect(engine.getCurrentSlotIndex()).toBe(0);
      expect(engine.isRunning()).toBe(false);
      expect(engine.getCurrentContent()).toBeNull();
    });
  });

  describe('run() — sequential slot execution', () => {
    it('should execute slots in strict sequential order', async () => {
      const slots = [
        makeSlot(0, 'prodooh', 1),
        makeSlot(1, 'gam', 1),
        makeSlot(2, 'url', 1),
      ];
      const config = makeLoopConfig(slots);

      const prodoohSource = createMockSource('prodooh');
      const gamSource = createMockSource('gam');
      const urlSource = createMockSource('url');

      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', prodoohSource],
        ['gam', gamSource],
        ['url', urlSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      // Start the loop (non-blocking)
      const runPromise = engine.run();

      // Let the first slot start (prefetch is async — flush microtasks)
      await vi.advanceTimersByTimeAsync(0);

      // First slot plays (prodooh)
      expect(playedContent.length).toBe(1);
      expect(playedContent[0]!.source).toBe('prodooh');
      expect(engine.getCurrentSlotIndex()).toBe(0);

      // Advance past first slot duration (content.duration=1 → 1000ms)
      // Then flush microtasks for confirmPlay + next prefetch
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Second slot plays (gam)
      expect(playedContent.length).toBe(2);
      expect(playedContent[1]!.source).toBe('gam');
      expect(engine.getCurrentSlotIndex()).toBe(1);

      // Advance past second slot duration
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Third slot plays (url)
      expect(playedContent.length).toBe(3);
      expect(playedContent[2]!.source).toBe('url');
      expect(engine.getCurrentSlotIndex()).toBe(2);

      // Advance past third slot — should wrap around to 0
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      expect(playedContent.length).toBe(4);
      expect(playedContent[3]!.source).toBe('prodooh');
      expect(engine.getCurrentSlotIndex()).toBe(0);

      engine.stop();
      await runPromise;
    });

    it('should set isRunning to true after run() is called', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 10)]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(engine.isRunning()).toBe(true);

      engine.stop();
      await runPromise;
    });

    it('should call onPlay callback for each slot', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 1)]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const onPlay = vi.fn();

      const engine = new LoopEngine({ config, sources, fallbackBuffer, onPlay });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(onPlay).toHaveBeenCalledTimes(1);
      expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ source: 'prodooh' }));

      engine.stop();
      await runPromise;
    });

    it('should call confirmPlay after slot duration elapses', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 2), makeSlot(1, 'gam', 2)]);
      const prodoohSource = createMockSource('prodooh');
      const gamSource = createMockSource('gam');
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', prodoohSource],
        ['gam', gamSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // confirmPlay should not have been called yet (slot is still playing)
      expect(prodoohSource.confirmPlay).not.toHaveBeenCalled();

      // Advance past first slot (content.duration=1 → 1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Now confirmPlay should have been called for the prodooh content
      expect(prodoohSource.confirmPlay).toHaveBeenCalledTimes(1);

      engine.stop();
      await runPromise;
    });

    it('should NOT call confirmPlay for playlist-sourced content', async () => {
      // If the content source is 'playlist', we skip confirmPlay
      const playlistContent = makePreparedContent('pl-item', 'playlist', 1);
      const playlistSource = createMockSource('playlist', true, playlistContent);
      const config = makeLoopConfig([makeSlot(0, 'playlist', 1), makeSlot(1, 'prodooh', 1)]);
      const prodoohSource = createMockSource('prodooh');
      const sources = new Map<SourceType, ContentSource>([
        ['playlist', playlistSource],
        ['prodooh', prodoohSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // First slot is playlist
      await vi.advanceTimersByTimeAsync(1000);

      // confirmPlay should NOT be called on playlist source
      expect(playlistSource.confirmPlay).not.toHaveBeenCalled();

      engine.stop();
      await runPromise;
    });
  });

  describe('source failure → fallback buffer', () => {
    it('should use fallback when source returns null', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 1)]);
      const failingSource = createMockSource('prodooh', true);
      (failingSource.prefetch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', failingSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(playedContent.length).toBe(1);
      expect(playedContent[0]!.source).toBe('playlist');
      expect(fallbackBuffer.getNext).toHaveBeenCalled();

      engine.stop();
      await runPromise;
    });

    it('should use fallback when source is not available', async () => {
      const config = makeLoopConfig([makeSlot(0, 'gam', 1)]);
      const unavailableSource = createMockSource('gam', false);

      const sources = new Map<SourceType, ContentSource>([
        ['gam', unavailableSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(playedContent.length).toBe(1);
      expect(playedContent[0]!.source).toBe('playlist');
      expect(unavailableSource.prefetch).not.toHaveBeenCalled();

      engine.stop();
      await runPromise;
    });

    it('should use fallback when source throws an error', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 1)]);
      const errorSource = createMockSource('prodooh', true);
      (errorSource.prefetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network timeout'));

      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', errorSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(playedContent.length).toBe(1);
      expect(playedContent[0]!.source).toBe('playlist');

      engine.stop();
      await runPromise;
    });

    it('should use fallback when source is not in the sources map', async () => {
      const config = makeLoopConfig([makeSlot(0, 'url', 1)]);
      // No 'url' source registered
      const sources = new Map<SourceType, ContentSource>();
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(playedContent.length).toBe(1);
      expect(playedContent[0]!.source).toBe('playlist');

      engine.stop();
      await runPromise;
    });
  });

  describe('updateConfig() — hot config update', () => {
    it('should apply new config on next iteration', async () => {
      const config = makeLoopConfig([
        makeSlot(0, 'prodooh', 1),
        makeSlot(1, 'gam', 1),
      ]);
      const prodoohSource = createMockSource('prodooh');
      const gamSource = createMockSource('gam');
      const urlSource = createMockSource('url');

      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', prodoohSource],
        ['gam', gamSource],
        ['url', urlSource],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // First slot: prodooh
      expect(playedContent[0]!.source).toBe('prodooh');

      // Update config to use 'url' as second slot
      const newConfig = makeLoopConfig([
        makeSlot(0, 'prodooh', 1),
        makeSlot(1, 'url', 1),
      ]);
      engine.updateConfig(newConfig);

      // Advance past first slot (content.duration=1 → 1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Second slot should now be 'url' (from new config)
      expect(playedContent[1]!.source).toBe('url');

      engine.stop();
      await runPromise;
    });

    it('should reset currentIndex if new config has fewer slots', async () => {
      const config = makeLoopConfig([
        makeSlot(0, 'prodooh', 1),
        makeSlot(1, 'gam', 1),
        makeSlot(2, 'url', 1),
      ]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
        ['gam', createMockSource('gam')],
        ['url', createMockSource('url')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // Advance to slot index 2 (need to complete slot 0 and slot 1)
      await vi.advanceTimersByTimeAsync(1000); // complete slot 0
      await vi.advanceTimersByTimeAsync(0);    // flush microtasks
      await vi.advanceTimersByTimeAsync(1000); // complete slot 1
      await vi.advanceTimersByTimeAsync(0);    // flush microtasks

      expect(engine.getCurrentSlotIndex()).toBe(2);

      // Update config to have only 1 slot — index must reset
      const newConfig = makeLoopConfig([makeSlot(0, 'prodooh', 1)]);
      engine.updateConfig(newConfig);

      expect(engine.getCurrentSlotIndex()).toBe(0);

      engine.stop();
      await runPromise;
    });
  });

  describe('stop() — graceful halt', () => {
    it('should stop the loop and resolve run()', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 10)]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(engine.isRunning()).toBe(true);

      engine.stop();

      expect(engine.isRunning()).toBe(false);
      await runPromise; // Should resolve immediately
    });

    it('should not execute more slots after stop()', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 1)]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedContent: PreparedContent[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedContent.push(content),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(playedContent.length).toBe(1);

      engine.stop();
      await runPromise;

      // Advance more time — no new content should play
      await vi.advanceTimersByTimeAsync(5000);
      expect(playedContent.length).toBe(1);
    });

    it('should cancel pending timers when stop() is called mid-slot', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 10)]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // Stop in the middle of a slot (at 3s of 10s)
      await vi.advanceTimersByTimeAsync(3000);
      engine.stop();
      await runPromise;

      expect(engine.isRunning()).toBe(false);
    });

    it('run() should be a no-op if already running', async () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 1)]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const onPlay = vi.fn();

      const engine = new LoopEngine({ config, sources, fallbackBuffer, onPlay });

      const runPromise1 = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // Calling run() again should return immediately
      const runPromise2 = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(onPlay).toHaveBeenCalledTimes(1); // Only one slot started

      engine.stop();
      await runPromise1;
      await runPromise2;
    });
  });

  describe('getCurrentContent()', () => {
    it('should return the currently playing content', async () => {
      const content = makePreparedContent('test-content', 'prodooh', 5);
      const source = createMockSource('prodooh', true, content);
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 5)]);
      const sources = new Map<SourceType, ContentSource>([['prodooh', source]]);
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      expect(engine.getCurrentContent()).toEqual(content);

      engine.stop();
      await runPromise;
    });

    it('should return null before run() is called', () => {
      const config = makeLoopConfig([makeSlot(0, 'prodooh', 5)]);
      const sources = new Map<SourceType, ContentSource>();
      const fallbackBuffer = createMockFallbackBuffer();

      const engine = new LoopEngine({ config, sources, fallbackBuffer });

      expect(engine.getCurrentContent()).toBeNull();
    });
  });

  describe('wrap-around behavior', () => {
    it('should wrap back to slot 0 after the last slot', async () => {
      const config = makeLoopConfig([
        makeSlot(0, 'prodooh', 1),
        makeSlot(1, 'gam', 1),
      ]);
      const sources = new Map<SourceType, ContentSource>([
        ['prodooh', createMockSource('prodooh')],
        ['gam', createMockSource('gam')],
      ]);
      const fallbackBuffer = createMockFallbackBuffer();
      const playedSources: SourceType[] = [];

      const engine = new LoopEngine({
        config,
        sources,
        fallbackBuffer,
        onPlay: (content) => playedSources.push(content.source),
      });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // Slot 0: prodooh
      expect(playedSources[0]).toBe('prodooh');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Slot 1: gam
      expect(playedSources[1]).toBe('gam');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Slot 0 again: prodooh (wrap around)
      expect(playedSources[2]).toBe('prodooh');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      // Slot 1 again: gam
      expect(playedSources[3]).toBe('gam');

      engine.stop();
      await runPromise;
    });
  });

  describe('empty slots config', () => {
    it('should wait and retry when config has no slots', async () => {
      const config = makeLoopConfig([]);
      const sources = new Map<SourceType, ContentSource>();
      const fallbackBuffer = createMockFallbackBuffer();
      const onPlay = vi.fn();

      const engine = new LoopEngine({ config, sources, fallbackBuffer, onPlay });

      const runPromise = engine.run();
      await vi.advanceTimersByTimeAsync(0);

      // No content should play
      expect(onPlay).not.toHaveBeenCalled();

      // Advance 1s — the retry interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(onPlay).not.toHaveBeenCalled();

      // Now update config with a real slot
      engine.updateConfig(makeLoopConfig([makeSlot(0, 'prodooh', 1)]));
      const prodoohSource = createMockSource('prodooh');
      sources.set('prodooh', prodoohSource);

      // Advance another retry
      await vi.advanceTimersByTimeAsync(1000);
      expect(onPlay).toHaveBeenCalledTimes(1);

      engine.stop();
      await runPromise;
    });
  });
});
