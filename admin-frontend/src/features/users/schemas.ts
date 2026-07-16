import { z } from 'zod';

export const inviteUserSchema = z.object({
  email: z.string().email('Ingrese un email válido'),
  role: z.enum(['tenant_admin', 'trafficker'], {
    errorMap: () => ({ message: 'Seleccione un rol' }),
  }),
});

export type InviteUserFormValues = z.infer<typeof inviteUserSchema>;
