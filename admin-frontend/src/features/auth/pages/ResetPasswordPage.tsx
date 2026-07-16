import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useResetPassword } from '@/features/auth/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres'),
    password_confirmation: z.string().min(1, 'Confirma tu contraseña'),
  })
  .refine((data) => data.password === data.password_confirmation, {
    message: 'Las contraseñas no coinciden',
    path: ['password_confirmation'],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const mutation = useResetPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', password_confirmation: '' },
  });

  function onSubmit(data: ResetPasswordFormValues) {
    mutation.mutate({ token, ...data });
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4 text-center">
                <p className="text-sm text-red-500">
                  Enlace inválido. El token de restablecimiento no fue
                  encontrado.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver al inicio de sesión
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold text-gray-dark">
          Prodooh Admin
        </h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-center text-lg">
              Nueva contraseña
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mutation.isSuccess ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
                <p className="text-sm text-gray-600">
                  Tu contraseña ha sido restablecida exitosamente.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Iniciar sesión
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Ingresa tu nueva contraseña.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="password">Nueva contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    disabled={mutation.isPending}
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-sm text-red-500">
                      {errors.password.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password_confirmation">
                    Confirmar contraseña
                  </Label>
                  <Input
                    id="password_confirmation"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    disabled={mutation.isPending}
                    {...register('password_confirmation')}
                  />
                  {errors.password_confirmation && (
                    <p className="text-sm text-red-500">
                      {errors.password_confirmation.message}
                    </p>
                  )}
                </div>

                {mutation.isError && (
                  <p className="text-sm text-red-500">
                    El enlace ha expirado o es inválido. Solicita uno nuevo.
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={mutation.isPending}
                >
                  {mutation.isPending && (
                    <Loader2 className="animate-spin" />
                  )}
                  Restablecer contraseña
                </Button>

                <div className="text-center">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Volver al inicio de sesión
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
