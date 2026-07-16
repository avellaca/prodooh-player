import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useForgotPassword } from '@/features/auth/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'El email es obligatorio').email('Email inválido'),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const mutation = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  function onSubmit(data: ForgotPasswordFormValues) {
    mutation.mutate(data);
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
              Restablecer contraseña
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mutation.isSuccess ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
                <p className="text-sm text-gray-600">
                  Si el email existe en nuestro sistema, recibirás un enlace para
                  restablecer tu contraseña.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver al inicio de sesión
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Ingresa tu email y te enviaremos un enlace para restablecer tu
                  contraseña.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@ejemplo.com"
                    autoComplete="email"
                    disabled={mutation.isPending}
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-sm text-red-500">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                {mutation.isError && (
                  <p className="text-sm text-red-500">
                    Ocurrió un error. Intenta nuevamente.
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
                  Enviar enlace
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
