import { api } from '@/lib/axios';
import type {
  Order,
  OrderLine,
  Creative,
  OrderLineTarget,
  ResolutionGroup,
  BulkCreativeInput,
  BulkCreativeResponse,
  PlaybackMode,
  TrackableType,
  TrackingPixel,
  TrackingPixelInput,
} from './types';
import type { Content } from '@/types/models';

// ─── Delivery Progress Types ─────────────────────────────────────────────────

export interface DeliveryLineProgress {
  order_line_id: string;
  name: string;
  target_spots: number | null;
  total_delivered: number;
  today_delivered: number;
  daily_budget: number | null;
  total_progress: number | null;
  today_progress: number | null;
}

export interface DeliveryProgress {
  order_id: string;
  total_target: number;
  total_delivered: number;
  total_progress: number | null;
  lines: DeliveryLineProgress[];
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  name: string;
  advertiser_name?: string | null;
  advertiser_id?: string;
}

export interface UpdateOrderInput {
  name?: string;
  advertiser_name?: string | null;
  status?: 'draft' | 'active' | 'paused' | 'finished';
}

export interface CreateOrderLineInput {
  name: string;
  priority_tier: 'patrocinio' | 'estandar' | 'red_interna';
  starts_at: string;
  ends_at: string;
  target_spots?: number | null;
  delivery_pace: 'asap' | 'uniform';
  status?: 'draft' | 'active' | 'paused' | 'finished';
  by_slot?: boolean;
  slots_purchased?: number | null;
}

export interface UpdateOrderLineInput {
  name?: string;
  priority_tier?: 'patrocinio' | 'estandar' | 'red_interna';
  starts_at?: string;
  ends_at?: string;
  target_spots?: number | null;
  delivery_pace?: 'asap' | 'uniform';
  status?: 'draft' | 'active' | 'paused' | 'finished';
  playback_mode?: 'round_robin' | 'sequential';
  by_slot?: boolean;
  slots_purchased?: number | null;
}

export interface CreateCreativeInput {
  content_id: string;
  weight: number;
}

export interface UpdateCreativeInput {
  content_id?: string;
  weight?: number;
}

export interface CreateTargetInput {
  screen_id?: string | null;
  screen_group_id?: string | null;
}

export interface UpdateTargetInput {
  playback_mode_override?: PlaybackMode | null;
}

export interface CommandPayload {
  type: 'speed_override' | 'preview_content';
  factor?: number;
  expires_at?: string;
  content_id?: string;
  asset_url?: string;
  duration_seconds?: number;
}

// ─── Response type for screen commands ───────────────────────────────────────

export interface DeviceCommand {
  id: string;
  screen_id: string;
  type: 'speed_override' | 'preview_content';
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'executed';
  delivered_at: string | null;
  created_at: string;
}

// ─── API Objects ─────────────────────────────────────────────────────────────

export const ordersApi = {
  list: () =>
    api.get<{ data: Order[] }>('/admin/orders').then((r) => r.data.data),

  get: (id: string) =>
    api.get<{ data: Order }>(`/admin/orders/${id}`).then((r) => r.data.data),

  create: (data: CreateOrderInput) =>
    api.post<{ data: Order }>('/admin/orders', data).then((r) => r.data.data),

  update: (id: string, data: UpdateOrderInput) =>
    api.put<{ data: Order }>(`/admin/orders/${id}`, data).then((r) => r.data.data),

  activate: (id: string) =>
    api.patch<{ data: Order }>(`/admin/orders/${id}/activate`).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/orders/${id}`),

  deliveryProgress: (orderId: string) =>
    api.get<{ data: DeliveryProgress }>(`/admin/orders/${orderId}/delivery-progress`).then((r) => r.data.data),
};

// ─── Availability Types ──────────────────────────────────────────────────────

export interface AvailabilityInfo {
  is_sufficient: boolean;
  target_spots: number;
  available_capacity: number;
  saturation_percent: number;
  warning_message: string | null;
}

export interface ActivateOrderLineResponse {
  data: OrderLine;
  availability: AvailabilityInfo;
  requires_confirmation?: boolean;
}

export const orderLinesApi = {
  list: (orderId: string) =>
    api.get<{ data: OrderLine[] }>(`/admin/orders/${orderId}/order-lines`).then((r) => r.data.data),

  get: (id: string) =>
    api.get<{ data: OrderLine }>(`/admin/order-lines/${id}`).then((r) => r.data.data),

  create: (orderId: string, data: CreateOrderLineInput) =>
    api.post<{ data: OrderLine }>(`/admin/orders/${orderId}/order-lines`, data).then((r) => r.data.data),

  update: (id: string, data: UpdateOrderLineInput) =>
    api.put<{ data: OrderLine }>(`/admin/order-lines/${id}`, data).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/order-lines/${id}`),

  activate: (id: string, force = false) =>
    api.patch<ActivateOrderLineResponse>(`/admin/order-lines/${id}/activate`, { force }).then((r) => r.data),

  availability: (id: string) =>
    api.get<{ data: AvailabilityInfo }>(`/admin/order-lines/${id}/availability`).then((r) => r.data.data),
};

