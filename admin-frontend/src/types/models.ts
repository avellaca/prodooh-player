export interface Tenant {
  id: string;
  name: string;
  default_duration_seconds: number | null;
  default_timezone: string | null;
  created_at: string;
  updated_at: string;
  screens_count?: number;
}

export interface Screen {
  id: string;
  tenant_id: string;
  group_id: string | null;
  venue_id: string;
  name: string;
  status: string;
  orientation: 'landscape' | 'portrait';
  resolution_width: number;
  resolution_height: number;
  duration_seconds: number;
  loop_config: LoopSlot[];
  sources_config: SourcesConfig;
  last_heartbeat: string | null;
  created_at: string;
  updated_at: string;
  screen_group?: ScreenGroup;
  tenant?: Tenant;
  playlists?: Playlist[];
}

export interface LoopSlot {
  position: number;
  source: 'prodooh' | 'gam' | 'url' | 'playlist';
  duration: number;
}

export interface SourcesConfig {
  prodooh: boolean;
  gam: boolean;
  url: boolean;
  playlist: boolean;
}

export interface ScreenGroup {
  id: string;
  tenant_id: string;
  name: string;
  duration_seconds: number | null;
  orientation: 'landscape' | 'portrait' | null;
  resolution_width: number | null;
  resolution_height: number | null;
  created_at: string;
  screens_count?: number;
  screens?: Screen[];
}

export interface Playlist {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  playlist_items?: PlaylistItem[];
  items_count?: number;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  content_id: string | null;
  type: 'content' | 'image' | 'video' | 'url';
  url: string | null;
  duration_seconds: number;
  position: number;
  refresh_interval: number | null;
  content?: Content;
}

export interface Content {
  id: string;
  tenant_id: string;
  filename: string;
  mime_type: string;
  storage_path: string;
  file_size_bytes: number;
  width: number;
  height: number;
  duration_seconds: number | null;
  orientation: string;
  rotation: number;
  created_at: string;
}

export interface Screenshot {
  id: string;
  screen_id: string;
  storage_path: string;
  captured_at: string;
}

export interface PlaybackAnalytics {
  total_spots: number;
  by_source: Record<string, number>;
  by_screen: Array<{ screen_id: string; count: number }>;
  by_content: Array<{ content_id: string; count: number }>;
}
