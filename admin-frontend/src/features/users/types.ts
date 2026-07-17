export interface User {
  id: string;
  name: string | null;
  email: string;
  role: 'super_admin' | 'tenant_admin' | 'trafficker';
  tenant_id: string | null;
  is_active: boolean;
  status: 'active' | 'inactive' | 'pending';
  created_at: string;
  updated_at?: string;
  tenant?: {
    id: string;
    name: string;
  };
}

export interface InviteUserInput {
  name?: string;
  email: string;
  role: 'tenant_admin' | 'trafficker';
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: 'tenant_admin' | 'trafficker';
}
