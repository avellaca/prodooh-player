import { api } from '@/lib/axios';
import type { Content } from '@/types/models';

export interface UploadOptions {
  onUploadProgress?: (progress: number) => void;
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
};
