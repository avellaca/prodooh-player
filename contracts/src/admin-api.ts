/**
 * Admin API contracts — communication between admin panel and backend.
 */

import type { SourceType, Orientation, LoopConfig, ScheduleConfig } from './sources';

// ─── Tenant Management ───────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  api_credential: string;
  default_duration_seconds: number;
  default_timezone: string;
  created_at: string;
}

export interface CreateTenantRequest {
  name: string;
  default_duration_seconds?: number;
  default_timezone?: string;
}

export interface UpdateTenantRequest {
  name?: string;
  default_duration_seconds?: number;
  default_timezone?: string;
}

// ─── Screen Management ───────────────────────────────────────────────────────

export type ScreenStatus = 'online' | 'offline' | 'unresponsive';

export interface Screen {
  id: string;
  tenant_id: string;
  group_id: string | null;
  venue_id: string;
  name: string;
  status: ScreenStatus;
  orientation: Orientation;
  resolution_width: number;
  resolution_height: number;
  loop_config: LoopConfig;
  last_heartbeat: string | null;
  created_at: string;
}

export interface RegisterScreenRequest {
  tenant_id: string;
  venue_id: string;
  name: string;
  orientation?: Orientation;
  resolution_width?: number;
  resolution_height?: number;
}

// ─── Screen Groups ───────────────────────────────────────────────────────────

export interface ScreenGroup {
  id: string;
  tenant_id: string;
  name: string;
  duration_seconds: number | null;
  schedule: ScheduleConfig | null;
  orientation: Orientation | null;
  resolution_width: number | null;
  resolution_height: number | null;
}

// ─── Content Library ─────────────────────────────────────────────────────────

export interface ContentItem {
  id: string;
  tenant_id: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  width: number;
  height: number;
  duration_seconds: number | null;
  orientation: Orientation;
  rotation: 0 | 90 | 180 | 270;
  created_at: string;
}

// ─── Playlist Management ─────────────────────────────────────────────────────

export interface Playlist {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  items: PlaylistItemAdmin[];
  created_at: string;
}

export interface PlaylistItemAdmin {
  id: string;
  type: 'image' | 'video' | 'url';
  content_id: string | null;
  url: string | null;
  duration_seconds: number | null;
  position: number;
  refresh_interval: number | null;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface PlaybackAnalyticsQuery {
  screen_id?: string;
  source?: SourceType;
  start_date: string; // ISO 8601
  end_date: string; // ISO 8601
}

export interface PlaybackAnalyticsSummary {
  total_spots: number;
  by_source: Record<SourceType, number>;
  by_screen: Record<string, number>;
}
