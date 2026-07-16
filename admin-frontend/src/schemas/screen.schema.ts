import { z } from 'zod';

export const createScreenSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  tenant_id: z.string().min(1, 'El tenant es obligatorio'),
  venue_id: z.string().min(1, 'El venue es obligatorio'),
  orientation: z.enum(['landscape', 'portrait']),
  resolution_width: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1, 'El ancho debe ser mayor a 0'),
  resolution_height: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1, 'El alto debe ser mayor a 0'),
});

export const updateScreenSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  venue_id: z.string().min(1, 'El venue ID es obligatorio'),
  orientation: z.enum(['landscape', 'portrait']),
  resolution_width: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1, 'El ancho debe ser mayor a 0'),
  resolution_height: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1, 'El alto debe ser mayor a 0'),
  num_slots: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().min(1).max(100).nullable().optional(),
  duration_seconds: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(1).nullable().optional(),
});

export type CreateScreenInput = z.infer<typeof createScreenSchema>;
export type UpdateScreenInput = z.infer<typeof updateScreenSchema>;
