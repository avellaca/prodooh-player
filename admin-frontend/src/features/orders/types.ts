import type { Content, Screen, ScreenGroup } from '@/types/models';

export interface Order {
  id: string;
  tenant_id: string;
  name: string;
  advertiser_id: string | null;
  advertiser_name: string | null;
  advertiser?: { id: string; name: string } | null;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'paused' | 'finished';
  total_target_spots?: number | null;
  total_delivered?: number;
  created_at: string;
  updated_at: string;
  order_lines_count?: number;
  order_lines?: OrderLine[];
}

export type PlaybackMode = 'round_robin' | 'sequential';

export interface OrderLine {
  id: string;
  order_id: string;
  name: string;
  priority_tier: 'patrocinio' | 'estandar' | 'red_interna';
  starts_at: string;
  ends_at: string;
  active_dates: string[] | null;
  target_spots: number | null;
  delivery_pace: 'asap' | 'uniform';
  status: 'draft' | 'active' | 'paused' | 'finished';
  playback_mode: PlaybackMode;
  by_slot: boolean;
  slots_purchased: number | null;
  created_at: string;
  updated_at: string;
  creatives_count?: number;
  creatives?: Creative[];
  targets?: OrderLineTarget[];
  order?: Order;
}

export interface Creative {
  id: string;
  order_line_target_id: string;
  content_id: string;
  weight: number;
  position: number | null;
  resolution_width: number | null;
  resolution_height: number | null;
  created_at: string;
  updated_at: string;
  content?: Content;
  /** @deprecated Use order_line_target_id instead */
  order_line_id?: string;
}

export interface ResolutionGroup {
  resolution_width: number;
  resolution_height: number;
  screen_count: number;
  screens: ResolutionScreen[];
  has_creative: boolean;
  coverage: {
    with_creative: number;
    total: number;
  };
}

export interface ResolutionScreen {
  id: string;
  name: string;
  target_id: string;
}

export interface BulkCreativeInput {
  content_id: string;
  resolution_width: number;
  resolution_height: number;
  weight: number;
}

export interface BulkCreativeResponse {
  creatives_created: number;
  affected_screens: string[];
}

export interface OrderLineTarget {
  id: string;
  order_line_id: string;
  screen_id: string | null;
  screen_group_id: string | null;
  playback_mode_override: PlaybackMode | null;
  created_at: string;
  screen?: Screen;
  screen_group?: ScreenGroup;
}

// ─── Tracking Pixels ─────────────────────────────────────────────────────────

export type TrackableType = 'orders' | 'order-lines' | 'creatives';
export type TriggerType = 'play' | 'impression';

export interface TrackingPixel {
  id: string;
  trackable_type: string;
  trackable_id: string;
  url: string;
  trigger_type: TriggerType;
  multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface TrackingPixelInput {
  url: string;
  trigger_type: TriggerType;
  multiplier: number;
}
