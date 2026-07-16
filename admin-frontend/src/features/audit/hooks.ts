import { useQuery } from '@tanstack/react-query';
import { auditApi } from './api';
import type { AuditableType } from './types';

export function useAuditLogs(
  auditableType: AuditableType | undefined,
  id: string | undefined,
  page = 1,
) {
  return useQuery({
    queryKey: ['audit-logs', auditableType, id, page],
    queryFn: () => auditApi.list(auditableType!, id!, page),
    enabled: !!auditableType && !!id,
  });
}
