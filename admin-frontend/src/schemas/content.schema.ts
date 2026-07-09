import { z } from 'zod';

export const rotateInputSchema = z.object({
  angle: z.enum(['90', '180', '270']).transform(Number),
});

export type RotateInput = z.infer<typeof rotateInputSchema>;
