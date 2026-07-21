import { api } from '@/lib/axios';
import type { Content, Tag } from '@/types/models';

export interface UploadOptions {
  onUploadProgress?: (progress: number) => void;
}

export interface BulkUploadResult {
  successes: Array<{ index: number; data: Content }>;
  failures: Array<{ index: number; filename: string; errors: string[] }>;
  summary: { total: number; successful: number; failed: number };
}

export const contentApi = {
  list: () => api.get<{ data: Content[] }>('/admin/content').then((r) => r.data.data),

  upload: (file: File, options?: UploadOptions) => {
    const formData = new FormData();
    formData.append('file', file);

    return api
      .post<{ data: Content }>('/admin/content', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (options?.onUploadProgress && event.total) {
            const percent = Math.round((event.loaded * 100) / event.total);
            options.onUploadProgress(percent);
          }
        },
      })
      .then((r) => r.data.data);
  },

  delete: (id: string) => api.delete(`/admin/content/${id}`).then((r) => r.data),

  rotate: (id: string, rotation: number) =>
    api.put<{ data: Content }>(`/admin/content/${id}/rotate`, { rotation }).then((r) => r.data.data),

  getPreviewUrl: (id: string) =>
    api.get<{ data: { preview_url: string } }>(`/admin/content/${id}/preview`).then((r) => r.data.data.preview_url),

  bulkUpload: (
    files: File[],
    tagIds: string[],
    options?: { onUploadProgress?: (progress: number) => void },
  ): Promise<BulkUploadResult> => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files[]', file));
    tagIds.forEach((id) => formData.append('tag_ids[]', id));

    return api
      .post<BulkUploadResult>('/admin/content/bulk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (options?.onUploadProgress && event.total) {
            const percent = Math.round((event.loaded * 100) / event.total);
            options.onUploadProgress(percent);
          }
        },
      })
      .then((r) => r.data);
  },
};

export const tagsApi = {
  list: () =>
    api.get<{ data: Tag[] }>('/admin/tags').then((r) => r.data.data),

  create: (name: string) =>
    api.post<{ data: Tag }>('/admin/tags', { name }).then((r) => r.data.data),

  assignToContent: (contentId: string, tagIds: string[]) =>
    api.post<{ data: Tag[] }>(`/admin/content/${contentId}/tags`, { tag_ids: tagIds }).then((r) => r.data.data),

  removeFromContent: (contentId: string, tagId: string) =>
    api.delete(`/admin/content/${contentId}/tags/${tagId}`).then((r) => r.data),
};
