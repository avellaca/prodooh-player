import { z } from 'zod';

export const createScreenSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  tenant_id: z.string().min(1, 'El tenant es obligatorio'),
  venue_id: z.string().min(1, 'El venue es obligatorio'),
  orientation: z.enum(['landscape', 'portrait']),
  resolution_width: z.number().min(1, 'Ancho debe ser mayor a 0'),
  resolution_height: z.number().min(1, 'Alto debe ser mayor a 0'),
});

export const updateScreenSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  orientation: z.enum(['landscape', 'portrait']),
  resolution_width: z.number().min(1, 'Ancho debe ser mayor a 0'),
  resolution_height: z.number().min(1, 'Alto debe ser mayor a 0'),
  duration_seconds: z.number().min(1).optional(),
});

export type CreateScreenInput = z.infer<typeof createScreenSchema>;
export type UpdateScreenInput = z.infer<typeof updateScreenSchema>;
