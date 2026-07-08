/**
 * Device API contracts — communication between player and backend.
 */

import type { LoopConfig, SourceType, DisplayConfig, ScheduleConfig } from './sources';

// ─── Device Authentication ───────────────────────────────────────────────────

export interface DeviceAuthRequest {
  device_token: string;
  venue_id: string;
}

export interface DeviceAuthResponse {
  access_token: string;
  expires_in: number;
}

// ─── Device Configuration ────────────────────────────────────────────────────

export interface SourcesConfig {
  prodooh: { enabled: boolean; api_key: string; network_id: string };
  gam: { enabled: boolean; ad_tag_url: string };
  url: { enabled: boolean; urls: Array<{ url: string; duration: number; refresh_interval?: number }> };
  playlist: { enabled: boolean };
}

export interface ContentDurationConfig {
  default_seconds: number;
  source: 'screen' | 'group' | 'tenant';
}

export interface DeviceConfigResponse {
  venue_id: string;
  tenant_id: string;
  loop: LoopConfig;
  sources: SourcesConfig;
  display: DisplayConfig;
  schedule: ScheduleConfig | null;
  content_duration: ContentDurationConfig;
  sync_interval_seconds: number;
  heartbeat_interval_seconds: number;
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

export interface StorageStatus {
  total_mb: number;
  available_mb: number;
  percent_used: number;
}

export interface HeartbeatRequest {
  venue_id: string;
  timestamp: string; // ISO 8601
  current_content: { id: string; source: SourceType } | null;
  storage: StorageStatus;
  uptime_seconds: number;
  playlist_version: string;
}

export interface DeviceCommand {
  id: string;
  type: 'screenshot' | 'config_update' | 'playlist_update';
  payload: Record<string, unknown>;
}

export interface HeartbeatResponse {
  ack: true;
  pending_commands: DeviceCommand[];
}

// ─── Playlist Sync ───────────────────────────────────────────────────────────

export interface PlaylistItem {
  id: string;
  type: 'image' | 'video' | 'url';
  url: string;
  duration?: number;
  rotation?: 0 | 90 | 180 | 270;
  refresh_interval?: number;
  checksum?: string; // SHA-256 for media files
}

export interface PlaylistResponse {
  version: string;
  etag: string;
  items: PlaylistItem[];
}

export interface PlaylistConfirmRequest {
  version: string;
  status: 'adopted' | 'failed';
  error?: string;
}

export interface PlaylistConfirmResponse {
  ack: true;
}

// ─── Playback Logs ───────────────────────────────────────────────────────────

export interface PlaybackLogEntry {
  id: string; // uuid
  content_id: string;
  source: SourceType;
  started_at: string; // ISO 8601
  ended_at: string; // ISO 8601
  duration_seconds: number;
  result: 'success' | 'failed';
  failure_reason?: string;
}

export interface PlaybackLogsRequest {
  logs: PlaybackLogEntry[];
}

export interface PlaybackLogsResponse {
  received: number;
  ack_ids: string[];
}

// ─── Screenshot ──────────────────────────────────────────────────────────────

export interface ScreenshotResponse {
  id: string;
  url: string;
}
