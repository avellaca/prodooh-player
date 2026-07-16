export interface User {
  id: string;
  email: string;
  role: 'super_admin' | 'tenant_admin' | 'trafficker';
  tenant_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tenant?: {
    id: string;
    name: string;
  };
}

export interface InviteUserInput {
  email: string;
  role: 'tenant_admin' | 'trafficker';
}
