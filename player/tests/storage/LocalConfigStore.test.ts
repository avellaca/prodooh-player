import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalConfigStore } from '../../src/storage/LocalConfigStore';
import type { LoopConfig, ScheduleConfig } from '../../src/storage/types';

describe('LocalConfigStore', () => {
  let store: LocalConfigStore;

  beforeEach(() => {
    // Use in-memory SQLite for fast, isolated tests
    store = new LocalConfigStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('Schema initialization', () => {
    it('should create all required tables', () => {
      // Query SQLite master to verify tables exist
      const db = (store as any).db;
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all()
        .map((r: { name: string }) => r.name);

      expect(tables).toContain('device_config');
      expect(tables).toContain('loop_config');
      expect(tables).toContain('playlist');
      expect(tables).toContain('playlist_items');
      expect(tables).toContain('pop_queue');
      expect(tables).toContain('playback_log');
      expect(tables).toContain('schedule');
    });

    it('should be safe to call initSchema multiple times', () => {
      expect(() => store.initSchema()).not.toThrow();
      expect(() => store.initSchema()).not.toThrow();
    });
  });

  describe('Key-value config (device_config)', () => {
    it('should return null for a non-existent key', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    it('should set and get a config value', () => {
      store.set('venue_id', 'screen-001');
      expect(store.get('venue_id')).toBe('screen-001');
    });

    it('should update an existing key', () => {
      store.set('device_token', 'token-v1');
      store.set('device_token', 'token-v2');
      expect(store.get('device_token')).toBe('token-v2');
    });

    it('should store multiple independent keys', () => {
      store.set('venue_id', 'screen-001');
      store.set('device_token', 'my-token');
      store.set('backend_url', 'https://api.example.com');

      expect(store.get('venue_id')).toBe('screen-001');
      expect(store.get('device_token')).toBe('my-token');
      expect(store.get('backend_url')).toBe('https://api.example.com');
    });

    it('should handle empty string values', () => {
      store.set('empty_key', '');
      // empty string is valid (NOT NULL constraint allows empty)
      expect(store.get('empty_key')).toBe('');
    });

    it('should store JSON-serialized values', () => {
      const creds = JSON.stringify({ api_key: 'abc', network_id: 'net-1' });
      store.set('prodooh_credentials', creds);
      expect(JSON.parse(store.get('prodooh_credentials')!)).toEqual({
        api_key: 'abc',
        network_id: 'net-1',
      });
    });
  });

  describe('Loop config persistence', () => {
    const sampleLoopConfig: LoopConfig = {
      slots: [
        { position: 0, source: 'prodooh', duration: 10 },
        { position: 1, source: 'gam', duration: 10 },
        { position: 2, source: 'url', duration: 10 },
        { position: 3, source: 'playlist', duration: 10 },
      ],
      total_duration: 40,
      version: '1.0.0',
    };

    it('should return null when no loop config exists', () => {
      expect(store.getLoopConfig()).toBeNull();
    });

    it('should save and retrieve loop config', () => {
      store.setLoopConfig(sampleLoopConfig);
      const result = store.getLoopConfig();

      expect(result).not.toBeNull();
      expect(result!.slots).toEqual(sampleLoopConfig.slots);
      expect(result!.total_duration).toBe(40);
      expect(result!.version).toBe('1.0.0');
      expect(result!.synced_at).toBeDefined();
    });

    it('should overwrite existing loop config', () => {
      store.setLoopConfig(sampleLoopConfig);

      const updated: LoopConfig = {
        slots: [
          { position: 0, source: 'prodooh', duration: 15 },
          { position: 1, source: 'playlist', duration: 15 },
        ],
        total_duration: 30,
        version: '2.0.0',
      };
      store.setLoopConfig(updated);

      const result = store.getLoopConfig();
      expect(result!.version).toBe('2.0.0');
      expect(result!.slots).toHaveLength(2);
      expect(result!.total_duration).toBe(30);
    });

    it('should preserve synced_at when provided', () => {
      const configWithSyncedAt: LoopConfig = {
        ...sampleLoopConfig,
        synced_at: '2024-01-15T10:30:00.000Z',
      };
      store.setLoopConfig(configWithSyncedAt);

      const result = store.getLoopConfig();
      expect(result!.synced_at).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('Schedule persistence', () => {
    const sampleSchedule: ScheduleConfig = {
      timezone: 'America/Bogota',
      rules: [
        { days: [1, 2, 3, 4, 5], start: '08:00', end: '22:00' },
        { days: [0, 6], start: '10:00', end: '20:00' },
      ],
    };

    it('should return null when no schedule exists', () => {
      expect(store.getSchedule()).toBeNull();
    });

    it('should save and retrieve schedule', () => {
      store.setSchedule(sampleSchedule);
      const result = store.getSchedule();

      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('America/Bogota');
      expect(result!.rules).toHaveLength(2);
      expect(result!.rules[0]!.days).toEqual([1, 2, 3, 4, 5]);
      expect(result!.rules[0]!.start).toBe('08:00');
      expect(result!.rules[0]!.end).toBe('22:00');
      expect(result!.synced_at).toBeDefined();
    });

    it('should overwrite existing schedule', () => {
      store.setSchedule(sampleSchedule);

      const updated: ScheduleConfig = {
        timezone: 'America/New_York',
        rules: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }],
      };
      store.setSchedule(updated);

      const result = store.getSchedule();
      expect(result!.timezone).toBe('America/New_York');
      expect(result!.rules).toHaveLength(1);
    });

    it('should preserve synced_at when provided', () => {
      const scheduleWithSyncedAt: ScheduleConfig = {
        ...sampleSchedule,
        synced_at: '2024-03-01T12:00:00.000Z',
      };
      store.setSchedule(scheduleWithSyncedAt);

      const result = store.getSchedule();
      expect(result!.synced_at).toBe('2024-03-01T12:00:00.000Z');
    });
  });

  describe('Graceful degradation on missing configs (Requirement 1.4)', () => {
    it('should return null for each missing config independently', () => {
      // Only set venue_id, other keys remain missing
      store.set('venue_id', 'screen-001');

      expect(store.get('venue_id')).toBe('screen-001');
      expect(store.get('device_token')).toBeNull();
      expect(store.get('backend_url')).toBeNull();
      expect(store.get('prodooh_api_key')).toBeNull();
      expect(store.get('gam_ad_tag')).toBeNull();
      expect(store.getLoopConfig()).toBeNull();
      expect(store.getSchedule()).toBeNull();
    });

    it('should allow partial config: only venue_id present', () => {
      store.set('venue_id', 'screen-002');
      expect(store.get('venue_id')).toBe('screen-002');
      // Player should still operate with only venue_id available
    });

    it('should allow partial config: loop config without schedule', () => {
      const config: LoopConfig = {
        slots: [{ position: 0, source: 'playlist', duration: 10 }],
        total_duration: 10,
        version: '1.0.0',
      };
      store.setLoopConfig(config);

      expect(store.getLoopConfig()).not.toBeNull();
      expect(store.getSchedule()).toBeNull();
    });
  });

  describe('Table schema constraints', () => {
    it('should enforce playlist_items foreign key to playlist', () => {
      const db = (store as any).db;
      expect(() => {
        db.prepare(
          `INSERT INTO playlist_items (id, playlist_id, type, position) VALUES ('item-1', 'nonexistent', 'image', 0)`
        ).run();
      }).toThrow();
    });

    it('should enforce pop_queue action CHECK constraint', () => {
      const db = (store as any).db;
      expect(() => {
        db.prepare(
          `INSERT INTO pop_queue (id, print_id, action, url, created_at) VALUES ('q1', 'p1', 'invalid_action', 'http://x.com', '2024-01-01T00:00:00Z')`
        ).run();
      }).toThrow();
    });

    it('should enforce playback_log source CHECK constraint', () => {
      const db = (store as any).db;
      expect(() => {
        db.prepare(
          `INSERT INTO playback_log (id, content_id, source, started_at, ended_at, duration_seconds, result) VALUES ('log1', 'c1', 'invalid_source', '2024-01-01', '2024-01-01', 10.0, 'success')`
        ).run();
      }).toThrow();
    });

    it('should enforce playback_log result CHECK constraint', () => {
      const db = (store as any).db;
      expect(() => {
        db.prepare(
          `INSERT INTO playback_log (id, content_id, source, started_at, ended_at, duration_seconds, result) VALUES ('log1', 'c1', 'prodooh', '2024-01-01', '2024-01-01', 10.0, 'invalid_result')`
        ).run();
      }).toThrow();
    });

    it('should enforce playlist_items download_status CHECK constraint', () => {
      const db = (store as any).db;
      // First insert a playlist for the FK
      db.prepare(`INSERT INTO playlist (id, version, synced_at) VALUES ('pl-1', '1.0', '2024-01-01')`).run();

      expect(() => {
        db.prepare(
          `INSERT INTO playlist_items (id, playlist_id, type, position, download_status) VALUES ('item-1', 'pl-1', 'image', 0, 'invalid_status')`
        ).run();
      }).toThrow();
    });

    it('should allow valid playlist_items data', () => {
      const db = (store as any).db;
      db.prepare(`INSERT INTO playlist (id, version, synced_at) VALUES ('pl-1', '1.0', '2024-01-01')`).run();

      expect(() => {
        db.prepare(
          `INSERT INTO playlist_items (id, playlist_id, type, media_path, duration_seconds, position, rotation, checksum, download_status) VALUES ('item-1', 'pl-1', 'video', '/media/vid.mp4', 30, 0, 90, 'abc123', 'ready')`
        ).run();
      }).not.toThrow();
    });

    it('should allow valid pop_queue entries', () => {
      const db = (store as any).db;
      expect(() => {
        db.prepare(
          `INSERT INTO pop_queue (id, print_id, action, url, created_at, status) VALUES ('q1', 'p1', 'proof_of_play', 'https://api.prodooh.com/pop/p1', '2024-01-01', 'pending')`
        ).run();
      }).not.toThrow();
    });

    it('should enforce playback_log NOT NULL constraints', () => {
      const db = (store as any).db;
      // content_id is NOT NULL
      expect(() => {
        db.prepare(
          `INSERT INTO playback_log (id, content_id, source, started_at, ended_at, duration_seconds, result) VALUES ('log1', NULL, 'prodooh', '2024-01-01', '2024-01-01', 10.0, 'success')`
        ).run();
      }).toThrow();
    });

    it('should enforce playlist_items type NOT NULL constraint', () => {
      const db = (store as any).db;
      db.prepare(`INSERT INTO playlist (id, version, synced_at) VALUES ('pl-2', '1.0', '2024-01-01')`).run();
      expect(() => {
        db.prepare(
          `INSERT INTO playlist_items (id, playlist_id, type, position) VALUES ('item-2', 'pl-2', NULL, 0)`
        ).run();
      }).toThrow();
    });

    it('should enforce playlist_items position NOT NULL constraint', () => {
      const db = (store as any).db;
      db.prepare(`INSERT INTO playlist (id, version, synced_at) VALUES ('pl-3', '1.0', '2024-01-01')`).run();
      expect(() => {
        db.prepare(
          `INSERT INTO playlist_items (id, playlist_id, type, position) VALUES ('item-3', 'pl-3', 'image', NULL)`
        ).run();
      }).toThrow();
    });
  });
});
