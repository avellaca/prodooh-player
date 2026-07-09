import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  name: string;
  register: UseFormRegister<any>;
  errors: FieldErrors;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export function FormField({
  label,
  name,
  register,
  errors,
  type = "text",
  placeholder,
  required,
  disabled,
}: FormFieldProps) {
  const error = errors[name];
  const errorMessage = error?.message as string | undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(error && "border-red-500 focus-visible:ring-red-500")}
        {...register(name, { required })}
      />
      {errorMessage && (
        <p className="text-sm text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}