export const creativesApi = {
  listByTarget: (targetId: string) =>
    api.get<{ data: Creative[] }>(`/admin/order-line-targets/${targetId}/creatives`).then((r) => r.data.data),

  createForTarget: (targetId: string, data: CreateCreativeInput) =>
    api.post<{ data: Creative }>(`/admin/order-line-targets/${targetId}/creatives`, data).then((r) => r.data.data),

  update: (id: string, data: UpdateCreativeInput) =>
    api.put<{ data: Creative }>(`/admin/creatives/${id}`, data).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/creatives/${id}`),

  reorder: (targetId: string, creativeIds: string[]) =>
    api.post<{ data: Creative[] }>(
      `/admin/order-line-targets/${targetId}/creatives/reorder`,
      { creative_ids: creativeIds },
    ).then((r) => r.data.data),
};

export const targetsApi = {
  create: (orderLineId: string, data: CreateTargetInput) =>
    api.post<{ data: OrderLineTarget }>(`/admin/order-lines/${orderLineId}/targets`, data).then((r) => r.data.data),

  update: (id: string, data: UpdateTargetInput) =>
    api.put<{ data: OrderLineTarget }>(`/admin/order-line-targets/${id}`, data).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/order-line-targets/${id}`),
};

export const screenCommandsApi = {
  send: (screenId: string, data: CommandPayload) =>
    api.post<{ data: DeviceCommand }>(`/admin/screens/${screenId}/commands`, data).then((r) => r.data.data),
};

export const resolutionsApi = {
  list: (orderLineId: string) =>
    api.get<{ data: ResolutionGroup[] }>(`/admin/order-lines/${orderLineId}/resolutions`).then((r) => r.data.data),
};

export const bulkCreativesApi = {
  createByResolution: (orderLineId: string, data: BulkCreativeInput) =>
    api.post<{ data: BulkCreativeResponse }>(
      `/admin/order-lines/${orderLineId}/creatives/bulk-by-resolution`, data
    ).then((r) => r.data.data),
};

export const contentApi = {
  list: (filters?: { width?: number; height?: number }) => {
    const params = new URLSearchParams();
    if (filters?.width) params.set('width', String(filters.width));
    if (filters?.height) params.set('height', String(filters.height));
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<{ data: Content[] }>(`/admin/content${query}`).then((r) => r.data.data);
  },

  /** List all content for the tenant (no resolution filter) with tags included */
  listAll: () =>
    api.get<{ data: Content[] }>('/admin/content').then((r) => r.data.data),
};

// ─── Bulk Assign (Auto-Matching) ─────────────────────────────────────────────

export interface BulkAssignInput {
  content_ids: string[];
  weight: number;
}

export interface BulkAssignUnmatchedContent {
  id: string;
  width: number;
  height: number;
}

export interface BulkAssignResponse {
  created: number;
  unmatched_contents: BulkAssignUnmatchedContent[];
  covered_screens: string[];
}

export const bulkAssignApi = {
  assign: (orderLineId: string, data: BulkAssignInput) =>
    api.post<{ data: BulkAssignResponse }>(
      `/admin/order-lines/${orderLineId}/creatives/bulk-assign`,
      data,
    ).then((r) => r.data.data),
};

// ─── Loop Preview ────────────────────────────────────────────────────────────

export interface LoopPreviewSlot {
  position: number;
  type: 'ad' | 'ssp' | 'playlist';
  duration_seconds: number;
  strategy: 'fixed' | 'round_robin' | 'sequential';
  candidates: LoopPreviewCandidate[];
}

export interface LoopPreviewCandidate {
  creative_id: string;
  content_id: string;
  filename: string;
  mime_type: string | null;
  weight: number;
  position: number | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
}

export interface LoopPreviewResponse {
  screen_id: string;
  screen_name: string;
  playback_mode: 'round_robin' | 'sequential';
  total_duration_seconds: number;
  slots: LoopPreviewSlot[];
}

export const loopPreviewApi = {
  get: (screenId: string) =>
    api.get<{ data: LoopPreviewResponse }>(`/admin/screens/${screenId}/loop-preview`).then((r) => r.data.data),
};

// ─── Copy Creatives ──────────────────────────────────────────────────────────

export interface CopyCreativesResponse {
  created: number;
  skipped: number;
  covered_screens: string[];
}

export const copyCreativesApi = {
  copy: (sourceLineId: string, targetLineId: string) =>
    api.post<{ data: CopyCreativesResponse }>(
      `/admin/order-lines/${sourceLineId}/copy-creatives`,
      { target_order_line_id: targetLineId },
    ).then((r) => r.data.data),
};

// ─── Tracking Pixels ─────────────────────────────────────────────────────────

export const trackingPixelsApi = {
  list: (trackableType: TrackableType, trackableId: string) =>
    api.get<{ data: TrackingPixel[] }>(`/admin/${trackableType}/${trackableId}/tracking-pixels`).then((r) => r.data.data),

  create: (trackableType: TrackableType, trackableId: string, data: TrackingPixelInput) =>
    api.post<{ data: TrackingPixel }>(`/admin/${trackableType}/${trackableId}/tracking-pixels`, data).then((r) => r.data.data),

  update: (id: string, data: Partial<TrackingPixelInput>) =>
    api.put<{ data: TrackingPixel }>(`/admin/tracking-pixels/${id}`, data).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/tracking-pixels/${id}`),
};
