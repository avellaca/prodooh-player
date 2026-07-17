import { z } from 'zod';

export const inviteUserSchema = z.object({
  name: z.string().max(255).optional(),
  email: z.string().email('Ingrese un email válido'),
  role: z.enum(['tenant_admin', 'trafficker'], {
    errorMap: () => ({ message: 'Seleccione un rol' }),
  }),
});

export type InviteUserFormValues = z.infer<typeof inviteUserSchema>;
