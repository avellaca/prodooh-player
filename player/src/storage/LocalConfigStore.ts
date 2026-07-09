/**
 * LocalConfigStore — SQLite-based persistent storage for player configuration,
 * playlist data, proof-of-play queue, playback logs, and schedule.
 *
 * Uses better-sqlite3 for synchronous, embedded SQLite access on Raspberry Pi.
 */

import Database from 'better-sqlite3';
import type { LoopConfig, ScheduleConfig } from './types';

export class LocalConfigStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  /**
   * Creates all tables if they don't exist.
   */
  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS loop_config (
        id INTEGER PRIMARY KEY,
        config_json TEXT NOT NULL,
        version TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlist (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlist_items (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlist(id),
        type TEXT NOT NULL CHECK(type IN ('image', 'video', 'url')),
        media_path TEXT,
        url TEXT,
        duration_seconds INTEGER,
        position INTEGER NOT NULL,
        rotation INTEGER DEFAULT 0,
        refresh_interval INTEGER,
        checksum TEXT,
        download_status TEXT DEFAULT 'pending' CHECK(download_status IN ('pending', 'downloading', 'ready', 'failed'))
      );

      CREATE TABLE IF NOT EXISTS pop_queue (
        id TEXT PRIMARY KEY,
        print_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('proof_of_play', 'expiration')),
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        next_retry_at TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed'))
      );

      CREATE TABLE IF NOT EXISTS playback_log (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('prodooh', 'gam', 'url', 'playlist')),
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_seconds REAL NOT NULL,
        result TEXT NOT NULL CHECK(result IN ('success', 'failed')),
        failure_reason TEXT,
        synced INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS schedule (
        id INTEGER PRIMARY KEY,
        rules_json TEXT NOT NULL,
        timezone TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
    `);
  }

  // ─── Key-Value Config (device_config table) ─────────────────────────────────

  /**
   * Read a config value by key from device_config.
   */
  get(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM device_config WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Upsert a config value into device_config.
   */
  set(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO device_config (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now);
  }

  // ─── Loop Config ────────────────────────────────────────────────────────────

  /**
   * Read the current loop configuration.
   */
  getLoopConfig(): LoopConfig | null {
    const row = this.db
      .prepare('SELECT config_json, version, synced_at FROM loop_config WHERE id = 1')
      .get() as { config_json: string; version: string; synced_at: string } | undefined;

    if (!row) return null;

    return {
      ...JSON.parse(row.config_json),
      version: row.version,
      synced_at: row.synced_at,
    } as LoopConfig;
  }

  /**
   * Save loop configuration (upserts with id = 1).
   */
  setLoopConfig(config: LoopConfig): void {
    const now = new Date().toISOString();
    const { version, synced_at, ...rest } = config;
    const configJson = JSON.stringify(rest);
    const syncedAt = synced_at ?? now;

    this.db
      .prepare(
        `INSERT INTO loop_config (id, config_json, version, synced_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, version = excluded.version, synced_at = excluded.synced_at`
      )
      .run(configJson, version, syncedAt);
  }

  // ─── Schedule ───────────────────────────────────────────────────────────────

  /**
   * Read the current schedule configuration.
   */
  getSchedule(): ScheduleConfig | null {
    const row = this.db
      .prepare('SELECT rules_json, timezone, synced_at FROM schedule WHERE id = 1')
      .get() as { rules_json: string; timezone: string; synced_at: string } | undefined;

    if (!row) return null;

    return {
      timezone: row.timezone,
      rules: JSON.parse(row.rules_json),
      synced_at: row.synced_at,
    } as ScheduleConfig;
  }

  /**
   * Save schedule configuration (upserts with id = 1).
   */
  setSchedule(schedule: ScheduleConfig): void {
    const now = new Date().toISOString();
    const rulesJson = JSON.stringify(schedule.rules);

    this.db
      .prepare(
        `INSERT INTO schedule (id, rules_json, timezone, synced_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET rules_json = excluded.rules_json, timezone = excluded.timezone, synced_at = excluded.synced_at`
      )
      .run(rulesJson, schedule.timezone, schedule.synced_at ?? now);
  }

  /**
   * Returns the underlying database instance.
   * Used by other components (PlaylistSource, PlaybackLogger) that need
   * direct database access for their own queries.
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
