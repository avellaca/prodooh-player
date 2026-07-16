import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inviteUserSchema, type InviteUserFormValues } from '../schemas';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

interface InviteUserFormProps {
  onSubmit: (data: InviteUserFormValues) => void;
  isSubmitting?: boolean;
}

export function InviteUserForm({ onSubmit, isSubmitting = false }: InviteUserFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<InviteUserFormValues>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: '', role: 'trafficker' },
  });

  const selectedRole = watch('role');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <FormField
        label="Email"
        name="email"
        type="email"
        register={register}
        errors={errors}
        placeholder="usuario@ejemplo.com"
        disabled={isSubmitting}
      />

      <div className="space-y-2">
        <Label htmlFor="role">Rol</Label>
        <Select
          value={selectedRole}
          onValueChange={(value) => setValue('role', value as 'tenant_admin' | 'trafficker')}
          disabled={isSubmitting}
        >
          <SelectTrigger id="role">
            <SelectValue placeholder="Seleccione un rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tenant_admin">Administrador de Tenant</SelectItem>
            <SelectItem value="trafficker">Trafficker</SelectItem>
          </SelectContent>
        </Select>
        {errors.role && (
          <p className="text-sm text-red-500">{errors.role.message}</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar invitación
        </Button>
      </div>
    </form>
  );
}
