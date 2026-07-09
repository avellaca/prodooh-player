export interface AuthUser {
  id: string;
  email: string;
  role: 'super_admin' | 'tenant_admin';
  tenant_id: string | null;
  created_at: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
