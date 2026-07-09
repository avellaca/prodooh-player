import { api } from '@/lib/axios';
import type { PlaybackAnalytics } from '@/types/models';

export const analyticsApi = {
  getPlayback: (startDate: string, endDate: string) =>
    api
      .get<PlaybackAnalytics>('/admin/analytics/playback', {
        params: { date_from: startDate, date_to: endDate },
      })
      .then((r) => r.data),
};
