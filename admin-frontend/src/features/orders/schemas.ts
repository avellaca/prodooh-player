import { z } from 'zod';

/** Schema for creating a new order — only name and advertiser_name (dates are computed from order lines) */
export const orderCreateSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(255),
  advertiser_name: z.string().min(1, 'El anunciante es requerido').max(255),
});

/** Schema for editing an existing order (name, advertiser_name, status) */
export const orderSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(255),
  advertiser_name: z.string().max(255).nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'finished']).default('draft'),
});

export const orderLineSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(255),
  priority_tier: z.enum(['patrocinio', 'estandar', 'red_interna'], {
    errorMap: () => ({ message: 'Seleccione un nivel de prioridad' }),
  }),
  active_dates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido')
  ).min(1, 'Seleccione al menos una fecha activa'),
  spots_mode: z.enum(['spots_por_dia', 'spots_por_linea']).default('spots_por_dia'),
  spots_input: z.coerce.number().int('Debe ser un número entero').min(1, 'Debe ser al menos 1'),
  delivery_pace: z.enum(['asap', 'uniform'], {
    errorMap: () => ({ message: 'Seleccione un ritmo de entrega' }),
  }),
  share_weight: z.coerce.number({ invalid_type_error: 'Debe ser un número' })
    .int('Debe ser un número entero').min(1, 'El peso debe ser al menos 1'),
  status: z.enum(['draft', 'active', 'paused', 'finished']).default('draft'),
  by_slot: z.boolean().default(false),
  slots_purchased: z.coerce.number().int('Debe ser un número entero').min(1, 'Debe ser al menos 1').optional(),
});

export const creativeSchema = z.object({
  content_id: z.string().min(1, 'Seleccione un contenido'),
  weight: z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int('Debe ser un número entero').min(1, 'El peso debe ser al menos 1'),
});

export const creativeForTargetSchema = z.object({
  content_id: z.string().min(1, 'El contenido es requerido'),
  weight: z.number().int('El peso debe ser un entero').min(1, 'El peso debe ser un entero mayor o igual a 1'),
});

export const bulkByResolutionSchema = z.object({
  content_id: z.string().min(1, 'El contenido es requerido'),
  resolution_width: z.number().int().min(1, 'El ancho de resolución debe ser al menos 1'),
  resolution_height: z.number().int().min(1, 'El alto de resolución debe ser al menos 1'),
  weight: z.number().int('El peso debe ser un entero').min(1, 'El peso debe ser un entero mayor o igual a 1'),
});

export type OrderCreateFormValues = z.infer<typeof orderCreateSchema>;
export type OrderFormValues = z.infer<typeof orderSchema>;
export type OrderLineFormValues = z.infer<typeof orderLineSchema>;
export type CreativeFormValues = z.infer<typeof creativeSchema>;
export type CreativeForTargetFormValues = z.infer<typeof creativeForTargetSchema>;
export type BulkByResolutionFormValues = z.infer<typeof bulkByResolutionSchema>;
