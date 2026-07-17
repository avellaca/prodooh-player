import { z } from 'zod';

export const scheduleSlotSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM'),
});

export const groupSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  duration_seconds: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1, 'La duración debe ser al menos 1 segundo').nullable().optional(),
  num_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(1).max(100).nullable().optional(),
  ssp_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(0).nullable().optional(),
  playlist_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(0).nullable().optional(),
  schedule: z.array(scheduleSlotSchema).nullable().optional(),
  tenant_id: z.string().uuid().optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').optional(),
  duration_seconds: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1, 'La duración debe ser al menos 1 segundo').nullable().optional(),
  num_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(1).max(100).nullable().optional(),
  ssp_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(0).nullable().optional(),
  playlist_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(0).nullable().optional(),
  schedule: z.array(scheduleSlotSchema).nullable().optional(),
});

export const assignScreensSchema = z.object({
  screen_ids: z.array(z.string()).min(1, 'Debe seleccionar al menos una pantalla'),
});

export type CreateGroupInput = z.infer<typeof groupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type AssignScreensInput = z.infer<typeof assignScreensSchema>;
