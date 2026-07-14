import type { Content, Screen, ScreenGroup } from '@/types/models';

export interface Order {
  id: string;
  tenant_id: string;
  name: string;
  advertiser_name: string | null;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'paused' | 'finished';
  created_at: string;
  updated_at: string;
  order_lines_count?: number;
  order_lines?: OrderLine[];
}

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
  share_weight: number;
  status: 'draft' | 'active' | 'paused' | 'finished';
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
  created_at: string;
  screen?: Screen;
  screen_group?: ScreenGroup;
}
