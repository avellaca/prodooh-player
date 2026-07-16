import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useRegister } from '@/features/auth/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const registerSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres'),
    password_confirmation: z.string().min(1, 'Confirma tu contraseña'),
  })
  .refine((data) => data.password === data.password_confirmation, {
    message: 'Las contraseñas no coinciden',
    path: ['password_confirmation'],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const mutation = useRegister();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', password: '', password_confirmation: '' },
  });

  function onSubmit(data: RegisterFormValues) {
    mutation.mutate(
      { token, ...data },
      {
        onSuccess: () => {
          navigate('/orders');
        },
      }
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4 text-center">
                <p className="text-sm text-red-500">
                  Enlace de invitación inválido. El token no fue encontrado.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Ir al inicio de sesión
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
              Completar registro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <p className="text-sm text-gray-600">
                Completa tu registro para acceder al sistema.
              </p>

              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Tu nombre completo"
                  autoComplete="name"
                  disabled={mutation.isPending}
                  {...register('name')}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">
                    {errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
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
                  La invitación ha expirado o es inválida. Contacta al
                  administrador.
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
                Crear cuenta
              </Button>

              <div className="text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  ¿Ya tienes cuenta? Inicia sesión
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
