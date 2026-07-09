import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from './api';

export function useAnalytics(startDate: string, endDate: string, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', { startDate, endDate }],
    queryFn: () => analyticsApi.getPlayback(startDate, endDate),
    enabled,
  });
}
