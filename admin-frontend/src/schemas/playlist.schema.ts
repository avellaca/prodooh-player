import { z } from 'zod';

export const playlistItemInputSchema = z.object({
  type: z.enum(['content', 'image', 'video', 'url'], { error: 'El tipo es obligatorio' }),
  content_id: z.string().optional(),
  url: z.string().url('Debe ser una URL válida').optional(),
  duration_seconds: z.number().min(1, 'La duración debe ser mayor a 0'),
  position: z.number(),
}).superRefine((data, ctx) => {
  if ((data.type === 'content' || data.type === 'image' || data.type === 'video') && !data.content_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El contenido es obligatorio cuando el tipo es "content"',
      path: ['content_id'],
    });
  }
  if (data.type === 'url' && !data.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La URL es obligatoria cuando el tipo es "url"',
      path: ['url'],
    });
  }
});

export const playlistSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  items: z.array(playlistItemInputSchema),
  tenant_id: z.string().uuid().optional(),
});

export const assignPlaylistSchema = z.object({
  screen_ids: z.array(z.string()).min(1, 'Debe seleccionar al menos una pantalla'),
});

export type PlaylistItemInput = z.infer<typeof playlistItemInputSchema>;
export type CreatePlaylistInput = z.infer<typeof playlistSchema>;
export type UpdatePlaylistInput = z.infer<typeof playlistSchema>;
export type AssignPlaylistInput = z.infer<typeof assignPlaylistSchema>;
