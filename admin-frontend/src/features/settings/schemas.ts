import { z } from 'zod';

export const networkSettingsSchema = z.object({
  sync_interval_seconds: z.coerce
    .number({ invalid_type_error: 'Debe ser un número' })
    .int('Debe ser un número entero')
    .min(30, 'Mínimo 30 segundos')
    .max(900, 'Máximo 900 segundos'),
  cache_flush_interval_hours: z.coerce
    .number({ invalid_type_error: 'Debe ser un número' })
    .int('Debe ser un número entero')
    .min(1, 'Mínimo 1 hora')
    .max(720, 'Máximo 720 horas (30 días)'),
});

export type NetworkSettingsFormValues = z.infer<typeof networkSettingsSchema>;
