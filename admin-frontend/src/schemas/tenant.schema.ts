import { z } from 'zod';

export const tenantSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
});

export type CreateTenantInput = z.infer<typeof tenantSchema>;
export type UpdateTenantInput = z.infer<typeof tenantSchema>;
