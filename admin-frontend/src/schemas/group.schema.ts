import { z } from 'zod';

export const groupSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  duration_seconds: z.number().min(1).optional(),
  orientation: z.enum(['landscape', 'portrait']).optional(),
  resolution_width: z.number().min(1).optional(),
  resolution_height: z.number().min(1).optional(),
  tenant_id: z.string().uuid().optional(),
});

export const assignScreensSchema = z.object({
  screen_ids: z.array(z.string()).min(1, 'Debe seleccionar al menos una pantalla'),
});

export type CreateGroupInput = z.infer<typeof groupSchema>;
export type UpdateGroupInput = z.infer<typeof groupSchema>;
export type AssignScreensInput = z.infer<typeof assignScreensSchema>;
